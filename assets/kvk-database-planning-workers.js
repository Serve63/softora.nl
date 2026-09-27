(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkPlanningWorkers = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const labels = { searcher: 'Searcher', controller: 'Controleur', robot: 'Robot' };
  let workers = {};
  let robotLocation = null;
  let busy = false;
  const normalized = value => String(value || '').trim().toLocaleLowerCase('nl-NL');

  function rolesFor(location, locations, scraper, status = workers, robot = robotLocation) {
    const code = location.woonplaatscode;
    const routes = scraper.contact_parallel_routes || [];
    const searchCode = routes.find(route => route.queue_kind === 'global_initial')?.active_location_code
      || scraper.contact_active_location_code;
    const reviewCode = routes.find(route => route.queue_kind === 'global_review')?.active_location_code;
    // The first unfinished control stage is the controller's planning head when
    // the snapshot has no explicit review route. It is not a heartbeat claim.
    const reviewHead = reviewCode || locations.find(row => {
      const progress = row.stage_progress;
      return progress && progress.researched > progress.reviewed;
    })?.woonplaatscode;
    const robotMatches = robot && (robot.woonplaatscode
      ? robot.woonplaatscode === code
      : normalized(robot.woonplaats || robot.plaats) === normalized(location.woonplaats)
        && normalized(robot.provincie) === normalized(location.provincie));
    return [
      code === searchCode ? 'searcher' : '',
      code === reviewHead ? 'controller' : '',
      (robotMatches || (!robot && code === searchCode)) ? 'robot' : '',
    ].filter(Boolean);
  }

  function render(roles) {
    return roles.map(role => `<span class="planning-worker-label is-${role}" title="${labels[role]}: huidige locatie in de planning">${labels[role]}</span>`).join('');
  }

  async function refresh() {
    if (busy || document.hidden || window.SoftoraKvkSelectionPause?.isSelecting()) return;
    busy = true;
    try {
      const response = await fetch('/api/kvk-database/api-workers', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload.ok || !payload.state?.workers) return;
      workers = payload.state.workers;
      const kvk = workers.robot?.currentBatch;
      if (/^\d{8}$/.test(kvk || '')) {
        const directory = await fetch(`/api/kvk-database/company-directory?q=${encodeURIComponent(kvk)}&limit=10&categorie=all`, { cache: 'no-store', credentials: 'same-origin' });
        if (directory.ok) {
          const location = (await directory.json()).rows?.find(row => String(row.kvk_nummer) === kvk);
          if (location) robotLocation = location;
        }
      }
      if (!window.SoftoraKvkSelectionPause?.isSelecting()) renderLocationList();
    } catch {
      // Existing planning remains available during a temporary status failure.
    } finally { busy = false; }
  }
  if (typeof window !== 'undefined') {
    window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.setTimeout(refresh, 0);
  }
  return { rolesFor, render, refresh };
});
