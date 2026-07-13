(() => {
  const TOTAL_DAYS = 30;
  const TODAY = 11;
  const CHART_MAX_HEIGHT = 164;
  const STORAGE_KEY = 'softora.liveMomentum.v1';

  const grid = document.querySelector('.habit-grid');
  const chartBars = Array.from(document.querySelectorAll('.bar-chart .bar-wrap'));
  const scoreValue = document.querySelector('.today-score strong');
  const scorePoints = document.querySelector('.score-points');
  const todayScore = document.querySelector('.today-score');
  const srSummary = document.querySelector('.chart-card .sr-only');

  if (!grid || chartBars.length !== TOTAL_DAYS || !scoreValue || !scorePoints) {
    return;
  }

  const labels = Array.from(grid.querySelectorAll('.habit-label'));
  const statusCells = Array.from(grid.querySelectorAll('.status'));
  const rowCount = labels.length;
  const getDay = (cell) => Number(cell.dataset.day || 0);
  const getLabelText = (index) => labels[index]?.textContent.trim() || `Taak ${index + 1}`;
  const isChecked = (cell) => cell.classList.contains('is-done') || cell.classList.contains('is-soft');

  function readStoredState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function writeStoredState() {
    const state = {
      labels: labels.map((label) => label.textContent.trim()),
      checked: statusCells.map((cell) => isChecked(cell)),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Local storage can be blocked in private modes; the page should still work live.
    }
  }

  function applyStoredState() {
    const state = readStoredState();

    if (Array.isArray(state.labels)) {
      labels.forEach((label, index) => {
        if (typeof state.labels[index] === 'string' && state.labels[index].trim()) {
          label.textContent = state.labels[index].trim();
        }
      });
    }

    if (Array.isArray(state.checked) && state.checked.length === statusCells.length) {
      statusCells.forEach((cell, index) => {
        cell.classList.toggle('is-done', Boolean(state.checked[index]));
        cell.classList.remove('is-soft');
      });
    }
  }

  function syncCellA11y(cell) {
    const taskIndex = Number(cell.dataset.task || 0);
    const day = getDay(cell);
    const checked = isChecked(cell);

    cell.setAttribute('role', 'checkbox');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-checked', checked ? 'true' : 'false');
    cell.setAttribute('aria-label', `${getLabelText(taskIndex)}, dag ${day}`);
  }

  function getDayScore(day) {
    const cellsForDay = statusCells.filter((cell) => getDay(cell) === day);
    const checkedCount = cellsForDay.filter(isChecked).length;

    if (!rowCount) {
      return 0;
    }

    return Math.round((checkedCount / rowCount) * 100);
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
    const barHeight = Math.round((Math.max(0, Math.min(score, 100)) / 100) * CHART_MAX_HEIGHT);

    bar.classList.toggle('is-today', isToday);
    bar.classList.toggle('is-open', isOpen);
    bar.classList.toggle('is-done', !isToday && !isOpen);
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

    scoreValue.textContent = `${score}%`;
    scorePoints.replaceChildren(document.createTextNode(`${score} / 100`), document.createElement('br'), document.createTextNode('punten'));
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
    cell.classList.toggle('is-done', checked);
    cell.classList.remove('is-soft');
    syncCellA11y(cell);
  }

  function toggleCell(cell) {
    setChecked(cell, !isChecked(cell));
    writeStoredState();
    updateChart();
  }

  statusCells.forEach((cell, index) => {
    const day = (index % TOTAL_DAYS) + 1;
    const task = Math.floor(index / TOTAL_DAYS);

    cell.dataset.cellIndex = String(index);
    cell.dataset.day = String(day);
    cell.dataset.task = String(task);
  });

  applyStoredState();

  statusCells.forEach(syncCellA11y);
  updateChart();

  grid.addEventListener('click', (event) => {
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

  labels.forEach((label) => {
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        label.blur();
      }
    });

    label.addEventListener('input', () => {
      statusCells.forEach(syncCellA11y);
      writeStoredState();
    });
  });
})();
