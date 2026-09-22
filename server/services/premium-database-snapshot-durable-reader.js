function createPremiumDatabaseSnapshotDurableReader(options = {}) {
  const { getUiStateValues, scope, key, parse, isCoherent, logger = console } = options;
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
    try {
      const state = await getUiStateValues(scope, { ...readOptions, includeRevision: true });
      const values = state?.values && typeof state.values === 'object' ? state.values : {};
      const data = parse(values[key]);
      return { data: data && isCoherent(data) ? data : null, version: versionOf(state) };
    } catch (error) {
      logger.warn?.('[PremiumDatabaseMailReadySnapshot][durable-read]', error?.message || error);
      return { data: null, version: null };
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
