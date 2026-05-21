const {
  OPENAI_PRICING_SOURCE_URL,
  getOpenAiImageCostUsdPerImage,
  getOpenAiTextModelRates,
  getOpenAiWebSearchUsdPerCall,
} = require('./openai-pricing');
const {
  readSoftoraApiCostLedgerSummary,
} = require('./softora-api-cost-ledger');

const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_USD_TO_EUR_RATE = 0.92;
const DEFAULT_EXCHANGE_RATE_API_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';
const DEFAULT_EXCHANGE_RATE_CACHE_MS = 30 * 60 * 1000;
const DEFAULT_OPENAI_COSTS_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_OPENAI_COSTS_FETCH_RETRIES = 2;
const DEFAULT_OPENAI_COSTS_RETRY_DELAY_MS = 300;
const MAX_COST_PAGES = 12;
let usdToEurRateCache = null;
let openAiCostsDashboardCache = null;
let openAiCostsLastSuccessfulSnapshot = null;

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

function getDayStartUnixSeconds(nowMs = Date.now()) {
  const now = new Date(Number(nowMs) || Date.now());
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime() / 1000);
}

function getOpenAiCostsCacheMs(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.openAiCostsCacheMs || env.OPENAI_COSTS_CACHE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OPENAI_COSTS_CACHE_MS;
  return Math.min(Math.max(Math.round(parsed), 60 * 1000), 15 * 60 * 1000);
}

function getOpenAiCostsFetchRetries(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.openAiCostsFetchRetries ?? env.OPENAI_COSTS_FETCH_RETRIES);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_OPENAI_COSTS_FETCH_RETRIES;
  return Math.min(Math.round(parsed), 3);
}

function getOpenAiCostsRetryDelayMs(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.openAiCostsRetryDelayMs ?? env.OPENAI_COSTS_RETRY_DELAY_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_OPENAI_COSTS_RETRY_DELAY_MS;
  return Math.min(Math.round(parsed), 2000);
}

function getOpenAiCostsCacheStore(deps = {}) {
  if (deps.openAiCostsCache && typeof deps.openAiCostsCache === 'object') {
    return deps.openAiCostsCache;
  }
  if (!openAiCostsDashboardCache) {
    openAiCostsDashboardCache = {};
  }
  return openAiCostsDashboardCache;
}

function getOpenAiCostsLastSuccessfulSnapshot(deps = {}) {
  const cache = getOpenAiCostsCacheStore(deps);
  return cache.lastSuccessfulSnapshot || openAiCostsLastSuccessfulSnapshot || null;
}

function setOpenAiCostsLastSuccessfulSnapshot(deps = {}, snapshot) {
  const cache = getOpenAiCostsCacheStore(deps);
  cache.lastSuccessfulSnapshot = snapshot;
  openAiCostsLastSuccessfulSnapshot = snapshot;
}

function logOpenAiCosts(deps = {}, message, meta = {}) {
  const logger = deps.logger || console;
  const payload = {
    ...meta,
    service: 'openai-costs',
  };
  if (logger && typeof logger.info === 'function') {
    logger.info(`[openai-costs] ${message}`, payload);
    return;
  }
  if (logger && typeof logger.log === 'function') {
    logger.log(`[openai-costs] ${message}`, payload);
  }
}

function buildOpenAiDashboardPeriods(nowMs = Date.now()) {
  const safeNowMs = Math.max(0, Number(nowMs) || Date.now());
  const endTime = Math.max(1, Math.ceil(safeNowMs / 1000));
  const oneDaySeconds = 24 * 60 * 60;
  const todayStartTime = getDayStartUnixSeconds(safeNowMs);
  const monthStartTime = getMonthStartUnixSeconds(safeNowMs);

  return [
    {
      key: 'current_month',
      label: 'Huidige maand tot nu toe',
      startTime: monthStartTime,
      endTime: Math.max(monthStartTime + 1, endTime),
    },
    {
      key: 'today',
      label: 'Vandaag',
      startTime: todayStartTime,
      endTime: Math.max(todayStartTime + 1, endTime),
    },
    {
      key: 'last_7_days',
      label: 'Afgelopen 7 dagen',
      startTime: Math.max(1, endTime - 7 * oneDaySeconds),
      endTime,
    },
    {
      key: 'last_30_days',
      label: 'Afgelopen 30 dagen',
      startTime: Math.max(1, endTime - 30 * oneDaySeconds),
      endTime,
    },
  ];
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
      env.OPENAI_ADMIN_KEY ||
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
  if (Object.prototype.hasOwnProperty.call(deps, 'openAiProjectId')) {
    return normalizeString(deps.openAiProjectId);
  }
  return normalizeString(
    env.OPENAI_PROJECT_ID ||
      env.OPENAI_PROJECT
  );
}

function resolveOpenAiProjectFilterId(deps = {}, options = {}) {
  if (options && options.projectScope === false) return '';
  if (options && Object.prototype.hasOwnProperty.call(options, 'projectId')) {
    return normalizeString(options.projectId);
  }
  return resolveOpenAiProjectId(deps);
}

function withoutOpenAiProjectFilter(deps = {}) {
  const envSource = deps.env || process.env || {};
  return {
    ...deps,
    openAiProjectId: '',
    env: {
      ...envSource,
      OPENAI_PROJECT_ID: '',
      OPENAI_PROJECT: '',
    },
  };
}

function buildOpenAiCostHeaders(deps = {}, apiKey = '', options = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  const organizationId = resolveOpenAiOrganizationId(deps);
  const projectId = resolveOpenAiProjectFilterId(deps, options);
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

function sanitizeOpenAiCostDetail(value) {
  const detail = normalizeString(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [verborgen]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[verborgen]');
  return detail.length > 180 ? `${detail.slice(0, 177)}...` : detail;
}

function getOpenAiCostConfigStatus(deps = {}) {
  return {
    adminKeyConfigured: Boolean(resolveOpenAiCostsApiKey(deps)),
    organizationConfigured: Boolean(resolveOpenAiOrganizationId(deps)),
    projectConfigured: Boolean(resolveOpenAiProjectId(deps)),
  };
}

function getOpenAiCostErrorStatus(error) {
  const status = Number(error && error.status);
  if (!Number.isFinite(status) || status <= 0) return 500;
  if ((status === 401 || status === 403) && error && error.code === 'OPENAI_COSTS_FETCH_FAILED') {
    return 502;
  }
  return status;
}

function buildOpenAiCostErrorPayload(deps = {}, error = {}, fallbackDetail = 'OpenAI kosten konden niet worden opgehaald') {
  const upstreamStatus =
    error && error.code === 'OPENAI_COSTS_FETCH_FAILED' && Number.isFinite(Number(error.status))
      ? Number(error.status)
      : 0;
  const payload = {
    ok: false,
    error: error.code || 'OPENAI_COSTS_ERROR',
    detail: sanitizeOpenAiCostDetail(error.detail || error.message || fallbackDetail),
    config: getOpenAiCostConfigStatus(deps),
  };
  if (upstreamStatus > 0) {
    payload.upstreamStatus = upstreamStatus;
  }
  return payload;
}

function isRetryableOpenAiCostsStatus(status) {
  const numericStatus = Number(status);
  if (!Number.isFinite(numericStatus)) return true;
  return numericStatus === 408 || numericStatus === 429 || numericStatus >= 500;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function fetchOpenAiCostsJsonWithRetry(deps = {}, url, options, timeoutMs, meta = {}) {
  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  const maxAttempts = 1 + getOpenAiCostsFetchRetries(deps);
  const retryDelayMs = getOpenAiCostsRetryDelayMs(deps);
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fetchJsonWithTimeout(url, options, timeoutMs);
      const status = Number(result?.response?.status || 0);
      if (result?.response?.ok || !isRetryableOpenAiCostsStatus(status) || attempt >= maxAttempts) {
        return result;
      }
      lastResult = result;
      logOpenAiCosts(deps, 'tijdelijke openai status opnieuw proberen', {
        ...meta,
        statusCode: status,
        attempt,
        maxAttempts,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
      logOpenAiCosts(deps, 'tijdelijke openai fout opnieuw proberen', {
        ...meta,
        error: normalizeString(error?.message || 'fetch failed'),
        attempt,
        maxAttempts,
      });
    }

    if (retryDelayMs > 0) {
      await wait(retryDelayMs * attempt);
    }
  }

  if (lastResult) return lastResult;
  throw lastError || createServiceError('OpenAI kosten konden niet worden opgehaald', 'OPENAI_COSTS_FETCH_FAILED', 502);
}

function addCurrencyAmount(target, currency, amount) {
  const key = normalizeString(currency || 'usd').toLowerCase() || 'usd';
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return;
  target[key] = Math.round(((target[key] || 0) + value) * 100000000) / 100000000;
}

function addUsageTotals(target, source = {}) {
  target.requestCount += Math.max(0, Number(source.requestCount || 0) || 0);
  target.inputTokens += Math.max(0, Number(source.inputTokens || 0) || 0);
  target.cachedInputTokens += Math.max(0, Number(source.cachedInputTokens || 0) || 0);
  target.outputTokens += Math.max(0, Number(source.outputTokens || 0) || 0);
  target.imageCount += Math.max(0, Number(source.imageCount || 0) || 0);
  target.webSearchCalls += Math.max(0, Number(source.webSearchCalls || 0) || 0);
  target.embeddingTokens += Math.max(0, Number(source.embeddingTokens || 0) || 0);
  target.fileSearchCalls += Math.max(0, Number(source.fileSearchCalls || 0) || 0);
  target.codeInterpreterSessions += Math.max(0, Number(source.codeInterpreterSessions || 0) || 0);
  target.audioInputTokens += Math.max(0, Number(source.audioInputTokens || 0) || 0);
  target.audioOutputTokens += Math.max(0, Number(source.audioOutputTokens || 0) || 0);
  target.audioSeconds += Math.max(0, Number(source.audioSeconds || 0) || 0);
}

function resolveOpenAiUsageModel(result = {}, deps = {}) {
  return (
    normalizeString(
      result.model ||
        result.model_id ||
        result.model_name ||
        result.snapshot_id ||
        result.response_model ||
        deps.openAiUsageEstimateModel ||
        deps.openAiModel ||
        deps.env?.OPENAI_USAGE_ESTIMATE_MODEL ||
        deps.env?.OPENAI_MODEL ||
        'gpt-5.5'
    ) || 'gpt-5.5'
  );
}

function estimateOpenAiTextUsageUsd(result = {}, deps = {}) {
  const model = resolveOpenAiUsageModel(result, deps);
  const rates = getOpenAiTextModelRates(model);
  const inputTokens = Math.max(0, Number(result.input_tokens || result.prompt_tokens || 0) || 0);
  const outputTokens = Math.max(0, Number(result.output_tokens || result.completion_tokens || 0) || 0);
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Number(result.input_cached_tokens || result.cached_input_tokens || 0) || 0)
  );
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return {
    usd:
      (billableInputTokens / 1000000) * rates.input +
      (cachedInputTokens / 1000000) * rates.cachedInput +
      (outputTokens / 1000000) * rates.output,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    requestCount: Math.max(0, Number(result.num_model_requests || result.num_requests || 0) || 0),
    pricingFallbackModel: model,
  };
}

function estimateOpenAiImageUsageUsd(result = {}, deps = {}) {
  const imageCount = Math.max(0, Number(result.images || result.num_images || result.num_model_requests || 0) || 0);
  if (imageCount <= 0) return { usd: 0, imageCount: 0, requestCount: 0 };
  const perImageUsd = getOpenAiImageCostUsdPerImage(result.model, result.size, deps);
  return {
    usd: imageCount * perImageUsd,
    imageCount,
    requestCount: Math.max(0, Number(result.num_model_requests || imageCount) || 0),
  };
}

function estimateOpenAiWebSearchUsageUsd(result = {}, deps = {}) {
  const callCount = Math.max(
    0,
    Number(
      result.num_requests ??
        result.web_search_calls ??
        result.num_web_search_calls ??
        result.requests ??
        result.count ??
        result.num_model_requests ??
        0
    ) || 0
  );
  if (callCount <= 0) return { usd: 0, webSearchCalls: 0, requestCount: 0 };
  return {
    usd: callCount * getOpenAiWebSearchUsdPerCall(deps),
    webSearchCalls: callCount,
    requestCount: callCount,
  };
}

function getOpenAiEmbeddingModelRates(modelRaw) {
  const key = normalizeString(modelRaw).toLowerCase();
  if (key.includes('text-embedding-3-small')) return { input: 0.02 };
  if (key.includes('text-embedding-3-large')) return { input: 0.13 };
  if (key.includes('text-embedding-ada-002')) return { input: 0.1 };
  return { input: 0.1 };
}

function estimateOpenAiEmbeddingUsageUsd(result = {}) {
  const inputTokens = Math.max(
    0,
    Number(
      result.input_tokens ??
        result.inputTokens ??
        result.prompt_tokens ??
        result.usage_tokens ??
        result.num_tokens ??
        0
    ) || 0
  );
  const rates = getOpenAiEmbeddingModelRates(result.model);
  return {
    usd: (inputTokens / 1000000) * rates.input,
    embeddingTokens: inputTokens,
    requestCount: Math.max(0, Number(result.num_model_requests || result.num_requests || 0) || 0),
  };
}

function estimateOpenAiFileSearchUsageUsd(result = {}) {
  const callCount = Math.max(
    0,
    Number(result.num_requests ?? result.num_tool_calls ?? result.file_search_calls ?? result.count ?? 0) || 0
  );
  return {
    usd: (callCount / 1000) * 2.5,
    fileSearchCalls: callCount,
    requestCount: callCount,
  };
}

function estimateOpenAiCodeInterpreterUsageUsd(result = {}) {
  const sessionCount = Math.max(
    0,
    Number(result.num_sessions ?? result.sessions ?? result.num_requests ?? result.count ?? 0) || 0
  );
  return {
    usd: sessionCount * 0.03,
    codeInterpreterSessions: sessionCount,
    requestCount: sessionCount,
  };
}

function estimateOpenAiAudioUsageUsd(result = {}, usageType = 'audio') {
  const inputTokens = Math.max(0, Number(result.input_tokens || result.prompt_tokens || 0) || 0);
  const outputTokens = Math.max(0, Number(result.output_tokens || result.completion_tokens || 0) || 0);
  const seconds = Math.max(0, Number(result.seconds || result.duration_seconds || result.audio_seconds || 0) || 0);
  const model = normalizeString(result.model).toLowerCase();
  const isSpeech = usageType === 'audio_speeches';
  let usd = 0;

  if (inputTokens > 0 || outputTokens > 0) {
    const inputRate = model.includes('mini') ? 10 : 32;
    const outputRate = model.includes('mini') ? 20 : 64;
    usd = (inputTokens / 1000000) * inputRate + (outputTokens / 1000000) * outputRate;
  } else if (seconds > 0) {
    const perMinute = isSpeech
      ? 0.015
      : model.includes('mini')
        ? 0.003
        : 0.006;
    usd = (seconds / 60) * perMinute;
  }

  return {
    usd,
    audioInputTokens: inputTokens,
    audioOutputTokens: outputTokens,
    audioSeconds: seconds,
    requestCount: Math.max(0, Number(result.num_model_requests || result.num_requests || 0) || 0),
  };
}

function collectOpenAiUsageEstimate(data, deps = {}, usageType = 'text') {
  const currencies = {};
  const totals = {
    bucketCount: 0,
    resultCount: 0,
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    imageCount: 0,
    webSearchCalls: 0,
    embeddingTokens: 0,
    fileSearchCalls: 0,
    codeInterpreterSessions: 0,
    audioInputTokens: 0,
    audioOutputTokens: 0,
    audioSeconds: 0,
  };

  (Array.isArray(data && data.data) ? data.data : []).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    totals.bucketCount += 1;
    const results = Array.isArray(bucket.results) ? bucket.results : [];
    results.forEach((result) => {
      if (!result || typeof result !== 'object') return;
      totals.resultCount += 1;
      const estimate =
        usageType === 'images'
          ? estimateOpenAiImageUsageUsd(result, deps)
          : usageType === 'web_search_calls'
            ? estimateOpenAiWebSearchUsageUsd(result, deps)
            : usageType === 'embeddings'
              ? estimateOpenAiEmbeddingUsageUsd(result)
              : usageType === 'file_search_calls'
                ? estimateOpenAiFileSearchUsageUsd(result)
                : usageType === 'code_interpreter_sessions'
                  ? estimateOpenAiCodeInterpreterUsageUsd(result)
                  : usageType === 'audio_transcriptions' || usageType === 'audio_speeches'
                    ? estimateOpenAiAudioUsageUsd(result, usageType)
                    : estimateOpenAiTextUsageUsd(result, deps);
      addCurrencyAmount(currencies, 'usd', estimate.usd);
      addUsageTotals(totals, estimate);
    });
  });

  return {
    currencies,
    ...totals,
  };
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

function pickPrimaryCurrencyAmount(currencies = {}) {
  const entries = Object.entries(currencies || {})
    .map(([currency, amount]) => [normalizeString(currency).toLowerCase(), Number(amount)])
    .filter(([currency, amount]) => currency && Number.isFinite(amount) && amount >= 0);

  const preferredCurrency = ['usd', 'eur'].find((currency) =>
    entries.some(([entryCurrency]) => entryCurrency === currency)
  );
  const selected = preferredCurrency
    ? entries.find(([currency]) => currency === preferredCurrency)
    : entries[0];

  if (!selected) {
    return {
      currency: 'usd',
      amount: 0,
    };
  }

  return {
    currency: selected[0],
    amount: Math.round(selected[1] * 100000000) / 100000000,
  };
}

function appendRepeatedSearchParams(url, key, values = []) {
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const normalized = normalizeString(value);
    if (normalized) url.searchParams.append(key, normalized);
  });
}

function buildOpenAiCostsUrl({ apiBaseUrl, startTime, endTime, page, projectId }) {
  const url = new URL(`${apiBaseUrl}/organization/costs`);
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  appendRepeatedSearchParams(url, 'project_ids', projectId);
  if (page) url.searchParams.set('page', page);
  return url.toString();
}

function buildOpenAiUsageUrl({ apiBaseUrl, path, startTime, endTime, page, groupBy = [], projectId }) {
  const url = new URL(`${apiBaseUrl}${path}`);
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  appendRepeatedSearchParams(url, 'group_by', groupBy);
  appendRepeatedSearchParams(url, 'project_ids', projectId);
  if (page) url.searchParams.set('page', page);
  return url.toString();
}

async function fetchOpenAiCostPeriodSummary(deps = {}, period = {}) {
  const apiKey = resolveOpenAiCostsApiKey(deps);
  if (!apiKey) {
    logOpenAiCosts(deps, 'admin key aanwezig', { present: false });
    throw createServiceError(
      'OpenAI kosten konden niet worden opgehaald',
      'OPENAI_ADMIN_KEY_MISSING',
      503,
      'OPENAI_ADMIN_KEY ontbreekt. Voeg een OpenAI Admin Key server-side toe.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('OpenAI kosten-helper ontbreekt.', 'OPENAI_COSTS_FETCH_UNAVAILABLE', 503);
  }

  const apiBaseUrl = resolveOpenAiApiBaseUrl(deps);
  const projectId = resolveOpenAiProjectId(deps);
  const startTime = Math.max(1, Number(period.startTime) || 1);
  const endTime = Math.max(startTime + 1, Number(period.endTime) || startTime + 1);
  const currencies = {};
  let page = '';
  let bucketCount = 0;
  let resultCount = 0;
  let pageCount = 0;

  logOpenAiCosts(deps, 'periode ophalen', {
    adminKeyPresent: true,
    period: normalizeString(period.key) || 'custom',
    projectScoped: Boolean(projectId),
    startTime,
    endTime,
  });

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const url = buildOpenAiCostsUrl({ apiBaseUrl, startTime, endTime, page, projectId });
    const { response, data } = await fetchOpenAiCostsJsonWithRetry(
      deps,
      url,
      {
        method: 'GET',
        headers: buildOpenAiCostHeaders(deps, apiKey),
      },
      15000,
      {
        period: normalizeString(period.key) || 'custom',
        page: pageIndex + 1,
      }
    );
    pageCount += 1;

    logOpenAiCosts(deps, 'openai statuscode', {
      period: normalizeString(period.key) || 'custom',
      statusCode: response && response.status ? response.status : 0,
      page: pageIndex + 1,
    });

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 502;
      const detail = normalizeString(data && (data.error && (data.error.message || data.error.code) || data.detail || data.raw));
      throw createServiceError('OpenAI kosten konden niet worden opgehaald', 'OPENAI_COSTS_FETCH_FAILED', status, detail);
    }

    const pageAmounts = collectOpenAiCostAmounts(data);
    Object.entries(pageAmounts.currencies).forEach(([currency, amount]) => {
      addCurrencyAmount(currencies, currency, amount);
    });
    bucketCount += pageAmounts.bucketCount;
    resultCount += pageAmounts.resultCount;

    page = normalizeString(data && data.next_page);
    if (!page || data.has_more === false) break;
  }

  const primary = pickPrimaryCurrencyAmount(currencies);
  logOpenAiCosts(deps, 'periode totaal berekend', {
    period: normalizeString(period.key) || 'custom',
    amount: primary.amount,
    currency: primary.currency,
    bucketCount,
    resultCount,
    pageCount,
  });

  return {
    key: normalizeString(period.key) || 'custom',
    label: normalizeString(period.label) || 'OpenAI kosten',
    startTime,
    endTime,
    startAt: isoFromUnixSeconds(startTime),
    endAt: isoFromUnixSeconds(endTime),
    amount: primary.amount,
    currency: primary.currency,
    currencies,
    bucketCount,
    resultCount,
    pageCount,
  };
}

async function fetchOpenAiCostsDashboardSnapshot(deps = {}, options = {}) {
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const cacheMs = getOpenAiCostsCacheMs(deps);
  const cache = getOpenAiCostsCacheStore(deps);
  if (!options.forceRefresh && cache.snapshot && Number(cache.expiresAtMs || 0) > nowMs) {
    return {
      ...cache.snapshot,
      cache: {
        hit: true,
        ttlMs: Math.max(0, Number(cache.expiresAtMs || 0) - nowMs),
      },
    };
  }

  logOpenAiCosts(deps, 'admin key aanwezig', { present: Boolean(resolveOpenAiCostsApiKey(deps)) });

  const periods = {};
  for (const period of buildOpenAiDashboardPeriods(nowMs)) {
    periods[period.key] = await fetchOpenAiCostPeriodSummary(deps, period);
  }

  const currentMonth = periods.current_month;
  const currency = currentMonth && currentMonth.currency ? currentMonth.currency : 'usd';
  const fetchedAt = new Date(nowMs).toISOString();
  const snapshot = {
    status: 'success',
    source: 'openai-organization-costs',
    endpoint: '/v1/organization/costs',
    exact: true,
    currency,
    fetchedAt,
    lastSuccessfulUpdate: fetchedAt,
    cacheTtlMs: cacheMs,
    currentMonth,
    periods,
  };

  cache.snapshot = snapshot;
  cache.expiresAtMs = nowMs + cacheMs;
  setOpenAiCostsLastSuccessfulSnapshot(deps, snapshot);

  logOpenAiCosts(deps, 'snapshot succesvol bijgewerkt', {
    amount: currentMonth ? currentMonth.amount : 0,
    currency,
    lastSuccessfulUpdate: fetchedAt,
  });

  return {
    ...snapshot,
    cache: {
      hit: false,
      ttlMs: cacheMs,
    },
  };
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
      'OpenAI kosten konden niet worden opgehaald',
      'OPENAI_COSTS_NOT_CONFIGURED',
      503,
      'Zet OPENAI_ADMIN_KEY server-side om daadwerkelijke OpenAI-kosten te tonen.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('OpenAI kosten-helper ontbreekt.', 'OPENAI_COSTS_FETCH_UNAVAILABLE', 503);
  }

  const window = buildCostWindow(options.scope, options.nowMs);
  const apiBaseUrl = resolveOpenAiApiBaseUrl(deps);
  const projectId = resolveOpenAiProjectFilterId(deps, options);
  const currencies = {};
  let page = '';
  let bucketCount = 0;
  let resultCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const { response, data } = await fetchOpenAiCostsJsonWithRetry(
      deps,
      buildOpenAiCostsUrl({ apiBaseUrl, startTime: window.startTime, endTime: window.endTime, page, projectId }),
      {
        method: 'GET',
        headers: buildOpenAiCostHeaders(deps, apiKey, { projectId }),
      },
      15000,
      {
        scope: window.scope,
        page: pageIndex + 1,
      }
    );

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 502;
      const detail = normalizeString(data && (data.error && (data.error.message || data.error.code) || data.detail || data.raw));
      throw createServiceError('OpenAI kosten konden niet worden opgehaald', 'OPENAI_COSTS_FETCH_FAILED', status, detail);
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
  const fetchedAt = new Date(Math.max(0, Number(options.nowMs) || Date.now())).toISOString();

  return {
    scope: window.scope,
    source: 'openai-costs',
    exact: true,
    fetchedAt,
    lastSuccessfulUpdate: fetchedAt,
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
    projectFilterApplied: Boolean(projectId),
    organizationWide: !projectId,
    bucketCount,
    resultCount,
    note: 'OpenAI Costs API; USD-bedragen worden naar EUR omgerekend met een live wisselkoers wanneer er geen vaste koers is ingesteld.',
  };
}

async function fetchOpenAiUsageEstimateForEndpoint(deps = {}, window = {}, endpoint = {}) {
  const apiKey = resolveOpenAiCostsApiKey(deps);
  if (!apiKey) {
    throw createServiceError(
      'OpenAI usage kon niet worden opgehaald',
      'OPENAI_COSTS_NOT_CONFIGURED',
      503,
      'Zet OPENAI_ADMIN_KEY server-side om actuele OpenAI usage te tonen.'
    );
  }
  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('OpenAI usage-helper ontbreekt.', 'OPENAI_USAGE_FETCH_UNAVAILABLE', 503);
  }

  const apiBaseUrl = resolveOpenAiApiBaseUrl(deps);
  const projectId = resolveOpenAiProjectFilterId(deps, window);
  const currencies = {};
  const totals = {
    bucketCount: 0,
    resultCount: 0,
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    imageCount: 0,
    webSearchCalls: 0,
    embeddingTokens: 0,
    fileSearchCalls: 0,
    codeInterpreterSessions: 0,
    audioInputTokens: 0,
    audioOutputTokens: 0,
    audioSeconds: 0,
  };
  let page = '';
  let pageCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_COST_PAGES; pageIndex += 1) {
    const { response, data } = await fetchOpenAiCostsJsonWithRetry(
      deps,
      buildOpenAiUsageUrl({
        apiBaseUrl,
        path: endpoint.path,
        startTime: window.startTime,
        endTime: window.endTime,
        page,
        groupBy: endpoint.groupBy,
        projectId,
      }),
      {
        method: 'GET',
        headers: buildOpenAiCostHeaders(deps, apiKey, { projectId }),
      },
      15000,
      {
        scope: window.scope,
        usageEndpoint: endpoint.key,
        page: pageIndex + 1,
      }
    );
    pageCount += 1;

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 502;
      const detail = normalizeString(data && (data.error && (data.error.message || data.error.code) || data.detail || data.raw));
      throw createServiceError('OpenAI usage kon niet worden opgehaald', 'OPENAI_USAGE_FETCH_FAILED', status, detail);
    }

    const pageAmounts = collectOpenAiUsageEstimate(data, deps, endpoint.usageType);
    Object.entries(pageAmounts.currencies).forEach(([currency, amount]) => {
      addCurrencyAmount(currencies, currency, amount);
    });
    addUsageTotals(totals, pageAmounts);
    totals.bucketCount += pageAmounts.bucketCount;
    totals.resultCount += pageAmounts.resultCount;

    page = normalizeString(data && data.next_page);
    if (!data || data.has_more !== true || !page) break;
  }

  return {
    key: endpoint.key,
    path: endpoint.path,
    currencies,
    ...totals,
    pageCount,
  };
}

async function fetchOpenAiUsageEstimateSummary(deps = {}, options = {}) {
  const window = {
    ...buildCostWindow(options.scope, options.nowMs),
    projectId: resolveOpenAiProjectFilterId(deps, options),
  };
  const endpoints = [
    {
      key: 'completions',
      path: '/organization/usage/completions',
      groupBy: ['model', 'project_id'],
      usageType: 'text',
    },
    {
      key: 'images',
      path: '/organization/usage/images',
      groupBy: ['model', 'size', 'source', 'project_id'],
      usageType: 'images',
    },
    {
      key: 'web_search_calls',
      path: '/organization/usage/web_search_calls',
      groupBy: ['model', 'context_level', 'project_id'],
      usageType: 'web_search_calls',
    },
    {
      key: 'embeddings',
      path: '/organization/usage/embeddings',
      groupBy: ['model', 'project_id'],
      usageType: 'embeddings',
    },
    {
      key: 'file_search_calls',
      path: '/organization/usage/file_search_calls',
      groupBy: ['project_id'],
      usageType: 'file_search_calls',
    },
    {
      key: 'code_interpreter_sessions',
      path: '/organization/usage/code_interpreter_sessions',
      groupBy: ['project_id'],
      usageType: 'code_interpreter_sessions',
    },
    {
      key: 'audio_transcriptions',
      path: '/organization/usage/audio_transcriptions',
      groupBy: ['model', 'project_id'],
      usageType: 'audio_transcriptions',
    },
    {
      key: 'audio_speeches',
      path: '/organization/usage/audio_speeches',
      groupBy: ['model', 'project_id'],
      usageType: 'audio_speeches',
    },
  ];
  const currencies = {};
  const usage = {
    bucketCount: 0,
    resultCount: 0,
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    imageCount: 0,
    webSearchCalls: 0,
    embeddingTokens: 0,
    fileSearchCalls: 0,
    codeInterpreterSessions: 0,
    audioInputTokens: 0,
    audioOutputTokens: 0,
    audioSeconds: 0,
  };
  const endpointSummaries = [];
  const endpointsUnavailable = [];

  for (const endpoint of endpoints) {
    let summary;
    try {
      summary = await fetchOpenAiUsageEstimateForEndpoint(deps, window, endpoint);
    } catch (error) {
      endpointsUnavailable.push({
        key: endpoint.key,
        path: endpoint.path,
        error: error.code || 'OPENAI_USAGE_ENDPOINT_FAILED',
        detail: sanitizeOpenAiCostDetail(error.detail || error.message || 'OpenAI usage endpoint niet beschikbaar.'),
      });
      continue;
    }
    endpointSummaries.push(summary);
    Object.entries(summary.currencies).forEach(([currency, amount]) => {
      addCurrencyAmount(currencies, currency, amount);
    });
    addUsageTotals(usage, summary);
    usage.bucketCount += summary.bucketCount;
    usage.resultCount += summary.resultCount;
  }

  if (endpointSummaries.length === 0 && endpointsUnavailable.length > 0) {
    const first = endpointsUnavailable[0];
    throw createServiceError(
      'OpenAI usage kon niet worden opgehaald',
      first.error || 'OPENAI_USAGE_FETCH_FAILED',
      502,
      first.detail || 'Geen enkele OpenAI usage endpoint was beschikbaar.'
    );
  }

  const costUsd = Number((currencies.usd || 0).toFixed(8));
  const costEurDirect = Number((currencies.eur || 0).toFixed(8));
  const usdToEurRateDetails = await resolveUsdToEurRateDetails(deps);
  const costEur = Number((costEurDirect + costUsd * usdToEurRateDetails.rate).toFixed(2));
  const fetchedAt = new Date(Math.max(0, Number(options.nowMs) || Date.now())).toISOString();

  return {
    scope: window.scope,
    source: 'openai-usage-estimate',
    exact: false,
    estimated: true,
    fetchedAt,
    lastSuccessfulUpdate: fetchedAt,
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
    projectFilterApplied: Boolean(window.projectId),
    organizationWide: !window.projectId,
    bucketCount: usage.bucketCount,
    resultCount: usage.resultCount,
    requestCount: usage.requestCount,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    imageCount: usage.imageCount,
    webSearchCalls: usage.webSearchCalls,
    embeddingTokens: usage.embeddingTokens,
    fileSearchCalls: usage.fileSearchCalls,
    codeInterpreterSessions: usage.codeInterpreterSessions,
    audioInputTokens: usage.audioInputTokens,
    audioOutputTokens: usage.audioOutputTokens,
    audioSeconds: usage.audioSeconds,
    endpoints: endpointSummaries.map((summary) => ({
      key: summary.key,
      path: summary.path,
      currencies: summary.currencies,
      bucketCount: summary.bucketCount,
      resultCount: summary.resultCount,
      requestCount: summary.requestCount,
      inputTokens: summary.inputTokens,
      cachedInputTokens: summary.cachedInputTokens,
      outputTokens: summary.outputTokens,
      imageCount: summary.imageCount,
      webSearchCalls: summary.webSearchCalls,
      embeddingTokens: summary.embeddingTokens,
      fileSearchCalls: summary.fileSearchCalls,
      codeInterpreterSessions: summary.codeInterpreterSessions,
      audioInputTokens: summary.audioInputTokens,
      audioOutputTokens: summary.audioOutputTokens,
      audioSeconds: summary.audioSeconds,
      pageCount: summary.pageCount,
    })),
    endpointsUnavailable,
    pricingSource: OPENAI_PRICING_SOURCE_URL,
    note: 'OpenAI Usage API schatting; gebruikt totdat de Organization Costs API de nieuwste kosten heeft verwerkt.',
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

function summarizeCostCandidate(summary = {}, kind = '', label = '') {
  if (!summary || typeof summary !== 'object') return null;
  const costUsd = Number(summary.costUsd);
  const costEur = Number(summary.costEur);
  if (!Number.isFinite(costUsd) || costUsd < 0) return null;
  return {
    kind,
    label,
    costUsd,
    costEur: Number.isFinite(costEur) && costEur >= 0 ? costEur : 0,
    exact: summary.exact === true,
    organizationWide: summary.organizationWide === true,
    summary,
  };
}

function pickHighestCostCandidate(candidates = []) {
  const usable = candidates.filter(Boolean);
  if (usable.length === 0) return null;
  return usable.reduce((selected, candidate) => {
    if (!selected) return candidate;
    return candidate.costUsd > selected.costUsd + 0.005 ? candidate : selected;
  }, null);
}

function selectHighestReliableCostCandidate(candidates = [], options = {}) {
  const openAiCandidates = candidates.filter(
    (candidate) => candidate && candidate.kind !== 'softora_ledger'
  );
  const bestOpenAi = pickHighestCostCandidate(openAiCandidates);
  const bestLedger = pickHighestCostCandidate(
    candidates.filter((candidate) => candidate && candidate.kind === 'softora_ledger')
  );

  if (!bestOpenAi) return bestLedger || null;
  if (!bestLedger) return bestOpenAi;
  if (options.ledgerCanOverrideOpenAi === true) {
    return bestLedger.costUsd > bestOpenAi.costUsd + 0.005 ? bestLedger : bestOpenAi;
  }
  return bestOpenAi;
}

function buildOpenAiCostSelectionNote(selectedCandidate = {}) {
  const selected = selectedCandidate.summary || {};
  if (selectedCandidate.kind === 'official_organization') {
    return 'Officieel: OpenAI kosten deze maand organisatiebreed via de Organization Costs API.';
  }
  if (selectedCandidate.kind === 'official_project') {
    return 'Officieel: OpenAI kosten deze maand via de Organization Costs API.';
  }
  if (selectedCandidate.kind === 'usage_organization') {
    return 'Live schatting: OpenAI Usage organisatiebreed is hoger dan Costs, dus OpenAI loopt nog achter.';
  }
  if (selectedCandidate.kind === 'usage_project') {
    return 'Live schatting: OpenAI Usage is hoger dan Costs, dus OpenAI loopt nog achter.';
  }
  if (selectedCandidate.kind === 'softora_ledger') {
    return 'Live schatting: Softora API-kostenledger is hoger dan OpenAI Costs/Usage, dus OpenAI loopt nog achter.';
  }
  return selected.note || 'OpenAI API-kosten deze maand.';
}

async function loadOpenAiCostProvider(unavailable, provider, source, loader) {
  try {
    return await loader();
  } catch (error) {
    unavailable.push({
      provider,
      source,
      error: error.code || `${source.toUpperCase()}_ERROR`,
      detail: sanitizeOpenAiCostDetail(error.detail || error.message || `${provider} niet beschikbaar.`),
    });
    return null;
  }
}

async function fetchCombinedApiCostSummary(deps = {}, options = {}) {
  const configuredProjectId = resolveOpenAiProjectId(deps);
  const scope = normalizeScope(options.scope);
  const costWindow = buildCostWindow(scope, options.nowMs);
  const unavailable = [];
  const candidates = [];

  const openAiSummary = await loadOpenAiCostProvider(
    unavailable,
    'OpenAI Costs project',
    'openai-costs',
    () => fetchOpenAiCostSummary(deps, options)
  );
  if (openAiSummary) candidates.push(summarizeCostCandidate(openAiSummary, 'official_project', 'OpenAI Costs project'));

  let organizationOpenAiSummary = null;
  if (configuredProjectId) {
    organizationOpenAiSummary = await loadOpenAiCostProvider(
      unavailable,
      'OpenAI Costs organisatiebreed',
      'openai-costs',
      () => fetchOpenAiCostSummary(withoutOpenAiProjectFilter(deps), {
        ...options,
        projectScope: false,
      })
    );
    if (organizationOpenAiSummary) {
      candidates.push(summarizeCostCandidate(organizationOpenAiSummary, 'official_organization', 'OpenAI Costs organisatiebreed'));
    }
  }

  const usageEstimate = await loadOpenAiCostProvider(
    unavailable,
    'OpenAI Usage project',
    'openai-usage-estimate',
    () => fetchOpenAiUsageEstimateSummary(deps, options)
  );
  if (usageEstimate) {
    candidates.push(summarizeCostCandidate(usageEstimate, 'usage_project', 'OpenAI Usage project'));
  }

  let organizationUsageEstimate = null;
  if (configuredProjectId) {
    organizationUsageEstimate = await loadOpenAiCostProvider(
      unavailable,
      'OpenAI Usage organisatiebreed',
      'openai-usage-estimate',
      () => fetchOpenAiUsageEstimateSummary(withoutOpenAiProjectFilter(deps), {
        ...options,
        projectScope: false,
      })
    );
    if (organizationUsageEstimate) {
      candidates.push(
        summarizeCostCandidate(organizationUsageEstimate, 'usage_organization', 'OpenAI Usage organisatiebreed')
      );
    }
  }

  const ledgerSummary = await loadOpenAiCostProvider(
    unavailable,
    'Softora API-kostenledger',
    'softora-api-ledger',
    () => readSoftoraApiCostLedgerSummary(deps, {
      ...options,
      scope,
      window: costWindow,
    })
  );
  if (ledgerSummary && ledgerSummary.available !== false && ledgerSummary.costUsd > 0) {
    candidates.push(summarizeCostCandidate(ledgerSummary, 'softora_ledger', 'Softora API-kostenledger'));
  }

  const selectedCandidate = selectHighestReliableCostCandidate(candidates, {
    ledgerCanOverrideOpenAi:
      deps.openAiCostLedgerCanOverrideOpenAi === true ||
      deps.env?.OPENAI_COST_LEDGER_CAN_OVERRIDE_OPENAI === 'true',
  });
  if (!selectedCandidate) {
    const firstUnavailable = unavailable[0] || {};
    throw createServiceError(
      'API-factuurkosten konden niet geladen worden.',
      firstUnavailable.error || 'API_COSTS_UNAVAILABLE',
      503,
      firstUnavailable.detail || 'Geen OpenAI Costs, Usage of Softora ledger kon worden opgehaald.'
    );
  }

  const selectedSummary = selectedCandidate.summary;
  const officialBaseline = organizationOpenAiSummary || openAiSummary || null;
  const selectedProvider = {
    ...selectedSummary,
    selectedKind: selectedCandidate.kind,
    selectedLabel: selectedCandidate.label,
    officialCostUsd: selectedSummary.exact === true ? undefined : officialBaseline && officialBaseline.costUsd,
    officialCostEur: selectedSummary.exact === true ? undefined : officialBaseline && officialBaseline.costEur,
    officialSource: selectedSummary.exact === true ? undefined : officialBaseline && officialBaseline.source,
  };
  const fetchedAt = selectedProvider.fetchedAt || new Date(Math.max(0, Number(options.nowMs) || Date.now())).toISOString();
  const costUsd = Number((selectedProvider.costUsd || 0).toFixed(8));
  const costEur = Number((selectedProvider.costEur || 0).toFixed(2));

  return {
    scope,
    source: 'api-costs',
    exact: selectedProvider.exact === true,
    estimated: selectedProvider.exact !== true,
    fetchedAt,
    lastSuccessfulUpdate: selectedProvider.lastSuccessfulUpdate || fetchedAt,
    startTime: selectedProvider.startTime || costWindow.startTime,
    endTime: selectedProvider.endTime || costWindow.endTime,
    costUsd,
    costEur,
    usdToEurRate: selectedProvider.usdToEurRate,
    usdToEurRateSource: selectedProvider.usdToEurRateSource,
    exchangeRateFetchedAtMs: selectedProvider.exchangeRateFetchedAtMs,
    currencies: selectedProvider.currencies || { usd: costUsd },
    selectedProviderKind: selectedCandidate.kind,
    selectedProviderLabel: selectedCandidate.label,
    selectionStrategy: 'highest_without_double_counting',
    selectionReason: buildOpenAiCostSelectionNote(selectedCandidate),
    providers: [selectedProvider],
    candidates: candidates.map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      source: candidate.summary.source,
      exact: candidate.summary.exact === true,
      estimated: candidate.summary.exact !== true,
      organizationWide: candidate.summary.organizationWide === true,
      costUsd: candidate.costUsd,
      costEur: candidate.costEur,
    })),
    officialProvider: openAiSummary,
    organizationOfficialProvider: organizationOpenAiSummary,
    usageEstimate,
    organizationUsageEstimate,
    softoraLedger: ledgerSummary,
    unavailable,
    pricingSource: OPENAI_PRICING_SOURCE_URL,
    note: buildOpenAiCostSelectionNote(selectedCandidate),
  };
}

async function fetchOpenAiCostDiagnostics(deps = {}, options = {}) {
  const scope = normalizeScope(options.scope);
  const fetchedAt = new Date(Math.max(0, Number(options.nowMs) || Date.now())).toISOString();
  try {
    const selected = await fetchCombinedApiCostSummary(deps, {
      ...options,
      scope,
    });
    return {
      scope,
      source: 'api-cost-diagnostics',
      ok: true,
      fetchedAt,
      config: getOpenAiCostConfigStatus(deps),
      official: {
        project: selected.officialProvider || null,
        organization: selected.organizationOfficialProvider || null,
      },
      usage: {
        project: selected.usageEstimate || null,
        organization: selected.organizationUsageEstimate || null,
      },
      ledger: selected.softoraLedger || null,
      selected,
      comparison: {
        strategy: selected.selectionStrategy,
        selectedProviderKind: selected.selectedProviderKind,
        selectedProviderLabel: selected.selectedProviderLabel,
        selectedCostUsd: selected.costUsd,
        selectedCostEur: selected.costEur,
        candidates: selected.candidates || [],
      },
      unavailable: selected.unavailable || [],
    };
  } catch (error) {
    return {
      scope,
      source: 'api-cost-diagnostics',
      ok: false,
      fetchedAt,
      config: getOpenAiCostConfigStatus(deps),
      official: {
        project: null,
        organization: null,
      },
      usage: {
        project: null,
        organization: null,
      },
      ledger: null,
      selected: null,
      comparison: {
        strategy: 'highest_without_double_counting',
        selectedProviderKind: null,
        selectedProviderLabel: null,
        selectedCostUsd: 0,
        selectedCostEur: 0,
        candidates: [],
      },
      unavailable: [
        {
          provider: 'API kosten diagnose',
          source: 'api-costs',
          error: error.code || 'API_COSTS_DIAGNOSTICS_ERROR',
          detail: sanitizeOpenAiCostDetail(error.detail || error.message || 'Diagnose kon niet worden opgebouwd.'),
        },
      ],
    };
  }
}

function createOpenAiCostSummaryCoordinator(deps = {}) {
  return {
    async sendOpenAiCostsDashboardResponse(req, res) {
      try {
        const snapshot = await fetchOpenAiCostsDashboardSnapshot(deps, {
          forceRefresh: Boolean(req && req.query && req.query.refresh === '1'),
        });
        return res.status(200).json({
          ok: true,
          ...snapshot,
        });
      } catch (error) {
        const lastSuccessful = getOpenAiCostsLastSuccessfulSnapshot(deps);
        return res.status(getOpenAiCostErrorStatus(error)).json({
          ...buildOpenAiCostErrorPayload(deps, error),
          status: 'error',
          source: 'openai-organization-costs',
          message: 'OpenAI kosten konden niet worden opgehaald',
          lastSuccessful,
        });
      }
    },
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
        return res
          .status(getOpenAiCostErrorStatus(error))
          .json(buildOpenAiCostErrorPayload(deps, error));
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
        const payload = buildOpenAiCostErrorPayload(deps, error, 'API-factuurkosten konden niet geladen worden.');
        if (!payload.error || payload.error === 'OPENAI_COSTS_ERROR') {
          payload.error = 'API_COSTS_ERROR';
        }
        return res.status(getOpenAiCostErrorStatus(error)).json(payload);
      }
    },
    async sendCostDiagnosticsResponse(req, res) {
      const diagnostics = await fetchOpenAiCostDiagnostics(deps, {
        scope: req && req.query ? req.query.scope : 'month',
      });
      return res.status(200).json({
        ok: true,
        source: 'api-cost-diagnostics',
        diagnostics,
      });
    },
  };
}

module.exports = {
  buildCostWindow,
  buildOpenAiDashboardPeriods,
  collectAnthropicCostAmounts,
  collectOpenAiCostAmounts,
  createOpenAiCostSummaryCoordinator,
  fetchAnthropicCostSummary,
  fetchCombinedApiCostSummary,
  fetchOpenAiCostDiagnostics,
  fetchOpenAiCostsDashboardSnapshot,
  fetchOpenAiCostPeriodSummary,
  fetchOpenAiCostSummary,
  fetchOpenAiUsageEstimateSummary,
  getOpenAiCostsLastSuccessfulSnapshot,
  parseUsdToEurRateResponse,
  resolveUsdToEurRateDetails,
};
