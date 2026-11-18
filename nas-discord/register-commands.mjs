// Explicit operator action only. Runtime never registers commands.
import { readFile } from 'node:fs/promises';
const applicationId = process.env.DISCORD_APPLICATION_ID;
if (!/^\d+$/.test(applicationId || '')) throw new Error('Set DISCORD_APPLICATION_ID');
const token = (await readFile(process.env.DISCORD_BOT_TOKEN_FILE || '/run/secrets/discord_bot_token', 'utf8')).trim();
const commands = JSON.parse(await readFile(new URL('./commands.json', import.meta.url), 'utf8'));
async function request(path, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...options, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
  return response.json();
}
const application = await request('/applications/@me');
if (application.id !== applicationId) throw new Error('Token belongs to a different application');
if (process.argv.includes('--apply')) {
  await request(`/applications/${applicationId}/commands`, { method: 'PUT', body: JSON.stringify(commands) });
}
const registered = await request(`/applications/${applicationId}/commands`);
console.log(JSON.stringify({ applicationId, applied: process.argv.includes('--apply'), commands: registered.map(c => ({ name: c.name, options: c.options, default_member_permissions: c.default_member_permissions })) }, null, 2));
if (process.argv.includes('--apply') && commands.some(c => !registered.some(r => r.name === c.name))) throw new Error('Command verification failed');
