(() => {
  const TOTAL_DAYS = 30;
  const TODAY = 11;
  const CHART_MAX_HEIGHT = 164;
  const grid = document.querySelector('.habit-grid');
  const chartBars = Array.from(document.querySelectorAll('.bar-chart .bar-wrap'));
  const scoreValue = document.querySelector('.today-score strong');
  const scorePoints = document.querySelector('.score-points');
  const todayScore = document.querySelector('.today-score');
  const srSummary = document.querySelector('.chart-card .sr-only');
  if (!grid || chartBars.length !== TOTAL_DAYS || !scoreValue || !scorePoints) {
    return;
  }
  const addRowAnchor = grid.querySelector('.habit-add');
  const getLabels = () => Array.from(grid.querySelectorAll('.habit-label'));
  const getStatusCells = () => Array.from(grid.querySelectorAll('.status'));
  const getDay = (cell) => Number(cell.dataset.day || 0);
  const getLabelText = (index) => getLabels()[index]?.textContent.trim() || `Taak ${index + 1}`;
  const isChecked = (cell) => cell.classList.contains('is-done') || cell.classList.contains('is-soft');
  const isTracked = (cell) => !cell.classList.contains('is-untracked');
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
    cell.setAttribute('aria-label', `${getLabelText(taskIndex)}, dag ${day}${tracked ? '' : ', nog niet bijgehouden'}`);
  }
  function getDayScore(day) {
    const statusCells = getStatusCells();
    const cellsForDay = statusCells.filter((cell) => getDay(cell) === day && isTracked(cell));
    const checkedCount = cellsForDay.filter(isChecked).length;
    if (!cellsForDay.length) {
      return 0;
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
    const wrap = chartBars[day - 1];
    const bar = wrap?.querySelector('.bar');
    if (!wrap || !bar) {
      return;
    }
    const shouldShowScore = score > 0 || day <= TODAY;
    const isToday = day === TODAY;
    const isOpen = !isToday && score === 0 && day > TODAY;
    const scoreBand = getScoreBand(score);
    const barHeight = Math.round((Math.max(0, Math.min(score, 100)) / 100) * CHART_MAX_HEIGHT);
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
    const scoreBand = getScoreBand(score);
    scoreValue.textContent = `${score}%`;
    scorePoints.replaceChildren(document.createTextNode(`${score} / 100`), document.createElement('br'), document.createTextNode('punten'));
    todayScore?.classList.remove('is-good', 'is-warning', 'is-danger');
    todayScore?.classList.add(scoreBand);
    todayScore?.setAttribute('aria-label', `Score vandaag: ${score} van 100 punten`);
    if (srSummary) {
      srSummary.textContent = `Dag ${TODAY} is vandaag met een momentumscore van ${score} procent.`;
    }
  }
  function updateChart() {
    for (let day = 1; day <= TOTAL_DAYS; day += 1) {
      updateBar(day, getDayScore(day));
    }
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
      const day = (index % TOTAL_DAYS) + 1;
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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M12 5v14M5 12h14');
    svg.append(path);
    return svg;
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
    if (!addRowAnchor) {
      return;
    }
    const rowHeader = document.createElement('div');
    const label = document.createElement('span');
    rowHeader.className = 'habit-name';
    rowHeader.setAttribute('role', 'rowheader');
    rowHeader.append(createGoalIcon());
    label.className = 'habit-label';
    label.contentEditable = 'plaintext-only';
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', 'Taaknaam Nieuw doel');
    label.setAttribute('spellcheck', 'false');
    label.dataset.placeholder = 'Nieuwe taak';
    label.textContent = 'Nieuw doel';
    rowHeader.append(label);
    grid.insertBefore(rowHeader, addRowAnchor);
    for (let day = 1; day <= TOTAL_DAYS; day += 1) {
      const cell = document.createElement('span');
      cell.className = 'status';
      if (day < TODAY) {
        cell.classList.add('is-untracked');
      }
      grid.insertBefore(cell, addRowAnchor);
    }
    bindLabel(label);
    refreshCellData();
    updateChart();
    focusLabel(label);
  }
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
