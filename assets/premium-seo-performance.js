(function () {
  const root = document.querySelector('.seo-performance-main');
  if (!root) return;

  const performanceEndpoint = '/api/seo/search-console-performance';
  const auditEndpoint = '/api/seo/site-audit';
  const state = {
    days: 28,
    chartMetric: 'clicks',
    page: 0,
    sort: 'clicks',
    loading: true,
    activeTab: 'queries',
    payload: null,
    audit: null,
    search: '',
  };

  const pageSize = 8;
  let performanceRequest = 0;

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
    if (!payload?.connected || payload.status === 'error' || payload.ok === false) {
      ['clicks', 'impressions', 'ctr', 'position'].forEach((key) => {
        setMetric(key, '—', state.loading ? 'Wordt geladen' : 'Niet beschikbaar');
      });
      return;
    }
    const totals = payload?.totals || {};
    const current = totals.current || {};
    const previous = totals.previous || {};
    const clicksDelta = totals.clicksDelta || 0;
    const impressionsDelta = totals.impressionsDelta || 0;
    const ctrDelta = totals.ctrDelta || 0;
    const positionDelta = totals.positionDelta || 0;

    setMetric('clicks', formatNumber(current.clicks), `${signed(clicksDelta)} vs vorige periode`, clicksDelta > 0 ? 'up' : clicksDelta < 0 ? 'down' : '');
    setMetric('impressions', formatNumber(current.impressions, true), `${signed(impressionsDelta)} vs vorige periode`, impressionsDelta > 0 ? 'up' : impressionsDelta < 0 ? 'down' : '');
    setMetric('ctr', formatPercent(current.ctr), `${signedPercent(ctrDelta).replace('%', ' pp')} vs vorige periode`, ctrDelta > 0 ? 'up' : ctrDelta < 0 ? 'down' : '');

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
    const key = state.chartMetric;
    const metricName = key === 'clicks' ? 'Klikken' : 'Vertoningen';
    const caption = get('[data-seo-chart-caption]');
    if (caption) caption.textContent = `${metricName} per dag`;
    if (!chart) return;
    if (rows.length === 0) {
      if (axis) axis.innerHTML = '';
      chart.innerHTML = `<div class="seo-chart-empty">${state.loading ? 'Grafiek wordt geladen' : 'Geen dagdata beschikbaar'}</div>`;
      if (label) label.textContent = state.loading ? 'Geselecteerde periode wordt geladen' : 'Nog geen dagdata beschikbaar';
      return;
    }
    const maximum = Math.max(...rows.map((row) => Number(row[key] || 0)), 1);
    if (axis) axis.innerHTML = [1, 0.66, 0.33, 0].map((factor) => `<span class="chart-y-label">${formatNumber(maximum * factor, true)}</span>`).join('');
    const points = pointSeries(rows, key, 594, 166, { left: 3, top: 2 });
    const [lastX, lastY] = points.split(' ').pop().split(',');
    chart.innerHTML = `
      <svg class="seo-performance-chart" viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label="Search Console ${metricName.toLowerCase()} per dag">
        <g class="seo-performance-chart__grid"><line x1="0" y1="2" x2="600" y2="2"></line><line x1="0" y1="57" x2="600" y2="57"></line><line x1="0" y1="112" x2="600" y2="112"></line><line x1="0" y1="168" x2="600" y2="168"></line></g>
        <polyline class="seo-performance-chart__line seo-performance-chart__line--${key}" points="${points}"></polyline>
        <circle class="seo-performance-chart__line seo-performance-chart__line--${key}" cx="${lastX}" cy="${lastY}" r="2.5"></circle>
      </svg>`;
    const first = formatDate(rows[0].label);
    const last = formatDate(rows[rows.length - 1].label);
    if (label) label.textContent = first === last ? first : `${first} – ${last}`;
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
      .filter((item, index, list) => item?.action && list.findIndex((candidate) => candidate.action === item.action) === index);
    if (count) count.textContent = actions.length ? String(actions.length) : '—';
    if (actions.length === 0) {
      target.innerHTML = `<p class="health-summary">${state.loading ? 'Acties worden opgehaald.' : 'Geen actiegegevens beschikbaar. Bekijk de datastatus voordat je conclusies trekt.'}</p>`;
      return;
    }
    const itemHtml = (item) => `
      <div class="action-item">
        <span class="action-priority${item.priority === 'hoog' ? '' : ' action-priority--middel'}">${escapeHtml(item.priority || 'middel')}</span>
        <p>${escapeHtml(item.action)}</p>
      </div>`;
    target.innerHTML = actions.slice(0, 3).map(itemHtml).join('') + (actions.length > 3
      ? `<details class="seo-more-actions"><summary>Meer prioriteiten (${actions.length - 3})</summary>${actions.slice(3).map(itemHtml).join('')}</details>` : '');
  }

  function renderAudit(audit) {
    const score = get('[data-seo-health-score]');
    const summary = get('[data-seo-health-summary]');
    const metrics = get('[data-seo-health-metrics]');
    if (!metrics) return;
    if (!audit?.ok) {
      state.audit = null;
      if (score) score.textContent = '—';
      if (summary) summary.textContent = 'De technische pagina-audit kon nu niet worden geladen.';
      metrics.innerHTML = '';
      renderActions();
      return;
    }
    state.audit = audit;
    if (score) score.textContent = String(audit.overallScore || 0);
    if (summary) {
      const pages = Number(audit.totals?.pages || 0);
      const attention = Number(audit.totals?.pagesNeedingAttention || 0);
      summary.textContent = `${pages} pagina’s gecontroleerd. ${attention} pagina’s vragen aandacht.`;
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
    const rows = sourceRows.filter((row) => String(row.label || '').toLowerCase().includes(state.search)).slice().sort((a, b) => {
      const value = (row) => state.sort === 'position' ? (Number(row.position) > 0 ? Number(row.position) : Infinity) : Number(row[state.sort] || 0);
      const difference = state.sort === 'position' ? value(a) - value(b) : value(b) - value(a);
      return difference || Number(b.impressions || 0) - Number(a.impressions || 0) || String(a.label).localeCompare(String(b.label), 'nl');
    });
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    const start = state.page * pageSize;
    const count = get('[data-seo-table-count]');
    if (count) count.textContent = state.loading ? 'Resultaten worden geladen' : rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} van ${rows.length} resultaten` : 'Geen resultaten';
    const prev = get('[data-seo-table-prev]');
    const next = get('[data-seo-table-next]');
    if (prev) prev.disabled = state.loading || state.page === 0;
    if (next) next.disabled = state.loading || start + pageSize >= rows.length;

    if (label) label.textContent = tableLabels[state.activeTab] || tableLabels.queries;
    if (!body || !empty) return;

    if (state.loading) {
      body.innerHTML = '';
      empty.hidden = false;
      if (emptyTitle) emptyTitle.textContent = 'Search Console wordt geladen';
      if (emptySub) emptySub.textContent = 'Je resultaten worden opgehaald.';
      return;
    }
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
      .slice(start, start + pageSize)
      .map((row) => {
        const labelText = state.activeTab === 'dates' ? formatDate(row.label) : row.label;
        let content = escapeHtml(labelText);
        if (state.activeTab === 'pages') {
          try {
            const url = new URL(row.label, 'https://www.softora.nl');
            if (['https://www.softora.nl', 'https://softora.nl'].includes(url.origin)) {
              content = `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url.pathname === '/' ? 'Homepage' : url.pathname)}</a>`;
            }
          } catch (_) { /* Keep an invalid page label as text. */ }
        }
        return `<tr><td title="${escapeHtml(labelText)}">${content}</td><td>${formatNumber(row.clicks)}</td><td>${formatNumber(row.impressions)}</td><td>${formatPercent(row.ctr)}</td><td>${formatPosition(row.position)}</td></tr>`;
      })
      .join('');
  }

  function renderPayload(payload) {
    state.loading = false;
    state.payload = payload;
    root.setAttribute('aria-busy', 'false');
    const window = payload?.dateWindows?.current;
    const period = get('[data-seo-period-label]');
    if (period) period.textContent = window?.startDate && window?.endDate
      ? `${formatDate(window.startDate)} – ${formatDate(window.endDate)}` : 'Periode niet beschikbaar';
    renderMetrics(payload);
    renderChart(payload);
    renderOpportunities(payload);
    renderTable();
    renderActions();

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
    setStatus(`Opgehaald: ${time}`, 'good');
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
    const request = ++performanceRequest;
    state.loading = true;
    state.payload = null;
    state.page = 0;
    root.setAttribute('aria-busy', 'true');
    setStatus('Search Console laden...', 'muted');
    const period = get('[data-seo-period-label]');
    if (period) period.textContent = 'Geselecteerde periode wordt geladen';
    renderMetrics(null);
    renderChart(null);
    renderTable();
    renderOpportunities(null);
    renderActions();
    try {
      const response = await fetch(`${performanceEndpoint}?days=${state.days}`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (request !== performanceRequest) return;
      if (!response.ok) {
        payload.connected = true;
        payload.status = 'error';
        payload.message = payload.message || payload.error || 'Search Console-data kon nu niet worden opgehaald.';
      }
      renderPayload(payload);
    } catch (_error) {
      if (request !== performanceRequest) return;
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
    }
  }

  function loadConsole() {
    loadPerformance();
    loadAudit();
  }

  getAll('[data-seo-days]').forEach((button) => {
    button.addEventListener('click', () => {
      getAll('[data-seo-days]').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      state.days = Number(button.dataset.seoDays || 28) || 28;
      loadPerformance();
    });
  });

  getAll('[data-seo-table-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      getAll('[data-seo-table-tab]').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      state.page = 0;
      state.activeTab = button.dataset.seoTableTab || 'queries';
      renderTable();
    });
  });

  const searchInput = get('[data-seo-table-search]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.page = 0;
      state.search = String(searchInput.value || '').trim().toLowerCase();
      renderTable();
    });
  }

  getAll('[data-seo-chart-metric]').forEach((button) => button.addEventListener('click', () => {
    state.chartMetric = button.dataset.seoChartMetric;
    getAll('[data-seo-chart-metric]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderChart(state.payload);
  }));
  const sort = get('[data-seo-table-sort]');
  if (sort) sort.addEventListener('change', () => { state.sort = sort.value; state.page = 0; renderTable(); });
  const prev = get('[data-seo-table-prev]');
  const next = get('[data-seo-table-next]');
  if (prev) prev.addEventListener('click', () => { state.page = Math.max(0, state.page - 1); renderTable(); });
  if (next) next.addEventListener('click', () => { state.page += 1; renderTable(); });

  loadConsole();
}());
