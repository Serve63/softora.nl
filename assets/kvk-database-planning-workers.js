(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkPlanningWorkers = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  // Only the two robots work the planning now (Servé, 2026-10-04); the old AI Searchers and Controleurs
  // have no marker any more. Each marker stands where that robot actually works, read from the snapshot:
  // the Searcher's latest researched company and the Controleur's latest check (controlLocation).
  const labels = { robot: 'Robot Searcher', 'controller-robot': 'Robot Controleur' };
  const normalized = value => String(value || '').trim().toLocaleLowerCase('nl-NL');

  function currentSnapshot() {
    try {
      // kvk-database.js keeps the live snapshot in this page-level binding.
      // eslint-disable-next-line no-undef
      return typeof activeSnapshot === 'undefined' ? null : activeSnapshot;
    } catch {
      return null;
    }
  }

  function robotPlaces(snapshot) {
    const searcher = (snapshot?.latestTreated || []).find(row => normalized(row.found_by_role_label) === 'robot');
    const control = snapshot?.controlLocation;
    return {
      robot: searcher ? { woonplaats: searcher.woonplaats, provincie: searcher.provincie } : null,
      'controller-robot': control?.place ? { woonplaats: control.place, provincie: control.provincie } : null,
    };
  }

  function sameLocation(place, location) {
    return Boolean(place) && normalized(place.woonplaats) === normalized(location.woonplaats)
      && (!place.provincie || normalized(place.provincie) === normalized(location.provincie));
  }

  // The signature stays as kvk-database.js calls it; only the snapshot decides.
  function rolesFor(location, _locations, _scraper, snapshot = currentSnapshot()) {
    const places = robotPlaces(snapshot);
    return Object.keys(labels).filter(role => sameLocation(places[role], location));
  }

  function render(roles) {
    return roles.map(role => `<span class="planning-worker-label is-${role}" title="${labels[role]}: werkt nu in deze plaats">${labels[role]}</span>`).join('');
  }

  return { rolesFor, render, robotPlaces };
});
