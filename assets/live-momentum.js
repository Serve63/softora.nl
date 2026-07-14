(() => {
  const STATE_SCOPE = 'premium_live_momentum';
  const STATE_KEY = 'softora_live_momentum_state_v1';
  const STATE_VERSION = 1;
  const PERIOD_KEY = '2026-07';
  const MAX_GOALS = 24;
  const MAX_LABEL_LENGTH = 80;
  const SAVE_DEBOUNCE_MS = 250;
  const PERIOD = { label: 'Juli 2026', shortLabel: 'Jul', startDay: 13, today: 13, lastDay: 31 };
  const DAYS = Array.from({ length: PERIOD.lastDay }, (_, index) => index + 1);
  const TOTAL_DAYS = DAYS.length;
  const TODAY = PERIOD.today;
  const CHART_MAX_HEIGHT = 164;
  const DEFAULT_GOALS = [
    { id: 'workout', label: 'Workout', icon: '<path d="M5 8v8M19 8v8M3 10v4M21 10v4M7 12h10" />', doneDays: [TODAY] },
    { id: 'deep-work', label: '90 min deep work', icon: '<path d="M4 5.5c2.5-1 4.5-.7 7 1v12c-2.5-1.7-5-1.9-7-1V5.5Zm16 0c-2.5-1-4.5-.7-7 1v12c2.5-1.7 5-1.9 7-1V5.5Z" />', doneDays: [TODAY] },
    { id: 'daily-goal', label: 'Dagdoel behalen', icon: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m15 9 4-4M19 5h-4v4" />', doneDays: [TODAY] },
    { id: 'healthy-food', label: 'Gezonde voeding', icon: '<path d="M20.4 5.9a5.1 5.1 0 0 0-7.2 0L12 7.1l-1.2-1.2a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-7.9a5.1 5.1 0 0 0 0-7.2Z" />', doneDays: [TODAY] }
  ];
  const grid = document.querySelector('.habit-grid');
  const chart = document.querySelector('.bar-chart');
  const scoreValue = document.querySelector('.today-score strong');
  const todayScore = document.querySelector('.today-score');
  const srSummary = document.querySelector('.chart-card .sr-only');
  const chartSwitches = Array.from(document.querySelectorAll('.chart-switch'));
  let chartMode = 'bars';
  let stateReady = false;
  let stateDirty = false;
  let saveTimer = null;
  let writeInFlight = false;
  if (!grid || !chart || !scoreValue || !chartSwitches.length) {
    return;
  }
  grid.style.setProperty('--day-count', String(TOTAL_DAYS));
  chart.style.setProperty('--day-count', String(TOTAL_DAYS));
  const getChartBars = () => Array.from(chart.querySelectorAll('.bar-wrap'));
  const getGoalRows = () => Array.from(grid.querySelectorAll('.habit-name'));
  const getLabels = () => Array.from(grid.querySelectorAll('.habit-label'));
  const getStatusCells = () => Array.from(grid.querySelectorAll('.status'));
  const getDay = (cell) => Number(cell.dataset.day || 0);
  const getLabelText = (index) => getLabels()[index]?.textContent.trim() || `Taak ${index + 1}`;
  const isChecked = (cell) => cell.classList.contains('is-done');
  const isTracked = (cell) => !cell.classList.contains('is-untracked');
  const formatDay = (day) => `${day} juli`;
  const getDefaultGoal = (id) => DEFAULT_GOALS.find((goal) => goal.id === id);
  const getDefaultTrackedDays = () => DAYS.filter((day) => day >= PERIOD.startDay);
  function sanitizeDayList(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= PERIOD.lastDay)))
      .sort((left, right) => left - right);
  }
  function normalizeGoal(goal, index) {
    const fallback = DEFAULT_GOALS[index] || {};
    const rawId = String(goal?.id || fallback.id || `goal-${index + 1}`).trim();
    const id = rawId.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || `goal-${index + 1}`;
    const label = String(goal?.label || fallback.label || `Doel ${index + 1}`).trim().slice(0, MAX_LABEL_LENGTH) || `Doel ${index + 1}`;
    const defaultGoal = getDefaultGoal(id);
    const trackedDays = sanitizeDayList(goal?.trackedDays);
    const normalizedTrackedDays = trackedDays.length
      ? trackedDays
      : defaultGoal
        ? getDefaultTrackedDays()
        : DAYS.filter((day) => day >= TODAY);
    return {
      id,
      label,
      icon: defaultGoal?.icon || '<path d="M12 5v14M5 12h14" />',
      doneDays: sanitizeDayList(goal?.doneDays).filter((day) => normalizedTrackedDays.includes(day)),
      trackedDays: normalizedTrackedDays
    };
  }
  function getDefaultGoals() {
    return DEFAULT_GOALS.map((goal, index) => normalizeGoal({
      ...goal,
      trackedDays: getDefaultTrackedDays()
    }, index));
  }
  function createGoalId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `goal-${window.crypto.randomUUID()}`;
    }
    return `goal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function getCurrentGoals() {
    const statusCells = getStatusCells();
    return getGoalRows().slice(0, MAX_GOALS).map((row, index) => {
      const cells = statusCells.slice(index * TOTAL_DAYS, (index + 1) * TOTAL_DAYS);
      const defaultGoal = getDefaultGoal(row.dataset.goalId);
      return normalizeGoal({
        id: row.dataset.goalId,
        label: row.querySelector('.habit-label')?.textContent || '',
        icon: defaultGoal?.icon,
        doneDays: cells.filter(isChecked).map(getDay),
        trackedDays: cells.filter(isTracked).map(getDay)
      }, index);
    });
  }
  function buildStateSnapshot() {
    return {
      version: STATE_VERSION,
      period: PERIOD_KEY,
      chartMode,
      goals: getCurrentGoals().map((goal) => ({
        id: goal.id,
        label: goal.label,
        doneDays: goal.doneDays,
        trackedDays: goal.trackedDays
      })),
      updatedAt: new Date().toISOString()
    };
  }
  function parseStoredState(rawValue) {
    if (!rawValue) {
      return null;
    }
    try {
      const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      if (!parsed || parsed.version !== STATE_VERSION || parsed.period !== PERIOD_KEY || !Array.isArray(parsed.goals)) {
        return null;
      }
      const goals = parsed.goals.slice(0, MAX_GOALS).map(normalizeGoal);
      if (!goals.length) {
        return null;
      }
      return {
        chartMode: ['bars', 'line'].includes(parsed.chartMode) ? parsed.chartMode : 'bars',
        goals
      };
    } catch (error) {
      console.warn('[LiveMomentum][state-parse]', error?.message || error);
      return null;
    }
  }
  function setPersistenceState(state) {
    document.body.dataset.momentumPersistence = state;
  }
  async function writeState(options = {}) {
    const uiStateClient = window.SoftoraUiStateClient;
    if (!stateReady || !stateDirty || writeInFlight || !uiStateClient || typeof uiStateClient.set !== 'function') {
      return;
    }
    stateDirty = false;
    writeInFlight = true;
    let writeSucceeded = false;
    setPersistenceState('saving');
    const snapshot = buildStateSnapshot();
    try {
      const response = await uiStateClient.set(STATE_SCOPE, {
        replace: true,
        source: 'live-momentum',
        values: { [STATE_KEY]: JSON.stringify(snapshot) }
      }, options);
      if (!response?.ok || response.source !== 'supabase') {
        throw new Error('Supabase bevestigde de Live Momentum-opslag niet.');
      }
      writeSucceeded = true;
      setPersistenceState('saved');
    } catch (error) {
      stateDirty = true;
      setPersistenceState('error');
      console.error('[LiveMomentum][state-save]', error?.message || error);
    } finally {
      writeInFlight = false;
      if (writeSucceeded && stateDirty && !options.keepalive) {
        scheduleStateWrite();
      }
    }
  }
  function scheduleStateWrite() {
    if (!stateReady) {
      return;
    }
    stateDirty = true;
    setPersistenceState('pending');
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void writeState();
    }, SAVE_DEBOUNCE_MS);
  }
  function getScoreBand(score) {
    if (score >= 75) {
      return 'is-good';
    }
    if (score >= 50) {
      return 'is-warning';
    }
    return 'is-danger';
  }
  function syncCellA11y(cell) {
    const taskIndex = Number(cell.dataset.task || 0);
    const day = getDay(cell);
    const checked = isChecked(cell);
    const tracked = isTracked(cell);
    const missed = tracked && !checked && day > 0 && day <= TODAY;
    cell.classList.toggle('is-missed', missed);
    cell.setAttribute('role', 'checkbox');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-checked', checked ? 'true' : 'false');
    cell.setAttribute('aria-label', `${getLabelText(taskIndex)}, ${formatDay(day)}${tracked ? '' : ', nog niet bijgehouden'}`);
  }
  function getDayScore(day) {
    const statusCells = getStatusCells();
    const cellsForDay = statusCells.filter((cell) => getDay(cell) === day && isTracked(cell));
    const checkedCount = cellsForDay.filter(isChecked).length;
    if (!cellsForDay.length) {
      return null;
    }
    return Math.round((checkedCount / cellsForDay.length) * 100);
  }
  function getVisibleScore(day) {
    const score = getDayScore(day);
    if (!Number.isFinite(score) || (day > TODAY && score === 0)) {
      return null;
    }
    return score;
  }
  function ensureBarLabel(wrap) {
    let label = wrap.querySelector('.bar-label');
    const bar = wrap.querySelector('.bar');
    if (!label && bar) {
      label = document.createElement('span');
      label.className = 'bar-label';
      wrap.insertBefore(label, bar);
    }
    return label;
  }
  function updateBar(day, score) {
    const wrap = getChartBars()[day - 1];
    const bar = wrap?.querySelector('.bar');
    if (!wrap || !bar) {
      return;
    }
    const hasScore = Number.isFinite(score);
    const shouldShowScore = hasScore && (score > 0 || day <= TODAY);
    const isToday = day === TODAY;
    const isOpen = !hasScore || (!isToday && score === 0 && day > TODAY);
    const scoreBand = hasScore ? getScoreBand(score) : '';
    const barHeight = hasScore ? Math.round((Math.max(0, Math.min(score, 100)) / 100) * CHART_MAX_HEIGHT) : 0;
    wrap.classList.remove('is-good', 'is-warning', 'is-danger');
    bar.classList.remove('is-good', 'is-warning', 'is-danger');
    bar.classList.toggle('is-today', isToday);
    bar.classList.toggle('is-open', isOpen);
    bar.classList.toggle('is-done', !isToday && !isOpen);
    if (!isOpen) {
      wrap.classList.add(scoreBand);
      bar.classList.add(scoreBand);
    }
    wrap.style.setProperty('--bar-height', `${barHeight}px`);
    bar.style.setProperty('--bar-height', `${barHeight}px`);
    const label = shouldShowScore ? ensureBarLabel(wrap) : wrap.querySelector('.bar-label');
    if (shouldShowScore && label) {
      label.textContent = `${score}%`;
    } else if (label) {
      label.remove();
    }
  }
  function updateScore() {
    const score = getDayScore(TODAY);
    const safeScore = Number.isFinite(score) ? score : 0;
    const scoreBand = getScoreBand(safeScore);
    scoreValue.textContent = `${safeScore}%`;
    todayScore?.classList.remove('is-good', 'is-warning', 'is-danger');
    todayScore?.classList.add(scoreBand);
    todayScore?.setAttribute('aria-label', `Score vandaag: ${safeScore} van 100 punten`);
    if (srSummary) {
      srSummary.textContent = `${formatDay(TODAY)} is vandaag met een momentumscore van ${safeScore} procent.`;
    }
  }
  function updateChart() {
    if (chartMode === 'line') {
      renderLineChart();
      updateScore();
      return;
    }
    DAYS.forEach((day) => {
      updateBar(day, getDayScore(day));
    });
    updateScore();
  }
  function setChecked(cell, checked) {
    cell.classList.remove('is-untracked');
    cell.classList.toggle('is-done', checked);
    syncCellA11y(cell);
  }
  function toggleCell(cell) {
    setChecked(cell, !isChecked(cell));
    updateChart();
    scheduleStateWrite();
  }
  function updateTodayColumnEnd(statusCells = getStatusCells()) {
    statusCells.forEach((cell) => cell.classList.remove('is-today-end'));
    const todayCells = statusCells.filter((cell) => getDay(cell) === TODAY);
    const lastTodayCell = todayCells[todayCells.length - 1];
    if (lastTodayCell) {
      lastTodayCell.classList.add('is-today-end');
    }
  }
  function refreshCellData() {
    const statusCells = getStatusCells();
    statusCells.forEach((cell, index) => {
      const day = DAYS[index % TOTAL_DAYS];
      const task = Math.floor(index / TOTAL_DAYS);
      cell.dataset.cellIndex = String(index);
      cell.dataset.day = String(day);
      cell.dataset.task = String(task);
      cell.classList.toggle('is-today', day === TODAY);
      syncCellA11y(cell);
    });
    updateTodayColumnEnd(statusCells);
  }
  function bindLabel(label) {
    if (label.dataset.bound === 'true') {
      return;
    }
    label.dataset.bound = 'true';
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        label.blur();
      }
    });
    label.addEventListener('input', () => {
      getStatusCells().forEach(syncCellA11y);
    });
  }
  function createGoalIcon() {
    return createIcon('<path d="M12 5v14M5 12h14" />');
  }
  function createIcon(markup) {
    const template = document.createElement('template');
    template.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
    return template.content.firstElementChild;
  }
  function createLabel(text) {
    const label = document.createElement('span');
    label.className = 'habit-label';
    label.contentEditable = 'plaintext-only';
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', `Taaknaam ${text}`);
    label.setAttribute('spellcheck', 'false');
    label.dataset.placeholder = 'Nieuwe taak';
    label.textContent = text;
    return label;
  }
  function createStatus(day, goal) {
    const cell = document.createElement('span');
    cell.className = 'status';
    if (!goal.trackedDays.includes(day)) {
      cell.classList.add('is-untracked');
    } else if (goal.doneDays.includes(day)) {
      cell.classList.add('is-done');
    }
    return cell;
  }
  function createGoalHeader(goal, isLastGoal) {
    const rowHeader = document.createElement('div');
    rowHeader.className = 'habit-name';
    rowHeader.setAttribute('role', 'rowheader');
    rowHeader.dataset.goalId = goal.id;
    if (isLastGoal) {
      const addButton = document.createElement('button');
      addButton.className = 'add-goal';
      addButton.type = 'button';
      addButton.setAttribute('aria-label', 'Doel toevoegen na laatste opdracht');
      addButton.textContent = '+';
      rowHeader.append(addButton);
    } else {
      rowHeader.append(goal.icon ? createIcon(goal.icon) : createGoalIcon());
    }
    rowHeader.append(createLabel(goal.label));
    return rowHeader;
  }
  function renderChartShell() {
    const fragment = document.createDocumentFragment();
    DAYS.forEach((day) => {
      const wrap = document.createElement('div');
      const bar = document.createElement('span');
      const dayLabel = document.createElement('span');
      wrap.className = 'bar-wrap';
      wrap.dataset.day = String(day);
      bar.className = 'bar is-open';
      dayLabel.className = 'day-label';
      dayLabel.textContent = String(day);
      wrap.append(bar, dayLabel);
      fragment.append(wrap);
    });
    chart.replaceChildren(fragment);
  }
  function renderLineChart() {
    const plotHeight = 164;
    const viewWidth = Math.max(chart.clientWidth, 620);
    const columnWidth = viewWidth / TOTAL_DAYS;
    const scoredDays = DAYS
      .map((day) => ({ day, score: getVisibleScore(day) }))
      .filter(({ score }) => Number.isFinite(score));
    const stage = document.createElement('div');
    stage.className = 'line-stage';
    [0, 25, 50, 75, 100].forEach((score) => {
      const y = plotHeight - ((score / 100) * (plotHeight - 8)) - 4;
      const gridLine = document.createElement('span');
      gridLine.className = 'line-grid';
      gridLine.style.top = `${y}px`;
      stage.append(gridLine);
    });
    scoredDays.forEach((point, index) => {
      if (!index) {
        return;
      }
      const previous = scoredDays[index - 1];
      const x1 = (previous.day - .5) * columnWidth;
      const y1 = plotHeight - ((previous.score / 100) * (plotHeight - 8)) - 4;
      const x2 = (point.day - .5) * columnWidth;
      const y2 = plotHeight - ((point.score / 100) * (plotHeight - 8)) - 4;
      const segment = document.createElement('span');
      segment.className = `line-segment ${getScoreBand(point.score)}`;
      segment.style.left = `${x1}px`;
      segment.style.top = `${y1}px`;
      segment.style.width = `${Math.hypot(x2 - x1, y2 - y1)}px`;
      segment.style.transform = `rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`;
      stage.append(segment);
    });
    scoredDays.forEach(({ day, score }) => {
      const x = (day - .5) * columnWidth;
      const y = plotHeight - ((score / 100) * (plotHeight - 8)) - 4;
      const point = document.createElement('span');
      const label = document.createElement('span');
      point.className = `line-point ${getScoreBand(score)}${score >= 90 ? ' is-top' : ''}`;
      point.style.left = `${x}px`;
      point.style.top = `${y}px`;
      label.className = 'line-point-label';
      label.textContent = `${score}%`;
      point.append(label);
      stage.append(point);
    });
    const dayAxis = document.createElement('div');
    dayAxis.className = 'line-day-axis';
    DAYS.forEach((day) => {
      const dayLabel = document.createElement('span');
      dayLabel.textContent = String(day);
      dayAxis.append(dayLabel);
    });
    chart.replaceChildren(stage, dayAxis);
  }
  function setChartMode(mode, persist = true) {
    if (!['bars', 'line'].includes(mode) || mode === chartMode) {
      return;
    }
    chartMode = mode;
    chart.classList.toggle('is-line-mode', chartMode === 'line');
    chartSwitches.forEach((button) => {
      const isActive = button.dataset.chartMode === chartMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (chartMode === 'bars') {
      renderChartShell();
    }
    updateChart();
    if (persist) {
      scheduleStateWrite();
    }
  }
  function renderGridShell(goals) {
    const fragment = document.createDocumentFragment();
    const spacer = document.createElement('div');
    spacer.className = 'habit-spacer';
    spacer.setAttribute('role', 'columnheader');
    spacer.textContent = 'Doelen:';
    fragment.append(spacer);
    DAYS.forEach((day) => {
      const header = document.createElement('div');
      header.className = 'habit-day';
      header.setAttribute('role', 'columnheader');
      header.classList.toggle('is-muted', day < PERIOD.startDay);
      header.classList.toggle('is-today', day === TODAY);
      header.innerHTML = `<span>${PERIOD.shortLabel}</span><b>${day}</b>`;
      fragment.append(header);
    });
    goals.forEach((goal, index) => {
      fragment.append(createGoalHeader(goal, index === goals.length - 1));
      DAYS.forEach((day) => fragment.append(createStatus(day, goal)));
    });
    grid.replaceChildren(fragment);
  }
  function focusLabel(label) {
    label.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(label);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  function createGoalRow() {
    const goals = getCurrentGoals();
    if (!stateReady || !goals.length || goals.length >= MAX_GOALS) {
      return;
    }
    goals.push(normalizeGoal({
      id: createGoalId(),
      label: 'Nieuw doel',
      doneDays: [],
      trackedDays: DAYS.filter((day) => day >= TODAY)
    }, goals.length));
    renderGridShell(goals);
    refreshCellData();
    getLabels().forEach(bindLabel);
    updateChart();
    focusLabel(getLabels()[getLabels().length - 1]);
    scheduleStateWrite();
  }
  async function hydrateState() {
    const uiStateClient = window.SoftoraUiStateClient;
    if (!uiStateClient || typeof uiStateClient.get !== 'function' || typeof uiStateClient.set !== 'function') {
      setPersistenceState('error');
      return;
    }
    setPersistenceState('loading');
    try {
      const response = await uiStateClient.get(STATE_SCOPE);
      if (!response?.ok || response.source !== 'supabase') {
        throw new Error('Live Momentum kon geen geldige Supabase-state laden.');
      }
      const storedState = parseStoredState(response.values?.[STATE_KEY]);
      if (storedState) {
        renderGridShell(storedState.goals);
        refreshCellData();
        getLabels().forEach(bindLabel);
        if (storedState.chartMode !== chartMode) {
          setChartMode(storedState.chartMode, false);
        } else {
          updateChart();
        }
      }
      stateReady = true;
      setPersistenceState('saved');
      if (!storedState) {
        scheduleStateWrite();
      }
    } catch (error) {
      setPersistenceState('error');
      console.error('[LiveMomentum][state-load]', error?.message || error);
    }
  }
  renderChartShell();
  renderGridShell(getDefaultGoals());
  refreshCellData();
  getLabels().forEach(bindLabel);
  updateChart();
  void hydrateState();
  chartSwitches.forEach((button) => {
    button.addEventListener('click', () => setChartMode(button.dataset.chartMode));
  });
  window.addEventListener('resize', () => {
    if (chartMode === 'line') {
      renderLineChart();
    }
  });
  grid.addEventListener('click', (event) => {
    if (!stateReady) {
      return;
    }
    const addButton = event.target.closest('.add-goal');
    if (addButton && grid.contains(addButton)) {
      createGoalRow();
      return;
    }
    const cell = event.target.closest('.status');
    if (!cell || !grid.contains(cell)) {
      return;
    }
    toggleCell(cell);
  });
  grid.addEventListener('keydown', (event) => {
    if (!stateReady) {
      return;
    }
    const cell = event.target.closest('.status');
    if (!cell || !grid.contains(cell) || ![' ', 'Enter'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    toggleCell(cell);
  });
  grid.addEventListener('focusout', (event) => {
    const label = event.target.closest('.habit-label');
    if (!label) {
      return;
    }
    if (!label.textContent.trim()) {
      label.textContent = 'Nieuw doel';
    }
    getStatusCells().forEach(syncCellA11y);
    scheduleStateWrite();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && stateDirty) {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      void writeState({ keepalive: true, timeoutMs: 5000 });
    }
  });
})();
