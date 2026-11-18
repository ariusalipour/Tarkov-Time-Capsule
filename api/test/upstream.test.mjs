import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMaps, normalizeMaps, upstreamSource } from '../upstream.mjs';

const fixture = () => ({ data: { maps: { customs: { name: 'map-name', bosses: [
  { mob: 'bossBully', spawnChance: 0.35 }, { mob: 'bossBully', spawnChance: 0.15 },
] } }, mobs: { bossBully: { name: 'bossBully' } } } });
const english = { data: { 'map-name': 'Customs', bossBully: 'Reshala' } };

test('official JSON mapper resolves English names, preserving fractions and spawn order', () => {
  assert.deepEqual(normalizeMaps(fixture(), english), { maps: [{ name: 'Customs', bosses: [
    { name: 'Reshala', spawnChance: 0.35 }, { name: 'Reshala', spawnChance: 0.15 },
  ] }] });
});

test('mapper rejects missing translations, mobs and malformed spawn chances', () => {
  assert.throws(() => normalizeMaps(fixture(), { data: {} }), /Missing upstream English/);
  const noMob = fixture(); noMob.data.mobs = {}; assert.throws(() => normalizeMaps(noMob, english), /Missing upstream mob/);
  for (const invalid of [null, '35', NaN, -1]) {
    const data = fixture(); data.data.maps.customs.bosses[0].spawnChance = invalid;
    assert.throws(() => normalizeMaps(data, english), /Invalid upstream spawn chance/);
  }
  assert.throws(() => normalizeMaps({ data: { maps: {}, mobs: {} } }, english), /empty/);
});

test('fetch uses only official regular PvP endpoints and shared bounded signal', async () => {
  const calls = [];
  const data = await fetchMaps({ fetchImpl: async (url, options) => {
    calls.push({ url, signal: options.signal });
    return new Response(JSON.stringify(url === upstreamSource.maps ? fixture() : english));
  } });
  assert.equal(data.maps[0].name, 'Customs');
  assert.deepEqual(calls.map(call => call.url), [upstreamSource.maps, upstreamSource.english]);
  assert.equal(calls[0].signal, calls[1].signal);
  await assert.rejects(fetchMaps({ fetchImpl: async () => new Response('', { status: 503 }) }), /Upstream HTTP 503/);
});
