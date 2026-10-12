import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseTrips, tripSlug } from '../src/config.js';
import { connectionStatus } from '../src/app.js';
import { formatClock } from '../src/api/departures.js';
import {
  clearPlaces,
  distanceMeters,
  geocode,
  legLineName,
  parsePlan,
  refreshJourney,
} from '../src/api/transitous.js';
import {
  buildBlueprints,
  createPoller,
  DeviceSelectionError,
  findSelectedBlueprint,
  TRIP_TYPE,
} from '../src/devices/index.js';
import {
  clearPlans,
  createTripBlueprint,
  formatOptions,
  formatRoute,
  formatStatus,
  TripError,
} from '../src/devices/trip.js';
import { journeyContent, JOURNEY_WIDGET, WIDGETS } from '../src/widgets.js';
import { CITY_HALL_HOUSE, useFixtureDirectory } from './helpers/directory.js';
import { NOW } from './helpers/fixtures.js';
import { planPayload, refreshPayload } from './helpers/transitous.js';
import { stubFetch } from './helpers/stubFetch.js';

const PLACES = () => join(process.env.TBM_DATA_DIR, 'places.json');

beforeEach(async () => {
  useFixtureDirectory();
  clearPlans();
  clearPlaces();
  await rm(PLACES(), { force: true });
});

const HOME = { lat: CITY_HALL_HOUSE.latitude, lon: CITY_HALL_HOUSE.longitude };
const lineName = (code) => ({ A: 'Tram A', F: 'Tram F', 2: 'Lianes 2' })[code];
const GARE = { slug: 'gare', name: 'Gare', address: 'Gare Saint-Jean' };
const config = (raw = {}) => normalizeConfig({ trips: 'Gare : Gare Saint-Jean', ...raw });
const clock = (minutes) => formatClock(NOW + minutes * 60_000);

test('the journeys field: "Name: address", separated by semicolons, five at most', () => {
  const { trips, invalid } = parseTrips(
    'Travail : 1 place Pey Berland, Bordeaux ; Gare Saint-Jean\nÉcole Léo: Cours Victor Hugo; :x; ab',
  );
  assert.deepEqual(trips, [
    { slug: 'travail', name: 'Travail', address: '1 place Pey Berland, Bordeaux' },
    { slug: 'gare-saint-jean', name: 'Gare Saint-Jean', address: 'Gare Saint-Jean' },
    { slug: 'ecole-leo', name: 'École Léo', address: 'Cours Victor Hugo' },
  ]);
  assert.deepEqual(invalid, [':x', 'ab']);
  const six = parseTrips('a1;b2;c3;d4;e5;f6'.replace(/(\w)(\d)/g, '$1$2 : rue $2'));
  assert.equal(six.trips.length, 5);
  assert.equal(six.invalid.length, 1);
  assert.equal(tripSlug('  Trajet du Matin !'), 'trajet-du-matin');
});

test('the journeys update: 2 minutes by default and at the fastest', () => {
  assert.equal(normalizeConfig({}).trips_poll_frequency, 120);
  assert.equal(normalizeConfig({ trips_poll_frequency: 30 }).trips_poll_frequency, 120);
  assert.equal(normalizeConfig({ trips_poll_frequency: '600' }).trips_poll_frequency, 600);
});

test('a plan answer becomes journeys: lines named as people say them, soonest first', () => {
  const journeys = parsePlan(planPayload(), lineName);
  assert.deepEqual(
    journeys.map((journey) => journey.id),
    ['it-0', 'it-1', 'it-2', 'it-3'],
  );
  const [, tramAF, lianes, cancelled] = journeys;
  assert.deepEqual(
    tramAF.legs.map((leg) => [leg.line, leg.from, leg.to, leg.headsign]),
    [
      ['Tram A', 'Hôtel de Ville', 'Porte de Bourgogne', 'La Gardette'],
      ['Tram F', 'Porte de Bourgogne', 'Gare Saint-Jean', 'Gare de Bègles'],
    ],
  );
  assert.equal(tramAF.durationMinutes, 21);
  assert.equal(tramAF.transfers, 1);
  assert.equal(tramAF.delayMinutes, 1);
  assert.equal(tramAF.realtime, true);
  // Route "02" is the Lianes 2 of the TBM directory.
  assert.equal(lianes.legs[0].line, 'Lianes 2');
  assert.equal(lianes.realtime, false);
  assert.deepEqual(lianes.alerts, ['Arrêt Quinconces déplacé']);
  assert.equal(cancelled.cancelled, true);
  assert.throws(() => parsePlan({}), { name: 'TransitousError' });
});

test('the journeys are ranked by arrival, not by departure', () => {
  const payload = planPayload();
  // Leaves first (in 1 minute) but arrives last: a slow bus.
  payload.itineraries.push({
    id: 'slow',
    duration: 59 * 60,
    startTime: new Date(NOW + 60_000).toISOString(),
    endTime: new Date(NOW + 60 * 60_000).toISOString(),
    transfers: 0,
    legs: [],
  });
  // Arrives with it-1 (in 25 minutes) but leaves later: less waiting, first.
  payload.itineraries.push({
    id: 'same-arrival-later',
    duration: 15 * 60,
    startTime: new Date(NOW + 10 * 60_000).toISOString(),
    endTime: new Date(NOW + 25 * 60_000).toISOString(),
    transfers: 0,
    legs: [],
  });
  assert.deepEqual(
    parsePlan(payload, lineName).map((journey) => journey.id),
    ['it-0', 'same-arrival-later', 'it-1', 'it-2', 'it-3', 'slow'],
  );
});

test('a line unknown to TBM is named by its mode', () => {
  // A train is "TER": its route name is a train number (seen live: "TER 866266").
  assert.equal(legLineName({ mode: 'REGIONAL_RAIL', routeShortName: 'K32' }), 'TER');
  assert.equal(legLineName({ mode: 'REGIONAL_RAIL', displayName: 'TER 866266' }), 'TER');
  // The mode is not repeated when the route already says it.
  assert.equal(legLineName({ mode: 'COACH', routeShortName: 'Car 406' }), 'Car 406');
  assert.equal(legLineName({ mode: 'BUS', routeShortName: '', displayName: '83' }), 'Bus 83');
  assert.equal(legLineName({ mode: 'TRAM', routeShortName: 'A' }, lineName), 'Tram A');
});

test('an address is geocoded near the house, once, and kept in /data', async (t) => {
  const { calls } = stubFetch(t);
  const place = await geocode('Gare Saint-Jean', HOME);
  assert.deepEqual(place, { name: 'Gare Saint-Jean', lat: 44.8258, lon: -0.5563 });
  const asked = calls[0];
  assert.equal(asked.pathname, '/api/v1/geocode');
  assert.equal(asked.searchParams.get('place'), `${HOME.lat},${HOME.lon}`);
  // Again, even after a restart (memory cleared): read from /data.
  clearPlaces();
  assert.deepEqual(await geocode('  gare   SAINT-JEAN ', HOME), place);
  assert.equal(calls.length, 1);
  const saved = JSON.parse(await readFile(PLACES(), 'utf8'));
  assert.deepEqual(saved['gare saint-jean'], place);
});

test('a namesake far from the house is not the place meant', async (t) => {
  stubFetch(t, {
    geocode: () => [
      { type: 'PLACE', name: 'Victoire', lat: 48.85, lon: 2.35, tokens: [], areas: [], score: 1 },
    ],
  });
  assert.equal(await geocode('Victoire', HOME), null);
  assert.ok(distanceMeters(HOME, { lat: 48.85, lon: 2.35 }) > 400_000);
});

const paths = (calls, path) => calls.filter((url) => url.pathname === path);
const PLAN = '/api/v6/plan';
const REFRESH = '/api/v6/refresh-itinerary';

test('a journey is planned once, refreshed until its first departure, then planned again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { calls } = stubFetch(t);
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const trip = createTripBlueprint(GARE);
  const cfg = config({ trips_poll_frequency: 120 });
  const first = await trip.read(gladys, cfg, { now: NOW });
  // The journey that left two minutes ago is gone; the next leaves in 4.
  assert.deepEqual(
    first.journeys.map((journey) => [journey.id, journey.leaveMinutes]),
    [
      ['it-1', 4],
      ['it-2', 11],
      ['it-3', 19],
    ],
  );
  const [plan] = paths(calls, PLAN);
  assert.equal(plan.searchParams.get('fromPlace'), `${HOME.lat},${HOME.lon}`);
  assert.equal(plan.searchParams.get('toPlace'), '44.8258,-0.5563');
  assert.equal(plan.searchParams.get('detailedLegs'), 'false');

  // A minute later, within the interval: nothing asked, the countdown moved.
  const later = await trip.read(gladys, cfg, { now: NOW + 60_000 });
  assert.equal(later.journeys[0].leaveMinutes, 3);
  assert.equal(calls.length, 2); // the geocode and the plan

  // Past the interval, before the first departure (in 4 minutes): each
  // journey still to come is refreshed, none planned again.
  await trip.read(gladys, cfg, { now: NOW + 121_000 });
  assert.equal(paths(calls, PLAN).length, 1);
  assert.deepEqual(
    paths(calls, REFRESH)
      .map((url) => url.searchParams.get('itineraryId'))
      .sort(),
    ['it-1', 'it-2', 'it-3'],
  );
  assert.equal(paths(calls, REFRESH)[0].searchParams.get('detailedLegs'), 'false');

  // The first journey has left (4 minutes): now a new plan.
  await trip.read(gladys, cfg, { now: NOW + 4 * 60_000 });
  assert.equal(paths(calls, PLAN).length, 2);
});

test('a refresh brings the real time in: a delay, a journey no longer possible', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t, {
    'refresh-itinerary': (url) =>
      url.searchParams.get('itineraryId') === 'it-2'
        ? { status: 400 } // cannot be rebuilt any more: dropped
        : refreshPayload(url, (itinerary) => {
            // The tram A now 6 minutes late: arrives 6 minutes later.
            itinerary.endTime = new Date(Date.parse(itinerary.endTime) + 6 * 60_000).toISOString();
            for (const leg of itinerary.legs.filter((l) => l.routeShortName === 'A')) {
              leg.startTime = new Date(Date.parse(leg.startTime) + 6 * 60_000).toISOString();
            }
            return itinerary;
          }),
  });
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const trip = createTripBlueprint(GARE);
  const cfg = config({ trips_poll_frequency: 120 });
  await trip.read(gladys, cfg, { now: NOW });
  const { journeys } = await trip.read(gladys, cfg, { now: NOW + 121_000 });
  assert.deepEqual(
    journeys.map((journey) => journey.id),
    ['it-1', 'it-3'],
  );
  assert.equal(journeys[0].end, NOW + 31 * 60_000);
  assert.equal(journeys[0].delayMinutes, 7);
});

test('a failed refresh keeps the journeys known; nothing left to refresh plans again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const down = stubFetch(t, { 'refresh-itinerary': { status: 503 } });
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const trip = createTripBlueprint(GARE);
  const cfg = config({ trips_poll_frequency: 120 });
  await trip.read(gladys, cfg, { now: NOW });
  const kept = await trip.read(gladys, cfg, { now: NOW + 121_000 });
  assert.equal(kept.journeys.length, 3);
  assert.equal(paths(down.calls, PLAN).length, 1);
  globalThis.fetch.mock.restore();

  // Every journey can no longer be rebuilt: nothing left, planned again.
  const gone = stubFetch(t, { 'refresh-itinerary': { status: 400 } });
  clearPlans();
  await trip.read(gladys, cfg, { now: NOW });
  await trip.read(gladys, cfg, { now: NOW + 121_000 });
  assert.equal(paths(gone.calls, PLAN).length, 2);
});

test('refreshJourney: the same journey up to date, null when it cannot be rebuilt', async (t) => {
  stubFetch(t);
  const journey = await refreshJourney('it-1', { lineName });
  assert.equal(journey.id, 'it-1');
  assert.equal(journey.legs[0].line, 'Tram A');
  assert.equal(await refreshJourney('unknown'), null);
});

test('without a house address, or with an address not found, the journey says why', async (t) => {
  stubFetch(t, { geocode: () => [] });
  const homeless = createFakeGladys({ houses: [{ id: 'h', name: 'Maison' }] });
  await assert.rejects(createTripBlueprint(GARE).read(homeless, config()), (err) => {
    assert.ok(err instanceof TripError);
    assert.match(err.userMessage.fr, /adresse à votre maison/);
    return true;
  });
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  await assert.rejects(createTripBlueprint(GARE).read(gladys, config()), (err) => {
    assert.match(err.userMessage.fr, /introuvable près de la maison/);
    return true;
  });
});

test('the texts of a journey', () => {
  const [, best, lianes, cancelled] = parsePlan(planPayload(), lineName);
  assert.equal(
    formatRoute(best),
    `Tram A ${clock(7)}, changer à Porte de Bourgogne : Tram F ${clock(14)}`,
  );
  // The next line leaves from another stop: the walk is said.
  const walking = {
    ...best,
    legs: [best.legs[0], { ...best.legs[1], from: 'Porte de Bourgogne (quai Richelieu)' }],
  };
  assert.equal(
    formatRoute(walking, 'en'),
    `Tram A ${clock(7)}, get off at Porte de Bourgogne, walk to Porte de Bourgogne (quai Richelieu): Tram F ${clock(14)}`,
  );
  assert.equal(formatRoute(undefined), 'Aucun trajet trouvé');
  // A leg without real time is marked "~", as on the departures.
  assert.equal(formatRoute(lianes), `Lianes 2 ~${clock(14)}`);
  assert.equal(
    formatOptions([best, lianes], 3),
    `${clock(4)} → ${clock(25)} · ${clock(11)} → ${clock(34)}`,
  );
  assert.equal(formatStatus(best), 'Normal');
  assert.equal(formatStatus(lianes), 'Perturbé : Arrêt Quinconces déplacé');
  assert.equal(formatStatus(cancelled), 'Course supprimée sur ce trajet');
  assert.equal(formatStatus({ ...best, delayMinutes: 4 }, 'en'), '4 min late');
});

test('a journey device: its features, and what a poll publishes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t);
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const trip = createTripBlueprint(GARE);
  const device = trip.buildDevice(gladys, config());
  assert.equal(device.name, 'TBM – Trajet → Gare');
  assert.deepEqual(device.params, [
    { name: 'trip_name', value: 'Gare' },
    { name: 'trip_address', value: 'Gare Saint-Jean' },
  ]);
  assert.deepEqual(
    device.features.map((feature) => feature.name),
    ['partir dans', 'durée', 'arrivée', 'itinéraire', 'prochains départs', 'état'],
  );
  await trip.onPoll(gladys, config(), { now: NOW });
  const ids = gladys.externalIds(TRIP_TYPE, 'gare');
  const published = { get: (featureId) => gladys.fake.lastState(featureId) };
  assert.equal(published.get(ids.feature('leave_in')), 4);
  assert.equal(published.get(ids.feature('duration')), 21);
  assert.equal(published.get(ids.feature('arrival')), clock(25));
  assert.equal(published.get(ids.feature('status')), 'Normal');
});

test('a journey that cannot be planned publishes why, and no countdown', async (t) => {
  stubFetch(t, { plan: { status: 503 } });
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  await createTripBlueprint(GARE).onPoll(gladys, config(), { now: NOW });
  const ids = gladys.externalIds(TRIP_TYPE, 'gare');
  const published = { get: (featureId) => gladys.fake.lastState(featureId) };
  assert.equal(published.get(ids.feature('leave_in')), 999);
  assert.match(published.get(ids.feature('status')), /Transitous/);
});

test('the registry: journeys of the configuration and of the created devices', async () => {
  const gladys = createFakeGladys({
    devices: [
      {
        external_id: 'x',
        params: [
          { name: 'trip_name', value: 'Travail' },
          { name: 'trip_address', value: '1 place Pey Berland' },
        ],
      },
    ],
  });
  await gladys.connect();
  const trips = buildBlueprints(gladys, config()).filter((b) => b.type === TRIP_TYPE);
  assert.deepEqual(
    trips.map((trip) => trip.slug),
    ['gare', 'travail'],
  );
});

test('a widget set up with the wrong kind of device says which one it expects', () => {
  const gladys = createFakeGladys();
  const gare = gladys.externalIds(TRIP_TYPE, 'gare').device;
  assert.throws(
    () => findSelectedBlueprint(gladys, gare, config()),
    (err) => err instanceof DeviceSelectionError && /ligne TBM/.test(err.userMessage.fr),
  );
  assert.equal(findSelectedBlueprint(gladys, gare, config(), TRIP_TYPE).slug, 'gare');
});

test('the journeys are polled every minute, without asking Transitous each time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { calls } = stubFetch(t);
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const poll = createPoller();
  const device = { external_id: gladys.externalIds(TRIP_TYPE, 'gare').device };
  assert.equal(await poll(gladys, device, config(), { now: NOW }), true);
  assert.equal(await poll(gladys, device, config(), { now: NOW + 60_000 }), true);
  assert.equal(calls.filter((url) => url.pathname === '/api/v6/plan').length, 1);
});

test('the journey widget: when to leave, the lines, the next options without the first', () => {
  const journeys = parsePlan(planPayload(), lineName)
    .slice(1)
    .map((journey, i) => ({ ...journey, leaveMinutes: [4, 11, 19][i] }));
  const content = journeyContent({ name: 'Gare' }, journeys, 'fr', { count: 3 });
  assert.deepEqual(validateWidgetContent(content), []);
  const [heading, caption, tile, list] = content.components;
  assert.equal(heading.text, 'Trajet → Gare');
  assert.equal(
    caption.text.fr,
    `Tram A ${clock(7)}, changer à Porte de Bourgogne : Tram F ${clock(14)}`,
  );
  assert.deepEqual(
    [tile.value, tile.label.fr, tile.color],
    [4, `Tram A › Tram F → ${clock(25)}`, 'success'],
  );
  assert.deepEqual(
    list.items.map((item) => [item.label, item.value, item.color]),
    [
      [`Arrivée ${clock(34)} · Lianes 2`, 'partir dans 11 min', 'warning'],
      [`Arrivée ${clock(40)} · Tram A › Tram F`, 'partir dans 19 min', 'danger'],
    ],
  );
  const best = journeyContent({ name: 'Gare' }, journeys, 'fr', { count: 1 });
  assert.equal(best.components.filter((c) => c.type === 'status').length, 0);
  const none = journeyContent({ name: 'Gare' }, [], 'en');
  assert.deepEqual(validateWidgetContent(none), []);
  assert.match(none.components[1].text.en, /No journey/);
});

test('the journey widget reads the journey chosen in its settings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t);
  const gladys = createFakeGladys({ houses: [CITY_HALL_HOUSE] });
  const device = gladys.externalIds(TRIP_TYPE, 'gare').device;
  const content = await WIDGETS[JOURNEY_WIDGET].get(gladys, {
    settings: { device, count: '2' },
    language: 'fr',
    config: config(),
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.find((c) => c.type === 'status').items.length, 1);
});

test('the connection status tells a journey that was not understood', () => {
  const [ok, message] = connectionStatus(
    true,
    normalizeConfig({ trips: 'Gare : Gare Saint-Jean ; :x' }),
  );
  assert.equal(ok, true);
  assert.match(message.fr, /Non compris dans « Trajets » : :x/);
});
