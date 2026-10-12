import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { clearDeparturesCache, upcoming, parseDepartures } from '../src/api/departures.js';
import { clearSuggestions } from '../src/devices/suggestions.js';
import {
  DEPARTURES_WIDGET,
  departuresContent,
  captionText,
  selectedCount,
  selectedDirection,
  truncate,
  WIDGETS,
} from '../src/widgets.js';
import { useFixtureDirectory } from './helpers/directory.js';
import { NOW, stopMonitoringPayload } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(() => {
  useFixtureDirectory();
  clearSuggestions();
  clearDeparturesCache();
});

const INFO = {
  stationName: 'Hôtel de Ville',
  lineName: 'Tram A',
  lineCode: 'A',
  directions: ['0', '1'],
};

const tramA = () => upcoming(parseDepartures(stopMonitoringPayload()), { lineId: '59', now: NOW });

test('the board: a tile per direction, the departures, the timetable caption', () => {
  const content = departuresContent(INFO, tramA());
  assert.deepEqual(validateWidgetContent(content), []);
  const [heading, sens1, sens2, board, caption] = content.components;
  assert.equal(heading.text, 'Hôtel de Ville · Tram A');
  assert.deepEqual(
    [sens1.value, sens1.label, sens1.color],
    [2, '1 → Le Haillan Rostand', 'success'],
  );
  assert.deepEqual([sens2.value, sens2.label], [1, '2 → La Gardette']);
  assert.deepEqual(
    board.items.map((item) => [item.label, item.value, item.color]),
    [
      ['A → La Gardette', '1 min', 'success'],
      ['A → Le Haillan Rostand', '2 min (7 min de retard)', 'warning'],
      ['A → Cenon Gare', '~3 min', 'neutral'],
      ['A → Hôpital Pellegrin', '9 min', 'success'],
    ],
  );
  assert.equal(caption.variant, 'caption');
  assert.equal(content.ttl_seconds, 30);
});

test('one direction chosen: its name, its tile, its departures only', () => {
  const info = {
    ...INFO,
    directionNames: { 0: 'Hôpital Pellegrin / Le Haillan Rostand', 1: 'Cenon Gare / La Gardette' },
  };
  const content = departuresContent(info, tramA(), 'fr', { direction: '1' });
  assert.deepEqual(validateWidgetContent(content), []);
  const [heading, name, tile, board] = content.components;
  assert.equal(heading.text, 'Hôtel de Ville · Tram A');
  // The direction and the timetable note share the one caption a card allows.
  assert.equal(name.text.fr, 'Sens 2 → Cenon Gare / La Gardette. ~ horaire théorique.');
  assert.deepEqual([tile.value, tile.label], [1, '2 → La Gardette']);
  assert.equal(content.components.filter((c) => c.type === 'value').length, 1);
  assert.deepEqual(
    board.items.map((item) => item.label),
    ['A → La Gardette', 'A → Cenon Gare'],
  );
});

test('the number of departures: 1 keeps the tiles only, 3 lists three', () => {
  const one = departuresContent(INFO, tramA(), 'fr', { count: 1 });
  assert.deepEqual(validateWidgetContent(one), []);
  assert.equal(one.components.filter((c) => c.type === 'status').length, 0);
  assert.equal(one.components.filter((c) => c.type === 'value').length, 2);
  const three = departuresContent(INFO, tramA(), 'fr', { count: 3 });
  assert.equal(three.components.find((c) => c.type === 'status').items.length, 3);
});

test('the count setting: 1 to 5, empty or wrong means 5', () => {
  assert.equal(selectedCount('1'), 1);
  assert.equal(selectedCount(3), 3);
  assert.equal(selectedCount('9'), 5);
  assert.equal(selectedCount('0'), 1);
  for (const value of [undefined, null, '', 'tous']) assert.equal(selectedCount(value), 5);
});

test('the last departure of the evening: an orange tile and row, a caption', () => {
  const departures = tramA().map((departure) =>
    departure.destination === 'Hôpital Pellegrin' ? { ...departure, last: true } : departure,
  );
  const info = { ...INFO, directionNames: { 0: 'Hôpital Pellegrin / Le Haillan Rostand' } };
  const content = departuresContent(info, departures, 'fr', { direction: '0' });
  assert.deepEqual(validateWidgetContent(content), []);
  const [, caption, tile, board] = content.components;
  // Notes keep their display order (direction, then last); the room goes by
  // importance, so the name of the direction is shortened to fit.
  assert.match(caption.text.fr, /^Sens 1 → .*\. Dernier à \d\d:\d\d → Hôpital Pellegrin\.$/);
  assert.equal(tile.color, 'success');
  const lastRow = board.items.find((item) => item.label === 'A → Hôpital Pellegrin');
  assert.deepEqual([lastRow.value, lastRow.color], ['9 min (dernier)', 'warning']);
});

test('the caption keeps the most important notes within 80 characters', () => {
  const notes = [
    { rank: 2, en: 'x'.repeat(50), fr: 'Sens 1 → ' + 'y'.repeat(50) },
    { rank: 1, en: 'Last at 00:24 → Le Haillan.', fr: 'Dernier à 00:24 → Le Haillan.' },
    { rank: 4, en: '~ timetable, not tracked yet.', fr: '~ horaire théorique.' },
  ];
  const text = captionText(notes);
  assert.ok(text.fr.length <= 80 && text.en.length <= 80);
  // The last departure first; the long note no longer fits and is dropped,
  // the short one after it still does.
  assert.match(text.fr, /^Dernier à 00:24/);
  assert.doesNotMatch(text.fr, /yyyy/);
  assert.match(text.fr, /horaire théorique\.$/);
  assert.equal(captionText([]), null);
});

test('the direction setting: "0" or "1", anything else means both', () => {
  assert.equal(selectedDirection('0'), '0');
  assert.equal(selectedDirection(1), '1');
  for (const value of [undefined, null, '', '2', 'Sens 1']) {
    assert.equal(selectedDirection(value), null);
  }
});

test('an empty board says so, and stays valid', () => {
  const content = departuresContent(INFO, []);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].value, '—');
  assert.match(content.components.at(-1).text.fr, /Aucun passage/);
});

test('the widget reads the device chosen in its settings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  stubFetch(t);
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const device = gladys.externalIds('station-line', 'THDVA-59').device;
  const content = await WIDGETS[DEPARTURES_WIDGET].get(gladys, {
    settings: { device },
    language: 'fr',
    config,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Hôtel de Ville · Tram A');

  const oneWay = await WIDGETS[DEPARTURES_WIDGET].get(gladys, {
    settings: { device, direction: '0' },
    language: 'fr',
    config,
  });
  assert.deepEqual(validateWidgetContent(oneWay), []);
  assert.match(oneWay.components[1].text.fr, /^Sens 1/);
  assert.equal(oneWay.components.filter((c) => c.type === 'value').length, 1);
});

test('a missing device or an API outage is a card that says so', async (t) => {
  stubFetch(t, { 'stop-monitoring': { status: 503 } });
  const gladys = createFakeGladys();
  const config = normalizeConfig({ stations: 'THDVA@A' });
  const none = await WIDGETS[DEPARTURES_WIDGET].get(gladys, { settings: {}, config });
  assert.deepEqual(validateWidgetContent(none), []);
  assert.match(none.components[0].text.fr, /Choisissez une ligne/);
  const down = await WIDGETS[DEPARTURES_WIDGET].get(gladys, {
    settings: { device: gladys.externalIds('station-line', 'THDVA-59').device },
    config,
  });
  assert.deepEqual(validateWidgetContent(down), []);
  assert.match(down.components[0].text.fr, /ne répond pas/);
});

test('texts are cut to the budget of their component', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
