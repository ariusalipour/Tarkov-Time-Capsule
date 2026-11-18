import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase, initializeDatabase, processAndInsertData } from '../database.mjs';
import { handleApiRequest, MAX_ROWS } from '../handlers.mjs';
import { createHttpServer, createQueryLimiter } from '../http-server.mjs';
const database = () => { const db = new LocalDatabase(':memory:'); initializeDatabase(db); return db; };
test('invalid dates, reversed ranges and oversized queries fail explicitly', async () => {
  const db = database();
  try {
    for (const query of ['startDate=2026-02-30','startDate=Infinity','startDate=2026-01-01T25:00:00Z','startDate=2026-01-01T00:00:00%2B01:00','startDate=','startDate=2026-11-18&endDate=2025-01-01',`bossName=${'x'.repeat(101)}`,`x=${'x'.repeat(2050)}`]) {
      assert.equal((await handleApiRequest(new Request(`http://localhost/api/spawnchance?${query}`), db)).status, 400, query);
    }
    assert.equal((await handleApiRequest(new Request('http://localhost/api/spawnchance?startDate=2024-02-29T12:00:00.001Z'), db)).status, 200);
  } finally { db.close(); }
});
test('row cap accepts exact limit, rejects overflow without truncation', async () => {
  const db = database();
  try {
    db.sqlite.exec(`INSERT INTO Maps VALUES(1,'Customs'); INSERT INTO Bosses VALUES(1,'reshala');
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${MAX_ROWS}) INSERT INTO Timestamps SELECT x,1700000000+x FROM n;
    INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) SELECT 1,1,0.6,TimestampID FROM Timestamps;`);
    const request = () => new Request('http://localhost/api/spawnchance?startDate=2020-01-01&endDate=2026-01-01');
    const response = await handleApiRequest(request(), db);
    assert.equal(response.status,200); assert.equal((await response.json()).length,MAX_ROWS);
    db.sqlite.exec(`INSERT INTO Timestamps VALUES(${MAX_ROWS+1},1700100000); INSERT INTO SpawnChances(BossID,MapID,Chance,TimestampID) VALUES(1,1,0.6,${MAX_ROWS+1});`);
    const overflow = await handleApiRequest(request(),db);
    assert.equal(overflow.status,413); assert.match((await overflow.json()).error,/shorter date range/);
  } finally { db.close(); }
});
test('token buckets refill and global budget covers distinct addresses', () => {
  let time=0;
  const allow=createQueryLimiter({now:()=>time,globalBurst:2,globalPerMinute:2,addressBurst:1,addressPerMinute:1,maxAddresses:2});
  assert.equal(allow('a'),true); assert.equal(allow('a'),false); assert.equal(allow('b'),true); assert.equal(allow('c'),false);
  time=60000; assert.equal(allow('a'),true);
});
test('HTTP security headers, spoof-resistant rate limiting, traversal and fresh health', async () => {
  const db=database(); const directory=mkdtempSync(join(tmpdir(),'tarkov-http-'));
  writeFileSync(join(directory,'index.html'),'<!doctype html><title>Archive</title>');
  let time = Date.now();
  const server=createHttpServer({db,staticRoot:directory,collector:{state:{enabled:false}},source:'test',now:()=>time,queryLimiter:createQueryLimiter({addressBurst:1})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const path of ['/','/healthz','/missing.js','/api/nope','/%5csecret']) {
      const response=await fetch(base+path);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff'); assert.equal(response.headers.get('x-frame-options'),'DENY');
      assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/); await response.text();
    }
    assert.equal((await(await fetch(base+'/healthz')).json()).database.counts.SpawnChances,0);
    processAndInsertData({maps:[{name:'Customs',bosses:[{name:'reshala',spawnChance:0.6}]}]},db);
    const health=await(await fetch(base+'/healthz')).json();
    assert.equal(health.database.counts.SpawnChances,1); assert.equal(health.database.stale,false);
    time += 7201000;
    assert.equal((await(await fetch(base+'/healthz')).json()).database.stale,true);
    const head=await fetch(base+'/healthz',{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),'');
    const allowed=await fetch(base+'/api/maps'); assert.equal(allowed.status,200); await allowed.text();
    const limited=await fetch(base+'/api/maps',{headers:{'X-Forwarded-For':'192.0.2.1'}});
    assert.equal(limited.status,429); assert.ok(limited.headers.get('retry-after')); await limited.text();
    assert.equal((await fetch(base+'/%5csecret')).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); db.close(); rmSync(directory,{recursive:true,force:true}); }
});
