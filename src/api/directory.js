// -----------------------------------------------------------------------------
// The directory of the network: stations and lines.
//
// Two SIRI-Lite discovery methods describe the network:
//   - stoppoints-discovery: every quay (~5,000), with its stop area, its name,
//     its position and the lines calling at it;
//   - lines-discovery: every line (~200), with its public code ("A", "5") and
//     the names of its two directions.
//
// The integration works with STATIONS, the stop areas: the place people name,
// both sides of the street together, which is also what the departures are
// read for (one request returns both directions). A quay without stop area or
// without any line is left out: the directory lists old stops and depots
// (DEPOT BACALAN) that no passenger can use.
//
// Both documents change a few times a year. They are read once a day at most,
// and kept in /data so that a restart, or the API being down at that moment,
// still finds the stations: a directory a few days old is far better than no
// directory at all.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { fetchJson, TbmApiError } from './http.js';
import { lineId, ref, siriUrl, stopCode, text } from './siri.js';

const logger = createLogger({ name: 'directory' });

// The only writable directory of the container (see the Dockerfile). Read at
// each use, so that the tests can point it elsewhere.
const dataDir = () => process.env.TBM_DATA_DIR || '/data';
const CACHE_FILE = 'directory.json';
const MAX_AGE_MS = 24 * 3600 * 1000;
// Bump when the cached shape changes: an older file is then ignored.
const CACHE_VERSION = 1;

/** The kinds of line, in the order a station lists them. */
export const LINE_MODES = ['tram', 'bus', 'boat', 'night', 'shuttle', 'school', 'service'];

/**
 * The kind of a line, from its public name. TBM gives no mode field: the names
 * are regular enough ("Tram A", "Lianes 5", "TBNight N1", "LE BATO 1",
 * "SCODI S10", "Navette Tram 104", "Bus Relais B", "Ligne 97 (HLP)").
 * @param {string} name
 * @returns {string} one of LINE_MODES
 */
export function lineMode(name) {
  const value = (name ?? '').trim();
  if (/^tram\s/i.test(value)) return 'tram';
  if (/^le\s+bato/i.test(value)) return 'boat';
  if (/^tbnight/i.test(value)) return 'night';
  if (/^scodi/i.test(value)) return 'school';
  // Replacement buses during works: real, but temporary and numerous.
  if (/^(navette\s+tram|bus\s+relais)/i.test(value)) return 'shuttle';
  // "HLP" (haut-le-pied): a vehicle running empty to or from the depot.
  if (/\(hlp\)/i.test(value)) return 'service';
  return 'bus';
}

/** Lowercase, no accent, no punctuation: what a search compares. */
export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Distance in meters between two points (haversine): good to a meter at the
 * scale of a city, which is all a "stations near my home" needs.
 */
export function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/**
 * The lines of the lines-discovery answer.
 * @param {unknown} payload
 * @returns {Record<string, { id: string, code: string, name: string, mode: string,
 *   directions: { id: string, name: string }[] }>}
 */
export function parseLines(payload) {
  const entries = payload?.Siri?.LinesDelivery?.AnnotatedLineRef;
  if (!Array.isArray(entries)) {
    throw new TbmApiError('lines-discovery: no AnnotatedLineRef list');
  }
  const lines = {};
  for (const entry of entries) {
    const id = lineId(ref(entry?.LineRef));
    if (!id) continue;
    const name = text(entry?.LineName) || `Ligne ${id}`;
    const directions = [];
    for (const destination of Array.isArray(entry?.Destinations) ? entry.Destinations : []) {
      const directionId = ref(destination?.DirectionRef);
      const directionName = text(destination?.PlaceName);
      if (directionId && !directions.some((direction) => direction.id === directionId)) {
        directions.push({ id: directionId, name: directionName });
      }
    }
    directions.sort((a, b) => a.id.localeCompare(b.id));
    lines[id] = { id, code: text(entry?.LineCode) || id, name, mode: lineMode(name), directions };
  }
  return lines;
}

/**
 * The stations of the stoppoints-discovery answer: quays grouped by stop area.
 * @param {unknown} payload
 * @returns {Record<string, { code: string, name: string, lat: number, lon: number,
 *   lines: string[], quays: string[] }>}
 */
export function parseStations(payload) {
  const entries = payload?.Siri?.StopPointsDelivery?.AnnotatedStopPointRef;
  if (!Array.isArray(entries)) {
    throw new TbmApiError('stoppoints-discovery: no AnnotatedStopPointRef list');
  }
  const groups = new Map();
  for (const entry of entries) {
    const area = stopCode(ref(entry?.StopAreaRef));
    const quay = stopCode(ref(entry?.StopPointRef));
    const lines = (Array.isArray(entry?.Lines) ? entry.Lines : [])
      .map((line) => lineId(ref(line)))
      .filter(Boolean);
    const lat = Number(entry?.Location?.latitude);
    const lon = Number(entry?.Location?.longitude);
    if (!area || !quay || lines.length === 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    if (!groups.has(area)) {
      groups.set(area, { code: area, names: [], lats: [], lons: [], lines: new Set(), quays: [] });
    }
    const group = groups.get(area);
    group.names.push(text(entry?.StopName));
    group.lats.push(lat);
    group.lons.push(lon);
    lines.forEach((line) => group.lines.add(line));
    group.quays.push(quay);
  }
  const stations = {};
  for (const group of groups.values()) {
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    stations[group.code] = {
      code: group.code,
      // The quays of an area share their name, but not always to the letter
      // ("Plein soleil" / "Plein Soleil"): the most frequent spelling wins.
      name: mostFrequent(group.names.filter(Boolean)) || group.code,
      lat: Number(mean(group.lats).toFixed(6)),
      lon: Number(mean(group.lons).toFixed(6)),
      lines: [...group.lines],
      quays: group.quays,
    };
  }
  return stations;
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The directory in memory: `null` until a first load succeeded.
 * @type {{ fetchedAt: number, stations: Record<string, object>, lines: Record<string, object> } | null}
 */
let directory = null;

/** The directory currently known, or null (never throws, never waits). */
export function getDirectory() {
  return directory;
}

/** Replace the directory (tests). */
export function setDirectory(value) {
  directory = value;
}

async function readCache() {
  try {
    const cached = JSON.parse(await readFile(join(dataDir(), CACHE_FILE), 'utf8'));
    if (cached?.version !== CACHE_VERSION || !cached.stations || !cached.lines) return null;
    return { fetchedAt: cached.fetchedAt, stations: cached.stations, lines: cached.lines };
  } catch {
    return null;
  }
}

async function writeCache(value) {
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(
      join(dataDir(), CACHE_FILE),
      JSON.stringify({ version: CACHE_VERSION, ...value }),
      'utf8',
    );
  } catch (err) {
    // Only a cache: the directory in memory is still good.
    logger.warn(`The directory could not be saved in ${dataDir()}: ${err.message}`);
  }
}

/**
 * Make sure a directory is known, reading the API when the one in memory (or
 * on disk) is older than a day, or when `fresh` is asked.
 *
 * A failed read keeps the directory already known, however old: only the very
 * first start without any network has nothing, and throws.
 *
 * @param {{ fresh?: boolean, now?: number }} [options]
 * @returns {Promise<NonNullable<typeof directory>>}
 */
export async function loadDirectory({ fresh = false, now = Date.now() } = {}) {
  if (!directory) {
    directory = await readCache();
  }
  if (!fresh && directory && now - directory.fetchedAt < MAX_AGE_MS) {
    return directory;
  }
  try {
    const [stopsPayload, linesPayload] = await Promise.all([
      fetchJson(siriUrl('stoppoints-discovery')),
      fetchJson(siriUrl('lines-discovery')),
    ]);
    const next = {
      fetchedAt: now,
      stations: parseStations(stopsPayload),
      lines: parseLines(linesPayload),
    };
    if (Object.keys(next.stations).length === 0 || Object.keys(next.lines).length === 0) {
      throw new TbmApiError('The TBM directory came back empty');
    }
    directory = next;
    await writeCache(next);
    logger.info(
      `Directory read: ${Object.keys(next.stations).length} stations, ` +
        `${Object.keys(next.lines).length} lines`,
    );
  } catch (err) {
    if (!directory) throw err;
    logger.warn(`The directory could not be refreshed, the previous one is kept: ${err.message}`);
  }
  return directory;
}

/** Order of the lines of a station: trams first, then buses by number. */
export function compareLines(a, b) {
  const byMode = LINE_MODES.indexOf(a.mode) - LINE_MODES.indexOf(b.mode);
  if (byMode !== 0) return byMode;
  const numberA = Number.parseInt(a.code, 10);
  const numberB = Number.parseInt(b.code, 10);
  if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) {
    return numberA - numberB;
  }
  return a.code.localeCompare(b.code, 'fr', { numeric: true });
}

/**
 * The lines calling at a station, ordered, with their directory entry.
 * @param {object} dir the directory
 * @param {string} stationCode
 * @param {{ modes?: string[] }} [options] keep only these modes
 */
export function stationLines(dir, stationCode, { modes } = {}) {
  const station = dir?.stations?.[stationCode];
  if (!station) return [];
  return station.lines
    .map((id) => dir.lines[id])
    .filter(Boolean)
    .filter((line) => !modes || modes.includes(line.mode))
    .sort(compareLines);
}

/**
 * The line of a station a user typed: its public code ("A", "5", "n1"), or
 * its id ("59"). The code wins, since it is what is written on the vehicle.
 * @param {object} dir
 * @param {string} stationCode
 * @param {string} typed
 */
export function findStationLine(dir, stationCode, typed) {
  const wanted = normalize(typed);
  const lines = stationLines(dir, stationCode);
  return (
    lines.find((line) => normalize(line.code) === wanted) ??
    lines.find((line) => line.id === typed.trim()) ??
    null
  );
}

/**
 * The station of a code the user typed, case-insensitive.
 * @param {object} dir
 * @param {string} typed
 */
export function findStation(dir, typed) {
  const code = String(typed ?? '')
    .trim()
    .toUpperCase();
  return dir?.stations?.[code] ?? null;
}

/**
 * The stations whose name holds every word typed, best matches first.
 * @param {object} dir
 * @param {string} query
 * @param {number} [limit]
 */
export function searchStations(dir, query, limit = 10) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0 || !dir) return [];
  const exact = findStation(dir, query);
  const matches = Object.values(dir.stations).filter((station) => {
    const name = normalize(station.name);
    return words.every((word) => name.includes(word));
  });
  const wanted = words.join(' ');
  matches.sort((a, b) => {
    const rank = (station) => {
      const name = normalize(station.name);
      if (name === wanted) return 0;
      if (name.startsWith(wanted)) return 1;
      return 2;
    };
    return rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr') || a.code.localeCompare(b.code);
  });
  const results = exact ? [exact, ...matches.filter((station) => station !== exact)] : matches;
  return results.slice(0, limit);
}

/**
 * The stations within `radius` meters of a point, closest first.
 * @param {object} dir
 * @param {{ lat: number, lon: number }} point
 * @param {number} radius
 */
export function stationsNear(dir, point, radius) {
  if (!dir) return [];
  return Object.values(dir.stations)
    .map((station) => ({ station, distance: distanceMeters(point, station) }))
    .filter((entry) => entry.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}
