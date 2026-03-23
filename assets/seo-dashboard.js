(() => {
  'use strict';

  const FIELD_BINDINGS = [
    ['title', 'fieldTitle'],
    ['metaDescription', 'fieldMetaDescription'],
    ['metaKeywords', 'fieldMetaKeywords'],
    ['canonical', 'fieldCanonical'],
    ['robots', 'fieldRobots'],
    ['ogTitle', 'fieldOgTitle'],
    ['ogDescription', 'fieldOgDescription'],
    ['ogImage', 'fieldOgImage'],
    ['twitterTitle', 'fieldTwitterTitle'],
    ['twitterDescription', 'fieldTwitterDescription'],
    ['twitterImage', 'fieldTwitterImage'],
    ['h1', 'fieldH1'],
  ];

  const elements = {
    status: document.getElementById('statusMessage'),
    pageSearchInput: document.getElementById('pageSearchInput'),
    pageSelect: document.getElementById('pageSelect'),
    pageList: document.getElementById('pageList'),
    form: document.getElementById('seoForm'),
    resetButton: document.getElementById('resetSeoBtn'),
    saveButton: document.getElementById('saveSeoBtn'),
    imageRows: document.getElementById('imageRows'),
  };

  for (const [, id] of FIELD_BINDINGS) {
    elements[id] = document.getElementById(id);
  }

  if (!elements.status || !elements.pageSearchInput || !elements.pageSelect || !elements.pageList || !elements.form || !elements.resetButton || !elements.saveButton || !elements.imageRows) {
    return;
  }

  const state = {
    pages: [],
    filteredPages: [],
    selectedFile: '',
    selectedPage: null,
    selectedDetail: null,
    loadingPages: false,
    loadingPage: false,
    saving: false,
  };

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function setStatus(kind, text) {
    const message = normalizeText(text);
    const cssKind = kind === 'success' || kind === 'error' ? kind : 'info';
    elements.status.textContent = message || '';
    elements.status.className = `status-message ${cssKind}${message ? ' visible' : ''}`;
  }

  function updateBusyState() {
    const busy = state.loadingPages || state.loadingPage || state.saving;
    elements.pageSearchInput.disabled = state.loadingPages || state.saving;
    elements.pageSelect.disabled = state.loadingPages || state.saving;
    elements.saveButton.disabled = busy || !state.selectedFile;
    elements.resetButton.disabled = busy || !state.selectedFile;

    for (const [, id] of FIELD_BINDINGS) {
      if (elements[id]) elements[id].disabled = busy || !state.selectedFile;
    }

    const imageInputs = elements.imageRows.querySelectorAll('input[data-role="image-alt"]');
    for (const input of imageInputs) {
      input.disabled = busy || !state.selectedFile;
    }
  }

  function getSelectedFileFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return normalizeText(params.get('file'));
  }

  function syncSelectedFileToUrl(fileName) {
    const cleanFile = normalizeText(fileName);
    const url = new URL(window.location.href);
    if (cleanFile) {
      url.searchParams.set('file', cleanFile);
    } else {
      url.searchParams.delete('file');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  function renderPageSelect() {
    elements.pageSelect.innerHTML = '';

    if (state.filteredPages.length === 0) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Geen pagina\'s gevonden';
      elements.pageSelect.appendChild(emptyOption);
      elements.pageSelect.value = '';
      return;
    }

    for (const page of state.filteredPages) {
      const option = document.createElement('option');
      option.value = page.file;
      option.textContent = `${page.path} - ${page.title || page.file}`;
      elements.pageSelect.appendChild(option);
    }

    if (state.selectedFile && state.filteredPages.some((page) => page.file === state.selectedFile)) {
      elements.pageSelect.value = state.selectedFile;
    } else {
      elements.pageSelect.value = state.filteredPages[0].file;
    }
  }

  function renderPageList() {
    elements.pageList.innerHTML = '';

    if (state.filteredPages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'page-meta';
      empty.style.padding = '0.75rem';
      empty.textContent = 'Geen pagina\'s die voldoen aan de zoekfilter.';
      elements.pageList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const page of state.filteredPages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `page-list-item${page.file === state.selectedFile ? ' active' : ''}`;
      button.dataset.file = page.file;

      const title = document.createElement('div');
      title.className = 'page-title';
      title.textContent = `${page.path} - ${page.title || page.file}`;
      button.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'page-meta';
      const pageOverrideCount = Number(page.pageOverrideCount || 0);
      const imageOverrideCount = Number(page.imageOverrideCount || 0);
      const imageCount = Number(page.imageCount || 0);
      meta.textContent = `${pageOverrideCount} meta overrides, ${imageOverrideCount} alt overrides, ${imageCount} afbeeldingen`;
      button.appendChild(meta);

      button.addEventListener('click', () => {
        void selectPage(page.file, { load: true, fromUser: true });
      });

      fragment.appendChild(button);
    }

    elements.pageList.appendChild(fragment);
  }

  function applyFilter() {
    const query = normalizeText(elements.pageSearchInput.value).toLowerCase();
    if (!query) {
      state.filteredPages = state.pages.slice();
      return;
    }

    state.filteredPages = state.pages.filter((page) => {
      const haystack = `${normalizeText(page.file)} ${normalizeText(page.path)} ${normalizeText(page.title)} ${normalizeText(page.metaDescription)}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function clearSeoFields() {
    for (const [, id] of FIELD_BINDINGS) {
      if (!elements[id]) continue;
      elements[id].value = '';
      elements[id].placeholder = '';
    }
  }

  function fillSeoFields(detail) {
    const source = detail?.seo?.source || {};
    const overrides = detail?.seo?.overrides || {};

    for (const [key, id] of FIELD_BINDINGS) {
      const input = elements[id];
      if (!input) continue;
      input.value = normalizeText(overrides[key] || '');
      input.placeholder = normalizeText(source[key] || '');
    }
  }

  function renderImageRows(detail) {
    elements.imageRows.innerHTML = '';

    const images = Array.isArray(detail?.images) ? detail.images : [];
    if (images.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'page-meta';
      cell.style.padding = '0.8rem';
      cell.textContent = 'Geen afbeeldingen gevonden op deze pagina.';
      row.appendChild(cell);
      elements.imageRows.appendChild(row);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const image of images) {
      const src = normalizeText(image?.src);
      if (!src) continue;

      const sourceAlt = normalizeText(image?.sourceAlt || '');
      const overrideAlt = normalizeText(image?.overrideAlt || '');

      const row = document.createElement('tr');
      row.dataset.src = src;

      const srcCell = document.createElement('td');
      const srcCode = document.createElement('code');
      srcCode.className = 'src-code';
      srcCode.textContent = src;
      srcCell.appendChild(srcCode);
      row.appendChild(srcCell);

      const sourceCell = document.createElement('td');
      sourceCell.textContent = sourceAlt || '-';
      row.appendChild(sourceCell);

      const overrideCell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cell-input';
      input.dataset.role = 'image-alt';
      input.dataset.src = src;
      input.value = overrideAlt;
      input.placeholder = sourceAlt || 'Geen alt in bron';
      overrideCell.appendChild(input);
      row.appendChild(overrideCell);

      fragment.appendChild(row);
    }

    if (!fragment.childNodes.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'page-meta';
      cell.style.padding = '0.8rem';
      cell.textContent = 'Geen bruikbare afbeeldingen gevonden op deze pagina.';
      row.appendChild(cell);
      elements.imageRows.appendChild(row);
      return;
    }

    elements.imageRows.appendChild(fragment);
  }

  function readPageOverridesFromForm() {
    const out = {};
    for (const [key, id] of FIELD_BINDINGS) {
      const input = elements[id];
      if (!input) continue;
      out[key] = normalizeText(input.value);
    }
    return out;
  }

  function readImageOverridesFromForm() {
    const out = {};
    const imageInputs = elements.imageRows.querySelectorAll('input[data-role="image-alt"]');
    for (const input of imageInputs) {
      const src = normalizeText(input.getAttribute('data-src'));
      if (!src) continue;
      out[src] = normalizeText(input.value);
    }
    return out;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_error) {
      data = null;
    }

    if (!response.ok) {
      const errorText = normalizeText(data?.error || data?.message || `Request mislukt (${response.status})`);
      throw new Error(errorText || 'Request mislukt');
    }

    return data || {};
  }

  async function loadPages(options = {}) {
    const preserveSelection = normalizeText(options.preserveSelection || state.selectedFile || '');
    const silent = !!options.silent;

    state.loadingPages = true;
    updateBusyState();
    if (!silent) setStatus('info', 'SEO-pagina\'s laden...');

    try {
      const data = await fetchJson('/api/seo/pages');
      state.pages = Array.isArray(data.pages) ? data.pages : [];

      applyFilter();
      renderPageSelect();

      if (preserveSelection && state.filteredPages.some((page) => page.file === preserveSelection)) {
        state.selectedFile = preserveSelection;
      } else {
        state.selectedFile = state.filteredPages[0] ? state.filteredPages[0].file : '';
      }

      state.selectedPage = state.filteredPages.find((page) => page.file === state.selectedFile) || null;
      renderPageSelect();
      renderPageList();

      if (!state.selectedFile) {
        state.selectedDetail = null;
        clearSeoFields();
        renderImageRows(null);
        setStatus('info', 'Geen pagina\'s gevonden om SEO te beheren.');
        return;
      }

      if (!options.skipSelectedPageLoad) {
        await loadPage(state.selectedFile, { silent: true });
      }

      if (!silent) {
        setStatus('success', `${state.pages.length} pagina\'s geladen. Kies een pagina om SEO te bewerken.`);
      }
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'Kon SEO-pagina\'s niet laden.'));
    } finally {
      state.loadingPages = false;
      updateBusyState();
    }
  }

  async function loadPage(fileName, options = {}) {
    const targetFile = normalizeText(fileName);
    if (!targetFile) return;

    state.loadingPage = true;
    updateBusyState();
    if (!options.silent) setStatus('info', `SEO-data laden voor ${targetFile}...`);

    try {
      const params = new URLSearchParams();
      params.set('file', targetFile);
      const data = await fetchJson(`/api/seo/page?${params.toString()}`);

      state.selectedFile = normalizeText(data.file || targetFile);
      state.selectedPage = state.pages.find((page) => page.file === state.selectedFile) || null;
      state.selectedDetail = data;

      fillSeoFields(data);
      renderImageRows(data);
      renderPageSelect();
      renderPageList();
      syncSelectedFileToUrl(state.selectedFile);

      const imageCount = Number(data.imageCount || 0);
      if (!options.silent) {
        setStatus('success', `SEO-data geladen voor ${state.selectedFile}. ${imageCount} afbeeldingen gevonden.`);
      }
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'Kon SEO-data van deze pagina niet laden.'));
    } finally {
      state.loadingPage = false;
      updateBusyState();
    }
  }

  async function selectPage(fileName, options = {}) {
    const targetFile = normalizeText(fileName);
    if (!targetFile || targetFile === state.selectedFile) return;

    state.selectedFile = targetFile;
    state.selectedPage = state.pages.find((page) => page.file === targetFile) || null;
    renderPageSelect();
    renderPageList();

    if (options.load) {
      await loadPage(targetFile, { silent: false });
    }
  }

  function onSearchInput() {
    const previousSelection = state.selectedFile;
    applyFilter();

    if (state.selectedFile && !state.filteredPages.some((page) => page.file === state.selectedFile)) {
      state.selectedFile = state.filteredPages[0] ? state.filteredPages[0].file : '';
    }

    state.selectedPage = state.filteredPages.find((page) => page.file === state.selectedFile) || null;
    renderPageSelect();
    renderPageList();

    if (!state.selectedFile) {
      clearSeoFields();
      renderImageRows(null);
      setStatus('info', 'Geen pagina\'s die voldoen aan je zoekfilter.');
      return;
    }

    if (state.selectedFile !== previousSelection) {
      void loadPage(state.selectedFile, { silent: true });
    }
  }

  async function onSave(event) {
    event.preventDefault();
    if (!state.selectedFile) {
      setStatus('error', 'Kies eerst een pagina.');
      return;
    }

    state.saving = true;
    updateBusyState();
    setStatus('info', `SEO wijzigingen opslaan voor ${state.selectedFile}...`);

    try {
      const payload = {
        file: state.selectedFile,
        pageOverrides: readPageOverridesFromForm(),
        imageAltOverrides: readImageOverridesFromForm(),
        actor: 'premium-seo-dashboard',
      };

      await fetchJson('/api/seo/page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      await loadPage(state.selectedFile, { silent: true });
      await loadPages({ silent: true, preserveSelection: state.selectedFile, skipSelectedPageLoad: true });
      renderPageSelect();
      renderPageList();

      setStatus('success', `SEO wijzigingen opgeslagen voor ${state.selectedFile}.`);
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'SEO wijzigingen opslaan mislukt.'));
    } finally {
      state.saving = false;
      updateBusyState();
    }
  }

  function onReset() {
    if (!state.selectedDetail) {
      clearSeoFields();
      renderImageRows(null);
      return;
    }

    for (const [, id] of FIELD_BINDINGS) {
      if (!elements[id]) continue;
      elements[id].value = '';
    }

    const imageInputs = elements.imageRows.querySelectorAll('input[data-role="image-alt"]');
    for (const input of imageInputs) {
      input.value = '';
    }

    setStatus('info', 'Overrides leeggemaakt in formulier. Klik op "SEO Opslaan" om dit op te slaan.');
  }

  function attachEvents() {
    elements.pageSearchInput.addEventListener('input', onSearchInput);

    elements.pageSelect.addEventListener('change', (event) => {
      const targetFile = normalizeText(event.target.value);
      if (!targetFile) return;
      void selectPage(targetFile, { load: true, fromUser: true });
    });

    elements.form.addEventListener('submit', onSave);
    elements.resetButton.addEventListener('click', onReset);
  }

  async function init() {
    attachEvents();
    updateBusyState();
    const initialFile = getSelectedFileFromUrl();
    await loadPages({ preserveSelection: initialFile });
  }

  void init();
})();
