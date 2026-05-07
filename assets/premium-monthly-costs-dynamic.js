(function () {
  'use strict';

  const COST_SUMMARY_ENDPOINT = '/api/coldcalling/cost-summary?scope=month';
  const API_COST_SUMMARY_ENDPOINT = '/api/openai-costs';
  const POLL_INTERVAL_MS = 15000;
  const COLDCALLING_COST_NOTE = 'Retell AI kosten deze maand';
  const COLDCALLING_PARTIAL_NOTE = 'Retell AI deels exact, deels geschat';
  const API_COST_NOTE = 'Status: succesvol';
  const API_COST_UNAVAILABLE_NOTE = 'OpenAI kosten konden niet worden opgehaald';
  const DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD = 0.07;
  const DEFAULT_USD_TO_EUR_RATE = 0.92;

  let coldcallingRefreshPromise = null;
  let apiCostRefreshPromise = null;
  let pollTimer = null;
  let syncListenersBound = false;

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

  function formatCurrencyAmount(amount, currency) {
    const normalizedCurrency = normalizeString(currency || 'usd').toLowerCase();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return '-';
    const formatted = numericAmount.toLocaleString('nl-NL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (normalizedCurrency === 'usd') return '$' + formatted;
    if (normalizedCurrency === 'eur') return '€' + formatted;
    return formatted + ' ' + normalizedCurrency.toUpperCase();
  }

  function formatDateTime(value) {
    const parsed = Date.parse(normalizeString(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return new Date(parsed).toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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

  function applyColdcallingCost(amountEur, note) {
    const item = resolveColdcallingCostItem();
    const render = getMonthlyCostsRender();
    if (!item || !render) return false;

    const nextAmount = Math.max(0, Math.round((Number(amountEur) || 0) * 100) / 100);
    const nextNote = normalizeString(note) || COLDCALLING_COST_NOTE;
    const amountChanged = Number(item.bedrag || 0) !== nextAmount;
    const noteChanged = normalizeString(item.note) !== nextNote;
    if (!amountChanged && !noteChanged) return false;

    item.bedrag = nextAmount;
    item.note = nextNote;
    render();
    return true;
  }

  function buildColdcallingCostNote(summary) {
    const estimatedCostCount = Number(summary && summary.estimatedCostCount);
    return Number.isFinite(estimatedCostCount) && estimatedCostCount > 0
      ? COLDCALLING_PARTIAL_NOTE
      : COLDCALLING_COST_NOTE;
  }

  function applyApiCostSnapshot(snapshot) {
    const item = resolveApiCostItem();
    const render = getMonthlyCostsRender();
    if (!item || !render) return false;

    const currentMonth = snapshot && snapshot.currentMonth ? snapshot.currentMonth : null;
    const amount = Number(currentMonth && currentMonth.amount);
    const currency = normalizeString((currentMonth && currentMonth.currency) || snapshot.currency || 'usd').toLowerCase();
    const fetchedAtLabel = formatDateTime(snapshot && (snapshot.lastSuccessfulUpdate || snapshot.fetchedAt));
    const periods = snapshot && snapshot.periods && typeof snapshot.periods === 'object' ? snapshot.periods : {};
    const today = periods.today || {};
    const last7Days = periods.last_7_days || {};
    const last30Days = periods.last_30_days || {};

    if (!Number.isFinite(amount) || amount < 0) {
      return applyApiCostUnavailable({ message: API_COST_UNAVAILABLE_NOTE, payload: snapshot || {} });
    }

    const nextNote = [
      API_COST_NOTE,
      'Vandaag ' + formatCurrencyAmount(today.amount || 0, today.currency || currency),
      '7 dagen ' + formatCurrencyAmount(last7Days.amount || 0, last7Days.currency || currency),
      '30 dagen ' + formatCurrencyAmount(last30Days.amount || 0, last30Days.currency || currency),
      'Valuta ' + currency.toUpperCase(),
      fetchedAtLabel ? 'Bijgewerkt ' + fetchedAtLabel : '',
    ].filter(Boolean).join(' · ');

    const nextAmount = Math.round(amount * 100000000) / 100000000;
    const nextAmountLabel = formatCurrencyAmount(nextAmount, currency);
    const changed =
      Number(item.bedrag) !== nextAmount ||
      normalizeString(item.currency) !== currency ||
      normalizeString(item.amountLabel) !== nextAmountLabel ||
      normalizeString(item.note) !== nextNote ||
      normalizeString(item.status) !== 'success';

    if (!changed) return false;

    item.bedrag = nextAmount;
    item.currency = currency;
    item.amountLabel = nextAmountLabel;
    item.note = nextNote;
    item.status = 'success';
    render();
    return true;
  }

  function applyApiCostUnavailable(error) {
    const item = resolveApiCostItem();
    const render = getMonthlyCostsRender();
    if (!item || !render) return false;

    const payload = error && error.payload && typeof error.payload === 'object' ? error.payload : {};
    const lastSuccessful = payload.lastSuccessful || payload.last_successful || null;
    const lastMonth = lastSuccessful && lastSuccessful.currentMonth ? lastSuccessful.currentMonth : null;
    const lastAmountLabel = lastMonth
      ? formatCurrencyAmount(lastMonth.amount || 0, lastMonth.currency || lastSuccessful.currency || 'usd')
      : '';
    const lastUpdateLabel = formatDateTime(lastSuccessful && (lastSuccessful.lastSuccessfulUpdate || lastSuccessful.fetchedAt));
    const noteParts = [API_COST_UNAVAILABLE_NOTE];
    if (lastAmountLabel && lastUpdateLabel) {
      noteParts.push('Laatst succesvol ' + lastUpdateLabel + ': ' + lastAmountLabel);
    }
    const nextNote = noteParts.join(' · ');
    const nextAmountLabel = 'Niet beschikbaar';
    const changed =
      item.bedrag !== null ||
      normalizeString(item.currency) !== '' ||
      normalizeString(item.amountLabel) !== nextAmountLabel ||
      normalizeString(item.note) !== nextNote ||
      normalizeString(item.status) !== 'error';

    if (!changed) return false;

    item.bedrag = null;
    item.currency = '';
    item.amountLabel = nextAmountLabel;
    item.note = nextNote;
    item.status = 'error';
    render();
    return true;
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

  async function fetchApiCostSummary() {
    const response = await fetch(API_COST_SUMMARY_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !data || data.ok !== true || data.status !== 'success') {
      const error = new Error(String((data && (data.message || data.detail || data.error)) || API_COST_UNAVAILABLE_NOTE));
      error.payload = data || {};
      throw error;
    }
    return data;
  }

  async function refreshMonthlyColdcallingCosts() {
    if (coldcallingRefreshPromise) return coldcallingRefreshPromise;
    if (!resolveColdcallingCostItem() || !getMonthlyCostsRender()) {
      return { ok: true, updated: false };
    }

    coldcallingRefreshPromise = (async function () {
      try {
        const summary = await fetchMonthlyCostSummary();
        const amountEur = Number(summary.costEur || 0) || 0;
        return { ok: true, updated: applyColdcallingCost(amountEur, buildColdcallingCostNote(summary)), amountEur };
      } catch (error) {
        return {
          ok: false,
          error: normalizeString(error && error.message) || 'Coldcalling-kosten konden niet geladen worden.',
        };
      } finally {
        coldcallingRefreshPromise = null;
      }
    })();

    return coldcallingRefreshPromise;
  }

  async function refreshMonthlyApiCosts() {
    if (apiCostRefreshPromise) return apiCostRefreshPromise;
    if (!resolveApiCostItem() || !getMonthlyCostsRender()) {
      return { ok: true, updated: false };
    }

    apiCostRefreshPromise = (async function () {
      try {
        const summary = await fetchApiCostSummary();
        const amount = Number(summary.currentMonth && summary.currentMonth.amount);
        return { ok: true, updated: applyApiCostSnapshot(summary), amount, currency: summary.currency, source: 'openai-costs' };
      } catch (error) {
        applyApiCostUnavailable(error);
        return {
          ok: false,
          error: normalizeString(error && error.message) || 'API-kosten konden niet geladen worden.',
        };
      } finally {
        apiCostRefreshPromise = null;
      }
    })();

    return apiCostRefreshPromise;
  }

  function startDynamicMonthlyCostsSync() {
    const hasColdcallingCostItem = Boolean(resolveColdcallingCostItem());
    const hasApiCostItem = Boolean(resolveApiCostItem());
    if ((!hasColdcallingCostItem && !hasApiCostItem) || !getMonthlyCostsRender()) return;

    if (hasColdcallingCostItem) void refreshMonthlyColdcallingCosts();
    if (hasApiCostItem) void refreshMonthlyApiCosts();
    if (!pollTimer) {
      pollTimer = window.setInterval(function () {
        void refreshMonthlyColdcallingCosts();
        void refreshMonthlyApiCosts();
      }, POLL_INTERVAL_MS);
    }

    if (syncListenersBound) return;
    syncListenersBound = true;

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
