// -----------------------------------------------------------------------------
// Answers of the Transitous API (MOTIS 2), shaped after its OpenAPI (v2.10.2:
// /api/v6/plan, /api/v1/geocode). Only the fields the integration reads, and
// a few it ignores, as a real answer has them. Landmarks only: the house is
// Hôtel de Ville, the destination Gare Saint-Jean.
// -----------------------------------------------------------------------------

import { NOW } from './fixtures.js';

const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();

/** Gare Saint-Jean, as geocoded near Bordeaux, and its namesake far away. */
export function geocodePayload() {
  return [
    {
      type: 'STOP',
      name: 'Gare Saint-Jean',
      id: 'fr-tbm_StopArea_TGASJE',
      lat: 44.8258,
      lon: -0.5563,
      tokens: [[0, 15]],
      areas: [{ name: 'Bordeaux', adminLevel: 8, matched: false }],
      score: 42,
    },
    {
      type: 'PLACE',
      name: 'Gare Saint-Jean',
      id: 'far-away',
      lat: 48.85,
      lon: 2.35,
      tokens: [[0, 15]],
      areas: [],
      score: 40,
    },
  ];
}

const place = (name, minutes) => ({
  name,
  lat: 44.83,
  lon: -0.57,
  departure: at(minutes),
  scheduledDeparture: at(minutes),
});

const walk = (from, to, start, end) => ({
  mode: 'WALK',
  from: place(from, start),
  to: place(to, end),
  duration: (end - start) * 60,
  startTime: at(start),
  endTime: at(end),
  scheduledStartTime: at(start),
  scheduledEndTime: at(end),
  realTime: false,
  scheduled: true,
  legGeometry: { points: '', precision: 7, length: 0 },
});

const ride = (mode, routeShortName, from, to, start, end, extra = {}) => ({
  mode,
  from: place(from, start),
  to: place(to, end),
  duration: (end - start) * 60,
  startTime: at(start),
  endTime: at(end),
  scheduledStartTime: at(start - (extra.delay ?? 0)),
  scheduledEndTime: at(end - (extra.delay ?? 0)),
  realTime: extra.realTime ?? true,
  scheduled: true,
  headsign: extra.headsign ?? '',
  routeShortName,
  routeId: `fr-tbm_${routeShortName}`,
  tripId: `20261012_${routeShortName}_${start}`,
  agencyName: 'TBM',
  cancelled: extra.cancelled ?? false,
  alerts: extra.alerts ?? [],
  legGeometry: { points: '', precision: 7, length: 0 },
});

const itinerary = (id, start, end, transfers, legs) => ({
  id,
  duration: (end - start) * 60,
  startTime: at(start),
  endTime: at(end),
  transfers,
  legs,
});

/**
 * A plan from Hôtel de Ville to Gare Saint-Jean at NOW (17:53 in Bordeaux):
 *   - one already gone (left two minutes ago);
 *   - Tram A then Tram F, leaving in 4 minutes, the tram 1 minute late;
 *   - Lianes 2 (route "02"), timetable only, its stop moved;
 *   - Tram A with the trip cancelled.
 * Unordered, as nothing says the answer is.
 */
export function planPayload() {
  return {
    requestParameters: {},
    debugOutput: {},
    from: { name: 'START', lat: 44.8373, lon: -0.5772 },
    to: { name: 'END', lat: 44.8258, lon: -0.5563 },
    direct: [walk('START', 'END', 0, 31)],
    itineraries: [
      itinerary('it-2', 11, 34, 0, [
        walk('START', 'Quinconces', 11, 14),
        ride('BUS', '02', 'Quinconces', 'Gare Saint-Jean', 14, 31, {
          realTime: false,
          headsign: 'BORDEAUX Gare Saint-Jean',
          alerts: [{ headerText: 'Arrêt Quinconces déplacé', descriptionText: 'Travaux.' }],
        }),
        walk('Gare Saint-Jean', 'END', 31, 34),
      ]),
      itinerary('it-0', -2, 20, 0, [
        walk('START', 'Hôtel de Ville', -2, 0),
        ride('TRAM', 'A', 'Hôtel de Ville', 'Porte de Bourgogne', 0, 5),
        walk('Porte de Bourgogne', 'END', 5, 20),
      ]),
      itinerary('it-1', 4, 25, 1, [
        walk('START', 'Hôtel de Ville', 4, 7),
        ride('TRAM', 'A', 'Hôtel de Ville', 'Porte de Bourgogne', 7, 12, {
          delay: 1,
          headsign: 'La Gardette',
        }),
        ride('TRAM', 'F', 'Porte de Bourgogne', 'Gare Saint-Jean', 14, 22, {
          headsign: 'Gare de Bègles',
        }),
        walk('Gare Saint-Jean', 'END', 22, 25),
      ]),
      itinerary('it-3', 19, 40, 1, [
        walk('START', 'Hôtel de Ville', 19, 22),
        ride('TRAM', 'A', 'Hôtel de Ville', 'Porte de Bourgogne', 22, 27, { cancelled: true }),
        ride('TRAM', 'F', 'Porte de Bourgogne', 'Gare Saint-Jean', 29, 37),
        walk('Gare Saint-Jean', 'END', 37, 40),
      ]),
    ],
    previousPageCursor: 'p',
    nextPageCursor: 'n',
  };
}

/**
 * A refresh-itinerary answer: the itinerary of the plan with the id asked,
 * changed by `change` (a delay, a cancellation), or an HTTP 400 when the id is
 * unknown, as Transitous answers for an itinerary it cannot rebuild.
 * @param {URL} url
 * @param {(itinerary: object) => object} [change]
 */
export function refreshPayload(url, change = (itinerary) => itinerary) {
  const id = url.searchParams.get('itineraryId');
  const found = planPayload().itineraries.find((itinerary) => itinerary.id === id);
  return found ? change(structuredClone(found)) : { status: 400 };
}
