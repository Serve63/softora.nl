(function () {
  'use strict';

  const CUSTOMER_DB_SCOPE = 'premium_customers_database';
  const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
  const RETRY_DELAY_MS = 3500;
  const SENDERS = Object.freeze([
    { email: 'serve@softora.nl', label: 'Servé' },
    { email: 'martijn@softora.nl', label: 'Martijn' },
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
      '.topbar-right{display:flex;align-items:flex-start;justify-content:flex-end;min-width:150px}',
      '.coldmail-sender-score{min-width:122px;display:flex;flex-direction:column;gap:2px;font-family:\"Oswald\",sans-serif;font-size:15px;font-weight:700;letter-spacing:.08em;line-height:1.05;text-transform:uppercase;color:var(--dark)}',
      '.coldmail-sender-score[hidden]{display:none!important}',
      '.coldmail-sender-score-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;column-gap:28px}',
      '.coldmail-sender-score-row.is-leading{color:var(--crimson)}',
      '.coldmail-sender-score-count{min-width:18px;text-align:right;font-variant-numeric:tabular-nums}',
      '.coldmail-sender-score[data-coldmail-sender-score-state=\"loading\"] .coldmail-sender-score-count{color:var(--text-tertiary)}',
      '@media (max-width:1024px){.topbar-right{width:100%;justify-content:flex-start}}',
    ].join('');
    document.head.appendChild(style);
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
    root.setAttribute('aria-label', 'Verzonden coldmails per afzender');

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

      row.appendChild(name);
      row.appendChild(count);
      root.appendChild(row);
    });

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

  function buildStats(rows) {
    const counts = {};
    SENDERS.forEach((sender) => {
      counts[sender.email] = 0;
    });
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const email = getSenderEmail(row);
      if (!Object.prototype.hasOwnProperty.call(counts, email)) return;
      counts[email] += 1;
    });
    return SENDERS
      .map((sender, index) => ({
        email: sender.email,
        label: sender.label,
        count: Number(counts[sender.email] || 0),
        index,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.index - right.index;
      });
  }

  function setLoading() {
    const root = ensureRoot();
    if (!root) return;
    root.hidden = isLeadGeneratorAlias();
    root.setAttribute('data-coldmail-sender-score-state', 'loading');
    root.setAttribute('aria-label', 'Verzonden coldmails per afzender worden geladen');
    SENDERS.forEach((sender) => {
      const row = root.querySelector('[data-coldmail-sender-score-row="' + sender.email + '"]');
      const count = root.querySelector('[data-coldmail-sender-score-count="' + sender.email + '"]');
      if (row) row.classList.remove('is-leading');
      if (count) count.textContent = '...';
    });
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
    root.setAttribute('aria-label', 'Verzonden coldmails per afzender');
    (Array.isArray(stats) ? stats : []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'coldmail-sender-score-row' + (index === 0 && item.count > 0 ? ' is-leading' : '');
      row.setAttribute('data-coldmail-sender-score-row', item.email);

      const name = document.createElement('span');
      name.className = 'coldmail-sender-score-name';
      name.textContent = item.label;

      const count = document.createElement('span');
      count.className = 'coldmail-sender-score-count';
      count.setAttribute('data-coldmail-sender-score-count', item.email);
      count.textContent = String(Math.max(0, Number(item.count) || 0));

      row.appendChild(name);
      row.appendChild(count);
      root.appendChild(row);
    });
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
