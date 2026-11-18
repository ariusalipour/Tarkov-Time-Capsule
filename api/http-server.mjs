import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { handleApiRequest, MAX_QUERY_LENGTH } from './handlers.mjs';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const routes = new Set(['/api/maps', '/api/bosses', '/api/spawnchance', '/api/latestspawnchance', '/api/history', '/api/history/summary']);

// Socket addresses are the trust boundary: forwarded headers cannot buy a new budget.
// A bounded global bucket also covers traffic multiplexed by a reverse proxy.
export function createQueryLimiter({ now = Date.now, globalBurst = 30, globalPerMinute = 120, addressBurst = 15, addressPerMinute = 60, maxAddresses = 1024 } = {}) {
  const addresses = new Map();
  let global = { tokens: globalBurst, at: now() };
  function refill(bucket, burst, rate, time) {
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, time - bucket.at) * rate / 60000);
    bucket.at = time;
  }
  return address => {
    const time = now();
    refill(global, globalBurst, globalPerMinute, time);
    let bucket = addresses.get(address);
    if (!bucket) {
      if (addresses.size >= maxAddresses) addresses.delete(addresses.keys().next().value);
      bucket = { tokens: addressBurst, at: time };
    }
    addresses.delete(address); addresses.set(address, bucket);
    refill(bucket, addressBurst, addressPerMinute, time);
    if (global.tokens < 1 || bucket.tokens < 1) return false;
    global.tokens--; bucket.tokens--;
    return true;
  };
}

export function createHttpServer({ db, collector, staticRoot, source, now = Date.now, edgeRateLimited = false, queryLimiter = createQueryLimiter({ now, ...(edgeRateLimited ? { addressBurst: 30, addressPerMinute: 120 } : {}) }) }) {
  // With verified edge enforcement, retain global containment without imposing a
  // second, tighter shared-address budget on tunnel traffic. Never trust client headers.
  // Aggregations scan the archive in SQLite: bound their shared CPU budget separately.
  const summaryLimiter = createQueryLimiter({ now, globalBurst: 3, globalPerMinute: 12, addressBurst: 3, addressPerMinute: 12 });
  let cachedHealth;
  let healthAt = -Infinity;
  let healthVersion;
  const server = createServer(async (incoming, outgoing) => {
    for (const [name, value] of Object.entries(securityHeaders)) outgoing.setHeader(name, value);
    const json = (status, value, headers = {}) => {
      outgoing.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      outgoing.end(incoming.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    try {
      if ((incoming.url || '').length > MAX_QUERY_LENGTH + 256) { json(400, { error: 'URL is too long.' }); return; }
      const url = new URL(incoming.url || '/', 'http://localhost');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(incoming.method || '')) {
        outgoing.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }); outgoing.end(); return;
      }
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' }); outgoing.end(); return; }
      if (url.pathname === '/healthz') {
        // data_version catches writes by other connections; total_changes catches writes
        // by the collector's own connection, even when two runs share a timestamp.
        const version = `${db.sqlite.prepare('PRAGMA data_version').get().data_version}:${db.sqlite.prepare('SELECT total_changes() AS n').get().n}`;
        if (!cachedHealth || now() - healthAt >= 60000 || healthVersion !== version) {
          const counts = Object.fromEntries(['Bosses', 'Maps', 'Timestamps', 'SpawnChances'].map(table => [table, db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
          const latest = db.sqlite.prepare('SELECT MAX(Timestamp) AS timestamp FROM Timestamps').get().timestamp;
          cachedHealth = { counts, latestTimestamp: latest === null ? null : new Date(Number(latest) * 1000).toISOString() };
          healthAt = now(); healthVersion = version;
        }
        const ageSeconds = cachedHealth.latestTimestamp === null ? null : Math.max(0, (now() - Date.parse(cachedHealth.latestTimestamp)) / 1000);
        json(200, { status: 'ok', database: { ...cachedHealth, ageSeconds, stale: ageSeconds === null || ageSeconds > 7200 }, collection: { ...collector.state, source } }); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!routes.has(url.pathname)) { outgoing.writeHead(404); outgoing.end(); return; }
        if (!queryLimiter(incoming.socket.remoteAddress || 'unknown')) { json(429, { error: 'Too many requests. Please try again shortly.' }, { 'Retry-After': '1' }); return; }
        if (url.pathname === '/api/history/summary' && !summaryLimiter('shared')) { json(429, { error: 'History summaries are busy. Please try again shortly.' }, { 'Retry-After': '5' }); return; }
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
      const status = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : error instanceof URIError ? 400 : 500;
      if (status === 500) console.error('HTTP request failed', error);
      outgoing.writeHead(status); outgoing.end(status === 500 ? 'Internal server error' : 'Not found');
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 100;
  return server;
}
