(function () {
  'use strict';

  const CUSTOMER_DB_SCOPE = 'premium_customers_database';
  const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
  const RETRY_DELAY_MS = 3500;
  const SENDERS = Object.freeze([
    { email: 'serve@softora.nl', label: 'Servé' },
    { email: 'martijn@softora.nl', label: 'Martijn' },
    { email: 'ruben@softora.nl', label: 'Ruben' },
  ]);

  let retryTimer = null;

  function isLeadGeneratorAlias() {
    try {
      return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
    } catch (_) {
      return false;
    }
  }

  function normalizeLowerText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function ensureStyles() {
    if (document.getElementById('coldmailSenderScoreStyles')) return;
    const style = document.createElement('style');
    style.id = 'coldmailSenderScoreStyles';
    style.textContent = [
      '.topbar-right{display:flex;align-items:flex-start;justify-content:flex-end;min-width:190px}',
      '.coldmail-sender-score{min-width:176px;display:flex;flex-direction:column;gap:5px;font-family:\"Oswald\",sans-serif;font-size:15px;font-weight:700;letter-spacing:.08em;line-height:1.05;text-transform:uppercase;color:var(--dark)}',
      '.coldmail-sender-score[hidden]{display:none!important}',
      '.coldmail-sender-score-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:18px}',
      '.coldmail-sender-score-row.is-leading{color:var(--crimson)}',
      '.coldmail-sender-score-count{min-width:24px;text-align:right;font-variant-numeric:tabular-nums}',
      '.coldmail-sender-score-metrics{display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:74px}',
      '.coldmail-sender-score-open-rate{font-size:10px;font-weight:700;letter-spacing:.05em;line-height:1.1;color:var(--crimson);white-space:nowrap}',
      '.coldmail-sender-score-total{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:18px;margin-top:3px}',
      '.coldmail-sender-score-total-count{min-width:24px;padding-top:5px;border-top:2px solid currentColor;text-align:right;font-variant-numeric:tabular-nums;justify-self:end}',
      '.coldmail-sender-score-total-meta{font-size:11px;font-weight:800;letter-spacing:.06em;line-height:1.1;color:var(--crimson);white-space:nowrap;text-align:right}',
      '.coldmail-sender-score[data-coldmail-sender-score-state=\"loading\"] .coldmail-sender-score-count{color:var(--text-tertiary)}',
      '.coldmail-sender-score[data-coldmail-sender-score-state=\"loading\"] .coldmail-sender-score-total-count{color:var(--text-tertiary)}',
      '@media (max-width:1024px){.topbar-right{width:100%;justify-content:flex-start}}',
    ].join('');
    document.head.appendChild(style);
  }

  function appendTotalRow(root, value) {
    if (!root) return;
    const summary = value && typeof value === 'object'
      ? value
      : { count: value, opened: null, openRate: null };
    const hasValue = summary.count !== null && summary.count !== undefined && summary.count !== '' && Number.isFinite(Number(summary.count));
    const safeValue = hasValue ? String(Math.max(0, Number(summary.count) || 0)) : '...';
    const hasOpened = summary.opened !== null && summary.opened !== undefined && Number.isFinite(Number(summary.opened));
    const opened = hasOpened ? Math.max(0, Number(summary.opened) || 0) : null;
    const openRate = hasValue && Number(summary.count) > 0
      ? Math.round((Math.max(0, Number(summary.opened) || 0) / Math.max(1, Number(summary.count) || 0)) * 100)
      : 0;
    const row = document.createElement('div');
    row.className = 'coldmail-sender-score-total';
    row.setAttribute('data-coldmail-sender-score-total', '');
    row.setAttribute('aria-label', safeValue === '...' ? 'Totaal wordt geladen' : 'Totaal meetbaar verzonden coldmails: ' + safeValue + ', geopend: ' + (opened || 0) + ', open-rate: ' + openRate + '%');

    const spacer = document.createElement('span');
    spacer.className = 'coldmail-sender-score-total-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    const count = document.createElement('span');
    count.className = 'coldmail-sender-score-total-count';
    count.setAttribute('data-coldmail-sender-score-total-count', '');
    count.textContent = safeValue;

    const meta = document.createElement('span');
    meta.className = 'coldmail-sender-score-total-meta';
    meta.setAttribute('data-coldmail-sender-score-total-meta', '');
    meta.textContent = safeValue === '...' ? 'OPEN RATE ...' : 'OPEN RATE ' + openRate + '%';

    row.appendChild(spacer);
    const metrics = document.createElement('span');
    metrics.className = 'coldmail-sender-score-metrics';
    metrics.appendChild(count);
    metrics.appendChild(meta);
    row.appendChild(metrics);
    root.appendChild(row);
  }

  function ensureRoot() {
    ensureStyles();
    const existing = document.getElementById('coldmailSenderScore');
    if (existing) return existing;
    const topbar = document.querySelector('#screen-dashboard .topbar');
    if (!topbar) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'topbar-right';

    const root = document.createElement('div');
    root.className = 'coldmail-sender-score';
    root.id = 'coldmailSenderScore';
    root.setAttribute('data-coldmail-sender-score-state', 'loading');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Meetbaar verzonden, geopend en open-rate per afzender');

    SENDERS.forEach((sender) => {
      const row = document.createElement('div');
      row.className = 'coldmail-sender-score-row';
      row.setAttribute('data-coldmail-sender-score-row', sender.email);

      const name = document.createElement('span');
      name.className = 'coldmail-sender-score-name';
      name.textContent = sender.label;

      const count = document.createElement('span');
      count.className = 'coldmail-sender-score-count';
      count.setAttribute('data-coldmail-sender-score-count', sender.email);
      count.textContent = '...';

      const openRate = document.createElement('span');
      openRate.className = 'coldmail-sender-score-open-rate';
      openRate.setAttribute('data-coldmail-sender-score-open-rate', sender.email);
      openRate.textContent = '...';

      const metrics = document.createElement('span');
      metrics.className = 'coldmail-sender-score-metrics';
      metrics.appendChild(count);
      metrics.appendChild(openRate);

      row.appendChild(name);
      row.appendChild(metrics);
      root.appendChild(row);
    });
    appendTotalRow(root, null);

    wrapper.appendChild(root);
    topbar.appendChild(wrapper);
    return root;
  }

  function parseRowsFromState(payload) {
    const values = payload && payload.values && typeof payload.values === 'object' ? payload.values : {};
    const hasSnapshot = Object.prototype.hasOwnProperty.call(values, CUSTOMER_DB_KEY);
    const raw = values[CUSTOMER_DB_KEY];
    if (Array.isArray(raw)) {
      return { rows: raw.filter((item) => item && typeof item === 'object'), hasSnapshot };
    }
    if (!raw) return { rows: [], hasSnapshot };
    try {
      const parsed = JSON.parse(String(raw));
      return {
        rows: Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [],
        hasSnapshot,
      };
    } catch (_) {
      return { rows: [], hasSnapshot };
    }
  }

  async function fetchUiState(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = ['/api/ui-state-get?scope=' + encodedScope, '/api/ui-state/' + encodedScope];
    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error('UI-state GET mislukt (' + response.status + ')');
        return await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('UI-state GET mislukt');
  }

  function getSenderEmail(row) {
    return normalizeLowerText(
      row && (
        row.lastColdmailSenderEmail ||
        row.sentFromEmail ||
        row.sent_from_email ||
        row.outreachSentFromEmail ||
        row.outreach_sent_from_email
      )
    );
  }

  function hasColdmailOpen(row) {
    return Boolean(row && (
      row.coldmailOpened ||
      row.coldmailOpenedAt ||
      row.coldmailFirstOpenedAt ||
      row.outreachOpenedAt ||
      Number(row.coldmailOpenCount || row.outreachOpenCount || 0) > 0
    ));
  }

  function hasColdmailOpenTracking(row) {
    return Boolean(row && normalizeLowerText(row.coldmailTrackingId || row.coldmailOpenTrackingId));
  }

  function isColdmailOpenMeasurable(row) {
    return hasColdmailOpenTracking(row) || hasColdmailOpen(row);
  }

  function buildStats(rows) {
    const counts = {};
    SENDERS.forEach((sender) => {
      counts[sender.email] = { count: 0, opened: 0 };
    });
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const email = getSenderEmail(row);
      if (!Object.prototype.hasOwnProperty.call(counts, email)) return;
      if (!isColdmailOpenMeasurable(row)) return;
      counts[email].count += 1;
      if (hasColdmailOpen(row)) counts[email].opened += 1;
    });
    return SENDERS
      .map((sender, index) => ({
        email: sender.email,
        label: sender.label,
        count: Number((counts[sender.email] && counts[sender.email].count) || 0),
        opened: Number((counts[sender.email] && counts[sender.email].opened) || 0),
        openRate: counts[sender.email] && counts[sender.email].count
          ? Math.round((counts[sender.email].opened / counts[sender.email].count) * 100)
          : 0,
        index,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        if (right.opened !== left.opened) return right.opened - left.opened;
        return left.index - right.index;
      });
  }

  function setLoading() {
    const root = ensureRoot();
    if (!root) return;
    root.hidden = isLeadGeneratorAlias();
    root.setAttribute('data-coldmail-sender-score-state', 'loading');
    root.setAttribute('aria-label', 'Meetbaar verzonden, geopend en open-rate per afzender worden geladen');
    SENDERS.forEach((sender) => {
      const row = root.querySelector('[data-coldmail-sender-score-row="' + sender.email + '"]');
      const count = root.querySelector('[data-coldmail-sender-score-count="' + sender.email + '"]');
      const openRate = root.querySelector('[data-coldmail-sender-score-open-rate="' + sender.email + '"]');
      if (row) row.classList.remove('is-leading');
      if (count) count.textContent = '...';
      if (openRate) openRate.textContent = '...';
    });
    const totalCount = root.querySelector('[data-coldmail-sender-score-total-count]');
    if (totalCount) {
      totalCount.textContent = '...';
      const totalRow = totalCount.closest('[data-coldmail-sender-score-total]');
      if (totalRow) totalRow.setAttribute('aria-label', 'Totaal wordt geladen');
    } else {
      appendTotalRow(root, null);
    }
    const totalMeta = root.querySelector('[data-coldmail-sender-score-total-meta]');
    if (totalMeta) totalMeta.textContent = 'OPEN RATE ...';
  }

  function render(stats) {
    const root = ensureRoot();
    if (!root) return;
    if (isLeadGeneratorAlias()) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.innerHTML = '';
    root.setAttribute('data-coldmail-sender-score-state', 'ready');
    root.setAttribute('aria-label', 'Meetbaar verzonden, geopend en open-rate per afzender');
    const total = (Array.isArray(stats) ? stats : []).reduce((sum, item) => sum + Math.max(0, Number(item.count) || 0), 0);
    const openedTotal = (Array.isArray(stats) ? stats : []).reduce((sum, item) => sum + Math.max(0, Number(item.opened) || 0), 0);
    (Array.isArray(stats) ? stats : []).forEach((item, index) => {
      const countValue = Math.max(0, Number(item.count) || 0);
      const openedValue = Math.max(0, Number(item.opened) || 0);
      const openRateValue = countValue > 0 ? Math.round((openedValue / countValue) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'coldmail-sender-score-row' + (index === 0 && countValue > 0 ? ' is-leading' : '');
      row.setAttribute('data-coldmail-sender-score-row', item.email);
      row.setAttribute('aria-label', item.label + ': ' + countValue + ' meetbaar verzonden, ' + openedValue + ' geopend, open-rate ' + openRateValue + '%');

      const name = document.createElement('span');
      name.className = 'coldmail-sender-score-name';
      name.textContent = item.label;

      const count = document.createElement('span');
      count.className = 'coldmail-sender-score-count';
      count.setAttribute('data-coldmail-sender-score-count', item.email);
      count.textContent = String(countValue);

      const openRate = document.createElement('span');
      openRate.className = 'coldmail-sender-score-open-rate';
      openRate.setAttribute('data-coldmail-sender-score-open-rate', item.email);
      openRate.textContent = 'OPEN ' + openRateValue + '%';

      const metrics = document.createElement('span');
      metrics.className = 'coldmail-sender-score-metrics';
      metrics.appendChild(count);
      metrics.appendChild(openRate);

      row.appendChild(name);
      row.appendChild(metrics);
      root.appendChild(row);
    });
    appendTotalRow(root, { count: total, opened: openedTotal });
  }

  function scheduleRetry() {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => {
      void hydrate();
    }, RETRY_DELAY_MS);
  }

  async function hydrate(options = {}) {
    if (isLeadGeneratorAlias()) {
      const root = ensureRoot();
      if (root) root.hidden = true;
      return;
    }
    try {
      const payload = await fetchUiState(CUSTOMER_DB_SCOPE);
      const result = parseRowsFromState(payload);
      if (!result.hasSnapshot && !(options && options.allowEmpty)) {
        setLoading();
        scheduleRetry();
        return;
      }
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      render(buildStats(result.rows));
    } catch (_) {
      setLoading();
      scheduleRetry();
    }
  }

  function bindRefreshTriggers() {
    window.addEventListener('focus', () => {
      void hydrate();
    });
    window.addEventListener('pageshow', () => {
      void hydrate();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void hydrate();
    });
  }

  window.SoftoraColdmailSenderScore = {
    hydrate,
    render,
    setLoading,
    buildStats,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setLoading();
      void hydrate();
      bindRefreshTriggers();
    }, { once: true });
  } else {
    setLoading();
    void hydrate();
    bindRefreshTriggers();
  }
}());
