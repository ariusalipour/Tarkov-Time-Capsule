import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep, extname } from 'node:path';
import { LocalDatabase, initializeDatabase } from './database.mjs';
import { createCollector, startHourlyScheduler } from './scheduler.mjs';
import { fetchMaps, upstreamSource } from './upstream.mjs';
import { handleApiRequest } from './handlers.mjs';
import { processAndInsertData } from './database.mjs';

const databasePath = resolve(process.env.DATABASE_PATH || '/data/tarkov-time-capsule.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const db = new LocalDatabase(databasePath);
initializeDatabase(db);
const staticRoot = resolve(process.env.STATIC_DIR || '/app/web');
const enabled = process.env.SCHEDULER_ENABLED === 'true';
const collector = createCollector({
  enabled,
  fetchData: () => fetchMaps(),
  transaction: (callback) => db.transaction(callback),
  storeData: (data) => processAndInsertData(data, db),
});
const stopScheduler = startHourlyScheduler(collector);
console.info('Collector upstream', upstreamSource);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const routes = new Set(['/api/maps', '/api/bosses', '/api/spawnchance', '/api/latestspawnchance']);
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url || '/', 'http://localhost');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(incoming.method || '')) {
      outgoing.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }); outgoing.end(); return;
    }
    if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' }); outgoing.end(); return; }
    if (url.pathname === '/healthz') {
      const counts = Object.fromEntries(['Bosses', 'Maps', 'Timestamps', 'SpawnChances'].map(table => [table, db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
      const latest = db.sqlite.prepare('SELECT MAX(Timestamp) AS timestamp FROM Timestamps').get().timestamp;
      outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      const ageSeconds = latest === null ? null : Math.max(0, Date.now() / 1000 - Number(latest));
      outgoing.end(incoming.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', database: { counts, latestTimestamp: latest === null ? null : new Date(Number(latest) * 1000).toISOString(), ageSeconds, stale: ageSeconds === null || ageSeconds > 7200 }, collection: { ...collector.state, source: upstreamSource } })); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!routes.has(url.pathname)) { outgoing.writeHead(404); outgoing.end(); return; }
      const response = await handleApiRequest(new Request(url, { method: 'GET' }), db);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer())); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) { outgoing.writeHead(400); outgoing.end(); return; }
    let file = resolve(staticRoot, '.' + pathname);
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) { outgoing.writeHead(403); outgoing.end(); return; }
    try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); }
    catch { if (!extname(pathname)) file = resolve(staticRoot, 'index.html'); }
    const canonical = await realpath(file);
    const canonicalRoot = await realpath(staticRoot);
    if (!canonical.startsWith(canonicalRoot + sep)) { outgoing.writeHead(403); outgoing.end(); return; }
    const contents = await readFile(canonical);
    outgoing.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404 : error instanceof URIError ? 400 : 500;
    if (status === 500) console.error('HTTP request failed', error);
    outgoing.writeHead(status); outgoing.end(status === 500 ? 'Internal server error' : 'Not found');
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.info(`Listening on ${port}; hourly collection ${enabled ? 'enabled' : 'disabled'}`));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true; stopScheduler();
  const deadline = setTimeout(() => process.exit(1), 40000); deadline.unref();
  await new Promise<void>(done => server.close(() => done()));
  await collector.wait(); db.close(); clearTimeout(deadline);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
