(function initSportschoolLogbookSync(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MISSING = Symbol('missing');

  function parseUpdatedAtMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cloneValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function sameValue(leftPresent, left, rightPresent, right) {
    if (leftPresent !== rightPresent) return false;
    if (!leftPresent) return true;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function mergeValue(basePresent, base, localPresent, local, remotePresent, remote) {
    if (sameValue(localPresent, local, basePresent, base)) {
      return remotePresent ? cloneValue(remote) : MISSING;
    }
    if (sameValue(remotePresent, remote, basePresent, base)) {
      return localPresent ? cloneValue(local) : MISSING;
    }
    if (!localPresent) return MISSING;
    if (!remotePresent) return cloneValue(local);

    if (isPlainObject(local) && isPlainObject(remote)) {
      const baseObject = isPlainObject(base) ? base : {};
      const merged = {};
      const keys = new Set([
        ...Object.keys(baseObject),
        ...Object.keys(local),
        ...Object.keys(remote),
      ]);
      keys.forEach((key) => {
        if (key === 'updatedAt') return;
        const nextValue = mergeValue(
          Object.prototype.hasOwnProperty.call(baseObject, key),
          baseObject[key],
          Object.prototype.hasOwnProperty.call(local, key),
          local[key],
          Object.prototype.hasOwnProperty.call(remote, key),
          remote[key]
        );
        if (nextValue !== MISSING) merged[key] = nextValue;
      });
      return merged;
    }

    // Bij een echte veldconflict wint de huidige lokale invoer. De server bewaart
    // de vorige remote snapshot in de logboekhistorie, dus geen van beide verdwijnt.
    return cloneValue(local);
  }

  function mergeConflictSnapshots(baseSnapshot, localSnapshot, remoteSnapshot, nowIso = () => new Date().toISOString()) {
    const base = isPlainObject(baseSnapshot) ? baseSnapshot : {};
    const local = isPlainObject(localSnapshot) ? localSnapshot : {};
    const remote = isPlainObject(remoteSnapshot) ? remoteSnapshot : {};
    const merged = mergeValue(true, base, true, local, true, remote);
    const safeMerged = isPlainObject(merged) ? merged : cloneValue(local);
    safeMerged.updatedAt = nowIso();
    return safeMerged;
  }

  function readRemoteSnapshotInfo(state, stateKey, parseSnapshot) {
    const raw = state?.values?.[stateKey] || '';
    const snapshot = parseSnapshot(raw);
    if (!snapshot) return null;
    const snapshotJson = JSON.stringify(snapshot);
    const stateUpdatedAt = String(state?.updatedAt || '').trim();
    const snapshotUpdatedAt = String(snapshot.updatedAt || '').trim();
    return {
      snapshot,
      snapshotJson,
      updatedAtMs: Math.max(parseUpdatedAtMs(stateUpdatedAt), parseUpdatedAtMs(snapshotUpdatedAt)),
      versionToken: stateUpdatedAt || snapshotUpdatedAt,
    };
  }

  function createResumeRevalidator(options = {}) {
    const {
      fetchRemoteState,
      readSnapshotInfo,
      getKnownRemoteUpdatedAtMs = () => 0,
      hasLocalChanges = () => false,
      isReady = () => true,
      isVisible = () => true,
      applyRemoteSnapshot = () => {},
      nowMs = () => Date.now(),
      dedupeMs = 900,
      onError = () => {},
    } = options;
    let refreshInFlight = null;
    let lastRefreshStartedAt = 0;
    let refreshDeferredForLocalChanges = false;

    async function runRefresh(source) {
      try {
        const state = await fetchRemoteState();
        const info = readSnapshotInfo(state);
        if (!info || !info.updatedAtMs) return { status: 'unverifiable', source };
        if (info.updatedAtMs <= Number(getKnownRemoteUpdatedAtMs() || 0)) {
          return { status: 'not-newer', source };
        }
        if (hasLocalChanges()) {
          refreshDeferredForLocalChanges = true;
          return { status: 'local-changes', source };
        }
        applyRemoteSnapshot(info.snapshot, info);
        return { status: 'applied', source, updatedAtMs: info.updatedAtMs };
      } catch (error) {
        onError(error);
        return { status: 'error', source, error };
      } finally {
        refreshInFlight = null;
      }
    }

    function requestRefresh(source = 'resume', requestOptions = {}) {
      if (!isReady()) return Promise.resolve({ status: 'not-ready', source });
      if (!isVisible()) return Promise.resolve({ status: 'hidden', source });
      if (hasLocalChanges()) {
        refreshDeferredForLocalChanges = true;
        return Promise.resolve({ status: 'local-changes', source });
      }
      if (refreshInFlight) return refreshInFlight;
      const startedAt = nowMs();
      if (requestOptions.force !== true && startedAt - lastRefreshStartedAt < dedupeMs) {
        return Promise.resolve({ status: 'deduplicated', source });
      }
      lastRefreshStartedAt = startedAt;
      refreshInFlight = runRefresh(source);
      return refreshInFlight;
    }

    function notifyLocalStateSettled() {
      if (!refreshDeferredForLocalChanges || hasLocalChanges()) {
        return Promise.resolve({ status: 'not-deferred' });
      }
      refreshDeferredForLocalChanges = false;
      return requestRefresh('local-save-settled', { force: true });
    }

    return {
      notifyLocalStateSettled,
      requestRefresh,
    };
  }

  function bindResumeEvents(options = {}) {
    const {
      windowTarget,
      documentTarget,
      requestRefresh,
      onHidden = () => {},
    } = options;
    const onPageShow = () => requestRefresh('pageshow');
    const onFocus = () => requestRefresh('focus');
    const onVisibilityChange = () => {
      if (documentTarget.visibilityState === 'visible') requestRefresh('visibilitychange');
      else if (documentTarget.visibilityState === 'hidden') onHidden();
    };

    windowTarget.addEventListener('pageshow', onPageShow);
    windowTarget.addEventListener('focus', onFocus);
    documentTarget.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      windowTarget.removeEventListener('pageshow', onPageShow);
      windowTarget.removeEventListener('focus', onFocus);
      documentTarget.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  return {
    bindResumeEvents,
    createResumeRevalidator,
    mergeConflictSnapshots,
    parseUpdatedAtMs,
    readRemoteSnapshotInfo,
  };
});
