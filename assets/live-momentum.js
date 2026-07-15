(() => {
  const STATE_SCOPE = 'premium_live_momentum';
  const STATE_KEY = 'softora_live_momentum_state_v1';
  const STATE_VERSION = 1;
  const PERIOD_KEY = '2026-07';
  const MAX_GOALS = 24;
  const MAX_LABEL_LENGTH = 80;
  const SAVE_DEBOUNCE_MS = 250;
  const SAVE_RETRY_MS = 1500;
  const MAX_SAVE_RETRIES = 3;
  const PERIOD = { label: 'Juli 2026', shortLabel: 'Jul', startDay: 13, today: 13, lastDay: 31 };
  const DAYS = Array.from({ length: PERIOD.lastDay }, (_, index) => index + 1);
  const TOTAL_DAYS = DAYS.length;
  const TODAY = PERIOD.today;
  const CHART_MAX_HEIGHT = 164;
  const ICON_CATALOG = Array.isArray(window.SoftoraMomentumIconCatalog)
    ? window.SoftoraMomentumIconCatalog
    : [];
  const ICONS_BY_KEY = new Map(ICON_CATALOG.map((icon) => [icon.key, icon]));
  const ICON_CATEGORIES = Array.from(new Set(ICON_CATALOG.map((icon) => icon.category).filter(Boolean)));
  const ALL_ICON_CATEGORIES = 'Alle';
  const DEFAULT_ICON_KEY = ICONS_BY_KEY.has('plus') ? 'plus' : ICON_CATALOG[0]?.key;
  const DEFAULT_GOALS = [
    { id: 'workout', label: 'Workout', iconKey: 'dumbbell', doneDays: [TODAY] },
    { id: 'deep-work', label: '90 min deep work', iconKey: 'book', doneDays: [TODAY] },
    { id: 'daily-goal', label: 'Dagdoel behalen', iconKey: 'target', doneDays: [TODAY] },
    { id: 'healthy-food', label: 'Gezonde voeding', iconKey: 'heart', doneDays: [TODAY] }
  ];
  const grid = document.querySelector('.habit-grid');
  const chart = document.querySelector('.bar-chart');
  const srSummary = document.querySelector('.chart-card .sr-only');
  const chartSwitches = Array.from(document.querySelectorAll('.chart-switch'));
  let chartMode = 'bars';
  let stateReady = false;
  let stateDirty = false;
  let saveTimer = null;
  let writeInFlight = false;
  let stateRevision = 0;
  let queuedKeepalive = false;
  let saveRetryCount = 0;
  let iconPicker = null;
  let iconPickerTrigger = null;
  let activeIconCategory = ALL_ICON_CATEGORIES;
  if (!grid || !chart || !chartSwitches.length) {
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
  const getIcon = (key) => ICONS_BY_KEY.get(key) || ICONS_BY_KEY.get(DEFAULT_ICON_KEY) || null;
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
    const requestedIconKey = String(goal?.iconKey || defaultGoal?.iconKey || DEFAULT_ICON_KEY || '');
    const iconKey = ICONS_BY_KEY.has(requestedIconKey) ? requestedIconKey : DEFAULT_ICON_KEY;
    const trackedDays = sanitizeDayList(goal?.trackedDays);
    const normalizedTrackedDays = trackedDays.length
      ? trackedDays
      : defaultGoal
        ? getDefaultTrackedDays()
        : DAYS.filter((day) => day >= TODAY);
    return {
      id,
      label,
      iconKey,
      icon: getIcon(iconKey)?.markup || '<path d="M12 5v14M5 12h14" />',
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
        iconKey: row.dataset.iconKey || defaultGoal?.iconKey,
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
        iconKey: goal.iconKey,
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
    if (!stateReady || !stateDirty || !uiStateClient || typeof uiStateClient.set !== 'function') {
      return;
    }
    if (writeInFlight) {
      queuedKeepalive = queuedKeepalive || options.keepalive === true;
      return;
    }
    stateDirty = false;
    writeInFlight = true;
    const writeRevision = stateRevision;
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
      saveRetryCount = 0;
      if (stateRevision === writeRevision) {
        setPersistenceState('saved');
      }
    } catch (error) {
      stateDirty = true;
      setPersistenceState('error');
      console.error('[LiveMomentum][state-save]', error?.message || error);
    } finally {
      writeInFlight = false;
      if (stateRevision !== writeRevision) {
        stateDirty = true;
      }
      if (stateDirty) {
        const keepalive = queuedKeepalive || options.keepalive === true;
        queuedKeepalive = false;
        if (writeSucceeded || saveRetryCount < MAX_SAVE_RETRIES) {
          const delay = writeSucceeded || keepalive ? 0 : SAVE_RETRY_MS * (saveRetryCount + 1);
          if (!writeSucceeded) {
            saveRetryCount += 1;
          }
          scheduleStateWrite({ delay, keepalive });
        }
      }
    }
  }
  function scheduleStateWrite(options = {}) {
    if (!stateReady) {
      return;
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    const delay = Math.max(0, Number(options.delay ?? SAVE_DEBOUNCE_MS) || 0);
    const writeOptions = options.keepalive === true ? { keepalive: true, timeoutMs: 5000 } : {};
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void writeState(writeOptions);
    }, delay);
  }
  function markStateChanged() {
    if (!stateReady) {
      return;
    }
    stateRevision += 1;
    stateDirty = true;
    saveRetryCount = 0;
    setPersistenceState('pending');
    scheduleStateWrite();
  }
  function flushStateWrite() {
    if (!stateReady || !stateDirty) {
      return;
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (writeInFlight) {
      queuedKeepalive = true;
      return;
    }
    void writeState({ keepalive: true, timeoutMs: 5000 });
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
    markStateChanged();
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
      markStateChanged();
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
  function closeIconPicker() {
    if (!iconPicker || iconPicker.hidden) {
      return;
    }
    iconPicker.hidden = true;
    document.body.classList.remove('has-icon-picker');
    const trigger = iconPickerTrigger;
    iconPickerTrigger = null;
    trigger?.focus();
  }
  function renderIconPickerResults(searchValue = '') {
    if (!iconPicker) {
      return;
    }
    const query = searchValue.trim().toLocaleLowerCase('nl');
    const results = iconPicker.querySelector('.icon-picker-results');
    const emptyState = iconPicker.querySelector('.icon-picker-empty');
    const row = iconPickerTrigger?.closest('.habit-name');
    const selectedKey = row?.dataset.iconKey;
    const matches = ICON_CATALOG.filter((icon) => {
      const matchesCategory = activeIconCategory === ALL_ICON_CATEGORIES || icon.category === activeIconCategory;
      const matchesQuery = `${icon.label} ${icon.keywords}`.toLocaleLowerCase('nl').includes(query);
      return matchesCategory && matchesQuery;
    });
    const fragment = document.createDocumentFragment();
    matches.forEach((icon) => {
      const button = document.createElement('button');
      button.className = 'icon-picker-result';
      button.type = 'button';
      button.dataset.iconKey = icon.key;
      button.setAttribute('aria-label', icon.label);
      button.setAttribute('aria-pressed', icon.key === selectedKey ? 'true' : 'false');
      button.title = icon.label;
      button.append(createIcon(icon.markup));
      const label = document.createElement('span');
      label.textContent = icon.label;
      button.append(label);
      fragment.append(button);
    });
    results.replaceChildren(fragment);
    emptyState.hidden = matches.length > 0;
  }
  function renderIconPickerCategories() {
    if (!iconPicker) {
      return;
    }
    const categoryList = iconPicker.querySelector('.icon-picker-categories');
    const fragment = document.createDocumentFragment();
    [ALL_ICON_CATEGORIES, ...ICON_CATEGORIES].forEach((category) => {
      const button = document.createElement('button');
      button.className = 'icon-picker-category';
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', category === activeIconCategory ? 'true' : 'false');
      button.textContent = category;
      fragment.append(button);
    });
    categoryList.replaceChildren(fragment);
  }
  function ensureIconPicker() {
    if (iconPicker) {
      return iconPicker;
    }
    const backdrop = document.createElement('div');
    const dialog = document.createElement('section');
    const header = document.createElement('header');
    const heading = document.createElement('div');
    const title = document.createElement('h2');
    const summary = document.createElement('p');
    const closeButton = document.createElement('button');
    const search = document.createElement('input');
    const categories = document.createElement('div');
    const results = document.createElement('div');
    const emptyState = document.createElement('p');
    backdrop.className = 'icon-picker-backdrop';
    backdrop.hidden = true;
    dialog.className = 'icon-picker';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'icon-picker-title');
    header.className = 'icon-picker-header';
    heading.className = 'icon-picker-heading';
    title.id = 'icon-picker-title';
    title.textContent = 'Kies een icoon';
    summary.className = 'icon-picker-summary';
    summary.textContent = `${ICON_CATALOG.length} iconen · ${ICON_CATEGORIES.length} categorieën`;
    closeButton.className = 'icon-picker-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Iconenkiezer sluiten');
    closeButton.textContent = '×';
    search.className = 'icon-picker-search';
    search.type = 'search';
    search.placeholder = 'Zoek op icoon of betekenis';
    search.setAttribute('aria-label', 'Zoek een icoon');
    search.autocomplete = 'off';
    categories.className = 'icon-picker-categories';
    categories.setAttribute('aria-label', 'Icooncategorieën');
    results.className = 'icon-picker-results';
    results.setAttribute('role', 'group');
    results.setAttribute('aria-label', 'Beschikbare iconen');
    emptyState.className = 'icon-picker-empty';
    emptyState.textContent = 'Geen iconen gevonden.';
    emptyState.hidden = true;
    heading.append(title, summary);
    header.append(heading, closeButton);
    dialog.append(header, search, categories, results, emptyState);
    backdrop.append(dialog);
    document.body.append(backdrop);
    closeButton.addEventListener('click', closeIconPicker);
    search.addEventListener('input', () => {
      activeIconCategory = ALL_ICON_CATEGORIES;
      renderIconPickerCategories();
      renderIconPickerResults(search.value);
    });
    categories.addEventListener('click', (event) => {
      const option = event.target.closest('.icon-picker-category');
      if (!option) {
        return;
      }
      activeIconCategory = option.dataset.category || ALL_ICON_CATEGORIES;
      search.value = '';
      renderIconPickerCategories();
      renderIconPickerResults();
    });
    results.addEventListener('click', (event) => {
      const option = event.target.closest('.icon-picker-result');
      const row = iconPickerTrigger?.closest('.habit-name');
      const icon = getIcon(option?.dataset.iconKey);
      const trigger = row?.querySelector('.goal-icon-button');
      if (!option || !row || !icon || !trigger) {
        return;
      }
      row.dataset.iconKey = icon.key;
      trigger.replaceChildren(createIcon(icon.markup));
      trigger.setAttribute('aria-label', `Icoon kiezen voor ${row.querySelector('.habit-label')?.textContent.trim() || 'doel'}`);
      markStateChanged();
      closeIconPicker();
    });
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) {
        closeIconPicker();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !backdrop.hidden) {
        event.preventDefault();
        closeIconPicker();
      }
    });
    iconPicker = backdrop;
    return iconPicker;
  }
  function openIconPicker(trigger) {
    if (!ICON_CATALOG.length) {
      return;
    }
    const picker = ensureIconPicker();
    const search = picker.querySelector('.icon-picker-search');
    iconPickerTrigger = trigger;
    picker.hidden = false;
    document.body.classList.add('has-icon-picker');
    search.value = '';
    activeIconCategory = ALL_ICON_CATEGORIES;
    renderIconPickerCategories();
    renderIconPickerResults();
    window.requestAnimationFrame(() => search.focus());
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
    rowHeader.dataset.iconKey = goal.iconKey;
    if (isLastGoal) {
      const addButton = document.createElement('button');
      addButton.className = 'add-goal';
      addButton.type = 'button';
      addButton.setAttribute('aria-label', 'Doel toevoegen na laatste opdracht');
      addButton.textContent = '+';
      rowHeader.append(addButton);
    } else {
      const iconButton = document.createElement('button');
      iconButton.className = 'goal-icon-button';
      iconButton.type = 'button';
      iconButton.setAttribute('aria-label', `Icoon kiezen voor ${goal.label}`);
      iconButton.append(goal.icon ? createIcon(goal.icon) : createGoalIcon());
      rowHeader.append(iconButton);
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
    scoredDays.forEach(({ day, score }, index) => {
      const x = (day - .5) * columnWidth;
      const y = plotHeight - ((score / 100) * (plotHeight - 8)) - 4;
      const point = document.createElement('span');
      const label = document.createElement('span');
      const labelPosition = score >= 90 ? 'is-below' : 'is-above';
      const safeLabelX = Math.min(Math.max(x, 30), viewWidth - 30);
      point.className = `line-point ${getScoreBand(score)}`;
      point.style.left = `${x}px`;
      point.style.top = `${y}px`;
      label.className = `line-point-label ${getScoreBand(score)} ${labelPosition}`;
      label.style.left = `${safeLabelX}px`;
      label.style.top = `${y}px`;
      label.style.setProperty('--line-label-offset', `${16 + ((index % 2) * 16)}px`);
      label.textContent = `${score}%`;
      stage.append(point, label);
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
      markStateChanged();
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
    markStateChanged();
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
        markStateChanged();
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
    const iconButton = event.target.closest('.goal-icon-button');
    if (iconButton && grid.contains(iconButton)) {
      openIconPicker(iconButton);
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
    markStateChanged();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && stateDirty) {
      flushStateWrite();
    }
  });
  window.addEventListener('pagehide', flushStateWrite);
})();
