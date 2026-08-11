(function initSportschoolLogbookState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SOURCE_FIELDS = ['title', 'notes', 'sets', 'reps', 'kg'];
  const COMPLETION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function normalizeCompletionDates(value) {
    const candidates = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).filter(([, completed]) => completed).map(([dateKey]) => dateKey)
        : [];
    return [...new Set(candidates.map((dateKey) => String(dateKey || '').trim()))]
      .filter((dateKey) => COMPLETION_DATE_PATTERN.test(dateKey))
      .sort();
  }

  function isCompletedOnDate(exercise = {}, dateKey) {
    const normalizedDateKey = String(dateKey || '').trim();
    return normalizeCompletionDates(exercise.completedDates).includes(normalizedDateKey);
  }

  function setCompletedOnDate(exercise = {}, dateKey, completed) {
    const normalizedDateKey = String(dateKey || '').trim();
    const dates = normalizeCompletionDates(exercise.completedDates);
    if (!COMPLETION_DATE_PATTERN.test(normalizedDateKey)) {
      return { ...exercise, completedDates: dates };
    }
    const nextDates = completed
      ? [...new Set([...dates, normalizedDateKey])].sort()
      : dates.filter((storedDateKey) => storedDateKey !== normalizedDateKey);
    return { ...exercise, completedDates: nextDates };
  }

  function hasOwnSource(sources, exerciseKey) {
    return Boolean(
      sources &&
        Object.prototype.hasOwnProperty.call(sources, exerciseKey) &&
        sources[exerciseKey] &&
        typeof sources[exerciseKey] === 'object' &&
        !Array.isArray(sources[exerciseKey])
    );
  }

  function sourceValuesEqual(left = {}, right = {}) {
    return SOURCE_FIELDS.every((field) => String(left[field] ?? '') === String(right[field] ?? ''));
  }

  function mergeExerciseSource(existing, incoming, fallback = {}) {
    if (!existing) return { ...incoming };
    const merged = { ...existing };
    ['notes', 'sets', 'reps', 'kg'].forEach((field) => {
      const incomingValue = String(incoming[field] ?? '');
      const existingValue = String(existing[field] ?? '');
      const fallbackValue = String(fallback[field] ?? '');
      if (!incomingValue) return;
      if (!existingValue || (existingValue === fallbackValue && incomingValue !== fallbackValue)) {
        merged[field] = incomingValue;
      }
    });
    if (!merged.title && incoming.title) merged.title = incoming.title;
    return merged;
  }

  function readCanonicalExerciseSource(sources, exerciseKey, incoming) {
    if (!hasOwnSource(sources, exerciseKey)) sources[exerciseKey] = { ...incoming };
    return sources[exerciseKey];
  }

  function reconcileExerciseSources(canonicalSources = {}, entries = []) {
    const sources = Object.fromEntries(
      Object.entries(canonicalSources).map(([exerciseKey, source]) => [exerciseKey, { ...source }])
    );
    const canonicalKeys = new Set(Object.keys(sources));

    entries.forEach((entry) => {
      const exerciseKey = String(entry?.exerciseKey || '').trim();
      if (!exerciseKey || canonicalKeys.has(exerciseKey)) return;
      sources[exerciseKey] = mergeExerciseSource(sources[exerciseKey], entry.source || {}, entry.fallback || {});
    });

    const alignedEntries = entries.map((entry) => ({
      ...entry,
      source: { ...(sources[entry.exerciseKey] || entry.source || {}) },
    }));
    const repaired = entries.some(
      (entry, index) => !sourceValuesEqual(entry.source, alignedEntries[index].source)
    );

    return { exerciseSources: sources, entries: alignedEntries, repaired };
  }

  return {
    isCompletedOnDate,
    mergeExerciseSource,
    normalizeCompletionDates,
    readCanonicalExerciseSource,
    reconcileExerciseSources,
    setCompletedOnDate,
    sourceValuesEqual,
  };
});
