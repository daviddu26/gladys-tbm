// The network directory of the fixtures, put in memory (no request, no disk).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLines, parseStations, setDirectory } from '../../src/api/directory.js';
import { linesPayload, NOW, stopPointsPayload } from './fixtures.js';

// A directory read from the (stubbed) API is cached on disk: never in /data.
process.env.TBM_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'gladys-tbm-'));

export function useFixtureDirectory() {
  const directory = {
    fetchedAt: NOW,
    stations: parseStations(stopPointsPayload()),
    lines: parseLines(linesPayload()),
  };
  setDirectory(directory);
  return directory;
}

/** Hôtel de Ville, as a Gladys house. */
export const CITY_HALL_HOUSE = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 44.8373,
  longitude: -0.5772,
};
