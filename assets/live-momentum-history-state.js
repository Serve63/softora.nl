((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMomentumHistoryState = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function createController(options = {}) {
    const stateKey = String(options.stateKey || '');
    const maxRetiredGoals = Math.max(1, Number(options.maxRetiredGoals) || 1);
    const period = options.period || {};
    const normalizeGoal = options.normalizeGoal;
    const getGoals = options.getGoals;
    let values = {};
    let retiredGoals = [];

    function normalizeRetiredGoal(goal, index) {
      const normalized = normalizeGoal(goal, index);
      const requestedEnd = Number(goal?.activeUntilDay);
      const activeUntilDay = Number.isInteger(requestedEnd)
        && requestedEnd >= normalized.activeFromDay
        && requestedEnd <= period.lastDay
        ? requestedEnd
        : null;
      return activeUntilDay ? { ...normalized, activeUntilDay } : null;
    }

    function serializeRetiredGoals() {
      return retiredGoals.map((goal) => ({
        id: goal.id,
        label: goal.label,
        iconKey: goal.iconKey,
        doneDays: goal.doneDays,
        emptyDays: goal.emptyDays,
        trackedDays: goal.trackedDays,
        touchedDays: goal.touchedDays,
        activeFromDay: goal.activeFromDay,
        activeUntilDay: goal.activeUntilDay
      }));
    }

    function serializeGoal(goal) {
      return {
        id: goal.id,
        label: goal.label,
        iconKey: goal.iconKey,
        doneDays: goal.doneDays,
        emptyDays: goal.emptyDays,
        trackedDays: goal.trackedDays,
        touchedDays: goal.touchedDays,
        activeFromDay: goal.activeFromDay
      };
    }

    function buildSnapshot() {
      return {
        version: options.version,
        period: options.periodKey,
        endGameMissionCard: options.getLegacyMissionState(),
        endGameCards: options.getEndGameState(),
        heldDays: options.getHeldDays?.() || [],
        goals: getGoals().map(serializeGoal),
        retiredGoals: serializeRetiredGoals(),
        updatedAt: new Date().toISOString()
      };
    }

    function hydrate(nextValues, nextRetiredGoals) {
      values = { ...(nextValues || {}) };
      retiredGoals = Array.isArray(nextRetiredGoals) ? nextRetiredGoals : [];
    }

    function remember(snapshot) {
      values = { ...values, [stateKey]: JSON.stringify(snapshot) };
    }

    function publish(isReady) {
      const currentValues = isReady
        ? { ...values, [stateKey]: JSON.stringify(buildSnapshot()) }
        : values;
      document.dispatchEvent(new CustomEvent('softora:momentum-history-state', {
        detail: { values: currentValues, now: new Date().toISOString() }
      }));
    }

    function retire(goal, today) {
      const activeUntilDay = Math.max(0, (today || period.startDay) - 1);
      if (!goal || activeUntilDay < goal.activeFromDay) return;
      retiredGoals = retiredGoals
        .filter((entry) => entry.id !== goal.id)
        .concat({ ...goal, activeUntilDay })
        .slice(-maxRetiredGoals);
    }

    function isActiveRow(row, day) {
      return Number(row?.dataset.activeFromDay || period.startDay) <= day;
    }

    function resolveActiveFromDay(goal, evidenceDays) {
      const requestedDay = Number(goal?.activeFromDay);
      return Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= period.lastDay
        ? requestedDay
        : evidenceDays[0] || period.startDay;
    }

    return {
      hydrate,
      buildSnapshot,
      isActiveRow,
      normalizeRetiredGoal,
      publish,
      remember,
      resolveActiveFromDay,
      retire,
      serializeRetiredGoals
    };
  }

  return { createController };
});
