(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkMobileHeading = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  const numberFormat = new Intl.NumberFormat('nl-NL');
  const normalizedPath = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('nl-NL');

  // "Drunen · 45% · 120 bruikbaar": the place the Robot works in, read from the rendered planning
  // rows, with the usable companies found there (from location-stats, keyed by planning path).
  function planningRowFor(list, place) {
    const wanted = normalizedPath(place);
    if (!wanted || !list.querySelectorAll) return null;
    return [...list.querySelectorAll('.location-item')].find((item) => {
      const path = item.querySelector('.location-path')?.firstChild?.textContent || '';
      return normalizedPath(path.split('|').pop()) === wanted;
    }) || null;
  }

  // latestPlace: where the Robot's most recent company is; it works ahead of the planning head.
  function robotLocationText(list, usableByPath = new Map(), latestPlace = '') {
    if (!list) return '';
    const row = planningRowFor(list, latestPlace)
      || list.querySelector('.planning-worker-label.is-robot')?.closest('.location-item')
      || list.querySelector('.location-button.is-contact-active')?.closest('.location-item');
    if (!row) return '';
    const path = row.querySelector('.location-path')?.firstChild?.textContent || row.querySelector('.location-path')?.textContent || '';
    const place = path.split('|').map(part => part.trim()).filter(Boolean).pop() || '';
    const percent = (row.querySelector('.location-stage-progress')?.textContent.match(/\d+(?:[.,]\d+)?\s*%/) || [''])[0].replace(/\s+/g, '');
    const usable = usableByPath.get(normalizedPath(path));
    const found = Number.isSafeInteger(usable) ? `${numberFormat.format(usable)} bruikbaar` : '';
    return place ? [place, percent, found].filter(Boolean).join(' · ') : '';
  }

  // "Helvoirt · 10% · 2 teruggevonden": the place the Robot Controleur checks, from the snapshot's controlLocation.
  function controlLocationText(location) {
    const place = String(location?.place || '').trim();
    if (!place) return '';
    const percent = Number.isFinite(Number(location.percent)) ? `${Math.floor(Number(location.percent))}%` : '';
    const recovered = Number.isSafeInteger(location.recovered) ? `${numberFormat.format(location.recovered)} teruggevonden` : '';
    return [place, percent, recovered].filter(Boolean).join(' · ');
  }

  // "Codex: 97% over": what is left of the subscription's weekly limit, from the snapshot's codexUsage.
  function codexUsageText(usage) {
    const left = Number(usage?.remainingPercent);
    return Number.isFinite(left) ? `Codex: ${Math.floor(left)}% over` : '';
  }

  // Which robot's work the phone list shows; the "Gevonden door" cell names the producer.
  const ROLE_LABELS = { searcher: 'robot', controller: 'robot controleur' };
  const EMPTY_TEXT = { searcher: 'Nog geen werk van de Robot Searcher.', controller: 'Nog geen controles van de Robot Controleur.' };

  function rowRole(row) {
    return String(row.cells?.[3]?.querySelector('strong')?.textContent || row.cells?.[3]?.textContent || '')
      .trim().toLocaleLowerCase('nl-NL');
  }

  function filterRows(body, role) {
    if (!body) return 0;
    let shown = 0;
    [...body.rows].forEach((row) => {
      if (row.classList.contains('robot-role-empty') || row.classList.contains('empty-row')) return;
      const match = rowRole(row) === ROLE_LABELS[role];
      row.hidden = !match;
      shown += match ? 1 : 0;
    });
    let empty = body.querySelector('.robot-role-empty');
    if (!shown) {
      if (!empty) {
        empty = body.ownerDocument.createElement('tr');
        empty.className = 'robot-role-empty empty-row';
        empty.innerHTML = '<td colspan="8"></td>';
        body.appendChild(empty);
      }
      empty.cells[0].textContent = EMPTY_TEXT[role];
    } else if (empty) {
      empty.remove();
    }
    return shown;
  }

  async function loadUsableByPath() {
    const response = await fetch(`/api/kvk-database/location-stats?t=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload?.locations)) return null;
    return new Map(payload.locations.flatMap((location) => {
      const usable = Number(location.bruikbareBedrijven ?? location.bruikbare_bedrijven);
      if (!Number.isSafeInteger(usable) || usable < 0) return [];
      return [[normalizedPath([location.land, location.provincie, location.gemeente, location.woonplaats].join(' | ')), usable]];
    }));
  }

  function currentSnapshot() {
    try {
      // kvk-database.js keeps the live snapshot in this page-level binding.
      // eslint-disable-next-line no-undef
      return typeof activeSnapshot === 'undefined' ? null : activeSnapshot;
    } catch {
      return null;
    }
  }

  function start(doc = document, getSnapshot = currentSnapshot) {
    const list = doc.getElementById('location-list');
    const target = doc.getElementById('latest-robot-location');
    const select = doc.getElementById('latest-role-select');
    const body = doc.getElementById('latest-luna-errors-table-body');
    if (!list || !target) return;
    let usableByPath = new Map();
    const phone = () => Boolean(doc.defaultView?.matchMedia?.('(max-width: 700px)').matches);
    const role = () => (select?.value === 'controller' ? 'controller' : 'searcher');
    const update = () => {
      // The Searcher's place comes from the planning; the Controleur's from its latest check.
      const latest = [...(body?.rows || [])].find(item => !item.hidden && rowRole(item) === ROLE_LABELS.searcher);
      const latestPlace = String(latest?.cells?.[7]?.textContent || '').split(',')[0].trim();
      const text = role() === 'searcher'
        ? robotLocationText(list, usableByPath, latestPlace)
        : controlLocationText(getSnapshot()?.controlLocation);
      if (target.textContent !== text) target.textContent = text;
      target.hidden = !text;
      const usage = doc.getElementById('latest-codex-usage');
      if (usage) {
        const usageText = codexUsageText(getSnapshot()?.codexUsage);
        if (usage.textContent !== usageText) usage.textContent = usageText;
        usage.hidden = !usageText;
      }
    };
    let filtering = false;
    const applyRole = () => {
      if (filtering || !body) return;
      filtering = true;
      try {
        if (phone()) filterRows(body, role());
        else [...body.rows].forEach((row) => {
          row.hidden = row.classList.contains('robot-role-empty') || row.classList.contains('robot-control-row');
        });
      } finally { filtering = false; }
      update();
    };
    select?.addEventListener('change', () => { update(); applyRole(); });
    if (body) new MutationObserver(applyRole).observe(body, { childList: true });
    doc.defaultView?.matchMedia?.('(max-width: 700px)').addEventListener?.('change', applyRole);
    applyRole();
    const refreshCounts = async () => {
      // Only the phone shows this heading; the desktop never loads the counts for it.
      if (doc.hidden || !phone()) return;
      try {
        const counts = await loadUsableByPath();
        if (counts) { usableByPath = counts; update(); }
      } catch {
        // The place and progress stay visible when the counts are briefly unavailable.
      }
    };
    new MutationObserver(update).observe(list, { childList: true, subtree: true, characterData: true });
    update();
    refreshCounts();
    doc.defaultView?.setInterval?.(refreshCounts, 60000);
    // Every new snapshot (and a slow tick) refreshes the heading, so the Codex share is always current.
    doc.defaultView?.addEventListener?.('softora:kvk-progress', update);
    doc.defaultView?.setInterval?.(update, 15000);
    doc.addEventListener('visibilitychange', refreshCounts);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start());
    else start();
  }
  return { robotLocationText, controlLocationText, codexUsageText, filterRows, start };
});
