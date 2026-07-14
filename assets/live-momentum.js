(() => {
  const PERIOD = { label: 'Juli 2026', shortLabel: 'Jul', startDay: 13, today: 13, lastDay: 31 };
  const DAYS = Array.from({ length: PERIOD.lastDay }, (_, index) => index + 1);
  const TOTAL_DAYS = DAYS.length;
  const TODAY = PERIOD.today;
  const CHART_MAX_HEIGHT = 164;
  const DEFAULT_GOALS = [
    { label: 'Workout', icon: '<path d="M5 8v8M19 8v8M3 10v4M21 10v4M7 12h10" />', doneDays: [TODAY] },
    { label: '90 min deep work', icon: '<path d="M4 5.5c2.5-1 4.5-.7 7 1v12c-2.5-1.7-5-1.9-7-1V5.5Zm16 0c-2.5-1-4.5-.7-7 1v12c2.5-1.7 5-1.9 7-1V5.5Z" />', doneDays: [TODAY] },
    { label: 'Dagdoel behalen', icon: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m15 9 4-4M19 5h-4v4" />', doneDays: [TODAY] },
    { label: 'Gezonde voeding', icon: '<path d="M20.4 5.9a5.1 5.1 0 0 0-7.2 0L12 7.1l-1.2-1.2a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-7.9a5.1 5.1 0 0 0 0-7.2Z" />', doneDays: [TODAY] }
  ];
  const grid = document.querySelector('.habit-grid');
  const chart = document.querySelector('.bar-chart');
  const scoreValue = document.querySelector('.today-score strong');
  const scorePoints = document.querySelector('.score-points');
  const todayScore = document.querySelector('.today-score');
  const srSummary = document.querySelector('.chart-card .sr-only');
  if (!grid || !chart || !scoreValue || !scorePoints) {
    return;
  }
  grid.style.setProperty('--day-count', String(TOTAL_DAYS));
  chart.style.setProperty('--day-count', String(TOTAL_DAYS));
  const getChartBars = () => Array.from(chart.querySelectorAll('.bar-wrap'));
  const getAddRowAnchor = () => grid.querySelector('.habit-add');
  const getLabels = () => Array.from(grid.querySelectorAll('.habit-label'));
  const getStatusCells = () => Array.from(grid.querySelectorAll('.status'));
  const getDay = (cell) => Number(cell.dataset.day || 0);
  const getLabelText = (index) => getLabels()[index]?.textContent.trim() || `Taak ${index + 1}`;
  const isChecked = (cell) => cell.classList.contains('is-done') || cell.classList.contains('is-soft');
  const isTracked = (cell) => !cell.classList.contains('is-untracked');
  const formatDay = (day) => `${day} juli`;
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
    scorePoints.replaceChildren(document.createTextNode(`${safeScore} / 100`), document.createElement('br'), document.createTextNode('punten'));
    todayScore?.classList.remove('is-good', 'is-warning', 'is-danger');
    todayScore?.classList.add(scoreBand);
    todayScore?.setAttribute('aria-label', `Score vandaag: ${safeScore} van 100 punten`);
    if (srSummary) {
      srSummary.textContent = `${formatDay(TODAY)} is vandaag met een momentumscore van ${safeScore} procent.`;
    }
  }
  function updateChart() {
    DAYS.forEach((day) => {
      updateBar(day, getDayScore(day));
    });
    updateScore();
  }
  function setChecked(cell, checked) {
    cell.classList.remove('is-untracked');
    cell.classList.toggle('is-done', checked);
    cell.classList.remove('is-soft');
    syncCellA11y(cell);
  }
  function toggleCell(cell) {
    setChecked(cell, !isChecked(cell));
    updateChart();
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
  function createStatus(day, doneDays = []) {
    const cell = document.createElement('span');
    cell.className = 'status';
    if (day < PERIOD.startDay) {
      cell.classList.add('is-untracked');
    } else if (doneDays.includes(day)) {
      cell.classList.add('is-done');
    }
    return cell;
  }
  function createGoalHeader(goal) {
    const rowHeader = document.createElement('div');
    rowHeader.className = 'habit-name';
    rowHeader.setAttribute('role', 'rowheader');
    rowHeader.append(goal.icon ? createIcon(goal.icon) : createGoalIcon(), createLabel(goal.label));
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
  function renderGridShell() {
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
    DEFAULT_GOALS.forEach((goal) => {
      fragment.append(createGoalHeader(goal));
      DAYS.forEach((day) => fragment.append(createStatus(day, goal.doneDays)));
    });
    const add = document.createElement('div');
    const button = document.createElement('button');
    add.className = 'habit-add';
    add.setAttribute('role', 'rowheader');
    button.className = 'add-goal';
    button.type = 'button';
    button.setAttribute('aria-label', 'Doel toevoegen');
    button.textContent = '+';
    add.append(button);
    fragment.append(add);
    DAYS.forEach(() => {
      const cell = document.createElement('span');
      cell.className = 'habit-add-cell';
      cell.setAttribute('aria-hidden', 'true');
      fragment.append(cell);
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
    const addRowAnchor = getAddRowAnchor();
    if (!addRowAnchor) {
      return;
    }
    const rowHeader = createGoalHeader({ label: 'Nieuw doel' });
    const label = rowHeader.querySelector('.habit-label');
    grid.insertBefore(rowHeader, addRowAnchor);
    DAYS.forEach((day) => {
      const cell = createStatus(day);
      if (day < TODAY) {
        cell.classList.add('is-untracked');
      }
      grid.insertBefore(cell, addRowAnchor);
    });
    bindLabel(label);
    refreshCellData();
    updateChart();
    focusLabel(label);
  }
  renderChartShell();
  renderGridShell();
  refreshCellData();
  getLabels().forEach(bindLabel);
  updateChart();
  grid.addEventListener('click', (event) => {
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
    const cell = event.target.closest('.status');
    if (!cell || !grid.contains(cell) || ![' ', 'Enter'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    toggleCell(cell);
  });
  grid.addEventListener('focusout', (event) => {
    const label = event.target.closest('.habit-label');
    if (!label || label.textContent.trim()) {
      return;
    }
    label.textContent = 'Nieuw doel';
    getStatusCells().forEach(syncCellA11y);
  });
})();
