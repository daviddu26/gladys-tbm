import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDeparturesCache,
  fetchStationDepartures,
  formatClock,
  markLastDepartures,
  minutesUntil,
  parseDepartures,
  PREVIEW_MS,
  upcoming,
} from '../src/api/departures.js';
import { NOW, stopMonitoringPayload, visit } from './helpers/fixtures.js';
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
    last: false,
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

const HOUR = 3600;
const tramA = (journey, aimed, direction = '0') =>
  visit({
    quay: direction === '0' ? '3718' : '3719',
    line: '59',
    direction,
    directionName: direction === '0' ? 'Hôpital Pellegrin / Le Haillan Rostand' : 'Cenon Gare',
    destination: direction === '0' ? 'Le Haillan Rostand' : 'Cenon Gare',
    journey,
    aimed,
    expected: aimed,
  });

test('the last departure before a break in service is flagged', () => {
  // Evening at Hôtel de Ville: 00:24 is the last tram A towards Le Haillan,
  // the next one is the first of the morning, more than two hours later.
  const payload = stopMonitoringPayload([
    tramA('A-10', 10 * 60),
    tramA('A-11', 20 * 60),
    tramA('A-12', 20 * 60 + 4.5 * HOUR),
    tramA('B-1', 15 * 60, '1'),
  ]);
  const departures = parseDepartures(payload, { windowEnd: NOW + 5 * HOUR * 1000 });
  const last = (journey) => departures.find((d) => d.journey.endsWith(journey)).last;
  assert.equal(last('A-10'), false);
  assert.equal(last('A-11'), true);
  // Nothing after it, but the answer stops 10 minutes later: unknown, not last.
  assert.equal(last('A-12'), false);
  // The other direction, alone in a window reaching far past it: last.
  assert.equal(last('B-1'), true);
});

test('without the end of the window, only a gap inside the answer counts', () => {
  const departures = markLastDepartures(
    [
      { lineId: '59', direction: '0', time: NOW },
      { lineId: '59', direction: '0', time: NOW + 3 * HOUR * 1000 },
    ],
    undefined,
  );
  assert.deepEqual(
    departures.map((d) => d.last),
    [true, false],
  );
});

test('a station is read four hours ahead, and the window end flags the last', async (t) => {
  const { calls } = stubFetch(t, {
    'stop-monitoring': () => stopMonitoringPayload([tramA('A-20', 30 * 60)]),
  });
  const [only] = await fetchStationDepartures('THDVA', { now: NOW });
  assert.equal(calls[0].searchParams.get('PreviewInterval'), 'PT4H');
  assert.equal(PREVIEW_MS, 4 * HOUR * 1000);
  assert.equal(only.last, true);
});
