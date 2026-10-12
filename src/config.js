// -----------------------------------------------------------------------------
// Integration configuration.
//
// The values come from the `config_schema` of the manifest, filled in by the
// user in Gladys. This module gives each one a default (the same as the
// manifest's: test/manifest.test.js checks it), forces its type — a form may
// send a number as a string, or an empty string — and parses the stations the
// user typed by hand.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // How many stations near the house are proposed in the Discovery tab, and
  // how far from it. 600 m is a seven or eight minutes walk.
  nearby_stations: 3,
  nearby_radius: 600,
  // The school buses (SCODI) call at many stations twice a day: proposing
  // them everywhere would hide the lines people take every day.
  include_school_lines: false,
  // Stations typed by hand: "THDVA", "THDVA@A", "BQUIOR@2|5".
  stations: '',
  // Seconds between two reads of a station. A countdown is only useful while
  // fresh; Gladys polls once a minute at most.
  poll_frequency: 60,
  // How many departures per direction the summary text lists.
  max_departures: 3,
  // Journeys from the house, one per line: "Travail : 1 place Pey Berland".
  trips: '',
  // Seconds between two updates of the real time of the journeys (Transitous
  // refresh-itinerary, almost free for it). A new plan, its expensive call,
  // is only made when the first journey of the last plan leaves (trip.js).
  trips_poll_frequency: 120,
  language: 'fr',
};

/** At most this many journeys: each one asks Transitous regularly. */
export const MAX_TRIPS = 5;

/** The bounds of the numeric settings, the same as the manifest's. */
const BOUNDS = {
  nearby_stations: [0, 8],
  nearby_radius: [100, 3000],
  poll_frequency: [60, 900],
  max_departures: [1, 5],
  trips_poll_frequency: [120, 1800],
};

function clampNumber(key, value) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  const [min, max] = BOUNDS[key];
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * One entry of the "stations" field: a station code, and optionally the
 * lines to keep after "@", separated by "|" or "+".
 *   "THDVA"        → every line of Hôtel de Ville (tram)
 *   "BQUIOR@2|5"   → Lianes 2 and 5 at Quinconces (bus)
 * @param {string} raw
 * @returns {{ station: string, lines: string[] } | null}
 */
export function parseStationEntry(raw) {
  const [stationPart, linesPart = ''] = String(raw ?? '').split('@');
  const station = stationPart.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(station)) return null;
  const lines = linesPart
    .split(/[|+]/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { station, lines };
}

/**
 * Every entry of the "stations" field (comma, semicolon or newline separated),
 * and the ones that could not be read, to tell the user.
 * @param {string} value
 */
export function parseStations(value) {
  const entries = [];
  const invalid = [];
  for (const raw of String(value ?? '').split(/[,;\n]/)) {
    if (!raw.trim()) continue;
    const entry = parseStationEntry(raw);
    if (entry) entries.push(entry);
    else invalid.push(raw.trim());
  }
  return { entries, invalid };
}

/**
 * The id of a journey, from its name: "Travail" → "travail", "École Léo" →
 * "ecole-leo". It is the platform id of the device: renaming the journey
 * makes a new device.
 * @param {string} name
 */
export function tripSlug(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The journeys typed in the "trips" field, one per line or separated by ";"
 * (an address holds commas): "Travail : 1 place Pey Berland, Bordeaux". The
 * name before ":" is optional; without it, the address names the journey.
 * @param {string} value
 * @returns {{ trips: { slug: string, name: string, address: string }[], invalid: string[] }}
 */
export function parseTrips(value) {
  const trips = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of String(value ?? '').split(/[;\n]/)) {
    const text = raw.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    const name = (colon > 0 ? text.slice(0, colon) : text).trim();
    const address = (colon > 0 ? text.slice(colon + 1) : text).trim();
    const slug = tripSlug(name);
    if (!address || address.length < 3 || !slug || seen.has(slug)) {
      invalid.push(text);
      continue;
    }
    if (trips.length >= MAX_TRIPS) {
      invalid.push(text);
      continue;
    }
    seen.add(slug);
    trips.push({ slug, name, address });
  }
  return { trips, invalid };
}

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  for (const key of Object.keys(BOUNDS)) {
    config[key] = clampNumber(key, raw[key]);
  }
  config.include_school_lines = raw.include_school_lines === true;
  config.stations = typeof raw.stations === 'string' ? raw.stations : '';
  config.trips = typeof raw.trips === 'string' ? raw.trips : '';
  config.journeys = parseTrips(config.trips);
  config.language = raw.language === 'en' ? 'en' : 'fr';
  config.watched = parseStations(config.stations);
  return config;
}
