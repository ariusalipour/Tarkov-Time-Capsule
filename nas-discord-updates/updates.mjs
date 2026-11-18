import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function config(env = process.env) {
  const mode = env.UPDATES_MODE || 'webhook';
  if (!['bot', 'webhook'].includes(mode)) throw new Error('Invalid UPDATES_MODE');
  const dailyTime = env.UPDATES_DAILY_TIME || '09:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('Invalid UPDATES_DAILY_TIME');
  const timezone = env.UPDATES_TIMEZONE || 'Europe/London';
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format();
  return {
    mode,
    subscriptionsDir: env.UPDATES_SUBSCRIPTIONS_DIR || '/data/subscriptions',
    deliveryDir: env.UPDATES_DELIVERY_DIR || '/data/delivery',
    botTokenFile: env.DISCORD_BOT_TOKEN_FILE || '/run/secrets/discord_bot_token',
    enabled: env.UPDATES_ENABLED === 'true', dryRun: env.UPDATES_DRY_RUN !== 'false',
    daily: env.UPDATES_DAILY !== 'false', changes: env.UPDATES_CHANGES !== 'false', dailyTime, timezone,
    apiUrl: env.UPDATES_API_URL || 'http://app:3000',
    publicUrl: env.UPDATES_PUBLIC_URL || 'https://tarkovcapsule.mockachino.app/',
    statePath: env.UPDATES_STATE_PATH || '/data/discord-updates.json',
    webhook: env.DISCORD_UPDATES_WEBHOOK_URL, webhookFile: env.DISCORD_UPDATES_WEBHOOK_FILE,
  };
}

export function localSlot(now, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export async function readState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Update state unreadable; refusing to reset baseline'); }
}
export async function writeState(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

export async function snapshot(cfg, now, fetcher = fetch) {
  const get = async path => {
    const response = await fetcher(new URL(path, cfg.apiUrl), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`NAS API returned ${response.status}`);
    return response.json();
  };
  const health = await get('/healthz');
  const timestamp = health.database?.latestTimestamp;
  const age = now.getTime() - Date.parse(timestamp);
  if (health.status !== 'ok' || health.database?.stale !== false || !Number.isFinite(age) || age > 7200000 || age < -300000) {
    throw new Error('Latest collection is missing or stale; no update sent');
  }
  // Query the exact recorded instant, not a rolling one-hour endpoint which can combine snapshots.
  const query = new URLSearchParams({ startDate: timestamp, endDate: timestamp });
  const rows = await get(`/api/spawnchance?${query}`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Latest collection is empty; no update sent');
  const values = {};
  for (const row of rows) {
    if (Date.parse(row.Timestamp) !== Date.parse(timestamp) || typeof row.MapName !== 'string' || typeof row.BossName !== 'string' ||
      typeof row.Chance !== 'number' || !Number.isFinite(row.Chance) || row.Chance < 0) throw new Error('Invalid latest collection');
    const key = `${row.MapName} / ${row.BossName}`;
    if (Object.hasOwn(values, key)) throw new Error('Duplicate latest collection entry');
    values[key] = row.Chance;
  }
  const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  return { timestamp, values: sorted, hash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex') };
}

const safe = value => String(value).replace(/[@`*_~|<>\r\n]/g, '');
const percent = value => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(value * 100)}%`;
export function message(current, previous, daily, publicUrl) {
  const changes = Object.entries(current.values).filter(([key, value]) => previous.values[key] !== value);
  const removed = Object.keys(previous.values).filter(key => !Object.hasOwn(current.values, key));
  const entries = daily ? Object.entries(current.values) : changes;
  let content = `**Tarkov Time Capsule — ${daily ? 'daily summary' : 'spawn chance changes'}**\nObserved: ${safe(current.timestamp)}\n`;
  let shown = 0;
  for (const [key, value] of entries) {
    const before = previous.values[key];
    const line = `${safe(key)}: ${percent(value)}${!daily && before !== undefined ? ` (was ${percent(before)})` : ''}\n`;
    if (content.length + line.length > 1650) break;
    content += line; shown++;
  }
  if (shown < entries.length) content += `+ ${entries.length - shown} more entries on the website.\n`;
  if (removed.length) content += `${removed.length} previously observed entries absent from this snapshot; absence does not mean 0%.\n`;
  content += `History: ${publicUrl}`;
  return { content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
}

export async function send(webhook, body, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const url = new URL(webhook);
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) throw new Error('Invalid Discord webhook URL');
  url.searchParams.set('wait', 'true');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Discord delivery uncertain; check channel before clearing pending state'); }
    if (response.ok) return;
    if (response.status !== 429 || attempt === 2) throw new Error(`Discord delivery returned ${response.status}`);
    const data = await response.json();
    const seconds = Number(data.retry_after);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error('Discord retry exceeds bounded delivery window');
    await sleep(Math.max(100, seconds * 1000));
  }
}

export async function sendBot(channelId, token, body, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!/^\d+$/.test(channelId) || !token || /\s/.test(token)) throw new Error('Invalid Discord bot delivery configuration');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
        body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Discord delivery uncertain; check channel before clearing pending state'); }
    if (response.ok) return;
    if (response.status !== 429 || attempt === 2) throw new Error(`Discord delivery returned ${response.status}`);
    const seconds = Number((await response.json()).retry_after);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error('Discord retry exceeds bounded delivery window');
    await sleep(Math.max(100, seconds * 1000));
  }
}

async function subscription(directory, guildId) {
  const value = await readState(join(directory, `${guildId}.json`));
  if (!value) return null;
  if (value.guildId !== guildId || !/^\d+$/.test(value.channelId) || typeof value.enabled !== 'boolean' ||
    typeof value.revision !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.revision)) throw new Error('Invalid subscription');
  return value;
}

// Each destination owns its own delivery state. A failed destination never blocks others.
export async function tickSubscriptions(cfg, { now = new Date(), fetcher = fetch, deliver = sendBot, log = console.info } = {}) {
  if (!cfg.enabled) return 'disabled';
  let names;
  try { names = await readdir(cfg.subscriptionsDir); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Subscriptions directory unreadable'); }
  const results = {};
  let currentPromise;
  let tokenPromise;
  const hour = Math.floor(now.getTime() / 3600000);
  for (const name of names.sort()) {
    if (!/^\d+\.json$/.test(name)) continue;
    const guildId = name.slice(0, -5);
    try {
      const selected = await subscription(cfg.subscriptionsDir, guildId);
      if (!selected?.enabled) { results[guildId] = 'disabled'; continue; }
      const path = join(cfg.deliveryDir, `${guildId}-${selected.revision}.json`);
      const previous = await readState(path);
      if (previous?.pending) { results[guildId] = 'pending-review'; continue; }
      if (previous?.hour === hour) { results[guildId] = 'not-due'; continue; }
      // One consistent snapshot per poll, including when a destination fails.
      currentPromise ??= snapshot(cfg, now, fetcher);
      const current = await currentPromise;
      const snapshotHour = Math.floor(Date.parse(current.timestamp) / 3600000);
      if (previous && snapshotHour < hour) { results[guildId] = 'awaiting-collection'; continue; }
      const next = { ...current, hour: snapshotHour >= hour ? hour : snapshotHour,
        guildId, channelId: selected.channelId, revision: selected.revision };
      if (!previous) {
        if (!cfg.dryRun) await writeState(path, next);
        results[guildId] = 'baseline'; continue;
      }
      if (current.hash === previous.hash || current.timestamp === previous.timestamp) {
        if (!cfg.dryRun) await writeState(path, next);
        results[guildId] = 'unchanged'; continue;
      }
      const body = message(current, previous, false, cfg.publicUrl);
      if (cfg.dryRun) { log({ guildId, ...body }); results[guildId] = 'dry-run'; continue; }
      tokenPromise ??= readFile(cfg.botTokenFile, 'utf8').then(value => value.trim());
      const token = await tokenPromise;
      // Check after all network/config work, just before committing intent and sending.
      const latest = await subscription(cfg.subscriptionsDir, guildId);
      if (!latest?.enabled || latest.revision !== selected.revision || latest.channelId !== selected.channelId) {
        results[guildId] = 'subscription-changed'; continue;
      }
      await writeState(path, { ...previous, pending: { timestamp: current.timestamp, at: now.toISOString() } });
      // Recheck after persisting intent too, to cover changes during the filesystem write.
      const active = await subscription(cfg.subscriptionsDir, guildId);
      if (!active?.enabled || active.revision !== selected.revision || active.channelId !== selected.channelId) {
        await writeState(path, previous); results[guildId] = 'subscription-changed'; continue;
      }
      await deliver(selected.channelId, token, body, fetcher);
      await writeState(path, next);
      results[guildId] = 'sent';
    } catch (error) {
      results[guildId] = 'review-required';
      // Only controlled error text: no request objects, response bodies or credentials.
      log(`Discord updates guild ${guildId}: ${error.code === 'EACCES' ? 'state access denied' : 'delivery or state requires review'}`);
    }
  }
  return results;
}

export async function tick(cfg, { now = new Date(), fetcher = fetch, deliver = send, log = console.info } = {}) {
  if (cfg.mode === 'bot') return tickSubscriptions(cfg, { now, fetcher, log });
  if (!cfg.enabled) return 'disabled';
  const previous = await readState(cfg.statePath);
  if (previous?.pending) return 'pending-review';
  const slot = localSlot(now, cfg.timezone);
  const hour = Math.floor(now.getTime() / 3600000);
  const daily = cfg.daily && slot.time >= cfg.dailyTime && previous?.dailyDate !== slot.date;
  if (previous && !daily && (!cfg.changes || previous.hour === hour)) return 'not-due';
  const current = await snapshot(cfg, now, fetcher);
  // Collection and this poll can start together at :00. Do not consume this hour
  // until its committed snapshot exists; keep polling while the collector runs.
  const snapshotHour = Math.floor(Date.parse(current.timestamp) / 3600000);
  const ready = snapshotHour >= hour;
  if (previous && cfg.changes && !daily && !ready) return 'awaiting-collection';
  const next = { ...current, hour: ready ? hour : previous?.hour ?? snapshotHour,
    dailyDate: daily ? slot.date : previous?.dailyDate ?? null };
  if (!previous) { if (!cfg.dryRun) await writeState(cfg.statePath, next); return 'baseline'; }
  const changed = cfg.changes && current.hash !== previous.hash && current.timestamp !== previous.timestamp;
  if (!daily && !changed) { if (!cfg.dryRun) await writeState(cfg.statePath, next); return 'unchanged'; }
  const body = message(current, previous, daily, cfg.publicUrl);
  if (cfg.dryRun) { log(body); return 'dry-run'; }
  const webhook = cfg.webhookFile ? (await readFile(cfg.webhookFile, 'utf8')).trim() : cfg.webhook;
  if (!webhook) throw new Error('Discord update webhook is not configured');
  // Persist intent before sending. After a crash or ambiguous response, require review rather than duplicate posts.
  await writeState(cfg.statePath, { ...previous, pending: { timestamp: current.timestamp, at: now.toISOString() } });
  await deliver(webhook, body, fetcher);
  await writeState(cfg.statePath, next);
  return 'sent';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = config();
  let stopping = false;
  let wake;
  const stop = () => { stopping = true; wake?.(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  do {
    try { console.info('Scheduled updates:', await tick(cfg)); }
    catch (error) { console.error(error.message); }
    if (process.argv.includes('--once') || !cfg.enabled || stopping) break;
    await new Promise(resolve => {
      const timer = setTimeout(() => { wake = undefined; resolve(); }, 30000);
      wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
    });
  } while (!stopping);
}
