// -----------------------------------------------------------------------------
// Device registry.
//
// Two device types: a line at a station (src/devices/stationLine.js) and a
// journey from the house (src/devices/trip.js, one per destination of the
// "trips" field, or created earlier and rebuilt from its params).
//
// The list of lines is not a static catalog: one device per line followed at a
// station, built from three sources merged by device identity:
//   1. the stations typed in the configuration ("THDVA@A");
//   2. the suggestions: the lines of the stations closest to the house
//      (src/devices/suggestions.js);
//   3. the devices the user already created, rebuilt from their own params:
//      a device keeps refreshing once it stops being suggested, or after its
//      entry left the configuration — a device is deleted in Gladys, not by
//      editing a text field.
//
// Nothing here is controllable: transit data is read-only.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import {
  findStation,
  findStationLine,
  getDirectory,
  loadDirectory,
  searchStations,
  stationLines,
} from '../api/directory.js';
import { fetchStationDepartures, upcoming, formatClock } from '../api/departures.js';
import { TbmApiError } from '../api/http.js';
import { createStationLineBlueprint, DEVICE_TYPE } from './stationLine.js';
import { createTripBlueprint, DEVICE_TYPE as TRIP_TYPE, TripError } from './trip.js';
import { TransitousError } from '../api/transitous.js';
import { tripSlug } from '../config.js';
import { getSuggestions, suggestedModes } from './suggestions.js';
import { publishDepartureEvents } from '../triggers.js';

const logger = createLogger({ name: 'devices' });

/** The value of a param of a device listed by the SDK. */
function paramValue(device, name) {
  const param = (device?.params ?? []).find((candidate) => candidate?.name === name);
  return param?.value === undefined || param?.value === null ? '' : String(param.value);
}

/**
 * The entries behind the devices the user created (their params).
 * @param {object} gladys
 */
export function createdEntries(gladys) {
  const entries = [];
  for (const device of gladys?.devices ?? []) {
    const station = paramValue(device, 'station');
    const line = paramValue(device, 'line');
    if (!station || !line) continue;
    const directions = paramValue(device, 'directions').split(',').filter(Boolean);
    entries.push({ station, line, directions });
  }
  return entries;
}

/**
 * The journeys behind the trip devices the user created (their params).
 * @param {object} gladys
 */
export function createdTrips(gladys) {
  const trips = [];
  for (const device of gladys?.devices ?? []) {
    const name = paramValue(device, 'trip_name');
    const address = paramValue(device, 'trip_address');
    if (!name || !address) continue;
    trips.push({ slug: tripSlug(name), name, address });
  }
  return trips;
}

/**
 * The entries of the "stations" field, resolved against the directory: a
 * station without line filter stands for every line calling there (the school
 * buses only when asked for), a filter keeps the lines it names. What could
 * not be resolved is returned too, for the connection status.
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 */
export function configuredEntries(config) {
  const dir = getDirectory();
  const entries = [];
  const unknown = [...config.watched.invalid];
  if (!dir) return { entries, unknown };
  for (const { station, lines } of config.watched.entries) {
    if (!findStation(dir, station)) {
      unknown.push(station);
      continue;
    }
    if (lines.length === 0) {
      for (const line of stationLines(dir, station, { modes: suggestedModes(config) })) {
        entries.push({ station, line: line.id });
      }
      continue;
    }
    for (const typed of lines) {
      const line = findStationLine(dir, station, typed);
      if (line) entries.push({ station, line: line.id });
      else unknown.push(`${station}@${typed}`);
    }
  }
  return { entries, unknown };
}

/**
 * Every blueprint: configuration, suggestions, created devices. A device the
 * user created keeps the directions of its params, whichever source lists it.
 * @param {object} gladys
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 */
export function buildBlueprints(gladys, config) {
  const created = createdEntries(gladys);
  const createdDirections = new Map(
    created.map((entry) => [`${entry.station}-${entry.line}`, entry.directions]),
  );
  const all = [...configuredEntries(config).entries, ...getSuggestions().entries, ...created];
  const seen = new Set();
  const blueprints = [];
  for (const entry of all) {
    const id = `${entry.station}-${entry.line}`;
    if (seen.has(id)) continue;
    seen.add(id);
    blueprints.push(
      createStationLineBlueprint({ ...entry, directions: createdDirections.get(id) ?? [] }),
    );
  }
  // The journeys of the configuration first: a destination edited there
  // replaces the address of the device created before.
  const trips = new Set();
  for (const trip of [...config.journeys.trips, ...createdTrips(gladys)]) {
    if (trips.has(trip.slug)) continue;
    trips.add(trip.slug);
    blueprints.push(createTripBlueprint(trip));
  }
  return blueprints;
}

/** The discovery payload. */
export function buildDiscoveredDevices(gladys, config) {
  return buildBlueprints(gladys, config).map((blueprint) => blueprint.buildDevice(gladys, config));
}

/** The blueprint owning a device, from its external_id. */
export function findBlueprintByDevice(gladys, device, config) {
  return buildBlueprints(gladys, config).find(
    (blueprint) => blueprint.deviceExternalId(gladys) === device?.external_id,
  );
}

/**
 * The name the user sees: the one of the created device (it may have been
 * renamed in Gladys), else the published one.
 */
export function deviceName(gladys, blueprint, config) {
  const externalId = blueprint.deviceExternalId(gladys);
  const created = (gladys.devices ?? []).find((device) => device.external_id === externalId);
  return created?.name || blueprint.buildDevice(gladys, config).name;
}

/**
 * Error raised when a widget or a scene action points at a device the
 * integration cannot read. It carries the explanation the widget displays.
 */
export class DeviceSelectionError extends Error {
  constructor(userMessage) {
    super(userMessage.en);
    this.name = 'DeviceSelectionError';
    this.userMessage = userMessage;
  }
}

/**
 * The blueprint behind the device a widget or a scene action was set up with.
 * @throws {DeviceSelectionError}
 */
export function findSelectedBlueprint(gladys, deviceExternalId, config, type = DEVICE_TYPE) {
  const choose =
    type === TRIP_TYPE
      ? {
          en: 'Choose a TBM journey in the settings.',
          fr: 'Choisissez un trajet TBM dans les réglages.',
        }
      : {
          en: 'Choose a TBM line in the settings.',
          fr: 'Choisissez une ligne TBM dans les réglages.',
        };
  if (typeof deviceExternalId !== 'string' || deviceExternalId.length === 0) {
    throw new DeviceSelectionError(choose);
  }
  const blueprint = findBlueprintByDevice(gladys, { external_id: deviceExternalId }, config);
  // A journey chosen in the departures widget, or the reverse: say which kind
  // of device the card expects.
  if (blueprint && blueprint.type !== type) throw new DeviceSelectionError(choose);
  if (!blueprint) {
    throw new DeviceSelectionError({
      en: 'This device is no longer known to the integration: add it again, or choose another one.',
      fr: 'Cet appareil n’est plus connu de l’intégration : ajoutez-le à nouveau, ou choisissez-en un autre.',
    });
  }
  return blueprint;
}

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 120 s interval does not slip to 180 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * The `onPoll` dispatcher: route the poll to the blueprint owning the device,
 * at the interval of the configuration (Gladys ticks once a minute), then
 * compare with the previous read for the scene trigger.
 */
export function createPoller() {
  const lastReads = new Map();
  return async function pollDevice(
    gladys,
    device,
    config,
    { now = Date.now(), force = false } = {},
  ) {
    const blueprint = findBlueprintByDevice(gladys, device, config);
    if (!blueprint) {
      logger.debug(`onPoll ignored, ${device.external_id} is not a known device`);
      return false;
    }
    // A journey publishes its countdown every minute; it plans again only
    // when its last plan is older than `trips_poll_frequency` (trip.js).
    if (blueprint.type === TRIP_TYPE) {
      await blueprint.onPoll(gladys, config, { now });
      return true;
    }
    const last = lastReads.get(blueprint.key);
    if (
      !force &&
      last !== undefined &&
      now - last < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    const departures = await blueprint.onPoll(gladys, config, { now });
    lastReads.set(blueprint.key, now);
    await publishDepartureEvents(gladys, blueprint, departures, config.language);
    return true;
  };
}

/** One station of a list, with its lines: "THDVA — Hôtel de Ville : Tram A". */
function describeStation(dir, station) {
  const lines = stationLines(dir, station.code)
    .filter((line) => line.mode !== 'service')
    .map((line) => line.name);
  return `${station.code} — ${station.name}${lines.length ? ` : ${lines.join(', ')}` : ''}`;
}

/**
 * The first journey of the configuration, planned now, for "Test the
 * connection": the line says whether Transitous answers and what it found.
 */
async function describeFirstTrip(gladys, config) {
  const [trip] = config.journeys.trips;
  if (!trip) return null;
  try {
    const { journeys, place } = await createTripBlueprint(trip).read(gladys, config, {
      fresh: true,
    });
    const [next] = journeys;
    if (!next) {
      return {
        en: `Journey "${trip.name}" (${place.name}): no journey found now.`,
        fr: `Trajet « ${trip.name} » (${place.name}) : aucun trajet trouvé pour l’instant.`,
      };
    }
    return {
      en: `Journey "${trip.name}" (${place.name}): leave at ${formatClock(next.start)}, arrive at ${formatClock(next.end)}.`,
      fr: `Trajet « ${trip.name} » (${place.name}) : départ ${formatClock(next.start)}, arrivée ${formatClock(next.end)}.`,
    };
  } catch (err) {
    if (err instanceof TripError || err instanceof TransitousError) {
      return {
        en: `Journey "${trip.name}": ${err.userMessage.en}`,
        fr: `Trajet « ${trip.name} » : ${err.userMessage.fr}`,
      };
    }
    throw err;
  }
}

/** Handlers of the manifest actions (the buttons of the Configuration screen). */
const RAW_ACTIONS = {
  /** Find a station by name, and show the codes to paste in "Stations". */
  async search_stations(_gladys, { fields }) {
    const query = String(fields?.query ?? '').trim();
    if (query.length < 2) {
      return { en: 'Type at least 2 characters.', fr: 'Saisissez au moins 2 caractères.' };
    }
    const dir = await loadDirectory();
    const results = searchStations(dir, query);
    if (results.length === 0) {
      return {
        en: `No TBM station matches "${query}". Try part of the name, e.g. "Quinconces".`,
        fr: `Aucune station TBM ne correspond à « ${query} ». Essayez une partie du nom, ex. « Quinconces ».`,
      };
    }
    const list = results.map((station) => describeStation(dir, station)).join('\n');
    return {
      en: `Paste a code in "Stations" — add @ and the line to keep only one, e.g. ${results[0].code}@${stationLines(dir, results[0].code)[0]?.code ?? 'A'}:\n${list}`,
      fr: `Collez un code dans « Stations » — ajoutez @ et la ligne pour n’en garder qu’une, ex. ${results[0].code}@${stationLines(dir, results[0].code)[0]?.code ?? 'A'} :\n${list}`,
    };
  },

  /** Read the directory and the departures of one station, now. */
  async test_connection(gladys, { config }) {
    const dir = await loadDirectory({ fresh: true });
    const stations = Object.keys(dir.stations).length;
    const lines = Object.keys(dir.lines).length;
    const blueprint = buildBlueprints(gladys, config)[0];
    const station = blueprint?.station ?? 'THDVA';
    const departures = upcoming(await fetchStationDepartures(station, { fresh: true }));
    const next = departures[0];
    const nextLine = next ? dir.lines[next.lineId] : null;
    const name = dir.stations[station]?.name ?? station;
    const sample = next
      ? {
          en: `${name}: ${nextLine?.name ?? next.lineId} to ${next.destination} at ${formatClock(next.time)}${next.realtime ? '' : ' (timetable)'}.`,
          fr: `${name} : ${nextLine?.name ?? next.lineId} vers ${next.destination} à ${formatClock(next.time)}${next.realtime ? '' : ' (horaire théorique)'}.`,
        }
      : {
          en: `${name}: no departure in the next hour.`,
          fr: `${name} : aucun passage dans l’heure.`,
        };
    const suggestions = getSuggestions();
    const near = {
      ok: {
        en: `Near ${suggestions.house ?? 'the house'}: ${new Set(suggestions.entries.map((e) => e.station)).size} station(s), ${suggestions.entries.length} line(s) in the Discovery tab.`,
        fr: `Près de ${suggestions.house ?? 'la maison'} : ${new Set(suggestions.entries.map((e) => e.station)).size} station(s), ${suggestions.entries.length} ligne(s) dans l’onglet Découverte.`,
      },
      no_location: {
        en: 'The house has no address in Gladys: set it in Settings → Houses to get the stations near it.',
        fr: 'La maison n’a pas d’adresse dans Gladys : renseignez-la dans Paramètres → Maisons pour avoir les stations proches.',
      },
      no_permission: {
        en: 'Gladys does not share the house location with the integration.',
        fr: 'Gladys ne partage pas la position de la maison avec l’intégration.',
      },
      disabled: {
        en: 'Stations near the house: turned off.',
        fr: 'Stations près de la maison : désactivé.',
      },
      no_directory: {
        en: 'Stations near the house: not looked up yet.',
        fr: 'Stations près de la maison : pas encore recherchées.',
      },
    }[suggestions.status];
    const journey = await describeFirstTrip(gladys, config);
    return {
      en: [`TBM API OK: ${stations} stations, ${lines} lines.`, sample.en, near.en, journey?.en]
        .filter(Boolean)
        .join('\n'),
      fr: [`API TBM OK : ${stations} stations, ${lines} lignes.`, sample.fr, near.fr, journey?.fr]
        .filter(Boolean)
        .join('\n'),
    };
  },
};

/**
 * The action handlers, with the API refusals turned into a message the user
 * can act on (a thrown error shows the raw text under the button).
 */
export const ACTIONS = Object.fromEntries(
  Object.entries(RAW_ACTIONS).map(([key, handler]) => [
    key,
    async (gladys, context) => {
      try {
        return await handler(gladys, context);
      } catch (err) {
        if (err instanceof TbmApiError) {
          logger.warn(`Action ${key} failed: ${err.message}`);
          return err.userMessage;
        }
        throw err;
      }
    },
  ]),
);

export { DEVICE_TYPE, TRIP_TYPE };
