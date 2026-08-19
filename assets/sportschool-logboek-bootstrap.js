(() => {
  const STORAGE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const VERSION = 1;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeRemoteSnapshot(remoteSnapshot, localSnapshot) {
    if (!isObject(remoteSnapshot) || !isObject(remoteSnapshot.days)) return null;

    const localDays = isObject(localSnapshot?.days) ? localSnapshot.days : {};
    const mergedDays = { ...remoteSnapshot.days };
    STORAGE_DAYS.forEach((day) => {
      const localDay = localDays[day];
      if (!isObject(localDay) || !Array.isArray(localDay.orders)) return;

      const remoteDay = remoteSnapshot.days[day];
      const remoteOrders = remoteDay?.orders;
      if (localDay.orders.length > 0 || !Array.isArray(remoteOrders) || remoteOrders.length === 0) {
        mergedDays[day] = localDay;
      }
    });

    const remoteSources = isObject(remoteSnapshot.exerciseSources) ? remoteSnapshot.exerciseSources : {};
    const localSources = isObject(localSnapshot?.exerciseSources) ? localSnapshot.exerciseSources : {};
    return {
      ...remoteSnapshot,
      remoteBootstrapVersion: VERSION,
      exerciseSources: { ...remoteSources, ...localSources },
      days: mergedDays,
    };
  }

  const api = Object.freeze({ VERSION, mergeRemoteSnapshot });
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SoftoraSportschoolLogbookBootstrap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
