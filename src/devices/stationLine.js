// -----------------------------------------------------------------------------
// Device type: A LINE AT A STATION
//
// One device per line the user follows at a station: "TBM – Hôtel de Ville –
// Tram A". A line runs in two directions, and what matters at a stop is which
// way the next vehicle goes, so every feature exists once per direction:
//
//   Sens 1 → Hôpital Pellegrin / Le Haillan Rostand · prochain passage   (min)
//   Sens 1 → … · destination                                         (text)
//   Sens 1 → … · passage suivant                                     (min)
//   Sens 1 → … · prochains passages     "Le Haillan Rostand 3 min · …" (text)
//   Sens 2 → Cenon Gare / La Gardette / Thiers Benauge · …
//
// The destination is that of the next vehicle, not of the direction: on a
// branching line (the tram A splits at Buttinière), "Sens 2" leaves for La
// Gardette one time and for Cenon Gare the next.
//
// A countdown is worth nothing once past: no feature keeps an history, and
// only the values that moved are sent (publishChangedStates).
//
// The directions are part of the device params: a created device keeps the
// features it was born with even if the directory later says otherwise
// (Gladys would only show an "Update" button), and is rebuilt from them.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { fetchStationDepartures, upcoming } from '../api/departures.js';
import { getDirectory } from '../api/directory.js';

export const DEVICE_TYPE = 'station-line';

const logger = createLogger({ name: DEVICE_TYPE });

/** The countdown of "no departure": a value no scene mistakes for a bus coming. */
export const NO_DEPARTURE_MINUTES = 999;

// `t_device_feature.min/max` are NOT NULL in the Gladys core: a text feature
// sent without them fails the whole publication (HTTP 422). 0/0 is what the
// core's own UI stores for a text feature.
const TEXT_RANGE = { min: 0, max: 0 };

/** The two SIRI directions, when the directory does not list them. */
export const DEFAULT_DIRECTIONS = ['0', '1'];

/** Feature keys of a direction. Forever: Gladys keys history and scenes on them. */
export const featureKeys = (direction) => ({
  next: `d${direction}_next`,
  destination: `d${direction}_destination`,
  following: `d${direction}_following`,
  summary: `d${direction}_summary`,
});

const LABELS = {
  fr: {
    direction: (rank) => `Sens ${rank}`,
    next: 'prochain passage',
    destination: 'destination',
    following: 'passage suivant',
    summary: 'prochains passages',
    none: 'Aucun passage à venir',
    now: 'à l’arrêt',
  },
  en: {
    direction: (rank) => `Direction ${rank}`,
    next: 'next departure',
    destination: 'destination',
    following: 'following departure',
    summary: 'next departures',
    none: 'No upcoming departure',
    now: 'now',
  },
};

/** "Sens 1" for SIRI direction "0": people count from one. */
export function directionRank(direction) {
  const number = Number.parseInt(direction, 10);
  return Number.isFinite(number) ? number + 1 : direction;
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The label of a direction: "Sens 1 → Hôpital Pellegrin / Le Haillan Rostand".
 * @param {string} direction SIRI id, "0" or "1"
 * @param {string} name where it goes, from the directory ('' if unknown)
 * @param {string} language
 */
export function directionLabel(direction, name, language = 'fr') {
  const base = LABELS[language].direction(directionRank(direction));
  return name ? `${base} → ${truncate(name, 48)}` : base;
}

/** "3 min", "~11 min" for a timetable guess, "+2" when late, "à l’arrêt". */
export function formatWait(departure, language = 'fr') {
  const scheduled = departure.realtime ? '' : '~';
  const wait =
    departure.minutes === 0 ? LABELS[language].now : `${scheduled}${departure.minutes} min`;
  const late = departure.delayMinutes >= 2 ? ` (+${departure.delayMinutes})` : '';
  return `${wait}${late}`;
}

/**
 * One direction as a line of text: "La Gardette 3 min · Cenon Gare ~11 min".
 * @param {object[]} departures upcoming, of one direction
 * @param {number} max
 * @param {string} language
 */
export function formatSummary(departures, max, language = 'fr') {
  if (departures.length === 0) return LABELS[language].none;
  return departures
    .slice(0, max)
    .map((departure) => `${departure.destination || '?'} ${formatWait(departure, language)}`)
    .join(' · ');
}

/**
 * The platform id of a device: the station code and the line id. It never
 * changes, so it never takes a name (a station or a line renamed by TBM keeps
 * its device).
 */
export const platformIdOf = (station, line) => `${station}-${line}`;

/**
 * The blueprint of one line at one station.
 *
 * @param {{ station: string, line: string, directions?: string[], label?: string }} entry
 *   `directions` comes from the params of a created device, else from the
 *   directory; `label` is the reason it is proposed ("à 250 m").
 */
export function createStationLineBlueprint(entry) {
  const platformId = platformIdOf(entry.station, entry.line);

  /** What the directory says of the station and the line (may be nothing yet). */
  const describe = () => {
    const dir = getDirectory();
    const station = dir?.stations?.[entry.station];
    const line = dir?.lines?.[entry.line];
    return {
      stationName: station?.name ?? entry.station,
      lineName: line?.name ?? `Ligne ${entry.line}`,
      lineCode: line?.code ?? entry.line,
      directionNames: Object.fromEntries((line?.directions ?? []).map((d) => [d.id, d.name])),
      directions:
        entry.directions?.length > 0
          ? entry.directions
          : line?.directions?.length > 0
            ? line.directions.map((direction) => direction.id)
            : DEFAULT_DIRECTIONS,
    };
  };

  return {
    key: `${DEVICE_TYPE}:${platformId}`,
    type: DEVICE_TYPE,
    station: entry.station,
    line: entry.line,
    label: entry.label,

    deviceExternalId(gladys) {
      return gladys.externalIds(DEVICE_TYPE, platformId).device;
    },

    /** Names and directions, for the widget and the scenes. */
    describe,

    buildDevice(gladys, config) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const labels = LABELS[config.language];
      const info = describe();
      const features = [];
      for (const direction of info.directions) {
        const keys = featureKeys(direction);
        const prefix = directionLabel(
          direction,
          info.directionNames[direction] ?? '',
          config.language,
        );
        const countdown = (key, name) => ({
          name: `${prefix} · ${name}`,
          external_id: ids.feature(key),
          category: DEVICE_FEATURE_CATEGORIES.DURATION,
          type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
          unit: DEVICE_FEATURE_UNITS.MINUTES,
          min: 0,
          max: NO_DEPARTURE_MINUTES,
          read_only: true,
          has_feedback: false,
          keep_history: false,
        });
        const textFeature = (key, name) => ({
          name: `${prefix} · ${name}`,
          external_id: ids.feature(key),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          ...TEXT_RANGE,
          read_only: true,
          has_feedback: false,
          keep_history: false,
        });
        features.push(
          countdown(keys.next, labels.next),
          textFeature(keys.destination, labels.destination),
          countdown(keys.following, labels.following),
          textFeature(keys.summary, labels.summary),
        );
      }
      return {
        name: `TBM – ${info.stationName} – ${info.lineName}`,
        external_id: ids.device,
        // Gladys only polls a device created with both fields, and only at one
        // of its own frequencies: the configured interval is applied by the
        // poll dispatcher (src/devices/index.js), not here.
        should_poll: true,
        poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
        params: [
          { name: 'station', value: entry.station },
          { name: 'line', value: entry.line },
          { name: 'directions', value: info.directions.join(',') },
        ],
        features,
      };
    },

    /**
     * The departures of this line at this station, soonest first, both
     * directions. Shared by the poll, the widget and the scene action, so the
     * three always agree on what "the next tram" is.
     * @param {{ now?: number, fresh?: boolean }} [options]
     */
    async read({ now = Date.now(), fresh = false } = {}) {
      const all = await fetchStationDepartures(entry.station, { now, fresh });
      return upcoming(all, { lineId: entry.line, now });
    },

    async onPoll(gladys, config, { now = Date.now() } = {}) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const departures = await this.read({ now });
      const { directions } = describe();
      const states = [];
      for (const direction of directions) {
        const keys = featureKeys(direction);
        const list = departures.filter((departure) => departure.direction === direction);
        const [next, following] = list;
        states.push(
          {
            device_feature_external_id: ids.feature(keys.next),
            state: next ? Math.min(next.minutes, NO_DEPARTURE_MINUTES) : NO_DEPARTURE_MINUTES,
          },
          {
            device_feature_external_id: ids.feature(keys.destination),
            text: next?.destination || '—',
          },
          {
            device_feature_external_id: ids.feature(keys.following),
            state: following
              ? Math.min(following.minutes, NO_DEPARTURE_MINUTES)
              : NO_DEPARTURE_MINUTES,
          },
          {
            device_feature_external_id: ids.feature(keys.summary),
            text: formatSummary(list, config.max_departures, config.language),
          },
        );
      }
      // Only what moved: a countdown read every minute changes every minute,
      // a destination rarely. The SDK forgets these values when the user
      // creates or updates the device, so a new device gets all of them.
      await gladys.publishChangedStates(states);
      logger.debug(`${platformId}: ${departures.length} departure(s) upcoming`);
      return departures;
    },
  };
}
