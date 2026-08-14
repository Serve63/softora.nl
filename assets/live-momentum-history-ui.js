((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMomentumHistoryUi = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function calculatePlotLayout(monthCount, viewportWidth) {
    const count = Math.max(1, Number(monthCount) || 1);
    const measuredWidth = Math.max(0, Math.floor(Number(viewportWidth) || 0));
    const width = Math.max(520, measuredWidth, count > 6 ? count * 118 : 0);
    const left = 48;
    const right = 48;
    const usableWidth = width - left - right;
    const xPositions = Array.from({ length: count }, (_, index) => (
      left + (count === 1 ? usableWidth / 2 : (index / (count - 1)) * usableWidth)
    ));
    return { left, right, usableWidth, width, xPositions };
  }

  function createController(options = {}) {
    const win = options.window;
    const doc = options.document;
    const historyApi = options.historyApi;
    const trigger = doc?.querySelector?.('[data-momentum-history-trigger]');
    const dialog = doc?.querySelector?.('#momentum-history-dialog');
    const closeButton = dialog?.querySelector?.('[data-momentum-history-close]');
    const viewport = dialog?.querySelector?.('[data-momentum-history-viewport]');
    const plot = dialog?.querySelector?.('[data-momentum-history-plot]');
    const empty = dialog?.querySelector?.('[data-momentum-history-empty]');
    const summary = dialog?.querySelector?.('[data-momentum-history-summary]');
    let values = {};
    let lastFocused = null;
    let lastViewportWidth = 0;
    let resizeFrame = 0;

    if (!win || !doc || !historyApi || !trigger || !dialog || !closeButton || !viewport || !plot || !empty || !summary) {
      return null;
    }

    function render(nextValues = values, now = new Date()) {
      values = nextValues && typeof nextValues === 'object' ? nextValues : {};
      const history = historyApi.buildMonthlyAverages(values, now);
      const months = history.months.filter((month) => Number.isFinite(month.average));
      empty.hidden = months.length > 0;
      viewport.hidden = months.length === 0;
      summary.textContent = history.startDate
        ? `Vanaf ${history.startDate.split('-').reverse().join('-')} · tijdzone Europe/Amsterdam`
        : 'Nog geen duurzaam bijgehouden dag gevonden.';
      if (!months.length) {
        plot.replaceChildren();
        return history;
      }

      const viewportWidth = Math.max(0, Math.floor(Number(viewport.clientWidth) || 0));
      lastViewportWidth = viewportWidth;
      const layout = calculatePlotLayout(months.length, viewportWidth);
      const width = layout.width;
      const height = 304;
      const left = layout.left;
      const right = layout.right;
      const top = 68;
      const bottom = 56;
      const usableWidth = layout.usableWidth;
      const usableHeight = height - top - bottom;
      const xFor = (index) => layout.xPositions[index];
      const yFor = (average) => top + ((100 - Math.max(0, Math.min(100, average))) / 100) * usableHeight;
      const points = months.map((month, index) => ({ month, x: xFor(index), y: yFor(month.average) }));
      const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      const grid = [0, 25, 50, 75, 100].map((value) => {
        const y = yFor(value);
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text x="${left - 10}" y="${y + 4}">${value}%</text>`;
      }).join('');
      const labels = points.map(({ month, x }, index) => (
        `<text class="momentum-history-month-label${month.isCurrent ? ' is-current' : ''}${index === 0 ? ' is-first' : ''}${index === points.length - 1 ? ' is-last' : ''}" x="${x}" y="${height - 18}">${month.label}${month.isCurrent ? ' · tot vandaag' : ''}</text>`
      )).join('');
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `<g class="momentum-history-grid">${grid}</g><path class="momentum-history-line" d="${path}"></path>${labels}`;

      const pointLayer = doc.createElement('div');
      pointLayer.className = 'momentum-history-points';
      pointLayer.style.width = `${width}px`;
      pointLayer.style.height = `${height}px`;
      points.forEach(({ month, x, y }, index) => {
        const point = doc.createElement('button');
        const value = historyApi.formatAverage(month.average);
        point.className = `momentum-history-point${month.isCurrent ? ' is-current' : ''}${index === 0 ? ' is-first' : ''}${index === points.length - 1 ? ' is-last' : ''}`;
        point.type = 'button';
        point.style.left = `${x}px`;
        point.style.top = `${y}px`;
        point.setAttribute('aria-label', `${month.label}: ${value} gemiddeld over ${month.dayCount} dagen${month.isCurrent ? ', tot vandaag' : ''}`);
        point.innerHTML = `<span>${month.label}<strong>${value}</strong><small>${month.dayCount} dagen${month.isCurrent ? ' · tot vandaag' : ''}</small></span>`;
        pointLayer.append(point);
      });
      plot.replaceChildren(svg, pointLayer);
      return history;
    }

    function open() {
      lastFocused = doc.activeElement;
      dialog.showModal();
      doc.body.classList.add('momentum-history-open');
      render(values, new Date());
      closeButton.focus();
    }

    function scheduleResponsiveRender() {
      if (!dialog.open) return;
      const nextWidth = Math.max(0, Math.floor(Number(viewport.clientWidth) || 0));
      if (nextWidth === lastViewportWidth) return;
      const schedule = win.requestAnimationFrame || ((callback) => win.setTimeout(callback, 0));
      const cancel = win.cancelAnimationFrame || win.clearTimeout;
      if (resizeFrame) cancel?.call(win, resizeFrame);
      resizeFrame = schedule.call(win, () => {
        resizeFrame = 0;
        render(values, new Date());
      });
    }

    function close() {
      if (dialog.open) dialog.close();
    }

    trigger.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    dialog.addEventListener('pointerdown', (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('close', () => {
      doc.body.classList.remove('momentum-history-open');
      lastFocused?.focus?.();
    });
    doc.addEventListener('softora:momentum-history-state', (event) => {
      render(event.detail?.values || {}, event.detail?.now ? new Date(event.detail.now) : new Date());
    });
    const ResizeObserverClass = options.ResizeObserver || win.ResizeObserver;
    if (typeof ResizeObserverClass === 'function') {
      const observer = new ResizeObserverClass(scheduleResponsiveRender);
      observer.observe(viewport);
    }
    win.addEventListener?.('orientationchange', scheduleResponsiveRender);

    return { close, open, render, scheduleResponsiveRender };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    createController({ window, document, historyApi: window.SoftoraMomentumHistory });
  }

  return { calculatePlotLayout, createController };
});
