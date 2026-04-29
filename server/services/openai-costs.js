const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_USD_TO_EUR_RATE = 0.92;
const MAX_COST_PAGES = 12;

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
    deps.openAiCostsApiKey ||
      deps.openAiAdminApiKey ||
      env.OPENAI_COSTS_API_KEY ||
      env.OPENAI_ADMIN_API_KEY ||
      env.OPENAI_API_KEY
  );
}

function resolveOpenAiApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiCostsApiBaseUrl || deps.openAiApiBaseUrl || env.OPENAI_COSTS_API_BASE_URL || env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE_URL
  ).replace(/\/+$/, '');
}

function getUsdToEurRate(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.usdToEurRate || env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_EUR_RATE;
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
  const usdToEurRate = getUsdToEurRate(deps);
  const currencies = {};
  let page = '';
  let bucketCount = 0;
  let resultCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const { response, data } = await fetchJsonWithTimeout(
      buildOpenAiCostsUrl({ apiBaseUrl, startTime: window.startTime, endTime: window.endTime, page }),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
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
  const costEur = Number((costEurDirect + costUsd * usdToEurRate).toFixed(2));

  return {
    scope: window.scope,
    source: 'openai-costs',
    exact: true,
    startTime: window.startTime,
    endTime: window.endTime,
    costUsd,
    costEur,
    usdToEurRate,
    currencies,
    bucketCount,
    resultCount,
    note: 'OpenAI Costs API; USD-bedragen worden naar EUR omgerekend met de ingestelde wisselkoers.',
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
  };
}

module.exports = {
  buildCostWindow,
  collectOpenAiCostAmounts,
  createOpenAiCostSummaryCoordinator,
  fetchOpenAiCostSummary,
};
