import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase, initializeDatabase, processAndInsertData } from '../database.mjs';
import { handleApiRequest } from '../handlers.mjs';

test('collector stores snapshots queried by lists, filters, latest and grouping', async () => {
  const db = new LocalDatabase(':memory:');
  initializeDatabase(db);
  try {
    await db.transaction(() => processAndInsertData({ maps: [
      { name: 'Customs', bosses: [{ name: 'reshala', spawnChance: 0.6 }] },
      { name: 'Woods', bosses: [{ name: 'shturman', spawnChance: 0.35 }] },
    ] }, db));
    const get = async path => {
      const response = await handleApiRequest(new Request(`http://localhost${path}`), db);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.deepEqual(await get('/api/maps'), ['Customs', 'Woods']);
    assert.deepEqual(await get('/api/bosses'), ['Reshala', 'Shturman']);
    const latest = await get('/api/latestspawnchance?bossName=RESHALA');
    assert.equal(latest.length, 1);
    assert.equal(latest[0].Chance, 0.6);
    assert.equal(latest[0].MapName, 'Customs');
    assert.ok(Number.isFinite(Date.parse(latest[0].Timestamp)));
    const byMap = await get('/api/spawnchance?mapName=woods&groupBy=map');
    assert.equal(byMap[0].mapName, 'Woods');
    assert.equal(byMap[0].bosses[0].spawnChance, 0.35);
    const byBoss = await get('/api/spawnchance?groupBy=boss');
    assert.equal(byBoss.length, 2);
    const byTime = await get('/api/spawnchance?groupBy=timestamp');
    assert.equal(byTime.length, 1);
    assert.equal(byTime[0].entries.length, 2);
    assert.deepEqual(await get('/api/spawnchance?startDate=2020-01-01&endDate=2020-01-02'), []);
    assert.equal((await handleApiRequest(new Request('http://localhost/api/missing'), db)).status, 404);
  } finally { db.close(); }
});

test('history defaults to one week and latest to one hour with shared grouping semantics', async () => {
  const db = new LocalDatabase(':memory:');
  initializeDatabase(db);
  try {
    db.prepare('INSERT INTO Maps VALUES (?, ?)').run(1, 'Customs');
    db.prepare('INSERT INTO Bosses VALUES (?, ?)').run(1, 'reshala');
    const now = Date.now() / 1000;
    for (const [id, age] of [[1, 600], [2, 7200], [3, 8 * 86400]]) {
      db.prepare('INSERT INTO Timestamps VALUES (?, ?)').run(id, now - age);
      db.prepare('INSERT INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)').run(1, 1, 0.6, id);
    }
    const get = async path => (await handleApiRequest(new Request(`http://localhost/api/${path}`), db)).json();
    assert.equal((await get('spawnchance')).length, 2);
    assert.equal((await get('latestspawnchance?startDate=2000-01-01')).length, 1);
    assert.equal((await get('spawnchance?startDate=2000-01-01')).length, 3);
    const boss = await get('latestspawnchance?GROUPBY=boss&BOSSNAME=RESHALA');
    assert.equal(boss[0].bossName, 'reshala');
    assert.equal(boss[0].maps.length, 1);
    const map = await get('latestspawnchance?groupBy=map');
    assert.equal(map[0].mapName, 'Customs');
    assert.equal(map[0].bosses[0].spawnChance, 0.6);
    const timestamp = await get('latestspawnchance?groupBy=timestamp');
    assert.equal(timestamp[0].entries.length, 1);
    // Values retain their case-sensitive semantics even though parameter names do not.
    assert.equal((await get('latestspawnchance?groupBy=BOSS'))[0].BossName, 'reshala');
  } finally { db.close(); }
});
