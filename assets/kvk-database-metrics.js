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
  const DIRECTORY_API_URL = '/api/kvk-database/company-directory';
  const CANONICAL_REFRESH_INTERVAL_MS = 30_000;
  const CANONICAL_CATEGORIES = Object.freeze({
    treated: 'behandeld',
    successfulFound: 'bruikbaar-verklaard',
    declaredUnusable: 'onbruikbaar-verklaard',
    controlRoom: 'controlekamer',
    usable: 'bruikbaar',
    withWebsite: 'met-website',
    withoutWebsite: 'zonder-werkende-website',
  });

  // Activity belongs to the source's hour, never the time we fetched it.
  // Share this rule with the snapshot API and re-evaluate it on every render.
  function getLast60Minutes(snapshot, now = Date.now()) {
    const activity = snapshot?.state?.last_60_minutes || {};
    const generatedAt = Date.parse(snapshot?.state?.metrics_measured_at || snapshot?.generatedAt || '');
    const age = Number(now) - generatedAt;
    function mapCounts(counts, replacement = 0) {
      return Object.fromEntries(Object.entries(counts).map(([key, child]) => [
        key,
        child && typeof child === 'object' ? mapCounts(child, replacement) : replacement,
      ]));
    }
    const events = snapshot?.state?.last_60_minute_events;
    if (Array.isArray(events)) {
      // A stopped/failed publisher means unknown new work, never a proven +0.
      if (!Number.isFinite(age) || age < 0 || age > 120_000) return mapCounts(activity, null);
      const counts = mapCounts(activity);
      for (const event of events) {
        if (!Number.isFinite(event.at) || event.at <= Number(now) - 3_600_000 || event.at > Number(now)) continue;
        for (const [path, delta] of Object.entries(event.delta || {})) {
          const parts = path.split('.');
          let target = counts;
          for (const part of parts.slice(0, -1)) target = target?.[part];
          const key = parts[parts.length - 1];
          if (target && Number.isFinite(delta) && key in target) target[key] += delta;
        }
      }
      counts.usable = (counts.with_website || 0) + (counts.without_website || 0);
      counts.successful_found = counts.declared_usable || 0;
      counts.control_room = (counts.control_room_activity?.added || 0) - (counts.control_room_activity?.removed || 0);
      for (const grade of ['1', '2']) {
        if (counts.unusable_grades) counts.unusable_grades[grade] = counts.unusable_grade_activity?.[grade]?.added || 0;
      }
      return counts;
    }
    if (Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000) return activity;
    return mapCounts(activity);
  }

  function sumCounts(...values) {
    return values.reduce((total, value) => {
      const count = Number(value || 0);
      return total + (Number.isFinite(count) ? Math.max(0, count) : 0);
    }, 0);
  }

  function nonNegativeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : null;
  }

  // Snapshot fallback for the few seconds before the canonical online directory
  // has answered. The canonical directory replaces this value as soon as it is available.
  function getAvailableWithWebsiteCount(snapshot) {
    const scraperState = snapshot?.state || {};
    const companyTotals = snapshot?.companyTotals || {};
    const usable = nonNegativeCount(scraperState.usable ?? companyTotals.usable);
    const withoutWebsite = nonNegativeCount(
      scraperState.without_website ?? companyTotals.without_website,
    );
    const reportedWithWebsite = nonNegativeCount(
      scraperState.with_website ?? companyTotals.with_website,
    );
    if (usable !== null && withoutWebsite !== null && withoutWebsite <= usable) {
      return usable - withoutWebsite;
    }
    return reportedWithWebsite ?? 0;
  }

  async function fetchCanonicalDirectoryCounts(fetchImpl) {
    if (typeof fetchImpl !== 'function') throw new Error('Canonical directory fetch is unavailable.');
    const entries = await Promise.all(Object.entries(CANONICAL_CATEGORIES).map(async ([key, category]) => {
      const params = new URLSearchParams({
        categorie: category,
        limit: '1',
        after: '0',
      });
      const response = await fetchImpl(`${DIRECTORY_API_URL}?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response?.ok) throw new Error(`Canonical directory count failed for ${category}.`);
      const payload = await response.json();
      const count = nonNegativeCount(payload?.total);
      if (!payload?.ok || payload?.total_is_exact !== true || count === null) {
        throw new Error(`Canonical directory count is not exact for ${category}.`);
      }
      return [key, count];
    }));
    return Object.fromEntries(entries);
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
    const count = value === null ? null : Number.isFinite(rawCount) ? rawCount : 0;
    const numberNode = element.querySelector('.stat-delta-number');
    const labelNode = element.querySelector('.stat-delta-label');
    if (numberNode) numberNode.textContent = count === null ? '—' : `${count >= 0 ? '+' : ''}${numberFormat.format(count)}`;
    if (labelNode) labelNode.textContent = '60m';
    element.classList.toggle('is-zero', count === 0);
    element.classList.toggle('is-negative', count < 0);
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
    if (labelNode) labelNode.textContent = '60m';
  }

  function renderControlRoomLast60(element, activity) {
    if (!element) return;
    const counts = {};
    for (const [key, sign, label] of [
      ['added', '+', 'Binnengekomen'], ['removed', '−', 'Afgehandeld'],
    ]) {
      const raw = activity?.[key];
      const count = raw === null || raw === undefined ? NaN : Number(raw);
      counts[key] = Number.isFinite(count) && count >= 0 ? count : null;
      const node = element.querySelector(`.stat-delta-${key}`);
      if (node) {
        const formatted = counts[key] === null ? '—' : numberFormat.format(counts[key]);
        node.textContent = `${sign}${formatted}`;
        node.setAttribute('aria-label', `${label}: ${counts[key] === null ? 'onbekend' : formatted}`);
      }
    }
    element.classList.toggle('is-zero', counts.added === 0 && counts.removed === 0);
  }

  function createController(deps = {}) {
    const documentRef = deps.document;
    const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : () => null;
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const windowRef = deps.window || {};
    const fetchImpl = typeof deps.fetchImpl === 'function'
      ? deps.fetchImpl
      : typeof windowRef.fetch === 'function'
        ? windowRef.fetch.bind(windowRef)
        : null;
    let canonicalCounts = null;
    let canonicalRefreshPromise = null;
    const elements = {
      treatedTotal: documentRef.getElementById('companies-treated'),
      usableTotal: documentRef.getElementById('companies-usable'),
      withWebsiteTotal: documentRef.getElementById('companies-with-website'),
      withoutWebsiteTotal: documentRef.getElementById('companies-without-website'),
      successfulFound: documentRef.getElementById('companies-successful-found'),
      successfulFoundLast60: documentRef.getElementById('companies-successful-found-last60'),
      declaredUnusable: documentRef.getElementById('companies-declared-unusable'),
      declaredUnusableLast60: documentRef.getElementById('companies-declared-unusable-last60'),
      controlRoom: documentRef.getElementById('companies-control-room'),
      controlRoomLast60: documentRef.getElementById('companies-control-room-last60'),
      treated: documentRef.getElementById('companies-treated-last60'),
      usable: documentRef.getElementById('companies-usable-last60'),
      withWebsite: documentRef.getElementById('companies-with-website-last60'),
      withoutWebsite: documentRef.getElementById('companies-without-website-last60'),
      unusableGrade1: documentRef.getElementById('companies-unusable-grade-1'),
      unusableGrade2: documentRef.getElementById('companies-unusable-grade-2'),
      unusableGrade1Last60: documentRef.getElementById('companies-unusable-grade-1-last60'),
      unusableGrade2Last60: documentRef.getElementById('companies-unusable-grade-2-last60'),
    };

    function countOrFallback(key, fallback) {
      const canonical = nonNegativeCount(canonicalCounts?.[key]);
      if (canonical !== null) return canonical;
      const fallbackCount = nonNegativeCount(fallback);
      return fallbackCount ?? 0;
    }

    // textContent replaces the text node even when its value is unchanged.
    // The totals are observed below, so a redundant write would schedule this
    // renderer again forever and starve loading, painting and user input.
    function renderCount(element, value) {
      if (!element) return;
      const text = numberFormat.format(value);
      if (element.textContent !== text) element.textContent = text;
    }

    function renderMetrics() {
      const snapshot = getSnapshot();
      if (!snapshot?.state && !canonicalCounts) return;
      const scraperState = snapshot?.state || {};
      const last60 = getLast60Minutes(snapshot, now());
      const unusableGrades = scraperState.unusable_grades || {};
      const unusableGradeLast60 = last60.unusable_grades || {};
      const unusableGradeActivity = last60.unusable_grade_activity || {};

      if (elements.withWebsiteTotal) {
        renderCount(elements.withWebsiteTotal,
          countOrFallback('withWebsite', getAvailableWithWebsiteCount(snapshot)),
        );
      }
      if (elements.withoutWebsiteTotal) {
        renderCount(elements.withoutWebsiteTotal,
          countOrFallback('withoutWebsite', scraperState.without_website),
        );
      }
      if (elements.usableTotal) {
        renderCount(elements.usableTotal,
          countOrFallback('usable', scraperState.usable),
        );
      }
      if (elements.treatedTotal) {
        const treatedFallback = Number(
          scraperState.treated ??
            sumCounts(
              scraperState.with_website,
              scraperState.without_website,
              scraperState.unusable,
            ),
        );
        renderCount(elements.treatedTotal,
          countOrFallback('treated', Number.isFinite(treatedFallback) ? Math.max(0, treatedFallback) : 0),
        );
      }
      if (elements.successfulFound) {
        renderCount(elements.successfulFound,
          countOrFallback('successfulFound', scraperState.declared_usable),
        );
      }
      if (elements.declaredUnusable) {
        renderCount(elements.declaredUnusable,
          countOrFallback('declaredUnusable', scraperState.declared_unusable),
        );
      }
      if (elements.controlRoom) {
        renderCount(elements.controlRoom,
          countOrFallback('controlRoom', scraperState.control_room),
        );
      }
      renderLast60Delta(elements.successfulFoundLast60, last60.declared_usable);
      renderLast60Delta(elements.declaredUnusableLast60, last60.declared_unusable);
      renderControlRoomLast60(elements.controlRoomLast60, last60.control_room_activity);
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

    async function refreshCanonicalCounts() {
      if (!fetchImpl) return false;
      if (canonicalRefreshPromise) return canonicalRefreshPromise;
      canonicalRefreshPromise = fetchCanonicalDirectoryCounts(fetchImpl)
        .then((counts) => {
          canonicalCounts = counts;
          renderMetrics();
          return true;
        })
        .catch(() => false)
        .finally(() => {
          canonicalRefreshPromise = null;
        });
      return canonicalRefreshPromise;
    }

    return {
      renderMetrics,
      refreshCanonicalCounts,
      getCanonicalCounts: () => canonicalCounts && { ...canonicalCounts },
    };
  }

  function start(deps = {}) {
    const controller = createController(deps);
    controller.renderMetrics();
    void controller.refreshCanonicalCounts();
    deps.window.addEventListener('kvk-upload-completed', () => { void controller.refreshCanonicalCounts(); });
    const treatedTotal = deps.document.getElementById('companies-treated');
    if (treatedTotal && typeof deps.window.MutationObserver === 'function') {
      const treatedObserver = new deps.window.MutationObserver(controller.renderMetrics);
      treatedObserver.observe(treatedTotal, { childList: true, characterData: true, subtree: true });
      controller.treatedObserver = treatedObserver;
    }
    const withWebsiteTotal = deps.document.getElementById('companies-with-website');
    if (withWebsiteTotal && typeof deps.window.MutationObserver === 'function') {
      const withWebsiteObserver = new deps.window.MutationObserver(controller.renderMetrics);
      withWebsiteObserver.observe(withWebsiteTotal, { childList: true, characterData: true, subtree: true });
      controller.withWebsiteObserver = withWebsiteObserver;
    }
    // Wait while the user selects text, so a re-render never clears the selection.
    deps.window.setInterval(() => { if (!deps.window.SoftoraKvkSelectionPause?.isSelecting()) controller.renderMetrics(); }, 1000);
    deps.window.setInterval(() => { void controller.refreshCanonicalCounts(); }, CANONICAL_REFRESH_INTERVAL_MS);
    deps.window.addEventListener('focus', () => {
      controller.renderMetrics();
      void controller.refreshCanonicalCounts();
    });
    deps.document.addEventListener('visibilitychange', () => {
      if (!deps.document.hidden) {
        controller.renderMetrics();
        void controller.refreshCanonicalCounts();
      }
    });
    return controller;
  }

  return {
    CANONICAL_CATEGORIES,
    createController,
    fetchCanonicalDirectoryCounts,
    getAvailableWithWebsiteCount,
    getLast60Minutes,
    renderLast60Delta,
    renderUnusableGradeLast60,
    start,
  };
});
