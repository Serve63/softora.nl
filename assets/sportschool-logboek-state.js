(function initSportschoolLogbookState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SOURCE_FIELDS = ['title', 'notes', 'sets', 'reps', 'kg'];
  const TRAINING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function padDatePart(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
  }

  function readLocalDate(dateKey) {
    const normalized = String(dateKey || '').trim();
    if (!DATE_KEY_PATTERN.test(normalized)) return null;
    const [year, month, day] = normalized.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    return localDateKey(date) === normalized ? date : null;
  }

  function trainingDateKey(day, referenceDate = new Date()) {
    const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (!Number.isFinite(date.getTime())) return '';
    const targetIndex = TRAINING_DAYS.indexOf(String(day || '').trim().toLowerCase());
    if (targetIndex < 0) return localDateKey(date);
    const currentIndex = (date.getDay() + 6) % 7;
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    targetDate.setDate(targetDate.getDate() + targetIndex - currentIndex);
    return localDateKey(targetDate);
  }

  function dayForDateKey(dateKey) {
    const date = readLocalDate(dateKey);
    return date ? TRAINING_DAYS[(date.getDay() + 6) % 7] : '';
  }

  function normalizeTrainingDayCompletions(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = {};
    Object.entries(value).forEach(([dateKey, entry]) => {
      const day = dayForDateKey(dateKey);
      if (!day || !entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const rawExercises = entry.exercises;
      if (!rawExercises || typeof rawExercises !== 'object' || Array.isArray(rawExercises)) return;
      const exercises = {};
      Object.entries(rawExercises).forEach(([order, completed]) => {
        const numericOrder = Number(order);
        if (completed === true && Number.isInteger(numericOrder) && numericOrder > 0) {
          exercises[String(numericOrder)] = true;
        }
      });
      if (Object.keys(exercises).length > 0) normalized[dateKey] = { day, exercises };
    });
    return normalized;
  }

  function isTrainingExerciseCompleted(completions, dateKey, order) {
    const normalizedOrder = Number(order);
    if (!Number.isInteger(normalizedOrder) || normalizedOrder <= 0) return false;
    return normalizeTrainingDayCompletions(completions)[dateKey]?.exercises?.[String(normalizedOrder)] === true;
  }

  function updateTrainingExerciseCompletion(completions, dateKey, order, completed) {
    const normalized = normalizeTrainingDayCompletions(completions);
    const day = dayForDateKey(dateKey);
    const normalizedOrder = Number(order);
    if (!day || !Number.isInteger(normalizedOrder) || normalizedOrder <= 0) {
      return { completions: normalized, changed: false };
    }
    const orderKey = String(normalizedOrder);
    const wasCompleted = normalized[dateKey]?.exercises?.[orderKey] === true;
    const shouldComplete = completed === true;
    if (wasCompleted === shouldComplete) return { completions: normalized, changed: false };

    if (shouldComplete) {
      normalized[dateKey] = {
        day,
        exercises: {
          ...(normalized[dateKey]?.exercises || {}),
          [orderKey]: true,
        },
      };
    } else {
      const exercises = { ...(normalized[dateKey]?.exercises || {}) };
      delete exercises[orderKey];
      if (Object.keys(exercises).length > 0) normalized[dateKey] = { day, exercises };
      else delete normalized[dateKey];
    }
    return { completions: normalized, changed: true };
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
    isTrainingExerciseCompleted,
    localDateKey,
    mergeExerciseSource,
    normalizeTrainingDayCompletions,
    readCanonicalExerciseSource,
    reconcileExerciseSources,
    sourceValuesEqual,
    trainingDateKey,
    updateTrainingExerciseCompletion,
  };
});
