// -----------------------------------------------------------------------------
// Departures of a station, from the SIRI-Lite stop-monitoring method.
//
// One request per STATION (stop area): asking for a quay returns nothing, the
// station returns every line and both directions, about the next hour and a
// half. Each visit says:
//   - the line (LineRef) and the direction (DirectionRef "0" / "1", with its
//     name, "Cenon Gare / La Gardette / Thiers Benauge");
//   - the destination of that very vehicle ("La Gardette"): the branches of a
//     line share a direction, not a terminus;
//   - the aimed time (the timetable), and the expected time when the vehicle
//     is tracked in real time. A visit without expected time is a timetable
//     guess (a tram that has not left its terminus yet): shown with a "~".
//
// The feed has no cancellation flag and no "vehicle at stop" flag: what is not
// there cannot be shown.
//
// Several devices read the same station (one per line): the answer is kept a
// few seconds and shared, and two reads arriving together share one request.
// -----------------------------------------------------------------------------

import { fetchJson, TbmApiError } from './http.js';
import { lineId, ref, siriUrl, stopAreaRef, stopCode, text } from './siri.js';

// A minute-long poll of three lines at one station costs one request, not
// three; a widget opened right after a poll reuses that poll.
const SHARE_MS = 25_000;
// A departure whose time is a little past is still at the stop.
const PAST_TOLERANCE_MS = 30_000;

/** @type {Map<string, { at: number, promise: Promise<object[]> }>} */
const cache = new Map();

/** Forget every shared answer (tests). */
export function clearDeparturesCache() {
  cache.clear();
}

const parseTime = (value) => {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The departures of a stop-monitoring answer, soonest first.
 *
 * A visit with no departure time is a vehicle ENDING its trip at the station:
 * nobody boards it, it is left out.
 *
 * @param {unknown} payload
 * @returns {{ journey: string, lineId: string, direction: string, directionName: string,
 *   destination: string, quay: string, time: number, aimed: number | null,
 *   realtime: boolean, delayMinutes: number | null }[]}
 */
export function parseDepartures(payload) {
  const deliveries = payload?.Siri?.ServiceDelivery?.StopMonitoringDelivery;
  if (!Array.isArray(deliveries)) {
    throw new TbmApiError('stop-monitoring: no StopMonitoringDelivery');
  }
  const departures = [];
  const seen = new Set();
  for (const delivery of deliveries) {
    if (delivery?.Status === false) {
      const reason = text(delivery?.ErrorCondition?.Description) || 'Status false';
      throw new TbmApiError(`stop-monitoring refused the request: ${reason}`);
    }
    for (const visit of Array.isArray(delivery?.MonitoredStopVisit)
      ? delivery.MonitoredStopVisit
      : []) {
      const journey = visit?.MonitoredVehicleJourney ?? {};
      const call = journey.MonitoredCall ?? {};
      const aimed = parseTime(call.AimedDepartureTime);
      const expected = parseTime(call.ExpectedDepartureTime);
      const time = expected ?? aimed;
      if (time === null) continue;
      const id = text(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef);
      const line = lineId(ref(journey.LineRef));
      if (!line) continue;
      // The same vehicle can be listed twice (once per quay of a loop): keep it once.
      const key = `${id || line}|${time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      departures.push({
        journey: id,
        lineId: line,
        direction: ref(journey.DirectionRef),
        directionName: text(journey.DirectionName),
        destination: text(journey.DestinationName),
        quay: stopCode(ref(visit?.MonitoringRef)),
        time,
        aimed,
        realtime: expected !== null,
        delayMinutes:
          expected !== null && aimed !== null ? Math.round((expected - aimed) / 60_000) : null,
      });
    }
  }
  return departures.sort((a, b) => a.time - b.time);
}

/**
 * Every departure of a station, shared between the readers of the same few
 * seconds.
 * @param {string} stationCode e.g. THDVA
 * @param {{ now?: number, fresh?: boolean }} [options]
 */
export function fetchStationDepartures(stationCode, { now = Date.now(), fresh = false } = {}) {
  const shared = cache.get(stationCode);
  if (!fresh && shared && now - shared.at < SHARE_MS) {
    return shared.promise;
  }
  const promise = fetchJson(
    siriUrl('stop-monitoring', { MonitoringRef: stopAreaRef(stationCode) }),
  ).then(parseDepartures);
  cache.set(stationCode, { at: now, promise });
  // A failed answer is not worth sharing: the next reader tries again.
  promise.catch(() => {
    if (cache.get(stationCode)?.promise === promise) cache.delete(stationCode);
  });
  return promise;
}

/**
 * Whole minutes left before a time: 0 means "now, at the stop".
 * @param {number} time
 * @param {number} now
 */
export function minutesUntil(time, now) {
  return Math.max(0, Math.floor((time - now) / 60_000));
}

/**
 * The departures still to come, of one line and optionally one direction,
 * with the minutes to wait counted from `now`.
 * @param {ReturnType<typeof parseDepartures>} departures
 * @param {{ lineId?: string, direction?: string, now?: number }} filter
 */
export function upcoming(departures, { lineId: line, direction, now = Date.now() } = {}) {
  return departures
    .filter((departure) => departure.time >= now - PAST_TOLERANCE_MS)
    .filter((departure) => !line || departure.lineId === line)
    .filter((departure) => direction === undefined || departure.direction === direction)
    .map((departure) => ({ ...departure, minutes: minutesUntil(departure.time, now) }));
}

const clock = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
});

/** "18:12", Bordeaux time, whatever the timezone of the container. */
export function formatClock(time) {
  return clock.format(new Date(time));
}
