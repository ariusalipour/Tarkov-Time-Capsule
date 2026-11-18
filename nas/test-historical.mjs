// Explicit acceptance tool: npm run build, then node test-historical.mjs DB_PATH [BASE_URL] [REPORT_PATH].
// Opens a disposable copy; never enables collection or changes the source database.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from './dist/api.mjs';
import { LocalDatabase } from './database.mjs';

const [sourcePath, baseUrl = 'http://192.168.55.156:3040', reportPath] = process.argv.slice(2);
if (!sourcePath) throw new Error('Usage: node test-historical.mjs DB_PATH [BASE_URL] [REPORT_PATH]');
const directory = mkdtempSync(join(tmpdir(), 'tarkov-parity-'));
let database;
const report = { checkedAt: new Date().toISOString(), sourceDatabase: resolve(sourcePath), target: baseUrl, scope: 'Original Worker handlers against disposable export copy vs NAS HTTP; order normalized recursively', results: [], passed: false };
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
try {
  const temporaryPath = join(directory, 'copy.sqlite');
  copyFileSync(resolve(sourcePath), temporaryPath);
  database = new LocalDatabase(temporaryPath);
  const paths = ['/api/maps', '/api/bosses'];
  for (const groupBy of ['', 'boss', 'map', 'timestamp']) {
    for (const filters of ['', '&mapName=Customs', '&bossName=Reshala', '&mapName=Customs&bossName=Reshala', '&mapName=customs&bossName=reshala']) {
      paths.push(`/api/spawnchance?startDate=2025-01-09&endDate=2025-01-10${groupBy ? '&groupBy=' + groupBy : ''}${filters}`);
    }
  }
  for (const path of paths) {
    try {
      const expectedResponse = await worker.fetch(new Request('http://original.local' + path), { DB: database });
      const actualResponse = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(30000) });
      assert.equal(actualResponse.status, expectedResponse.status);
      const expected = normalize(await expectedResponse.json());
      const actual = normalize(await actualResponse.json());
      assert.deepEqual(actual, expected);
      report.results.push({ path, passed: true, topLevelEntries: actual.length, sha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex') });
    } catch (error) {
      report.results.push({ path, passed: false, error: error.message.slice(0, 500) });
    }
  }
  report.passed = report.results.every(result => result.passed);
  if (!report.passed) process.exitCode = 1;
} finally {
  database?.close(); rmSync(directory, { recursive: true, force: true });
  if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
