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
    return Object.freeze({
      get: function () { return session; },
    });
  }

  global.SoftoraPageBootstrapSession = createPageBootstrapSession(global);
  if (typeof module === 'object' && module.exports) {
    module.exports = { createPageBootstrapSession };
  }
}(typeof window !== 'undefined' ? window : globalThis));
