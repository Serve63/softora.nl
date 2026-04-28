(function (global) {
  function byId(id) {
    return global.document && typeof global.document.getElementById === 'function'
      ? global.document.getElementById(id)
      : null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getNowTime() {
    return new Date().toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function cloneUiStateValues(values) {
    const nextValues = Object.create(null);
    if (!values || typeof values !== 'object') {
      return nextValues;
    }

    Object.entries(values).forEach(([k, v]) => {
      nextValues[String(k)] = String(v ?? '');
    });
    return nextValues;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new global.AbortController();
    const timeoutId = global.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await global.fetch(url, { ...options, signal: controller.signal });
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  function formatClockTime(date) {
    return new Date(date).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatConversationDuration(seconds) {
    const totalSeconds = Math.round(Number(seconds) || 0);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'Onbekend';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }

  function estimateCampaignCompletionTime(startedCount, campaign) {
    const started = Math.max(0, Number(startedCount) || 0);
    if (started <= 0) return null;

    const avgCallSeconds = 90;
    const mode = String(campaign?.dispatchMode || 'sequential');
    const delaySeconds =
      mode === 'delay' ? Math.max(0, Number(campaign?.dispatchDelaySeconds) || 0) : 0;
    const requestSpreadSeconds = mode === 'parallel' ? 5 : Math.min(20, started);

    let estimateSeconds;
    if (mode === 'parallel') {
      estimateSeconds = avgCallSeconds + requestSpreadSeconds;
    } else if (mode === 'delay') {
      const staggerSeconds = started > 1 ? (started - 1) * delaySeconds : 0;
      estimateSeconds = avgCallSeconds + staggerSeconds + requestSpreadSeconds;
    } else {
      estimateSeconds = started * avgCallSeconds + requestSpreadSeconds;
    }

    estimateSeconds = Math.max(30, estimateSeconds);

    return new Date(Date.now() + estimateSeconds * 1000);
  }

  function buildCampaignStartedMessage(startedCount, campaign, failedCount = 0, skippedCount = 0) {
    const started = Math.max(0, Number(startedCount) || 0);
    const failed = Math.max(0, Number(failedCount) || 0);
    const skipped = Math.max(0, Number(skippedCount) || 0);
    const personWord = started === 1 ? 'persoon' : 'personen';
    const eta = estimateCampaignCompletionTime(started, campaign);
    const etaText = eta ? ` Verwachte voltooiingstijd is rond ${formatClockTime(eta)}.` : '';
    const detailParts = [];
    if (skipped > 0) detailParts.push(`${skipped} overgeslagen`);
    if (failed > 0) detailParts.push(`${failed} niet gestart`);
    const detailText = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
    return `Gestart met het bellen van ${started} ${personWord}${detailText}.${etaText}`;
  }

  function normalizeSingleLineText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function formatLeadDatabasePhone(phone) {
    const raw = normalizeSingleLineText(phone);
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('31')) {
      return `+31 ${digits.slice(2, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10 && digits.startsWith('0')) {
      return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    }
    return raw;
  }

  function formatCampaignCustomRegioLabel(km) {
    const normalizedKm = Math.max(1, Math.round(Number(km) || 1));
    return `Aangepast (${normalizedKm} km)`;
  }

  function normalizeLeadDatabaseDecision(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(pending|nieuw|new|not_called|nog[-_ ]?niet[-_ ]?gebeld)$/.test(raw)) return 'pending';
    if (/^(called|gebeld)$/.test(raw)) return 'called';
    if (/^(no_answer|niet[-_ ]?opgenomen|geen[-_ ]?gehoor|busy|voicemail|missed)$/.test(raw)) return 'no_answer';
    if (/^(callback|terugbellen|follow[-_ ]?up)$/.test(raw)) return 'callback';
    if (/^(appointment|afspraak|meeting)$/.test(raw)) return 'appointment';
    if (/^(customer|klant|closed|won)$/.test(raw)) return 'customer';
    if (/^(do_not_call|dnc|uit[-_ ]?bellijst|stop|blacklist|remove)$/.test(raw)) return 'do_not_call';
    return '';
  }

  function getLeadDatabaseDecisionLabel(decision) {
    const normalized = normalizeLeadDatabaseDecision(decision);
    if (normalized === 'pending') return 'Nog niet gebeld';
    if (normalized === 'called') return 'Gebeld';
    if (normalized === 'no_answer') return 'Niet opgenomen';
    if (normalized === 'callback') return 'Terugbellen';
    if (normalized === 'appointment') return 'Wil afspraak';
    if (normalized === 'customer') return 'Klant';
    if (normalized === 'do_not_call') return 'Uit bellijst';
    return 'Onbekend';
  }

  function readColdcallingDashboardBootstrapPayload() {
    const element =
      global.document && typeof global.document.getElementById === 'function'
        ? global.document.getElementById('softoraColdcallingDashboardBootstrap')
        : null;
    if (!element) return null;
    try {
      const parsed = JSON.parse(String(element.textContent || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function setLeadSliderReadyState(isReady) {
    const sliderStage = byId('leadSliderStage');
    if (!sliderStage) return;
    sliderStage.dataset.sliderReady = isReady ? '1' : '0';
    if (isReady) {
      sliderStage.removeAttribute('aria-hidden');
      return;
    }
    sliderStage.setAttribute('aria-hidden', 'true');
  }

  const helpers = Object.freeze({
    byId,
    buildCampaignStartedMessage,
    cloneUiStateValues,
    estimateCampaignCompletionTime,
    escapeHtml,
    fetchWithTimeout,
    formatCampaignCustomRegioLabel,
    formatClockTime,
    formatConversationDuration,
    formatLeadDatabasePhone,
    getLeadDatabaseDecisionLabel,
    getNowTime,
    normalizeLeadDatabaseDecision,
    parseNumber,
    readColdcallingDashboardBootstrapPayload,
    setLeadSliderReadyState,
  });

  global.SoftoraColdcallingDashboardCore = helpers;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
})(typeof window !== 'undefined' ? window : globalThis);
