import { vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { cleanRecords, csvCell, recordsCsv, nextDay, queryUrl, recentRange, seriesFrom, summarySeries, historyUrl, rawRecords, utcTime } from './archiveData';

vi.mock('react-chartjs-2', () => ({ Line: props => <div role="img" aria-label={props['aria-label']} /> }));
vi.mock('chart.js', () => ({ Chart: { register: vi.fn() }, LinearScale: {}, PointElement: {}, LineElement: {}, Tooltip: {}, Legend: {} }));
const json = data => Promise.resolve({ ok: true, json: () => Promise.resolve(Array.isArray(data) && data.length === 0 ? { series: [], resolution: 'hour' } : data) });
const record = (Timestamp, Chance = 0.3, BossName = 'Reshala', MapName = 'Customs') => ({ Timestamp, Chance, BossName, MapName });
const openObservations = () => fireEvent.click(screen.getByRole('tab', { name: 'Observations' }));
const selectOption = async (label, value) => {
  const trigger = screen.getByRole('button', { name: new RegExp(`^${label} `) });
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(trigger);
  fireEvent.click(await within(screen.getByRole('listbox', { name: label })).findByRole('option', { name: value }));
};
const window = { startDate: '2026-11-01', endDate: '2026-11-18' };
const metadata = url => {
  if (url.includes('/api/history?')) return json({ records: [], nextCursor: null, snapshotId: 1 });
  if (url.includes('api/maps')) return json(['Customs', 'Woods']);
  if (url.includes('api/bosses')) return json(['Reshala', 'Shturman']);
  if (url.includes('healthz')) return json({ database: { latestTimestamp: '2026-11-18T11:00:00Z', stale: false }, collection: { enabled: true } });
  return null;
};
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

test('inclusive UTC dates become a next-day API boundary across year and leap-day changes', () => {
  expect(nextDay('2024-02-29')).toBe('2024-03-01');
  expect(nextDay('2026-12-31')).toBe('2027-01-01');
  expect(recentRange(7, new Date('2026-11-18T23:30:00-08:00'))).toEqual({ startDate: '2026-11-13', endDate: '2026-11-19' });
  const url = new URL(queryUrl({ ...window, mapName: 'Streets of Tarkov', bossName: 'A&B' }), 'https://example.com');
  expect(url.searchParams.get('endDate')).toBe('2026-11-19');
  expect(url.searchParams.get('mapName')).toBe('Streets of Tarkov');
  expect(url.searchParams.get('bossName')).toBe('A&B');
});
test('next-day midnight returned by BETWEEN is excluded and observations sorted', () => {
  const rows = cleanRecords([record('2026-11-19T00:00:00Z'), record('2026-11-18T23:59:59Z'), record('2026-11-01T00:00:00Z'), record('bad-date')], window);
  expect(rows.map(row => row.Timestamp)).toEqual(['2026-11-01T00:00:00Z', '2026-11-18T23:59:59Z']);
});
test('series retain original outliers and break multi-month collection gaps', () => {
  const rows = [record('2026-11-18T11:00:00Z', 0.3), record('2026-07-21T11:00:00Z', 8.64), record('2026-07-21T12:00:00Z', 0.5)];
  const [series] = seriesFrom(rows);
  expect(series.gaps).toBe(1);
  expect(series.data.map(point => point.y)).toEqual([864, 50, null, 30]);
  expect(series.max).toBe(864);
  expect(series.latest.Chance).toBe(0.3);
  expect(seriesFrom(rows.slice().reverse())[0].color).toBe(series.color);
  expect(utcTime(Date.parse('2026-11-18T11:00:00Z'))).toContain('11:00 UTC');
});
test('map and boss edits wait for Apply filters and request gets aborted when replaced', async () => {
  const requests = [];
  global.fetch = vi.fn((url, options) => {
    const response = metadata(url); if (response) return response;
    requests.push({ url, signal: options.signal }); return json([]);
  });
  render(<App />);
  await screen.findByText('No observations in this view');
  await selectOption('Map', 'Woods');
  await selectOption('Boss', 'Shturman');
  expect(requests).toHaveLength(1);
  expect(screen.getByText('Unapplied changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].url).toContain('mapName=Woods');
  expect(requests[1].url).toContain('bossName=Shturman');
  await screen.findByText('No observations in this view');
});
test('older request cannot replace a newly applied result even if its transport ignores abort', async () => {
  let resolveOld;
  let queries = 0;
  global.fetch = vi.fn(url => metadata(url) || (++queries === 1 ? new Promise(resolve => { resolveOld = resolve; }) : json([])));
  render(<App />);
  expect(screen.getByText('Loading history')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '30 days' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('No observations in this view');
  await act(async () => resolveOld({ ok: true, json: () => Promise.resolve([record(new Date().toISOString(), 0.99)]) }));
  expect(screen.getByText('No observations in this view')).toBeInTheDocument();
  expect(screen.queryByText('99%')).not.toBeInTheDocument();
});
test('request failure shows retry and recovers to an honest empty state', async () => {
  let queries = 0;
  global.fetch = vi.fn(url => metadata(url) || (++queries === 1 ? Promise.resolve({ ok: false, status: 503 }) : json([])));
  render(<App />);
  await screen.findByText('History couldn’t be loaded');
  fireEvent.click(screen.getByRole('button', { name: /Retry request/ }));
  await screen.findByText('No observations in this view');
  expect(screen.getByText(/No data does not mean a 0%/)).toBeInTheDocument();
  openObservations();
  expect(screen.getByRole('button', { name: 'Export page CSV' })).toHaveAttribute('aria-disabled', 'true');
});
test('invalid date order prevents a query and health failures do not block history', async () => {
  global.fetch = vi.fn(url => url.includes('healthz') ? Promise.reject(new Error('Unavailable')) : metadata(url) || json([]));
  render(<App />);
  await screen.findAllByText('Status unavailable');
  await screen.findByText('No observations in this view');
  const before = global.fetch.mock.calls.filter(([url]) => url.includes('history/summary')).length;
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-10' } });
  fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-12-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(within(screen.getByRole('complementary', { name: 'Archive filters' })).getByRole('alert')).toHaveTextContent('end date must be on or after');
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('history/summary'))).toHaveLength(before);
});

test('CSV export neutralises spreadsheet formulas and escapes embedded delimiters', () => {
  for (const text of ['=HYPERLINK("https://example.com")', '+cmd', '-cmd', '@SUM(1)', ' =1', '\t=1', '\r=1']) {
    expect(csvCell(text).startsWith('"\'')).toBe(true);
  }
  expect(csvCell('Customs, "east"')).toBe('"Customs, ""east"""');
  expect(csvCell(-5)).toBe('"-5"');
  expect(recordsCsv([record('2026-11-18T12:00:00Z', 0.3, '=1+1')])).toContain('"\'=1+1"');
});
test.each([
  [413, 'Select a map and boss'],
  [400, 'Check the dates and filter values'],
  [429, 'Wait a moment before retrying'],
])('API %s errors give actionable guidance and keep filters editable', async (status, message) => {
  global.fetch = vi.fn(url => metadata(url) || Promise.resolve({ ok: false, status }));
  render(<App />);
  expect(await within(screen.getByRole('tabpanel', { name: 'History' })).findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Apply filters' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('summary pipeline preserves segment gaps, ranges, counts and exact latest values', () => {
  const point = { timestamp: '2026-11-01T00:00:00Z', firstTimestamp: '2026-11-01T01:00:00Z', lastTimestamp: '2026-11-01T02:00:00Z', min: .2, max: .4, average: .3, latest: .4, count: 2, segment: 0 };
  const [series] = summarySeries({ series: [{ mapName: 'Customs', bossName: 'Reshala', points: [point, { ...point, timestamp: '2026-11-03T00:00:00Z', firstTimestamp: '2026-11-03T00:00:00Z', lastTimestamp: '2026-11-03T01:00:00Z', latest: .6, max: .6, segment: 1 }] }] });
  expect(series.data.map(point => point.y)).toEqual([30, null, 30]);
  expect(series.count).toBe(4); expect(series.min).toBe(20); expect(series.max).toBe(60); expect(series.latest.Chance).toBe(.6);
  expect(rawRecords([{ id: 7, mapName: 'Customs', bossName: 'Reshala', spawnChance: .6, timestamp: point.lastTimestamp }])[0].Chance).toBe(.6);
  expect(historyUrl({ ...window }, 'a+b')).toContain('cursor=a%2Bb');
});
test('raw pagination aborts replaced requests, rejects stale results and resets with applied filters', async () => {
  const requests = [];
  let resolveSecond;
  global.fetch = vi.fn((url, options) => {
    if (url.includes('/api/history?')) {
      requests.push({ url, signal: options.signal });
      if (url.includes('cursor=')) return new Promise(resolve => { resolveSecond = resolve; });
      return json({ records: [{ id: 1, mapName: 'Customs', bossName: 'Reshala', spawnChance: .4, timestamp: new Date().toISOString() }], nextCursor: 'next', snapshotId: 1 });
    }
    return metadata(url) || json([]);
  });
  render(<App />);
  openObservations();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '30 days' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].url).not.toContain('cursor=');
  await act(async () => resolveSecond({ ok: true, json: () => Promise.resolve({ records: [{ id: 2, mapName: 'Old', bossName: 'Old', spawnChance: .99, timestamp: new Date().toISOString() }], nextCursor: null }) }));
  expect(screen.queryByText('Old')).not.toBeInTheDocument();
  expect(screen.getByText('Page 1 - 1 observations')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Export page CSV' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('long-history summaries show resolution and full-window statistics independently of the raw page', async () => {
  global.fetch = vi.fn(url => {
    if (url.includes('/api/history/summary?')) return json({ resolution: 'week', bucketSeconds: 604800, series: [{ mapName: 'Customs', bossName: 'Reshala', points: [{ timestamp: '2026-11-16T00:00:00Z', firstTimestamp: '2026-11-18T01:00:00Z', lastTimestamp: '2026-11-18T04:00:00Z', min: .2, max: .6, average: .4, latest: .6, count: 900, segment: 0 }] }] });
    return metadata(url) || json([]);
  });
  render(<App />);
  await screen.findByText('Weekly average spawn chance');
  expect(screen.getAllByText('900')).toHaveLength(2);
  expect(screen.getAllByText('60%')).toHaveLength(2);
  expect(screen.getAllByText(/Weekly averages/)).toHaveLength(2);
  openObservations();
  expect(screen.getByText('No raw observations on this page.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Export page CSV' })).toHaveAttribute('aria-disabled', 'true');
});

test('expired page cursor restarts raw observations from the first page', async () => {
  const requests = [];
  global.fetch = vi.fn(url => {
    if (url.includes('/api/history?')) {
      requests.push(url);
      if (new URL(url, 'https://example.com').searchParams.has('cursor')) return Promise.resolve({ ok: false, status: 400 });
      return json({ records: [{ id: 1, mapName: 'Customs', bossName: 'Reshala', spawnChance: .4, timestamp: new Date().toISOString() }], nextCursor: 'expired', snapshotId: 1 });
    }
    return metadata(url) || json([]);
  });
  render(<App />);
  openObservations();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('button', { name: 'Restart observations' });
  fireEvent.click(screen.getByRole('button', { name: 'Restart observations' }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]).not.toContain('cursor=');
  expect(await screen.findByText('Page 1 - 1 observations')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
});
test('new history and summary endpoints end at the final millisecond of the selected UTC day', () => {
  const url = new URL(historyUrl({ ...window }), 'https://example.com');
  expect(url.searchParams.get('endDate')).toBe('2026-11-18T23:59:59.999Z');
});

test('searchable Astryx selectors support keyboard selection and keep changes unapplied', async () => {
  global.fetch = vi.fn(url => metadata(url) || json([]));
  render(<App />);
  await screen.findByText('No observations in this view');
  const trigger = screen.getByRole('button', { name: 'Map Customs' });
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled', 'true'));
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const search = screen.getByPlaceholderText('Find a map…');
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.change(search, { target: { value: 'woo' } });
  const options = within(screen.getByRole('listbox', { name: 'Map' }));
  expect(options.getAllByRole('option')).toHaveLength(1);
  expect(options.getByRole('option', { name: 'Woods' })).toBeInTheDocument();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(search).toHaveAttribute('aria-activedescendant', options.getByRole('option', { name: 'Woods' }).id);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Map Woods' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Unapplied changes')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('history/summary'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url.includes('history/summary'))).toHaveLength(2));
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('history/summary')).at(-1)[0]).toContain('mapName=Woods');
});

test('tabs support arrow-key focus and explicit activation without refetching or losing filters', async () => {
  global.fetch = vi.fn(url => metadata(url) || json([]));
  render(<App />);
  await screen.findByText('No observations in this view');
  const history = screen.getByRole('tab', { name: 'History' });
  const observations = screen.getByRole('tab', { name: 'Observations' });
  expect(history).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'History' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Export page CSV' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '30 days' }));
  const calls = global.fetch.mock.calls.length;
  act(() => history.focus());
  fireEvent.keyDown(history, { key: 'ArrowRight' });
  expect(observations).toHaveFocus();
  expect(observations).toHaveAttribute('aria-selected', 'false');
  // Native button keyboard activation emits a click; JSDOM does not synthesize it.
  fireEvent.click(observations, { detail: 0 });
  expect(observations).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Observations' })).toBeVisible();
  expect(screen.queryByRole('tabpanel', { name: 'History' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export page CSV' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  fireEvent.keyDown(observations, { key: 'ArrowLeft' });
  expect(history).toHaveFocus();
  fireEvent.click(history, { detail: 0 });
  expect(history).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Unapplied changes')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(calls);
});
