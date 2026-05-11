(function () {
  'use strict';

  var ENDPOINT = '/api/coldmailing/replies/follow-ups?limit=8';
  var refreshInProgress = false;
  var refreshTimer = null;

  function ensureStyles() {
    if (document.getElementById('coldmailFollowUpsStyles')) return;
    var style = document.createElement('style');
    style.id = 'coldmailFollowUpsStyles';
    style.textContent = [
      '.coldmail-followups{margin-top:18px;border:1px solid rgba(22,115,60,.16);border-radius:8px;background:rgba(22,115,60,.035);overflow:hidden}',
      '.coldmail-followups[hidden]{display:none}',
      '.coldmail-followups-head{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(22,115,60,.12)}',
      '.coldmail-followups-title{font-family:"Oswald",sans-serif;font-size:11px;font-weight:500;letter-spacing:1.4px;text-transform:uppercase;color:var(--dark)}',
      '.coldmail-followups-count{min-width:26px;min-height:24px;padding:4px 8px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(22,115,60,.1);color:var(--z5);font-family:"Oswald",sans-serif;font-size:13px;font-weight:700}',
      '.coldmail-followups-meta{font-size:11px;color:var(--mid)}',
      '.coldmail-followups-list{max-height:240px;overflow:auto}',
      '.coldmail-followup-row{padding:12px 14px;border-bottom:1px solid rgba(22,115,60,.1);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}',
      '.coldmail-followup-row:last-child{border-bottom:none}',
      '.coldmail-followup-company{font-size:13px;font-weight:700;color:var(--dark);margin-bottom:3px}',
      '.coldmail-followup-preview{font-size:12px;line-height:1.45;color:var(--mid);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.coldmail-followup-meta{font-size:11px;color:var(--light);white-space:nowrap}',
      'html[data-softora-lead-generator-alias="1"] .coldmail-followups{display:none!important}',
    ].join('');
    document.head.appendChild(style);
  }

  function isLeadGeneratorAlias() {
    return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
  }

  function getElements() {
    ensureContainer();
    return {
      root: document.getElementById('coldmailFollowUps'),
      count: document.getElementById('coldmailFollowUpsCount'),
      list: document.getElementById('coldmailFollowUpsList'),
      meta: document.getElementById('coldmailFollowUpsMeta'),
    };
  }

  function ensureContainer() {
    if (isLeadGeneratorAlias()) return null;
    var existing = document.getElementById('coldmailFollowUps');
    if (existing) return existing;
    var startButton = document.getElementById('start-campaign-btn');
    var parent = startButton && startButton.parentElement;
    if (!parent) return null;
    ensureStyles();

    var root = document.createElement('div');
    root.className = 'coldmail-followups';
    root.id = 'coldmailFollowUps';
    root.hidden = true;

    var head = document.createElement('div');
    head.className = 'coldmail-followups-head';

    var titleWrap = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'coldmail-followups-title';
    title.textContent = 'Mailinteresse';
    var meta = document.createElement('div');
    meta.className = 'coldmail-followups-meta';
    meta.id = 'coldmailFollowUpsMeta';
    meta.textContent = '0 reacties';

    var count = document.createElement('div');
    count.className = 'coldmail-followups-count';
    count.id = 'coldmailFollowUpsCount';
    count.textContent = '0';

    var list = document.createElement('div');
    list.className = 'coldmail-followups-list';
    list.id = 'coldmailFollowUpsList';

    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    head.appendChild(titleWrap);
    head.appendChild(count);
    root.appendChild(head);
    root.appendChild(list);
    parent.insertBefore(root, startButton.nextSibling);
    return root;
  }

  function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function formatReplyDate(value) {
    var parsed = Date.parse(String(value || '').trim());
    if (!Number.isFinite(parsed)) return '';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(parsed));
    } catch (_) {
      return '';
    }
  }

  function appendFollowUpRow(list, item) {
    var row = document.createElement('div');
    row.className = 'coldmail-followup-row';

    var main = document.createElement('div');
    main.className = 'coldmail-followup-main';

    var company = document.createElement('div');
    company.className = 'coldmail-followup-company';
    company.textContent = item.bedrijf || item.naam || item.email || 'Onbekend bedrijf';

    var preview = document.createElement('div');
    preview.className = 'coldmail-followup-preview';
    preview.textContent = item.preview || item.subject || item.email || 'Interesse via mail';

    var meta = document.createElement('div');
    meta.className = 'coldmail-followup-meta';
    meta.textContent = [item.email || '', formatReplyDate(item.replyAt)].filter(Boolean).join(' · ');

    main.appendChild(company);
    main.appendChild(preview);
    row.appendChild(main);
    row.appendChild(meta);
    list.appendChild(row);
  }

  function renderFollowUps(payload) {
    var els = getElements();
    if (!els.root || !els.list || !els.count) return;

    var items = Array.isArray(payload && payload.items) ? payload.items : [];
    var total = Number(payload && payload.total);
    var safeTotal = Number.isFinite(total) ? total : items.length;

    if (isLeadGeneratorAlias() || !items.length) {
      els.root.hidden = true;
      clearNode(els.list);
      return;
    }

    els.root.hidden = false;
    els.count.textContent = String(safeTotal);
    if (els.meta) {
      els.meta.textContent = safeTotal === 1 ? '1 reactie' : safeTotal + ' reacties';
    }

    clearNode(els.list);
    items.forEach(function (item) {
      appendFollowUpRow(els.list, item && typeof item === 'object' ? item : {});
    });
  }

  async function refreshFollowUps() {
    var els = getElements();
    if (!els.root || isLeadGeneratorAlias() || refreshInProgress) return null;
    refreshInProgress = true;
    try {
      var response = await fetch(ENDPOINT, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      var payload = await response.json().catch(function () { return null; });
      if (!response.ok || !payload || payload.ok === false) throw new Error('followups_failed');
      renderFollowUps(payload);
      return payload;
    } catch (_) {
      els.root.hidden = true;
      return null;
    } finally {
      refreshInProgress = false;
    }
  }

  function init() {
    if (isLeadGeneratorAlias()) return;
    void refreshFollowUps();
    window.addEventListener('focus', refreshFollowUps);
    window.addEventListener('pageshow', refreshFollowUps);
    window.addEventListener('softora-coldmail-followups-refresh', refreshFollowUps);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) void refreshFollowUps();
    });
    refreshTimer = window.setInterval(function () {
      if (!document.hidden) void refreshFollowUps();
    }, 60000);
  }

  window.SoftoraColdmailFollowUps = {
    refresh: refreshFollowUps,
    stop: function () {
      if (refreshTimer) window.clearInterval(refreshTimer);
      refreshTimer = null;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
