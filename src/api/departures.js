// -----------------------------------------------------------------------------
// Departures of a station, from the SIRI-Lite stop-monitoring method.
//
// One request per STATION (stop area): asking for a quay returns nothing, the
// station returns every line and both directions, for the next four hours
// (see below). Each visit says:
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
// The station is read four hours ahead (PreviewInterval), not the default hour
// and a half: that is what tells the last departure of the evening. A departure
// followed by nothing of its line and direction for two hours, while the
// answer reaches at least two hours past it, is the last before a break in
// service — the end of the day, before the night lines (checked 2026-10-12 at
// Hôtel de Ville: the tram A towards Le Haillan stops at 00:24, starts again at
// 04:55). Earlier than two hours before it, nothing can be said yet.
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
// How far ahead a station is read, as asked to the API, and the same in ms.
export const PREVIEW_INTERVAL = 'PT4H';
export const PREVIEW_MS = 4 * 3600_000;
// A gap this long after a departure, with nothing of its line and direction,
// makes it the last before a break in service.
export const SERVICE_BREAK_MS = 2 * 3600_000;

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
 * @param {{ windowEnd?: number }} [options] where the answer stops (request time
 *   plus the preview interval); without it, only a gap seen in the answer
 *   itself marks a last departure
 * @returns {{ journey: string, lineId: string, direction: string, directionName: string,
 *   destination: string, quay: string, time: number, aimed: number | null,
 *   realtime: boolean, delayMinutes: number | null, last: boolean }[]}
 */
export function parseDepartures(payload, { windowEnd } = {}) {
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
  departures.sort((a, b) => a.time - b.time);
  return markLastDepartures(departures, windowEnd);
}

/**
 * Flag the last departure before a break in service, per line and direction.
 * @param {object[]} departures soonest first
 * @param {number} [windowEnd]
 */
export function markLastDepartures(departures, windowEnd) {
  const nextOf = new Map();
  // Walk backwards: the departure met just before, in the same line and
  // direction, is the next one in time.
  for (let i = departures.length - 1; i >= 0; i -= 1) {
    const departure = departures[i];
    const key = `${departure.lineId}|${departure.direction}`;
    const next = nextOf.get(key);
    const until = next ? next.time : windowEnd;
    departure.last = until !== undefined && until - departure.time >= SERVICE_BREAK_MS;
    nextOf.set(key, departure);
  }
  return departures;
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
  const windowEnd = now + PREVIEW_MS;
  const promise = fetchJson(
    siriUrl('stop-monitoring', {
      MonitoringRef: stopAreaRef(stationCode),
      PreviewInterval: PREVIEW_INTERVAL,
    }),
  ).then((payload) => parseDepartures(payload, { windowEnd }));
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
