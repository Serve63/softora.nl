function createSeoConfigStore(deps = {}) {
  const {
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    normalizeString = (value) => String(value || '').trim(),
    getDefaultSeoConfig = () => ({ version: 2, pages: {}, images: {}, automation: {} }),
    normalizeSeoConfig = (value) => value,
    scope = 'seo',
    configKey = 'config_json',
    cacheTtlMs = 15000,
    logger = console,
    now = () => Date.now(),
  } = deps;

  let seoConfigCache = {
    loadedAtMs: 0,
    config: getDefaultSeoConfig(),
  };

  async function readSeoConfigFromUiState() {
    const state = await getUiStateValues(scope);
    const rawJson = normalizeString(state?.values?.[configKey] || '');
    if (!rawJson) return getDefaultSeoConfig();

    try {
      const parsed = JSON.parse(rawJson);
      return normalizeSeoConfig(parsed);
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[SEO Config][ParseError]', error?.message || error);
      }
      return getDefaultSeoConfig();
    }
  }

  async function getSeoConfigCached(forceFresh = false) {
    const nowMs = now();
    if (!forceFresh && nowMs - seoConfigCache.loadedAtMs < cacheTtlMs) {
      return seoConfigCache.config;
    }

    const config = await readSeoConfigFromUiState();
    seoConfigCache = {
      loadedAtMs: nowMs,
      config,
    };
    return config;
  }

  async function persistSeoConfig(config, meta = {}) {
    const normalizedConfig = normalizeSeoConfig(config);
    const payload = {
      [configKey]: JSON.stringify(normalizedConfig),
    };

    const state = await setUiStateValues(scope, payload, {
      source: normalizeString(meta.source || 'seo-dashboard'),
      actor: normalizeString(meta.actor || ''),
    });

    if (!state) return null;

    seoConfigCache = {
      loadedAtMs: now(),
      config: normalizedConfig,
    };
    return normalizedConfig;
  }

  return {
    readSeoConfigFromUiState,
    getSeoConfigCached,
    persistSeoConfig,
  };
}

module.exports = {
  createSeoConfigStore,
};
