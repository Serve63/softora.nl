((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMomentumMobileDay = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function selectedDate(calendar, choice, now = new Date()) {
    const { year, month, day } = calendar.getAmsterdamDateParts(now);
    const date = new Date(Date.UTC(year, month - 1, day - (choice === 'yesterday' ? 1 : 0)));
    const period = calendar.createPeriod({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
    return { period, day: date.getUTCDate() };
  }

  function readDay(calendar, values, selection) {
    try {
      const raw = values?.[calendar.getMonthStateKey(selection.period.key)];
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (snapshot?.period !== selection.period.key || !Array.isArray(snapshot.goals)) return null;
      const active = (goal) => Number(goal.activeFromDay || selection.period.startDay) <= selection.day
        && Number(goal.activeUntilDay || selection.period.lastDay) >= selection.day;
      return {
        goals: [...snapshot.goals, ...(snapshot.retiredGoals || [])].filter(active),
        retiredGoals: (snapshot.retiredGoals || []).filter(active),
        noData: (snapshot.heldDays || []).includes(selection.day)
      };
    } catch (_error) { return null; }
  }

  function createController({ window: win, document: doc, grid, mobileQuery, onChange }) {
    const calendar = win.SoftoraMomentumCalendar;
    const trigger = doc.querySelector('[data-momentum-mobile-day-trigger]');
    const menu = doc.querySelector('#momentum-mobile-day-menu');
    const label = doc.querySelector('[data-momentum-mobile-day-label]');
    const empty = doc.querySelector('[data-momentum-mobile-day-empty]');
    if (!calendar || !trigger || !menu || !label) return null;
    const renderedPeriod = calendar.getCurrentPeriod();
    const options = Array.from(menu.querySelectorAll('[data-momentum-mobile-day]'));
    const archive = doc.createElement('div');
    archive.className = 'habit-grid momentum-mobile-archive-grid';
    archive.setAttribute('role', 'table');
    archive.setAttribute('aria-label', 'Eerdere doelen');
    archive.hidden = true;
    grid.after(archive);
    let choice = 'today';
    let values = win.SoftoraUiStateClient?.peek?.('premium_live_momentum')?.values || {};
    let archiveSignature = '';

    function close(restoreFocus = false) {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }
    function open() {
      if (!mobileQuery.matches) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      options.find((button) => button.dataset.momentumMobileDay === choice)?.focus();
    }
    function renderArchive(goals, selection, noData) {
      const signature = JSON.stringify([goals, selection.period.key, selection.day, noData]);
      if (archiveSignature === signature) return;
      archiveSignature = signature;
      const fragment = doc.createDocumentFragment();
      goals.forEach((goal) => {
        const row = doc.createElement('div');
        row.className = 'habit-name';
        row.setAttribute('role', 'rowheader');
        const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        icon.setAttribute('aria-hidden', 'true');
        icon.classList.add('momentum-mobile-archive-icon');
        // Markup comes exclusively from the shipped icon catalog, never from stored state.
        const catalog = win.SoftoraMomentumIconCatalog || [];
        icon.innerHTML = (catalog.find((entry) => entry.key === goal.iconKey) || catalog.find((entry) => entry.key === 'plus'))?.markup || '';
        const text = doc.createElement('span');
        text.className = 'habit-label';
        text.textContent = goal.label;
        row.append(icon, text);
        const cell = doc.createElement('span');
        const done = (goal.doneDays || []).includes(selection.day);
        const missed = !done && (goal.trackedDays || []).includes(selection.day);
        const state = noData ? 'neutral' : done ? 'done' : missed ? 'missed' : 'neutral';
        row.dataset.momentumTodayState = state;
        cell.className = `status is-mobile-day${noData ? ' is-on-hold' : done ? ' is-done' : missed ? ' is-missed' : ''}`;
        cell.setAttribute('role', 'checkbox');
        cell.setAttribute('aria-disabled', 'true');
        cell.setAttribute('aria-checked', String(done));
        cell.setAttribute('aria-label', `${goal.label}, ${selection.day} ${selection.period.label}, ${noData ? 'geen data' : done ? 'afgerond' : 'niet afgerond'}`);
        fragment.append(row, cell);
      });
      archive.replaceChildren(fragment);
    }

    function sync() {
      const selection = selectedDate(calendar, choice);
      const samePeriod = selection.period.key === renderedPeriod.key;
      const rows = Array.from(grid.querySelectorAll('.habit-name'));
      const cells = Array.from(grid.querySelectorAll('.status'));
      const selectedCells = [];
      cells.forEach((cell) => {
        const row = rows[Number(cell.dataset.task)];
        const active = choice === 'today' || (Number(row?.dataset.activeFromDay || 1) <= selection.day && row?.dataset.goalDraft !== 'true');
        const selected = samePeriod && active && Number(cell.dataset.day) === selection.day;
        if (cell.classList.contains('is-mobile-day') !== selected) cell.classList.toggle('is-mobile-day', selected);
        if (selected) selectedCells.push(cell);
      });
      rows.forEach((row) => {
        row.dataset.momentumMobileDayHidden = String(!samePeriod || (choice === 'yesterday' && (Number(row.dataset.activeFromDay || 1) > selection.day || row.dataset.goalDraft === 'true')));
      });
      const stored = readDay(calendar, values, selection);
      const goals = choice === 'yesterday' ? (samePeriod ? stored?.retiredGoals : stored?.goals) || [] : [];
      renderArchive(goals, selection, stored?.noData || false);
      archive.hidden = !mobileQuery.matches || !goals.length;
      if (empty) empty.hidden = !mobileQuery.matches || choice !== 'yesterday' || selectedCells.length > 0 || goals.length > 0;
      const allCells = selectedCells.concat(Array.from(archive.querySelectorAll('.status')));
      const noData = (!samePeriod && !stored) || stored?.noData || allCells.some((cell) => cell.classList.contains('is-on-hold'));
      label.textContent = choice === 'yesterday' ? 'gisteren' : 'vandaag';
      options.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.momentumMobileDay === choice)));
      return { cells: allCells, noData: Boolean(noData), label: label.textContent };
    }

    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    options.forEach((button) => button.addEventListener('click', () => {
      choice = button.dataset.momentumMobileDay;
      close(true);
      onChange();
    }));
    doc.addEventListener('click', (event) => {
      if (!trigger.contains(event.target) && !menu.contains(event.target)) close();
    });
    doc.addEventListener('keydown', (event) => {
      if (menu.hidden && event.target !== trigger) return;
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (menu.hidden) { open(); return; }
        const index = options.indexOf(doc.activeElement);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
      if (event.key === 'Tab') close();
    });
    doc.addEventListener('softora:momentum-history-state', (event) => {
      values = event.detail?.values || values;
      onChange();
    });
    mobileQuery.addEventListener('change', () => { close(); onChange(); });
    return { sync };
  }
  return { selectedDate, readDay, createController };
});
