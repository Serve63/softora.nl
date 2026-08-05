(function initKvkTotalFoundModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.KvkTotalFoundList = api;
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => api.mount(root), { once: true });
    } else {
      api.mount(root);
    }
  }
})(typeof window === 'object' ? window : null, function createKvkTotalFoundModule() {
  'use strict';

  const COMPANY_API_URL = 'http://127.0.0.1:8000/api/company-directory';
  const PAGE_SIZE = 100;
  const TREATED_CONTACT_STATUSES = new Set(['checked', 'done', 'searched', 'unusable']);
  const FINAL_LEAD_STATUSES = new Set(['usable', 'unusable']);
  const UNUSABLE_LABELS = {
    missing_phone: 'Geen telefoon',
    missing_email: 'Geen mail',
    missing_phone_and_email: 'Geen contact',
    stopped: 'Gestopt',
    operational_unclear: 'Status onduidelijk',
    non_specific_entity: 'Geen specifiek bedrijf',
    weak_source_quality: 'Zwakke bron',
    no_own_contact: 'Geen eigen contact',
    wrong_entity: 'Verkeerd bedrijf',
    chain_branch: 'Keten/formule',
    other: 'Andere reden',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isTreated(company) {
    return (
      TREATED_CONTACT_STATUSES.has(String(company?.contact_status || '').trim()) ||
      FINAL_LEAD_STATUSES.has(String(company?.lead_status || '').trim())
    );
  }

  function missingLabel(company) {
    return isTreated(company) ? 'Niet gevonden' : 'Nog niet behandeld';
  }

  function companyStatus(company) {
    const leadStatus = String(company?.lead_status || '').trim();
    const reviewFinding = String(company?.review_finding || '').trim();
    const usableReviewOutcome = String(company?.usable_review_outcome || '').trim();
    if (reviewFinding === 'incorrect_approval' || usableReviewOutcome === 'rejected_to_control') {
      return { label: 'Onterecht goedgekeurd', className: 'is-unusable' };
    }
    if (leadStatus === 'usable') return { label: 'Bruikbaar', className: 'is-usable' };
    if (leadStatus === 'unusable') {
      const reason = String(company?.unusable_reason || '').trim();
      const label = UNUSABLE_LABELS[reason] || 'Onbruikbaar';
      return {
        label,
        className: reason === 'stopped' ? 'is-stopped' : 'is-unusable',
      };
    }
    return { label: 'Nog niet behandeld', className: 'is-pending' };
  }

  function fieldHtml(company, field) {
    const value = String(company?.[field] || '').trim();
    if (value) return escapeHtml(value);
    return `<span class="pending-value">${escapeHtml(missingLabel(company))}</span>`;
  }

  function websiteHtml(company) {
    const website = String(company?.website || '').trim();
    if (!website) return `<span class="pending-value">${escapeHtml(missingLabel(company))}</span>`;
    const href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    return `<a class="website-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(website)}</a>`;
  }

  function locationLabel(company) {
    return [company?.woonplaats, company?.gemeente, company?.provincie]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(', ');
  }

  function companyRowHtml(company) {
    const status = companyStatus(company);
    return `
      <tr>
        <td><strong>${escapeHtml(company?.bedrijfsnaam || '-')}</strong></td>
        <td>${escapeHtml(company?.kvk_nummer || '-')}</td>
        <td><span class="company-status ${status.className}">${escapeHtml(status.label)}</span></td>
        <td>${fieldHtml(company, 'telefoonnummer')}</td>
        <td>${fieldHtml(company, 'email')}</td>
        <td class="link-like">${websiteHtml(company)}</td>
        <td>${escapeHtml(locationLabel(company) || '-')}</td>
      </tr>
    `;
  }

  function buildCompanyApiUrl(query, offset) {
    const params = new URLSearchParams({
      q: String(query || '').trim(),
      limit: String(PAGE_SIZE),
      offset: String(Math.max(0, Number(offset) || 0)),
    });
    return `${COMPANY_API_URL}?${params.toString()}`;
  }

  function mount(browserWindow) {
    const document = browserWindow?.document;
    const card = document?.getElementById('companies-total-card');
    const panel = document?.querySelector('[data-collapsible="total-found"]');
    const frame = document?.getElementById('main-table-frame');
    const head = document?.getElementById('table-head');
    const body = document?.getElementById('table-body');
    const searchInput = document?.getElementById('search-input');
    const sourceStatus = document?.getElementById('total-found-source-status');
    if (!card || !panel || !frame || !head || !body || !searchInput || !sourceStatus) return null;

    const state = {
      rows: [],
      offset: 0,
      total: 0,
      hasMore: true,
      loading: false,
      opened: false,
      query: '',
      requestVersion: 0,
    };
    const numberFormat = new Intl.NumberFormat('nl-NL');
    let searchTimer = null;
    let observer = null;

    function setSourceStatus(text, tone = '') {
      sourceStatus.textContent = text;
      sourceStatus.dataset.tone = tone;
    }

    function observeTable() {
      if (!observer) {
        observer = new MutationObserver(() => {
          if (!state.opened) return;
          renderRows();
        });
      }
      observer.observe(body, { childList: true });
    }

    function renderRows() {
      if (!state.opened) return;
      observer?.disconnect();
      head.innerHTML = `
        <tr>
          <th>Bedrijfsnaam</th>
          <th>KVK</th>
          <th>Status</th>
          <th>Telefoonnummer</th>
          <th>Mailadres</th>
          <th>Website</th>
          <th>Locatie</th>
        </tr>
      `;
      if (state.rows.length) {
        body.innerHTML = state.rows.map(companyRowHtml).join('');
      } else if (!state.loading) {
        body.innerHTML = '<tr class="empty-row"><td colspan="7">Geen bedrijven gevonden.</td></tr>';
      }
      const totalText = state.total ? numberFormat.format(state.total) : '0';
      card.setAttribute('aria-label', `Toon alle ${totalText} gevonden bedrijven`);
      card.setAttribute('aria-expanded', state.opened ? 'true' : 'false');
      if (!state.loading) {
        const statusText = state.query
          ? `${numberFormat.format(state.rows.length)} zoekresultaten geladen${state.hasMore ? ' · meer beschikbaar' : ''}`
          : `${totalText} bedrijven · ${numberFormat.format(state.rows.length)} geladen`;
        setSourceStatus(statusText, 'ready');
      }
      observeTable();
    }

    async function loadPage({ reset = false } = {}) {
      if (state.loading || (!reset && !state.hasMore)) return;
      if (reset) {
        state.rows = [];
        state.offset = 0;
        state.total = 0;
        state.hasMore = true;
        state.requestVersion += 1;
      }
      const requestVersion = state.requestVersion;
      state.loading = true;
      setSourceStatus(reset ? 'Volledige landelijke lijst laden…' : 'Meer bedrijven laden…', 'loading');
      try {
        const response = await browserWindow.fetch(buildCompanyApiUrl(state.query, state.offset), {
          cache: 'no-store',
          mode: 'cors',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestVersion !== state.requestVersion) return;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        state.rows = reset ? rows : [...state.rows, ...rows];
        state.offset += rows.length;
        state.total = Math.max(0, Number(payload?.total) || state.rows.length);
        state.hasMore = Boolean(payload?.has_more) && rows.length > 0;
      } catch {
        if (requestVersion !== state.requestVersion) return;
        state.hasMore = false;
        state.rows = [];
        setSourceStatus('Volledige lijst niet bereikbaar · start de lokale database', 'error');
      } finally {
        if (requestVersion === state.requestVersion) {
          state.loading = false;
          renderRows();
        }
      }
    }

    function openList() {
      state.opened = true;
      if (panel.classList.contains('is-collapsed')) {
        panel.querySelector('.collapse-toggle')?.click();
      }
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadPage({ reset: true });
    }

    card.addEventListener('click', openList);
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openList();
    });
    searchInput.addEventListener('input', (event) => {
      if (!state.opened) return;
      state.query = String(event.target.value || '');
      browserWindow.clearTimeout(searchTimer);
      searchTimer = browserWindow.setTimeout(() => loadPage({ reset: true }), 220);
    });
    frame.addEventListener('scroll', () => {
      if (!state.opened || state.loading || !state.hasMore) return;
      if (frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 180) loadPage();
    });
    observeTable();

    return { openList, loadPage, renderRows, state };
  }

  return {
    COMPANY_API_URL,
    PAGE_SIZE,
    buildCompanyApiUrl,
    companyRowHtml,
    companyStatus,
    isTreated,
    missingLabel,
    mount,
  };
});
