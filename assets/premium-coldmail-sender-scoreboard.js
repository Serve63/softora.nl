(function setupColdmailSenderScoreboard(global) {
  const CUSTOMER_DB_SCOPE = 'premium_customers_database';
  const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
  const SENDER_ROWS = [
    { email: 'martijn@softora.nl', displayName: 'Martijn' },
    { email: 'serve@softora.nl', displayName: 'Servé' },
  ];
  const STYLE_ID = 'softora-coldmail-sender-scoreboard-style';
  const RETRY_DELAY_MS = 3500;

  let retryTimer = null;

  function normalizeString(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeEmail(value) {
    return normalizeString(value).toLowerCase();
  }

  function hasCustomerRowsSnapshot(values) {
    const stateValues = values && typeof values === 'object' ? values : {};
    return Object.prototype.hasOwnProperty.call(stateValues, CUSTOMER_DB_KEY) ||
      Object.prototype.hasOwnProperty.call(stateValues, CUSTOMER_DB_KEY + '_chunks_v1');
  }

  function parseCustomerRows(values) {
    const stateValues = values && typeof values === 'object' ? values : {};
    let raw = stateValues[CUSTOMER_DB_KEY];
    if (!raw && stateValues[CUSTOMER_DB_KEY + '_chunks_v1']) {
      try {
        const meta = JSON.parse(String(stateValues[CUSTOMER_DB_KEY + '_chunks_v1'] || '{}'));
        raw = Array.from(
          { length: Math.max(0, Math.min(200, Number(meta && meta.count) || 0)) },
          (_, index) => String(stateValues[CUSTOMER_DB_KEY + '_chunk_' + index] || '')
        ).join('');
      } catch (_) {
        raw = '';
      }
    }
    if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function resolveSenderEmail(row) {
    if (!row || typeof row !== 'object') return '';
    return normalizeEmail(
      row.sentFromEmail ||
      row.sent_from_email ||
      row.outreachSentFromEmail ||
      row.lastColdmailSenderEmail
    );
  }

  function hasColdmailSendSignal(row) {
    if (!row || typeof row !== 'object') return false;
    return Boolean(
      normalizeString(row.outreachSentAt) ||
      normalizeString(row.outreach_sent_at) ||
      normalizeString(row.lastColdmailSentAt) ||
      normalizeString(row.lastMailSentAt) ||
      normalizeString(row.coldmailCampaignStartedAt) ||
      resolveSenderEmail(row)
    );
  }

  function calculateSenderStats(rows) {
    const counts = SENDER_ROWS.reduce((result, sender) => {
      result[sender.email] = 0;
      return result;
    }, {});
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const senderEmail = resolveSenderEmail(row);
      if (!Object.prototype.hasOwnProperty.call(counts, senderEmail)) return;
      if (!hasColdmailSendSignal(row)) return;
      counts[senderEmail] += 1;
    });
    return SENDER_ROWS
      .map((sender, index) => ({
        email: sender.email,
        displayName: sender.displayName,
        count: Number(counts[sender.email] || 0),
        index,
      }))
      .sort((left, right) => {
        const countDiff = right.count - left.count;
        return countDiff || left.index - right.index;
      });
  }

  function injectStyles() {
    const doc = global.document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.coldmail-sender-scoreboard{display:grid;gap:.32rem;min-width:9.5rem;margin-top:.12rem;font-family:Oswald,sans-serif;font-size:.94rem;font-weight:600;letter-spacing:.04em;line-height:1;text-transform:uppercase;white-space:nowrap}',
      '.coldmail-sender-scoreboard-list{display:grid;gap:.34rem}',
      '.coldmail-sender-scoreboard-entry{display:inline-flex;align-items:center;justify-content:space-between;gap:.82rem;color:var(--text-primary)}',
      '.coldmail-sender-scoreboard-entry.is-leading{color:var(--crimson)}',
      '.coldmail-sender-scoreboard-name,.coldmail-sender-scoreboard-count{display:inline-flex;align-items:center}',
      '.coldmail-sender-scoreboard-count{min-width:1.45rem;justify-content:flex-end;color:inherit;font-variant-numeric:tabular-nums}',
      '.coldmail-sender-scoreboard.is-loading .coldmail-sender-scoreboard-count{color:var(--text-tertiary)}',
      'html[data-softora-lead-generator-alias="1"] .coldmail-sender-scoreboard{display:none!important}',
      '@media (max-width:1024px){.coldmail-sender-scoreboard{align-self:flex-start}}',
    ].join('');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function createSenderRow(doc, sender) {
    const row = doc.createElement('div');
    row.className = 'coldmail-sender-scoreboard-entry';
    row.setAttribute('data-coldmail-sender-row', '');
    row.setAttribute('data-coldmail-sender', sender.email);
    const name = doc.createElement('span');
    name.className = 'coldmail-sender-scoreboard-name';
    name.textContent = sender.displayName;
    const count = doc.createElement('span');
    count.className = 'coldmail-sender-scoreboard-count';
    count.setAttribute('data-coldmail-sender-count', '');
    count.textContent = '...';
    row.appendChild(name);
    row.appendChild(count);
    return row;
  }

  function ensureScoreboard() {
    const doc = global.document;
    if (!doc || doc.getElementById('coldmailSenderScoreboard')) return;
    const topbar = doc.querySelector('#screen-dashboard .topbar');
    if (!topbar) return;
    const wrap = doc.createElement('div');
    wrap.className = 'coldmail-sender-scoreboard';
    wrap.classList.add('is-loading');
    wrap.id = 'coldmailSenderScoreboard';
    wrap.setAttribute('aria-label', 'Coldmail teller per mailadres');
    const list = doc.createElement('div');
    list.className = 'coldmail-sender-scoreboard-list';
    list.id = 'coldmailSenderScoreboardList';
    SENDER_ROWS.forEach((sender) => list.appendChild(createSenderRow(doc, sender)));
    wrap.appendChild(list);
    topbar.appendChild(wrap);
  }

  function setLoadingState() {
    const doc = global.document;
    const wrap = doc && doc.getElementById ? doc.getElementById('coldmailSenderScoreboard') : null;
    const list = doc && doc.getElementById ? doc.getElementById('coldmailSenderScoreboardList') : null;
    if (wrap) {
      wrap.classList.add('is-loading');
      wrap.setAttribute('aria-label', 'Coldmail teller per mailadres wordt geladen');
    }
    if (!list) return;
    Array.from(list.querySelectorAll('[data-coldmail-sender-row]')).forEach((row) => {
      row.classList.remove('is-leading');
      const countEl = row.querySelector('[data-coldmail-sender-count]');
      if (countEl) countEl.textContent = '...';
    });
  }

  function renderSenderStats(entries) {
    const doc = global.document;
    const wrap = doc && doc.getElementById ? doc.getElementById('coldmailSenderScoreboard') : null;
    const list = doc && doc.getElementById ? doc.getElementById('coldmailSenderScoreboardList') : null;
    if (!list) return;
    if (wrap) {
      wrap.classList.remove('is-loading');
      wrap.setAttribute('aria-label', 'Coldmail teller per mailadres');
    }
    const rowsByEmail = new Map();
    Array.from(list.querySelectorAll('[data-coldmail-sender-row]')).forEach((row) => {
      rowsByEmail.set(normalizeEmail(row.getAttribute('data-coldmail-sender')), row);
    });
    const highestCount = Math.max(0, ...entries.map((entry) => Number(entry.count || 0)));
    entries.forEach((entry, index) => {
      const row = rowsByEmail.get(entry.email);
      if (!row) return;
      const count = Math.max(0, Number(entry.count || 0));
      const countEl = row.querySelector('[data-coldmail-sender-count]');
      const nameEl = row.querySelector('.coldmail-sender-scoreboard-name');
      if (nameEl) nameEl.textContent = entry.displayName;
      if (countEl) countEl.textContent = String(count);
      row.classList.toggle('is-leading', index === 0 && highestCount > 0);
      row.setAttribute('aria-label', entry.displayName + ' ' + count + ' coldmails');
      list.appendChild(row);
    });
  }

  async function loadCustomerRows() {
    const response = await global.fetch('/api/ui-state-get?scope=' + encodeURIComponent(CUSTOMER_DB_SCOPE), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error('Coldmail teller laden mislukt.');
    return {
      rows: parseCustomerRows(payload.values),
      hasSnapshot: hasCustomerRowsSnapshot(payload.values),
    };
  }

  function scheduleRetry() {
    if (typeof global.setTimeout !== 'function') return;
    if (retryTimer && typeof global.clearTimeout === 'function') global.clearTimeout(retryTimer);
    retryTimer = global.setTimeout(() => {
      refresh().catch(() => null);
    }, RETRY_DELAY_MS);
  }

  async function refresh() {
    const doc = global.document;
    if (doc && doc.documentElement && doc.documentElement.getAttribute('data-softora-lead-generator-alias') === '1') {
      return [];
    }
    injectStyles();
    ensureScoreboard();
    const snapshot = await loadCustomerRows();
    if (!snapshot.hasSnapshot) {
      setLoadingState();
      scheduleRetry();
      return [];
    }
    if (retryTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(retryTimer);
      retryTimer = null;
    }
    const entries = calculateSenderStats(snapshot.rows);
    renderSenderStats(entries);
    return entries;
  }

  function patchSendRefresh() {
    const original = global.sendColdmailCampaignNow;
    if (typeof original !== 'function' || original.__coldmailSenderScoreboardPatched) return false;
    const patched = async function sendColdmailCampaignNowWithSenderScoreboardRefresh() {
      const result = await original.apply(this, arguments);
      global.setTimeout(() => {
        refresh().catch(() => null);
      }, 0);
      return result;
    };
    patched.__coldmailSenderScoreboardPatched = true;
    global.sendColdmailCampaignNow = patched;
    return true;
  }

  function init() {
    injectStyles();
    ensureScoreboard();
    if (!patchSendRefresh() && typeof global.setTimeout === 'function') {
      global.setTimeout(patchSendRefresh, 0);
    }
    refresh().catch(() => null);
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else if (global.document) {
    init();
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('load', patchSendRefresh);
    global.addEventListener('focus', () => refresh().catch(() => null));
    global.addEventListener('pageshow', () => refresh().catch(() => null));
  }

  global.SoftoraColdmailSenderScoreboard = {
    calculateSenderStats,
    ensureScoreboard,
    hasCustomerRowsSnapshot,
    parseCustomerRows,
    patchSendRefresh,
    renderSenderStats,
    setLoadingState,
    refresh,
  };
})(window);
