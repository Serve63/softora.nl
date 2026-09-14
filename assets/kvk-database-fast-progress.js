(function mountFastKvkProgress(global) {
  'use strict';

  const PROGRESS_URL = '/api/kvk-database/snapshot/progress';
  const REFRESH_MS = 1000;
  let inFlight = false;
  let newestGeneratedAt = '';

  function mergeProgress(progress) {
    if (!progress || typeof progress !== 'object' || !progress.state) return false;
    const generatedAt = String(progress.generatedAt || '');
    if (generatedAt && newestGeneratedAt && generatedAt < newestGeneratedAt) return false;
    newestGeneratedAt = generatedAt || newestGeneratedAt;

    const merged = {
      ...activeSnapshot,
      ...progress,
      state: { ...(activeSnapshot?.state || {}), ...progress.state },
      companyTotals: { ...(activeSnapshot?.companyTotals || {}), ...(progress.companyTotals || {}) },
      locations: Array.isArray(activeSnapshot?.locations) ? activeSnapshot.locations : [],
      companies: activeSnapshot?.companies || {},
    };
    if (!setActiveSnapshot(merged)) return false;
    state.scraper = { ...state.scraper, ...merged.state };
    renderLastRefreshTime();
    renderStats();
    renderLatestTreatedRows();
    global.dispatchEvent(new CustomEvent('softora:kvk-progress', { detail: progress }));
    return true;
  }

  async function refresh() {
    if (inFlight || global.document.hidden) return;
    inFlight = true;
    try {
      const response = await global.fetch(`${PROGRESS_URL}?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = await response.json();
      mergeProgress(payload?.progress || payload);
    } catch {
      // De volledige 15-secondenroute blijft de compatibele fallback.
    } finally {
      inFlight = false;
    }
  }

  global.SoftoraKvkFastProgress = { mergeProgress, refresh, REFRESH_MS };
  global.setInterval(refresh, REFRESH_MS);
  global.addEventListener('focus', refresh);
  global.document.addEventListener('visibilitychange', refresh);
  refresh();
})(window);
