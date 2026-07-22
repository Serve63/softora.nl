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

  function readSession() {
    const doc = global && global.document;
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

  const session = readSession();
  global.SoftoraPageBootstrapSession = Object.freeze({
    get: function () { return session; },
  });
}(window));
