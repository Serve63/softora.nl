(() => {
  const REMOTE_SCOPE = 'sportschool_logboek';
  const REMOTE_STATE_KEY = 'sportschool_logboek_v1';
  const REMOTE_LOGBOOK_ENDPOINT = '/api/sportschool-logboek';
  const DIRECT_SUPABASE_TABLE = 'softora_sportschool_logbook';
  const DIRECT_SUPABASE_ROW_ID = 'serve_logbook';
  const REMOTE_SAVE_DELAY_MS = 450;
  const REMOTE_RETRY_DELAY_MS = 1800;
  const SWIPE_WIDTH = 108;
  const REORDER_START_THRESHOLD = 6;
  const DRAFT_EXERCISE_TITLE = 'NIEUWE OEFENING';
  const DEFAULT_DAY_EXERCISES = {
    monday: [
      { order: 1, title: 'Chest Press', notes: '', sets: '3', reps: '8', kg: '82' },
      { order: 2, title: 'Lat Pulldown', notes: '', sets: '3', reps: '8', kg: '68' },
      { order: 3, title: 'Incline Chest Press', notes: '', sets: '3', reps: '8', kg: '70' },
      { order: 4, title: 'Seated Row', notes: '', sets: '3', reps: '8', kg: '73' },
      { order: 5, title: 'Overhead Tricep', notes: '', sets: '3', reps: '8', kg: '58/59' },
      { order: 6, title: 'Tricep Dip', notes: '', sets: '3', reps: '8', kg: '104' },
    ],
    tuesday: [
      { order: 1, title: 'Leg Extensions', notes: '', sets: '3', reps: '8', kg: '100' },
      { order: 2, title: 'Seated Leg Curl', notes: '', sets: '3', reps: '8', kg: '91' },
      { order: 3, title: 'Shoulder Press Machine', notes: '', sets: '3', reps: '8', kg: '50' },
      { order: 4, title: 'Lateral Shoulder Machine', notes: '', sets: '3', reps: '8', kg: '68' },
      { order: 5, title: 'Shrugs', notes: '', sets: '3', reps: '8', kg: '36' },
      { order: 6, title: 'Abdominal Machine', notes: '', sets: '3', reps: '8', kg: '73' },
    ],
    wednesday: [
      { order: 1, title: 'Incline Chest Press', notes: '', sets: '3', reps: '8', kg: '70' },
      { order: 2, title: 'Seated Row', notes: '', sets: '3', reps: '8', kg: '73' },
      { order: 3, title: 'Chest Press', notes: '', sets: '3', reps: '8', kg: '82' },
      { order: 4, title: 'Lat Pulldown', notes: '', sets: '3', reps: '8', kg: '68' },
      { order: 5, title: 'Hammer Curls', notes: '', sets: '3', reps: '8', kg: '50' },
      { order: 6, title: 'Sitting Bicep', notes: '', sets: '3', reps: '8', kg: '14' },
    ],
    thursday: [
      { order: 1, title: 'Seated Leg Curl', notes: '', sets: '3', reps: '8', kg: '91' },
      { order: 2, title: 'Leg Extensions', notes: '', sets: '3', reps: '8', kg: '100' },
      { order: 3, title: 'Lateral Shoulder Machine', notes: '', sets: '3', reps: '8', kg: '68' },
      { order: 4, title: 'Shoulder Press Machine', notes: '', sets: '3', reps: '8', kg: '50' },
      { order: 5, title: 'Shrugs', notes: '', sets: '3', reps: '8', kg: '36' },
      { order: 6, title: 'Abdominal Machine', notes: '', sets: '3', reps: '8', kg: '73' },
    ],
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

  const app = document.querySelector('[data-gym-app]');
  if (!app) return;

  const list = app.querySelector('[data-exercise-list]');
  const restDay = app.querySelector('[data-rest-day]');
  const dayTrigger = app.querySelector('[data-day-trigger]');
  const dayPicker = app.querySelector('[data-day-picker]');
  const dayGrid = app.querySelector('[data-day-grid]');
  const addButton = app.querySelector('[data-add-exercise]');
  const closeDays = app.querySelector('[data-close-days]');
  let selectedDay = currentWeekday();
  let isApplyingRemoteState = false;
  let isReady = false;
  let remoteSaveTimer = null;
  let lastRemoteSnapshotJson = '';
  let logbookState = createDefaultState();
  let cleanedLegacyNotesDuringLoad = false;
  let shouldPersistLoadedSnapshot = false;

  addButton.disabled = true;

  function upper(value) {
    return String(value || '').toLocaleUpperCase('nl-NL');
  }

  function normalizeExerciseTitle(value) {
    return upper(value).replace(/\s+/g, ' ').trim();
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
          return [String(exercise.order), { exerciseKey, ...normalized }];
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

  function getExerciseSource(day, order, stored = {}, options = {}) {
    const fallback = normalizeExerciseSource(day, order, stored, options);
    const exerciseKey = resolveExerciseKey(day, order, { ...fallback, ...stored });
    const sources = ensureExerciseSources();
    sources[exerciseKey] = mergeExerciseSource(sources[exerciseKey], fallback, normalizeExerciseSource(day, order));
    return {
      exerciseKey,
      source: sources[exerciseKey],
    };
  }

  function readOrders(day) {
    const dayState = getDayState(day);
    return Array.isArray(dayState.orders) ? dayState.orders : [];
  }

  function saveOrders(day, orders, options = {}) {
    const uniqueOrders = [];
    orders.forEach((order) => {
      if (Number.isFinite(order) && !uniqueOrders.includes(order)) uniqueOrders.push(order);
    });
    const dayState = getDayState(day);
    dayState.orders = uniqueOrders;
    uniqueOrders.forEach((order) => {
      const key = String(order);
      if (!dayState.exercises[key]) {
        const normalized = normalizeExerciseSource(day, order);
        const exerciseKey = exerciseKeyForTitle(normalized.title, exerciseSlotKey(day, order));
        ensureExerciseSources()[exerciseKey] = normalized;
        dayState.exercises[key] = { exerciseKey, ...normalized };
      }
    });
    if (!options.silent) scheduleRemoteSave();
  }

  function readExercise(day, order) {
    const dayState = getDayState(day);
    const stored = dayState.exercises?.[String(order)] || {};
    const { exerciseKey, source } = getExerciseSource(day, order, stored);
    dayState.exercises[String(order)] = { exerciseKey, ...source };
    return {
      order,
      exerciseKey,
      title: source.title,
      notes: source.notes,
      sets: source.sets,
      reps: source.reps,
      kg: source.kg,
    };
  }

  function writeField(day, order, field, value) {
    const dayState = getDayState(day);
    const key = String(order);
    const targetField = field === 'name' ? 'title' : field === 'kilograms' ? 'kg' : field;
    if (!dayState.exercises[key]) dayState.exercises[key] = readExercise(day, order);
    if (targetField === 'title') {
      const title = normalizeExerciseTitle(value);
      const previousExercise = readExercise(day, order);
      const nextExerciseKey = exerciseKeyForTitle(title, exerciseSlotKey(day, order));
      const sources = ensureExerciseSources();
      sources[nextExerciseKey] = mergeExerciseSource(
        sources[nextExerciseKey],
        { ...previousExercise, title },
        normalizeExerciseSource(day, order)
      );
      dayState.exercises[key] = { exerciseKey: nextExerciseKey, ...sources[nextExerciseKey] };
    } else {
      const { exerciseKey, source } = getExerciseSource(day, order, dayState.exercises[key]);
      source[targetField] = targetField === 'notes' ? upper(value) : value;
      dayState.exercises[key] = { exerciseKey, ...source };
    }
    scheduleRemoteSave();
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

    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      exerciseSources,
      days,
    };
  }

  function parseRemoteSnapshot(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function applyRemoteSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    isApplyingRemoteState = true;
    try {
      const nextState = { version: 2, exerciseSources: {}, days: {} };
      if (snapshot.exerciseSources && typeof snapshot.exerciseSources === 'object' && !Array.isArray(snapshot.exerciseSources)) {
        Object.entries(snapshot.exerciseSources).forEach(([exerciseKey, source]) => {
          const key = String(exerciseKey || '').trim();
          if (!key) return;
          nextState.exerciseSources[key] = normalizeExerciseSource('monday', 0, source, { markLegacyNotes: true });
        });
      } else {
        shouldPersistLoadedSnapshot = true;
      }
      STORAGE_DAYS.forEach((day) => {
        const dayState = snapshot.days?.[day];
        if (!dayState || typeof dayState !== 'object') {
          nextState.days[day] = createDefaultDayState(day, nextState);
          return;
        }
        const orders = Array.isArray(dayState.orders)
          ? dayState.orders.map((order) => Number.parseInt(order, 10)).filter(Number.isFinite)
          : [];
        nextState.days[day] = {
          orders,
          exercises: Object.fromEntries(
            orders.map((order) => {
              const stored = dayState.exercises?.[String(order)] || {};
              const normalized = normalizeExerciseSource(day, order, stored, { markLegacyNotes: true });
              const exerciseKey = resolveExerciseKey(day, order, { ...normalized, ...stored });
              const fallback = normalizeExerciseSource(day, order);
              nextState.exerciseSources[exerciseKey] = mergeExerciseSource(
                nextState.exerciseSources[exerciseKey],
                normalized,
                fallback
              );
              if (!stored.exerciseKey) shouldPersistLoadedSnapshot = true;
              return [String(order), { exerciseKey, ...nextState.exerciseSources[exerciseKey] }];
            })
          ),
        };
      });
      logbookState = nextState;
      return true;
    } finally {
      isApplyingRemoteState = false;
    }
  }

  function getDirectSupabaseConfig() {
    const config = window.SoftoraSportschoolSupabase || {};
    const url = String(config.url || '').replace(/\/+$/, '');
    const key = String(config.publishableKey || config.anonKey || '');
    return url && key ? { url, key } : null;
  }

  function buildDirectSupabaseHeaders(config) {
    return {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    };
  }

  async function fetchDirectSupabaseState(config) {
    const endpoint =
      `${config.url}/rest/v1/${DIRECT_SUPABASE_TABLE}` +
      `?id=eq.${encodeURIComponent(DIRECT_SUPABASE_ROW_ID)}&select=payload,updated_at`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: buildDirectSupabaseHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Sportschool Supabase laden mislukt (${response.status})`);
    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
      ok: true,
      scope: REMOTE_SCOPE,
      values: row?.payload ? { [REMOTE_STATE_KEY]: JSON.stringify(row.payload) } : {},
      source: 'supabase:sportschool',
      updatedAt: row?.updated_at || null,
    };
  }

  async function saveDirectSupabaseState(config, snapshotJson, options = {}) {
    const endpoint =
      `${config.url}/rest/v1/${DIRECT_SUPABASE_TABLE}?on_conflict=id`;
    const response = await fetch(endpoint, {
      method: 'POST',
      keepalive: options.keepalive === true,
      headers: {
        ...buildDirectSupabaseHeaders(config),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: DIRECT_SUPABASE_ROW_ID,
        payload: JSON.parse(snapshotJson),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(`Sportschool Supabase opslaan mislukt (${response.status})`);
    return {
      ok: true,
      scope: REMOTE_SCOPE,
      source: 'supabase:sportschool',
    };
  }

  async function fetchRemoteState() {
    const directConfig = getDirectSupabaseConfig();
    if (directConfig) return fetchDirectSupabaseState(directConfig);

    const response = await fetch(REMOTE_LOGBOOK_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    if (response.ok) return response.json();
    if (response.status !== 404) {
      throw new Error(`Sportschool opslag laden mislukt (${response.status})`);
    }

    if (window.SoftoraUiStateClient && typeof window.SoftoraUiStateClient.get === 'function') {
      return window.SoftoraUiStateClient.get(REMOTE_SCOPE);
    }

    throw new Error('Sportschool opslag endpoint ontbreekt.');
  }

  async function saveRemoteState(snapshotJson, options = {}) {
    const directConfig = getDirectSupabaseConfig();
    if (directConfig) return saveDirectSupabaseState(directConfig, snapshotJson, options);

    const body = {
      patch: { [REMOTE_STATE_KEY]: snapshotJson },
      source: 'sportschool-logboek',
      actor: 'serve',
    };

    const response = await fetch(REMOTE_LOGBOOK_ENDPOINT, {
      method: 'POST',
      keepalive: options.keepalive === true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot: JSON.parse(snapshotJson),
        source: 'sportschool-logboek',
        actor: 'serve',
      }),
    });
    if (response.ok) return response.json();
    if (response.status !== 404) {
      throw new Error(`Sportschool opslag opslaan mislukt (${response.status})`);
    }

    if (window.SoftoraUiStateClient && typeof window.SoftoraUiStateClient.set === 'function') {
      return window.SoftoraUiStateClient.set(REMOTE_SCOPE, body, options);
    }

    const fallbackResponse = await fetch(`/api/ui-state-set?scope=${encodeURIComponent(REMOTE_SCOPE)}`, {
      method: 'POST',
      keepalive: options.keepalive === true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!fallbackResponse.ok) throw new Error(`Sportschool opslag opslaan mislukt (${fallbackResponse.status})`);
    return fallbackResponse.json();
  }

  async function loadRemoteState() {
    try {
      const state = await fetchRemoteState();
      const raw = state?.values?.[REMOTE_STATE_KEY] || state?.values?.gymLogbookJson || '';
      const snapshot = parseRemoteSnapshot(raw);
      if (!snapshot) {
        return false;
      }
      lastRemoteSnapshotJson = JSON.stringify(snapshot);
      cleanedLegacyNotesDuringLoad = false;
      shouldPersistLoadedSnapshot = false;
      applyRemoteSnapshot(snapshot);
      if (cleanedLegacyNotesDuringLoad) shouldPersistLoadedSnapshot = true;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scheduleRemoteSave() {
    if (isApplyingRemoteState || !isReady) return;
    window.clearTimeout(remoteSaveTimer);
    remoteSaveTimer = window.setTimeout(() => {
      persistRemoteSave();
    }, REMOTE_SAVE_DELAY_MS);
  }

  async function persistRemoteSave(options = {}) {
    if (isApplyingRemoteState || !isReady) return;
    const snapshot = buildSnapshotFromState();
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === lastRemoteSnapshotJson) return;
    try {
      await saveRemoteState(snapshotJson, options);
      lastRemoteSnapshotJson = snapshotJson;
    } catch (_error) {
      // De eerstvolgende wijziging of online-event probeert opnieuw.
    }
  }

  function flushRemoteSave() {
    window.clearTimeout(remoteSaveTimer);
    persistRemoteSave({ keepalive: true });
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
      persistRemoteSave();
    });

    const card = document.createElement('article');
    card.className = 'exercise-card';

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
    title.addEventListener('input', () => {
      title.value = upper(title.value);
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
    notes.addEventListener('input', () => {
      notes.value = upper(notes.value);
      writeField(day, exercise.order, 'notes', notes.value);
    });

    top.append(dragHandle, title, metricGroup);
    card.append(top, notes);
    swipe.append(deleteButton, card);
    bindReorder(swipe, card, dragHandle, day, exercise.order);
    bindSwipe(swipe, card);
    return swipe;
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
      persistRemoteSave();
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('click', stop);
  }

  function bindSwipe(swipe, card) {
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let offset = 0;
    let active = false;
    let dragging = false;
    let targetInput = null;

    const setOffset = (nextOffset, animated = false) => {
      offset = Math.max(0, Math.min(SWIPE_WIDTH, nextOffset));
      card.classList.toggle('is-swiping', !animated);
      card.style.transition = animated ? 'transform 180ms ease' : 'none';
      card.style.transform = `translateX(${offset}px)`;
      swipe.dataset.open = offset > 0 ? 'true' : 'false';
    };

    swipe.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.drag-handle')) return;
      active = true;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      startOffset = offset;
      targetInput = event.target instanceof HTMLInputElement ? event.target : null;
      card.setPointerCapture(event.pointerId);
    });

    swipe.addEventListener('pointermove', (event) => {
      if (!active) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!dragging) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          active = false;
          return;
        }
        if (Math.abs(dx) < 9 || Math.abs(dx) <= Math.abs(dy)) return;
        dragging = true;
        if (targetInput) targetInput.blur();
      }

      event.preventDefault();
      setOffset(startOffset + dx, false);
    });

    const end = (event) => {
      if (!active) return;
      active = false;
      try {
        card.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // De browser kan de pointer al vrijgegeven hebben.
      }

      if (!dragging) {
        if (offset > 0 && !(event.target instanceof HTMLInputElement)) setOffset(0, true);
        return;
      }

      const dx = event.clientX - startX;
      const shouldOpen = offset > 54 || dx > 26;
      setOffset(shouldOpen ? SWIPE_WIDTH : 0, true);
      window.setTimeout(() => card.classList.remove('is-swiping'), 190);
    };

    swipe.addEventListener('pointerup', end);
    swipe.addEventListener('pointercancel', end);
    swipe.addEventListener('click', (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function render() {
    const title = upper(dayTitle(selectedDay));
    dayTrigger.textContent = title;
    const exercises = readOrders(selectedDay).map((order) => readExercise(selectedDay, order));

    list.replaceChildren(...exercises.map((exercise) => createExerciseCard(selectedDay, exercise)));
    restDay.hidden = exercises.length > 0;
    restDay.textContent = `${title} IS EEN RUSTDAG`;
    renderDayChoices();
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
    const orders = readOrders(selectedDay);
    const nextOrder = Math.max(100, ...orders) + 1;
    saveOrders(selectedDay, [...orders, nextOrder], { silent: true });
    const exercise = readExercise(selectedDay, nextOrder);
    writeField(selectedDay, exercise.order, 'name', upper(exercise.title));
    writeField(selectedDay, exercise.order, 'notes', upper(exercise.notes));
    render();
    persistRemoteSave();
  });

  dayTrigger.addEventListener('click', openDayPicker);
  closeDays.addEventListener('click', closeDayPicker);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDayPicker();
  });
  window.addEventListener('online', scheduleRemoteSave);
  window.addEventListener('pagehide', flushRemoteSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushRemoteSave();
  });

  async function boot() {
    const loaded = await loadRemoteState();
    if (!loaded) {
      window.setTimeout(boot, REMOTE_RETRY_DELAY_MS);
      return;
    }
    isReady = true;
    addButton.disabled = false;
    render();
    if (shouldPersistLoadedSnapshot) persistRemoteSave();
  }

  boot();
})();
