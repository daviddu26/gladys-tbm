// -----------------------------------------------------------------------------
// Transitous (https://transitous.org): journey planning.
//
// Transitous is a free, community-run routing service (MOTIS 2) that loads the
// TBM timetables and real time (GTFS, GTFS-RT, SIRI-Lite of the open data),
// with the other networks of France. The integration asks it two things:
//   - geocode: where an address typed by the user is ("1 place Pey Berland");
//   - plan: the best journeys from the house to that place, leaving now. A
//     cancelled or late trip is in its real-time data, the night lines in the
//     timetable: when the tram stops at night, the plan takes the night bus.
//
// Its usage policy (https://transitous.org/api/): open-source, non-commercial
// use, a User-Agent naming the application and a contact, and staying light —
// routing is its expensive endpoint. Hence: an address is geocoded once and
// kept in /data, and a journey is planned again at most every few minutes
// (`trips_poll_frequency`, 2 minutes at the fastest), the countdowns moving in
// between from the times already known.
//
// The shapes below follow the OpenAPI of MOTIS v2.10.2 (/api/v6/plan,
// /api/v1/geocode), the version Transitous documented on 2026-10-12.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { USER_AGENT } from './http.js';

const logger = createLogger({ name: 'transitous' });

export const TRANSITOUS_API_URL = 'https://api.transitous.org/api';

// Gladys waits 15 s for a widget: a plan must give up before.
const TIMEOUT_MS = 10_000;

const dataDir = () => process.env.TBM_DATA_DIR || '/data';
const PLACES_FILE = 'places.json';

// An address found farther than this from the house is not the one meant
// ("Victoire" exists in many towns): the user is asked to be more precise.
export const MAX_PLACE_DISTANCE_M = 60_000;

/**
 * Error of the Transitous service, with the explanation shown to the user.
 */
export class TransitousError extends Error {
  constructor(message, { status, userMessage } = {}) {
    super(message);
    this.name = 'TransitousError';
    this.status = status;
    this.userMessage = userMessage ?? {
      en: 'The journey planner (Transitous) does not answer right now: the integration tries again by itself.',
      fr: 'Le calcul d’itinéraire (Transitous) ne répond pas pour l’instant : l’intégration réessaie d’elle-même.',
    };
  }
}

async function getJson(path, params) {
  const url = `${TRANSITOUS_API_URL}${path}?${new URLSearchParams(params)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TransitousError(`Transitous unreachable: ${err.message}`);
  }
  if (!response.ok) {
    throw new TransitousError(`Transitous ${path} answered HTTP ${response.status}`, {
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (err) {
    throw new TransitousError(
      `Transitous ${path} answered something that is not JSON: ${err.message}`,
    );
  }
}

/** Distance in metres between two points (haversine). */
export function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// -----------------------------------------------------------------------------
// Geocoding, kept in /data: an address typed once is looked up once.
// -----------------------------------------------------------------------------

/** @type {Map<string, { name: string, lat: number, lon: number } | null> | null} */
let places = null;

const placeKey = (text) =>
  String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

async function loadPlaces() {
  if (places) return places;
  try {
    const saved = JSON.parse(await readFile(join(dataDir(), PLACES_FILE), 'utf8'));
    places = new Map(Object.entries(saved ?? {}));
  } catch {
    places = new Map();
  }
  return places;
}

async function savePlaces() {
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(
      join(dataDir(), PLACES_FILE),
      JSON.stringify(Object.fromEntries(places)),
      'utf8',
    );
  } catch (err) {
    // Only a cache: the places stay known in memory.
    logger.warn(`The places could not be saved in ${dataDir()}: ${err.message}`);
  }
}

/** Forget every place (tests). */
export function clearPlaces() {
  places = null;
}

/**
 * Where an address is, looked up near the house.
 *
 * @param {string} text what the user typed
 * @param {{ lat: number, lon: number }} near the house, to prefer the place of
 *   Bordeaux over its namesakes elsewhere
 * @returns {Promise<{ name: string, lat: number, lon: number } | null>} null
 *   when nothing near enough matches
 */
export async function geocode(text, near) {
  const key = placeKey(text);
  const known = await loadPlaces();
  if (known.has(key)) return known.get(key);

  const matches = await getJson('/v1/geocode', {
    text: String(text).trim(),
    language: 'fr',
    place: `${near.lat},${near.lon}`,
    numResults: '5',
  });
  const found = (Array.isArray(matches) ? matches : [])
    .filter((match) => Number.isFinite(match?.lat) && Number.isFinite(match?.lon))
    .map((match) => ({
      name: String(match.name ?? '').trim() || String(text).trim(),
      lat: match.lat,
      lon: match.lon,
      distance: distanceMeters(near, match),
    }))
    .find((match) => match.distance <= MAX_PLACE_DISTANCE_M);
  const place = found ? { name: found.name, lat: found.lat, lon: found.lon } : null;
  known.set(key, place);
  await savePlaces();
  logger.info(
    place
      ? `Address "${text}" found at ${Math.round(found.distance)} m from the house`
      : `Address "${text}" not found near the house`,
  );
  return place;
}

// -----------------------------------------------------------------------------
// Journey planning.
// -----------------------------------------------------------------------------

const TRANSIT_NAMES = {
  TRAM: { fr: 'Tram', en: 'Tram' },
  BUS: { fr: 'Bus', en: 'Bus' },
  COACH: { fr: 'Car', en: 'Coach' },
  FERRY: { fr: 'Bateau', en: 'Boat' },
  RAIL: { fr: 'Train', en: 'Train' },
  REGIONAL_RAIL: { fr: 'TER', en: 'TER' },
  REGIONAL_FAST_RAIL: { fr: 'TER', en: 'TER' },
  SUBURBAN: { fr: 'Train', en: 'Train' },
};

const parseTime = (value) => {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};

// Trains are named by their kind ("TER"): their route names are train numbers
// ("TER 866266", seen live on 2026-10-12), of no use to choose a train.
const RAIL_MODES = new Set([
  'RAIL',
  'REGIONAL_RAIL',
  'REGIONAL_FAST_RAIL',
  'SUBURBAN',
  'HIGHSPEED_RAIL',
  'LONG_DISTANCE',
  'NIGHT_RAIL',
]);

/**
 * The name of a transit leg as people say it: the TBM directory knows that
 * the tram "A" is "Tram A" and the bus "4" is "Lianes 4"; a train is "TER";
 * any other line (a regional coach) is its mode and route, the mode not
 * repeated when the route already starts with it.
 * @param {object} leg
 * @param {(code: string) => string | undefined} lineName from the TBM directory
 */
export function legLineName(leg, lineName = () => undefined) {
  const short = String(leg?.routeShortName ?? '')
    .trim()
    .replace(/^0+(?=.)/, '');
  const known = short ? lineName(short) : undefined;
  if (known) return known;
  const mode = TRANSIT_NAMES[leg?.mode]?.fr ?? '';
  if (RAIL_MODES.has(leg?.mode)) return mode || 'Train';
  const route = String(short || leg?.displayName || leg?.routeLongName || '').trim();
  if (!route) return mode || 'Transport';
  if (mode && route.toLowerCase().startsWith(mode.toLowerCase())) return route;
  return [mode, route].filter(Boolean).join(' ');
}

/**
 * The itineraries of a plan answer, soonest departure first.
 *
 * @param {unknown} payload
 * @param {(code: string) => string | undefined} [lineName]
 * @returns {{ id: string, start: number, end: number, durationMinutes: number,
 *   transfers: number, realtime: boolean, cancelled: boolean, delayMinutes: number,
 *   walkOnly: boolean, legs: { line: string, headsign: string, from: string, to: string,
 *   start: number, end: number, realtime: boolean, cancelled: boolean,
 *   delayMinutes: number }[], alerts: string[] }[]}
 */
export function parsePlan(payload, lineName) {
  if (!payload || !Array.isArray(payload.itineraries)) {
    throw new TransitousError('plan: no itineraries in the answer');
  }
  const itineraries = [];
  for (const itinerary of payload.itineraries) {
    const start = parseTime(itinerary?.startTime);
    const end = parseTime(itinerary?.endTime);
    if (start === null || end === null) continue;
    const legs = [];
    const alerts = new Set();
    for (const leg of Array.isArray(itinerary.legs) ? itinerary.legs : []) {
      for (const alert of [...(leg?.alerts ?? []), ...(leg?.from?.alerts ?? [])]) {
        const header = String(alert?.headerText ?? '').trim();
        if (header) alerts.add(header);
      }
      // Walking, cycling...: part of the duration, not a line to take.
      if (!leg?.routeShortName && !leg?.routeId && !leg?.tripId) continue;
      const legStart = parseTime(leg.startTime);
      const scheduled = parseTime(leg.scheduledStartTime);
      legs.push({
        line: legLineName(leg, lineName),
        headsign: String(leg.headsign ?? '').trim(),
        from: String(leg.from?.name ?? '').trim(),
        to: String(leg.to?.name ?? '').trim(),
        start: legStart,
        end: parseTime(leg.endTime),
        realtime: leg.realTime === true,
        cancelled: leg.cancelled === true,
        delayMinutes:
          legStart !== null && scheduled !== null ? Math.round((legStart - scheduled) / 60_000) : 0,
      });
    }
    itineraries.push({
      id: String(itinerary.id ?? ''),
      start,
      end,
      durationMinutes: Math.round((end - start) / 60_000),
      transfers: Number.isFinite(itinerary.transfers) ? itinerary.transfers : 0,
      realtime: legs.some((leg) => leg.realtime),
      cancelled: legs.some((leg) => leg.cancelled),
      delayMinutes: Math.max(0, ...legs.map((leg) => leg.delayMinutes)),
      walkOnly: legs.length === 0,
      legs,
      alerts: [...alerts],
    });
  }
  return itineraries.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * The journeys from one point to another, leaving from `now`.
 * @param {{ lat: number, lon: number }} from
 * @param {{ lat: number, lon: number }} to
 * @param {{ now?: number, count?: number, lineName?: (code: string) => string | undefined }} [options]
 */
export async function planJourneys(from, to, { now = Date.now(), count = 5, lineName } = {}) {
  const payload = await getJson('/v6/plan', {
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    time: new Date(now).toISOString(),
    numItineraries: String(count),
    // The polylines and turn-by-turn steps are for a map: not asked, the
    // answer stays small.
    detailedLegs: 'false',
    detailedTransfers: 'false',
    language: 'fr',
  });
  return parsePlan(payload, lineName);
}
