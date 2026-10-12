import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { clearDeparturesCache } from '../src/api/departures.js';
import { setDirectory } from '../src/api/directory.js';
import {
  ACTIONS,
  buildBlueprints,
  buildDiscoveredDevices,
  configuredEntries,
  createdEntries,
  createPoller,
  findSelectedBlueprint,
} from '../src/devices/index.js';
import {
  createStationLineBlueprint,
  directionLabel,
  formatSummary,
  formatWait,
  NO_DEPARTURE_MINUTES,
} from '../src/devices/stationLine.js';
import { clearSuggestions, refreshSuggestions } from '../src/devices/suggestions.js';
import { clearTriggerMemory } from '../src/triggers.js';
import { CITY_HALL_HOUSE, useFixtureDirectory } from './helpers/directory.js';
import { NOW } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(() => {
  useFixtureDirectory();
  clearSuggestions();
  clearDeparturesCache();
  clearTriggerMemory();
});

const ext = (gladys, station, line) =>
  gladys.externalIds('station-line', `${station}-${line}`).device;

test('a line at a station: one set of features per direction, named after it', async () => {
  const gladys = createFakeGladys();
  const config = normalizeConfig();
  const device = createStationLineBlueprint({ station: 'THDVA', line: '59' }).buildDevice(
    gladys,
    config,
  );
  assert.equal(device.name, 'TBM – Hôtel de Ville – Tram A');
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, 60000);
  assert.deepEqual(device.params, [
    { name: 'station', value: 'THDVA' },
    { name: 'line', value: '59' },
    { name: 'directions', value: '0,1' },
  ]);
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    [
      'd0_next',
      'd0_destination',
      'd0_following',
      'd0_summary',
      'd1_next',
      'd1_destination',
      'd1_following',
      'd1_summary',
    ],
  );
  assert.equal(
    device.features[0].name,
    'Sens 1 → Hôpital Pellegrin / Le Haillan Rostand · prochain passage',
  );
  assert.ok(device.features.every((feature) => feature.keep_history === false));
  // The core refuses a feature without range, text ones included.
  assert.ok(device.features.every((feature) => Number.isFinite(feature.min)));

  // Gladys accepts it as is.
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('a one-way line has one direction; English names on demand', () => {
  const gladys = createFakeGladys();
  const device = createStationLineBlueprint({ station: 'BQUIOR', line: '506' }).buildDevice(
    gladys,
    normalizeConfig({ language: 'en' }),
  );
  assert.equal(device.features.length, 4);
  assert.equal(device.features[0].name, 'Direction 1 → Galin Terminus · next departure');
});

test('without the directory, a created device keeps its directions and still builds', () => {
  setDirectory(null);
  const gladys = createFakeGladys();
  const device = createStationLineBlueprint({
    station: 'THDVA',
    line: '59',
    directions: ['1'],
  }).buildDevice(gladys, normalizeConfig());
  assert.equal(device.name, 'TBM – THDVA – Ligne 59');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    ['d1_next', 'd1_destination', 'd1_following', 'd1_summary'],
  );
});

test('the texts of a direction', () => {
  assert.equal(directionLabel('0', '', 'fr'), 'Sens 1');
  assert.equal(directionLabel('1', 'Cenon Gare', 'en'), 'Direction 2 → Cenon Gare');
  assert.equal(formatWait({ minutes: 3, realtime: true, delayMinutes: 0 }), '3 min');
  assert.equal(formatWait({ minutes: 11, realtime: false, delayMinutes: null }), '~11 min');
  assert.equal(formatWait({ minutes: 2, realtime: true, delayMinutes: 7 }), '2 min (+7)');
  assert.equal(formatWait({ minutes: 0, realtime: true, delayMinutes: 1 }), 'à l’arrêt');
  assert.equal(formatWait({ minutes: 0, realtime: true, delayMinutes: 0 }, 'en'), 'now');
  assert.equal(formatSummary([], 3), 'Aucun passage à venir');
  assert.equal(
    formatSummary(
      [
        { destination: 'La Gardette', minutes: 1, realtime: true, delayMinutes: 1 },
        { destination: 'Cenon Gare', minutes: 3, realtime: false, delayMinutes: null },
        { destination: 'La Gardette', minutes: 9, realtime: true, delayMinutes: 0 },
      ],
      2,
    ),
    'La Gardette 1 min · Cenon Gare ~3 min',
  );
});

test('the stations typed by hand: every line, or the ones after @', () => {
  const config = normalizeConfig({ stations: 'THDVA, BQUIOR@2, TPJUST@B, NOPE, BSCOL' });
  const { entries, unknown } = configuredEntries(config);
  assert.deepEqual(entries, [
    { station: 'THDVA', line: '59' },
    { station: 'THDVA', line: '164' },
    { station: 'BQUIOR', line: '02' },
    // BSCOL only has a school line: left out unless asked for.
  ]);
  assert.deepEqual(unknown, ['TPJUST@B', 'NOPE']);
  const withSchool = configuredEntries(
    normalizeConfig({ stations: 'BSCOL', include_school_lines: true }),
  );
  assert.deepEqual(withSchool.entries, [{ station: 'BSCOL', line: '810' }]);
});

test('the devices near the house are proposed, every line of each station', async () => {
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const config = normalizeConfig({ nearby_stations: 2 });
  const suggestions = await refreshSuggestions(gladys, config);
  assert.equal(suggestions.status, 'ok');
  assert.equal(suggestions.house, 'Maison');
  // Hôtel de Ville then Palais de Justice; the school-only station is skipped.
  assert.deepEqual(
    suggestions.entries.map((entry) => `${entry.station}-${entry.line}`),
    ['THDVA-59', 'THDVA-164', 'TPJUST-59', 'TPJUST-164'],
  );
  const devices = buildDiscoveredDevices(gladys, config);
  assert.deepEqual(
    devices.map((device) => device.name),
    [
      'TBM – Hôtel de Ville – Tram A',
      'TBM – Hôtel de Ville – Tram F',
      'TBM – Palais de Justice – Tram A',
      'TBM – Palais de Justice – Tram F',
    ],
  );
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 4);
});

test('the suggestion explains why it has nothing', async () => {
  const config = normalizeConfig();
  const unlocated = createFakeGladys({
    houses: [{ ...CITY_HALL_HOUSE, latitude: null, longitude: null }],
  });
  assert.equal((await refreshSuggestions(unlocated, config)).status, 'no_location');
  const refused = createFakeGladys();
  refused.getHouses = async () => {
    throw new Error('403');
  };
  assert.equal((await refreshSuggestions(refused, config)).status, 'no_permission');
  const off = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  assert.equal(
    (await refreshSuggestions(off, normalizeConfig({ nearby_stations: 0 }))).status,
    'disabled',
  );
  setDirectory(null);
  assert.equal(
    (await refreshSuggestions(createFakeGladys({ houses: [CITY_HALL_HOUSE] }), config)).status,
    'no_directory',
  );
});

test('a created device is rebuilt from its params, whatever the configuration says', async () => {
  const created = {
    name: 'Mon tram',
    external_id: 'ext:test-integration:station-line:TPJUST-59',
    params: [
      { name: 'station', value: 'TPJUST' },
      { name: 'line', value: '59' },
      { name: 'directions', value: '1' },
    ],
    features: [],
  };
  const gladys = createFakeGladys({ devices: [created] });
  await gladys.connect();
  assert.deepEqual(createdEntries(gladys), [{ station: 'TPJUST', line: '59', directions: ['1'] }]);
  const blueprints = buildBlueprints(gladys, normalizeConfig({ stations: 'TPJUST@A' }));
  assert.equal(blueprints.length, 1);
  // The directions of the created device win over the directory.
  assert.deepEqual(blueprints[0].describe().directions, ['1']);
  assert.equal(
    findSelectedBlueprint(gladys, created.external_id, normalizeConfig()).key,
    'station-line:TPJUST-59',
  );
  assert.throws(() => findSelectedBlueprint(gladys, '', normalizeConfig()), {
    name: 'DeviceSelectionError',
  });
  assert.throws(() => findSelectedBlueprint(gladys, 'ext:test-integration:x', normalizeConfig()), {
    name: 'DeviceSelectionError',
  });
});

test('a poll publishes both directions, then only what moved', async (t) => {
  const { calls } = stubFetch(t);
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const poll = createPoller();
  const id = ext(gladys, 'THDVA', '59');

  assert.equal(await poll(gladys, { external_id: id }, config, { now: NOW }), true);
  const state = (key) => gladys.fake.lastState(`${id}:${key}`);
  assert.equal(state('d0_next'), 2);
  assert.equal(state('d0_destination'), 'Le Haillan Rostand');
  assert.equal(state('d0_following'), 9);
  assert.equal(state('d0_summary'), 'Le Haillan Rostand 2 min (+7) · Hôpital Pellegrin 9 min');
  assert.equal(state('d1_next'), 1);
  assert.equal(state('d1_destination'), 'La Gardette');
  assert.equal(state('d1_following'), 3);
  assert.equal(state('d1_summary'), 'La Gardette 1 min · Cenon Gare ~3 min');
  const published = gladys.fake.states.length;
  assert.equal(published, 8);

  // Within the configured interval: skipped, no request.
  assert.equal(await poll(gladys, { external_id: id }, config, { now: NOW + 20_000 }), false);
  assert.equal(calls.length, 1);

  // A minute later, the same answer: only the countdowns that moved are sent.
  assert.equal(await poll(gladys, { external_id: id }, config, { now: NOW + 60_000 }), true);
  assert.equal(state('d0_next'), 1);
  assert.equal(state('d1_next'), 0);
  assert.ok(gladys.fake.states.length - published < 8);

  // A device the integration does not know is ignored.
  assert.equal(await poll(gladys, { external_id: 'ext:test-integration:x' }, config), false);
});

test('no departure: the countdown says 999, the texts say so', async (t) => {
  stubFetch(t, {
    'stop-monitoring': () => ({
      Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ Status: true }] } },
    }),
  });
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const id = ext(gladys, 'THDVA', '59');
  await createPoller()(gladys, { external_id: id }, config, { now: NOW });
  assert.equal(gladys.fake.lastState(`${id}:d0_next`), NO_DEPARTURE_MINUTES);
  assert.equal(gladys.fake.lastState(`${id}:d0_destination`), '—');
  assert.equal(gladys.fake.lastState(`${id}:d1_summary`), 'Aucun passage à venir');
});

test('"Find a station" lists the codes to paste', async () => {
  const gladys = createFakeGladys();
  const message = await ACTIONS.search_stations(gladys, {
    fields: { query: 'quinconces' },
    config: normalizeConfig(),
  });
  assert.match(message.fr, /BMUNIC — Quinconces : Lianes 2, TBNight N8/);
  assert.match(message.fr, /BQUIOR — Quinconces : Lianes 2, TBNight N6/);
  assert.match(message.fr, /ex\. BMUNIC@2/);
  const none = await ACTIONS.search_stations(gladys, { fields: { query: 'zzz' } });
  assert.match(none.fr, /Aucune station/);
  const short = await ACTIONS.search_stations(gladys, { fields: { query: 'q' } });
  assert.match(short.fr, /au moins 2/);
});

test('"Test the connection" reads the API and says what was found', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t);
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const config = normalizeConfig({ nearby_stations: 1 });
  await refreshSuggestions(gladys, config);
  const message = await ACTIONS.test_connection(gladys, { config });
  assert.match(message.fr, /API TBM OK : 5 stations, 8 lignes\./);
  assert.match(message.fr, /Hôtel de Ville : Tram A vers/);
  assert.match(message.fr, /1 station\(s\), 2 ligne\(s\)/);
});

test('an API outage is a message under the button, not an error', async (t) => {
  stubFetch(t, {
    'stoppoints-discovery': { status: 503 },
    'stop-monitoring': { status: 503 },
  });
  const message = await ACTIONS.test_connection(createFakeGladys(), {
    config: normalizeConfig(),
  });
  assert.match(message.fr, /ne répond pas/);
});
