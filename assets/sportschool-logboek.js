(() => {
  const LOCAL_STORAGE_KEY = 'softora_sportschool_logboek_v1';
  const PUBLIC_BOOTSTRAP_URL = '/api/sportschool-logboek-public';
  const LOCAL_SAVE_DELAY_MS = 150;
  const REORDER_START_THRESHOLD = 6;
  const DRAFT_EXERCISE_TITLE = 'NIEUWE OEFENING';
  const DEFAULT_DAY_EXERCISES = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
  const DAYS = [
    { id: 'monday', title: 'Maandag' },
    { id: 'tuesday', title: 'Dinsdag' },
    { id: 'wednesday', title: 'Woensdag' },
    { id: 'thursday', title: 'Donderdag' },
    { id: 'friday', title: 'Vrijdag' },
    { id: 'saturday', title: 'Zaterdag' },
    { id: 'sunday', title: 'Zondag' },
  ];
  const STORAGE_DAYS = DAYS.map((day) => day.id);
  const LEGACY_NOTE_TEXTS = new Set([
    'NOTITIES',
    '3 SETS - 8 HERHALINGEN',
    '3 SETS - 10 HERHALINGEN',
    '3 SETS - 12 HERHALINGEN',
    '3 SETS - 8 TOT 10 HERHALINGEN',
    '4 SETS - 10 HERHALINGEN',
    '4 SETS - 8 TOT 10 HERHALINGEN',
    '3 RONDES - 45 SECONDEN',
  ]);
  const FORM_HISTORY_LENGTH = 3;
  const FORM_STATUSES = new Set(['up', 'down', 'same']);

  const app = document.querySelector('[data-gym-app]');
  if (!app) return;
  const logbookStateApi = window.SoftoraSportschoolLogbookState;
  const logbookInputApi = window.SoftoraSportschoolLogbookInput;
  const logbookGestureApi = window.SoftoraSportschoolLogbookGesture;
  const logbookBootstrapApi = window.SoftoraSportschoolLogbookBootstrap;
  if (!logbookStateApi || !logbookInputApi || !logbookGestureApi || !logbookBootstrapApi) return;
  const REMOTE_BOOTSTRAP_VERSION = logbookBootstrapApi.VERSION;

  const list = app.querySelector('[data-exercise-list]');
  const restDay = app.querySelector('[data-rest-day]');
  const loadStatusMessage = app.querySelector('[data-logbook-status]');
  const dayTrigger = app.querySelector('[data-day-trigger]');
  const dayPicker = app.querySelector('[data-day-picker]');
  const dayGrid = app.querySelector('[data-day-grid]');
  const addButton = app.querySelector('[data-add-exercise]');
  const closeDays = app.querySelector('[data-close-days]');
  let selectedDay = currentWeekday();
  let isApplyingStoredState = false;
  let isReady = false;
  let localSaveTimer = null;
  let pendingLocalSave = false;
  let stateRevision = 0;
  let lastSavedRevision = 0;
  let logbookState = createDefaultState();
  let logbookLoadStatus = 'loading';
  let remoteBootstrapVersion = 0;
  let cleanedLegacyNotesDuringLoad = false;
  let shouldPersistLoadedSnapshot = false;
  let lastRenderedDateKey = currentDateKey();

  addButton.disabled = true;

  function upper(value) {
    return String(value || '').toLocaleUpperCase('nl-NL');
  }

  function normalizeExerciseTitle(value) {
    return upper(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeFormHistory(value) {
    const entries = Array.isArray(value) ? value : [];
    return Array.from({ length: FORM_HISTORY_LENGTH }, (_, index) => {
      const status = String(entries[index] || '').trim().toLowerCase();
      return FORM_STATUSES.has(status) ? status : '';
    });
  }

  function exerciseSlotKey(day, order) {
    return `slot:${storageDay(day)}:${Number(order) || 0}`;
  }

  function exerciseKeyForTitle(title, fallbackKey = '') {
    const normalizedTitle = normalizeExerciseTitle(title);
    if (!normalizedTitle || normalizedTitle === DRAFT_EXERCISE_TITLE) return fallbackKey;
    return `name:${normalizedTitle}`;
  }

  function ensureExerciseSources(state = logbookState) {
    if (!state.exerciseSources || typeof state.exerciseSources !== 'object' || Array.isArray(state.exerciseSources)) {
      state.exerciseSources = {};
    }
    return state.exerciseSources;
  }

  function cleanNotes(value, options = {}) {
    const text = String(value || '').trim();
    const normalized = upper(text).replace(/\s+/g, ' ');
    if (LEGACY_NOTE_TEXTS.has(normalized)) {
      if (options.markLegacyNotes) cleanedLegacyNotesDuringLoad = true;
      return '';
    }
    return value;
  }

  function currentWeekday() {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
  }

  function currentDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function storageDay(day) {
    return day === 'today' ? currentWeekday() : day;
  }

  function defaultExerciseForDay(day, order) {
    const storedDay = storageDay(day);
    return DEFAULT_DAY_EXERCISES[storedDay]?.find((exercise) => exercise.order === order) || {
      order,
      title: DRAFT_EXERCISE_TITLE,
      notes: '',
      sets: '',
      reps: '',
      kg: '',
    };
  }

  function normalizeExercise(day, order, exercise = {}, options = {}) {
    const fallback = defaultExerciseForDay(day, order);
    const hasTitle = Object.prototype.hasOwnProperty.call(exercise, 'title') && String(exercise.title).trim() !== '';
    const hasNotes = Object.prototype.hasOwnProperty.call(exercise, 'notes');
    const rawNotes = hasNotes ? exercise.notes : fallback.notes;
    return {
      title: upper(hasTitle ? exercise.title : fallback.title),
      notes: upper(cleanNotes(rawNotes, options)),
      sets: String(exercise.sets ?? fallback.sets ?? ''),
      reps: String(exercise.reps ?? fallback.reps ?? ''),
      kg: String(exercise.kg ?? fallback.kg ?? ''),
    };
  }

  function normalizeExerciseSource(day, order, exercise = {}, options = {}) {
    const normalized = normalizeExercise(day, order, exercise, options);
    return {
      title: normalized.title,
      notes: normalized.notes,
      sets: normalized.sets,
      reps: normalized.reps,
      kg: normalized.kg,
    };
  }

  function createDefaultDayState(day, state = logbookState) {
    const exercises = DEFAULT_DAY_EXERCISES[storageDay(day)] || [];
    const sources = ensureExerciseSources(state);
    return {
      orders: exercises.map((exercise) => exercise.order),
      exercises: Object.fromEntries(
        exercises.map((exercise) => {
          const normalized = normalizeExerciseSource(day, exercise.order, exercise);
          const exerciseKey = exerciseKeyForTitle(normalized.title, exerciseSlotKey(day, exercise.order));
          if (!sources[exerciseKey]) sources[exerciseKey] = normalized;
          return [
            String(exercise.order),
            { exerciseKey, ...normalized, completedDates: [], formHistory: normalizeFormHistory() },
          ];
        })
      ),
    };
  }

  function createDefaultState() {
    const state = { version: 2, exerciseSources: {}, days: {} };
    STORAGE_DAYS.forEach((day) => {
      state.days[day] = createDefaultDayState(day, state);
    });
    return state;
  }

  function getDayState(day) {
    const storedDay = storageDay(day);
    if (!logbookState.days[storedDay]) logbookState.days[storedDay] = createDefaultDayState(storedDay);
    return logbookState.days[storedDay];
  }

  function resolveExerciseKey(day, order, exercise = {}) {
    const normalizedTitle = normalizeExerciseTitle(exercise.title || exercise.name || '');
    const titleKey = exerciseKeyForTitle(normalizedTitle, '');
    if (titleKey) return titleKey;
    const explicitKey = String(exercise.exerciseKey || '').trim();
    return explicitKey || exerciseSlotKey(day, order);
  }

  function getExerciseSource(day, order, stored = {}, options = {}) {
    const normalized = normalizeExerciseSource(day, order, stored, options);
    const exerciseKey = resolveExerciseKey(day, order, { ...normalized, ...stored });
    const sources = ensureExerciseSources();
    return {
      exerciseKey,
      source: logbookStateApi.readCanonicalExerciseSource(sources, exerciseKey, normalized),
    };
  }

  function readOrders(day) {
    const dayState = getDayState(day);
    return Array.isArray(dayState.orders) ? dayState.orders : [];
  }

  function ordersChanged(previousOrders, nextOrders) {
    if (!Array.isArray(previousOrders) || previousOrders.length !== nextOrders.length) return true;
    return previousOrders.some((order, index) => order !== nextOrders[index]);
  }

  function markStateChanged(options = {}) {
    if (isApplyingStoredState || !isReady) return;
    stateRevision += 1;
    if (!options.silent) scheduleLocalSave();
  }

  function saveOrders(day, orders, options = {}) {
    const uniqueOrders = [];
    orders.forEach((order) => {
      if (Number.isFinite(order) && !uniqueOrders.includes(order)) uniqueOrders.push(order);
    });
    const dayState = getDayState(day);
    const previousOrders = Array.isArray(dayState.orders) ? dayState.orders.slice() : [];
    let changed = ordersChanged(previousOrders, uniqueOrders);
    dayState.orders = uniqueOrders;
    uniqueOrders.forEach((order) => {
      const key = String(order);
      if (!dayState.exercises[key]) {
        const normalized = normalizeExerciseSource(day, order);
        const exerciseKey = exerciseKeyForTitle(normalized.title, exerciseSlotKey(day, order));
        ensureExerciseSources()[exerciseKey] = normalized;
        dayState.exercises[key] = {
          exerciseKey,
          ...normalized,
          completedDates: [],
          formHistory: normalizeFormHistory(),
        };
        changed = true;
      }
    });
    if (changed) markStateChanged({ silent: options.silent });
  }

  function readExercise(day, order) {
    const dayState = getDayState(day);
    const stored = dayState.exercises?.[String(order)] || {};
    const { exerciseKey, source } = getExerciseSource(day, order, stored);
    const completedDates = logbookStateApi.normalizeCompletionDates(stored.completedDates);
    const formHistory = normalizeFormHistory(stored.formHistory);
    dayState.exercises[String(order)] = { exerciseKey, ...source, completedDates, formHistory };
    return {
      order,
      exerciseKey,
      title: source.title,
      notes: source.notes,
      sets: source.sets,
      reps: source.reps,
      kg: source.kg,
      completedDates,
      formHistory,
      completed: logbookStateApi.isCompletedOnDate({ completedDates }, currentDateKey()),
    };
  }

  function setFormHistory(day, order, slotIndex, status) {
    const dayState = getDayState(day);
    const key = String(order);
    const current = readExercise(day, order);
    const formHistory = normalizeFormHistory(current.formHistory);
    const nextStatus = FORM_STATUSES.has(status) ? status : '';
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= FORM_HISTORY_LENGTH) return;
    if (formHistory[slotIndex] === nextStatus) return;
    formHistory[slotIndex] = nextStatus;
    dayState.exercises[key] = {
      ...dayState.exercises[key],
      formHistory,
    };
    markStateChanged();
  }

  function setExerciseCompleted(day, order, completed) {
    const dayState = getDayState(day);
    const key = String(order);
    const current = readExercise(day, order);
    const next = logbookStateApi.setCompletedOnDate(current, currentDateKey(), completed);
    const previousDates = logbookStateApi.normalizeCompletionDates(dayState.exercises[key]?.completedDates);
    if (JSON.stringify(previousDates) === JSON.stringify(next.completedDates)) return current;
    dayState.exercises[key] = { ...dayState.exercises[key], completedDates: next.completedDates };
    markStateChanged();
    return readExercise(day, order);
  }

  function writeField(day, order, field, value) {
    const dayState = getDayState(day);
    const key = String(order);
    const targetField = field === 'name' ? 'title' : field === 'kilograms' ? 'kg' : field;
    if (!dayState.exercises[key]) dayState.exercises[key] = readExercise(day, order);
    let changed = false;
    if (targetField === 'title') {
      const title = normalizeExerciseTitle(value);
      const previousExercise = readExercise(day, order);
      const nextExerciseKey = exerciseKeyForTitle(title, exerciseSlotKey(day, order));
      const sources = ensureExerciseSources();
      sources[nextExerciseKey] = logbookStateApi.mergeExerciseSource(
        sources[nextExerciseKey],
        { ...previousExercise, title },
        normalizeExerciseSource(day, order)
      );
      const nextExercise = {
        exerciseKey: nextExerciseKey,
        ...sources[nextExerciseKey],
        completedDates: logbookStateApi.normalizeCompletionDates(previousExercise.completedDates),
        formHistory: normalizeFormHistory(previousExercise.formHistory),
      };
      changed =
        previousExercise.exerciseKey !== nextExercise.exerciseKey ||
        previousExercise.title !== nextExercise.title ||
        previousExercise.notes !== nextExercise.notes ||
        previousExercise.sets !== nextExercise.sets ||
        previousExercise.reps !== nextExercise.reps ||
        previousExercise.kg !== nextExercise.kg;
      dayState.exercises[key] = nextExercise;
    } else {
      const { exerciseKey, source } = getExerciseSource(day, order, dayState.exercises[key]);
      const nextValue = targetField === 'notes' ? upper(value) : value;
      changed = String(source[targetField] ?? '') !== String(nextValue ?? '');
      source[targetField] = nextValue;
      dayState.exercises[key] = {
        exerciseKey,
        ...source,
        completedDates: logbookStateApi.normalizeCompletionDates(dayState.exercises[key]?.completedDates),
        formHistory: normalizeFormHistory(dayState.exercises[key]?.formHistory),
      };
    }
    if (changed) markStateChanged();
  }

  function dayTitle(day) {
    if (storageDay(day) === currentWeekday()) return 'Vandaag';
    return DAYS.find((item) => item.id === storageDay(day))?.title || 'Vandaag';
  }

  function dayChoiceTitle(day) {
    return day.id === currentWeekday() ? 'Vandaag' : day.title;
  }

  function buildSnapshotFromState() {
    const days = {};
    const usedExerciseKeys = new Set();
    STORAGE_DAYS.forEach((day) => {
      const dayState = logbookState.days[day] || createDefaultDayState(day);
      const safeOrders = Array.isArray(dayState.orders) ? dayState.orders : [];
      days[day] = {
        orders: safeOrders,
        exercises: Object.fromEntries(
          safeOrders.map((order) => {
            const exercise = readExercise(day, order);
            usedExerciseKeys.add(exercise.exerciseKey);
            return [
              String(order),
              {
                exerciseKey: exercise.exerciseKey,
                title: exercise.title,
                notes: exercise.notes,
                sets: exercise.sets,
                reps: exercise.reps,
                kg: exercise.kg,
                completedDates: exercise.completedDates,
                formHistory: exercise.formHistory,
              },
            ];
          })
        ),
      };
    });
    const sources = ensureExerciseSources();
    const exerciseSources = {};
    usedExerciseKeys.forEach((exerciseKey) => {
      if (sources[exerciseKey]) exerciseSources[exerciseKey] = normalizeExerciseSource('monday', 0, sources[exerciseKey]);
    });

    const snapshot = {
      version: 2,
      updatedAt: new Date().toISOString(),
      exerciseSources,
      days,
    };
    if (remoteBootstrapVersion === REMOTE_BOOTSTRAP_VERSION) {
      snapshot.remoteBootstrapVersion = REMOTE_BOOTSTRAP_VERSION;
    }
    return snapshot;
  }

  function parseStoredSnapshot(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function snapshotHasExercises(snapshot) {
    return STORAGE_DAYS.some((day) => {
      const orders = snapshot?.days?.[day]?.orders;
      return Array.isArray(orders) && orders.length > 0;
    });
  }

  function snapshotHasExercisesForDay(snapshot, day) {
    const orders = snapshot?.days?.[storageDay(day)]?.orders;
    return Array.isArray(orders) && orders.length > 0;
  }

  function applyStoredSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    isApplyingStoredState = true;
    try {
      const canonicalSources = {};
      const nextDays = {};
      const entries = [];
      if (snapshot.exerciseSources && typeof snapshot.exerciseSources === 'object' && !Array.isArray(snapshot.exerciseSources)) {
        Object.entries(snapshot.exerciseSources).forEach(([exerciseKey, source]) => {
          const key = String(exerciseKey || '').trim();
          if (!key) return;
          canonicalSources[key] = normalizeExerciseSource('monday', 0, source, { markLegacyNotes: true });
        });
      } else {
        shouldPersistLoadedSnapshot = true;
      }
      STORAGE_DAYS.forEach((day) => {
        const dayState = snapshot.days?.[day];
        const hasStoredDay = dayState && typeof dayState === 'object';
        let orders;
        if (hasStoredDay) {
          orders = Array.isArray(dayState.orders)
            ? [...new Set(dayState.orders.map((order) => Number.parseInt(order, 10)).filter(Number.isFinite))]
            : [];
          if (!Array.isArray(dayState.orders)) shouldPersistLoadedSnapshot = true;
        } else {
          orders = (DEFAULT_DAY_EXERCISES[day] || []).map((exercise) => exercise.order);
          shouldPersistLoadedSnapshot = true;
        }
        nextDays[day] = { orders, exercises: {} };
        orders.forEach((order) => {
          const stored = hasStoredDay
            ? dayState.exercises?.[String(order)] || {}
            : defaultExerciseForDay(day, order);
          const normalized = normalizeExerciseSource(day, order, stored, { markLegacyNotes: true });
          const exerciseKey = resolveExerciseKey(day, order, { ...normalized, ...stored });
          entries.push({
            day,
            order,
            exerciseKey,
            source: normalized,
            fallback: normalizeExerciseSource(day, order),
            completedDates: logbookStateApi.normalizeCompletionDates(stored.completedDates),
            formHistory: normalizeFormHistory(stored.formHistory),
          });
          if (!stored.exerciseKey) shouldPersistLoadedSnapshot = true;
          if (!Array.isArray(stored.completedDates)) shouldPersistLoadedSnapshot = true;
          if (!Array.isArray(stored.formHistory)) shouldPersistLoadedSnapshot = true;
        });
      });
      const reconciled = logbookStateApi.reconcileExerciseSources(canonicalSources, entries);
      reconciled.entries.forEach(({ day, order, exerciseKey, source, completedDates, formHistory }) => {
        nextDays[day].exercises[String(order)] = {
          exerciseKey,
          ...source,
          completedDates: logbookStateApi.normalizeCompletionDates(completedDates),
          formHistory: normalizeFormHistory(formHistory),
        };
      });
      if (reconciled.repaired) shouldPersistLoadedSnapshot = true;
      logbookState = { version: 2, exerciseSources: reconciled.exerciseSources, days: nextDays };
      return true;
    } finally {
      isApplyingStoredState = false;
    }
  }

  function readLocalSnapshot() {
    try {
      return parseStoredSnapshot(window.localStorage?.getItem(LOCAL_STORAGE_KEY));
    } catch (_error) {
      return null;
    }
  }

  function loadLocalState() {
    cleanedLegacyNotesDuringLoad = false;
    shouldPersistLoadedSnapshot = false;
    const snapshot = readLocalSnapshot();
    remoteBootstrapVersion = Number(snapshot?.remoteBootstrapVersion) === REMOTE_BOOTSTRAP_VERSION
      ? REMOTE_BOOTSTRAP_VERSION
      : 0;
    if (snapshot) {
      applyStoredSnapshot(snapshot);
    } else {
      logbookState = createDefaultState();
      shouldPersistLoadedSnapshot = true;
    }
    stateRevision = 0;
    lastSavedRevision = 0;
    pendingLocalSave = false;
    if (cleanedLegacyNotesDuringLoad) shouldPersistLoadedSnapshot = true;
    return {
      snapshot,
      hasExercises: snapshotHasExercises(snapshot),
    };
  }

  async function loadRemoteState(localSnapshot) {
    try {
      const response = await window.fetch(PUBLIC_BOOTSTRAP_URL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null);
      const remoteSnapshot = parseStoredSnapshot(payload?.values?.[LOCAL_STORAGE_KEY]);
      if (!response.ok || !payload?.ok || !remoteSnapshot) return false;
      const hydratedSnapshot = logbookBootstrapApi.mergeRemoteSnapshot(remoteSnapshot, localSnapshot);
      if (!applyStoredSnapshot(hydratedSnapshot)) return false;
      remoteBootstrapVersion = REMOTE_BOOTSTRAP_VERSION;
      shouldPersistLoadedSnapshot = true;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scheduleLocalSave() {
    if (isApplyingStoredState || !isReady) return;
    window.clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(() => {
      persistLocalState();
    }, LOCAL_SAVE_DELAY_MS);
  }

  function persistLocalState(options = {}) {
    if (isApplyingStoredState || !isReady) return;
    window.clearTimeout(localSaveTimer);
    if (!options.force && stateRevision === lastSavedRevision) return;
    const revisionAtStart = stateRevision;
    const snapshotJson = JSON.stringify(buildSnapshotFromState());
    try {
      window.localStorage?.setItem(LOCAL_STORAGE_KEY, snapshotJson);
      lastSavedRevision = revisionAtStart;
      pendingLocalSave = false;
    } catch (_error) {
      pendingLocalSave = false;
    }
  }

  function flushLocalSave() {
    window.clearTimeout(localSaveTimer);
    if (stateRevision === lastSavedRevision && !pendingLocalSave) return;
    persistLocalState({ force: true });
  }

  function renderDayChoices() {
    dayGrid.replaceChildren(
      ...DAYS.map((day) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `day-choice${day.id === selectedDay ? ' is-selected' : ''}`;
        button.textContent = upper(dayChoiceTitle(day));
        button.addEventListener('click', () => {
          selectedDay = day.id;
          closeDayPicker();
          render();
        });
        return button;
      })
    );
  }

  function createMetric(day, exercise, field, label, inputMode) {
    const wrap = document.createElement('label');
    wrap.className = `metric metric-${field}`;

    const input = document.createElement('input');
    input.className = 'metric-input';
    input.type = 'text';
    input.inputMode = inputMode;
    input.enterKeyHint = 'next';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.exerciseField = field;
    input.dataset.exerciseOrder = String(exercise.order);
    input.value = exercise[field] || '';
    input.placeholder = field === 'kg' ? '' : '0';
    input.setAttribute('aria-label', `${label} ${exercise.title}`);
    input.addEventListener('input', () => {
      const storageField = field === 'kg' ? 'kilograms' : field;
      writeField(day, exercise.order, storageField, input.value.trim());
    });

    const text = document.createElement('span');
    text.className = 'metric-label';
    text.textContent = label;

    wrap.append(input, text);
    return wrap;
  }

  function createFormHistory(day, exercise) {
    const wrap = document.createElement('div');
    wrap.className = 'form-history';
    wrap.setAttribute('aria-label', `Vormontwikkeling ${exercise.title}`);

    const title = document.createElement('span');
    title.className = 'form-history-title';
    title.textContent = 'Vorm';

    const slots = document.createElement('div');
    slots.className = 'form-history-slots';
    normalizeFormHistory(exercise.formHistory).forEach((status, index) => {
      const slot = document.createElement('label');
      slot.className = 'form-status';

      const select = document.createElement('select');
      select.className = 'form-status-select';
      select.value = status;
      select.dataset.status = status;
      select.dataset.formSlot = String(index);
      select.setAttribute('aria-label', `${exercise.title} vormmoment ${index + 1}`);
      select.title = 'Kies: sterker, zwakker of gelijk';
      [
        ['', '·'],
        ['up', '↑'],
        ['down', '↓'],
        ['same', '—'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      });
      select.value = status;
      select.addEventListener('change', () => {
        const nextStatus = select.value;
        select.dataset.status = nextStatus;
        setFormHistory(day, exercise.order, Number(select.dataset.formSlot), nextStatus);
      });

      const indexLabel = document.createElement('span');
      indexLabel.className = 'form-status-index';
      indexLabel.textContent = String(index + 1);

      slot.append(select, indexLabel);
      slots.append(slot);
    });

    wrap.append(title, slots);
    return wrap;
  }

  function createExerciseCard(day, exercise) {
    const swipe = document.createElement('div');
    swipe.className = 'exercise-swipe';
    swipe.dataset.exerciseOrder = String(exercise.order);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-action';
    deleteButton.textContent = 'Verwijder';
    deleteButton.addEventListener('click', () => {
      saveOrders(day, readOrders(day).filter((order) => order !== exercise.order), { silent: true });
      render();
      persistLocalState();
    });

    const completionAction = document.createElement('div');
    completionAction.className = 'completion-action';
    completionAction.setAttribute('aria-hidden', 'true');

    const card = document.createElement('article');
    card.className = 'exercise-card';
    card.dataset.exerciseKey = exercise.exerciseKey;

    const top = document.createElement('div');
    top.className = 'exercise-top';

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'drag-handle';
    dragHandle.setAttribute('aria-label', `${exercise.title} verplaatsen`);
    dragHandle.innerHTML = '<span></span><span></span><span></span>';

    const title = document.createElement('input');
    title.className = 'exercise-title';
    title.type = 'text';
    title.value = exercise.title;
    title.placeholder = 'OEFENING';
    title.autocomplete = 'off';
    title.spellcheck = false;
    title.enterKeyHint = 'next';
    title.dataset.exerciseField = 'title';
    title.dataset.exerciseOrder = String(exercise.order);
    title.addEventListener('input', () => {
      writeField(day, exercise.order, 'name', title.value);
    });
    title.addEventListener('blur', () => {
      const normalized = upper(title.value);
      if (title.value !== normalized) title.value = normalized;
      writeField(day, exercise.order, 'name', title.value);
    });

    const metricGroup = document.createElement('div');
    metricGroup.className = 'metric-group';
    metricGroup.append(
      createMetric(day, exercise, 'sets', 'Sets', 'numeric'),
      createMetric(day, exercise, 'reps', 'Reps', 'numeric'),
      createMetric(day, exercise, 'kg', 'Kg', 'decimal')
    );

    const notes = document.createElement('input');
    notes.className = 'exercise-notes';
    notes.type = 'text';
    notes.value = exercise.notes;
    notes.placeholder = '';
    notes.autocomplete = 'off';
    notes.spellcheck = false;
    notes.enterKeyHint = 'next';
    notes.dataset.exerciseField = 'notes';
    notes.dataset.exerciseOrder = String(exercise.order);
    notes.addEventListener('input', () => {
      writeField(day, exercise.order, 'notes', notes.value);
    });
    notes.addEventListener('blur', () => {
      const normalized = upper(notes.value);
      if (notes.value !== normalized) notes.value = normalized;
      writeField(day, exercise.order, 'notes', notes.value);
    });

    top.append(dragHandle, title, metricGroup);
    card.append(top, createFormHistory(day, exercise), notes);
    swipe.append(deleteButton, completionAction, card);
    bindReorder(swipe, card, dragHandle, day, exercise.order);
    bindSwipe(swipe, card, completionAction, day, exercise.order, exercise.completed);
    syncExerciseCompletion(card, completionAction, exercise);
    return swipe;
  }

  function syncExerciseCompletion(card, completionAction, exercise) {
    const completed = Boolean(exercise.completed);
    card.classList.toggle('is-complete', completed);
    card.dataset.completed = String(completed);
    completionAction.dataset.action = completed ? 'undo' : 'complete';
    completionAction.textContent = completed ? 'Ongedaan' : 'Afvinken';
  }

  function targetIndexForPointer(pointerY, draggedSwipe) {
    return Array.from(list.querySelectorAll('.exercise-swipe'))
      .filter((item) => item !== draggedSwipe)
      .reduce((targetIndex, item) => {
        const rect = item.getBoundingClientRect();
        return pointerY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
      }, 0);
  }

  function bindReorder(swipe, card, handle, day, order) {
    let active = false;
    let dragging = false;
    let startY = 0;
    let targetIndex = -1;

    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (!isReady) return;
      stop(event);
      active = true;
      dragging = false;
      startY = event.clientY;
      targetIndex = readOrders(day).indexOf(order);
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!active) return;
      stop(event);
      const dy = event.clientY - startY;
      if (!dragging && Math.abs(dy) < REORDER_START_THRESHOLD) return;
      dragging = true;
      targetIndex = targetIndexForPointer(event.clientY, swipe);
      swipe.classList.add('is-reordering');
      card.classList.add('is-reordering');
      card.style.transition = 'none';
      card.style.transform = `translateY(${dy}px)`;
    });

    const finish = (event) => {
      if (!active) return;
      stop(event);
      active = false;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // De browser kan de pointer al vrijgegeven hebben.
      }

      const orders = readOrders(day);
      const fromIndex = orders.indexOf(order);
      const nextIndex = Math.max(0, Math.min(targetIndex, orders.length - 1));
      card.style.transition = '';
      card.style.transform = '';
      card.classList.remove('is-reordering');
      swipe.classList.remove('is-reordering');

      if (!dragging || fromIndex < 0 || nextIndex === fromIndex) return;
      const nextOrders = [...orders];
      const [movedOrder] = nextOrders.splice(fromIndex, 1);
      nextOrders.splice(nextIndex, 0, movedOrder);
      saveOrders(day, nextOrders, { silent: true });
      render();
      persistLocalState();
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('click', stop);
  }

  function bindSwipe(swipe, card, completionAction, day, order, initialCompleted) {
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let offset = 0;
    let active = false;
    let dragging = false;
    let intent = 'pending';
    let completed = Boolean(initialCompleted);
    let suppressClick = false;
    let targetInput = null;

    const setOffset = (nextOffset, animated = false) => {
      offset = nextOffset;
      card.classList.toggle('is-swiping', !animated);
      card.style.transition = animated ? '' : 'none';
      card.style.transform = `translateX(${offset}px)`;
      swipe.dataset.open = offset > 0 ? 'true' : 'false';
      swipe.dataset.swipeIntent = offset < 0 ? 'complete' : offset > 0 ? 'delete' : '';
    };

    swipe.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.drag-handle')) return;
      active = true;
      dragging = false;
      intent = 'pending';
      startX = event.clientX;
      startY = event.clientY;
      startOffset = offset;
      targetInput = event.target.closest?.('input, textarea, select, [contenteditable="true"]') || null;
    });

    swipe.addEventListener('pointermove', (event) => {
      if (!active) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const nextIntent = logbookGestureApi.classifySwipeIntent({ dx, dy, startOffset });

      if (nextIntent === 'scroll') {
        active = false;
        return;
      }
      if (!dragging && nextIntent !== 'pending') {
        dragging = true;
        intent = nextIntent;
        if (targetInput) targetInput.blur();
        try {
          card.setPointerCapture(event.pointerId);
        } catch (_error) {
          // De browser kan de pointer tijdens native scroll al hebben vrijgegeven.
        }
      }
      if (!dragging) return;

      event.preventDefault();
      setOffset(logbookGestureApi.swipeOffset({ intent, startOffset, dx }), false);
    });

    const end = (event, cancelled = false) => {
      if (!active && !dragging) return;
      active = false;
      try {
        card.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // De browser kan de pointer al vrijgegeven hebben.
      }

      const dx = event.clientX - startX;
      const result = logbookGestureApi.resolveSwipeEnd({
        intent,
        offset,
        dx,
        startOffset,
        completed,
        cancelled,
      });
      suppressClick = dragging;
      if (suppressClick) {
        window.setTimeout(() => {
          suppressClick = false;
        }, 350);
      }
      if (result.action === 'toggle-complete') {
        const nextExercise = setExerciseCompleted(day, order, result.completed);
        completed = Boolean(nextExercise.completed);
        syncExerciseCompletion(card, completionAction, nextExercise);
      }
      setOffset(result.targetOffset, true);
      dragging = false;
      intent = 'pending';
      window.setTimeout(() => card.classList.remove('is-swiping'), 230);
    };

    swipe.addEventListener('pointerup', end);
    swipe.addEventListener('pointercancel', (event) => end(event, true));
    swipe.addEventListener('click', (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function render() {
    const focusState = logbookInputApi.captureActiveExerciseInput(document, list);
    const title = upper(dayTitle(selectedDay));
    dayTrigger.textContent = title;
    const exercises = readOrders(selectedDay).map((order) => readExercise(selectedDay, order));

    list.replaceChildren(...exercises.map((exercise) => createExerciseCard(selectedDay, exercise)));
    if (loadStatusMessage) {
      loadStatusMessage.dataset.state = logbookLoadStatus;
      loadStatusMessage.hidden = logbookLoadStatus === 'ready';
      loadStatusMessage.textContent =
        logbookLoadStatus === 'error'
          ? 'LOGBOEK KON NIET WORDEN GELADEN.'
          : 'LOGBOEK LADEN...';
    }
    restDay.hidden = logbookLoadStatus !== 'ready' || exercises.length > 0;
    restDay.textContent = `${title} IS EEN RUSTDAG`;
    renderDayChoices();
    lastRenderedDateKey = currentDateKey();
    logbookInputApi.restoreActiveExerciseInput(list, focusState);
  }

  function openDayPicker() {
    dayPicker.hidden = false;
    dayTrigger.setAttribute('aria-expanded', 'true');
    renderDayChoices();
  }

  function closeDayPicker() {
    dayPicker.hidden = true;
    dayTrigger.setAttribute('aria-expanded', 'false');
  }

  addButton.addEventListener('click', () => {
    if (!isReady) return;
    logbookLoadStatus = 'ready';
    const orders = readOrders(selectedDay);
    const nextOrder = Math.max(100, ...orders) + 1;
    saveOrders(selectedDay, [...orders, nextOrder], { silent: true });
    const exercise = readExercise(selectedDay, nextOrder);
    writeField(selectedDay, exercise.order, 'name', upper(exercise.title));
    writeField(selectedDay, exercise.order, 'notes', upper(exercise.notes));
    render();
    persistLocalState();
  });

  dayTrigger.addEventListener('click', openDayPicker);
  closeDays.addEventListener('click', closeDayPicker);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDayPicker();
  });
  window.addEventListener('pagehide', flushLocalSave);

  async function boot() {
    const localState = loadLocalState();
    if (!localState.remoteBootstrapVersion) {
      const remoteLoaded = await loadRemoteState(localState.snapshot);
      logbookLoadStatus = remoteLoaded || snapshotHasExercisesForDay(localState.snapshot, selectedDay) ? 'ready' : 'error';
    } else {
      logbookLoadStatus = 'ready';
    }
    isReady = true;
    addButton.disabled = false;
    render();
    if (shouldPersistLoadedSnapshot) {
      markStateChanged({ silent: true });
      persistLocalState({ force: true });
    }
  }

  boot().catch(() => {
    logbookLoadStatus = 'error';
    isReady = true;
    addButton.disabled = false;
    render();
  });
})();
