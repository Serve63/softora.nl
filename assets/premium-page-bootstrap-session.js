(function (global) {
  'use strict';

  const BOOTSTRAP_IDS = [
    'softoraPageStateBootstrap',
    'softoraCustomersBootstrap',
    'softoraActiveOrdersBootstrap',
    'softoraAgendaBootstrap',
    'softoraLeadsBootstrap',
    'softoraColdcallingDashboardBootstrap',
  ];
  const TAB_CACHE_PREFIX = 'softora_premium_page_cache_v1:';

  function readSession(target) {
    const doc = target && target.document;
    if (!doc || typeof doc.getElementById !== 'function') return null;
    for (const id of BOOTSTRAP_IDS) {
      const element = doc.getElementById(id);
      if (!element) continue;
      try {
        const payload = JSON.parse(String(element.textContent || '{}'));
        if (payload?.session?.authenticated) return payload.session;
      } catch (_) {
        // Een ongeldige bootstrap mag nooit de pagina blokkeren.
      }
    }
    return null;
  }

  function createPageBootstrapSession(target) {
    const session = readSession(target);
    let storage = null;
    try {
      storage = target && target.sessionStorage ? target.sessionStorage : null;
    } catch (_) {
      storage = null;
    }

    const cache = Object.freeze({
      read: function (key, maxAgeMs) {
        if (!storage || !key) return null;
        try {
          const envelope = JSON.parse(String(storage.getItem(`${TAB_CACHE_PREFIX}${key}`) || '{}'));
          const savedAt = Number(envelope && envelope.savedAt) || 0;
          const maximumAge = Math.max(0, Number(maxAgeMs) || 0);
          if (!savedAt || !maximumAge || Date.now() - savedAt > maximumAge) {
            storage.removeItem(`${TAB_CACHE_PREFIX}${key}`);
            return null;
          }
          return envelope.value === undefined ? null : envelope.value;
        } catch (_) {
          return null;
        }
      },
      write: function (key, value) {
        if (!storage || !key || value === undefined) return false;
        try {
          storage.setItem(`${TAB_CACHE_PREFIX}${key}`, JSON.stringify({
            savedAt: Date.now(),
            value,
          }));
          return true;
        } catch (_) {
          return false;
        }
      },
      remove: function (key) {
        if (!storage || !key) return false;
        try {
          storage.removeItem(`${TAB_CACHE_PREFIX}${key}`);
          return true;
        } catch (_) {
          return false;
        }
      },
    });

    return Object.freeze({
      get: function () { return session; },
      cache,
    });
  }

  global.SoftoraPageBootstrapSession = createPageBootstrapSession(global);
  if (typeof module === 'object' && module.exports) {
    module.exports = { createPageBootstrapSession };
  }
}(typeof window !== 'undefined' ? window : globalThis));
