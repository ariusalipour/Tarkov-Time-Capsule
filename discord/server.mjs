import { createServer } from 'node:http';
import { createPublicKey, createHmac, timingSafeEqual, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createSubscriptionStore, manageUpdates } from './subscriptions.mjs';

const clean = value => String(value ?? '').replace(/[\\`*_~|<>@]/g, '').replace(/[\r\n]/g, ' ').slice(0, 100);
const message = (content, ephemeral = false) => ({ type: 4, data: { content: content.slice(0, 1900), allowed_mentions: { parse: [] }, ...(ephemeral ? { flags: 64 } : {}) } });
const ownerOf = i => i.member?.user?.id || i.user?.id;
const toMillis = value => typeof value === 'number' ? value * 1000 : Date.parse(value);

export function createBot({ publicKey, componentSecret, apiBase = 'http://app:3000', publicAppUrl = 'https://tarkovcapsule.mockachino.app', fetchImpl = fetch, now = Date.now, deadlineMs = 1700, subscriptionStore = createSubscriptionStore() }) {
  if (!/^[a-f\d]{64}$/i.test(publicKey || '')) throw new Error('DISCORD_PUBLIC_KEY must be 64 hexadecimal characters');
  if (!componentSecret || componentSecret.length < 32) throw new Error('DISCORD_COMPONENT_SECRET must contain at least 32 characters');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
  const sign = text => createHmac('sha256', componentSecret).update(text).digest('base64url').slice(0, 16);
  const filters = new Map();
  const appLink = new URL(publicAppUrl).href;
  const component = (owner, page, stamp, boss) => {
    const filter = boss ? sign(boss).slice(0, 10) : '-';
    if (boss) { filters.set(filter, { boss, issued: stamp }); if (filters.size > 1000) filters.delete(filters.keys().next().value); }
    const payload = `b:${owner}:${page}:${stamp}:${filter}`; return `${payload}:${sign(payload)}`;
  };
  function parseComponent(id, owner) {
    const parts = String(id).split(':');
    if (parts.length !== 6 || parts[0] !== 'b' || parts[1] !== owner || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3])) return null;
    const expected = Buffer.from(sign(parts.slice(0, 5).join(':'))), actual = Buffer.from(parts[5]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || Math.abs(now() / 1000 - Number(parts[3])) > 900) return null;
    const saved = filters.get(parts[4]);
    if (parts[4] !== '-' && (!saved || now() / 1000 - saved.issued > 900)) return null;
    return { page: Number(parts[2]), boss: saved?.boss || null };
  }
  async function handle(interaction) {
    if (interaction.type === 1) return { type: 1 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    const json = async path => {
      const response = await fetchImpl(new URL(path, apiBase), { signal: controller.signal });
      if (!response.ok) throw new Error('Archive unavailable');
      return response.json();
    };
    try {
      if (interaction.type === 4) {
        if (interaction.data?.name !== 'boss') return { type: 8, data: { choices: [] } };
        const query = String(interaction.data.options?.find(o => o.focused)?.value || '').toLowerCase();
        const names = await json('/api/bosses');
        return { type: 8, data: { choices: names.filter(n => String(n).toLowerCase().includes(query)).slice(0, 25).map(n => ({ name: clean(n), value: String(n).slice(0, 100) })) } };
      }
      const name = interaction.data?.name;
      if (interaction.type === 2 && name === 'updates') {
        try { return message(await manageUpdates(interaction, subscriptionStore), true); }
        catch { return message('Update settings could not be saved. Please try again shortly or contact the server administrator.', true); }
      }
      if (name === 'ping') return message('Tarkov Time Capsule is responding. Use /status to check collection.');
      if (name === 'hello') return message('Use /boss to look up a boss, /bosses to browse chances, or /status to check freshness. Server managers can use /updates enable in a channel to post spawn-chance changes. Values are archived observations, not live guarantees.\nTerms: https://mockachino.app/projects/tarkov-time-capsule/terms/\nPrivacy: https://mockachino.app/projects/tarkov-time-capsule/privacy/\nSupport and deletion requests: app@outdoortechnica.com');
      if (interaction.type !== 2 && interaction.type !== 3) return message('Unsupported interaction.', true);
      let page = 0, savedBoss = null;
      if (interaction.type === 3) {
        const parsed = parseComponent(interaction.data?.custom_id, ownerOf(interaction));
        if (parsed === null || parsed.page > 1000) return message('These controls expired or belong to another user. Run the command again.', true);
        page = parsed.page; savedBoss = parsed.boss;
      } else if (!['boss', 'bosses', 'status'].includes(name)) return message('Unknown command. Use /hello for help.', true);
      const health = await json('/healthz');
      const stamp = health.database?.latestTimestamp;
      const latest = toMillis(stamp);
      const freshness = Number.isFinite(latest) ? `Last observation: ${new Date(latest).toISOString()}${now() - latest > 7200000 ? ' — STALE (over 2 hours old)' : ''}` : 'No observations have been archived yet.';
      if (name === 'status') return message(`${freshness}\nHourly collection: ${health.collection?.enabled ? 'enabled' : 'paused'}${health.collection?.lastError ? '\nThe last collection failed; check API logs.' : ''}\nArchived observations: ${Number(health.database?.counts?.SpawnChances || 0).toLocaleString('en-US')}.\n${appLink}`);
      if (!Number.isFinite(latest)) return message(freshness);
      const boss = savedBoss || (name === 'boss' ? interaction.data.options?.find(o => o.name === 'name')?.value : null);
      if (name === 'boss' && (typeof boss !== 'string' || !boss.trim() || boss.length > 100)) return message('Choose a boss name using autocomplete.', true);
      const query = new URLSearchParams({ startDate: new Date(latest - 1).toISOString(), endDate: new Date(latest + 1).toISOString() });
      if (boss) query.set('bossName', boss);
      const rows = await json(`/api/spawnchance?${query}`);
      if (!Array.isArray(rows)) throw new Error('Invalid archive response');
      const latestRows = new Map();
      for (const row of rows) {
        if (row.Chance === null || row.Chance === '' || !Number.isFinite(Number(row.Chance)) || !Number.isFinite(toMillis(row.Timestamp))) continue;
        const id = `${row.BossName}\0${row.MapName}`, previous = latestRows.get(id);
        if (!previous || toMillis(row.Timestamp) > toMillis(previous.Timestamp)) latestRows.set(id, row);
      }
      const lines = [...latestRows.values()].sort((a, b) => `${a.BossName}/${a.MapName}`.localeCompare(`${b.BossName}/${b.MapName}`)).map(row => `**${clean(row.BossName)}** · ${clean(row.MapName)}: **${Number((Number(row.Chance) * 100).toFixed(2))}%**`);
      if (!lines.length) return message(`${freshness}\nNo observation${boss ? ` for ${clean(boss)}` : ''} in the latest collection. Missing data does not mean a 0% spawn chance.`);
      // Pack by character count rather than assuming a fixed number of maps/bosses.
      const pages = [''];
      for (const line of lines) { if (pages.at(-1).length + line.length > 1400) pages.push(''); pages[pages.length - 1] += `${line}\n`; }
      page = Math.min(page, pages.length - 1);
      const response = message(`${freshness}\n${pages[page]}\nPage ${page + 1}/${pages.length} · PvP / regular · Archived chances, not live guarantees.\n${appLink}`);
      if (interaction.type === 3) response.type = 7;
      if (pages.length > 1) {
        const owner = ownerOf(interaction), issued = Math.floor(now() / 1000);
        if (owner && /^\d+$/.test(owner)) response.data.components = [{ type: 1, components: [{ type: 2, style: 2, label: 'Previous', custom_id: component(owner, Math.max(0, page - 1), issued, boss), disabled: page === 0 }, { type: 2, style: 2, label: 'Next', custom_id: component(owner, page + 1, issued, boss), disabled: page === pages.length - 1 }] }];
      } else response.data.components = [];
      return response;
    } catch {
      if (interaction.type === 4) return { type: 8, data: { choices: [] } };
      return message('The archive could not respond in time. Please try again shortly or check /status.', true);
    } finally { clearTimeout(timer); }
  }
  async function request(req, res) {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/healthz') return send(200, { status: 'ok', service: 'discord-interactions' });
    if (!['/interactions', '/discord/interactions'].includes(req.url)) return send(404, { error: 'Not found' });
    if (req.method !== 'POST') return send(405, { error: 'POST required' });
    const timestamp = req.headers['x-signature-timestamp'], signature = req.headers['x-signature-ed25519'];
    if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > 300 || typeof signature !== 'string' || !/^[a-f\d]{128}$/i.test(signature)) return send(401, { error: 'Invalid signature' });
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 65536) return send(413, { error: 'Request too large' }); chunks.push(chunk); }
      const raw = Buffer.concat(chunks);
      if (!verify(null, Buffer.concat([Buffer.from(timestamp), raw]), key, Buffer.from(signature, 'hex'))) return send(401, { error: 'Invalid signature' });
      let interaction;
      try { interaction = JSON.parse(raw.toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); }
      if (!interaction || typeof interaction !== 'object') return send(400, { error: 'Invalid interaction' });
      return send(200, await handle(interaction));
    } catch { if (!res.headersSent) send(400, { error: 'Invalid request' }); }
  }
  return { request, handle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const componentSecret = process.env.DISCORD_COMPONENT_SECRET_FILE ? readFileSync(process.env.DISCORD_COMPONENT_SECRET_FILE, 'utf8').trim() : process.env.DISCORD_COMPONENT_SECRET;
  const bot = createBot({ publicKey: process.env.DISCORD_PUBLIC_KEY, componentSecret, apiBase: process.env.API_BASE_URL, publicAppUrl: process.env.PUBLIC_APP_URL, subscriptionStore: createSubscriptionStore({ directory: process.env.DISCORD_SUBSCRIPTIONS_DIR || '/data/subscriptions' }) });
  const server = createServer(bot.request);
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.info('Discord interactions listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
