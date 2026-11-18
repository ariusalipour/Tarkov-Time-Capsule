import { createHttpServer } from './http-server.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LocalDatabase, initializeDatabase } from './database.mjs';
import { createCollector, startHourlyScheduler } from './scheduler.mjs';
import { fetchMaps, upstreamSource } from './upstream.mjs';
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
const server = createHttpServer({ db, collector, staticRoot, source: upstreamSource });
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
