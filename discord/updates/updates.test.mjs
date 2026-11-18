import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, snapshot, tickSubscriptions, readState, writeState, sendBot, message } from './updates.mjs';

const mock = (timestamp, chance = 0.6, stale = false) => async url => new Response(JSON.stringify(String(url).includes('/healthz') ?
  { status: 'ok', database: { latestTimestamp: timestamp, stale } } :
  [{ MapName: 'Customs', BossName: 'Reshala', Chance: chance, Timestamp: timestamp }]), { status: 200 });
const setup = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tarkov-updates-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { ...config({}), enabled: true, dryRun: false, subscriptionsDir: join(dir, 'subscriptions'), deliveryDir: join(dir, 'delivery'), botTokenFile: join(dir, 'token') };
};
test('missing/stale observations never turn into zero or overwrite baseline', async t => {
  const cfg = await setup(t), now = new Date('2026-11-18T11:00Z');
  for (const stale of [true, false]) {
    await assert.rejects(snapshot(cfg, now, mock(stale ? now.toISOString() : '2026-11-17T11:00Z', 0.6, stale)), /stale/);
  }
  await assert.rejects(snapshot(cfg, now, async () => new Response('{}')), /stale/);
  await assert.rejects(snapshot(cfg, now, async url => String(url).includes('/healthz') ? mock(now.toISOString())(url) : new Response('[]')), /empty/);
});
test('messages bounded, mention-safe, preserve observed outliers and omissions', () => {
  const current = { timestamp: '2026-11-18T11:00Z', values: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`@everyone / boss${i}`, 1.5])) };
  const payload = message(current, { values: { removed: 20 } }, 'https://tarkovcapsule.mockachino.app/');
  assert.ok(payload.content.length <= 2000); assert.ok(payload.content.includes('150%'));
  assert.ok(payload.content.includes('absence does not mean 0%')); assert.ok(!payload.content.includes('@everyone'));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});
test('raw fractional chances format as percentages without changing comparison values', () => {
  const current = { timestamp: '2026-11-18T11:00Z', values: { 'Customs / Reshala': 0.6, 'Woods / Shturman': 0.12345 } };
  const payload = message(current, { values: { 'Customs / Reshala': 0.5 } }, 'https://example.com/');
  assert.ok(payload.content.includes('60% (was 50%)'));
  assert.ok(payload.content.includes('12.345%'));
  assert.equal(current.values['Customs / Reshala'], 0.6);
});

const botSetup = async t => {
  const cfg = await setup(t);
  await writeFile(cfg.botTokenFile, 'test-token');
  const sub = (guildId, revision = 'a', enabled = true, channelId = `${guildId}99`) =>
    writeState(join(cfg.subscriptionsDir, `${guildId}.json`), { guildId, channelId, enabled, revision, updatedAt: '2026-11-18T07:00Z' });
  return { cfg, sub };
};
test('bot subscriptions baseline, dedupe persistently, disable and new revision rebaseline without posts', async t => {
  const { cfg, sub } = await botSetup(t); let sends = 0, requests = 0;
  await sub('1'); await sub('2');
  const run = (time, chance) => tickSubscriptions(cfg, { now: new Date(time),
    fetcher: async url => { requests++; return mock(time, chance)(url); }, deliver: async () => { sends++; } });
  assert.deepEqual(await run('2026-11-18T07:00Z', 0.6), { 1: 'baseline', 2: 'baseline' });
  assert.equal(requests, 2, 'snapshot fetched once for all destinations');
  assert.deepEqual(await run('2026-11-18T08:00Z', 0.7), { 1: 'sent', 2: 'sent' });
  assert.deepEqual(await run('2026-11-18T08:01Z', 0.7), { 1: 'not-due', 2: 'not-due' });
  await sub('1', 'b', false); await sub('2', 'b', true, '288');
  assert.deepEqual(await run('2026-11-18T09:00Z', 0.8), { 1: 'disabled', 2: 'baseline' });
  assert.deepEqual(await run('2026-11-18T10:00Z', 0.8), { 1: 'disabled', 2: 'unchanged' });
  assert.equal(sends, 2, 'unchanged observations are never posted');
});
test('bot permission failure persists pending only for affected guild and others continue after restart', async t => {
  const { cfg, sub } = await botSetup(t); await sub('1'); await sub('2');
  await tickSubscriptions(cfg, { now: new Date('2026-11-18T07:00Z'), fetcher: mock('2026-11-18T07:00Z') });
  const delivered = [];
  const run = time => tickSubscriptions(cfg, { now: new Date(time), fetcher: mock(time, 0.7), log: () => {},
    deliver: async channel => { if (channel === '199') throw new Error('Discord delivery returned 403'); delivered.push(channel); } });
  assert.deepEqual(await run('2026-11-18T08:00Z'), { 1: 'review-required', 2: 'sent' });
  assert.ok((await readState(join(cfg.deliveryDir, '1-a.json'))).pending);
  assert.deepEqual(await run('2026-11-18T08:01Z'), { 1: 'pending-review', 2: 'not-due' });
  assert.deepEqual(delivered, ['299']);
});
test('bot rechecks subscription after snapshot and does not send to disabled destination', async t => {
  const { cfg, sub } = await botSetup(t); await sub('1');
  await tickSubscriptions(cfg, { now: new Date('2026-11-18T07:00Z'), fetcher: mock('2026-11-18T07:00Z') });
  let sends = 0;
  const result = await tickSubscriptions(cfg, { now: new Date('2026-11-18T08:00Z'),
    fetcher: async url => { const response = await mock('2026-11-18T08:00Z', 0.7)(url); await sub('1', 'b', false); return response; },
    deliver: async () => { sends++; } });
  assert.deepEqual(result, { 1: 'subscription-changed' }); assert.equal(sends, 0);
});
test('bot transport suppresses mentions, uses bot auth and bounds 429 retries', async () => {
  let calls = 0; const delays = [];
  await sendBot('123', 'test-token', { content: '@everyone', allowed_mentions: { parse: ['everyone'] } }, async (url, options) => {
    assert.equal(url, 'https://discord.com/api/v10/channels/123/messages');
    assert.equal(options.headers.Authorization, 'Bot test-token');
    assert.deepEqual(JSON.parse(options.body).allowed_mentions, { parse: [] });
    return ++calls === 1 ? new Response('{"retry_after":0.2}', { status: 429 }) : new Response('{}');
  }, async ms => delays.push(ms));
  assert.deepEqual(delays, [200]); assert.equal(calls, 2);
  await assert.rejects(sendBot('123', 'test-token', {}, async () => new Response('{}', { status: 403 })), /403/);
  await assert.rejects(sendBot('123', 'test-token', {}, async () => new Response('{"retry_after":90}', { status: 429 })), /bounded/);
});

test('collector boundary waits for the new snapshot and dry-run preserves delivery state', async t => {
  const { cfg, sub } = await botSetup(t); await sub('1');
  await tickSubscriptions(cfg, { now: new Date('2026-11-18T07:00Z'), fetcher: mock('2026-11-18T07:00Z') });
  const path = join(cfg.deliveryDir, '1-a.json');
  const baseline = await readState(path);
  assert.deepEqual(await tickSubscriptions(cfg, { now: new Date('2026-11-18T08:00Z'), fetcher: mock('2026-11-18T07:00Z') }), { 1: 'awaiting-collection' });
  assert.deepEqual(await readState(path), baseline);
  assert.deepEqual(await tickSubscriptions({ ...cfg, dryRun: true }, { now: new Date('2026-11-18T08:01Z'), fetcher: mock('2026-11-18T08:00Z', 0.7), log: () => {} }), { 1: 'dry-run' });
  assert.deepEqual(await readState(path), baseline);
});

test('disabled notifications never read subscriptions or deliver', async () => {
  assert.equal(await tickSubscriptions(config({}), { fetcher: () => { throw new Error('must not fetch'); } }), 'disabled');
});
