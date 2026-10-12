import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { clearDeparturesCache } from '../src/api/departures.js';
import { createPoller } from '../src/devices/index.js';
import { clearSuggestions } from '../src/devices/suggestions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import {
  clearTriggerMemory,
  departureCrossings,
  departureSentence,
  DEPARTURE_APPROACHING,
} from '../src/triggers.js';
import { useFixtureDirectory } from './helpers/directory.js';
import { NOW, stopMonitoringPayload, visit } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(() => {
  useFixtureDirectory();
  clearSuggestions();
  clearDeparturesCache();
  clearTriggerMemory();
});

test('a vehicle crossing marks fires each of them, once, by journey', () => {
  const previous = [
    { journey: 'a', minutes: 11 },
    { journey: 'b', minutes: 3 },
  ];
  const current = [
    { journey: 'a', minutes: 4 },
    { journey: 'b', minutes: 3 },
    { journey: 'c', minutes: 1 },
  ];
  assert.deepEqual(
    departureCrossings(previous, current).map((c) => [c.departure.journey, c.threshold]),
    [
      ['a', 5],
      ['a', 10],
    ],
  );
  // A vehicle that just appeared is not approaching; one without id is not followed.
  assert.deepEqual(departureCrossings([{ minutes: 9 }], [{ minutes: 2 }]), []);
});

test('the sentence a scene can send as is', () => {
  const info = { stationName: 'Hôtel de Ville', lineName: 'Tram A' };
  const departure = {
    destination: 'La Gardette',
    minutes: 5,
    time: NOW + 300_000,
    delayMinutes: 2,
  };
  assert.equal(
    departureSentence(info, departure),
    'Hôtel de Ville : Tram A vers La Gardette passe dans 5 min (17:58, dont 2 minutes de retard).',
  );
  assert.equal(
    departureSentence(info, { ...departure, minutes: 0, delayMinutes: null }, 'en'),
    'Hôtel de Ville: Tram A to La Gardette is at the stop (17:58).',
  );
});

test('the poll fires "departure approaching" between two reads', async (t) => {
  // Read 1: the tram to La Gardette is 11 min away; read 2: 4 min.
  let offset = 660;
  stubFetch(t, {
    'stop-monitoring': () =>
      stopMonitoringPayload([
        visit({
          line: '59',
          direction: '1',
          directionName: 'Cenon Gare / La Gardette / Thiers Benauge',
          quay: '3719',
          destination: 'La Gardette',
          journey: 'A-1',
          aimed: offset - 60,
          expected: offset,
        }),
      ]),
  });
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const poll = createPoller();
  const device = { external_id: gladys.externalIds('station-line', 'THDVA-59').device };

  await poll(gladys, device, config, { now: NOW });
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first read');

  offset = 240 + 60; // read 2 happens a minute later: 4 min left
  await poll(gladys, device, config, { now: NOW + 60_000 });
  const events = gladys.fake.sceneEvents;
  assert.deepEqual(
    events.map((event) => [event.key, event.data.threshold]),
    [
      [DEPARTURE_APPROACHING, '5'],
      [DEPARTURE_APPROACHING, '10'],
    ],
  );
  assert.deepEqual(events[0].data, {
    device: device.external_id,
    direction: '1',
    threshold: '5',
    stop_name: 'Hôtel de Ville',
    line: 'A',
    direction_rank: 2,
    destination: 'La Gardette',
    minutes: 4,
    delay: 1,
    realtime: true,
    time: '17:58',
    summary:
      'Hôtel de Ville : Tram A vers La Gardette passe dans 4 min (17:58, dont 1 minutes de retard).',
  });
});

test('the scene action returns the next departure, one direction or both', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t);
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const device = gladys.externalIds('station-line', 'THDVA-59').device;

  const both = await SCENE_ACTIONS.get_next_departures(gladys, { fields: { device }, config });
  assert.deepEqual(both, {
    found: true,
    minutes: 1,
    following_minutes: 2,
    line: 'A',
    destination: 'La Gardette',
    direction_rank: 2,
    time: '17:54',
    delay: 1,
    realtime: true,
    summary:
      'Hôtel de Ville : Tram A vers La Gardette passe dans 1 min (17:54, dont 1 minutes de retard).',
  });

  const towardsPellegrin = await SCENE_ACTIONS.get_next_departures(gladys, {
    fields: { device, direction: '0' },
    config,
  });
  assert.equal(towardsPellegrin.destination, 'Le Haillan Rostand');
  assert.equal(towardsPellegrin.delay, 7);
  assert.equal(towardsPellegrin.following_minutes, 9);
});

test('the scene action says when nothing comes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t, { 'stop-monitoring': () => stopMonitoringPayload([]) });
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const result = await SCENE_ACTIONS.get_next_departures(gladys, {
    fields: { device: gladys.externalIds('station-line', 'THDVA-59').device },
    config,
  });
  assert.equal(result.found, false);
  assert.equal(result.minutes, -1);
  assert.equal(result.summary, 'Hôtel de Ville : aucun passage du Tram A dans l’heure.');
});
