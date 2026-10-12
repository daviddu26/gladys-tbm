import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  parseStationEntry,
  parseStations,
} from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.deepEqual(config[key], value, key);
  }
  assert.deepEqual(config.watched, { entries: [], invalid: [] });
});

test('numbers sent as text, empty or out of bounds are fixed', () => {
  const config = normalizeConfig({
    nearby_stations: '5',
    nearby_radius: '',
    poll_frequency: 10,
    max_departures: 99,
    include_school_lines: true,
    language: 'de',
  });
  assert.equal(config.nearby_stations, 5);
  assert.equal(config.nearby_radius, 600);
  assert.equal(config.poll_frequency, 60);
  assert.equal(config.max_departures, 5);
  assert.equal(config.include_school_lines, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
  assert.equal(normalizeConfig({ include_school_lines: 'yes' }).include_school_lines, false);
});

test('a station entry: a code, and the lines after @', () => {
  assert.deepEqual(parseStationEntry('THDVA'), { station: 'THDVA', lines: [] });
  assert.deepEqual(parseStationEntry(' thdva@a '), { station: 'THDVA', lines: ['a'] });
  assert.deepEqual(parseStationEntry('BQUIOR@2|5+N6'), {
    station: 'BQUIOR',
    lines: ['2', '5', 'N6'],
  });
  assert.equal(parseStationEntry('@A'), null);
  assert.equal(parseStationEntry('Hôtel de Ville'), null);
});

test('the stations field is split on commas, semicolons and lines', () => {
  const { entries, invalid } = parseStations('THDVA@A, BQUIOR;\nTPJUST , ,Place de la Bourse');
  assert.deepEqual(
    entries.map((entry) => entry.station),
    ['THDVA', 'BQUIOR', 'TPJUST'],
  );
  assert.deepEqual(invalid, ['Place de la Bourse']);
  assert.deepEqual(normalizeConfig({ stations: 'THDVA' }).watched.entries, [
    { station: 'THDVA', lines: [] },
  ]);
});
