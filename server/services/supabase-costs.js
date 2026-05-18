const { resolveUsdToEurRateDetails } = require('./openai-costs');

const DEFAULT_SUPABASE_MANAGEMENT_API_BASE_URL = 'https://api.supabase.com/v1';
const DEFAULT_SUPABASE_COSTS_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_MONTHLY_HOURS = 730;
let supabaseCostsCache = null;

function normalizeString(value) {
  return String(value || '').trim();
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getSupabaseCostsCacheStore(deps = {}) {
  if (deps.supabaseCostsCache && typeof deps.supabaseCostsCache === 'object') return deps.supabaseCostsCache;
  if (!supabaseCostsCache) supabaseCostsCache = {};
  return supabaseCostsCache;
}

function getSupabaseCostsCacheMs(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.supabaseCostsCacheMs || env.SUPABASE_COSTS_CACHE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SUPABASE_COSTS_CACHE_MS;
  return Math.min(Math.max(Math.round(parsed), 60 * 1000), 15 * 60 * 1000);
}

function createServiceError(message, code, status = 500, detail = '') {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.detail = detail;
  return error;
}

function resolveSupabaseManagementToken(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.supabaseManagementAccessToken ||
      deps.supabaseAccessToken ||
      env.SUPABASE_MANAGEMENT_ACCESS_TOKEN ||
      env.SUPABASE_ACCESS_TOKEN ||
      env.SUPABASE_PERSONAL_ACCESS_TOKEN
  );
}

function extractProjectRefFromSupabaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = normalizeString(parsed.hostname).toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match ? match[1] : '';
  } catch (_) {
    return '';
  }
}

function resolveSupabaseProjectRef(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.supabaseProjectRef ||
      env.SUPABASE_PROJECT_REF ||
      env.SUPABASE_PROJECT_ID ||
      extractProjectRefFromSupabaseUrl(deps.supabaseUrl || env.SUPABASE_URL)
  );
}

function resolveSupabaseManagementApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.supabaseManagementApiBaseUrl ||
      env.SUPABASE_MANAGEMENT_API_BASE_URL ||
      DEFAULT_SUPABASE_MANAGEMENT_API_BASE_URL
  ).replace(/\/+$/, '');
}

function resolveMonthlyHours(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.supabaseBillingMonthlyHours || env.SUPABASE_BILLING_MONTHLY_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_HOURS;
}

function resolveConfiguredBaseCost(deps = {}) {
  const env = deps.env || process.env || {};
  const eur = parsePositiveNumber(
    deps.supabaseMonthlyBaseCostEur ||
      env.SUPABASE_MONTHLY_BASE_COST_EUR ||
      env.SUPABASE_BILLING_BASE_EUR ||
      env.SUPABASE_PLAN_COST_EUR
  );
  if (eur > 0) {
    return {
      configured: true,
      currency: 'eur',
      amount: eur,
      source: 'configured-eur',
    };
  }

  const usd = parsePositiveNumber(
    deps.supabaseMonthlyBaseCostUsd ||
      env.SUPABASE_MONTHLY_BASE_COST_USD ||
      env.SUPABASE_BILLING_BASE_USD ||
      env.SUPABASE_PLAN_COST_USD
  );
  if (usd > 0) {
    return {
      configured: true,
      currency: 'usd',
      amount: usd,
      source: 'configured-usd',
    };
  }

  return {
    configured: false,
    currency: '',
    amount: 0,
    source: 'not-configured',
  };
}

function buildSupabaseAddonsUrl(deps = {}, projectRef = '') {
  const apiBaseUrl = resolveSupabaseManagementApiBaseUrl(deps);
  return `${apiBaseUrl}/projects/${encodeURIComponent(projectRef)}/billing/addons`;
}

function addCurrencyAmount(target, currency, amount) {
  const key = normalizeString(currency || 'usd').toLowerCase() || 'usd';
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return;
  target[key] = Math.round(((target[key] || 0) + value) * 100000000) / 100000000;
}

function monthlyAmountFromPrice(price = {}, deps = {}) {
  const amount = parsePositiveNumber(price.amount ?? price.value ?? price.unit_amount);
  if (amount <= 0) return 0;

  const interval = normalizeString(price.interval || price.interval_unit || 'monthly').toLowerCase();
  if (interval === 'yearly' || interval === 'annual' || interval === 'annually' || interval === 'year') {
    return amount / 12;
  }
  if (interval === 'hourly' || interval === 'hour') {
    return amount * resolveMonthlyHours(deps);
  }
  if (interval === 'daily' || interval === 'day') {
    return amount * (resolveMonthlyHours(deps) / 24);
  }
  return amount;
}

function collectSupabaseAddonCosts(data = {}, deps = {}) {
  const currencies = {};
  const lineItems = [];

  (Array.isArray(data && data.selected_addons) ? data.selected_addons : []).forEach((addon) => {
    if (!addon || typeof addon !== 'object') return;
    const variant = addon.variant && typeof addon.variant === 'object' ? addon.variant : {};
    const price = variant.price && typeof variant.price === 'object' ? variant.price : {};
    const monthlyAmount = monthlyAmountFromPrice(price, deps);
    const currency = normalizeString(price.currency || price.currency_code || 'usd').toLowerCase() || 'usd';
    if (monthlyAmount <= 0) return;

    addCurrencyAmount(currencies, currency, monthlyAmount);
    lineItems.push({
      type: normalizeString(addon.type || addon.addon_type || 'addon'),
      variantId: normalizeString(variant.id),
      name: normalizeString(variant.name || price.description || addon.type || 'Supabase add-on'),
      interval: normalizeString(price.interval || 'monthly') || 'monthly',
      currency,
      amount: Number(monthlyAmount.toFixed(8)),
    });
  });

  return {
    currencies,
    lineItems,
    selectedAddonCount: lineItems.length,
  };
}

function convertCurrenciesToEur(currencies = {}, rateDetails = {}) {
  const rate = Number(rateDetails.rate);
  let total = 0;
  const unsupportedCurrencies = [];

  Object.entries(currencies || {}).forEach(([currency, amount]) => {
    const normalizedCurrency = normalizeString(currency).toLowerCase();
    const value = Number(amount);
    if (!normalizedCurrency || !Number.isFinite(value) || value <= 0) return;
    if (normalizedCurrency === 'eur') {
      total += value;
      return;
    }
    if (normalizedCurrency === 'usd' && Number.isFinite(rate) && rate > 0) {
      total += value * rate;
      return;
    }
    unsupportedCurrencies.push(normalizedCurrency);
  });

  return {
    costEur: Number(total.toFixed(2)),
    unsupportedCurrencies: Array.from(new Set(unsupportedCurrencies)),
  };
}

async function fetchSupabaseProjectAddons(deps = {}) {
  const apiToken = resolveSupabaseManagementToken(deps);
  if (!apiToken) {
    throw createServiceError(
      'Supabase kosten konden niet worden opgehaald',
      'SUPABASE_ACCESS_TOKEN_MISSING',
      503,
      'SUPABASE_MANAGEMENT_ACCESS_TOKEN of SUPABASE_ACCESS_TOKEN ontbreekt server-side.'
    );
  }

  const projectRef = resolveSupabaseProjectRef(deps);
  if (!projectRef) {
    throw createServiceError(
      'Supabase kosten konden niet worden opgehaald',
      'SUPABASE_PROJECT_REF_MISSING',
      503,
      'SUPABASE_PROJECT_REF ontbreekt server-side.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError('Supabase kosten-helper ontbreekt.', 'SUPABASE_COSTS_FETCH_UNAVAILABLE', 503);
  }

  const { response, data } = await fetchJsonWithTimeout(
    buildSupabaseAddonsUrl(deps, projectRef),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
      },
    },
    15000
  );

  if (!response || !response.ok) {
    const status = response && response.status ? response.status : 502;
    const detail = normalizeString(data && (data.message || data.error || data.detail || data.raw));
    throw createServiceError('Supabase kosten konden niet worden opgehaald', 'SUPABASE_COSTS_FETCH_FAILED', status, detail);
  }

  return {
    projectRef,
    data: data && typeof data === 'object' ? data : {},
  };
}

async function fetchSupabaseCostSummary(deps = {}, options = {}) {
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const cacheMs = getSupabaseCostsCacheMs(deps);
  const cache = getSupabaseCostsCacheStore(deps);
  if (!options.forceRefresh && cache.summary && Number(cache.expiresAtMs || 0) > nowMs) {
    return {
      ...cache.summary,
      cache: {
        hit: true,
        ttlMs: Math.max(0, Number(cache.expiresAtMs || 0) - nowMs),
      },
    };
  }

  const addonsResult = await fetchSupabaseProjectAddons(deps);
  const addonCosts = collectSupabaseAddonCosts(addonsResult.data, deps);
  const baseCost = resolveConfiguredBaseCost(deps);
  const currencies = { ...addonCosts.currencies };
  if (baseCost.configured) addCurrencyAmount(currencies, baseCost.currency, baseCost.amount);

  const rateDetails = await resolveUsdToEurRateDetails(deps);
  const converted = convertCurrenciesToEur(currencies, rateDetails);
  const fetchedAt = new Date(nowMs).toISOString();
  const complete = Boolean(baseCost.configured && converted.unsupportedCurrencies.length === 0);
  const summary = {
    status: complete ? 'success' : 'partial',
    source: 'supabase-management-addons',
    endpoint: '/v1/projects/{ref}/billing/addons',
    exact: complete,
    complete,
    fetchedAt,
    lastSuccessfulUpdate: fetchedAt,
    scope: 'month',
    projectRef: addonsResult.projectRef,
    costEur: converted.costEur,
    currency: 'eur',
    currencies,
    baseCost,
    addons: addonCosts.lineItems,
    selectedAddonCount: addonCosts.selectedAddonCount,
    unsupportedCurrencies: converted.unsupportedCurrencies,
    usdToEurRate: rateDetails.rate,
    usdToEurRateSource: rateDetails.source,
    note: complete
      ? 'Supabase kosten via Management API add-ons plus geconfigureerd basisbedrag.'
      : 'Supabase Management API geeft project-add-ons; zet SUPABASE_MONTHLY_BASE_COST_EUR of USD voor een volledige maandinschatting.',
  };

  cache.summary = summary;
  cache.expiresAtMs = nowMs + cacheMs;

  return {
    ...summary,
    cache: {
      hit: false,
      ttlMs: cacheMs,
    },
  };
}

function createSupabaseCostSummaryCoordinator(deps = {}) {
  return {
    async sendSupabaseCostSummaryResponse(req, res) {
      try {
        const summary = await fetchSupabaseCostSummary(deps, {
          forceRefresh: Boolean(req && req.query && req.query.refresh === '1'),
        });
        return res.status(200).json({
          ok: true,
          source: 'supabase-costs',
          summary,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          source: 'supabase-costs',
          error: error.code || 'SUPABASE_COSTS_ERROR',
          detail: error.detail || error.message || 'Supabase kosten konden niet worden opgehaald',
        });
      }
    },
  };
}

module.exports = {
  collectSupabaseAddonCosts,
  createSupabaseCostSummaryCoordinator,
  fetchSupabaseCostSummary,
  fetchSupabaseProjectAddons,
  resolveSupabaseProjectRef,
};
