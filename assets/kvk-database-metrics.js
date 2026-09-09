(function initializeKvkDatabaseMetrics(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  api.start({
    document: globalScope.document,
    window: globalScope.window || globalScope,
    getSnapshot() {
      try {
        if (typeof activeSnapshot === 'undefined') return null;
        return activeSnapshot && typeof activeSnapshot === 'object'
          ? activeSnapshot
          : null;
      } catch {
        return null;
      }
    },
  });
})(typeof globalThis === 'object' ? globalThis : this, function createKvkDatabaseMetricsApi() {
  const numberFormat = new Intl.NumberFormat('nl-NL');

  // Activity belongs to the source's hour, never the time we fetched it.
  // Share this rule with the snapshot API and re-evaluate it on every render.
  function getLast60Minutes(snapshot, now = Date.now()) {
    const activity = snapshot?.state?.last_60_minutes || {};
    const generatedAt = Date.parse(snapshot?.generatedAt || '');
    const age = Number(now) - generatedAt;
    if (Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000) return activity;
    function zeroCounts(counts) {
      return Object.fromEntries(Object.entries(counts).map(([key, value]) => [
        key,
        value && typeof value === 'object' ? zeroCounts(value) : 0,
      ]));
    }
    return zeroCounts(activity);
  }

  function sumCounts(...values) {
    return values.reduce((total, value) => {
      const count = Number(value || 0);
      return total + (Number.isFinite(count) ? Math.max(0, count) : 0);
    }, 0);
  }

  function mergeGradeActivity(...activities) {
    const available = activities.filter((activity) => activity && typeof activity === 'object');
    if (!available.length) return undefined;
    const hasAdded = available.some((activity) => activity.added !== null && activity.added !== undefined);
    const hasRemoved = available.some((activity) => activity.removed !== null && activity.removed !== undefined);
    return {
      added: hasAdded ? sumCounts(...available.map((activity) => activity.added)) : undefined,
      removed: hasRemoved ? sumCounts(...available.map((activity) => activity.removed)) : undefined,
    };
  }

  function renderLast60Delta(element, value) {
    if (!element) return;
    const rawCount = Number(value || 0);
    const count = Number.isFinite(rawCount) ? rawCount : 0;
    const numberNode = element.querySelector('.stat-delta-number');
    const labelNode = element.querySelector('.stat-delta-label');
    if (numberNode) numberNode.textContent = `${count > 0 ? '+' : ''}${numberFormat.format(count)}`;
    if (labelNode) labelNode.textContent = 'laatste 60 min';
    element.classList.toggle('is-zero', count === 0);
  }

  function renderUnusableGradeLast60(element, activity, fallbackAdded = 0, showRemoved = true) {
    if (!element) return;
    const added = Math.max(0, Number(activity?.added ?? fallbackAdded ?? 0));
    const removed = Math.max(0, Number(activity?.removed ?? 0));
    const addedNode = element.querySelector('.unusable-grade-delta-added');
    const removedNode = element.querySelector('.unusable-grade-delta-removed');
    const labelNode = element.querySelector('.unusable-grade-delta-label');
    if (addedNode) addedNode.textContent = `+${numberFormat.format(added)}`;
    if (removedNode) {
      removedNode.textContent = `-${numberFormat.format(removed)}`;
      removedNode.hidden = !showRemoved;
    }
    if (labelNode) labelNode.textContent = 'laatste 60 min';
  }

  function createController(deps = {}) {
    const documentRef = deps.document;
    const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : () => null;
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const elements = {
      treatedTotal: documentRef.getElementById('companies-treated'),
      successfulFound: documentRef.getElementById('companies-successful-found'),
      successfulFoundLast60: documentRef.getElementById('companies-successful-found-last60'),
      treated: documentRef.getElementById('companies-treated-last60'),
      usable: documentRef.getElementById('companies-usable-last60'),
      withWebsite: documentRef.getElementById('companies-with-website-last60'),
      withoutWebsite: documentRef.getElementById('companies-without-website-last60'),
      unusableGrade1: documentRef.getElementById('companies-unusable-grade-1'),
      unusableGrade2: documentRef.getElementById('companies-unusable-grade-2'),
      unusableGrade1Last60: documentRef.getElementById('companies-unusable-grade-1-last60'),
      unusableGrade2Last60: documentRef.getElementById('companies-unusable-grade-2-last60'),
    };

    function renderMetrics() {
      const snapshot = getSnapshot();
      const scraperState = snapshot?.state;
      if (!scraperState) return;
      const last60 = getLast60Minutes(snapshot, now());
      const unusableGrades = scraperState.unusable_grades || {};
      const unusableGradeLast60 = last60.unusable_grades || {};
      const unusableGradeActivity = last60.unusable_grade_activity || {};

      if (elements.treatedTotal) {
        const treated = Number(
          scraperState.treated ??
            sumCounts(
              scraperState.with_website,
              scraperState.without_website,
              scraperState.unusable,
            ),
        );
        const treatedText = numberFormat.format(Number.isFinite(treated) ? Math.max(0, treated) : 0);
        if (elements.treatedTotal.textContent !== treatedText) {
          elements.treatedTotal.textContent = treatedText;
        }
      }
      if (elements.successfulFound) {
        elements.successfulFound.textContent = numberFormat.format(
          Number(
            scraperState.successful_found ??
              sumCounts(scraperState.with_website, scraperState.without_website),
          ),
        );
      }
      renderLast60Delta(elements.successfulFoundLast60, last60.successful_found ?? last60.luna_max_found ?? 0);
      renderLast60Delta(elements.treated, last60.treated);
      renderLast60Delta(elements.usable, last60.usable);
      renderLast60Delta(elements.withWebsite, last60.with_website);
      renderLast60Delta(elements.withoutWebsite, last60.without_website);

      if (elements.unusableGrade1) elements.unusableGrade1.textContent = numberFormat.format(Number(unusableGrades['1'] || 0));
      if (elements.unusableGrade2) elements.unusableGrade2.textContent = numberFormat.format(
        sumCounts(unusableGrades['2'], unusableGrades['3']),
      );
      renderUnusableGradeLast60(
        elements.unusableGrade1Last60,
        unusableGradeActivity['1'],
        unusableGradeLast60['1'],
      );
      renderUnusableGradeLast60(
        elements.unusableGrade2Last60,
        mergeGradeActivity(unusableGradeActivity['2'], unusableGradeActivity['3']),
        sumCounts(unusableGradeLast60['2'], unusableGradeLast60['3']),
        false,
      );
    }

    return { renderMetrics };
  }

  function start(deps = {}) {
    const controller = createController(deps);
    controller.renderMetrics();
    const treatedTotal = deps.document.getElementById('companies-treated');
    if (treatedTotal && typeof deps.window.MutationObserver === 'function') {
      const treatedObserver = new deps.window.MutationObserver(controller.renderMetrics);
      treatedObserver.observe(treatedTotal, { childList: true, characterData: true, subtree: true });
      controller.treatedObserver = treatedObserver;
    }
    deps.window.setInterval(controller.renderMetrics, 1000);
    deps.window.addEventListener('focus', controller.renderMetrics);
    deps.document.addEventListener('visibilitychange', () => {
      if (!deps.document.hidden) controller.renderMetrics();
    });
    return controller;
  }

  return {
    createController,
    getLast60Minutes,
    renderLast60Delta,
    renderUnusableGradeLast60,
    start,
  };
});
