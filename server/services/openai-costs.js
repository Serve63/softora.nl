const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_USD_TO_EUR_RATE = 0.92;
const DEFAULT_EXCHANGE_RATE_API_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';
const DEFAULT_EXCHANGE_RATE_CACHE_MS = 30 * 60 * 1000;
const MAX_COST_PAGES = 12;
let usdToEurRateCache = null;

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeScope(value) {
  return normalizeString(value).toLowerCase() === 'all_time' ? 'all_time' : 'month';
}

function getMonthStartUnixSeconds(nowMs = Date.now()) {
  const now = new Date(Number(nowMs) || Date.now());
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000);
}

function buildCostWindow(scope, nowMs = Date.now()) {
  const safeNowMs = Math.max(0, Number(nowMs) || Date.now());
  const endTime = Math.max(1, Math.ceil(safeNowMs / 1000));
  const normalizedScope = normalizeScope(scope);
  const startTime =
    normalizedScope === 'all_time'
      ? Math.max(1, endTime - 31 * 24 * 60 * 60)
      : getMonthStartUnixSeconds(safeNowMs);

  return {
    scope: normalizedScope,
    startTime,
    endTime: Math.max(startTime + 1, endTime),
  };
}

function resolveOpenAiCostsApiKey(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiAdminApiKey ||
      deps.openAiCostsApiKey ||
      env.OPENAI_ADMIN_API_KEY ||
      env.OPENAI_COSTS_API_KEY
  );
}

function resolveAnthropicCostsApiKey(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.anthropicCostsApiKey ||
      deps.anthropicAdminApiKey ||
      deps.claudeAdminApiKey ||
      env.ANTHROPIC_COSTS_API_KEY ||
      env.ANTHROPIC_ADMIN_API_KEY ||
      env.CLAUDE_ADMIN_API_KEY
  );
}

function resolveOpenAiApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiCostsApiBaseUrl || deps.openAiApiBaseUrl || env.OPENAI_COSTS_API_BASE_URL || env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE_URL
  ).replace(/\/+$/, '');
}

function resolveOpenAiOrganizationId(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiOrganizationId ||
      deps.openAiOrgId ||
      env.OPENAI_ORGANIZATION_ID ||
      env.OPENAI_ORG_ID ||
      env.OPENAI_ORGANIZATION
  );
}

function resolveOpenAiProjectId(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiProjectId ||
      env.OPENAI_PROJECT_ID ||
      env.OPENAI_PROJECT
  );
}

function buildOpenAiCostHeaders(deps = {}, apiKey = '') {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  const organizationId = resolveOpenAiOrganizationId(deps);
  const projectId = resolveOpenAiProjectId(deps);
  if (organizationId) headers['OpenAI-Organization'] = organizationId;
  if (projectId) headers['OpenAI-Project'] = projectId;
  return headers;
}

function resolveAnthropicApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.anthropicCostsApiBaseUrl ||
      deps.anthropicApiBaseUrl ||
      env.ANTHROPIC_COSTS_API_BASE_URL ||
      env.ANTHROPIC_API_BASE_URL ||
      DEFAULT_ANTHROPIC_API_BASE_URL
  ).replace(/\/+$/, '');
}

function getConfiguredUsdToEurRate(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.usdToEurRate || env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_EUR_RATE;
}

function getExplicitUsdToEurRate(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.usdToEurRate || env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getExchangeRateCacheMs(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.exchangeRateCacheMs || env.OPENAI_COST_EXCHANGE_RATE_CACHE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_EXCHANGE_RATE_CACHE_MS;
}

function resolveExchangeRateApiUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.exchangeRateApiUrl || env.OPENAI_COST_EXCHANGE_RATE_URL || env.USD_TO_EUR_RATE_URL || DEFAULT_EXCHANGE_RATE_API_URL
  );
}

function parseUsdToEurRateResponse(data) {
  const direct = Number(
    data && (
      data.usdToEur ||
      data.usd_to_eur ||
      data.conversion_rate ||
      data.rate
    )
  );
  if (Number.isFinite(direct) && direct > 0) return direct;

  const rates = data && typeof data.rates === 'object' ? data.rates : {};
  const eur = Number(rates.EUR ?? rates.eur);
  return Number.isFinite(eur) && eur > 0 ? eur : 0;
}

function readUsdToEurRateCache(deps = {}, nowMs = Date.now()) {
  const cache = deps.usdToEurRateCache || usdToEurRateCache;
  if (!cache || typeof cache !== 'object') return null;

  const rate = Number(cache.rate);
  const fetchedAtMs = Number(cache.fetchedAtMs);
  const cacheMs = getExchangeRateCacheMs(deps);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(fetchedAtMs) || fetchedAtMs <= 0) return null;
  if (cacheMs <= 0 || nowMs - fetchedAtMs > cacheMs) return null;

  return {
    rate,
    source: normalizeString(cache.source) || 'live-cache',
    fetchedAtMs,
  };
}

function writeUsdToEurRateCache(deps = {}, value = {}) {
  const nextCache = {
    rate: Number(value.rate),
    source: normalizeString(value.source) || 'live',
    fetchedAtMs: Number(value.fetchedAtMs) || Date.now(),
  };
  if (deps.usdToEurRateCache && typeof deps.usdToEurRateCache === 'object') {
    Object.assign(deps.usdToEurRateCache, nextCache);
    return;
  }
  usdToEurRateCache = nextCache;
}

async function resolveUsdToEurRateDetails(deps = {}) {
  const explicitRate = getExplicitUsdToEurRate(deps);
  if (explicitRate > 0) {
    return {
      rate: explicitRate,
      source: 'configured',
      fetchedAtMs: null,
    };
  }

  const nowMs = Date.now();
  const cached = readUsdToEurRateCache(deps, nowMs);
  if (cached) return cached;

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  const exchangeRateApiUrl = resolveExchangeRateApiUrl(deps);
  if (typeof fetchJsonWithTimeout === 'function' && exchangeRateApiUrl && exchangeRateApiUrl.toLowerCase() !== 'off') {
    try {
      const { response, data } = await fetchJsonWithTimeout(
        exchangeRateApiUrl,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        5000
      );
      if (response && response.ok) {
        const rate = parseUsdToEurRateResponse(data);
        if (rate > 0) {
          const rateDetails = { rate, source: 'live', fetchedAtMs: nowMs };
          writeUsdToEurRateCache(deps, rateDetails);
          return rateDetails;
        }
      }
    } catch (_) {
      // Fallback below keeps the costs endpoint available when the rate provider is temporarily unreachable.
    }
  }

  return {
    rate: getConfiguredUsdToEurRate(deps),
    source: 'fallback',
    fetchedAtMs: null,
  };
}

function createServiceError(message, code, status = 500, detail = '') {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.detail = detail;
  return error;
}

function addCurrencyAmount(target, currency, amount) {
  const key = normalizeString(currency || 'usd').toLowerCase() || 'usd';
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return;
  target[key] = Math.round(((target[key] || 0) + value) * 100000000) / 100000000;
}

function collectOpenAiCostAmounts(data) {
  const currencies = {};
  let bucketCount = 0;
  let resultCount = 0;

  (Array.isArray(data && data.data) ? data.data : []).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    bucketCount += 1;
    const results = Array.isArray(bucket.results)
      ? bucket.results
      : Array.isArray(bucket.result)
        ? bucket.result
        : [];

    results.forEach((result) => {
      if (!result || typeof result !== 'object') return;
      resultCount += 1;
      const amount = result.amount && typeof result.amount === 'object' ? result.amount : {};
      addCurrencyAmount(currencies, amount.currency || result.currency, amount.value ?? result.value);
    });
  });

  return {
    currencies,
    bucketCount,
    resultCount,
  };
}

function buildOpenAiCostsUrl({ apiBaseUrl, startTime, endTime, page }) {
  const url = new URL(`${apiBaseUrl}/organization/costs`);
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  if (page) url.searchParams.set('page', page);
  return url.toString();
}

function isoFromUnixSeconds(value) {
  return new Date(Math.max(0, Number(value) || 0) * 1000).toISOString();
}

function buildAnthropicCostsUrl({ apiBaseUrl, startTime, endTime, page }) {
  const url = new URL(`${apiBaseUrl}/organizations/cost_report`);
  url.searchParams.set('starting_at', isoFromUnixSeconds(startTime));
  url.searchParams.set('ending_at', isoFromUnixSeconds(endTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  if (page) url.searchParams.set('page', page);
  return url.toString();
}

function parseAnthropicCostCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : 0;
}

function collectAnthropicCostAmounts(data) {
  let totalUsd = 0;
  let bucketCount = 0;
  let resultCount = 0;

  (Array.isArray(data && data.data) ? data.data : []).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    bucketCount += 1;
    const results = Array.isArray(bucket.results)
      ? bucket.results
      : Array.isArray(bucket.result)
        ? bucket.result
        : [];

    results.forEach((result) => {
      if (!result || typeof result !== 'object') return;
      resultCount += 1;

      if (result.amount && typeof result.amount === 'object') {
        const currency = normalizeString(result.amount.currency || result.currency).toLowerCase();
        if (!currency || currency === 'usd') totalUsd += Number(result.amount.value || 0) || 0;
        return;
      }

      const directUsd = Number(result.total_cost_usd ?? result.cost_usd ?? result.usd);
      if (Number.isFinite(directUsd) && directUsd > 0) {
        totalUsd += directUsd;
        return;
      }

      [
        'total_cost',
        'cost',
        'uncached_input_cost',
        'cached_input_cost',
        'cache_write_cost',
        'cache_read_cost',
        'input_cost',
        'output_cost',
        'web_search_cost',
        'code_execution_cost',
      ].forEach((key) => {
        totalUsd += parseAnthropicCostCents(result[key]);
      });
    });
  });

  return {
    currencies: { usd: Number(totalUsd.toFixed(8)) },
    bucketCount,
    resultCount,
  };
}

async function fetchOpenAiCostSummary(deps = {}, options = {}) {
  const apiKey = resolveOpenAiCostsApiKey(deps);
  if (!apiKey) {
    throw createServiceError(
      'OpenAI factuurkosten zijn nog niet gekoppeld.',
      'OPENAI_COSTS_NOT_CONFIGURED',
      503,
      'Zet OPENAI_COSTS_API_KEY of OPENAI_ADMIN_API_KEY om daadwerkelijke OpenAI-kosten te tonen.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('OpenAI kosten-helper ontbreekt.', 'OPENAI_COSTS_FETCH_UNAVAILABLE', 503);
  }

  const window = buildCostWindow(options.scope, options.nowMs);
  const apiBaseUrl = resolveOpenAiApiBaseUrl(deps);
  const currencies = {};
  let page = '';
  let bucketCount = 0;
  let resultCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const { response, data } = await fetchJsonWithTimeout(
      buildOpenAiCostsUrl({ apiBaseUrl, startTime: window.startTime, endTime: window.endTime, page }),
      {
        method: 'GET',
        headers: buildOpenAiCostHeaders(deps, apiKey),
      },
      15000
    );

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 502;
      const detail = normalizeString(data && (data.error && (data.error.message || data.error.code) || data.detail || data.raw));
      throw createServiceError('OpenAI factuurkosten konden niet geladen worden.', 'OPENAI_COSTS_FETCH_FAILED', status, detail);
    }

    const pageAmounts = collectOpenAiCostAmounts(data);
    Object.entries(pageAmounts.currencies).forEach(([currency, amount]) => {
      addCurrencyAmount(currencies, currency, amount);
    });
    bucketCount += pageAmounts.bucketCount;
    resultCount += pageAmounts.resultCount;

    page = normalizeString(data && data.next_page);
    if (!data || data.has_more !== true || !page) break;
  }

  const costUsd = Number((currencies.usd || 0).toFixed(8));
  const costEurDirect = Number((currencies.eur || 0).toFixed(8));
  const usdToEurRateDetails = await resolveUsdToEurRateDetails(deps);
  const costEur = Number((costEurDirect + costUsd * usdToEurRateDetails.rate).toFixed(2));

  return {
    scope: window.scope,
    source: 'openai-costs',
    exact: true,
    startTime: window.startTime,
    endTime: window.endTime,
    costUsd,
    costEur,
    usdToEurRate: usdToEurRateDetails.rate,
    usdToEurRateSource: usdToEurRateDetails.source,
    exchangeRateFetchedAtMs: usdToEurRateDetails.fetchedAtMs,
    currencies,
    organizationScoped: Boolean(resolveOpenAiOrganizationId(deps)),
    projectScoped: Boolean(resolveOpenAiProjectId(deps)),
    bucketCount,
    resultCount,
    note: 'OpenAI Costs API; USD-bedragen worden naar EUR omgerekend met een live wisselkoers wanneer er geen vaste koers is ingesteld.',
  };
}

async function fetchAnthropicCostSummary(deps = {}, options = {}) {
  const apiKey = resolveAnthropicCostsApiKey(deps);
  if (!apiKey) {
    throw createServiceError(
      'Anthropic factuurkosten zijn nog niet gekoppeld.',
      'ANTHROPIC_COSTS_NOT_CONFIGURED',
      503,
      'Zet ANTHROPIC_ADMIN_API_KEY of ANTHROPIC_COSTS_API_KEY om daadwerkelijke Claude-kosten te tonen.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('Anthropic kosten-helper ontbreekt.', 'ANTHROPIC_COSTS_FETCH_UNAVAILABLE', 503);
  }

  const window = buildCostWindow(options.scope, options.nowMs);
  const apiBaseUrl = resolveAnthropicApiBaseUrl(deps);
  const currencies = {};
  let page = '';
  let bucketCount = 0;
  let resultCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const { response, data } = await fetchJsonWithTimeout(
      buildAnthropicCostsUrl({ apiBaseUrl, startTime: window.startTime, endTime: window.endTime, page }),
      {
        method: 'GET',
        headers: {
          'anthropic-version': ANTHROPIC_API_VERSION,
          'x-api-key': apiKey,
          Accept: 'application/json',
        },
      },
      15000
    );

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 502;
      const detail = normalizeString(data && (data.error && (data.error.message || data.error.type) || data.detail || data.raw));
      throw createServiceError('Anthropic factuurkosten konden niet geladen worden.', 'ANTHROPIC_COSTS_FETCH_FAILED', status, detail);
    }

    const pageAmounts = collectAnthropicCostAmounts(data);
    Object.entries(pageAmounts.currencies).forEach(([currency, amount]) => {
      addCurrencyAmount(currencies, currency, amount);
    });
    bucketCount += pageAmounts.bucketCount;
    resultCount += pageAmounts.resultCount;

    page = normalizeString(data && data.next_page);
    if (!data || data.has_more !== true || !page) break;
  }

  const costUsd = Number((currencies.usd || 0).toFixed(8));
  const usdToEurRateDetails = await resolveUsdToEurRateDetails(deps);
  const costEur = Number((costUsd * usdToEurRateDetails.rate).toFixed(2));

  return {
    scope: window.scope,
    source: 'anthropic-costs',
    exact: true,
    startTime: window.startTime,
    endTime: window.endTime,
    costUsd,
    costEur,
    usdToEurRate: usdToEurRateDetails.rate,
    usdToEurRateSource: usdToEurRateDetails.source,
    exchangeRateFetchedAtMs: usdToEurRateDetails.fetchedAtMs,
    currencies,
    bucketCount,
    resultCount,
    note: 'Anthropic Cost Report API; kosten worden in USD-cents gerapporteerd en naar EUR omgerekend.',
  };
}

async function fetchCombinedApiCostSummary(deps = {}, options = {}) {
  const openAiSummary = await fetchOpenAiCostSummary(deps, options);

  return {
    scope: normalizeScope(options.scope),
    source: 'api-costs',
    exact: true,
    costUsd: openAiSummary.costUsd,
    costEur: openAiSummary.costEur,
    providers: [openAiSummary],
    unavailable: [],
    note: 'OpenAI factuurkosten deze maand.',
  };
}

function createOpenAiCostSummaryCoordinator(deps = {}) {
  return {
    async sendCostSummaryResponse(req, res) {
      try {
        const summary = await fetchOpenAiCostSummary(deps, {
          scope: req && req.query ? req.query.scope : 'month',
        });
        return res.status(200).json({
          ok: true,
          source: 'openai-costs',
          summary,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: error.code || 'OPENAI_COSTS_ERROR',
          detail: error.detail || error.message || 'OpenAI factuurkosten konden niet geladen worden.',
        });
      }
    },
    async sendCombinedCostSummaryResponse(req, res) {
      try {
        const summary = await fetchCombinedApiCostSummary(deps, {
          scope: req && req.query ? req.query.scope : 'month',
        });
        return res.status(200).json({
          ok: true,
          source: 'api-costs',
          summary,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: error.code || 'API_COSTS_ERROR',
          detail: error.detail || error.message || 'API-factuurkosten konden niet geladen worden.',
        });
      }
    },
  };
}

module.exports = {
  buildCostWindow,
  collectAnthropicCostAmounts,
  collectOpenAiCostAmounts,
  createOpenAiCostSummaryCoordinator,
  fetchAnthropicCostSummary,
  fetchCombinedApiCostSummary,
  fetchOpenAiCostSummary,
  parseUsdToEurRateResponse,
  resolveUsdToEurRateDetails,
};
