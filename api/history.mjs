import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
class InputError extends Error {}

const key = randomBytes(32);
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
const iso = (seconds) => new Date(seconds * 1000).toISOString();
export const MAX_HISTORY_POINTS = 25000;
export const MAX_HISTORY_SERIES = 100;
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value))
    throw new InputError('Dates must be valid ISO dates or UTC timestamps.');
  const ms = Date.parse(value);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, value.includes('T') ? 19 : 10) !==
      value.slice(0, value.includes('T') ? 19 : 10)
  )
    throw new InputError('Dates must be valid ISO dates or UTC timestamps.');
  return ms / 1000;
}
function parse(request) {
  const url = new URL(request.url);
  if (url.search.length > 2048) throw new InputError('Query is too long.');
  const p = new Map();
  for (const [k, v] of url.searchParams) {
    const name = k.toLowerCase();
    if (p.has(name)) throw new InputError('Duplicate query parameters are not allowed.');
    p.set(name, v);
  }
  for (const n of ['bossname', 'mapname'])
    if ((p.get(n)?.length || 0) > 100)
      throw new InputError('Filters must be at most 100 characters.');
  const start = p.has('startdate')
    ? date(p.get('startdate'))
    : Math.floor(Date.now() / 1000) - 7 * 86400;
  const end = p.has('enddate') ? date(p.get('enddate')) : Math.floor(Date.now() / 1000);
  if (end - start > 3660 * 86400) throw new InputError('History ranges must not exceed ten years.');
  if (start > end) throw new InputError('startDate must not be after endDate.');
  return {
    p,
    filters: {
      start,
      end,
      boss: (p.get('bossname') || '').toLowerCase(),
      map: (p.get('mapname') || '').toLowerCase(),
    },
  };
}
function where(f, snapshot) {
  return {
    sql: `t.Timestamp BETWEEN ? AND ? AND s.SpawnChanceID<=?${f.boss ? ' AND LOWER(b.BossName)=?' : ''}${f.map ? ' AND LOWER(m.MapName)=?' : ''}`,
    args: [f.start, f.end, snapshot, ...(f.boss ? [f.boss] : []), ...(f.map ? [f.map] : [])],
  };
}
const joins = `FROM SpawnChances s
  JOIN Timestamps t ON t.TimestampID = s.TimestampID
  JOIN Bosses b ON b.BossID = s.BossID
  JOIN Maps m ON m.MapID = s.MapID`;
function encode(value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return body + '.' + createHmac('sha256', key).update(body).digest('base64url');
}
function decode(cursor) {
  try {
    const [body, signature, ...rest] = cursor.split('.');
    const expected = createHmac('sha256', key).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (rest.length || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new InputError();
    const value = JSON.parse(Buffer.from(body, 'base64url'));
    if (
      value.v !== 1 ||
      !Number.isSafeInteger(value.snapshot) ||
      value.snapshot < 0 ||
      !Number.isSafeInteger(value.id) ||
      value.id < 1 ||
      !Number.isFinite(value.time)
    )
      throw new InputError();
    return value;
  } catch {
    throw new InputError('Invalid or expired cursor; restart pagination.');
  }
}
export async function handleHistoryRequest(request, db) {
  try {
    const { p, filters } = parse(request);
    const limit = p.has('limit') ? Number(p.get('limit')) : 250;
    if (
      !/^\d+$/.test(p.get('limit') || '250') ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new InputError('limit must be an integer from 1 to 1000.');
    const previous = p.has('cursor') ? decode(p.get('cursor')) : null;
    // Cursor carries the original default dates, avoiding moving "now" between requests.
    if (previous) {
      if (!p.has('startdate')) filters.start = previous.filters.start;
      if (!p.has('enddate')) filters.end = previous.filters.end;
      if (JSON.stringify(filters) !== JSON.stringify(previous.filters))
        throw new InputError('Cursor does not match the requested filters.');
    }
    const snapshot =
      previous?.snapshot ??
      db.prepare('SELECT COALESCE(MAX(SpawnChanceID),0) AS id FROM SpawnChances').get().id;
    const w = where(filters, snapshot);
    const rows = db
      .prepare(
        `SELECT s.SpawnChanceID AS id, m.MapName AS mapName, b.BossName AS bossName,
          s.Chance AS spawnChance, t.Timestamp AS timestamp
        ${joins}
        WHERE ${w.sql}
          ${previous ? 'AND (t.Timestamp > ? OR (t.Timestamp = ? AND s.SpawnChanceID > ?))' : ''}
        ORDER BY t.Timestamp, s.SpawnChanceID
        LIMIT ?`,
      )
      .all(...w.args, ...(previous ? [previous.time, previous.time, previous.id] : []), limit + 1);
    const more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    const nextCursor = more
      ? encode({ v: 1, snapshot, filters, time: last.timestamp, id: last.id })
      : null;
    return json({
      records: rows.map((r) => ({ ...r, timestamp: iso(r.timestamp) })),
      nextCursor,
      snapshotId: snapshot,
    });
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    throw error;
  }
}
export async function handleHistorySummaryRequest(request, db) {
  try {
    const { p, filters } = parse(request);
    let resolution = p.get('resolution') || 'auto';
    if (!['auto', 'hour', 'day', 'week'].includes(resolution))
      throw new InputError('resolution must be auto, hour, day or week.');
    if (resolution === 'auto')
      resolution =
        filters.end - filters.start <= 7 * 86400
          ? 'hour'
          : filters.end - filters.start <= 180 * 86400
            ? 'day'
            : 'week';
    const bucketSeconds = { hour: 3600, day: 86400, week: 604800 }[resolution];
    const snapshot = db
      .prepare('SELECT COALESCE(MAX(SpawnChanceID),0) AS id FROM SpawnChances')
      .get().id;
    const w = where(filters, snapshot);
    const seriesCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM (SELECT s.MapID,s.BossID ${joins} WHERE ${w.sql} GROUP BY s.MapID,s.BossID LIMIT ?)`,
      )
      .get(...w.args, MAX_HISTORY_SERIES + 1).count;
    if (seriesCount > MAX_HISTORY_SERIES)
      return json({ error: 'Too many series; filter by boss or map.' }, 413);
    // Windowed gaps split each series before aggregation, so missing collection periods never become interpolated observations.
    const rows = db
      .prepare(
        `WITH observed AS (
          SELECT s.SpawnChanceID AS id, s.MapID, s.BossID, m.MapName, b.BossName,
            s.Chance, t.Timestamp,
            LAG(t.Timestamp) OVER (
              PARTITION BY s.MapID, s.BossID ORDER BY t.Timestamp, s.SpawnChanceID
            ) AS previous
          ${joins}
          WHERE ${w.sql}
        ), segmented AS (
          SELECT *, SUM(
            CASE WHEN previous IS NULL OR Timestamp - previous > 21600 THEN 1 ELSE 0 END
          ) OVER (PARTITION BY MapID, BossID ORDER BY Timestamp, id) AS segment
          FROM observed
        ), ranked AS (
          SELECT *, CAST(Timestamp / ? AS INTEGER) * ? AS bucket,
            ROW_NUMBER() OVER (
              PARTITION BY MapID, BossID, segment, CAST(Timestamp / ? AS INTEGER)
              ORDER BY Timestamp DESC, id DESC
            ) AS latestRank
          FROM segmented
        )
        SELECT MapID, BossID, MapName, BossName, segment, bucket,
          MIN(Timestamp) AS first, MAX(Timestamp) AS last,
          MIN(Chance) AS min, MAX(Chance) AS max, AVG(Chance) AS average,
          COUNT(*) AS count, MAX(CASE WHEN latestRank = 1 THEN Chance END) AS latest
        FROM ranked
        GROUP BY MapID, BossID, segment, bucket
        ORDER BY MapID, BossID, bucket, first
        LIMIT ?`,
      )
      .all(...w.args, bucketSeconds, bucketSeconds, bucketSeconds, MAX_HISTORY_POINTS + 1);
    if (rows.length > MAX_HISTORY_POINTS)
      return json(
        { error: 'Too many summary points; choose a coarser resolution or filter by boss/map.' },
        413,
      );
    const groups = new Map();
    for (const r of rows) {
      const id = r.MapID + ':' + r.BossID;
      if (!groups.has(id)) groups.set(id, { mapName: r.MapName, bossName: r.BossName, points: [] });
      groups.get(id).points.push({
        timestamp: iso(r.bucket),
        firstTimestamp: iso(r.first),
        lastTimestamp: iso(r.last),
        min: r.min,
        max: r.max,
        average: r.average,
        latest: r.latest,
        count: r.count,
        segment: r.segment,
      });
    }
    return json({ resolution, bucketSeconds, series: [...groups.values()] });
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    throw error;
  }
}
