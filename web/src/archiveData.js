export const DAY = 86400000;
export const apiUrl = path => `${(import.meta.env.VITE_API_URL || '/').replace(/\/$/, '')}/${path}`;
export const dateOnly = date => date.toISOString().slice(0, 10);
export function recentRange(days, now = new Date()) {
  const end = new Date(`${dateOnly(now)}T00:00:00Z`);
  return { startDate: dateOnly(new Date(+end - (days - 1) * DAY)), endDate: dateOnly(end) };
}
export const initialFilters = () => ({ mapName: 'Customs', bossName: 'Reshala', ...recentRange(7) });
export const nextDay = value => dateOnly(new Date(Date.parse(`${value}T00:00:00Z`) + DAY));
export function queryUrl(filters) {
  const params = new URLSearchParams({ startDate: filters.startDate, endDate: nextDay(filters.endDate) });
  if (filters.mapName) params.set('mapName', filters.mapName);
  if (filters.bossName) params.set('bossName', filters.bossName);
  return apiUrl(`api/spawnchance?${params}`);
}
export function cleanRecords(records, filters) {
  const start = Date.parse(`${filters.startDate}T00:00:00Z`);
  const end = Date.parse(`${nextDay(filters.endDate)}T00:00:00Z`);
  return records.filter(record => {
    const time = Date.parse(record.Timestamp);
    return time >= start && time < end && record.Chance !== null && Number.isFinite(Number(record.Chance));
  }).sort((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp));
}
const colors = ['#7da7ff', '#4dd4c2', '#b69cff', '#ffad79', '#f58dbc', '#a8cf75', '#6ac6ef', '#e5c36a'];
export function seriesFrom(records) {
  const groups = new Map();
  records.forEach(record => {
    const key = `${record.MapName} / ${record.BossName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, points]) => {
    points.sort((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp));
    const hash = [...label].reduce((value, character) => ((value * 31 + character.charCodeAt(0)) >>> 0), 0);
    const data = [];
    let gaps = 0;
    let min = Infinity;
    let max = -Infinity;
    points.forEach((point, index) => {
      const x = Date.parse(point.Timestamp);
      const y = Number(point.Chance) * 100;
      // Collection is hourly. Missing periods are unknown, never continuous trends.
      if (index && x - Date.parse(points[index - 1].Timestamp) > 6 * 3600000) {
        data.push({ x: Date.parse(points[index - 1].Timestamp) + 1, y: null });
        gaps += 1;
      }
      data.push({ x, y });
      min = Math.min(min, y); max = Math.max(max, y);
    });
    return { label, color: colors[hash % colors.length], points, data, gaps,
      latest: points[points.length - 1], min, max };
  });
}
export const percent = value => `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
export function utcTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value)) + ' UTC';
}

// Quoting alone does not stop spreadsheet formula evaluation of untrusted text.
export function csvCell(value) {
  let text = String(value);
  if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  if (/^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
export function recordsCsv(records) {
  const rows = [['Map', 'Boss', 'Timestamp UTC', 'Spawn chance (%)'], ...records.map(row => [row.MapName, row.BossName, row.Timestamp, Number(row.Chance) * 100])];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
