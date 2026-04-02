(() => {
  'use strict';

  const FIELD_LABELS = {
    title: 'Meta title',
    metaDescription: 'Meta description',
    metaKeywords: 'Meta keywords',
    canonical: 'Canonical URL',
    robots: 'Robots',
    ogTitle: 'OG title',
    ogDescription: 'OG description',
    ogImage: 'OG image URL',
    twitterTitle: 'Twitter title',
    twitterDescription: 'Twitter description',
    twitterImage: 'Twitter image URL',
    h1: 'H1',
  };

  const CADENCE_OPTIONS = [
    { value: 'daily', label: 'Dagelijks' },
    { value: 'weekdays', label: 'Werkdagen' },
    { value: 'three_per_week', label: '3x per week' },
    { value: 'weekly', label: 'Wekelijks' },
    { value: 'manual', label: 'Handmatig' },
  ];

  const elements = {
    status: document.getElementById('statusMessage'),
    preferredModelSelect: document.getElementById('preferredModelSelect'),
    runAuditBtn: document.getElementById('runAuditBtn'),
    optimizeBtn: document.getElementById('optimizeBtn'),
    overallScoreValue: document.getElementById('overallScoreValue'),
    pageCountValue: document.getElementById('pageCountValue'),
    attentionCountValue: document.getElementById('attentionCountValue'),
    altCoverageValue: document.getElementById('altCoverageValue'),
    auditTimestamp: document.getElementById('auditTimestamp'),
    strengthList: document.getElementById('strengthList'),
    improvementList: document.getElementById('improvementList'),
    healthBreakdown: document.getElementById('healthBreakdown'),
    auditList: document.getElementById('auditList'),
    selectedPageTitle: document.getElementById('selectedPageTitle'),
    selectedPageMeta: document.getElementById('selectedPageMeta'),
    selectedPageScore: document.getElementById('selectedPageScore'),
    pageStrengthList: document.getElementById('pageStrengthList'),
    pageImprovementList: document.getElementById('pageImprovementList'),
    pageChangeList: document.getElementById('pageChangeList'),
    pageCurrentList: document.getElementById('pageCurrentList'),
    searchConsoleStatus: document.getElementById('searchConsoleStatus'),
    analyticsStatus: document.getElementById('analyticsStatus'),
    analyticsDataState: document.getElementById('analyticsDataState'),
    scoreChart: document.getElementById('scoreChart'),
    blogAutomationToggle: document.getElementById('blogAutomationToggle'),
    blogCadenceSelect: document.getElementById('blogCadenceSelect'),
    blogModelSelect: document.getElementById('blogModelSelect'),
    blogAutoImagesToggle: document.getElementById('blogAutoImagesToggle'),
    saveAutomationBtn: document.getElementById('saveAutomationBtn'),
    automationUpdated: document.getElementById('automationUpdated'),
    recentChangesList: document.getElementById('recentChangesList'),
  };

  const requiredIds = Object.entries(elements).filter(([, value]) => !value);
  if (requiredIds.length) return;

  const state = {
    audit: null,
    selectedFile: '',
    loadingAudit: false,
    optimizing: false,
    savingAutomation: false,
    lastOptimization: null,
  };

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getSelectedFileFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return normalizeText(params.get('file'));
  }

  function syncSelectedFileToUrl(fileName) {
    const value = normalizeText(fileName);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('file', value);
    else url.searchParams.delete('file');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  function formatDateTime(valueRaw) {
    const value = normalizeText(valueRaw);
    if (!value) return 'Nog niet gedraaid';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-NL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function scoreTone(scoreRaw) {
    const score = Number(scoreRaw || 0);
    if (score >= 85) return 'good';
    if (score >= 70) return 'okay';
    return 'bad';
  }

  function setStatus(kind, text) {
    const message = normalizeText(text);
    const tone = kind === 'success' || kind === 'error' ? kind : 'info';
    elements.status.textContent = message;
    elements.status.className = `status-message ${tone}${message ? ' visible' : ''}`;
  }

  function setBusyState() {
    const busy = state.loadingAudit || state.optimizing || state.savingAutomation;
    elements.preferredModelSelect.disabled = busy;
    elements.runAuditBtn.disabled = busy;
    elements.optimizeBtn.disabled = busy || !state.audit;
    elements.blogAutomationToggle.disabled = busy;
    elements.blogCadenceSelect.disabled = busy;
    elements.blogModelSelect.disabled = busy;
    elements.blogAutoImagesToggle.disabled = busy;
    elements.saveAutomationBtn.disabled = busy || !state.audit;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
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

    if (!response.ok || data?.ok === false) {
      throw new Error(normalizeText(data?.error || data?.message || `Request mislukt (${response.status})`) || 'Request mislukt');
    }

    return data || {};
  }

  function buildEmptyMessage(text) {
    const row = document.createElement('div');
    row.className = 'empty-state';
    row.textContent = text;
    return row;
  }

  function renderBulletList(target, items, emptyText) {
    target.innerHTML = '';
    const values = toArray(items).map(normalizeText).filter(Boolean);
    if (!values.length) {
      target.appendChild(buildEmptyMessage(emptyText));
      return;
    }

    const list = document.createElement('ul');
    list.className = 'bullet-list';
    values.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    target.appendChild(list);
  }

  function renderSelectOptions(select, options, selectedValue) {
    const currentValue = normalizeText(selectedValue);
    select.innerHTML = '';
    toArray(options).forEach((optionDef) => {
      const option = document.createElement('option');
      option.value = normalizeText(optionDef?.value);
      option.textContent = normalizeText(optionDef?.label || optionDef?.value);
      select.appendChild(option);
    });

    if (currentValue && toArray(options).some((optionDef) => normalizeText(optionDef?.value) === currentValue)) {
      select.value = currentValue;
    }
  }

  function renderHealthBreakdown(metrics) {
    elements.healthBreakdown.innerHTML = '';
    const values = toArray(metrics);
    if (!values.length) {
      elements.healthBreakdown.appendChild(buildEmptyMessage('Nog geen scanresultaten beschikbaar.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    values.forEach((metric) => {
      const row = document.createElement('div');
      row.className = 'health-row';

      const label = document.createElement('div');
      label.className = 'health-row-label';
      label.textContent = normalizeText(metric?.label || metric?.key || 'SEO');
      row.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'health-row-bar';
      const fill = document.createElement('div');
      fill.className = 'health-row-fill';
      fill.style.width = `${Math.max(0, Math.min(100, Number(metric?.percent || 0)))}%`;
      bar.appendChild(fill);
      row.appendChild(bar);

      const value = document.createElement('div');
      value.className = 'health-row-value';
      const count = Number(metric?.count || 0);
      const total = Number(metric?.total || 0);
      value.textContent = total > 0 ? `${count}/${total}` : `${Math.max(0, Math.min(100, Number(metric?.percent || 0)))}%`;
      row.appendChild(value);

      fragment.appendChild(row);
    });

    elements.healthBreakdown.appendChild(fragment);
  }

  function renderScoreChart(pages) {
    elements.scoreChart.innerHTML = '';
    const values = toArray(pages).slice().sort((a, b) => Number(a.score || 0) - Number(b.score || 0)).slice(0, 8);
    if (!values.length) {
      elements.scoreChart.appendChild(buildEmptyMessage('Nog geen paginaresultaten beschikbaar.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    values.forEach((page) => {
      const row = document.createElement('div');
      row.className = 'score-chart-row';

      const label = document.createElement('div');
      label.className = 'score-chart-label';
      label.textContent = normalizeText(page?.path || page?.file || 'Pagina');
      row.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'score-chart-bar';
      const fill = document.createElement('div');
      fill.className = `score-chart-fill tone-${scoreTone(page?.score)}`;
      fill.style.width = `${Math.max(6, Math.min(100, Number(page?.score || 0)))}%`;
      bar.appendChild(fill);
      row.appendChild(bar);

      const value = document.createElement('div');
      value.className = 'score-chart-value';
      value.textContent = `${Math.max(0, Math.min(100, Number(page?.score || 0)))}`;
      row.appendChild(value);

      fragment.appendChild(row);
    });

    elements.scoreChart.appendChild(fragment);
  }

  function ensureSelectedPage() {
    const pages = toArray(state.audit?.pages);
    if (!pages.length) {
      state.selectedFile = '';
      syncSelectedFileToUrl('');
      return null;
    }

    const preferred = normalizeText(state.selectedFile || getSelectedFileFromUrl());
    const selected =
      pages.find((page) => normalizeText(page?.file) === preferred) ||
      pages[0];

    state.selectedFile = normalizeText(selected?.file);
    syncSelectedFileToUrl(state.selectedFile);
    return selected;
  }

  function renderAuditList() {
    elements.auditList.innerHTML = '';
    const pages = toArray(state.audit?.pages);
    if (!pages.length) {
      elements.auditList.appendChild(buildEmptyMessage('Nog geen paginaresultaten beschikbaar.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    pages.forEach((page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `audit-list-item${normalizeText(page?.file) === state.selectedFile ? ' active' : ''}`;
      button.dataset.file = normalizeText(page?.file);

      const header = document.createElement('div');
      header.className = 'audit-item-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'audit-item-title';
      title.textContent = normalizeText(page?.path || page?.file || 'Pagina');
      titleWrap.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.className = 'audit-item-subtitle';
      subtitle.textContent = normalizeText(page?.title || page?.topic || '');
      titleWrap.appendChild(subtitle);
      header.appendChild(titleWrap);

      const score = document.createElement('div');
      score.className = `score-pill tone-${scoreTone(page?.score)}`;
      score.textContent = `${Math.max(0, Math.min(100, Number(page?.score || 0)))}`;
      header.appendChild(score);
      button.appendChild(header);

      const meta = document.createElement('div');
      meta.className = 'audit-item-meta';
      const changeCount = Number(page?.changeCount || 0);
      const missingAltCount = Number(page?.missingAltCount || 0);
      meta.textContent = `${changeCount} AI-wijzigingen • ${missingAltCount} ontbrekende alt-teksten`;
      button.appendChild(meta);

      const note = document.createElement('div');
      note.className = 'audit-item-note';
      note.textContent = normalizeText(toArray(page?.improvements)[0] || toArray(page?.strengths)[0] || 'Geen extra notitie.');
      button.appendChild(note);

      button.addEventListener('click', () => {
        state.selectedFile = normalizeText(page?.file);
        renderAuditList();
        renderSelectedPage();
      });

      fragment.appendChild(button);
    });

    elements.auditList.appendChild(fragment);
  }

  function renderChangeList(target, page) {
    target.innerHTML = '';
    const changeFragment = document.createDocumentFragment();
    const pageOverrides = page?.suggestedPageOverrides && typeof page.suggestedPageOverrides === 'object' ? page.suggestedPageOverrides : {};
    Object.entries(pageOverrides).forEach(([key, value]) => {
      const row = document.createElement('div');
      row.className = 'change-row';

      const label = document.createElement('div');
      label.className = 'change-row-label';
      label.textContent = FIELD_LABELS[key] || key;
      row.appendChild(label);

      const body = document.createElement('div');
      body.className = 'change-row-body';
      body.textContent = normalizeText(value);
      row.appendChild(body);

      changeFragment.appendChild(row);
    });

    const imageChanges = page?.suggestedImageOverrides && typeof page.suggestedImageOverrides === 'object'
      ? Object.keys(page.suggestedImageOverrides).length
      : 0;

    if (imageChanges > 0) {
      const row = document.createElement('div');
      row.className = 'change-row';
      const label = document.createElement('div');
      label.className = 'change-row-label';
      label.textContent = 'Afbeelding alt-teksten';
      row.appendChild(label);
      const body = document.createElement('div');
      body.className = 'change-row-body';
      body.textContent = `${imageChanges} afbeelding${imageChanges === 1 ? '' : 'en'} krijgen een SEO alt-tekst.`;
      row.appendChild(body);
      changeFragment.appendChild(row);
    }

    if (!changeFragment.childNodes.length) {
      target.appendChild(buildEmptyMessage('Deze pagina staat al sterk. AI hoeft hier nu niets te wijzigen.'));
      return;
    }

    target.appendChild(changeFragment);
  }

  function renderCurrentSnapshot(target, page) {
    target.innerHTML = '';
    const current = page?.current && typeof page.current === 'object' ? page.current : {};
    const rows = [
      ['Meta title', current.title],
      ['Meta description', current.metaDescription],
      ['Canonical URL', current.canonical],
      ['H1', current.h1],
      ['Afbeeldingen', `${Number(page?.imageCount || 0)} totaal • ${Number(page?.missingAltCount || 0)} zonder alt-tekst`],
    ].filter(([, value]) => normalizeText(value));

    if (!rows.length) {
      target.appendChild(buildEmptyMessage('Nog geen SEO-basis gevonden op deze pagina.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(([labelText, valueText]) => {
      const row = document.createElement('div');
      row.className = 'snapshot-row';

      const label = document.createElement('div');
      label.className = 'snapshot-row-label';
      label.textContent = labelText;
      row.appendChild(label);

      const value = document.createElement('div');
      value.className = 'snapshot-row-value';
      value.textContent = normalizeText(valueText);
      row.appendChild(value);

      fragment.appendChild(row);
    });

    target.appendChild(fragment);
  }

  function renderSelectedPage() {
    const selected = ensureSelectedPage();
    if (!selected) {
      elements.selectedPageTitle.textContent = 'Geen pagina geselecteerd';
      elements.selectedPageMeta.textContent = 'Draai eerst een scan om paginaresultaten te zien.';
      elements.selectedPageScore.textContent = '--';
      elements.selectedPageScore.className = 'score-pill tone-bad';
      renderBulletList(elements.pageStrengthList, [], 'Nog geen sterke punten.');
      renderBulletList(elements.pageImprovementList, [], 'Nog geen verbeterpunten.');
      renderChangeList(elements.pageChangeList, null);
      renderCurrentSnapshot(elements.pageCurrentList, null);
      return;
    }

    elements.selectedPageTitle.textContent = normalizeText(selected.path || selected.file || 'Pagina');
    elements.selectedPageMeta.textContent = normalizeText(selected.title || selected.topic || '');
    elements.selectedPageScore.textContent = `${Math.max(0, Math.min(100, Number(selected.score || 0)))}/100`;
    elements.selectedPageScore.className = `score-pill tone-${scoreTone(selected.score)}`;

    renderBulletList(elements.pageStrengthList, selected.strengths, 'Nog geen sterke punten gevonden.');
    renderBulletList(elements.pageImprovementList, selected.improvements, 'Geen directe aandachtspunten.');
    renderChangeList(elements.pageChangeList, selected);
    renderCurrentSnapshot(elements.pageCurrentList, selected);
  }

  function renderAutomation(automation, modelOptions) {
    const safeAutomation = automation && typeof automation === 'object' ? automation : {};
    renderSelectOptions(elements.preferredModelSelect, modelOptions, normalizeText(safeAutomation.preferredModel || 'gpt-5.1'));
    renderSelectOptions(elements.blogModelSelect, modelOptions, normalizeText(safeAutomation.blogModel || safeAutomation.preferredModel || 'gpt-5.1'));
    renderSelectOptions(elements.blogCadenceSelect, CADENCE_OPTIONS, normalizeText(safeAutomation.blogCadence || 'weekly'));
    elements.blogAutomationToggle.checked = Boolean(safeAutomation.blogAutomationEnabled);
    elements.blogAutoImagesToggle.checked = Boolean(safeAutomation.blogAutoImages);

    elements.searchConsoleStatus.textContent = safeAutomation.searchConsoleConnected ? 'Gekoppeld' : 'Klaar voor koppeling';
    elements.searchConsoleStatus.dataset.tone = safeAutomation.searchConsoleConnected ? 'good' : 'muted';
    elements.analyticsStatus.textContent = safeAutomation.analyticsConnected ? 'Gekoppeld' : 'Klaar voor koppeling';
    elements.analyticsStatus.dataset.tone = safeAutomation.analyticsConnected ? 'good' : 'muted';
    elements.analyticsDataState.textContent = safeAutomation.analyticsConnected
      ? 'Analytics-koppeling actief. Gebruik deze ruimte voor sessies, top-pagina’s en trends.'
      : 'Live Search Console- en Analytics-grafieken verschijnen hier zodra de koppeling is geactiveerd.';
    elements.automationUpdated.textContent = `Laatste opslag: ${formatDateTime(safeAutomation.updatedAt || '')}`;
  }

  function renderRecentChanges() {
    elements.recentChangesList.innerHTML = '';
    const pages = toArray(state.lastOptimization?.changedPages);
    if (!pages.length) {
      elements.recentChangesList.appendChild(buildEmptyMessage('Nog geen sitebrede AI-optimalisatie uitgevoerd in deze sessie.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    pages.forEach((page) => {
      const row = document.createElement('div');
      row.className = 'change-row';

      const label = document.createElement('div');
      label.className = 'change-row-label';
      label.textContent = normalizeText(page?.path || page?.file || 'Pagina');
      row.appendChild(label);

      const body = document.createElement('div');
      body.className = 'change-row-body';
      body.textContent = `${Number(page?.appliedPageFieldCount || 0)} meta-velden en ${Number(page?.appliedImageAltCount || 0)} alt-teksten bijgewerkt.`;
      row.appendChild(body);

      fragment.appendChild(row);
    });

    elements.recentChangesList.appendChild(fragment);
  }

  function renderOverview(audit) {
    const totals = audit?.totals || {};
    const metrics = toArray(audit?.metrics);
    const altMetric = metrics.find((item) => normalizeText(item?.key) === 'image_alt') || {};

    elements.overallScoreValue.textContent = `${Math.max(0, Math.min(100, Number(audit?.overallScore || 0)))}`;
    elements.pageCountValue.textContent = `${Number(totals.pages || 0)}`;
    elements.attentionCountValue.textContent = `${Number(totals.pagesNeedingAttention || 0)}`;
    elements.altCoverageValue.textContent = `${Math.max(0, Math.min(100, Number(altMetric?.percent || 0)))}%`;
    elements.auditTimestamp.textContent = `Laatst gescand: ${formatDateTime(audit?.auditedAt || '')}`;

    renderBulletList(elements.strengthList, audit?.strengths, 'Nog geen duidelijke pluspunten gevonden.');
    renderBulletList(elements.improvementList, audit?.improvements, 'Geen concrete verbeterpunten.');
    renderHealthBreakdown(metrics);
    renderScoreChart(audit?.pages);
  }

  async function loadAudit(options = {}) {
    state.loadingAudit = true;
    setBusyState();
    if (!options.silent) setStatus('info', 'Volledige SEO-scan laden...');

    try {
      const audit = await fetchJson('/api/seo/site-audit');
      state.audit = audit;
      if (!state.selectedFile) state.selectedFile = getSelectedFileFromUrl();
      renderOverview(audit);
      renderAutomation(audit.automation, audit.modelOptions);
      renderAuditList();
      renderSelectedPage();
      renderRecentChanges();
      if (!options.silent) {
        setStatus('success', `${Number(audit?.totals?.pages || 0)} pagina's gescand. Overzicht is bijgewerkt.`);
      }
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'Kon de SEO-scan niet laden.'));
    } finally {
      state.loadingAudit = false;
      setBusyState();
    }
  }

  async function optimizeSite() {
    state.optimizing = true;
    setBusyState();
    setStatus('info', 'AI optimaliseert nu de volledige website...');

    try {
      const response = await fetchJson('/api/seo/site-optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: normalizeText(elements.preferredModelSelect.value || 'gpt-5.1'),
          actor: 'premium-seo-dashboard',
        }),
      });

      state.lastOptimization = response;
      state.audit = response.audit || state.audit;
      renderOverview(state.audit);
      renderAutomation(state.audit?.automation, state.audit?.modelOptions);
      renderAuditList();
      renderSelectedPage();
      renderRecentChanges();

      const message = normalizeText(response?.message || '') || 'SEO-optimalisatie voltooid.';
      setStatus('success', message);
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'Kon de AI optimalisatie niet uitvoeren.'));
    } finally {
      state.optimizing = false;
      setBusyState();
    }
  }

  async function saveAutomation() {
    state.savingAutomation = true;
    setBusyState();
    setStatus('info', 'SEO-automatisering wordt opgeslagen...');

    try {
      const response = await fetchJson('/api/seo/automation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferredModel: normalizeText(elements.preferredModelSelect.value || 'gpt-5.1'),
          blogAutomationEnabled: elements.blogAutomationToggle.checked,
          blogCadence: normalizeText(elements.blogCadenceSelect.value || 'weekly'),
          blogModel: normalizeText(elements.blogModelSelect.value || 'gpt-5.1'),
          blogAutoImages: elements.blogAutoImagesToggle.checked,
          actor: 'premium-seo-dashboard',
        }),
      });

      if (state.audit) {
        state.audit.automation = response.automation || state.audit.automation;
        state.audit.modelOptions = response.modelOptions || state.audit.modelOptions;
      }
      renderAutomation(response.automation, response.modelOptions || state.audit?.modelOptions);
      setStatus('success', 'SEO-automatisering opgeslagen.');
    } catch (error) {
      setStatus('error', normalizeText(error?.message || 'Kon de automatisering niet opslaan.'));
    } finally {
      state.savingAutomation = false;
      setBusyState();
    }
  }

  function attachEvents() {
    elements.runAuditBtn.addEventListener('click', () => {
      void loadAudit();
    });

    elements.optimizeBtn.addEventListener('click', () => {
      void optimizeSite();
    });

    elements.saveAutomationBtn.addEventListener('click', () => {
      void saveAutomation();
    });
  }

  async function init() {
    attachEvents();
    setBusyState();
    await loadAudit();
  }

  void init();
})();
