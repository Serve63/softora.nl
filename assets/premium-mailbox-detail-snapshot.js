// Mailbox detail snapshot: the newest conversation opens exactly as it was
// last shown, instead of "E-mail laden...". The detail stays inert until the
// controller commits the live, fully hydrated conversation over it.
(function (global) {
  'use strict';

  const MAX_CHARS = 400000;
  let snapshot = null;

  function instance() {
    if (!snapshot && global.SoftoraScreenSnapshot) {
      snapshot = global.SoftoraScreenSnapshot.create({
        key: 'premium-mailbox-detail:v1',
        elements: [{ id: 'mail-detail', html: true }],
        inertIds: ['mail-detail'],
        maxChars: MAX_CHARS,
      });
    }
    return snapshot;
  }

  const api = Object.freeze({
    restore(view) { const current = instance(); return current ? current.restore(view) : false; },
    isShowing() { return Boolean(snapshot && snapshot.isShowing()); },
    release() { if (snapshot) snapshot.release(); },
    capture(view, isValid) { const current = instance(); if (current) current.capture(view, { isValid }); },
  });
  global.SoftoraMailboxDetailSnapshot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
