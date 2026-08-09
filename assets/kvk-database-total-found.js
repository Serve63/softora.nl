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

  const COMPANY_API_URL = '/api/kvk-database/company-directory';
  const DIRECTORY_PAGE_URL = '/kvk-database-bedrijven';
  const DIRECTORY_CONTENT_PAGE_URL = '/premium-kvk-company-directory';
  const SIDEBAR_CONTENT_PARAM = 'softora_sidebar_content';
  const PAGE_SIZE = 100;
  const REQUEST_TIMEOUT_MS = 30000;
  const DIRECTORY_CATEGORIES = Object.freeze({
    all: {
      title: 'Alle gevonden bedrijven',
      intro: 'Eén doorlopende lijst met bekende gegevens en de status van ieder bedrijf.',
      totalLabel: 'Totaal gevonden',
      loadingLabel: 'Volledige landelijke lijst laden…',
    },
    behandeld: {
      title: 'Alle behandelde bedrijven',
      intro: 'Alle bedrijven waarvoor de Searcher een eindstatus heeft bepaald.',
      totalLabel: 'Totaal behandeld',
      loadingLabel: 'Behandelde bedrijven laden…',
    },
    'succesvol-gevonden': {
      title: 'Succesvol gevonden bedrijven',
      intro: 'Alle bedrijven die succesvol als bruikbare kandidaat zijn gevonden.',
      totalLabel: 'Succesvol gevonden',
      loadingLabel: 'Succesvol gevonden bedrijven laden…',
    },
    bruikbaar: {
      title: 'Bruikbare bedrijven',
      intro: 'Alle volledig gecontroleerde bedrijven die klaarstaan voor de Premium Database.',
      totalLabel: 'Bruikbaar',
      loadingLabel: 'Bruikbare bedrijven laden…',
    },
    'met-website': {
      title: 'Bedrijven met website',
      intro: 'Alle bruikbare bedrijven met een bevestigde werkende website.',
      totalLabel: 'Mét website',
      loadingLabel: 'Bedrijven met website laden…',
    },
    'zonder-werkende-website': {
      title: 'Bedrijven zonder werkende website',
      intro: 'Alle bruikbare bedrijven zonder gevonden werkende website.',
      totalLabel: 'Zonder werkende website',
      loadingLabel: 'Bedrijven zonder werkende website laden…',
    },
    controle: {
      title: 'Bedrijven in controle',
      intro: 'Alle afgekeurde bedrijven die nog één volledige controle krijgen.',
      totalLabel: 'Controle',
      loadingLabel: 'Controlelijst laden…',
    },
    definitief: {
      title: 'Definitief afgekeurde bedrijven',
      intro: 'Alle bedrijven die na de tweede controle definitief zijn afgekeurd.',
      totalLabel: 'Definitief',
      loadingLabel: 'Definitieve afwijzingen laden…',
    },
  });
  const DASHBOARD_DIRECTORY_BUTTONS = Object.freeze({
    'companies-total-open': 'all',
    'companies-treated-open': 'behandeld',
    'companies-successful-found-open': 'succesvol-gevonden',
    'companies-usable-open': 'bruikbaar',
    'companies-with-website-open': 'met-website',
    'companies-without-website-open': 'zonder-werkende-website',
    'companies-control-open': 'controle',
    'companies-definitive-open': 'definitief',
  });
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

  function normalizeDirectoryCategory(value) {
    const category = String(value || '').trim().toLowerCase();
    return DIRECTORY_CATEGORIES[category] ? category : 'all';
  }

  function selectedDirectoryCategory(browserWindow) {
    const params = new URLSearchParams(String(browserWindow?.location?.search || ''));
    return normalizeDirectoryCategory(params.get('categorie'));
  }

  function directoryPageUrl(category = 'all') {
    const normalizedCategory = normalizeDirectoryCategory(category);
    return normalizedCategory === 'all'
      ? DIRECTORY_PAGE_URL
      : `${DIRECTORY_PAGE_URL}?categorie=${encodeURIComponent(normalizedCategory)}`;
  }

  function directoryContentPageUrl(category = 'all') {
    const params = new URLSearchParams({ [SIDEBAR_CONTENT_PARAM]: '1' });
    const normalizedCategory = normalizeDirectoryCategory(category);
    if (normalizedCategory !== 'all') params.set('categorie', normalizedCategory);
    return `${DIRECTORY_CONTENT_PAGE_URL}?${params.toString()}`;
  }

  function isSidebarContentFrame(browserWindow) {
    if (!browserWindow?.top || browserWindow.top === browserWindow) return false;
    const params = new URLSearchParams(String(browserWindow?.location?.search || ''));
    return params.get(SIDEBAR_CONTENT_PARAM) === '1';
  }

  function buildCompanyApiUrl(query, cursor, category = 'all') {
    const params = new URLSearchParams({
      q: String(query || '').trim(),
      limit: String(PAGE_SIZE),
      after: String(Math.max(0, Number(cursor) || 0)),
      categorie: normalizeDirectoryCategory(category),
    });
    return `${COMPANY_API_URL}?${params.toString()}`;
  }

  function companyFetchOptions(signal) {
    const options = {
      cache: 'no-store',
      credentials: 'same-origin',
    };
    if (signal) options.signal = signal;
    return options;
  }

  function navigateToDirectory(browserWindow, category = 'all') {
    if (isSidebarContentFrame(browserWindow)) {
      browserWindow.location?.assign(directoryContentPageUrl(category));
      return;
    }
    const targetWindow = browserWindow?.top && browserWindow.top !== browserWindow
      ? browserWindow.top
      : browserWindow;
    targetWindow?.location?.assign(directoryPageUrl(category));
  }

  function mountDashboardLink(browserWindow) {
    const document = browserWindow?.document;
    if (!document) return null;
    const mounted = [];
    for (const [buttonId, category] of Object.entries(DASHBOARD_DIRECTORY_BUTTONS)) {
      const openButton = document.getElementById(buttonId);
      if (!openButton) continue;
      const openDirectory = () => navigateToDirectory(browserWindow, category);
      openButton.addEventListener('click', openDirectory);
      mounted.push({ buttonId, category, openDirectory });
    }
    return mounted.length ? { mounted } : null;
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
    const title = document?.getElementById('company-directory-title');
    const intro = document?.getElementById('company-directory-intro');
    const totalLabel = document?.getElementById('company-directory-total-label');
    if (!page || !frame || !head || !body || !searchInput || !sourceStatus || !totalCount) return null;

    const category = selectedDirectoryCategory(browserWindow);
    const categoryConfig = DIRECTORY_CATEGORIES[category];
    if (title) title.textContent = categoryConfig.title;
    if (intro) intro.textContent = categoryConfig.intro;
    if (totalLabel) totalLabel.textContent = categoryConfig.totalLabel;
    document.title = `Softora Database | ${categoryConfig.title}`;
    page.dataset.category = category;

    const state = {
      rows: [],
      cursor: 0,
      total: 0,
      hasMore: true,
      loading: false,
      error: false,
      errorMessage: '',
      query: '',
      category,
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
      } else if (state.error) {
        body.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(state.errorMessage || 'Online bedrijvendatabase niet bereikbaar.')}</td></tr>`;
      } else if (!state.loading) {
        body.innerHTML = `<tr class="empty-row"><td colspan="7">${state.query ? 'Geen bedrijven gevonden.' : `Nog geen bedrijven in ${escapeHtml(categoryConfig.totalLabel.toLowerCase())}.`}</td></tr>`;
      }
      totalCount.textContent = state.error ? '—' : numberFormat.format(state.total);
      if (!state.loading && !state.error) {
        if (retryButton) retryButton.hidden = true;
        setSourceStatus('', 'ready');
      }
    }

    function setServiceUnavailable() {
      state.hasMore = false;
      state.rows = [];
      state.error = true;
      state.errorMessage = 'Online bedrijvendatabase is tijdelijk niet bereikbaar. Probeer opnieuw.';
      setSourceStatus(state.errorMessage, 'error');
      if (retryButton) retryButton.hidden = false;
    }

    async function loadPage({ reset = false } = {}) {
      if (!reset && (state.loading || !state.hasMore)) return;
      if (reset) {
        state.rows = [];
        state.cursor = 0;
        if (!state.query) state.total = 0;
        state.hasMore = true;
        state.error = false;
        state.errorMessage = '';
        state.requestVersion += 1;
      }
      const requestVersion = state.requestVersion;
      state.loading = true;
      if (retryButton) retryButton.hidden = true;
      setSourceStatus(
        reset ? categoryConfig.loadingLabel : 'Meer bedrijven laden…',
        'loading'
      );
      const AbortControllerClass = browserWindow?.AbortController;
      const controller = typeof AbortControllerClass === 'function'
        ? new AbortControllerClass()
        : null;
      const timeoutHandle = controller && typeof browserWindow?.setTimeout === 'function'
        ? browserWindow.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        : null;
      try {
        const response = await browserWindow.fetch(
          buildCompanyApiUrl(state.query, state.cursor, state.category),
          companyFetchOptions(controller?.signal)
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestVersion !== state.requestVersion) return;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        state.rows = reset ? rows : [...state.rows, ...rows];
        state.cursor = Math.max(0, Number(payload?.next_cursor) || 0);
        if (!state.query) state.total = Math.max(0, Number(payload?.total) || state.rows.length);
        state.hasMore = Boolean(payload?.has_more) && rows.length > 0;
        state.error = false;
      } catch {
        if (requestVersion !== state.requestVersion) return;
        setServiceUnavailable();
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
    retryButton?.addEventListener('click', () => loadPage({ reset: true }));
    frame.addEventListener('scroll', () => {
      if (state.loading || !state.hasMore) return;
      if (frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 180) loadPage();
    });
    async function loadInitialPage() {
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
    DASHBOARD_DIRECTORY_BUTTONS,
    DIRECTORY_CATEGORIES,
    DIRECTORY_CONTENT_PAGE_URL,
    DIRECTORY_PAGE_URL,
    PAGE_SIZE,
    REQUEST_TIMEOUT_MS,
    buildCompanyApiUrl,
    companyFetchOptions,
    companyRowHtml,
    companyStatus,
    directoryContentPageUrl,
    directoryPageUrl,
    isSidebarContentFrame,
    isTreated,
    missingLabel,
    mount,
    mountDashboardLink,
    mountDirectory,
    navigateToDirectory,
    normalizeDirectoryCategory,
    selectedDirectoryCategory,
  };
});
