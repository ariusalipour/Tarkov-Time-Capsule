import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { cleanRecords, nextDay, queryUrl, recentRange, seriesFrom, utcTime } from './archiveData';

jest.mock('react-chartjs-2', () => ({ Line: props => <div role="img" aria-label={props['aria-label']} /> }));
jest.mock('chart.js', () => ({ Chart: { register: jest.fn() } }));
const json = data => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const record = (Timestamp, Chance = 0.3, BossName = 'Reshala', MapName = 'Customs') => ({ Timestamp, Chance, BossName, MapName });
const window = { startDate: '2026-11-01', endDate: '2026-11-18' };
const metadata = url => {
  if (url.includes('api/maps')) return json(['Customs', 'Woods']);
  if (url.includes('api/bosses')) return json(['Reshala', 'Shturman']);
  if (url.includes('healthz')) return json({ database: { latestTimestamp: '2026-11-18T11:00:00Z', stale: false }, collection: { enabled: true } });
  return null;
};
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

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
  global.fetch = jest.fn((url, options) => {
    const response = metadata(url); if (response) return response;
    requests.push({ url, signal: options.signal }); return json([]);
  });
  render(<App />);
  await screen.findByText('No observations in this view');
  await waitFor(() => expect(screen.getByLabelText('Map')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'Woods' } });
  fireEvent.change(screen.getByLabelText('Boss'), { target: { value: 'Shturman' } });
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
  global.fetch = jest.fn(url => metadata(url) || (++queries === 1 ? new Promise(resolve => { resolveOld = resolve; }) : json([])));
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
  global.fetch = jest.fn(url => metadata(url) || (++queries === 1 ? Promise.resolve({ ok: false, status: 503 }) : json([])));
  render(<App />);
  await screen.findByText('History couldn’t be loaded');
  fireEvent.click(screen.getByRole('button', { name: /Retry request/ }));
  await screen.findByText('No observations in this view');
  expect(screen.getByText(/No data does not mean a 0%/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
});
test('invalid date order prevents a query and health failures do not block history', async () => {
  global.fetch = jest.fn(url => url.includes('healthz') ? Promise.reject(new Error('Unavailable')) : metadata(url) || json([]));
  render(<App />);
  await screen.findAllByText('Status unavailable');
  await screen.findByText('No observations in this view');
  const before = global.fetch.mock.calls.filter(([url]) => url.includes('spawnchance')).length;
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-10' } });
  fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-12-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(screen.getByRole('alert')).toHaveTextContent('end date must be on or after');
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('spawnchance'))).toHaveLength(before);
});
