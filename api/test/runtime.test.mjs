import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase, initializeDatabase } from '../database.mjs';
import { createCollector, startHourlyScheduler } from '../scheduler.mjs';

test('SQLite storage preserves fractional values across reopen, and rolls back snapshots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tarkov-test-'));
  let db;
  try {
    const path = join(directory, 'test.sqlite');
    db = new LocalDatabase(path); initializeDatabase(db);
    const inserted = await db.prepare('INSERT INTO Bosses (BossName) VALUES (?)').run('Test');
    assert.equal(Number(inserted.lastInsertRowid), 1);
    await db.prepare('INSERT INTO Maps (MapName) VALUES (?)').run('Map');
    await db.prepare('INSERT INTO Timestamps (Timestamp) VALUES (?)').run(123.456);
    await db.prepare('INSERT INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)').run(1, 1, 0.35, 1);
    await assert.rejects(db.transaction(async () => {
      await db.prepare('INSERT INTO Timestamps (Timestamp) VALUES (?)').run(999);
      throw new Error('Interrupted');
    }), /Interrupted/);
    db.close(); db = new LocalDatabase(path); initializeDatabase(db);
    assert.equal(db.prepare('SELECT Chance FROM SpawnChances').get().Chance, 0.35);
    assert.equal(db.prepare('SELECT Timestamp FROM Timestamps').get().Timestamp, 123.456);
    assert.equal(db.prepare('SELECT * FROM Timestamps').all().length, 1);
    assert.equal(db.prepare('SELECT * FROM Bosses WHERE BossID = ?').get(999), undefined);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('collector gates disabled runs, prevents overlaps and records failure', async () => {
  let fetches = 0;
  const options = { fetchData: async () => { fetches++; return { maps: [] }; }, storeData: async () => {}, transaction: fn => fn(), log: { info() {}, error() {} } };
  const disabled = createCollector({ ...options, enabled: false });
  assert.equal(await disabled.run(), false); assert.equal(fetches, 0);
  let complete;
  const collector = createCollector({ ...options, enabled: true, fetchData: () => new Promise(resolve => { complete = resolve; }) });
  const pending = collector.run(); assert.equal(await collector.run(), false);
  complete({ maps: [] }); assert.equal(await pending, true); assert.ok(collector.state.lastSuccess);
  const failing = createCollector({ ...options, enabled: true, storeData: async () => { throw new Error('Disk full'); } });
  assert.equal(await failing.run(), false); assert.equal(failing.state.lastError, 'Disk full'); assert.equal(failing.state.lastSuccess, null);
});

test('scheduler waits for UTC hour and does not arm when disabled', () => {
  let calls = 0; let delay;
  const schedule = (_, milliseconds) => { calls++; delay = milliseconds; return { unref() {} }; };
  startHourlyScheduler({ state: { enabled: false } }, { schedule }); assert.equal(calls, 0);
  startHourlyScheduler({ state: { enabled: true } }, { now: () => Date.parse('2026-11-18T10:45:00Z'), schedule });
  assert.equal(delay, 15 * 60 * 1000);
});
