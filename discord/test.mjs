import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { createBot } from './server.mjs';

const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const now = Date.parse('2026-11-18T12:00:00Z');
const health = { database: { latestTimestamp: '2026-11-18T09:00:00Z', counts: { SpawnChances: 100 } }, collection: { enabled: true } };
const rows = [{ BossName: 'Reshala', MapName: 'Customs', Chance: 0, Timestamp: Date.parse(health.database.latestTimestamp) / 1000 }];
const make = (fetchImpl, extra = {}) => createBot({ publicKey, componentSecret: 'fixture-secret-longer-than-thirty-two-characters', now: () => now, fetchImpl: fetchImpl || (async url => new Response(JSON.stringify(url.pathname === '/healthz' ? health : url.pathname === '/api/bosses' ? ['Reshala', 'Shturman'] : rows))), ...extra });
const command = (name, options = []) => ({ type: 2, member: { user: { id: '123' } }, data: { name, options } });

test('signed PING, invalid signature, stale timestamp and tampered body', async t => {
  const bot = make(async () => { throw new Error('PING must not fetch'); });
  const server = createServer(bot.request); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/discord/interactions`;
  const body = JSON.stringify({ id: '1', type: 1 }); const timestamp = String(now / 1000);
  const signature = sign(null, Buffer.from(timestamp + body), pair.privateKey).toString('hex');
  const post = (content = body, ts = timestamp, sig = signature) => fetch(url, { method: 'POST', body: content, headers: { 'x-signature-timestamp': ts, 'x-signature-ed25519': sig } });
  assert.deepEqual(await (await post()).json(), { type: 1 });
  assert.equal((await post(body, timestamp, '0'.repeat(128))).status, 401);
  assert.equal((await post(body, String(Number(timestamp) - 301))).status, 401);
  assert.equal((await post('{"type":2}')).status, 401);
});

test('latest archived snapshot, stale notice, zero preserved, encoded query', async () => {
  const calls = [];
  const bot = make(async url => { calls.push(url); return new Response(JSON.stringify(url.pathname === '/healthz' ? health : rows)); });
  const result = await bot.handle(command('boss', [{ name: 'name', value: 'Reshala & friends' }]));
  assert.match(result.data.content, /STALE/); assert.match(result.data.content, /\*\*0%\*\*/);
  assert.equal(calls[1].searchParams.get('bossName'), 'Reshala & friends');
  assert.equal(calls[1].searchParams.get('startDate'), '2026-11-18T08:59:59.999Z');
  assert.equal(result.data.allowed_mentions.parse.length, 0);
});

test('absence is not reported as zero; status and aliases', async () => {
  const bot = make(async url => new Response(JSON.stringify(url.pathname === '/healthz' ? health : [])));
  assert.match((await bot.handle(command('bosses'))).data.content, /Missing data does not mean/);
  assert.match((await bot.handle(command('status'))).data.content, /enabled/);
  assert.match((await bot.handle(command('hello'))).data.content, /\/boss/);
  assert.match((await bot.handle(command('ping'))).data.content, /responding/);
});

test('autocomplete searches all names and limits Discord choices', async () => {
  const bot = make(async () => new Response(JSON.stringify(Array.from({ length: 42 }, (_, i) => `Boss ${i}`))));
  const result = await bot.handle({ type: 4, data: { name: 'boss', options: [{ focused: true, value: 'Boss' }] } });
  assert.equal(result.data.choices.length, 25);
  const filtered = await bot.handle({ type: 4, data: { name: 'boss', options: [{ focused: true, value: '41' }] } });
  assert.equal(filtered.data.choices[0].value, 'Boss 41');
});

test('pagination fits message limits and binds signed controls to owner', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...rows[0], BossName: `Boss ${i}`, MapName: 'Map @everyone <@123>' }));
  const bot = make(async url => new Response(JSON.stringify(url.pathname === '/healthz' ? health : many)));
  const first = await bot.handle(command('bosses'));
  assert.ok(first.data.content.length < 2000); assert.ok(!first.data.content.includes('@everyone'));
  const id = first.data.components[0].components[1].custom_id; assert.ok(id.length <= 100);
  const next = await bot.handle({ type: 3, member: { user: { id: '123' } }, data: { custom_id: id } });
  assert.equal(next.type, 7); assert.match(next.data.content, /Page 2\//);
  const denied = await bot.handle({ type: 3, member: { user: { id: '456' } }, data: { custom_id: id } });
  assert.equal(denied.data.flags, 64);
  const tampered = await bot.handle({ type: 3, member: { user: { id: '123' } }, data: { custom_id: id + 'x' } });
  assert.equal(tampered.data.flags, 64);
});

test('slow API returns a private bounded error; autocomplete fails closed', async () => {
  const bot = make(async (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))), { deadlineMs: 20 });
  const started = Date.now();
  assert.equal((await bot.handle(command('bosses'))).data.flags, 64);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual((await bot.handle({ type: 4, data: { name: 'boss' } })).data.choices, []);
});

test('boss pagination retains the selected boss', async () => {
  const calls = [];
  const many = Array.from({ length: 30 }, (_, i) => ({ ...rows[0], MapName: `Long map name ${i} with enough characters to require multiple pages` }));
  const bot = make(async url => { calls.push(url); return new Response(JSON.stringify(url.pathname === '/healthz' ? health : many)); });
  const first = await bot.handle(command('boss', [{ name: 'name', value: 'Reshala' }]));
  const id = first.data.components[0].components[1].custom_id;
  const next = await bot.handle({ type: 3, user: { id: '123' }, data: { custom_id: id } });
  assert.equal(next.type, 7);
  assert.equal(calls.at(-1).searchParams.get('bossName'), 'Reshala');
});
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubscriptionStore } from './subscriptions.mjs';

const updates = (action, overrides = {}) => ({ ...command('updates', [{ name: action, type: 1 }]), guild_id: '999', channel_id: '888', channel: { type: 0 }, member: { user: { id: '123' }, permissions: '32' }, app_permissions: '3072', ...overrides });
async function fixtureStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'discord-subscriptions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createSubscriptionStore({ directory, now: () => now }) };
}

test('updates enforce guild, manager and bot permissions without touching API or storage', async () => {
  let touched = false;
  const bot = make(async () => { throw new Error('updates must not fetch archive'); }, { subscriptionStore: { enable() { touched = true; } } });
  for (const [overrides, expected] of [
    [{ guild_id: undefined }, /server channel/],
    [{ member: { permissions: '0' } }, /Manage Server/],
    [{ member: { permissions: 'malformed' } }, /Manage Server/],
    [{ app_permissions: '1024' }, /View Channel and Send Messages/],
    [{ app_permissions: undefined }, /View Channel and Send Messages/],
    [{ channel: { type: 11 } }, /standard server text/],
  ]) {
    const result = await bot.handle(updates('enable', overrides));
    assert.match(result.data.content, expected); assert.equal(result.data.flags, 64);
    assert.deepEqual(result.data.allowed_mentions, { parse: [] });
  }
  assert.equal(touched, false);
});

test('updates persist across restart, same channel enable is idempotent, changes get new revision', async t => {
  const { directory, store } = await fixtureStore(t);
  const bot = make(undefined, { subscriptionStore: store });
  assert.match((await bot.handle(updates('enable'))).data.content, /<#888>/);
  const first = await store.get('999');
  const restarted = createSubscriptionStore({ directory });
  assert.deepEqual(await restarted.get('999'), first);
  await bot.handle(updates('enable'));
  assert.equal((await store.get('999')).revision, first.revision);
  assert.match((await bot.handle(updates('status'))).data.content, /<#888>/);
  await bot.handle(updates('enable', { channel_id: '777', member: { permissions: '8' }, app_permissions: '8' }));
  const moved = await store.get('999'); assert.equal(moved.channelId, '777'); assert.notEqual(moved.revision, first.revision);
  await bot.handle(updates('disable', { app_permissions: '0' }));
  const disabled = await store.get('999'); assert.equal(disabled.enabled, false);
  await bot.handle(updates('disable'));
  assert.equal((await store.get('999')).revision, disabled.revision);
  await bot.handle(updates('enable'));
  assert.notEqual((await store.get('999')).revision, disabled.revision);
  const file = JSON.parse(await readFile(join(directory, '999.json'), 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['channelId', 'enabled', 'guildId', 'revision', 'updatedAt']);
  assert.deepEqual(await readdir(directory), ['999.json']);
});

test('subscription writes serialize same-server changes and reject path traversal', async t => {
  const { store } = await fixtureStore(t);
  await Promise.all([store.enable('999', '111'), store.enable('999', '222'), store.disable('999')]);
  assert.equal((await store.get('999')).channelId, '222');
  assert.equal((await store.get('999')).enabled, false);
  assert.throws(() => store.enable('../escape', '222'), /Invalid Discord server/);
  assert.throws(() => store.enable('999', 'bad'), /Invalid Discord channel/);
  assert.equal(await store.disable('111'), null);
});

test('updates fail privately when storage fails', async () => {
  const bot = make(undefined, { subscriptionStore: { enable: async () => { throw new Error('private path'); } } });
  const result = await bot.handle(updates('enable'));
  assert.equal(result.data.flags, 64); assert.match(result.data.content, /could not be saved/); assert.ok(!result.data.content.includes('private path'));
});

async function signedClient(t, bot) {
  const server = createServer(bot.request);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return (interaction, timestamp = now / 1000, invalidSignature = false) => {
    const body = JSON.stringify(interaction), stamp = String(timestamp);
    const signature = invalidSignature ? '0'.repeat(128) : sign(null, Buffer.from(stamp + body), pair.privateKey).toString('hex');
    return fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body, headers: { 'x-signature-timestamp': stamp, 'x-signature-ed25519': signature } });
  };
}

test('signed enable-disable-replay preserves disabled state and the original response', async t => {
  const { store } = await fixtureStore(t);
  const post = await signedClient(t, make(undefined, { subscriptionStore: store }));
  const enable = { ...updates('enable'), id: '101' };
  const original = await (await post(enable)).json();
  await post({ ...updates('disable'), id: '102' });
  const disabled = await store.get('999');
  assert.equal(disabled.enabled, false);
  assert.deepEqual(await (await post(enable)).json(), original);
  assert.deepEqual(await store.get('999'), disabled);
});

test('concurrent signed duplicates share one pending operation', async t => {
  let calls = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const store = { enable: async () => { calls++; await wait; return { channelId: '888' }; } };
  const post = await signedClient(t, make(undefined, { subscriptionStore: store }));
  const interaction = { ...updates('enable'), id: '201' };
  const pending = [post(interaction), post(interaction)];
  while (!calls) await new Promise(resolve => setTimeout(resolve, 1));
  release();
  const responses = await Promise.all(pending);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(calls, 1);
});

test('cache retains future timestamps through the inclusive validity boundary and fails closed at capacity', async t => {
  let clock = now, calls = 0;
  const bot = make(async () => { calls++; return new Response(JSON.stringify(health)); }, { now: () => clock, replayCacheLimit: 1 });
  const post = await signedClient(t, bot);
  const future = now / 1000 + 300;
  const interaction = { ...command('status'), id: '301' };
  const original = await (await post(interaction, future)).json();
  assert.equal(calls, 1);
  assert.equal((await post({ id: '302', type: 1 })).status, 503);
  clock = now + 600000;
  assert.deepEqual(await (await post(interaction, future)).json(), original);
  assert.equal(calls, 1);
  assert.equal((await post({ id: '302', type: 1 }, clock / 1000)).status, 503);
  clock++;
  assert.equal((await post(interaction, future)).status, 401);
  assert.equal((await post({ id: '302', type: 1 }, Math.floor(clock / 1000))).status, 200);
});

test('invalid signatures cannot poison cache and invalid IDs fail before handling', async t => {
  let calls = 0;
  const post = await signedClient(t, make(async () => { calls++; return new Response(JSON.stringify(health)); }, { replayCacheLimit: 1 }));
  const interaction = { ...command('status'), id: '401' };
  assert.equal((await post(interaction, now / 1000, true)).status, 401);
  for (const id of [undefined, null, 123, '', 'bad', '1'.repeat(21)]) {
    assert.equal((await post({ ...interaction, id })).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await post(interaction)).status, 200);
  assert.equal(calls, 1);
});

import { createReplayStore } from './replay.mjs';

test('durable mutation responses prevent enable replay after receiver restart and disable', async t => {
  const { directory, store } = await fixtureStore(t);
  const replayDirectory = join(directory, 'replays');
  const newBot = () => make(undefined, { subscriptionStore: store, replayStore: createReplayStore({ directory: replayDirectory, now: () => now }) });
  const first = await signedClient(t, newBot());
  const enable = { ...updates('enable'), id: '501' };
  const original = await (await first(enable)).json();
  await first({ ...updates('disable'), id: '502' });
  const disabled = await store.get('999');
  const restarted = await signedClient(t, newBot());
  assert.deepEqual(await (await restarted(enable)).json(), original);
  assert.deepEqual(await store.get('999'), disabled);
  const record = JSON.parse(await readFile(join(replayDirectory, '501.json'), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['expires', 'response', 'state']);
});

test('durable replay storage fails closed on disk errors and incomplete operations', async t => {
  const { directory } = await fixtureStore(t);
  const blocked = join(directory, 'not-a-directory');
  await (await import('node:fs/promises')).writeFile(blocked, 'fixture');
  let touched = 0;
  const post = await signedClient(t, make(undefined, { replayStore: createReplayStore({ directory: blocked }), subscriptionStore: { enable: async () => { touched++; } } }));
  assert.equal((await post({ ...updates('enable'), id: '601' })).status, 503);
  assert.equal(touched, 0);
  const replayDirectory = join(directory, 'replays');
  const store = createReplayStore({ directory: replayDirectory, now: () => now });
  assert.equal((await store.run('602', now + 300000, async () => { touched++; throw new Error('crash after mutation'); })).status, 503);
  const restarted = createReplayStore({ directory: replayDirectory, now: () => now });
  assert.equal((await restarted.run('602', now + 300000, async () => { touched++; })).status, 503);
  assert.equal(touched, 1);
});

test('durable replay expiry is inclusive and cleanup bounds files', async t => {
  const { directory } = await fixtureStore(t);
  const replayDirectory = join(directory, 'replays');
  let clock = now;
  const store = createReplayStore({ directory: replayDirectory, now: () => clock, limit: 1 });
  const response = { type: 4, data: { content: 'fixture' } };
  assert.equal((await store.run('701', now + 600000, async () => response)).status, 200);
  clock += 600000;
  assert.equal((await store.run('702', clock + 300000, async () => response)).status, 503);
  clock++;
  assert.equal((await store.run('702', clock + 300000, async () => response)).status, 200);
  assert.deepEqual(await readdir(replayDirectory), ['702.json']);
});

test('idle pruning removes expired responses and pending tombstones without a new interaction', async t => {
  const { directory } = await fixtureStore(t);
  const replayDirectory = join(directory, 'replays');
  let clock = now;
  const store = createReplayStore({ directory: replayDirectory, now: () => clock });
  await store.run('801', now + 1000, async () => ({ type: 1 }));
  await store.run('802', now + 1000, async () => { throw new Error('interrupted'); });
  clock += 1000;
  await store.prune();
  assert.equal((await readdir(replayDirectory)).length, 2);
  clock++;
  assert.equal(await store.prune(), true);
  assert.deepEqual(await readdir(replayDirectory), []);
});

test('prune serializes with operations and expired queued mutations fail closed', async t => {
  const { directory } = await fixtureStore(t);
  const replayDirectory = join(directory, 'replays');
  let clock = now, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const store = createReplayStore({ directory: replayDirectory, now: () => clock });
  const pending = store.run('901', now + 10000, async () => { entered(); await blocked; return { type: 1 }; });
  await started;
  const pruning = store.prune();
  let touched = false;
  const stale = store.run('902', now + 1000, async () => { touched = true; return { type: 1 }; });
  clock += 1001;
  release();
  assert.equal((await pending).status, 200);
  assert.equal(await pruning, true);
  assert.equal((await stale).status, 503);
  assert.equal(touched, false);
  assert.deepEqual(await readdir(replayDirectory), ['901.json']);
});
