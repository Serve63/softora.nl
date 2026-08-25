((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMomentumDayHold = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function normalizeDays(value, lastDay, today) {
    const maximum = Math.min(Number(lastDay) || 0, Number(today) || 0);
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= maximum)))
      .sort((left, right) => left - right);
  }

  function toggleDay(value, day, lastDay, today) {
    const normalized = normalizeDays(value, lastDay, today);
    const target = Number(day);
    if (!Number.isInteger(target) || target < 1 || target > Math.min(lastDay, today)) return normalized;
    return normalized.includes(target)
      ? normalized.filter((entry) => entry !== target)
      : [...normalized, target].sort((left, right) => left - right);
  }

  function scoreDay(options = {}) {
    const day = Number(options.day);
    if (options.isHeld?.(day)) return null;
    const cells = (options.statusCells || []).filter((cell) => (
      options.getDay(cell) === day
      && options.isActiveRow((options.goalRows || [])[Number(cell.dataset?.task || 0)], day)
    ));
    if (!cells.length) return null;
    return Math.round((cells.filter(options.isChecked).length / cells.length) * 100);
  }

  function createController(options = {}) {
    const grid = options.grid;
    const chart = options.chart;
    const lastDay = Number(options.lastDay) || 0;
    let heldDays = [];

    function getToday() {
      return Number(options.getToday?.()) || 0;
    }

    function isHeld(day) {
      return heldDays.includes(Number(day));
    }

    function getState() {
      return [...heldDays];
    }

    function hydrate(value) {
      heldDays = normalizeDays(value, lastDay, getToday());
    }

    function syncHeader(header) {
      const day = Number(header?.dataset?.day);
      const button = header?.querySelector?.('.habit-day-toggle');
      const held = isHeld(day);
      const available = day >= 1 && day <= getToday();
      header?.classList?.toggle('is-on-hold', held);
      if (!button) return;
      button.disabled = !available;
      button.setAttribute('aria-pressed', String(held));
      button.setAttribute('aria-label', held
        ? `${options.formatDay(day)} staat op geen data. Klik om de dagscore te herstellen.`
        : `${options.formatDay(day)} bijhouden. Klik om de hele dag op geen data te zetten.`);
      button.title = held ? 'Dagscore herstellen' : available ? 'Hele dag op geen data zetten' : 'Deze dag is nog niet beschikbaar';
    }

    function decorateHeader(header, day, shortLabel) {
      const button = document.createElement('button');
      const month = document.createElement('span');
      const number = document.createElement('b');
      header.dataset.day = String(day);
      button.className = 'habit-day-toggle';
      button.type = 'button';
      button.dataset.day = String(day);
      month.textContent = shortLabel;
      number.textContent = String(day);
      button.append(month, number);
      header.append(button);
      syncHeader(header);
    }

    function syncGrid() {
      grid?.querySelectorAll?.('.habit-day').forEach(syncHeader);
      options.getStatusCells?.().forEach((cell, index) => {
        const day = options.getDay(cell) || ((index % lastDay) + 1);
        cell.classList.toggle('is-on-hold', isHeld(day));
      });
    }

    function syncChartDay(wrap, bar, day) {
      const held = isHeld(day);
      wrap?.classList?.toggle('is-no-data', held);
      bar?.classList?.toggle('is-no-data', held);
      const existing = wrap?.querySelector?.('.bar-no-data-label');
      if (!held) {
        existing?.remove();
        return;
      }
      if (existing) return;
      const label = document.createElement('span');
      label.className = 'bar-label bar-no-data-label';
      label.textContent = '—';
      wrap.insertBefore(label, bar);
    }

    function toggle(day) {
      if (!options.isReady?.()) return false;
      const next = toggleDay(heldDays, day, lastDay, getToday());
      if (next.length === heldDays.length && next.every((entry, index) => entry === heldDays[index])) return false;
      heldDays = next;
      options.onChange?.();
      return true;
    }

    grid?.addEventListener?.('click', (event) => {
      const button = event.target.closest?.('.habit-day-toggle');
      if (!button || !grid.contains(button)) return;
      toggle(Number(button.dataset.day));
    });

    return { decorateHeader, getState, hydrate, isHeld, scoreDay, syncChartDay, syncGrid, toggle };
  }

  return { createController, normalizeDays, scoreDay, toggleDay };
});
