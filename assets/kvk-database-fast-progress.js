(function mountFastKvkProgress(global) {
  'use strict';

  const PROGRESS_URL = '/api/kvk-database/snapshot/progress';
  const REFRESH_MS = 1000;
  let inFlight = false;
  let newestGeneratedAt = 0;
  let newestProgress = null;

  // Full snapshots own locations, company rows and their ordering clock.
  // Fast updates only overlay newer counters/activity: they must not make a
  // slower full snapshot (including the first Planning response) look stale.
  function overlaySnapshot(snapshot) {
    const progress = newestProgress;
    if (!progress || newestGeneratedAt < snapshotTime(snapshot)) return snapshot;
    return {
      ...snapshot,
      ...progress,
      state: { ...(snapshot?.state || {}), ...progress.state },
      companyTotals: { ...(snapshot?.companyTotals || {}), ...(progress.companyTotals || {}) },
      locations: Array.isArray(snapshot?.locations) ? snapshot.locations : [],
      companies: snapshot?.companies || {},
    };
  }

  function mergeProgress(progress) {
    if (!hasUsableSnapshot(progress)) return false;
    const generatedAt = snapshotTime(progress);
    if (!generatedAt || generatedAt < newestGeneratedAt || generatedAt < activeSnapshotTime) return false;
    newestGeneratedAt = generatedAt;
    newestProgress = progress;

    const merged = overlaySnapshot(activeSnapshot);
    // Applying content deliberately does not advance activeSnapshotTime.
    // That clock belongs to setActiveSnapshot and the full-snapshot stream.
    applySnapshotContent(merged);
    global.SoftoraKvkWorkerStatus?.updateSheetRobot(progress.sheetRobot || progress.sheet_robot);
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

  global.SoftoraKvkFastProgress = { mergeProgress, overlaySnapshot, refresh, REFRESH_MS };
  global.setInterval(refresh, REFRESH_MS);
  global.addEventListener('focus', refresh);
  global.document.addEventListener('visibilitychange', refresh);
  refresh();
})(window);
