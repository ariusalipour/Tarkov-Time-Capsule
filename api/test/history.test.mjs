import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase, initializeDatabase } from '../database.mjs';
import { handleApiRequest } from '../handlers.mjs';
const range = 'startDate=2020-01-01&endDate=2029-01-01';
function database(n = 0) {
  const db = new LocalDatabase(':memory:');
  initializeDatabase(db);
  db.sqlite.exec(`INSERT INTO Maps VALUES(1,'Customs'); INSERT INTO Bosses VALUES(1,'reshala');`);
  if (n)
    db.sqlite.exec(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${n}) INSERT INTO Timestamps SELECT x,1700000000+x*3600 FROM n; INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) SELECT 1,1,0.6,TimestampID FROM Timestamps;`,
    );
  return db;
}
async function request(db, path) {
  const r = await handleApiRequest(new Request('http://localhost/api/' + path), db);
  return { status: r.status, body: await r.json() };
}
test('long summaries are bounded and preserve fractions, outliers and every observation count', async () => {
  const db = database(11000);
  try {
    db.sqlite.exec(
      'UPDATE SpawnChances SET Chance=0.12345 WHERE SpawnChanceID=1; UPDATE SpawnChances SET Chance=0.999 WHERE SpawnChanceID=2;',
    );
    assert.equal((await request(db, 'spawnchance?' + range)).status, 413);
    const { status, body } = await request(db, 'history/summary?' + range);
    assert.equal(status, 200);
    assert.equal(body.resolution, 'week');
    const points = body.series[0].points;
    assert.ok(points.length < 100);
    assert.equal(
      points.reduce((n, p) => n + p.count, 0),
      11000,
    );
    assert.equal(Math.min(...points.map((p) => p.min)), 0.12345);
    assert.equal(Math.max(...points.map((p) => p.max)), 0.999);
  } finally {
    db.close();
  }
});
test('keyset pagination avoids omissions, duplicates and concurrent collector inserts', async () => {
  const db = database(7);
  try {
    db.sqlite.exec(
      "INSERT INTO Bosses VALUES(2,'other'); INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) VALUES(2,1,0.3,1);",
    );
    let page = await request(db, 'history?' + range + '&limit=2');
    const snapshot = page.body.snapshotId;
    const ids = [];
    let counter = 0;
    while (true) {
      assert.equal(page.status, 200);
      ids.push(...page.body.records.map((r) => r.id));
      if (!page.body.nextCursor) break;
      if (counter++ === 0)
        db.sqlite.exec(
          'INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) VALUES(2,1,0.2,2);',
        );
      page = await request(
        db,
        'history?' + range + '&limit=2&cursor=' + encodeURIComponent(page.body.nextCursor),
      );
      assert.equal(page.body.snapshotId, snapshot);
    }
    assert.deepEqual(new Set(ids), new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.equal(ids.length, 8);
  } finally {
    db.close();
  }
});
test('cursor integrity, filters and strict bounded inputs', async () => {
  const db = database(3);
  try {
    const page = await request(db, 'history?' + range + '&limit=1&bossName=reshala');
    const cursor = encodeURIComponent(page.body.nextCursor);
    for (const path of [
      'history?' + range + '&limit=0',
      'history?' + range + '&limit=1001',
      'history?' + range + '&limit=1.5',
      'history?startDate=2026-02-30',
      'history?startDate=2000-01-01&endDate=2026-01-01',
      'history?' + range + '&cursor=invalid',
      'history?' + range + '&bossName=other&cursor=' + cursor,
      'history/summary?' + range + '&resolution=minute',
    ])
      assert.equal((await request(db, path)).status, 400, path);
    assert.equal(
      (await request(db, 'history?' + range + '&bossName=RESHALA&cursor=' + cursor)).status,
      200,
    );
  } finally {
    db.close();
  }
});
test('summary splits collection gaps within buckets and retains latest observation', async () => {
  const db = database();
  try {
    db.sqlite.exec(
      `INSERT INTO Timestamps VALUES(1,1700000000),(2,1700003600),(3,1700030000); INSERT INTO SpawnChances VALUES(1,1,1,0.1,1),(2,1,1,0.7,2),(3,1,1,0.2,3);`,
    );
    const { body } = await request(db, 'history/summary?' + range + '&resolution=day');
    const points = body.series[0].points;
    assert.equal(new Set(points.map((p) => p.segment)).size, 2);
    assert.equal(points[0].count, 2);
    assert.equal(points[0].latest, 0.7);
    assert.equal(points[0].min, 0.1);
    assert.equal(points[0].max, 0.7);
    assert.equal(
      points.reduce((n, p) => n + p.count, 0),
      3,
    );
  } finally {
    db.close();
  }
});
test('summary refuses excess points and series explicitly', async () => {
  const db = database(26000);
  try {
    assert.equal((await request(db, 'history/summary?' + range + '&resolution=hour')).status, 413);
    db.sqlite.exec(
      `WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM n WHERE x<102) INSERT INTO Bosses SELECT x,'boss'||x FROM n; INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) SELECT BossID,1,0.5,1 FROM Bosses WHERE BossID>1;`,
    );
    assert.equal((await request(db, 'history/summary?' + range)).status, 413);
    assert.equal((await request(db, 'history/summary?' + range + '&bossName=reshala')).status, 200);
  } finally {
    db.close();
  }
});

test('HTTP exposes history endpoints and separately budgets summary CPU work', async () => {
  const { createHttpServer } = await import('../http-server.mjs');
  const db = database(3);
  let time = Date.now();
  const server = createHttpServer({
    db,
    staticRoot: '.',
    collector: { state: { enabled: false } },
    source: 'test',
    now: () => time,
    queryLimiter: () => true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  try {
    const raw = await fetch(base + 'history?' + range + '&limit=2');
    assert.equal(raw.status, 200);
    assert.equal((await raw.json()).records.length, 2);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + 'history/summary?' + range);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).series.length, 1);
    }
    const busy = await fetch(base + 'history/summary?' + range);
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get('retry-after'), '5');
    await busy.text();
    const rawAgain = await fetch(base + 'history?' + range);
    assert.equal(rawAgain.status, 200);
    await rawAgain.text();
    time += 5000;
    const refilled = await fetch(base + 'history/summary?' + range);
    assert.equal(refilled.status, 200);
    await refilled.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('database failures propagate to generic HTTP 500 without revealing SQL details', async () => {
  const { createHttpServer } = await import('../http-server.mjs');
  const failure = new Error('SQLITE_ERROR: private database path and query');
  const db = {
    prepare() {
      throw failure;
    },
  };
  for (const path of ['history?' + range, 'history/summary?' + range]) {
    await assert.rejects(
      handleApiRequest(new Request('http://localhost/api/' + path), db),
      (error) => error === failure,
    );
  }
  const server = createHttpServer({
    db,
    staticRoot: '.',
    collector: { state: { enabled: false } },
    source: 'test',
    queryLimiter: () => true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    for (const path of ['history?' + range, 'history/summary?' + range]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/` + path);
      assert.equal(response.status, 500);
      assert.equal(await response.text(), 'Internal server error');
    }
    assert.equal(logged.length, 2);
  } finally {
    console.error = originalError;
    await new Promise((resolve) => server.close(resolve));
  }
});
