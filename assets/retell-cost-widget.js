(function () {
  'use strict';

  const ROOT_SELECTOR = '[data-retell-cost-root]';
  const CALL_UPDATES_ENDPOINT = '/api/coldcalling/call-updates?limit=500';
  const POLL_INTERVAL_MS = 15000;
  const DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD = 0.07;

  let refreshPromise = null;
  let pollTimer = null;
  let lastSummary = null;

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

    (Array.isArray(updates) ? updates : []).forEach((item, index) => {
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

  function buildRetellCostSummary(updates) {
    const merged = mergeCallUpdates(updates).filter(function (item) {
      return inferProvider(item) === 'retell' && isOutboundCallLike(item) && isQualifiedCallLike(item);
    });

    let callCount = 0;
    let totalDurationSeconds = 0;

    merged.forEach(function (item) {
      callCount += 1;
      totalDurationSeconds += Math.max(0, Math.round(parsePositiveNumber(item.durationSeconds)));
    });

    return {
      callCount,
      totalDurationSeconds,
      costUsd: (totalDurationSeconds / 60) * getRetellEstimatedCostPerMinuteUsd(),
    };
  }

  function formatUsdCost(amount) {
    const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  }

  function formatDuration(totalSeconds) {
    const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (safeSeconds <= 0) return '0m';

    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
      return minutes > 0 ? `${hours}u ${minutes}m` : `${hours}u`;
    }
    if (minutes > 0) {
      return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    return `${seconds}s`;
  }

  function formatMetaText(summary, fallbackText) {
    if (!summary || typeof summary !== 'object') {
      return normalizeString(fallbackText) || 'Niet beschikbaar';
    }

    if (Number(summary.callCount || 0) <= 0) {
      return 'Nog geen calls';
    }

    const callLabel = Number(summary.callCount || 0) === 1 ? '1 gesprek' : `${Number(summary.callCount || 0)} gesprekken`;
    return `${callLabel} · ${formatDuration(summary.totalDurationSeconds)}`;
  }

  function renderSummary(summary, state, fallbackText) {
    const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR));
    if (!roots.length) return;

    roots.forEach(function (root) {
      const card = root.querySelector('.topbar-cost-card');
      const valueEl = root.querySelector('[data-retell-cost-value]');
      const metaEl = root.querySelector('[data-retell-cost-meta]');

      if (card) {
        card.dataset.state = normalizeString(state) || 'ready';
      }
      if (valueEl) {
        valueEl.textContent = formatUsdCost(summary && summary.costUsd);
      }
      if (metaEl) {
        metaEl.textContent = formatMetaText(summary, fallbackText);
      }
    });
  }

  async function fetchCallUpdates() {
    const response = await fetch(CALL_UPDATES_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !data || data.ok !== true || !Array.isArray(data.updates)) {
      throw new Error(String((data && (data.error || data.detail)) || 'Retell kosten konden niet geladen worden.'));
    }
    return data.updates;
  }

  async function refreshRetellCostSummary(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const silent = Boolean(opts.silent);

    if (refreshPromise) return refreshPromise;
    if (!document.querySelector(ROOT_SELECTOR)) {
      return { ok: true, summary: null };
    }

    if (!silent && !lastSummary) {
      renderSummary({ costUsd: 0, callCount: 0, totalDurationSeconds: 0 }, 'loading', 'Ophalen...');
    }

    refreshPromise = (async function () {
      try {
        const updates = await fetchCallUpdates();
        const summary = buildRetellCostSummary(updates);
        lastSummary = summary;
        renderSummary(summary, 'ready', '');
        return { ok: true, summary: summary };
      } catch (error) {
        if (!lastSummary) {
          renderSummary(
            { costUsd: 0, callCount: 0, totalDurationSeconds: 0 },
            'error',
            normalizeString(error && error.message) || 'Niet beschikbaar'
          );
        }
        return {
          ok: false,
          error: normalizeString(error && error.message) || 'Retell kosten konden niet geladen worden.',
        };
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  function startRetellCostWidget() {
    if (!document.querySelector(ROOT_SELECTOR)) return;

    void refreshRetellCostSummary();
    if (!pollTimer) {
      pollTimer = window.setInterval(function () {
        void refreshRetellCostSummary({ silent: true });
      }, POLL_INTERVAL_MS);
    }

    window.addEventListener('focus', function () {
      void refreshRetellCostSummary({ silent: true });
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        void refreshRetellCostSummary({ silent: true });
      }
    });
  }

  window.refreshRetellCostSummary = refreshRetellCostSummary;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRetellCostWidget, { once: true });
  } else {
    startRetellCostWidget();
  }
})();
