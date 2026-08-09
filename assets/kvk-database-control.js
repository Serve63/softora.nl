(() => {
  const refreshLabel = document.getElementById('last-refresh-time');
  const fillButton = document.getElementById('database-fill-toggle');
  const fillButtonLabel = document.getElementById('database-fill-toggle-label');
  const state = {
    control: { enabled: false, workerState: 'offline', workerMessage: '', workers: {} },
    usableByPath: new Map(),
  };
  const locationNumberFormat = new Intl.NumberFormat('nl-NL');

  let observedRefreshAt = null;

  function normalizedPath(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('nl-NL');
  }

  function refreshDate() {
    const value = refreshLabel?.dataset?.refreshedAt || '';
    const date = value ? new Date(value) : observedRefreshAt;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function observeRefreshWrites() {
    if (!refreshLabel) return;
    const captureClockRefresh = () => {
      if (/^\d{2}:\d{2}$/.test(refreshLabel.textContent.trim())) {
        observedRefreshAt = new Date();
        renderRefreshAge();
      }
    };
    captureClockRefresh();
    new MutationObserver(captureClockRefresh).observe(refreshLabel, { childList: true, characterData: true, subtree: true });
  }

  function decorateLocations() {
    document.querySelectorAll('#location-list .location-button').forEach((row) => {
      const statusBoxes = row.querySelectorAll('.status-box');
      const complete = statusBoxes.length >= 3 && [...statusBoxes].slice(0, 3).every((box) => box.classList.contains('is-done'));
      row.classList.toggle('is-complete', complete);
      row.closest('.location-item')?.classList.toggle('is-complete', complete);
      if (!complete) return;
      const path = normalizedPath(row.querySelector('.location-path')?.textContent);
      const usable = state.usableByPath.get(path) ?? 0;
      const badge = row.querySelector('.badge');
      if (badge) {
        const badgeText = `${locationNumberFormat.format(usable)} bruikbaar`;
        if (badge.textContent !== badgeText) badge.textContent = badgeText;
        if (badge.title !== 'Bruikbare bedrijven') badge.title = 'Bruikbare bedrijven';
      }
    });
  }

  async function loadLocationStats() {
    try {
      const response = await fetch(`/api/kvk-database/location-stats?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload?.locations)) return;
      state.usableByPath = new Map(payload.locations.map((location) => [
        normalizedPath([location.land, location.provincie, location.gemeente, location.woonplaats].join(' | ')),
        Number(location.bruikbareBedrijven || 0),
      ]));
      decorateLocations();
    } catch {
      // De hoofdweergave blijft bruikbaar wanneer alleen de compacte locatiestatistiek tijdelijk faalt.
    }
  }

  function renderRefreshAge() {
    if (!refreshLabel) return;
    const date = refreshDate();
    if (!date) {
      refreshLabel.textContent = '-- seconden geleden';
      return;
    }
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    refreshLabel.textContent = `${seconds} ${seconds === 1 ? 'seconde' : 'seconden'} geleden`;
  }

  function renderControl() {
    if (!fillButton || !fillButtonLabel) return;
    const { enabled, workerState, workerMessage, workers = {} } = state.control;
    const running = ['starting', 'running', 'waiting'].includes(workerState);
    fillButton.classList.toggle('is-on', enabled);
    fillButton.classList.toggle('is-error', workerState === 'error');
    const statusLabel = workerState === 'error'
      ? 'FOUT'
      : enabled && workerState === 'running'
        ? 'BEZIG'
        : '';
    const accessibleStatusLabel = workerState === 'error'
      ? 'fout'
      : enabled && workerState === 'running'
        ? 'bezig'
        : enabled
          ? 'aan'
          : 'uit';
    fillButtonLabel.textContent = statusLabel;
    fillButtonLabel.hidden = !statusLabel;
    fillButton.setAttribute('aria-busy', enabled && running ? 'true' : 'false');
    fillButton.setAttribute('aria-label', `Database vullen: ${accessibleStatusLabel}. Alleen-lezen status.`);
    const workerLabels = {
      vuller: 'Vuller',
      controle: 'Controle',
      goedgekeurd: 'Goedgekeurd controle',
    };
    const laneMessage = ['vuller', 'controle', 'goedgekeurd']
      .map((key) => workers[key])
      .filter(Boolean)
      .map((worker) => `${workerLabels[worker.workerKey] || worker.workerKey}: ${worker.workerMessage || worker.workerState}`)
      .join(' • ');
    const statusMessage = laneMessage || workerMessage || `Database vullen staat ${enabled ? 'aan' : 'uit'}.`;
    fillButton.title = `Alleen-lezen status; starten en stoppen gebeurt uitsluitend via de Codex-chat. ${statusMessage}`;
  }

  async function loadControl() {
    try {
      const response = await fetch(`/api/kvk-database/control?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.control) throw new Error(payload?.error || 'Besturing niet beschikbaar.');
      state.control = payload.control;
      renderControl();
    } catch (error) {
      state.control = { ...state.control, workerState: 'error', workerMessage: error.message || String(error) };
      renderControl();
    }
  }

  document.addEventListener('kvk:refreshed', renderRefreshAge);
  const locationList = document.getElementById('location-list');
  if (locationList) new MutationObserver(decorateLocations).observe(locationList, { childList: true, subtree: true });
  window.setInterval(renderRefreshAge, 1000);
  window.setInterval(loadControl, 5_000);
  window.setInterval(loadLocationStats, 15_000);
  observeRefreshWrites();
  renderRefreshAge();
  renderControl();
  loadControl();
  loadLocationStats();
})();
