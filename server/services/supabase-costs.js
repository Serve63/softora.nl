const { resolveUsdToEurRateDetails } = require('./openai-costs');

const DEFAULT_SUPABASE_MANAGEMENT_API_BASE_URL = 'https://api.supabase.com/v1';
const DEFAULT_SUPABASE_COSTS_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_MONTHLY_HOURS = 730;
const SUPABASE_MANAGEMENT_ADDONS_DOC_URL =
  'https://supabase.com/docs/reference/api/management#list-billing-addons-and-compute-instance-selections';
const SUPABASE_BILLING_DOC_URL = 'https://supabase.com/docs/guides/platform/billing-on-supabase';
const SUPABASE_USAGE_DOC_URL = 'https://supabase.com/docs/guides/platform/manage-your-usage';
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

function sanitizeSupabaseCostDetail(value) {
  const detail = normalizeString(value);
  if (!detail) return '';
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sbp_[A-Za-z0-9._-]+/g, 'sbp_[redacted]')
    .slice(0, 500);
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

function redactProjectRef(projectRef) {
  const value = normalizeString(projectRef);
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getSupabaseCostConfigStatus(deps = {}) {
  const projectRef = resolveSupabaseProjectRef(deps);
  const baseCost = resolveConfiguredBaseCost(deps);
  return {
    managementTokenConfigured: Boolean(resolveSupabaseManagementToken(deps)),
    projectRefConfigured: Boolean(projectRef),
    projectRef: redactProjectRef(projectRef),
    baseCostConfigured: Boolean(baseCost.configured),
    baseCostCurrency: baseCost.currency || '',
    baseCostSource: baseCost.source || '',
    managementApiBaseUrl: resolveSupabaseManagementApiBaseUrl(deps),
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

function buildSupabaseCostSelection(summary = {}) {
  const hasConfiguredBase = Boolean(summary && summary.hasConfiguredBase);
  return {
    selectionStrategy: 'management_addons_plus_configured_base_as_known_lower_bound',
    selectedProviderKind: hasConfiguredBase
      ? 'management_addons_with_configured_base_partial'
      : 'management_addons_only_partial',
    selectedProviderLabel: hasConfiguredBase
      ? 'Live ondergrens via Supabase Management API + basisbedrag'
      : 'Live gedeeltelijk via Supabase Management API',
    selectedProviderConfidence: 'partial_estimate',
  };
}

function buildSupabaseCostUnavailable(error, provider = 'Supabase Management API') {
  return {
    provider,
    source: 'supabase-costs',
    error: error && error.code ? error.code : 'SUPABASE_COSTS_ERROR',
    status: Number(error && error.status) || 500,
    detail: sanitizeSupabaseCostDetail(
      (error && (error.detail || error.message)) || 'Supabase kosten konden niet worden opgehaald.'
    ),
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
  const baseCurrencies = {};
  const currencies = { ...addonCosts.currencies };
  if (baseCost.configured) {
    addCurrencyAmount(baseCurrencies, baseCost.currency, baseCost.amount);
    addCurrencyAmount(currencies, baseCost.currency, baseCost.amount);
  }

  const rateDetails = await resolveUsdToEurRateDetails(deps);
  const addonConverted = convertCurrenciesToEur(addonCosts.currencies, rateDetails);
  const baseConverted = convertCurrenciesToEur(baseCurrencies, rateDetails);
  const converted = convertCurrenciesToEur(currencies, rateDetails);
  const fetchedAt = new Date(nowMs).toISOString();
  const selection = buildSupabaseCostSelection({ hasConfiguredBase: baseCost.configured });
  const excludedCostCategories = [
    'organization_usage_overages',
    'invoice_adjustments',
    'taxes',
    'credits',
    'subscription_changes_after_config',
  ];
  const summary = {
    status: 'partial',
    source: 'supabase-management-addons',
    endpoint: '/v1/projects/{ref}/billing/addons',
    exact: false,
    complete: false,
    officialBillingTotalAvailable: false,
    costCoverage: 'known_lower_bound',
    selectionStrategy: selection.selectionStrategy,
    selectedProviderKind: selection.selectedProviderKind,
    selectedProviderLabel: selection.selectedProviderLabel,
    selectedProviderConfidence: selection.selectedProviderConfidence,
    fetchedAt,
    lastSuccessfulUpdate: fetchedAt,
    scope: 'month',
    projectRef: addonsResult.projectRef,
    costEur: converted.costEur,
    knownCostEur: converted.costEur,
    minimumCostEur: converted.costEur,
    currency: 'eur',
    currencies,
    addonCurrencies: addonCosts.currencies,
    baseCurrencies,
    addonCostEur: addonConverted.costEur,
    baseCostEur: baseConverted.costEur,
    baseCost,
    addons: addonCosts.lineItems,
    selectedAddonCount: addonCosts.selectedAddonCount,
    unsupportedCurrencies: converted.unsupportedCurrencies,
    usdToEurRate: rateDetails.rate,
    usdToEurRateSource: rateDetails.source,
    pricingSource: SUPABASE_BILLING_DOC_URL,
    managementApiSource: SUPABASE_MANAGEMENT_ADDONS_DOC_URL,
    usageSource: SUPABASE_USAGE_DOC_URL,
    excludedCostCategories,
    note: baseCost.configured
      ? 'Supabase Management API geeft project-add-ons, maar geen volledige organization usage of factuurregels; dit is een live ondergrens plus geconfigureerd basisbedrag.'
      : 'Supabase Management API geeft project-add-ons, maar geen basisplan, organization usage of factuurregels; zet SUPABASE_MONTHLY_BASE_COST_EUR of USD voor een betere ondergrens.',
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

async function fetchSupabaseCostDiagnostics(deps = {}, options = {}) {
  const scope = normalizeString(options.scope || 'month') || 'month';
  const fetchedAt = new Date(Math.max(0, Number(options.nowMs) || Date.now())).toISOString();
  const config = getSupabaseCostConfigStatus(deps);
  const configuredBase = resolveConfiguredBaseCost(deps);
  const unavailable = [];
  let summary = null;

  try {
    summary = await fetchSupabaseCostSummary(deps, {
      ...options,
      forceRefresh: true,
    });
  } catch (error) {
    unavailable.push(buildSupabaseCostUnavailable(error));
  }

  const selected = summary
    ? {
        status: summary.status,
        selectedProviderKind: summary.selectedProviderKind,
        selectedProviderLabel: summary.selectedProviderLabel,
        selectedProviderConfidence: summary.selectedProviderConfidence,
        costEur: summary.costEur,
        knownCostEur: summary.knownCostEur,
        minimumCostEur: summary.minimumCostEur,
        exact: summary.exact,
        complete: summary.complete,
        officialBillingTotalAvailable: summary.officialBillingTotalAvailable,
        costCoverage: summary.costCoverage,
        note: summary.note,
      }
    : null;

  return {
    scope,
    source: 'supabase-cost-diagnostics',
    ok: Boolean(summary),
    fetchedAt,
    config,
    managementApi: summary
      ? {
          source: summary.source,
          endpoint: summary.endpoint,
          projectRef: redactProjectRef(summary.projectRef),
          selectedAddonCount: summary.selectedAddonCount,
          addonCostEur: summary.addonCostEur,
          addonCurrencies: summary.addonCurrencies,
          addons: summary.addons,
          status: summary.status,
          officialBillingTotalAvailable: summary.officialBillingTotalAvailable,
          excludedCostCategories: summary.excludedCostCategories,
        }
      : null,
    configuredBase: {
      configured: Boolean(configuredBase.configured),
      source: configuredBase.source,
      currency: configuredBase.currency,
      amount: configuredBase.amount,
      costEur: summary ? summary.baseCostEur : 0,
    },
    selected,
    comparison: {
      strategy: 'management_addons_plus_configured_base_as_known_lower_bound',
      selectedProviderKind: selected ? selected.selectedProviderKind : null,
      selectedProviderLabel: selected ? selected.selectedProviderLabel : null,
      selectedCostEur: selected ? selected.costEur : 0,
      candidates: summary
        ? [
            {
              kind: 'configured_base',
              label: 'Geconfigureerd Supabase basisbedrag',
              costEur: summary.baseCostEur,
              complete: false,
            },
            {
              kind: 'management_addons',
              label: 'Supabase Management API add-ons',
              costEur: summary.addonCostEur,
              complete: false,
            },
            {
              kind: summary.selectedProviderKind,
              label: summary.selectedProviderLabel,
              costEur: summary.costEur,
              complete: summary.complete,
            },
          ]
        : [],
    },
    unavailable,
    docs: {
      managementAddons: SUPABASE_MANAGEMENT_ADDONS_DOC_URL,
      billing: SUPABASE_BILLING_DOC_URL,
      usage: SUPABASE_USAGE_DOC_URL,
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
          detail: sanitizeSupabaseCostDetail(error.detail || error.message || 'Supabase kosten konden niet worden opgehaald'),
          config: getSupabaseCostConfigStatus(deps),
        });
      }
    },
    async sendSupabaseCostDiagnosticsResponse(req, res) {
      const diagnostics = await fetchSupabaseCostDiagnostics(deps, {
        scope: req && req.query ? req.query.scope : 'month',
        nowMs: req && req.query && req.query.nowMs,
      });
      return res.status(200).json({
        ok: true,
        source: 'supabase-cost-diagnostics',
        diagnostics,
      });
    },
  };
}

module.exports = {
  collectSupabaseAddonCosts,
  createSupabaseCostSummaryCoordinator,
  fetchSupabaseCostDiagnostics,
  fetchSupabaseCostSummary,
  fetchSupabaseProjectAddons,
  getSupabaseCostConfigStatus,
  resolveSupabaseProjectRef,
};
