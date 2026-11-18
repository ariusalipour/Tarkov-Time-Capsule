import React, { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { apiUrl, recordsCsv, initialFilters, nextDay, percent, recentRange, summarySeries, historyUrl, summaryUrl, rawRecords, utcTime } from './archiveData';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
async function readJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    if (response.status === 413) throw new Error('This view contains too many chart series or summary points. Select a map and boss, then apply filters.');
    if (response.status === 429) throw new Error('Too many requests. Wait a moment before retrying.');
    if (response.status === 400) throw new Error('The API could not accept these filters. Check the dates and filter values, then apply filters.');
    throw new Error(`Request failed (${response.status}). Try the request again.`);
  }
  return response.json();
}
function downloadCsv(records) {
  const url = URL.createObjectURL(new Blob([recordsCsv(records)], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'tarkov-spawn-history.csv'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SpawnChanceGraph() {
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [options, setOptions] = useState({ maps: ['Customs'], bosses: ['Reshala'] });
  const [optionsError, setOptionsError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [healthState, setHealthState] = useState('loading');
  const [result, setResult] = useState({ state: 'loading', records: [], error: '' });
  const [pageCursors, setPageCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const [raw, setRaw] = useState({ state: 'loading', records: [], nextCursor: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [metadataRefresh, setMetadataRefresh] = useState(0);
  const [validation, setValidation] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsError(false);
    setOptionsLoading(true);
    Promise.all([readJson(apiUrl('api/maps'), controller.signal), readJson(apiUrl('api/bosses'), controller.signal)])
      .then(([maps, bosses]) => { if (!controller.signal.aborted) setOptions({ maps: [...maps].sort(), bosses: [...bosses].sort() }); })
      .catch(() => { if (!controller.signal.aborted) setOptionsError(true); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [metadataRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => readJson(apiUrl('healthz'), controller.signal)
      .then(data => { if (!controller.signal.aborted) { setHealth(data); setHealthState('ready'); } })
      .catch(() => { if (!controller.signal.aborted) setHealthState('error'); });
    load();
    const timer = setInterval(load, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [metadataRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    setResult({ state: 'loading', records: [], error: '' });
    readJson(summaryUrl(applied), controller.signal)
      .then(summary => {
        if (!controller.signal.aborted) setResult({ state: 'ready', records: [], summary, error: '' });
      })
      .catch(error => { if (!controller.signal.aborted) setResult({ state: 'error', records: [], error: error.message }); });
    return () => controller.abort();
  }, [applied, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setRaw({ state: 'loading', records: [], nextCursor: null, error: '' });
    readJson(historyUrl(applied, pageCursors[page]), controller.signal)
      .then(data => { if (!controller.signal.aborted) setRaw({ state: 'ready', records: rawRecords(data.records), nextCursor: data.nextCursor, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setRaw({ state: 'error', records: [], nextCursor: null, error: error.message }); });
    return () => controller.abort();
  }, [applied, page, pageCursors, refresh]);
  const resetPages = () => { setPage(0); setPageCursors([null]); };
  const series = useMemo(() => result.summary ? summarySeries(result.summary) : [], [result.summary]);
  const observationCount = series.reduce((total, item) => total + item.count, 0);
  const resolution = { hour: 'Hourly', day: 'Daily', week: 'Weekly' }[result.summary?.resolution] || 'Hourly';
  const gapCount = series.reduce((total, item) => total + item.gaps, 0);
  const outliers = series.some(item => item.min < 0 || item.max > 100);
  const change = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setValidation(''); };
  const apply = event => {
    event.preventDefault();
    if (!draft.startDate || !draft.endDate || draft.startDate > draft.endDate) {
      setValidation('Choose a valid date range. The end date must be on or after the start date.'); return;
    }
    setValidation('');
    resetPages();
    setFiltersExpanded(false);
    if (!dirty) setRefresh(current => current + 1);
    else setApplied({ ...draft });
  };
  const reset = () => { resetPages(); const defaults = initialFilters(); setDraft(defaults); setApplied(defaults); setValidation(''); };
  const latest = series.map(item => item.latest).sort((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp)).at(-1);
  const db = healthState === 'ready' ? health?.database : null;
  const freshness = healthState === 'loading' ? 'Checking archive' : !db ? 'Status unavailable' : db.stale ? 'Collection delayed' : 'Archive up to date';
  const chartData = { datasets: series.map(item => ({ label: item.label, data: item.data, borderColor: item.color, backgroundColor: item.color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 14, tension: 0, stepped: false, showLine: false, spanGaps: false })) };
  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#202632', titleColor: '#ffffff', bodyColor: '#ffffff', padding: 12, displayColors: true, callbacks: { title: items => utcTime(items[0]?.parsed.x), label: item => { const bucket = item.raw.bucket; return [`${item.dataset.label}: ${percent(item.parsed.y)} average`, `Range: ${percent(bucket.min * 100)}-${percent(bucket.max * 100)}`, `${bucket.count} observations - latest ${percent(bucket.latest * 100)}`, `${utcTime(bucket.firstTimestamp)} - ${utcTime(bucket.lastTimestamp)}`]; } } } },
    scales: {
      x: { type: 'linear', min: Date.parse(`${applied.startDate}T00:00:00Z`), max: Date.parse(`${nextDay(applied.endDate)}T00:00:00Z`) - 1, grid: { color: '#303946', drawTicks: false }, border: { display: false }, ticks: { color: '#a5afbf', maxTicksLimit: 6, maxRotation: 0, padding: 12, callback: value => new Intl.DateTimeFormat('en-GB', { ...(Date.parse(nextDay(applied.endDate)) - Date.parse(applied.startDate) <= 172800000 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric' }), timeZone: 'UTC' }).format(new Date(value)) } },
      y: { min: outliers ? undefined : 0, suggestedMax: 100, border: { display: false }, grid: { color: '#303946', drawTicks: false }, ticks: { color: '#a5afbf', padding: 12, maxTicksLimit: 6, callback: value => `${value}%` } },
    },
  };

  return <div className="archive-app">
    <a className="skip-link" href="#history">Skip to history</a>
    <header className="masthead">
      <a className="brand" href="/" aria-label="Tarkov Time Capsule home">Tarkov Time Capsule</a>
      <div className="masthead-end"><span className="mode-tag">PvP · Regular</span><span className={`header-status ${db && !db.stale ? 'current' : ''}`}><span className="status-dot" />{freshness}</span></div>
    </header>
    <main>
      <section className="page-intro" aria-labelledby="page-title">
        <div><h1 id="page-title">Boss spawn history</h1><p className="intro-copy">Explore recorded spawn chances by map, boss and date.</p></div>
        <aside className="collection-status" aria-label="Collection status"><div className={`mobile-collection-status ${db && !db.stale ? 'current' : ''}`}><span className="status-dot" />{freshness}</div><span>Latest collection</span><strong>{db?.latestTimestamp ? utcTime(db.latestTimestamp) : '—'}</strong><p>{healthState === 'error' ? 'Status unavailable. History is still available.' : health?.collection?.enabled ? 'Collected hourly' : healthState === 'ready' ? 'Automatic collection is paused' : 'Checking collection status…'}</p>{healthState === 'error' && <button className="text-button" onClick={() => setMetadataRefresh(value => value + 1)}>Check again</button>}</aside>
      </section>
      <div className="workbench">
        <aside className="query-rail"><div className="section-heading"><h2>Filters</h2><button className="mobile-filter-toggle" type="button" aria-expanded={filtersExpanded} aria-controls="query-controls" onClick={() => setFiltersExpanded(value => !value)}>{filtersExpanded ? 'Hide filters' : 'Edit filters'}</button></div>
          <p className="mobile-query-summary">{applied.mapName || 'All maps'} · {applied.bossName || 'All bosses'}<span>{applied.startDate} → {applied.endDate}</span></p>
          <div id="query-controls" className={`query-body ${filtersExpanded ? 'expanded' : ''}`}>
          <form onSubmit={apply}>
            <div className="filter-field"><label htmlFor="map">Map</label><select id="map" disabled={optionsLoading} value={draft.mapName} onChange={event => change('mapName', event.target.value)}><option value="">All maps</option>{options.maps.map(name => <option key={name}>{name}</option>)}</select></div>
            <div className="filter-field"><label htmlFor="boss">Boss</label><select id="boss" disabled={optionsLoading} value={draft.bossName} onChange={event => change('bossName', event.target.value)}><option value="">All bosses</option>{options.bosses.map(name => <option key={name}>{name}</option>)}</select></div>
            {optionsLoading && <p className="field-help" role="status">Loading map and boss lists…</p>}
            {optionsError && <p className="inline-error">Filter lists could not load. <button type="button" className="text-button" onClick={() => setMetadataRefresh(value => value + 1)}>Retry</button></p>}
            <fieldset><legend>Quick range</legend><div className="range-buttons">{[7, 30, 90].map(days => { const range = recentRange(days); return <button key={days} type="button" aria-pressed={draft.startDate === range.startDate && draft.endDate === range.endDate} onClick={() => { setDraft(current => ({ ...current, ...range })); setValidation(''); }}>{days} days</button>; })}</div></fieldset>
            <div className="date-fields"><div><label htmlFor="start">From</label><input id="start" type="date" required value={draft.startDate} onChange={event => change('startDate', event.target.value)} /></div><div><label htmlFor="end">Through</label><input id="end" type="date" required value={draft.endDate} onChange={event => change('endDate', event.target.value)} /></div></div>

            {validation && <p className="inline-error" role="alert">{validation}</p>}
            <button className="apply-button" type="submit">Apply filters</button>
            <div className="filter-bottom"><span role="status">{dirty ? 'Unapplied changes' : 'Filters applied'}</span><button className="text-button" type="button" onClick={reset}>Reset</button></div>
          </form>
          </div>
        </aside>
        <section className="results" id="history" aria-labelledby="history-title" aria-busy={result.state === 'loading'}>
          <div className="results-heading"><div><h2 id="history-title">{applied.bossName || 'All bosses'} <span>· {applied.mapName || 'All maps'}</span></h2><p className="applied-range">{applied.startDate} <span>→</span> {applied.endDate} <span>· UTC</span></p></div><button className="export-button" aria-label="Export page CSV" onClick={() => downloadCsv(raw.records)} disabled={!raw.records.length || raw.state !== 'ready'}>↓ <span>Export page CSV</span></button></div>
          {result.state === 'loading' && <div className="state-panel" role="status"><span className="loading-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span><h3>Loading history</h3><p>Finding observations for this view…</p></div>}
          {result.state === 'error' && <div className="state-panel error-panel" role="alert"><span className="state-symbol">!</span><h3>History couldn’t be loaded</h3><p>{result.error} Your filters are saved.</p><button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Retry request</button></div>}
          {result.state === 'ready' && !series.length && <div className="state-panel"><span className="state-symbol">∅</span><h3>No observations in this view</h3><p>Try a wider time window or a different map and boss.<br />No data does not mean a 0% spawn chance.</p><button className="secondary-button" onClick={() => { resetPages(); const range = recentRange(90); setDraft(current => ({ ...current, ...range })); setApplied(current => ({ ...current, ...range })); }}>Explore the last 90 days</button></div>}
          {result.state === 'ready' && series.length > 0 && <>
            <div className="view-stats"><div><span className="field-caption">{series.length === 1 ? 'Latest in selected dates' : 'Series'}</span><strong>{series.length === 1 ? percent(Number(latest.Chance) * 100) : series.length}<span>{series.length === 1 ? 'spawn chance' : 'map / boss combinations'}</span></strong></div><div><span className="field-caption">Observations</span><strong>{observationCount.toLocaleString('en-GB')}<span>{utcTime(latest.Timestamp)}</span></strong></div></div>
            <div className="chart-topline"><span>{resolution} average spawn chance</span><span>All times UTC</span></div>
            <div className="chart-wrap"><Line data={chartData} options={chartOptions} role="img" aria-label={`Spawn chance history for ${series.length} map and boss combinations. Averages of recorded observations, with missing periods left unknown. Latest values and historical ranges are in the table below.`} /></div>
            <div className="chart-caption"><span>{resolution} averages - points show observed periods only</span><span>{gapCount ? `${gapCount} collection ${gapCount === 1 ? 'gap' : 'gaps'} in this view` : 'Missing periods are unknown; points are not connected'}</span></div>
            {outliers && <p className="data-notice">This view includes source values outside 0–100%. Original values are shown without clipping.</p>}
            <div className="table-heading"><h3>Latest observations</h3><span>Within selected dates</span></div>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Latest observations table"><table><thead><tr><th scope="col">Map / boss</th><th scope="col">Latest chance</th><th scope="col">Range in window</th><th scope="col">Observations</th><th scope="col">Last observed (UTC)</th></tr></thead><tbody>{series.map(item => <tr key={item.label}><th scope="row"><span className="series-dot" style={{ backgroundColor: item.color }} /><span>{item.latest.BossName}<small>{item.latest.MapName}</small></span></th><td className="chance-cell">{percent(Number(item.latest.Chance) * 100)}</td><td>{percent(item.min)} <span className="muted">—</span> {percent(item.max)}</td><td>{item.count.toLocaleString('en-GB')}</td><td className="timestamp-cell">{utcTime(item.latest.Timestamp).replace(' UTC', '')}</td></tr>)}</tbody></table></div>
          </>}
          <div className="table-heading"><h3>Raw observations</h3><span>250 per page - chronological order</span></div>
          {raw.state === 'loading' && <p className="raw-status" role="status">Loading observations…</p>}
          {raw.state === 'error' && <p className="inline-error" role="alert">{raw.error} <button className="text-button" onClick={() => { resetPages(); setRefresh(value => value + 1); }}>Restart observations</button></p>}
          {raw.state === 'ready' && <>
            {!raw.records.length ? <p className="raw-status">No raw observations on this page.</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Raw observations table"><table><thead><tr><th scope="col">Map</th><th scope="col">Boss</th><th scope="col">Chance</th><th scope="col">Observed (UTC)</th></tr></thead><tbody>{raw.records.map(row => <tr key={row.id}><td>{row.MapName}</td><td>{row.BossName}</td><td>{percent(Number(row.Chance) * 100)}</td><td className="timestamp-cell">{utcTime(row.Timestamp).replace(' UTC', '')}</td></tr>)}</tbody></table></div>}
          </>}
          <nav className="pagination" aria-label="Observation pages"><button className="secondary-button" disabled={page === 0 || raw.state === 'loading'} onClick={() => setPage(value => value - 1)}>Previous page</button><span aria-live="polite">Page {page + 1}{raw.state === 'ready' ? ` - ${raw.records.length} observations` : ''}</span><button className="secondary-button" disabled={!raw.nextCursor || raw.state !== 'ready'} onClick={() => { setPageCursors(cursors => [...cursors.slice(0, page + 1), raw.nextCursor]); setPage(value => value + 1); }}>Next page</button></nav>
        </section>
      </div>
      <footer><span>An independent archive of PvP spawn settings</span><span>Source: <a href="https://tarkov.dev" target="_blank" rel="noreferrer">tarkov.dev ↗</a><span className="footer-slash">/</span>Not affiliated with Battlestate Games</span></footer>
    </main>
  </div>;
}
