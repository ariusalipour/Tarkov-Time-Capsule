import { handleHistoryRequest, handleHistorySummaryRequest } from './history.mjs';
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
export const MAX_ROWS = 10000;
export const MAX_QUERY_LENGTH = 2048;

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return NaN;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return NaN;
  const normalized = new Date(milliseconds).toISOString();
  // Date.parse normalizes invalid days (e.g. February 30); reject those too.
  if (normalized.slice(0, 10) !== value.slice(0, 10)) return NaN;
  if (value.includes('T') && normalized.slice(0, 19) !== value.slice(0, 19)) return NaN;
  return milliseconds / 1000;
}

export async function handleBossListRequest(db) {
  const titleCase = name => name.replace(/\w+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return json(db.prepare('SELECT BossName FROM Bosses').all().map(row => titleCase(row.BossName)));
}

export async function handleMapListRequest(db) {
  return json(db.prepare('SELECT MapName FROM Maps').all().map(row => row.MapName));
}

function groupRows(rows, groupBy) {
  if (!['boss', 'map', 'timestamp'].includes(groupBy)) return rows;
  const groups = Object.create(null);
  for (const row of rows) {
    if (groupBy === 'boss') {
      groups[row.BossName] ??= { bossName: row.BossName, maps: [] };
      groups[row.BossName].maps.push({ mapName: row.MapName, spawnChance: row.Chance, timestamp: row.Timestamp });
    } else if (groupBy === 'map') {
      groups[row.MapName] ??= { mapName: row.MapName, bosses: [] };
      groups[row.MapName].bosses.push({ bossName: row.BossName, spawnChance: row.Chance, timestamp: row.Timestamp });
    } else {
      groups[row.Timestamp] ??= { timestamp: row.Timestamp, entries: [] };
      groups[row.Timestamp].entries.push({ bossName: row.BossName, mapName: row.MapName, spawnChance: row.Chance });
    }
  }
  return Object.values(groups);
}

function spawnChanceResponse(request, db, latest) {
  if (new URL(request.url).search.length > MAX_QUERY_LENGTH) return json({ error: 'Query is too long.' }, 400);
  const params = new Map();
  new URL(request.url).searchParams.forEach((value, key) => params.set(key.toLowerCase(), value));
  for (const name of ['mapname', 'bossname']) {
    if ((params.get(name)?.length || 0) > 100) return json({ error: 'Filters must be at most 100 characters.' }, 400);
  }
  for (const name of ['startdate', 'enddate']) {
    if (params.has(name) && !Number.isFinite(parseDate(params.get(name)))) return json({ error: 'Dates must be valid ISO dates or UTC timestamps.' }, 400);
  }
  const now = Date.now() / 1000;
  const requestedStart = params.has('startdate') ? parseDate(params.get('startdate')) : undefined;
  const requestedEnd = params.has('enddate') ? parseDate(params.get('enddate')) : undefined;
  if (requestedStart !== undefined && requestedEnd !== undefined && requestedStart > requestedEnd) return json({ error: 'startDate must not be after endDate.' }, 400);
  const start = latest ? now - 3600 : requestedStart ?? now - 7 * 86400;
  const end = latest ? now : requestedEnd ?? now;
  if (start > end) return json({ error: 'startDate must not be after endDate.' }, 400);
  let query = `SELECT Maps.MapName, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp
    FROM SpawnChances
    JOIN Maps ON SpawnChances.MapID = Maps.MapID
    JOIN Bosses ON SpawnChances.BossID = Bosses.BossID
    JOIN Timestamps ON SpawnChances.TimestampID = Timestamps.TimestampID
    WHERE Timestamps.Timestamp BETWEEN ? AND ?`;
  const bindings = [start, end];
  for (const [parameter, column] of [['mapname', 'Maps.MapName'], ['bossname', 'Bosses.BossName']]) {
    const value = params.get(parameter);
    if (value) {
      query += ` AND LOWER(${column}) = LOWER(?)`;
      bindings.push(value);
    }
  }
  // The extra row detects overflow without loading the complete archive into memory.
  query += ' LIMIT ?';
  const rows = db.prepare(query).all(...bindings, MAX_ROWS + 1);
  if (rows.length > MAX_ROWS) return json({ error: 'Too many observations; choose a shorter date range or filter by boss/map.' }, 413);
  for (const row of rows) row.Timestamp = new Date(row.Timestamp * 1000).toISOString();
  return json(groupRows(rows, params.get('groupby')));
}

export async function handleLatestSpawnChanceRequest(request, db) {
  return spawnChanceResponse(request, db, true);
}

export async function handleSpawnChanceRequest(request, db) {
  return spawnChanceResponse(request, db, false);
}

export async function handleApiRequest(request, db) {
  switch (new URL(request.url).pathname) {
    case '/api/history': return handleHistoryRequest(request, db);
    case '/api/history/summary': return handleHistorySummaryRequest(request, db);
    case '/api/maps': return handleMapListRequest(db);
    case '/api/bosses': return handleBossListRequest(db);
    case '/api/spawnchance': return handleSpawnChanceRequest(request, db);
    case '/api/latestspawnchance': return handleLatestSpawnChanceRequest(request, db);
    default: return new Response('Not found', { status: 404 });
  }
}
