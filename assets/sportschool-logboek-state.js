(function initSportschoolLogbookState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SOURCE_FIELDS = ['title', 'notes', 'sets', 'reps', 'kg'];
  const COMPLETION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const FORM_HISTORY_LENGTH = 3;
  const FORM_STATUSES = ['down', 'same', 'up'];
  const FORM_STATUS_CYCLE = ['', ...FORM_STATUSES];

  function normalizeFormStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return FORM_STATUSES.includes(status) ? status : '';
  }

  function nextFormStatus(value) {
    const currentIndex = FORM_STATUS_CYCLE.indexOf(normalizeFormStatus(value));
    return FORM_STATUS_CYCLE[(currentIndex + 1) % FORM_STATUS_CYCLE.length];
  }

  function normalizeFormSessionHistory(value) {
    const entries = Array.isArray(value) ? value : [];
    const legacyEntries = [];
    const datedEntries = new Map();

    entries.forEach((entry) => {
      const status = normalizeFormStatus(typeof entry === 'string' ? entry : entry?.status);
      if (!status) return;
      const date = String(typeof entry === 'object' && entry ? entry.date || '' : '').trim();
      if (COMPLETION_DATE_PATTERN.test(date)) {
        datedEntries.set(date, { date, status });
      } else {
        legacyEntries.push({ status });
      }
    });

    const datedHistory = [...datedEntries.values()].sort((left, right) => left.date.localeCompare(right.date));
    return [...legacyEntries, ...datedHistory].slice(-FORM_HISTORY_LENGTH);
  }

  function padFormSessionSlots(entries) {
    const padding = Array.from(
      { length: Math.max(0, FORM_HISTORY_LENGTH - entries.length) },
      () => ({ date: '', status: '', isCurrent: false })
    );
    return [...padding, ...entries].slice(-FORM_HISTORY_LENGTH);
  }

  function buildFormSessionSlots(value, dateKey, includeCurrentSlot) {
    const history = normalizeFormSessionHistory(value);
    const normalizedDateKey = String(dateKey || '').trim();
    if (!includeCurrentSlot || !COMPLETION_DATE_PATTERN.test(normalizedDateKey)) {
      return padFormSessionSlots(
        history.map((entry) => ({ ...entry, isCurrent: false }))
      );
    }

    const current = history.find((entry) => entry.date === normalizedDateKey);
    const previous = history
      .filter((entry) => entry.date !== normalizedDateKey)
      .slice(-(FORM_HISTORY_LENGTH - 1))
      .map((entry) => ({ ...entry, isCurrent: false }));
    return padFormSessionSlots([
      ...previous,
      current
        ? { ...current, isCurrent: true }
        : { date: normalizedDateKey, status: '', isCurrent: true },
    ]);
  }

  function setFormSessionStatus(value, dateKey, status) {
    const history = normalizeFormSessionHistory(value);
    const normalizedDateKey = String(dateKey || '').trim();
    const requestedStatus = String(status || '').trim().toLowerCase();
    if (
      !COMPLETION_DATE_PATTERN.test(normalizedDateKey) ||
      (requestedStatus && !FORM_STATUSES.includes(requestedStatus))
    ) {
      return history;
    }
    const historyWithoutDate = history.filter((entry) => entry.date !== normalizedDateKey);
    if (!requestedStatus) return normalizeFormSessionHistory(historyWithoutDate);
    return normalizeFormSessionHistory([
      ...historyWithoutDate,
      { date: normalizedDateKey, status: requestedStatus },
    ]);
  }

  function legacyFormHistoryFromSessions(value) {
    return buildFormSessionSlots(value, '', false).map((entry) => entry.status);
  }

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
    buildFormSessionSlots,
    isCompletedOnDate,
    legacyFormHistoryFromSessions,
    mergeExerciseSource,
    nextFormStatus,
    normalizeCompletionDates,
    normalizeFormSessionHistory,
    readCanonicalExerciseSource,
    reconcileExerciseSources,
    setCompletedOnDate,
    setFormSessionStatus,
    sourceValuesEqual,
  };
});
