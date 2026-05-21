const SOFTORA_API_COST_LEDGER_SCOPE = 'premium_api_costs';
const SOFTORA_API_COST_LEDGER_KEY = 'softora_api_cost_events_v1';
const DEFAULT_USD_TO_EUR_RATE = 0.92;
const MAX_LEDGER_EVENTS = 5000;

function normalizeString(value) {
  return String(value || '').trim();
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundUsd(value) {
  return Math.round(parsePositiveNumber(value) * 100000000) / 100000000;
}

function roundEur(value) {
  return Math.round(parsePositiveNumber(value) * 100) / 100;
}

function resolveUsdToEurRate(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.usdToEurRate || env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_EUR_RATE;
}

function parseSoftoraApiCostLedgerEvents(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === 'object')
      : [];
  } catch (_) {
    return [];
  }
}

function normalizeSoftoraApiCostEvent(event = {}, deps = {}) {
  if (!event || typeof event !== 'object') return null;
  const usdToEurRate = resolveUsdToEurRate(deps);
  const amountUsd = roundUsd(event.amountUsd ?? event.usd ?? event.costUsd ?? event.estimatedUsd);
  const amountEur = roundEur(event.amountEur ?? event.eur ?? event.costEur ?? amountUsd * usdToEurRate);
  if (amountUsd <= 0 && amountEur <= 0) return null;

  const occurredAtRaw = normalizeString(event.occurredAt || event.createdAt || event.updatedAt);
  const occurredAtMs = Date.parse(occurredAtRaw);
  const occurredAt = Number.isFinite(occurredAtMs) && occurredAtMs > 0
    ? new Date(occurredAtMs).toISOString()
    : new Date().toISOString();

  return {
    id: normalizeString(event.id) || `api-cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    occurredAt,
    source: normalizeString(event.source) || 'softora-api',
    label: normalizeString(event.label) || 'OpenAI API-verbruik',
    model: normalizeString(event.model),
    amountUsd,
    amountEur,
    estimated: event.estimated !== false,
    meta: event.meta && typeof event.meta === 'object' && !Array.isArray(event.meta) ? event.meta : {},
  };
}

function isEventInWindow(event = {}, window = {}) {
  const occurredAtMs = Date.parse(normalizeString(event.occurredAt || event.createdAt || event.updatedAt));
  if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0) return false;
  const occurredAtSeconds = Math.floor(occurredAtMs / 1000);
  const startTime = Math.max(1, Number(window.startTime) || 1);
  const endTime = Math.max(startTime + 1, Number(window.endTime) || startTime + 1);
  return occurredAtSeconds >= startTime && occurredAtSeconds < endTime;
}

function summarizeSoftoraApiCostLedgerEvents(events = [], options = {}) {
  const window = options.window || {};
  const normalizedEvents = (Array.isArray(events) ? events : [])
    .map((event) => normalizeSoftoraApiCostEvent(event, options))
    .filter(Boolean);
  const matchingEvents = normalizedEvents.filter((event) => isEventInWindow(event, window));
  const costUsd = roundUsd(matchingEvents.reduce((sum, event) => sum + parsePositiveNumber(event.amountUsd), 0));
  const costEur = roundEur(matchingEvents.reduce((sum, event) => sum + parsePositiveNumber(event.amountEur), 0));

  return {
    scope: normalizeString(options.scope) || 'month',
    source: 'softora-api-ledger',
    exact: false,
    estimated: true,
    available: true,
    configured: true,
    startTime: Number(window.startTime) || null,
    endTime: Number(window.endTime) || null,
    costUsd,
    costEur,
    currencies: { usd: costUsd },
    eventCount: matchingEvents.length,
    totalEventCount: normalizedEvents.length,
    events: matchingEvents.slice(-100),
    note: 'Softora interne API-kostenledger; live schatting totdat OpenAI Costs deze kosten officieel verwerkt.',
  };
}

async function readSoftoraApiCostLedgerSummary(deps = {}, options = {}) {
  const window = options.window || {};
  const scope = normalizeString(options.scope) || 'month';
  if (Array.isArray(deps.apiCostLedgerEvents)) {
    return summarizeSoftoraApiCostLedgerEvents(deps.apiCostLedgerEvents, {
      ...deps,
      scope,
      window,
    });
  }

  if (typeof deps.getUiStateValues !== 'function') {
    return {
      scope,
      source: 'softora-api-ledger',
      exact: false,
      estimated: true,
      available: false,
      configured: false,
      startTime: Number(window.startTime) || null,
      endTime: Number(window.endTime) || null,
      costUsd: 0,
      costEur: 0,
      currencies: { usd: 0 },
      eventCount: 0,
      totalEventCount: 0,
      events: [],
      note: 'Softora API-kostenledger niet gekoppeld aan server-side ui-state.',
    };
  }

  const state = await deps.getUiStateValues(SOFTORA_API_COST_LEDGER_SCOPE);
  const values = state && state.values && typeof state.values === 'object' ? state.values : {};
  const events = parseSoftoraApiCostLedgerEvents(values[SOFTORA_API_COST_LEDGER_KEY]);
  return {
    ...summarizeSoftoraApiCostLedgerEvents(events, {
      ...deps,
      scope,
      window,
    }),
    storageSource: state && state.source ? state.source : 'ui-state',
    storageUpdatedAt: state && state.updatedAt ? state.updatedAt : null,
  };
}

async function recordSoftoraApiCostEvent(deps = {}, event = {}) {
  if (typeof deps.getUiStateValues !== 'function' || typeof deps.setUiStateValues !== 'function') {
    return { ok: true, skipped: true, reason: 'ledger-storage-unavailable' };
  }
  const normalized = normalizeSoftoraApiCostEvent(event, deps);
  if (!normalized) return { ok: true, skipped: true, reason: 'zero-cost-event' };

  const state = await deps.getUiStateValues(SOFTORA_API_COST_LEDGER_SCOPE);
  const values = state && state.values && typeof state.values === 'object' ? state.values : {};
  const previousEvents = parseSoftoraApiCostLedgerEvents(values[SOFTORA_API_COST_LEDGER_KEY]);
  const events = previousEvents.concat([normalized]).slice(-MAX_LEDGER_EVENTS);
  const saved = await deps.setUiStateValues(
    SOFTORA_API_COST_LEDGER_SCOPE,
    {
      ...values,
      [SOFTORA_API_COST_LEDGER_KEY]: JSON.stringify(events),
    },
    {
      source: 'softora-api-cost-ledger',
      actor: 'server',
    }
  );
  if (!saved) return { ok: false, error: 'ledger-save-failed' };
  return { ok: true, event: normalized, count: events.length };
}

module.exports = {
  SOFTORA_API_COST_LEDGER_KEY,
  SOFTORA_API_COST_LEDGER_SCOPE,
  normalizeSoftoraApiCostEvent,
  parseSoftoraApiCostLedgerEvents,
  readSoftoraApiCostLedgerSummary,
  recordSoftoraApiCostEvent,
  summarizeSoftoraApiCostLedgerEvents,
};
