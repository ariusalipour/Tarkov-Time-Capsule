export function createCollector({ enabled, fetchData, storeData, transaction, now = () => new Date(), log = console }) {
  const state = { enabled, running: false, lastAttempt: null, lastSuccess: null, lastError: null };
  let pending = Promise.resolve();
  const run = () => {
    if (!enabled || state.running) return Promise.resolve(false);
    state.running = true;
    state.lastAttempt = now().toISOString();
    pending = (async () => {
      try {
        const data = await fetchData();
        if (!Array.isArray(data?.maps)) throw new Error('Upstream returned no maps array');
        await transaction(() => storeData(data));
        state.lastSuccess = now().toISOString();
        state.lastError = null;
        log.info('Collection completed', { timestamp: state.lastSuccess });
        return true;
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        log.error('Collection failed', { error: state.lastError });
        return false;
      } finally { state.running = false; }
    })();
    return pending;
  };
  return { state, run, wait: () => pending };
}

export function startHourlyScheduler(collector, { now = Date.now, schedule = setTimeout } = {}) {
  let timer;
  let stopped = false;
  const arm = () => {
    if (stopped || !collector.state.enabled) return;
    const delay = 3600000 - (now() % 3600000);
    timer = schedule(() => { void collector.run(); arm(); }, delay);
    timer.unref?.();
  };
  arm();
  return () => { stopped = true; clearTimeout(timer); };
}
