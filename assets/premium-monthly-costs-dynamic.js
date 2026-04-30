(function () {
  'use strict';

  const COST_SUMMARY_ENDPOINT = '/api/coldcalling/cost-summary?scope=month';
  const API_COST_SUMMARY_ENDPOINT = '/api/api-cost-summary?scope=month';
  const API_COST_SCOPE = 'premium_api_costs';
  const API_COST_KEY = 'softora_api_cost_events_v1';
  const POLL_INTERVAL_MS = 15000;
  const COLDCALLING_ESTIMATE_NOTE = 'Geschatte maandkosten, Retell kan hoger uitvallen';
  const API_COST_NOTE = 'OpenAI factuurkosten deze maand';
  const API_COST_UNAVAILABLE_NOTE = 'API factuurkoppeling ontbreekt';
  const DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD = 0.07;
  const DEFAULT_USD_TO_EUR_RATE = 0.92;

  let refreshPromise = null;
  let pollTimer = null;

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeSearchText(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function parsePositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getRetellEstimatedCostPerMinuteUsd() {
    const override = Number(window.SOFTORA_RETELL_COST_PER_MINUTE_USD);
    return Number.isFinite(override) && override > 0
      ? override
      : DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD;
  }

  function getUsdToEurRate() {
    const override = Number(window.SOFTORA_RETELL_USD_TO_EUR_RATE);
    return Number.isFinite(override) && override > 0 ? override : DEFAULT_USD_TO_EUR_RATE;
  }

  function convertUsdToEur(amountUsd) {
    return Math.max(0, Number(amountUsd) || 0) * getUsdToEurRate();
  }

  function getOccurredAtMs(item) {
    const updatedAtMs = Number(item && item.updatedAtMs);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;

    const dateCandidates = [
      item && item.endedAt,
      item && item.startedAt,
      item && item.createdAt,
      item && item.updatedAt,
    ];
    for (const candidate of dateCandidates) {
      const parsed = Date.parse(normalizeString(candidate));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return 0;
  }

  function getMonthKeyFromMs(value) {
    const date = new Date(Number(value) || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function isCurrentMonthCall(item) {
    const occurredAtMs = getOccurredAtMs(item);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0) return false;
    return getMonthKeyFromMs(occurredAtMs) === getMonthKeyFromMs(Date.now());
  }

  function inferProvider(item) {
    const provider = normalizeSearchText(item && item.provider);
    const stack = normalizeSearchText(
      (item && item.stack) || (item && item.coldcallingStack) || (item && item.coldcallingProvider)
    );
    const callId = normalizeString((item && item.callId) || (item && item.call_id));

    if (provider.indexOf('retell') !== -1) return 'retell';
    if (provider.indexOf('twilio') !== -1) return 'twilio';
    if (stack === 'retell_ai' || stack.indexOf('retell') !== -1) return 'retell';
    if (/^call_/i.test(callId)) return 'retell';
    return provider || stack;
  }

  function isOutboundCallLike(item) {
    const direction = normalizeSearchText(item && item.direction);
    const messageType = normalizeSearchText(item && item.messageType);
    if (direction.indexOf('inbound') !== -1) return false;
    if (messageType.indexOf('twilio.inbound.') !== -1) return false;
    return true;
  }

  function isQualifiedCallLike(item) {
    if (!item || typeof item !== 'object') return false;
    const callId = normalizeString(item.callId || item.call_id);
    const phone = normalizeString(item.phone || (item.lead && item.lead.phone) || '');
    const status = normalizeString(item.status || '');
    const endedReason = normalizeString(item.endedReason || '');
    const summary = normalizeString(item.summary || item.transcriptSnippet || item.transcriptFull || '');
    const recordingUrl = normalizeString(item.recordingUrl || item.recording_url || '');
    const durationSeconds = parsePositiveNumber(item.durationSeconds);
    return Boolean(callId || phone || status || endedReason || summary || recordingUrl || durationSeconds > 0);
  }

  function mergeCallUpdates(updates) {
    const byCallId = new Map();

    (Array.isArray(updates) ? updates : []).forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;

      const callId = normalizeString(item.callId || item.call_id || `call-${index}`);
      if (!callId) return;

      const previous = byCallId.get(callId) || { callId };
      const nextDurationSeconds = parsePositiveNumber(item.durationSeconds);
      const previousDurationSeconds = parsePositiveNumber(previous.durationSeconds);
      const nextOccurredAtMs = getOccurredAtMs(item);
      const previousOccurredAtMs = getOccurredAtMs(previous);

      byCallId.set(callId, {
        ...previous,
        ...item,
        callId,
        provider: inferProvider(item) || previous.provider || '',
        durationSeconds:
          nextDurationSeconds > 0
            ? Math.round(nextDurationSeconds)
            : previousDurationSeconds > 0
              ? Math.round(previousDurationSeconds)
              : 0,
        occurredAtMs: Math.max(previousOccurredAtMs, nextOccurredAtMs),
      });
    });

    return Array.from(byCallId.values()).sort(function (a, b) {
      return Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0);
    });
  }

  function resolveKnownRetellCostUsd(item) {
    const costUsdMilli = Number(item && (item.costUsdMilli ?? item.cost_usd_milli));
    if (Number.isFinite(costUsdMilli) && costUsdMilli >= 0) {
      return Math.max(0, Math.round(costUsdMilli)) / 1000;
    }

    const costUsd = Number(item && (item.costUsd ?? item.cost_usd));
    if (Number.isFinite(costUsd) && costUsd >= 0) {
      return Math.max(0, Math.round(costUsd * 1000)) / 1000;
    }

    return null;
  }

  function resolveEstimatedRetellCostUsd(item) {
    const durationSeconds = Math.max(0, Math.round(parsePositiveNumber(item && item.durationSeconds)));
    if (durationSeconds <= 0) return 0;
    return (durationSeconds / 60) * getRetellEstimatedCostPerMinuteUsd();
  }

  function buildCurrentMonthRetellCostEur(updates) {
    const merged = mergeCallUpdates(updates).filter(function (item) {
      return (
        inferProvider(item) === 'retell' &&
        isOutboundCallLike(item) &&
        isQualifiedCallLike(item) &&
        isCurrentMonthCall(item)
      );
    });

    let totalCostUsd = 0;
    merged.forEach(function (item) {
      const exactCostUsd = resolveKnownRetellCostUsd(item);
      totalCostUsd += exactCostUsd !== null ? exactCostUsd : resolveEstimatedRetellCostUsd(item);
    });

    return Math.round(convertUsdToEur(totalCostUsd) * 100) / 100;
  }

  function parseApiCostEvents(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed.filter(function (item) {
        return item && typeof item === 'object';
      }) : [];
    } catch (error) {
      return [];
    }
  }

  function isCurrentMonthApiCost(item) {
    const occurredAtMs = Date.parse(normalizeString(item && (item.occurredAt || item.createdAt || item.updatedAt)));
    if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0) return false;
    return getMonthKeyFromMs(occurredAtMs) === getMonthKeyFromMs(Date.now());
  }

  function buildCurrentMonthApiCostEur(events) {
    const total = (Array.isArray(events) ? events : []).reduce(function (sum, item) {
      if (!isCurrentMonthApiCost(item)) return sum;
      const amountEur = Number(item && (item.amountEur ?? item.amount_eur));
      return sum + (Number.isFinite(amountEur) && amountEur > 0 ? amountEur : 0);
    }, 0);
    return Math.round(total * 100) / 100;
  }

  function getMonthlyCostsData() {
    return window.softoraMonthlyCostsData && typeof window.softoraMonthlyCostsData === 'object'
      ? window.softoraMonthlyCostsData
      : null;
  }

  function getMonthlyCostsRender() {
    return typeof window.softoraMonthlyCostsRender === 'function'
      ? window.softoraMonthlyCostsRender
      : null;
  }

  function resolveColdcallingCostItem() {
    const state = getMonthlyCostsData();
    const items = Array.isArray(state && state['Totale kosten:']) ? state['Totale kosten:'] : [];
    return (
      items.find(function (item) {
        return normalizeSearchText(item && item.naam) === 'coldcalling';
      }) || null
    );
  }

  function resolveApiCostItem() {
    const state = getMonthlyCostsData();
    const items = Array.isArray(state && state['Totale kosten:']) ? state['Totale kosten:'] : [];
    return (
      items.find(function (item) {
        return normalizeSearchText(item && item.naam) === 'api kosten';
      }) || null
    );
  }

  function applyColdcallingCost(amountEur) {
    const item = resolveColdcallingCostItem();
    const render = getMonthlyCostsRender();
    if (!item || !render) return false;

    const nextAmount = Math.max(0, Math.round((Number(amountEur) || 0) * 100) / 100);
    const nextNote = COLDCALLING_ESTIMATE_NOTE;
    const amountChanged = Number(item.bedrag || 0) !== nextAmount;
    const noteChanged = normalizeString(item.note) !== nextNote;
    if (!amountChanged && !noteChanged) return false;

    item.bedrag = nextAmount;
    item.note = nextNote;
    render();
    return true;
  }

  function applyApiCost(amountEur, note) {
    const item = resolveApiCostItem();
    const render = getMonthlyCostsRender();
    if (!item || !render) return false;

    const nextAmount = Math.max(0, Math.round((Number(amountEur) || 0) * 100) / 100);
    const nextNote = normalizeString(note) || API_COST_NOTE;
    const amountChanged = Number(item.bedrag || 0) !== nextAmount;
    const noteChanged = normalizeString(item.note) !== nextNote;
    if (!amountChanged && !noteChanged) return false;

    item.bedrag = nextAmount;
    item.note = nextNote;
    render();
    return true;
  }

  async function fetchUiState(scope) {
    const response = await fetch('/api/ui-state-get?scope=' + encodeURIComponent(String(scope || '')), {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      throw new Error(String((data && (data.error || data.detail)) || 'API-kosten konden niet geladen worden.'));
    }
    return data;
  }

  async function fetchMonthlyCostSummary() {
    const response = await fetch(COST_SUMMARY_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !data || data.ok !== true || !data.summary || typeof data.summary !== 'object') {
      throw new Error(String((data && (data.error || data.detail)) || 'Coldcalling-kosten konden niet geladen worden.'));
    }
    return data.summary;
  }

  function buildApiCostNote(summary) {
    const missing = Array.isArray(summary && summary.unavailable)
      ? summary.unavailable.map(function (item) {
          return normalizeString(item && item.provider);
        }).filter(Boolean)
      : [];
    const usd = Number(summary && summary.costUsd);
    const eur = Number(summary && summary.costEur);
    if (Number.isFinite(usd) && usd > 0 && Number.isFinite(eur) && eur > 0) {
      return 'OpenAI factuur: $' + usd.toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' omgerekend naar euro';
    }
    return missing.length ? 'Onvolledig: mist ' + missing.join(', ') : API_COST_NOTE;
  }

  async function fetchApiCostSummary() {
    const response = await fetch(API_COST_SUMMARY_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !data || data.ok !== true || !data.summary || typeof data.summary !== 'object') {
      throw new Error(String((data && (data.detail || data.error)) || 'API-factuurkosten konden niet geladen worden.'));
    }
    return data.summary;
  }

  async function refreshMonthlyColdcallingCosts() {
    if (refreshPromise) return refreshPromise;
    if (!resolveColdcallingCostItem() || !getMonthlyCostsRender()) {
      return { ok: true, updated: false };
    }

    refreshPromise = (async function () {
      try {
        const summary = await fetchMonthlyCostSummary();
        const amountEur = Number(summary.costEur || 0) || 0;
        return { ok: true, updated: applyColdcallingCost(amountEur), amountEur };
      } catch (error) {
        return {
          ok: false,
          error: normalizeString(error && error.message) || 'Coldcalling-kosten konden niet geladen worden.',
        };
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function refreshMonthlyApiCosts() {
    if (!resolveApiCostItem() || !getMonthlyCostsRender()) {
      return { ok: true, updated: false };
    }
    try {
      const summary = await fetchApiCostSummary();
      const amountEur = Number(summary.costEur || 0) || 0;
      return { ok: true, updated: applyApiCost(amountEur, buildApiCostNote(summary)), amountEur, source: 'api-costs' };
    } catch (error) {
      applyApiCost(0, API_COST_UNAVAILABLE_NOTE);
      return {
        ok: false,
        error: normalizeString(error && error.message) || 'API-kosten konden niet geladen worden.',
      };
    }
  }

  function startDynamicMonthlyCostsSync() {
    if (!resolveColdcallingCostItem() || !getMonthlyCostsRender()) return;

    void refreshMonthlyColdcallingCosts();
    void refreshMonthlyApiCosts();
    if (!pollTimer) {
      pollTimer = window.setInterval(function () {
        void refreshMonthlyColdcallingCosts();
        void refreshMonthlyApiCosts();
      }, POLL_INTERVAL_MS);
    }

    window.addEventListener('focus', function () {
      void refreshMonthlyColdcallingCosts();
      void refreshMonthlyApiCosts();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        void refreshMonthlyColdcallingCosts();
        void refreshMonthlyApiCosts();
      }
    });
  }

  window.refreshMonthlyColdcallingCosts = refreshMonthlyColdcallingCosts;
  window.refreshMonthlyApiCosts = refreshMonthlyApiCosts;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDynamicMonthlyCostsSync, { once: true });
  } else {
    startDynamicMonthlyCostsSync();
  }
})();
