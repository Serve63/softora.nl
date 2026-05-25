(function () {
  'use strict';

  var ENDPOINT = '/api/coldmailing/replies/follow-ups?limit=100&campaignType=webdesign';
  var REFRESH_INTERVAL_MS = 60000;
  var REQUEST_TIMEOUT_MS = 10000;
  var refreshTimer = null;
  var refreshInFlight = false;

  function getEls() {
    return {
      status: document.getElementById('coldmailingLeadStatus'),
      list: document.getElementById('coldmailingLeadList'),
    };
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function inferLeadType(item) {
    var text = normalize([
      item && item.branche,
      item && item.branch,
      item && item.subject,
      item && item.preview,
      item && item.bedrijf,
      item && item.company,
    ].filter(Boolean).join(' '));
    if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot/.test(text)) return 'Chatbots';
    if (/voice\s*software|voice\s*agent|spraaksoftware|belsoftware/.test(text)) return 'Voicesoftware';
    if (/bedrijfssoftware|business\s*software|crm|erp/.test(text)) return 'Bedrijfssoftware';
    return 'Website';
  }

  function leadTypeToClass(typeLabel) {
    var label = normalize(typeLabel);
    if (label.indexOf('chatbot') >= 0) return 'type-chatbot';
    if (label.indexOf('voice') >= 0 || label.indexOf('voicesoftware') >= 0) return 'type-voice-software';
    if (label.indexOf('bedrijfssoftware') >= 0 || label.indexOf('business') >= 0) return 'type-bedrijfssoftware';
    return 'type-website';
  }

  function formatReplyDate(value) {
    var timestamp = Date.parse(String(value || '').trim());
    if (!Number.isFinite(timestamp)) return '';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(timestamp));
    } catch (_) {
      return '';
    }
  }

  function setStatus(message, variant) {
    var els = getEls();
    if (!els.status) return;
    els.status.textContent = String(message || '');
    els.status.className = 'lead-status' + (variant ? ' ' + variant : '');
  }

  function setUpdatedStatus() {
    try {
      setStatus('Laatste update: ' + new Date().toLocaleTimeString('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
      }), '');
    } catch (_) {
      setStatus('Leads geladen.', '');
    }
  }

  function normalizeLeadItem(item) {
    var row = item && typeof item === 'object' ? item : {};
    return {
      company: String(row.bedrijf || row.company || row.naam || row.email || 'Onbekende lead').trim() || 'Onbekende lead',
      contact: String(row.naam || row.contact || '').trim(),
      email: String(row.email || '').trim(),
      phone: String(row.telefoon || row.phone || '').trim(),
      branch: String(row.branche || row.branch || '').trim(),
      city: String(row.plaats || row.city || '').trim(),
      subject: String(row.subject || '').trim(),
      preview: String(row.preview || '').trim(),
      replyAt: String(row.replyAt || row.createdAt || row.updatedAt || '').trim(),
      mailboxAccount: String(row.mailboxAccount || row.replyMailboxAccount || '').trim(),
      campaignType: String(row.campaignType || '').trim(),
      type: inferLeadType(row),
    };
  }

  function renderLeadItem(item) {
    var row = normalizeLeadItem(item);
    var meta = [
      '<div class="lead-meta"><span class="lead-meta-label">Bron:</span> Webdesign-mail</div>',
      '<div class="lead-meta"><span class="lead-meta-label">Van:</span> ' +
        esc(row.email || 'Mailreactie') +
        '</div>',
    ];
    if (row.mailboxAccount) {
      meta.push(
        '<div class="lead-meta"><span class="lead-meta-label">Ontvangen op:</span> ' +
          esc(row.mailboxAccount) +
          '</div>'
      );
    }
    var replyMeta = [row.city, formatReplyDate(row.replyAt)].filter(Boolean).join(' - ');
    if (row.preview || row.subject || replyMeta) {
      meta.push(
        '<div class="lead-meta"><span class="lead-meta-label">Reactie:</span> ' +
          esc(row.preview || row.subject || replyMeta) +
          '</div>'
      );
    }

    return [
      '<article class="lead-item ' + leadTypeToClass(row.type) + '">',
      '  <div>',
      '    <div class="lead-name">' + esc(row.company) + '</div>',
      meta.join(''),
      '  </div>',
      '  <span class="lead-chip confirmed">Lead</span>',
      '</article>',
    ].join('');
  }

  function renderList(items) {
    var els = getEls();
    if (!els.list) return;
    var rows = (Array.isArray(items) ? items : []).map(normalizeLeadItem);
    window.__softoraColdmailingLeadPageCount = rows.length;
    if (!rows.length) {
      els.list.innerHTML = '<div class="lead-empty">Nog geen positieve webdesign-reacties gevonden.</div>';
      setStatus('Nog geen positieve webdesign-reacties gevonden.', '');
      return;
    }
    els.list.innerHTML = rows.map(renderLeadItem).join('');
    setUpdatedStatus();
  }

  async function fetchJsonWithTimeout(url) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      var response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      var payload = await response.json().catch(function () { return null; });
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error('Webdesign leads laden mislukt.');
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function refreshLeads(options) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    if (!options || !options.silent) {
      setStatus('Leads laden...', '');
    }
    try {
      var payload = await fetchJsonWithTimeout(ENDPOINT);
      renderList(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      var els = getEls();
      if (els.list) {
        els.list.innerHTML = '<div class="lead-empty">Webdesign leads konden niet geladen worden.</div>';
      }
      setStatus(String(error && error.message ? error.message : 'Webdesign leads laden mislukt.'), 'error');
    } finally {
      refreshInFlight = false;
    }
  }

  function bindRefresh() {
    window.addEventListener('focus', function () {
      void refreshLeads({ silent: true });
    });
    window.addEventListener('pageshow', function () {
      void refreshLeads({ silent: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) void refreshLeads({ silent: true });
    });
    refreshTimer = window.setInterval(function () {
      if (!document.hidden) void refreshLeads({ silent: true });
    }, REFRESH_INTERVAL_MS);
  }

  function init() {
    var els = getEls();
    if (!els.status || !els.list) return;
    bindRefresh();
    void refreshLeads();
  }

  window.SoftoraColdmailingLeadPage = {
    refresh: refreshLeads,
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
