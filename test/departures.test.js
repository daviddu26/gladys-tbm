import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDeparturesCache,
  fetchStationDepartures,
  formatClock,
  minutesUntil,
  parseDepartures,
  upcoming,
} from '../src/api/departures.js';
import { NOW, stopMonitoringPayload } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(() => clearDeparturesCache());

test('a stop-monitoring answer becomes departures, soonest first', () => {
  const departures = parseDepartures(stopMonitoringPayload());
  // The duplicate and the tram ending its trip are left out; the past one is
  // still there (upcoming() filters by time).
  assert.deepEqual(
    departures.map((departure) => departure.journey.split(':').pop()),
    ['A-0', 'A-1', 'A-2', 'A-3', 'F-1', 'A-4'],
  );
  const [, gardette, haillan, cenon] = departures;
  assert.deepEqual(gardette, {
    journey: 'bordeaux:ServiceJourney:A-1',
    lineId: '59',
    direction: '1',
    directionName: 'Cenon Gare / La Gardette / Thiers Benauge',
    destination: 'La Gardette',
    quay: '3719',
    time: NOW + 108_000,
    aimed: NOW + 56_000,
    realtime: true,
    delayMinutes: 1,
  });
  assert.equal(haillan.delayMinutes, 7);
  // No expected time: a timetable guess, no delay known.
  assert.equal(cenon.realtime, false);
  assert.equal(cenon.delayMinutes, null);
  assert.equal(cenon.time, NOW + 206_000);
});

test('a refused or malformed answer throws', () => {
  assert.throws(() => parseDepartures({}), /StopMonitoringDelivery/);
  const refused = stopMonitoringPayload([]);
  refused.Siri.ServiceDelivery.StopMonitoringDelivery[0].Status = false;
  assert.throws(() => parseDepartures(refused), /refused/);
  assert.deepEqual(parseDepartures(stopMonitoringPayload([])), []);
});

test('upcoming keeps one line, one direction, and counts the minutes', () => {
  const departures = parseDepartures(stopMonitoringPayload());
  const tramA = upcoming(departures, { lineId: '59', now: NOW });
  assert.deepEqual(
    tramA.map((departure) => [departure.destination, departure.minutes]),
    [
      ['La Gardette', 1],
      ['Le Haillan Rostand', 2],
      ['Cenon Gare', 3],
      ['Hôpital Pellegrin', 9],
    ],
  );
  const towardsPellegrin = upcoming(departures, { lineId: '59', direction: '0', now: NOW });
  assert.deepEqual(
    towardsPellegrin.map((departure) => departure.destination),
    ['Le Haillan Rostand', 'Hôpital Pellegrin'],
  );
  assert.equal(upcoming(departures, { lineId: '164', now: NOW }).length, 1);
  assert.equal(minutesUntil(NOW + 20_000, NOW), 0);
  assert.equal(minutesUntil(NOW - 20_000, NOW), 0);
  assert.equal(minutesUntil(NOW + 119_000, NOW), 1);
});

test('the lines of one station share one request', async (t) => {
  const { calls } = stubFetch(t);
  const [a, b] = await Promise.all([
    fetchStationDepartures('THDVA', { now: NOW }),
    fetchStationDepartures('THDVA', { now: NOW + 1000 }),
  ]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('MonitoringRef'), 'bordeaux:StopPoint:BP:THDVA:LOC');
  // Past the sharing window, a new request.
  await fetchStationDepartures('THDVA', { now: NOW + 30_000 });
  assert.equal(calls.length, 2);
  // A fresh read never reuses.
  await fetchStationDepartures('THDVA', { now: NOW + 30_001, fresh: true });
  assert.equal(calls.length, 3);
});

test('a failed request is not shared', async (t) => {
  let fail = true;
  const { calls } = stubFetch(t, {
    'stop-monitoring': () => (fail ? { status: 500 } : stopMonitoringPayload()),
  });
  await assert.rejects(fetchStationDepartures('THDVA', { now: NOW }), { name: 'TbmApiError' });
  fail = false;
  const departures = await fetchStationDepartures('THDVA', { now: NOW + 1000 });
  assert.equal(calls.length, 2);
  assert.ok(departures.length > 0);
});

test('the clock is Bordeaux time', () => {
  // 15:53 UTC is 17:53 in Bordeaux in October (summer time).
  assert.equal(formatClock(NOW), '17:53');
  assert.equal(formatClock(Date.parse('2026-12-01T07:05:00Z')), '08:05');
});
