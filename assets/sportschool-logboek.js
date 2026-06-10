(() => {
  const REMOTE_SCOPE = 'sportschool_logboek';
  const REMOTE_STATE_KEY = 'sportschool_logboek_v1';
  const DIRECT_SUPABASE_TABLE = 'softora_sportschool_logbook';
  const DIRECT_SUPABASE_ROW_ID = 'serve_logbook';
  const REMOTE_SAVE_DELAY_MS = 450;
  const SWIPE_WIDTH = 108;
  const DEFAULT_EXERCISES = [
    { order: 1, title: 'Bankdrukken', notes: '4 sets - 8 tot 10 herhalingen', sets: '4', reps: '10', kg: '' },
    { order: 2, title: 'Schuine dumbbell press', notes: '3 sets - 10 herhalingen', sets: '3', reps: '10', kg: '' },
    { order: 3, title: 'Seated row', notes: '4 sets - 10 herhalingen', sets: '4', reps: '10', kg: '' },
    { order: 4, title: 'Lat pulldown', notes: '3 sets - 10 herhalingen', sets: '3', reps: '10', kg: '' },
    { order: 5, title: 'Shoulder press', notes: '3 sets - 8 tot 10 herhalingen', sets: '3', reps: '10', kg: '' },
    { order: 6, title: 'Biceps curl', notes: '3 sets - 12 herhalingen', sets: '3', reps: '12', kg: '' },
    { order: 7, title: 'Triceps pushdown', notes: '3 sets - 12 herhalingen', sets: '3', reps: '12', kg: '' },
    { order: 8, title: 'Plank', notes: '3 rondes - 45 seconden', sets: '3', reps: '45', kg: '' },
  ];
  const DEFAULT_ORDERS = DEFAULT_EXERCISES.slice(0, 4).map((exercise) => exercise.order);
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

  addButton.disabled = true;

  function upper(value) {
    return String(value || '').toLocaleUpperCase('nl-NL');
  }

  function currentWeekday() {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
  }

  function storageDay(day) {
    return day === 'today' ? currentWeekday() : day;
  }

  function defaultExercise(order) {
    return DEFAULT_EXERCISES.find((exercise) => exercise.order === order) || {
      order,
      title: 'Nieuwe oefening',
      notes: 'Notities',
      sets: '',
      reps: '',
      kg: '',
    };
  }

  function normalizeExercise(order, exercise = {}) {
    const fallback = defaultExercise(order);
    return {
      title: upper(exercise.title || fallback.title),
      notes: upper(exercise.notes || fallback.notes),
      sets: String(exercise.sets ?? fallback.sets ?? ''),
      reps: String(exercise.reps ?? fallback.reps ?? ''),
      kg: String(exercise.kg ?? fallback.kg ?? ''),
    };
  }

  function createDefaultDayState() {
    return {
      orders: [...DEFAULT_ORDERS],
      exercises: Object.fromEntries(
        DEFAULT_ORDERS.map((order) => [String(order), normalizeExercise(order)])
      ),
    };
  }

  function createDefaultState() {
    return {
      version: 1,
      days: Object.fromEntries(STORAGE_DAYS.map((day) => [day, createDefaultDayState()])),
    };
  }

  function getDayState(day) {
    const storedDay = storageDay(day);
    if (!logbookState.days[storedDay]) logbookState.days[storedDay] = createDefaultDayState();
    return logbookState.days[storedDay];
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
      if (!dayState.exercises[key]) dayState.exercises[key] = normalizeExercise(order);
    });
    if (!options.silent) scheduleRemoteSave();
  }

  function readExercise(day, order) {
    const dayState = getDayState(day);
    const stored = dayState.exercises?.[String(order)] || {};
    const normalized = normalizeExercise(order, stored);
    return {
      order,
      title: normalized.title,
      notes: normalized.notes,
      sets: normalized.sets,
      reps: normalized.reps,
      kg: normalized.kg,
    };
  }

  function writeField(day, order, field, value) {
    const dayState = getDayState(day);
    const key = String(order);
    if (!dayState.exercises[key]) dayState.exercises[key] = normalizeExercise(order);
    const targetField = field === 'name' ? 'title' : field === 'kilograms' ? 'kg' : field;
    dayState.exercises[key][targetField] = targetField === 'title' || targetField === 'notes' ? upper(value) : value;
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
    STORAGE_DAYS.forEach((day) => {
      const dayState = logbookState.days[day] || createDefaultDayState();
      const safeOrders = Array.isArray(dayState.orders) ? dayState.orders : [];
      days[day] = {
        orders: safeOrders,
        exercises: Object.fromEntries(
          safeOrders.map((order) => {
            return [String(order), normalizeExercise(order, dayState.exercises?.[String(order)])];
          })
        ),
      };
    });

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
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
      const nextState = createDefaultState();
      STORAGE_DAYS.forEach((day) => {
        const dayState = snapshot.days?.[day];
        if (!dayState || typeof dayState !== 'object') return;
        const orders = Array.isArray(dayState.orders)
          ? dayState.orders.map((order) => Number.parseInt(order, 10)).filter(Number.isFinite)
          : [];
        nextState.days[day] = {
          orders,
          exercises: Object.fromEntries(
            orders.map((order) => [String(order), normalizeExercise(order, dayState.exercises?.[String(order)])])
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

    if (window.SoftoraUiStateClient && typeof window.SoftoraUiStateClient.get === 'function') {
      return window.SoftoraUiStateClient.get(REMOTE_SCOPE);
    }

    const response = await fetch(`/api/ui-state-get?scope=${encodeURIComponent(REMOTE_SCOPE)}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Sportschool opslag laden mislukt (${response.status})`);
    return response.json();
  }

  async function saveRemoteState(snapshotJson, options = {}) {
    const directConfig = getDirectSupabaseConfig();
    if (directConfig) return saveDirectSupabaseState(directConfig, snapshotJson, options);

    const body = {
      patch: { [REMOTE_STATE_KEY]: snapshotJson },
      source: 'sportschool-logboek',
      actor: 'serve',
    };

    if (window.SoftoraUiStateClient && typeof window.SoftoraUiStateClient.set === 'function') {
      return window.SoftoraUiStateClient.set(REMOTE_SCOPE, body);
    }

    const response = await fetch(`/api/ui-state-set?scope=${encodeURIComponent(REMOTE_SCOPE)}`, {
      method: 'POST',
      keepalive: options.keepalive === true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Sportschool opslag opslaan mislukt (${response.status})`);
    return response.json();
  }

  async function loadRemoteState() {
    try {
      const state = await fetchRemoteState();
      const raw = state?.values?.[REMOTE_STATE_KEY] || state?.values?.gymLogbookJson || '';
      const snapshot = parseRemoteSnapshot(raw);
      if (!snapshot) {
        scheduleRemoteSave();
        return;
      }
      lastRemoteSnapshotJson = JSON.stringify(snapshot);
      applyRemoteSnapshot(snapshot);
    } catch (_error) {
      // Lokaal blijft de app direct werken; sync probeert later opnieuw.
    }
  }

  function scheduleRemoteSave() {
    if (isApplyingRemoteState) return;
    window.clearTimeout(remoteSaveTimer);
    remoteSaveTimer = window.setTimeout(() => {
      persistRemoteSave();
    }, REMOTE_SAVE_DELAY_MS);
  }

  async function persistRemoteSave(options = {}) {
    if (isApplyingRemoteState) return;
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
    wrap.className = 'metric';

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
    notes.placeholder = 'NOTITIES';
    notes.autocomplete = 'off';
    notes.spellcheck = false;
    notes.addEventListener('input', () => {
      notes.value = upper(notes.value);
      writeField(day, exercise.order, 'notes', notes.value);
    });

    top.append(title, metricGroup);
    card.append(top, notes);
    swipe.append(deleteButton, card);
    bindSwipe(swipe, card);
    return swipe;
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
    try {
      await loadRemoteState();
    } finally {
      isReady = true;
      addButton.disabled = false;
      render();
    }
  }

  boot();
})();
