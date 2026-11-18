const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = value => new Response(JSON.stringify(value), { headers });

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
  const params = new Map();
  new URL(request.url).searchParams.forEach((value, key) => params.set(key.toLowerCase(), value));
  const now = Date.now() / 1000;
  const start = latest ? now - 3600 : params.get('startdate') ? Date.parse(params.get('startdate')) / 1000 : now - 7 * 86400;
  const end = latest || !params.get('enddate') ? now : Date.parse(params.get('enddate')) / 1000;
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
  const rows = db.prepare(query).all(...bindings);
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
    case '/api/maps': return handleMapListRequest(db);
    case '/api/bosses': return handleBossListRequest(db);
    case '/api/spawnchance': return handleSpawnChanceRequest(request, db);
    case '/api/latestspawnchance': return handleLatestSpawnChanceRequest(request, db);
    default: return new Response('Not found', { status: 404 });
  }
}
