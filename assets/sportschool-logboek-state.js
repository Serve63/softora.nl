(function initSportschoolLogbookState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SOURCE_FIELDS = ['title', 'notes', 'sets', 'reps', 'kg'];

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
    mergeExerciseSource,
    readCanonicalExerciseSource,
    reconcileExerciseSources,
    sourceValuesEqual,
  };
});
