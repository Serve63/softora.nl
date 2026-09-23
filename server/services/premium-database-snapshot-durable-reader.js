function createPremiumDatabaseSnapshotDurableReader(options = {}) {
  const { getUiStateValues, scope, key, parse, isCoherent, logger = console, nowMs = Date.now } = options;
  const readOptions = {
    uiStateReadTimeoutMs: 8000,
    bypassReadFailureCooldown: true,
    suppressReadFailureCooldown: true,
    suppressReadFailureLog: true,
    ignoreSupabaseRestFailureCooldown: true,
    suppressSupabaseRestFailureCooldown: true,
    readFailureCooldownScope: scope,
  };

  function versionOf(state) {
    if (state?.source !== 'supabase' || state.exists === false || !state.updatedAt) return null;
    return `${state.updatedAt}:${Number(state.revision) || 0}`;
  }

  async function readFull() {
    if (typeof getUiStateValues !== 'function') return { data: null, version: null };
    const startedAt = nowMs();
    let fetchedAt = null;
    let parsedAt = null;
    let encodedChars = 0;
    let outcome = 'error';
    try {
      const state = await getUiStateValues(scope, { ...readOptions, includeRevision: true });
      fetchedAt = nowMs();
      const values = state?.values && typeof state.values === 'object' ? state.values : {};
      const raw = values[key];
      encodedChars = typeof raw === 'string' ? raw.length : 0;
      const data = parse(raw);
      parsedAt = nowMs();
      const coherent = Boolean(data && isCoherent(data));
      outcome = coherent ? 'ready' : 'invalid';
      return { data: coherent ? data : null, version: versionOf(state) };
    } catch (error) {
      logger.warn?.('[PremiumDatabaseMailReadySnapshot][durable-read]', error?.message || error);
      return { data: null, version: null };
    } finally {
      const finishedAt = nowMs();
      logger.info?.(JSON.stringify({
        event: 'premium-snapshot-durable-read', outcome,
        fetchMs: Math.max(0, (fetchedAt ?? finishedAt) - startedAt),
        parseMs: fetchedAt === null ? 0 : Math.max(0, (parsedAt ?? finishedAt) - fetchedAt),
        validateMs: parsedAt === null ? 0 : Math.max(0, finishedAt - parsedAt), encodedChars,
      }));
    }
  }

  async function readVersion() {
    if (typeof getUiStateValues !== 'function') return null;
    try {
      return versionOf(await getUiStateValues(scope, { ...readOptions, metadataOnly: true }));
    } catch (error) {
      logger.warn?.('[PremiumDatabaseMailReadySnapshot][durable-version]', error?.message || error);
      return null;
    }
  }

  return { readFull, readVersion };
}

module.exports = { createPremiumDatabaseSnapshotDurableReader };
