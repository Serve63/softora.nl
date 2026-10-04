(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkMobileHeading = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  // "Drunen · 45%": the place the Robot works in, read from the rendered planning rows.
  function robotLocationText(list) {
    if (!list) return '';
    const row = list.querySelector('.planning-worker-label.is-robot')?.closest('.location-item')
      || list.querySelector('.location-button.is-contact-active')?.closest('.location-item');
    if (!row) return '';
    const path = row.querySelector('.location-path')?.firstChild?.textContent || row.querySelector('.location-path')?.textContent || '';
    const place = path.split('|').map(part => part.trim()).filter(Boolean).pop() || '';
    const percent = (row.querySelector('.location-stage-progress')?.textContent.match(/\d+(?:[.,]\d+)?\s*%/) || [''])[0].replace(/\s+/g, '');
    return place ? [place, percent].filter(Boolean).join(' · ') : '';
  }

  function start(doc = document) {
    const list = doc.getElementById('location-list');
    const target = doc.getElementById('latest-robot-location');
    if (!list || !target) return;
    const update = () => {
      const text = robotLocationText(list);
      if (target.textContent !== text) target.textContent = text;
      target.hidden = !text;
    };
    new MutationObserver(update).observe(list, { childList: true, subtree: true, characterData: true });
    update();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start());
    else start();
  }
  return { robotLocationText, start };
});
