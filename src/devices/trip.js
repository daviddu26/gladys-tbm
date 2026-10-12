// -----------------------------------------------------------------------------
// Device type: A JOURNEY FROM THE HOUSE
//
// One device per destination typed in the "trips" field ("Travail : 1 place
// Pey Berland"): "TBM – Trajet → Travail". Transitous plans the best journeys
// from the house to that address, leaving now, with the TBM real time: a
// cancelled tram, the night buses once the trams have stopped, a stop moved
// for works are part of its answer, not of this code.
//
//   partir dans          minutes before leaving the house (999: no journey)
//   durée                minutes from the house to the destination
//   arrivée              "18:47"
//   itinéraire           "Tram A 18:12 → Lianes 9 18:31"
//   prochains départs    "18:05 → 18:47 · 18:15 → 18:55"
//   état                 "Normal", "Retard de 4 min", "Perturbé : …"
//
// A plan is asked at most every `trips_poll_frequency` seconds (5 minutes by
// default): the Transitous policy asks to stay light. Gladys polls every
// minute; in between, the countdown moves from the times already known.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { formatClock } from '../api/departures.js';
import { getDirectory } from '../api/directory.js';
import { geocode, planJourneys, TransitousError } from '../api/transitous.js';
import { homeLocation } from './suggestions.js';

export const DEVICE_TYPE = 'trip';

const logger = createLogger({ name: DEVICE_TYPE });

/** The countdown of "no journey", as for the departures. */
export const NO_JOURNEY_MINUTES = 999;

/** Feature keys. Forever: Gladys keys history and scenes on them. */
export const FEATURES = {
  leave: 'leave_in',
  duration: 'duration',
  arrival: 'arrival',
  route: 'route',
  options: 'options',
  status: 'status',
};

// How many journeys are asked for each plan: the widget shows up to five.
export const JOURNEYS_ASKED = 5;
// A journey whose departure is a little past is still catchable.
const PAST_TOLERANCE_MS = 30_000;

const TEXT_RANGE = { min: 0, max: 0 };

const LABELS = {
  fr: {
    device: (name) => `TBM – Trajet → ${name}`,
    leave: 'partir dans',
    duration: 'durée',
    arrival: 'arrivée',
    route: 'itinéraire',
    options: 'prochains départs',
    status: 'état',
    none: 'Aucun trajet trouvé',
    walk: (minutes) => `À pied, ${minutes} min`,
    normal: 'Normal',
    timetable: 'Horaire théorique',
    late: (minutes) => `Retard de ${minutes} min`,
    cancelled: 'Course supprimée sur ce trajet',
    disrupted: (text) => `Perturbé : ${text}`,
  },
  en: {
    device: (name) => `TBM – Journey → ${name}`,
    leave: 'leave in',
    duration: 'duration',
    arrival: 'arrival',
    route: 'route',
    options: 'next departures',
    status: 'status',
    none: 'No journey found',
    walk: (minutes) => `On foot, ${minutes} min`,
    normal: 'Normal',
    timetable: 'Timetable',
    late: (minutes) => `${minutes} min late`,
    cancelled: 'A trip of this journey is cancelled',
    disrupted: (text) => `Disrupted: ${text}`,
  },
};

/**
 * Error of a journey that cannot be planned for a reason the user can fix
 * (no house address, an address not found): it carries what to do.
 */
export class TripError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = 'TripError';
    this.userMessage = userMessage;
  }
}

/** The name of a TBM line from its public code ("A" → "Tram A"). */
function lineNameFromDirectory(code) {
  const lines = Object.values(getDirectory()?.lines ?? {});
  return lines.find((line) => line.code === code)?.name;
}

/**
 * "Tram A 18:12 → TER ~18:31", or on foot. A time without real time (a TER,
 * a tram not left its terminus yet) is marked "~", as on the departures.
 */
export function formatRoute(journey, language = 'fr') {
  if (!journey) return LABELS[language].none;
  if (journey.walkOnly) return LABELS[language].walk(journey.durationMinutes);
  return journey.legs
    .map((leg) => `${leg.line} ${leg.realtime ? '' : '~'}${formatClock(leg.start)}`)
    .join(' → ');
}

/** "18:05 → 18:47 · 18:15 → 18:55". */
export function formatOptions(journeys, max, language = 'fr') {
  if (journeys.length === 0) return LABELS[language].none;
  return journeys
    .slice(0, max)
    .map((journey) => `${formatClock(journey.start)} → ${formatClock(journey.end)}`)
    .join(' · ');
}

/** What may spoil the journey, most serious first. */
export function formatStatus(journey, language = 'fr') {
  const labels = LABELS[language];
  if (!journey) return labels.none;
  if (journey.cancelled) return labels.cancelled;
  if (journey.alerts.length > 0) return labels.disrupted(journey.alerts[0]);
  if (journey.delayMinutes >= 2) return labels.late(journey.delayMinutes);
  if (!journey.walkOnly && !journey.realtime) return labels.timetable;
  return labels.normal;
}

/** Whole minutes before leaving: 0 means "now". */
const minutesUntil = (time, now) => Math.max(0, Math.floor((time - now) / 60_000));

/** The last plan of each journey: shared by the poll, the widget and the scenes. */
const plans = new Map();

/** Forget every plan (tests). */
export function clearPlans() {
  plans.clear();
}

/**
 * The blueprint of one journey from the house.
 * @param {{ slug: string, name: string, address: string }} entry
 */
export function createTripBlueprint(entry) {
  const platformId = entry.slug;

  /**
   * The journeys still to come, planned again when the last plan is older
   * than the configured interval, or when its journeys have all left.
   */
  async function read(gladys, config, { now = Date.now(), fresh = false } = {}) {
    const known = plans.get(entry.slug);
    const maxAge = config.trips_poll_frequency * 1000;
    const stillValid = (plan) =>
      plan.address === entry.address &&
      now - plan.at < maxAge &&
      plan.journeys.some((journey) => journey.start >= now - PAST_TOLERANCE_MS);
    let plan = known;
    if (fresh || !known || !stillValid(known)) {
      const home = await homeLocation(gladys);
      if (!home) {
        throw new TripError('the house has no location', {
          en: 'Give your house an address in Gladys (Settings → Houses): journeys start from it.',
          fr: 'Donnez une adresse à votre maison dans Gladys (Paramètres → Maisons) : les trajets partent de là.',
        });
      }
      const place = await geocode(entry.address, home);
      if (!place) {
        throw new TripError(`address not found: ${entry.address}`, {
          en: `"${entry.address}" was not found near the house: add the town, e.g. "${entry.address}, Bordeaux".`,
          fr: `« ${entry.address} » est introuvable près de la maison : ajoutez la ville, ex. « ${entry.address}, Bordeaux ».`,
        });
      }
      const journeys = await planJourneys(home, place, {
        now,
        count: JOURNEYS_ASKED,
        lineName: lineNameFromDirectory,
      });
      plan = { at: now, address: entry.address, home, place, journeys };
      plans.set(entry.slug, plan);
      logger.debug(`${entry.slug}: ${journeys.length} journey(s) planned`);
    }
    const journeys = plan.journeys
      .filter((journey) => journey.start >= now - PAST_TOLERANCE_MS)
      .map((journey) => ({ ...journey, leaveMinutes: minutesUntil(journey.start, now) }));
    return { journeys, place: plan.place, plannedAt: plan.at };
  }

  return {
    key: `${DEVICE_TYPE}:${platformId}`,
    type: DEVICE_TYPE,
    slug: entry.slug,

    deviceExternalId(gladys) {
      return gladys.externalIds(DEVICE_TYPE, platformId).device;
    },

    describe() {
      return { name: entry.name, address: entry.address };
    },

    buildDevice(gladys, config) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const labels = LABELS[config.language];
      const minutes = (key, name) => ({
        name,
        external_id: ids.feature(key),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.MINUTES,
        min: 0,
        max: NO_JOURNEY_MINUTES,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      });
      const text = (key, name) => ({
        name,
        external_id: ids.feature(key),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        ...TEXT_RANGE,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      });
      return {
        name: labels.device(entry.name),
        external_id: ids.device,
        should_poll: true,
        poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
        params: [
          { name: 'trip_name', value: entry.name },
          { name: 'trip_address', value: entry.address },
        ],
        features: [
          minutes(FEATURES.leave, labels.leave),
          minutes(FEATURES.duration, labels.duration),
          text(FEATURES.arrival, labels.arrival),
          text(FEATURES.route, labels.route),
          text(FEATURES.options, labels.options),
          text(FEATURES.status, labels.status),
        ],
      };
    },

    read,

    /**
     * Publish the next journey. A journey that cannot be planned says why in
     * its "état" feature rather than failing the poll silently.
     */
    async onPoll(gladys, config, { now = Date.now() } = {}) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const state = (key, value) =>
        typeof value === 'number'
          ? { device_feature_external_id: ids.feature(key), state: value }
          : { device_feature_external_id: ids.feature(key), text: value };
      let journeys = [];
      let status;
      try {
        ({ journeys } = await read(gladys, config, { now }));
      } catch (err) {
        if (!(err instanceof TripError) && !(err instanceof TransitousError)) throw err;
        logger.warn(`${entry.slug}: ${err.message}`);
        status = err.userMessage[config.language];
      }
      const [next] = journeys;
      await gladys.publishChangedStates([
        state(
          FEATURES.leave,
          next ? Math.min(next.leaveMinutes, NO_JOURNEY_MINUTES) : NO_JOURNEY_MINUTES,
        ),
        state(
          FEATURES.duration,
          next ? Math.min(next.durationMinutes, NO_JOURNEY_MINUTES) : NO_JOURNEY_MINUTES,
        ),
        state(FEATURES.arrival, next ? formatClock(next.end) : '—'),
        state(FEATURES.route, formatRoute(next, config.language)),
        state(FEATURES.options, formatOptions(journeys, config.max_departures, config.language)),
        state(FEATURES.status, status ?? formatStatus(next, config.language)),
      ]);
      return journeys;
    },
  };
}
