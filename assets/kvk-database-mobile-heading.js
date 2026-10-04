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
  function robotLocationText(list, usableByPath = new Map()) {
    if (!list) return '';
    const row = list.querySelector('.planning-worker-label.is-robot')?.closest('.location-item')
      || list.querySelector('.location-button.is-contact-active')?.closest('.location-item');
    if (!row) return '';
    const path = row.querySelector('.location-path')?.firstChild?.textContent || row.querySelector('.location-path')?.textContent || '';
    const place = path.split('|').map(part => part.trim()).filter(Boolean).pop() || '';
    const percent = (row.querySelector('.location-stage-progress')?.textContent.match(/\d+(?:[.,]\d+)?\s*%/) || [''])[0].replace(/\s+/g, '');
    const usable = usableByPath.get(normalizedPath(path));
    const found = Number.isSafeInteger(usable) ? `${numberFormat.format(usable)} bruikbaar` : '';
    return place ? [place, percent, found].filter(Boolean).join(' · ') : '';
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

  function start(doc = document) {
    const list = doc.getElementById('location-list');
    const target = doc.getElementById('latest-robot-location');
    if (!list || !target) return;
    let usableByPath = new Map();
    const update = () => {
      const text = robotLocationText(list, usableByPath);
      if (target.textContent !== text) target.textContent = text;
      target.hidden = !text;
    };
    const refreshCounts = async () => {
      // Only the phone shows this heading; the desktop never loads the counts for it.
      if (doc.hidden || !doc.defaultView?.matchMedia?.('(max-width: 700px)').matches) return;
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
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start());
    else start();
  }
  return { robotLocationText, start };
});
