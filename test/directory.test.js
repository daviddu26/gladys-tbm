import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linesPayload, NOW, stopPointsPayload } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

// The cache directory is read when the module loads: point it at a temporary
// directory first, then import.
const dataDir = await mkdtemp(join(tmpdir(), 'gladys-tbm-'));
process.env.TBM_DATA_DIR = dataDir;
const {
  distanceMeters,
  findStation,
  findStationLine,
  getDirectory,
  lineMode,
  loadDirectory,
  normalize,
  parseLines,
  parseStations,
  searchStations,
  setDirectory,
  stationLines,
  stationsNear,
} = await import('../src/api/directory.js');

const directory = () => ({
  fetchedAt: NOW,
  stations: parseStations(stopPointsPayload()),
  lines: parseLines(linesPayload()),
});

test.after(() => rm(dataDir, { recursive: true, force: true }));

test('the kind of a line comes from its public name', () => {
  assert.equal(lineMode('Tram A'), 'tram');
  assert.equal(lineMode('Lianes 5'), 'bus');
  assert.equal(lineMode('Principale 20'), 'bus');
  assert.equal(lineMode('BUS EXPRESS G'), 'bus');
  assert.equal(lineMode('LE BATO 1'), 'boat');
  assert.equal(lineMode('TBNight N1'), 'night');
  assert.equal(lineMode('SCODI S10'), 'school');
  assert.equal(lineMode('Navette Tram 104'), 'shuttle');
  assert.equal(lineMode('Bus Relais B'), 'shuttle');
  assert.equal(lineMode('Ligne 97 (HLP)'), 'service');
});

test('lines keep their public code and the names of their directions', () => {
  const lines = parseLines(linesPayload());
  assert.deepEqual(lines['59'], {
    id: '59',
    code: 'A',
    name: 'Tram A',
    mode: 'tram',
    directions: [
      { id: '0', name: 'Hôpital Pellegrin / Le Haillan Rostand' },
      { id: '1', name: 'Cenon Gare / La Gardette / Thiers Benauge' },
    ],
  });
  assert.equal(lines['02'].code, '2');
  assert.deepEqual(lines['104'].directions, []);
  assert.throws(() => parseLines({}), /AnnotatedLineRef/);
});

test('quays are grouped into stations, unusable stops left out', () => {
  const stations = parseStations(stopPointsPayload());
  assert.deepEqual(Object.keys(stations).sort(), ['BMUNIC', 'BQUIOR', 'BSCOL', 'THDVA', 'TPJUST']);
  const hdv = stations.THDVA;
  assert.equal(hdv.name, 'Hôtel de Ville');
  assert.deepEqual(hdv.quays, ['3718', '3719']);
  assert.deepEqual(hdv.lines.sort(), ['164', '59']);
  // The middle of its quays.
  assert.ok(Math.abs(hdv.lat - 44.8373175) < 1e-6);
  assert.ok(Math.abs(hdv.lon - -0.577162) < 1e-6);
  assert.throws(() => parseStations({ Siri: {} }), /AnnotatedStopPointRef/);
});

test('a search ignores accents and case, the exact name first', () => {
  const dir = directory();
  assert.deepEqual(
    searchStations(dir, 'hotel de ville').map((station) => station.code),
    ['THDVA'],
  );
  assert.deepEqual(
    searchStations(dir, 'QUINCONCES').map((station) => station.code),
    ['BMUNIC', 'BQUIOR'],
  );
  assert.deepEqual(
    searchStations(dir, 'justice').map((station) => station.code),
    ['TPJUST'],
  );
  // A code typed as is comes first.
  assert.equal(searchStations(dir, 'tpjust')[0].code, 'TPJUST');
  assert.deepEqual(searchStations(dir, 'nowhere'), []);
  assert.deepEqual(searchStations(dir, ' '), []);
  assert.equal(normalize('Hôtel-de-Ville !'), 'hotel de ville');
});

test('the lines of a station: trams first, filtered by kind', () => {
  const dir = directory();
  assert.deepEqual(
    stationLines(dir, 'THDVA').map((line) => line.code),
    ['A', 'F'],
  );
  assert.deepEqual(
    stationLines(dir, 'BQUIOR').map((line) => line.code),
    ['2', 'N6'],
  );
  assert.deepEqual(
    stationLines(dir, 'BQUIOR', { modes: ['bus'] }).map((line) => line.code),
    ['2'],
  );
  assert.deepEqual(stationLines(dir, 'NOPE'), []);
  assert.equal(findStationLine(dir, 'THDVA', 'a')?.id, '59');
  assert.equal(findStationLine(dir, 'THDVA', '164')?.id, '164');
  assert.equal(findStationLine(dir, 'THDVA', 'B'), null);
  assert.equal(findStation(dir, 'thdva')?.name, 'Hôtel de Ville');
  assert.equal(findStation(dir, 'XXXX'), null);
});

test('stations near a point, closest first, within the radius', () => {
  const dir = directory();
  const city = { lat: 44.8373, lon: -0.5772 };
  const near = stationsNear(dir, city, 600);
  assert.deepEqual(
    near.map((entry) => entry.station.code),
    ['THDVA', 'BSCOL', 'TPJUST'],
  );
  assert.ok(near[0].distance < 10);
  assert.equal(stationsNear(dir, city, 1).length, 0);
  // Hôtel de Ville → Palais de Justice: about 350 m.
  const meters = distanceMeters(dir.stations.THDVA, dir.stations.TPJUST);
  assert.ok(meters > 300 && meters < 400, `${meters} m`);
});

test('the directory is read once, kept a day on disk, and survives an API outage', async (t) => {
  setDirectory(null);
  const { calls } = stubFetch(t);
  const first = await loadDirectory({ now: NOW });
  assert.equal(Object.keys(first.stations).length, 5);
  assert.equal(calls.length, 2);
  // Within the day: no request.
  await loadDirectory({ now: NOW + 3600 * 1000 });
  assert.equal(calls.length, 2);
  // Written on disk, with its date.
  const cached = JSON.parse(await readFile(join(dataDir, 'directory.json'), 'utf8'));
  assert.equal(cached.fetchedAt, NOW);
  assert.equal(cached.version, 1);

  // A restart reads the disk, not the API.
  setDirectory(null);
  await loadDirectory({ now: NOW + 7200 * 1000 });
  assert.equal(calls.length, 2);
  assert.equal(getDirectory().fetchedAt, NOW);
});

test('an old directory is kept when the API is down', async (t) => {
  setDirectory(null);
  await writeFile(
    join(dataDir, 'directory.json'),
    JSON.stringify({ version: 1, ...directory(), fetchedAt: NOW - 3 * 24 * 3600 * 1000 }),
  );
  stubFetch(t, { 'stoppoints-discovery': { status: 503 } });
  const dir = await loadDirectory({ now: NOW });
  assert.equal(dir.fetchedAt, NOW - 3 * 24 * 3600 * 1000);
  assert.ok(dir.stations.THDVA);
});

test('without any directory, a failed read throws for the caller to report', async (t) => {
  setDirectory(null);
  await rm(join(dataDir, 'directory.json'), { force: true });
  stubFetch(t, { 'lines-discovery': new Error('ECONNRESET') });
  await assert.rejects(loadDirectory({ now: NOW }), { name: 'TbmApiError' });
  assert.equal(getDirectory(), null);
});

test('a forced refresh reads the API even with a fresh directory', async (t) => {
  setDirectory(directory());
  const { calls } = stubFetch(t);
  await loadDirectory({ fresh: true, now: NOW + 1000 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.searchParams.get('AccountKey')));
});
