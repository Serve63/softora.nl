(function () {
  const root = document.querySelector('.seo-performance-main');
  if (!root) return;

  const performanceEndpoint = '/api/seo/search-console-performance';
  const auditEndpoint = '/api/seo/site-audit';
  const state = {
    days: 90,
    activeTab: 'queries',
    payload: null,
    audit: null,
    search: '',
  };

  const tableLabels = {
    queries: 'Zoekwoord',
    pages: 'Pagina',
    countries: 'Land',
    devices: 'Apparaat',
    searchAppearance: 'Zoekopmaak',
    dates: 'Dag',
  };

  const emptyLabels = {
    queries: 'Er zijn nog geen zoekopdrachten beschikbaar voor deze periode.',
    pages: 'Er zijn nog geen paginaresultaten beschikbaar voor deze periode.',
    countries: 'Er zijn nog geen landen beschikbaar voor deze periode.',
    devices: 'Er zijn nog geen apparaten beschikbaar voor deze periode.',
    searchAppearance: 'Er is nog geen zoekopmaakdata beschikbaar voor deze periode.',
    dates: 'Er zijn nog geen dagresultaten beschikbaar voor deze periode.',
  };

  const numberFormatter = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
  const compactFormatter = new Intl.NumberFormat('nl-NL', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const decimalFormatter = new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  function get(selector) {
    return root.querySelector(selector);
  }

  function getAll(selector) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value, compact = false) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return '0';
    if (compact || Math.abs(number) >= 10000) return compactFormatter.format(number);
    return numberFormatter.format(number);
  }

  function formatPercent(value) {
    const number = Number(value || 0) * 100;
    if (!Number.isFinite(number)) return '0%';
    return `${decimalFormatter.format(number)}%`;
  }

  function formatPosition(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return '-';
    return decimalFormatter.format(number);
  }

  function formatDate(value) {
    const raw = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const [year, month, day] = raw.split('-');
    return `${day}-${month}-${year}`;
  }

  function signed(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number === 0) return '0';
    return `${number > 0 ? '+' : ''}${formatNumber(number)}`;
  }

  function signedPercent(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number === 0) return '0,0%';
    return `${number > 0 ? '+' : ''}${formatPercent(number)}`;
  }

  function setMetric(key, value, subtext, trend = '') {
    const valueEl = get(`[data-seo-metric="${key}"]`);
    const subtextEl = get(`[data-seo-delta="${key}"]`);
    if (valueEl) {
      valueEl.textContent = value;
      valueEl.classList.toggle('zero', value === '0' || value === '0%' || value === '-');
    }
    if (subtextEl) {
      subtextEl.textContent = subtext || '';
      subtextEl.dataset.trend = trend;
    }
  }

  function setStatus(text, tone) {
    const textEl = get('[data-seo-last-updated]');
    const dot = get('[data-seo-performance-dot]');
    const wrap = get('[data-seo-performance-status]');
    if (textEl) textEl.textContent = text;
    if (wrap) wrap.dataset.tone = tone || 'muted';
    if (dot) dot.dataset.tone = tone || 'muted';
  }

  function renderMetrics(payload) {
    const totals = payload?.totals || {};
    const current = totals.current || {};
    const previous = totals.previous || {};
    const clicksDelta = totals.clicksDelta || 0;
    const impressionsDelta = totals.impressionsDelta || 0;
    const ctrDelta = totals.ctrDelta || 0;
    const positionDelta = totals.positionDelta || 0;

    setMetric('clicks', formatNumber(current.clicks), `${signed(clicksDelta)} vs vorige periode`, clicksDelta > 0 ? 'up' : clicksDelta < 0 ? 'down' : '');
    setMetric('impressions', formatNumber(current.impressions, true), `${signed(impressionsDelta)} vs vorige periode`, impressionsDelta > 0 ? 'up' : impressionsDelta < 0 ? 'down' : '');
    setMetric('ctr', formatPercent(current.ctr), `${signedPercent(ctrDelta)} vs vorige periode`, ctrDelta > 0 ? 'up' : ctrDelta < 0 ? 'down' : '');

    const positionCopy = Number(previous.position || 0) <= 0 && Number(current.position || 0) > 0
      ? 'Nieuwe meetperiode'
      : positionDelta === 0
        ? 'Geen positieverschuiving'
        : `${decimalFormatter.format(Math.abs(positionDelta))} positie ${positionDelta < 0 ? 'beter' : 'lager'}`;
    const positionTrend = Number(previous.position || 0) <= 0 ? '' : positionDelta < 0 ? 'up' : positionDelta > 0 ? 'down' : '';
    setMetric('position', formatPosition(current.position), positionCopy, positionTrend);
  }

  function pointSeries(rows, key, width, height, padding) {
    const values = rows.map((row) => Number(row[key] || 0));
    const max = Math.max(...values, 1);
    if (rows.length === 1) {
      const y = padding.top + height - (values[0] / max) * height;
      return `${padding.left},${y.toFixed(1)}`;
    }
    return rows
      .map((row, index) => {
        const x = padding.left + (index / Math.max(rows.length - 1, 1)) * width;
        const y = padding.top + height - (Number(row[key] || 0) / max) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  function renderChart(payload) {
    const chart = get('[data-seo-chart]');
    const axis = get('[data-seo-y-axis]');
    const label = get('[data-seo-date-label]');
    const rows = Array.isArray(payload?.rows?.dates) ? payload.rows.dates : [];
    const visibleRows = rows.slice(-30);

    if (axis) {
      const maxImpressions = Math.max(...visibleRows.map((row) => Number(row.impressions || 0)), 0);
      axis.innerHTML = [1, 0.66, 0.33, 0]
        .map((factor) => `<span class="chart-y-label">${formatNumber(maxImpressions * factor, true)}</span>`)
        .join('');
    }

    if (!chart) return;
    if (visibleRows.length === 0) {
      chart.innerHTML = [
        '<div class="grid-line" style="top:0%"></div>',
        '<div class="grid-line" style="top:33%"></div>',
        '<div class="grid-line" style="top:66%"></div>',
        '<div class="grid-line" style="top:99%"></div>',
      ].join('');
      if (label) label.textContent = 'Nog geen dagdata beschikbaar';
      return;
    }

    const padding = { left: 24, top: 12 };
    const width = 336;
    const height = 118;
    const clicks = pointSeries(visibleRows, 'clicks', width, height, padding);
    const impressions = pointSeries(visibleRows, 'impressions', width, height, padding);
    const first = formatDate(visibleRows[0].label);
    const last = formatDate(visibleRows[visibleRows.length - 1].label);

    chart.innerHTML = `
      <svg class="seo-performance-chart" viewBox="0 0 380 150" role="img" aria-label="Search Console klikken en vertoningen per dag">
        <g class="seo-performance-chart__grid">
          <line x1="24" y1="12" x2="360" y2="12"></line>
          <line x1="24" y1="51" x2="360" y2="51"></line>
          <line x1="24" y1="91" x2="360" y2="91"></line>
          <line x1="24" y1="130" x2="360" y2="130"></line>
        </g>
        <polyline class="seo-performance-chart__line seo-performance-chart__line--impressions" points="${impressions}"></polyline>
        <polyline class="seo-performance-chart__line seo-performance-chart__line--clicks" points="${clicks}"></polyline>
      </svg>`;
    if (label) label.textContent = first === last ? first : `${first} - ${last}`;
  }

  function renderOpportunities(payload) {
    const target = get('[data-seo-opportunities]');
    if (!target) return;
    const queries = Array.isArray(payload?.rows?.queries) ? payload.rows.queries : [];
    const pages = Array.isArray(payload?.rows?.pages) ? payload.rows.pages : [];
    const actions = Array.isArray(payload?.actionQueue) ? payload.actionQueue : [];
    const bestQuery = queries.slice().sort((a, b) => Number(b.clicks || 0) - Number(a.clicks || 0))[0];
    const bestPage = pages.slice().sort((a, b) => Number(b.clicks || 0) - Number(a.clicks || 0))[0];
    const quickWin = actions.find((item) => item.query) || queries
      .filter((row) => !/softora/i.test(row.label || ''))
      .filter((row) => Number(row.position || 0) > 4 && Number(row.position || 0) <= 20)
      .sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0))[0];
    const cards = [
      bestQuery && { icon: 'Q', title: bestQuery.label, meta: `${formatNumber(bestQuery.clicks)} klikken · ${formatNumber(bestQuery.impressions)} vertoningen` },
      quickWin && { icon: '↗', title: quickWin.query || quickWin.label, meta: quickWin.action || `Positie ${formatPosition(quickWin.position)} · versterk snippet en content` },
      bestPage && { icon: 'P', title: bestPage.label, meta: `Beste pagina · ${formatNumber(bestPage.clicks)} klikken · CTR ${formatPercent(bestPage.ctr)}` },
    ].filter(Boolean);

    if (cards.length === 0) {
      target.innerHTML = '<p class="health-summary">Nog niet genoeg data om betrouwbare groeikansen te berekenen.</p>';
      return;
    }
    target.innerHTML = cards.map((card) => `
      <div class="opportunity-item">
        <span class="opportunity-item__icon">${escapeHtml(card.icon)}</span>
        <div><strong title="${escapeHtml(card.title)}">${escapeHtml(card.title)}</strong><span>${escapeHtml(card.meta)}</span></div>
      </div>`).join('');
  }

  function renderActions() {
    const target = get('[data-seo-actions]');
    const count = get('[data-seo-action-count]');
    if (!target) return;
    const gscActions = Array.isArray(state.payload?.actionQueue) ? state.payload.actionQueue : [];
    const auditActions = Array.isArray(state.audit?.improvements)
      ? state.audit.improvements.map((action) => ({ priority: 'middel', action }))
      : [];
    const actions = [...gscActions, ...auditActions]
      .filter((item, index, list) => item?.action && list.findIndex((candidate) => candidate.action === item.action) === index)
      .slice(0, 5);
    if (count) count.textContent = String(actions.length);
    if (actions.length === 0) {
      target.innerHTML = '<p class="health-summary">Geen directe rode vlaggen. Blijf prestaties en indexatie volgen.</p>';
      return;
    }
    target.innerHTML = actions.map((item) => `
      <div class="action-item">
        <span class="action-priority${item.priority === 'hoog' ? '' : ' action-priority--middel'}">${escapeHtml(item.priority || 'middel')}</span>
        <p>${escapeHtml(item.action)}</p>
      </div>`).join('');
  }

  function renderAudit(audit) {
    const score = get('[data-seo-health-score]');
    const summary = get('[data-seo-health-summary]');
    const metrics = get('[data-seo-health-metrics]');
    if (!metrics) return;
    if (!audit?.ok) {
      if (score) score.textContent = '—';
      if (summary) summary.textContent = 'De technische pagina-audit kon nu niet worden geladen.';
      metrics.innerHTML = '';
      return;
    }
    state.audit = audit;
    if (score) score.textContent = String(audit.overallScore || 0);
    if (summary) {
      const pages = Number(audit.totals?.pages || 0);
      const attention = Number(audit.totals?.pagesNeedingAttention || 0);
      summary.textContent = `${pages} pagina's gecontroleerd · ${attention} vragen aandacht · score is gebaseerd op echte on-page checks.`;
    }
    metrics.innerHTML = (audit.metrics || []).slice(0, 5).map((metric) => `
      <div class="health-metric">
        <span class="health-metric__label">${escapeHtml(metric.label)}</span>
        <span class="health-metric__track"><span class="health-metric__bar" style="width:${Math.max(0, Math.min(100, Number(metric.percent || 0)))}%"></span></span>
        <span class="health-metric__value">${formatNumber(metric.percent)}%</span>
      </div>`).join('');
    renderActions();
  }

  function renderTable() {
    const body = get('[data-seo-table-body]');
    const empty = get('[data-seo-empty-state]');
    const emptyTitle = get('[data-seo-empty-title]');
    const emptySub = get('[data-seo-empty-sub]');
    const label = get('[data-seo-table-label]');
    const payload = state.payload || {};
    const sourceRows = Array.isArray(payload?.rows?.[state.activeTab]) ? payload.rows[state.activeTab] : [];
    const rows = sourceRows.filter((row) => String(row.label || '').toLowerCase().includes(state.search));

    if (label) label.textContent = tableLabels[state.activeTab] || tableLabels.queries;
    if (!body || !empty) return;

    if (!payload.connected) {
      body.innerHTML = '';
      empty.hidden = false;
      if (emptyTitle) emptyTitle.textContent = 'Search Console nog niet gekoppeld';
      if (emptySub) emptySub.textContent = payload.message || 'Koppel Search Console om live SEO-prestaties te zien.';
      return;
    }

    if (payload.status === 'error' || payload.ok === false) {
      body.innerHTML = '';
      empty.hidden = false;
      if (emptyTitle) emptyTitle.textContent = 'Search Console kon niet laden';
      if (emptySub) emptySub.textContent = payload.message || 'Probeer het straks opnieuw of controleer de koppeling.';
      return;
    }

    if (rows.length === 0) {
      body.innerHTML = '';
      empty.hidden = false;
      if (emptyTitle) emptyTitle.textContent = state.search ? 'Geen match gevonden' : 'Geen gegevens gevonden';
      if (emptySub) emptySub.textContent = state.search
        ? 'Pas het filter aan om meer resultaten te zien.'
        : emptyLabels[state.activeTab] || emptyLabels.queries;
      return;
    }

    empty.hidden = true;
    body.innerHTML = rows
      .slice(0, 25)
      .map((row) => {
        const labelText = state.activeTab === 'dates' ? formatDate(row.label) : row.label;
        return `
          <div class="table-row">
            <span class="td-query" title="${escapeHtml(labelText)}">${escapeHtml(labelText)}</span>
            <span class="td-num">${formatNumber(row.clicks)}</span>
            <span class="td-num">${formatNumber(row.impressions)}</span>
            <span class="td-num">${formatPercent(row.ctr)}</span>
            <span class="td-num">${formatPosition(row.position)}</span>
          </div>`;
      })
      .join('');
  }

  function renderPayload(payload) {
    state.payload = payload;
    renderMetrics(payload);
    renderChart(payload);
    renderOpportunities(payload);
    renderTable();
    renderActions();

    const property = get('[data-seo-property]');
    if (property && payload.siteUrl) property.textContent = String(payload.siteUrl).replace(/^sc-domain:/, '');

    if (!payload.connected) {
      setStatus('Search Console koppeling nodig', 'warning');
      return;
    }
    if (payload.status === 'error' || payload.ok === false) {
      setStatus('Search Console fout bij ophalen', 'warning');
      return;
    }
    const generatedAt = payload.generatedAt ? new Date(payload.generatedAt) : null;
    const time = generatedAt && Number.isFinite(generatedAt.getTime())
      ? generatedAt.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'net';
    setStatus(`Live bijgewerkt: ${time}`, 'good');
  }

  async function loadAudit() {
    try {
      const response = await fetch(auditEndpoint, { headers: { Accept: 'application/json' } });
      const audit = await response.json().catch(() => ({}));
      renderAudit(response.ok ? audit : { ok: false });
    } catch (_error) {
      renderAudit({ ok: false });
    }
  }

  async function loadPerformance() {
    const refreshButton = get('[data-seo-refresh]');
    setStatus('Search Console laden...', 'muted');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.classList.add('is-loading');
    }
    try {
      const response = await fetch(`${performanceEndpoint}?days=${state.days}`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        payload.connected = true;
        payload.status = 'error';
        payload.message = payload.message || payload.error || 'Search Console-data kon nu niet worden opgehaald.';
      }
      renderPayload(payload);
    } catch (_error) {
      renderPayload({
        ok: false,
        connected: true,
        status: 'error',
        message: 'Search Console-data kon nu niet worden opgehaald.',
        totals: {
          current: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
          clicksDelta: 0,
          impressionsDelta: 0,
          ctrDelta: 0,
          positionDelta: 0,
        },
        rows: {},
      });
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.classList.remove('is-loading');
      }
    }
  }

  function loadConsole() {
    loadPerformance();
    loadAudit();
  }

  getAll('[data-seo-days]').forEach((button) => {
    button.addEventListener('click', () => {
      getAll('[data-seo-days]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.days = Number(button.dataset.seoDays || 90) || 90;
      loadPerformance();
    });
  });

  getAll('[data-seo-table-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      getAll('[data-seo-table-tab]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.activeTab = button.dataset.seoTableTab || 'queries';
      renderTable();
    });
  });

  const searchInput = get('[data-seo-table-search]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.search = String(searchInput.value || '').trim().toLowerCase();
      renderTable();
    });
  }

  const refreshButton = get('[data-seo-refresh]');
  if (refreshButton) refreshButton.addEventListener('click', loadConsole);

  loadConsole();
}());
