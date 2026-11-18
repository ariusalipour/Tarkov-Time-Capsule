import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = value => typeof value === 'string' && /^\d{1,24}$/.test(value);
export function createSubscriptionStore({ directory = '/data/subscriptions', now = Date.now } = {}) {
  const pending = new Map();
  const path = guildId => {
    if (!validId(guildId)) throw new Error('Invalid Discord server ID');
    return join(directory, `${guildId}.json`);
  };
  async function get(guildId) {
    try {
      const saved = JSON.parse(await readFile(path(guildId), 'utf8'));
      if (saved.guildId !== guildId || !validId(saved.channelId) || typeof saved.enabled !== 'boolean' || typeof saved.revision !== 'string' || !Number.isFinite(Date.parse(saved.updatedAt))) throw new Error('Invalid subscription');
      return saved;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function update(guildId, change) {
    path(guildId);
    const operation = (pending.get(guildId) || Promise.resolve()).catch(() => {}).then(async () => {
      const previous = await get(guildId), next = change(previous);
      if (next === previous) return previous;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = join(directory, `.${guildId}-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(temp, path(guildId));
      } finally { await unlink(temp).catch(() => {}); }
      return next;
    });
    pending.set(guildId, operation);
    operation.finally(() => { if (pending.get(guildId) === operation) pending.delete(guildId); }).catch(() => {});
    return operation;
  }
  return {
    get,
    enable(guildId, channelId) {
      if (!validId(channelId)) throw new Error('Invalid Discord channel ID');
      return update(guildId, previous => previous?.enabled && previous.channelId === channelId ? previous : { guildId, channelId, enabled: true, revision: randomUUID(), updatedAt: new Date(now()).toISOString() });
    },
    disable(guildId) {
      return update(guildId, previous => !previous?.enabled ? previous : { ...previous, enabled: false, revision: randomUUID(), updatedAt: new Date(now()).toISOString() });
    }
  };
}

function hasPermission(value, requested) {
  try { const permissions = BigInt(value); return (permissions & 8n) === 8n || (permissions & requested) === requested; } catch { return false; }
}
export async function manageUpdates(interaction, store) {
  if (!interaction.guild_id || !interaction.member) return 'Use /updates in a server channel.';
  if (!hasPermission(interaction.member.permissions, 32n)) return 'You need Manage Server permission to configure change updates.';
  const action = interaction.data?.options?.[0]?.name;
  if (!['enable', 'disable', 'status'].includes(action)) return 'Use /updates enable, /updates disable or /updates status.';
  if (action === 'enable') {
    if (!validId(interaction.channel_id)) return 'Run this command in the text channel that should receive updates.';
    if (interaction.channel?.type !== undefined && ![0, 5].includes(interaction.channel.type)) return 'Choose a standard server text or announcement channel for updates.';
    if (!hasPermission(interaction.app_permissions, 1024n | 2048n)) return 'Give the bot View Channel and Send Messages permissions in this channel, then try again.';
    const saved = await store.enable(interaction.guild_id, interaction.channel_id);
    return `Spawn-chance-change updates are enabled in <#${saved.channelId}>. Only changes will be posted; new destinations start from the current collection. Use /updates disable to stop them.`;
  }
  if (action === 'disable') {
    await store.disable(interaction.guild_id);
    return 'Spawn-chance-change updates are disabled for this server.';
  }
  const saved = await store.get(interaction.guild_id);
  return saved?.enabled ? `Spawn-chance-change updates are enabled in <#${saved.channelId}>. No daily summaries are scheduled.` : 'Spawn-chance-change updates are disabled. Run /updates enable in the channel that should receive changes.';
}
