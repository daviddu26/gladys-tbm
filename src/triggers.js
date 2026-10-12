// -----------------------------------------------------------------------------
// Scene trigger "departure approaching" (manifest `scene_triggers`).
//
// A device feature is a state, and Gladys already starts scenes on a state
// ("next departure < 5"). The trigger is the other thing: an EVENT, a vehicle
// crossing the "5 minutes away" mark between two reads. It fires once per
// vehicle and per mark, carries what the scene needs to say (line,
// destination, delay) and a ready-made sentence.
//
// The core only matches equality and membership: the mark crossed travels as
// a plain value ("5"), the same as the option the scene author picked.
//
// A vehicle is followed by its journey id (DatedVehicleJourneyRef), stable
// from one read to the next: the next tram taking the place of the one that
// just left is never mistaken for a crossing. A vehicle absent from the
// previous read is not followed yet — it appeared, it did not approach — and
// nothing fires on the first read after a start: a restart must not announce
// every tram already close.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatClock } from './api/departures.js';
import { directionRank } from './devices/stationLine.js';

const logger = createLogger({ name: 'triggers' });

/** Key of the trigger in the manifest. Forever. */
export const DEPARTURE_APPROACHING = 'departure_approaching';

/**
 * The marks a scene can wait for: the options of the `threshold` select of the
 * manifest (test/manifest.test.js keeps both lists identical).
 */
export const DEPARTURE_THRESHOLDS = [1, 2, 3, 5, 10, 15];

/** @type {Map<string, object[]>} the previous read, per device. */
const previousReads = new Map();

/** Forget every previous read (configuration change, tests). */
export function clearTriggerMemory() {
  previousReads.clear();
}

/**
 * The marks each vehicle crossed between two reads. Every mark crossed fires,
 * not only the closest: a station read every three minutes can go from 11 to
 * 4 in one step, and a scene waiting for "10" is as entitled to run as one
 * waiting for "5".
 * @param {{ journey: string, minutes: number }[]} previous
 * @param {{ journey: string, minutes: number }[]} current
 */
export function departureCrossings(previous, current) {
  const before = new Map(
    previous.filter((departure) => departure.journey).map((d) => [d.journey, d.minutes]),
  );
  const crossings = [];
  for (const departure of current) {
    const was = departure.journey ? before.get(departure.journey) : undefined;
    if (was === undefined) continue;
    for (const threshold of DEPARTURE_THRESHOLDS) {
      if (was > threshold && departure.minutes <= threshold) {
        crossings.push({ departure, threshold });
      }
    }
  }
  return crossings;
}

/**
 * The sentence a scene can send as is.
 * @param {{ stationName: string, lineName: string }} info
 * @param {object} departure
 * @param {string} language
 */
export function departureSentence(info, departure, language = 'fr') {
  const time = formatClock(departure.time);
  const late = departure.delayMinutes >= 1;
  if (language === 'en') {
    const when = departure.minutes === 0 ? 'is at the stop' : `leaves in ${departure.minutes} min`;
    const details = [time, late ? `incl. ${departure.delayMinutes} minutes delay` : null]
      .filter(Boolean)
      .join(', ');
    return `${info.stationName}: ${info.lineName} to ${departure.destination} ${when} (${details}).`;
  }
  const when = departure.minutes === 0 ? 'est à l’arrêt' : `passe dans ${departure.minutes} min`;
  const details = [time, late ? `dont ${departure.delayMinutes} minutes de retard` : null]
    .filter(Boolean)
    .join(', ');
  return `${info.stationName} : ${info.lineName} vers ${departure.destination} ${when} (${details}).`;
}

/**
 * Compare a fresh read with the previous one of the same device, and fire the
 * events. A failed publication only costs the event: the poll already
 * published the states.
 * @param {object} gladys
 * @param {object} blueprint the station-line blueprint
 * @param {object[]} departures the fresh read (upcoming, both directions)
 * @param {string} language
 */
export async function publishDepartureEvents(gladys, blueprint, departures, language) {
  const previous = previousReads.get(blueprint.key);
  previousReads.set(blueprint.key, departures);
  if (!previous) return 0;
  const crossings = departureCrossings(previous, departures);
  if (crossings.length === 0) return 0;
  const info = blueprint.describe();
  const device = blueprint.deviceExternalId(gladys);
  let fired = 0;
  for (const { departure, threshold } of crossings) {
    try {
      await gladys.publishSceneEvent(DEPARTURE_APPROACHING, {
        device,
        direction: departure.direction,
        threshold: String(threshold),
        stop_name: info.stationName,
        line: info.lineCode,
        direction_rank: directionRank(departure.direction),
        destination: departure.destination,
        minutes: departure.minutes,
        delay: departure.delayMinutes ?? 0,
        realtime: departure.realtime,
        time: formatClock(departure.time),
        summary: departureSentence(info, departure, language),
      });
      fired += 1;
    } catch (err) {
      logger.warn(`Scene event ${DEPARTURE_APPROACHING} not published: ${err.message}`);
    }
  }
  return fired;
}
