import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineId, siriUrl, stopAreaRef, stopCode, text } from '../src/api/siri.js';

test('text unwraps every SIRI style of value', () => {
  assert.equal(text({ value: 'bordeaux:Line:59:LOC' }), 'bordeaux:Line:59:LOC');
  assert.equal(text([{ value: 'Cenon Gare', lang: 'fr' }]), 'Cenon Gare');
  assert.equal(text({ value: 'Hôtel de Ville', lang: 'fr' }), 'Hôtel de Ville');
  assert.equal(text([{ value: 'A' }, { value: 'B' }]), 'A / B');
  assert.equal(text('plain'), 'plain');
  assert.equal(text(6), '6');
  assert.equal(text(undefined), '');
  assert.equal(text(null), '');
  assert.equal(text({ other: 1 }), '');
});

test('stop and line references give their codes', () => {
  assert.equal(stopCode('bordeaux:StopPoint:BP:THDVA:LOC'), 'THDVA');
  assert.equal(stopCode('bordeaux:StopPoint:BP:3718:LOC'), '3718');
  assert.equal(stopCode('nonsense'), '');
  assert.equal(stopAreaRef('THDVA'), 'bordeaux:StopPoint:BP:THDVA:LOC');
  // Leading zeros are part of the id: 01 is Lianes 1.
  assert.equal(lineId('bordeaux:Line:01:LOC'), '01');
  assert.equal(lineId('bordeaux:Line:59:LOC'), '59');
  assert.equal(lineId(''), '');
});

test('the URL carries the public account key and the parameters', () => {
  const url = new URL(siriUrl('stop-monitoring', { MonitoringRef: stopAreaRef('THDVA') }));
  assert.equal(url.hostname, 'bdx.mecatran.com');
  assert.ok(url.pathname.endsWith('/bordeaux/stop-monitoring.json'));
  assert.equal(url.searchParams.get('AccountKey'), 'opendata-bordeaux-metropole-flux-gtfs-rt');
  assert.equal(url.searchParams.get('MonitoringRef'), 'bordeaux:StopPoint:BP:THDVA:LOC');
});
