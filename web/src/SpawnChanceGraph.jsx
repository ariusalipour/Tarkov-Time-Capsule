import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { apiUrl, recordsCsv, initialFilters, nextDay, percent, recentRange, summarySeries, historyUrl, summaryUrl, rawRecords, utcTime } from './archiveData';

import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Badge } from '@astryxdesign/core/Badge';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Archive, ArrowDownToLine, ArrowUpRight, ChartNoAxesCombined, Database, SlidersHorizontal, RotateCcw, Clock3, Info, ChevronRight, ChevronLeft } from 'lucide-react';

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
  const [view, setView] = useState('history');
  const filterToggle = useRef(null);
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
    if (filtersExpanded) filterToggle.current?.focus();
    if (!dirty) setRefresh(current => current + 1);
    else setApplied({ ...draft });
  };
  const reset = () => { resetPages(); const defaults = initialFilters(); setDraft(defaults); setApplied(defaults); setValidation(''); };
  const latest = series.map(item => item.latest).sort((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp)).at(-1);
  const db = healthState === 'ready' ? health?.database : null;
  const freshness = healthState === 'loading' ? 'Checking archive' : !db ? 'Status unavailable' : db.stale ? 'Collection delayed' : 'Archive up to date';
  const chartData = { datasets: series.map(item => ({ label: item.label, data: item.data, borderColor: item.color, backgroundColor: item.color, borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 5, pointHitRadius: 14, tension: 0, stepped: false, showLine: false, spanGaps: false })) };
  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#222825', titleColor: '#ffffff', bodyColor: '#ffffff', padding: 12, displayColors: true, callbacks: { title: items => utcTime(items[0]?.parsed.x), label: item => { const bucket = item.raw.bucket; return [`${item.dataset.label}: ${percent(item.parsed.y)} average`, `Range: ${percent(bucket.min * 100)}-${percent(bucket.max * 100)}`, `${bucket.count} observations - latest ${percent(bucket.latest * 100)}`, `${utcTime(bucket.firstTimestamp)} - ${utcTime(bucket.lastTimestamp)}`]; } } } },
    scales: {
      x: { type: 'linear', min: Date.parse(`${applied.startDate}T00:00:00Z`), max: Date.parse(`${nextDay(applied.endDate)}T00:00:00Z`) - 1, grid: { color: '#2b302e', drawTicks: false }, border: { display: false }, ticks: { color: '#9aa49f', maxTicksLimit: 6, maxRotation: 0, padding: 12, callback: value => new Intl.DateTimeFormat('en-GB', { ...(Date.parse(nextDay(applied.endDate)) - Date.parse(applied.startDate) <= 172800000 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric' }), timeZone: 'UTC' }).format(new Date(value)) } },
      y: { min: outliers ? undefined : 0, suggestedMax: 100, border: { display: false }, grid: { color: '#2b302e', drawTicks: false }, ticks: { color: '#9aa49f', padding: 12, maxTicksLimit: 6, callback: value => `${value}%` } },
    },
  };

  return <div className="archive-app">
    <a className="skip-link" href="#history">Skip to history</a>
    <header className="masthead">
      <a className="brand" href="/" aria-label="Tarkov Time Capsule home">
        <span className="brand-mark"><Archive size={21} strokeWidth={1.6} aria-hidden="true" /></span>
        <span>Tarkov <strong>Time Capsule</strong></span>
      </a>
      <div className="masthead-end">
        <span className="environment-label">ESCAPE FROM TARKOV <span>/</span> PVP</span>
        <a className="discord-link" href="https://discord.com/oauth2/authorize?client_id=1572583284146446438&scope=bot%20applications.commands&permissions=3072&integration_type=0" target="_blank" rel="noreferrer">Add to Discord <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div>
    </header>
    <main>
      <section className="page-intro" aria-labelledby="page-title">
        <div><p className="eyebrow">THE SPAWN ARCHIVE</p><h1 id="page-title">Every chance. Over time.</h1><p className="intro-copy">Explore how boss spawn chances changed, one observation at a time.</p></div>
        <aside className="collection-status" aria-label="Collection status">
          <span className={`freshness ${db && !db.stale ? 'current' : ''}`}><span className="status-dot" />{freshness}</span>
          <span className="last-collection"><Clock3 size={13} aria-hidden="true" />{db?.latestTimestamp ? utcTime(db.latestTimestamp) : 'Latest collection unavailable'}</span>
          <span className="collection-detail">{healthState === 'error' ? 'History is still available.' : health?.collection?.enabled ? 'Collected hourly · Regular PvP' : healthState === 'ready' ? 'Automatic collection is paused' : 'Checking collection status…'}</span>
          {healthState === 'error' && <Button variant="ghost" label="Check again" onClick={() => setMetadataRefresh(value => value + 1)} />}
        </aside>
      </section>
      <div className="workbench">
        <aside className="query-rail" aria-label="Archive filters">
          <div className="section-heading"><h2><SlidersHorizontal size={16} aria-hidden="true" /> Explore the archive</h2>
            <Button ref={filterToggle} className="mobile-filter-toggle" label={filtersExpanded ? 'Hide filters' : 'Edit filters'} aria-expanded={filtersExpanded} aria-controls="query-controls" variant="secondary" onClick={() => setFiltersExpanded(value => !value)} />
          </div>
          <p className="mobile-query-summary">{applied.mapName || 'All maps'} · {applied.bossName || 'All bosses'}<span>{applied.startDate} → {applied.endDate}</span></p>
          <div id="query-controls" className={`query-body ${filtersExpanded ? 'expanded' : ''}`}>
            <form onSubmit={apply}>
              <Selector label="Map" value={draft.mapName} options={[{value: '', label: 'All maps'}, ...options.maps]} onChange={value => change('mapName', value)} hasSearch searchPlaceholder="Find a map…" presentation="adaptive" isDisabled={optionsLoading} isLoading={optionsLoading} size="lg" width="100%" />
              <Selector label="Boss" value={draft.bossName} options={[{value: '', label: 'All bosses'}, ...options.bosses]} onChange={value => change('bossName', value)} hasSearch searchPlaceholder="Find a boss…" presentation="adaptive" isDisabled={optionsLoading} size="lg" width="100%" />
              {optionsLoading && <p className="field-help" role="status">Loading map and boss lists…</p>}
              {optionsError && <p className="inline-error">Filter lists could not load. <Button label="Retry" variant="ghost" onClick={() => setMetadataRefresh(value => value + 1)} /></p>}
              <div className="filter-divider" />
              <fieldset className="quick-ranges"><legend>Time period</legend><div className="range-buttons">{[7, 30, 90].map(days => {
                const range = recentRange(days);
                return <Button key={days} label={`${days} days`} variant="secondary" aria-pressed={draft.startDate === range.startDate && draft.endDate === range.endDate} onClick={() => { setDraft(current => ({ ...current, ...range })); setValidation(''); }} />;
              })}</div></fieldset>
              <div className="date-fields"><div><label htmlFor="start">From</label><input id="start" type="date" required value={draft.startDate} onChange={event => change('startDate', event.target.value)} /></div><div><label htmlFor="end">Through</label><input id="end" type="date" required value={draft.endDate} onChange={event => change('endDate', event.target.value)} /></div></div>
              <p className="field-help">Dates include the full day, in UTC.</p>
              {validation && <p className="inline-error" role="alert">{validation}</p>}
              <Button className="apply-button" type="submit" size="lg" variant="primary" label="Apply filters" endContent={<ChevronRight size={16} aria-hidden="true" />} />
              <div className="filter-bottom"><span className={dirty ? 'dirty' : ''} role="status">{dirty ? 'Unapplied changes' : 'Filters applied'}</span><Button variant="ghost" label="Reset" icon={<RotateCcw size={13} aria-hidden="true" />} onClick={reset} /></div>
            </form>
          </div>
          <div className="archive-note"><Info size={15} aria-hidden="true" /><p>Recorded game settings.<br />A chance is never a guarantee.</p></div>
        </aside>
        <section className="results" id="history" aria-labelledby="history-title">
          <div className="results-heading"><div><p className="eyebrow">SPAWN HISTORY</p><h2 id="history-title">{applied.bossName || 'All bosses'} <span>/ {applied.mapName || 'All maps'}</span></h2><p className="applied-range">{applied.startDate} <span>—</span> {applied.endDate} <span>· UTC</span></p></div><Badge label="PvP · Regular" variant="neutral" /></div>
          <div className="view-navigation"><TabList role="tablist" aria-label="Archive view" value={view} onChange={setView} size="lg" hasDivider>
            <Tab id="history-tab" value="history" label="History" panelId="history-panel" icon={<ChartNoAxesCombined size={16} aria-hidden="true" />} />
            <Tab id="observations-tab" value="observations" label="Observations" panelId="observations-panel" icon={<Database size={16} aria-hidden="true" />} />
          </TabList><span className="view-context">{view === 'history' ? 'The full picture' : 'The original records'}</span></div>
          <div id="history-panel" role="tabpanel" aria-labelledby="history-tab" hidden={view !== 'history'} tabIndex={0} aria-busy={result.state === 'loading'}>
            {result.state === 'loading' && <div className="state-panel" role="status"><Spinner size="xl" /><h3>Loading history</h3><p>Finding observations for this view…</p></div>}
            {result.state === 'error' && <div className="state-panel error-panel" role="alert"><Info size={28} aria-hidden="true" /><h3>History couldn’t be loaded</h3><p>{result.error} Your filters are saved.</p><Button label="Retry request" onClick={() => setRefresh(value => value + 1)} /></div>}
            {result.state === 'ready' && !series.length && <div className="state-panel"><Archive size={32} strokeWidth={1.3} aria-hidden="true" /><h3>No observations in this view</h3><p>Try a wider time window or a different map and boss.<br />No data does not mean a 0% spawn chance.</p><Button label="Explore the last 90 days" onClick={() => { resetPages(); const range = recentRange(90); setDraft(current => ({ ...current, ...range })); setApplied(current => ({ ...current, ...range })); }} /></div>}
            {result.state === 'ready' && series.length > 0 && <>
              <div className="view-stats">
                <div className="primary-stat"><span className="field-caption">{series.length === 1 ? 'Latest recorded chance' : 'Map / boss combinations'}</span><strong>{series.length === 1 ? percent(Number(latest.Chance) * 100) : series.length}</strong><span className="stat-detail">Within selected dates</span></div>
                <div><span className="field-caption">{series.length === 1 ? 'Range in this window' : 'Latest observation'}</span><strong>{series.length === 1 ? `${percent(series[0].min)} — ${percent(series[0].max)}` : utcTime(latest.Timestamp).split(',')[0]}</strong><span className="stat-detail">{series.length === 1 ? 'Lowest to highest recorded' : utcTime(latest.Timestamp).split(',')[1]}</span></div>
                <div><span className="field-caption">Observations</span><strong>{observationCount.toLocaleString('en-GB')}</strong><span className="stat-detail">Across the full date range</span></div>
              </div>
              <div className="chart-section"><div className="chart-topline"><h3>{resolution} average spawn chance</h3><Badge label={`${resolution} averages`} /></div>
                <div className="chart-wrap"><Line data={chartData} options={chartOptions} role="img" aria-label={`Spawn chance history for ${series.length} map and boss combinations. Averages of recorded observations, with missing periods left unknown. Latest values and historical ranges are in the table below.`} /></div>
                <div className="chart-caption"><span>{resolution} averages · hover for range and count</span><span>{gapCount ? `${gapCount} collection ${gapCount === 1 ? 'gap' : 'gaps'} · missing periods are unknown` : 'Only observed periods are shown'}</span></div>
              </div>
              {outliers && <p className="data-notice">This view includes source values outside 0–100%. Original values are shown without clipping.</p>}
              <div className="table-heading"><h3>Series summary</h3><span>Latest values within selected dates</span></div>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Latest observations table"><table><thead><tr><th scope="col">Map / boss</th><th scope="col">Latest chance</th><th scope="col">Range in window</th><th scope="col">Observations</th><th scope="col">Last observed (UTC)</th></tr></thead><tbody>{series.map(item => <tr key={item.label}><th scope="row"><span className="series-dot" style={{ backgroundColor: item.color }} /><span>{item.latest.BossName}<small>{item.latest.MapName}</small></span></th><td className="chance-cell">{percent(Number(item.latest.Chance) * 100)}</td><td>{percent(item.min)} <span className="muted">—</span> {percent(item.max)}</td><td>{item.count.toLocaleString('en-GB')}</td><td className="timestamp-cell">{utcTime(item.latest.Timestamp).replace(' UTC', '')}</td></tr>)}</tbody></table></div>
            </>}
          </div>
          <div id="observations-panel" role="tabpanel" aria-labelledby="observations-tab" hidden={view !== 'observations'} tabIndex={0} aria-busy={raw.state === 'loading'}>
            <div className="raw-heading"><div><h3>Raw observations</h3><p>The original records, in chronological order. Up to 250 per page.</p></div><Button label="Export page CSV" icon={<ArrowDownToLine size={15} aria-hidden="true" />} onClick={() => downloadCsv(raw.records)} isDisabled={!raw.records.length || raw.state !== 'ready'} /></div>
            {raw.state === 'loading' && <div className="raw-status" role="status"><Spinner /> Loading observations…</div>}
            {raw.state === 'error' && <div className="state-panel error-panel" role="alert"><Info size={28} aria-hidden="true" /><h3>Observations couldn’t be loaded</h3><p>{raw.error}</p><Button label="Restart observations" onClick={() => { resetPages(); setRefresh(value => value + 1); }} /></div>}
            {raw.state === 'ready' && (!raw.records.length ? <p className="raw-status">No raw observations on this page.</p> : <div className="table-scroll raw-table" tabIndex={0} role="region" aria-label="Raw observations table"><table><thead><tr><th scope="col">Map</th><th scope="col">Boss</th><th scope="col">Chance</th><th scope="col">Observed (UTC)</th></tr></thead><tbody>{raw.records.map(row => <tr key={row.id}><td>{row.MapName}</td><td>{row.BossName}</td><td className="chance-cell">{percent(Number(row.Chance) * 100)}</td><td className="timestamp-cell">{utcTime(row.Timestamp).replace(' UTC', '')}</td></tr>)}</tbody></table></div>)}
            <nav className="pagination" aria-label="Observation pages"><Button label="Previous page" icon={<ChevronLeft size={15} aria-hidden="true" />} isDisabled={page === 0 || raw.state === 'loading'} onClick={() => setPage(value => value - 1)} /><span aria-live="polite">Page {page + 1}{raw.state === 'ready' ? ` - ${raw.records.length} observations` : ''}</span><Button label="Next page" endContent={<ChevronRight size={15} aria-hidden="true" />} isDisabled={!raw.nextCursor || raw.state !== 'ready'} onClick={() => { setPageCursors(cursors => [...cursors.slice(0, page + 1), raw.nextCursor]); setPage(value => value + 1); }} /></nav>
          </div>
        </section>
      </div>
      <footer><span>An independent archive. Not affiliated with Battlestate Games.</span><div><a href="https://tarkov.dev" target="_blank" rel="noreferrer">Data from tarkov.dev <ArrowUpRight size={12} aria-hidden="true" /></a><a href="https://mockachino.app/projects/tarkov-time-capsule/privacy/">Privacy</a><a href="https://mockachino.app/projects/tarkov-time-capsule/terms/">Terms</a></div></footer>
    </main>
  </div>;
}
