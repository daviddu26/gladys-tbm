// The whole integration against the fake Gladys of the SDK: connection,
// suggestions, publication, creation, poll, buttons, widget, scene action.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { clearDeparturesCache } from '../src/api/departures.js';
import { setDirectory } from '../src/api/directory.js';
import { clearSuggestions } from '../src/devices/suggestions.js';
import { clearTriggerMemory } from '../src/triggers.js';
import { CITY_HALL_HOUSE } from './helpers/directory.js';
import { NOW } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(async () => {
  // Every test starts as a first install: nothing in memory, nothing on disk.
  await rm(join(process.env.TBM_DATA_DIR, 'directory.json'), { force: true });
  setDirectory(null);
  clearSuggestions();
  clearDeparturesCache();
  clearTriggerMemory();
});

async function start(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const fetches = stubFetch(t, options.routes);
  const gladys = createFakeGladys({
    houses: [CITY_HALL_HOUSE],
    config: { nearby_stations: 1 },
    ...options.gladys,
  });
  const app = registerHandlers(gladys);
  t.after(() => app.stop());
  await gladys.connect();
  return { gladys, fetches };
}

test('on connection: the lines near the house are proposed, the status is green', async (t) => {
  const { gladys } = await start(t);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['TBM – Hôtel de Ville – Tram A', 'TBM – Hôtel de Ville – Tram F'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a created device is read at once, then polled', async (t) => {
  const { gladys } = await start(t);
  const [tramA] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated({ ...tramA, name: tramA.name });
  assert.equal(gladys.fake.lastState(`${tramA.external_id}:d1_destination`), 'La Gardette');
  assert.deepEqual(await gladys.fake.poll(tramA), { success: true });
});

test('the buttons, the widget and the scene action answer', async (t) => {
  const { gladys } = await start(t);
  const [tramA] = gladys.fake.discoveredDevices;

  const search = await gladys.fake.action('search_stations', { query: 'justice' });
  assert.equal(search.success, true);
  assert.match(search.data.message.fr, /TPJUST — Palais de Justice : Tram A, Tram F/);

  const widget = await gladys.fake.widgetGet('departures', {
    settings: { device: tramA.external_id },
    language: 'fr',
  });
  assert.equal(widget.success, true);
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
  assert.equal(widget.data.content.components[0].text, 'Hôtel de Ville · Tram A');

  const action = await gladys.fake.sceneAction('get_next_departures', {
    device: tramA.external_id,
  });
  assert.equal(action.success, true);
  assert.equal(action.data.outputs.destination, 'La Gardette');
});

test('a station typed by hand is published; a wrong code is reported', async (t) => {
  const { gladys } = await start(t, {
    gladys: { config: { nearby_stations: 0, stations: 'BQUIOR@2, NOPE' } },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['TBM – Quinconces – Lianes 2'],
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /Introuvable.*NOPE/);

  await gladys.fake.configUpdated({ nearby_stations: 0, stations: 'BQUIOR@2' });
  assert.equal(gladys.fake.connectionStatus.message, undefined);
});

test('an unlocated house is reported', async (t) => {
  const { gladys } = await start(t, {
    gladys: { houses: [{ ...CITY_HALL_HOUSE, latitude: null, longitude: null }] },
  });
  assert.match(gladys.fake.connectionStatus.message.fr, /adresse à votre maison/);
});

test('without the directory, the status says the TBM service does not answer', async (t) => {
  const { gladys } = await start(t, {
    routes: { 'stoppoints-discovery': { status: 503 } },
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /ne répond pas/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});
