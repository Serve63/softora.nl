(() => {
  const STORAGE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const VERSION = 1;
  const REMOTE_STORAGE_KEY = 'sportschool_logboek_v1';
  const LOCAL_STORAGE_KEY = 'softora_sportschool_logboek_v1';

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function readRemoteSnapshotValue(values) {
    if (!isObject(values)) return null;
    return values[REMOTE_STORAGE_KEY] ?? values[LOCAL_STORAGE_KEY] ?? null;
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

  const api = Object.freeze({ VERSION, mergeRemoteSnapshot, readRemoteSnapshotValue });
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SoftoraSportschoolLogbookBootstrap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
