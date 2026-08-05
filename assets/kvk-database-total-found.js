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
  const DIRECTORY_PAGE_URL = '/kvk-database-bedrijven';
  const PAGE_SIZE = 100;
  const AUTO_CONNECT_TIMEOUT_MS = 8000;
  const USER_CONNECT_TIMEOUT_MS = 30000;
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

  function companyFetchOptions(signal) {
    const options = {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      targetAddressSpace: 'loopback',
    };
    if (signal) options.signal = signal;
    return options;
  }

  async function localNetworkPermissionState(browserWindow) {
    const permissions = browserWindow?.navigator?.permissions;
    if (!permissions || typeof permissions.query !== 'function') return 'unknown';
    for (const name of ['loopback-network', 'local-network-access']) {
      try {
        const result = await permissions.query({ name });
        if (result?.state) return String(result.state);
      } catch {
        /* Older browsers do not know these permission names yet. */
      }
    }
    return 'unknown';
  }

  function navigateToDirectory(browserWindow) {
    const targetWindow = browserWindow?.top && browserWindow.top !== browserWindow
      ? browserWindow.top
      : browserWindow;
    targetWindow?.location?.assign(DIRECTORY_PAGE_URL);
  }

  function mountDashboardLink(browserWindow) {
    const document = browserWindow?.document;
    const card = document?.getElementById('companies-total-card');
    const openButton = document?.getElementById('companies-total-open');
    if (!card || !openButton) return null;

    const openDirectory = () => navigateToDirectory(browserWindow);
    openButton.addEventListener('click', openDirectory);

    return { openDirectory };
  }

  function mountDirectory(browserWindow) {
    const document = browserWindow?.document;
    const page = document?.getElementById('company-directory');
    const frame = document?.getElementById('company-directory-table-frame');
    const head = document?.getElementById('company-directory-head');
    const body = document?.getElementById('company-directory-body');
    const searchInput = document?.getElementById('company-directory-search');
    const sourceStatus = document?.getElementById('company-directory-source-status');
    const retryButton = document?.getElementById('company-directory-retry');
    const totalCount = document?.getElementById('company-directory-total');
    if (!page || !frame || !head || !body || !searchInput || !sourceStatus || !totalCount) return null;

    const state = {
      rows: [],
      offset: 0,
      total: 0,
      hasMore: true,
      loading: false,
      error: false,
      connectionRequired: false,
      errorMessage: '',
      query: '',
      requestVersion: 0,
    };
    const numberFormat = new Intl.NumberFormat('nl-NL');
    let searchTimer = null;

    function setSourceStatus(text, tone = '') {
      sourceStatus.textContent = text;
      sourceStatus.dataset.tone = tone;
    }

    function renderRows() {
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
      } else if (state.error || state.connectionRequired) {
        body.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(state.errorMessage || 'Lokale bedrijvendatabase niet bereikbaar.')}</td></tr>`;
      } else if (!state.loading) {
        body.innerHTML = `<tr class="empty-row"><td colspan="7">${state.query ? 'Geen bedrijven gevonden.' : 'Nog geen bedrijven geladen.'}</td></tr>`;
      }
      totalCount.textContent = state.total ? numberFormat.format(state.total) : '—';
      if (!state.loading && !state.error && !state.connectionRequired) {
        if (retryButton) retryButton.hidden = true;
        const totalText = numberFormat.format(state.total);
        const statusText = state.query
          ? `${numberFormat.format(state.rows.length)} zoekresultaten geladen${state.hasMore ? ' · meer beschikbaar' : ''}`
          : `${totalText} bedrijven · ${numberFormat.format(state.rows.length)} geladen`;
        setSourceStatus(statusText, 'ready');
      }
    }

    function setConnectionRequired(permissionState) {
      const blocked = permissionState === 'denied';
      state.hasMore = false;
      state.rows = [];
      state.error = blocked;
      state.connectionRequired = !blocked;
      state.errorMessage = blocked
        ? 'Lokale netwerktoegang is geblokkeerd. Sta deze toe in de site-instellingen van softora.nl en probeer opnieuw.'
        : 'Chrome heeft éénmalig toestemming nodig. Klik op Database verbinden en kies Toestaan.';
      setSourceStatus(state.errorMessage, blocked ? 'error' : 'permission');
      if (retryButton) retryButton.hidden = false;
    }

    async function loadPage({ reset = false, userInitiated = false } = {}) {
      if (!reset && (state.loading || !state.hasMore)) return;
      if (reset) {
        state.rows = [];
        state.offset = 0;
        if (!state.query) state.total = 0;
        state.hasMore = true;
        state.error = false;
        state.connectionRequired = false;
        state.errorMessage = '';
        state.requestVersion += 1;
      }
      const requestVersion = state.requestVersion;
      state.loading = true;
      if (retryButton) retryButton.hidden = true;
      setSourceStatus(
        userInitiated
          ? 'Kies Toestaan in de Chrome-melding…'
          : reset
            ? 'Volledige landelijke lijst laden…'
            : 'Meer bedrijven laden…',
        'loading'
      );
      const AbortControllerClass = browserWindow?.AbortController;
      const controller = typeof AbortControllerClass === 'function'
        ? new AbortControllerClass()
        : null;
      const timeoutMs = userInitiated ? USER_CONNECT_TIMEOUT_MS : AUTO_CONNECT_TIMEOUT_MS;
      const timeoutHandle = controller && typeof browserWindow?.setTimeout === 'function'
        ? browserWindow.setTimeout(() => controller.abort(), timeoutMs)
        : null;
      try {
        const response = await browserWindow.fetch(
          buildCompanyApiUrl(state.query, state.offset),
          companyFetchOptions(controller?.signal)
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestVersion !== state.requestVersion) return;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        state.rows = reset ? rows : [...state.rows, ...rows];
        state.offset += rows.length;
        if (!state.query) state.total = Math.max(0, Number(payload?.total) || state.rows.length);
        state.hasMore = Boolean(payload?.has_more) && rows.length > 0;
        state.error = false;
        state.connectionRequired = false;
      } catch {
        if (requestVersion !== state.requestVersion) return;
        const permissionState = await localNetworkPermissionState(browserWindow);
        if (requestVersion !== state.requestVersion) return;
        setConnectionRequired(permissionState);
      } finally {
        if (timeoutHandle !== null && typeof browserWindow?.clearTimeout === 'function') {
          browserWindow.clearTimeout(timeoutHandle);
        }
        if (requestVersion === state.requestVersion) {
          state.loading = false;
          renderRows();
        }
      }
    }

    searchInput.addEventListener('input', (event) => {
      state.query = String(event.target.value || '');
      browserWindow.clearTimeout(searchTimer);
      searchTimer = browserWindow.setTimeout(() => loadPage({ reset: true }), 220);
    });
    retryButton?.addEventListener('click', () => loadPage({ reset: true, userInitiated: true }));
    frame.addEventListener('scroll', () => {
      if (state.loading || !state.hasMore) return;
      if (frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 180) loadPage();
    });
    async function loadInitialPage() {
      const permissionState = await localNetworkPermissionState(browserWindow);
      if (permissionState === 'prompt' || permissionState === 'denied') {
        state.loading = false;
        setConnectionRequired(permissionState);
        renderRows();
        return;
      }
      await loadPage({ reset: true });
    }

    loadInitialPage();

    return { loadInitialPage, loadPage, renderRows, state };
  }

  function mount(browserWindow) {
    return {
      dashboard: mountDashboardLink(browserWindow),
      directory: mountDirectory(browserWindow),
    };
  }

  return {
    COMPANY_API_URL,
    DIRECTORY_PAGE_URL,
    PAGE_SIZE,
    AUTO_CONNECT_TIMEOUT_MS,
    USER_CONNECT_TIMEOUT_MS,
    buildCompanyApiUrl,
    companyFetchOptions,
    companyRowHtml,
    companyStatus,
    isTreated,
    localNetworkPermissionState,
    missingLabel,
    mount,
    mountDashboardLink,
    mountDirectory,
    navigateToDirectory,
  };
});
