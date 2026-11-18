import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, localSlot, snapshot, tick, tickSubscriptions, readState, writeState, send, sendBot, message } from './updates.mjs';

const mock = (timestamp, chance = 0.6, stale = false) => async url => new Response(JSON.stringify(String(url).includes('/healthz') ?
  { status: 'ok', database: { latestTimestamp: timestamp, stale } } :
  [{ MapName: 'Customs', BossName: 'Reshala', Chance: chance, Timestamp: timestamp }]), { status: 200 });
const setup = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tarkov-updates-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { ...config({}), enabled: true, dryRun: false, statePath: join(dir, 'state.json'), webhook: 'https://discord.com/api/webhooks/123/token' };
};
test('London daily time follows GMT/BST across clock changes', () => {
  assert.equal(localSlot(new Date('2026-01-15T09:00Z'), 'Europe/London').time, '09:00');
  assert.equal(localSlot(new Date('2026-07-15T08:00Z'), 'Europe/London').time, '09:00');
  assert.equal(localSlot(new Date('2026-03-29T08:00Z'), 'Europe/London').time, '09:00');
  assert.equal(localSlot(new Date('2026-10-25T09:00Z'), 'Europe/London').time, '09:00');
});
test('baseline without post, changes once, restart dedupe, daily once', async t => {
  const cfg = await setup(t); let sends = 0;
  const run = (time, chance) => tick(cfg, { now: new Date(time), fetcher: mock(time, chance), deliver: async () => { sends++; } });
  assert.equal(await run('2026-11-18T07:00Z', 0.6), 'baseline');
  assert.equal(await run('2026-11-18T08:00Z', 0.65), 'sent');
  assert.equal(await run('2026-11-18T08:01Z', 0.65), 'not-due');
  assert.equal(await run('2026-11-18T09:00Z', 0.65), 'sent');
  assert.equal(await run('2026-11-18T09:01Z', 0.65), 'not-due');
  assert.equal(await run('2026-11-18T10:00Z', 0.65), 'unchanged');
  assert.equal(sends, 2);
});
test('missing/stale observations never turn into zero or overwrite baseline', async t => {
  const cfg = await setup(t), now = new Date('2026-11-18T11:00Z');
  for (const stale of [true, false]) {
    await assert.rejects(snapshot(cfg, now, mock(stale ? now.toISOString() : '2026-11-17T11:00Z', 0.6, stale)), /stale/);
  }
  await assert.rejects(snapshot(cfg, now, async () => new Response('{}')), /stale/);
  await assert.rejects(snapshot(cfg, now, async url => String(url).includes('/healthz') ? mock(now.toISOString())(url) : new Response('[]')), /empty/);
});
test('collector race does not consume hour; daily prior-hour summary still permits new collection check', async t => {
  const cfg = await setup(t); let sends = 0;
  const run = (now, timestamp, chance = 0.6) => tick(cfg, {
    now: new Date(now), fetcher: mock(timestamp, chance), deliver: async () => { sends++; },
  });
  await run('2026-11-18T07:30Z', '2026-11-18T07:00Z');
  assert.equal(await run('2026-11-18T08:00Z', '2026-11-18T07:00Z'), 'awaiting-collection');
  assert.equal((await readState(cfg.statePath)).hour, Math.floor(Date.parse('2026-11-18T07:00Z') / 3600000));
  assert.equal(await run('2026-11-18T08:01Z', '2026-11-18T08:00Z', 0.65), 'sent');
  assert.equal(await run('2026-11-18T09:00Z', '2026-11-18T08:00Z', 0.65), 'sent');
  assert.equal(await run('2026-11-18T09:00:30Z', '2026-11-18T08:00Z', 0.65), 'awaiting-collection');
  assert.equal(await run('2026-11-18T09:01Z', '2026-11-18T09:00Z', 0.7), 'sent');
  assert.equal(await run('2026-11-18T09:02Z', '2026-11-18T09:00Z', 0.7), 'not-due');
  assert.equal(sends, 3);
});
test('429 retries honor bounded delay, never retry other HTTP errors', async () => {
  let calls = 0; const delays = [];
  await send('https://discord.com/api/webhooks/123/token', {}, async () => ++calls === 1 ? new Response('{"retry_after":0.25}', { status: 429 }) : new Response('{}'), async ms => delays.push(ms));
  assert.equal(calls, 2); assert.deepEqual(delays, [250]);
  await assert.rejects(send('https://discord.com/api/webhooks/123/token', {}, async () => new Response('{"retry_after":120}', { status: 429 })), /bounded/);
  await assert.rejects(send('https://discord.com/api/webhooks/123/token', {}, async () => new Response('', { status: 500 })), /500/);
});
test('ambiguous delivery blocks repeat after restart; dry-run never mutates state', async t => {
  const cfg = await setup(t), baselineTime = '2026-11-18T07:00Z', time = '2026-11-18T08:00Z';
  await tick(cfg, { now: new Date(baselineTime), fetcher: mock(baselineTime) });
  await assert.rejects(tick(cfg, { now: new Date(time), fetcher: mock(time, 0.7), deliver: async () => { throw new Error('timeout'); } }), /timeout/);
  assert.equal(await tick(cfg), 'pending-review');
  const state = await readState(cfg.statePath); delete state.pending; await writeState(cfg.statePath, state);
  assert.equal(await tick({ ...cfg, dryRun: true }, { now: new Date(time), fetcher: mock(time, 0.7), log: () => {} }), 'dry-run');
  assert.deepEqual(await readState(cfg.statePath), state);
});
test('messages bounded, mention-safe, preserve observed outliers and omissions', () => {
  const current = { timestamp: '2026-11-18T11:00Z', values: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`@everyone / boss${i}`, 1.5])) };
  const payload = message(current, { values: { removed: 20 } }, true, 'https://tarkovcapsule.mockachino.app/');
  assert.ok(payload.content.length <= 2000); assert.ok(payload.content.includes('150%'));
  assert.ok(payload.content.includes('absence does not mean 0%')); assert.ok(!payload.content.includes('@everyone'));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});
test('raw fractional chances format as percentages without changing comparison values', () => {
  const current = { timestamp: '2026-11-18T11:00Z', values: { 'Customs / Reshala': 0.6, 'Woods / Shturman': 0.12345 } };
  const payload = message(current, { values: { 'Customs / Reshala': 0.5 } }, false, 'https://example.com/');
  assert.ok(payload.content.includes('60% (was 50%)'));
  assert.ok(payload.content.includes('12.345%'));
  assert.equal(current.values['Customs / Reshala'], 0.6);
});

const botSetup = async t => {
  const cfg = await setup(t);
  cfg.mode = 'bot'; cfg.subscriptionsDir = join(cfg.statePath, '..', 'subscriptions');
  cfg.deliveryDir = join(cfg.statePath, '..', 'delivery'); cfg.botTokenFile = join(cfg.statePath, '..', 'token');
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
  assert.equal(sends, 2, 'daily summary ignored in bot mode');
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
