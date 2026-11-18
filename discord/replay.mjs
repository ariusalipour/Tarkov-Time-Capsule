import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// One receiver owns this directory. Store only IDs, expiry and response payloads;
// never request bodies, signature material or interaction tokens.
export function createReplayStore({ directory, now = Date.now, limit = 10000 } = {}) {
  if (!directory || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid replay store configuration');
  let queue = Promise.resolve();
  const unavailable = () => ({ status: 503, body: { error: 'Interaction could not be safely processed; retry shortly' } });
  function enqueue(operation) {
    const result = queue.catch(() => {}).then(operation);
    queue = result;
    return result;
  }
  async function cleanup() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const active = new Map();
    for (const name of await readdir(directory)) {
      if (/^\.\d{1,20}\.tmp$/.test(name)) { await unlink(join(directory, name)); continue; }
      if (!/^\d{1,20}\.json$/.test(name)) throw new Error('Unexpected replay store entry');
      const saved = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (!Number.isFinite(saved.expires) || !['pending', 'complete'].includes(saved.state) || (saved.state === 'complete' && !saved.response)) throw new Error('Invalid replay record');
      if (saved.expires < now()) await unlink(join(directory, name));
      else active.set(name.slice(0, -5), saved);
    }
    return active;
  }
  function prune() { return enqueue(cleanup).then(() => true, () => false); }
  async function run(id, expires, operation) {
    if (!/^\d{1,20}$/.test(id) || !Number.isFinite(expires)) throw new Error('Invalid replay record');
    return enqueue(async () => {
      if (expires < now()) return unavailable();
      const active = await cleanup();
      const path = join(directory, `${id}.json`), temp = join(directory, `.${id}.tmp`);
      const save = async value => {
        try {
          await writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
          await rename(temp, path);
        } finally { await unlink(temp).catch(() => {}); }
      };
      const previous = active.get(id);
      if (previous) {
        if (expires > previous.expires) await save({ ...previous, expires });
        return previous.state === 'complete' ? { status: 200, body: previous.response } : unavailable();
      }
      if (active.size >= limit) return unavailable();
      // An interrupted operation leaves a tombstone: retrying cannot repeat a
      // mutation whose outcome might already have been persisted elsewhere.
      await save({ expires, state: 'pending' });
      // Disk work or a queue ahead of this request must not extend signature validity.
      if (expires < now()) return unavailable();
      const response = await operation();
      await save({ expires, state: 'complete', response });
      return { status: 200, body: response };
    }).catch(() => unavailable());
  }
  return { run, prune };
}
