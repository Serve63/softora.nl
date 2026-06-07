(() => {
  const STORAGE_PREFIX = 'nl.softora.agenda.gym';
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
    { id: 'today', title: 'Vandaag' },
    { id: 'monday', title: 'Maandag' },
    { id: 'tuesday', title: 'Dinsdag' },
    { id: 'wednesday', title: 'Woensdag' },
    { id: 'thursday', title: 'Donderdag' },
    { id: 'friday', title: 'Vrijdag' },
    { id: 'saturday', title: 'Zaterdag' },
    { id: 'sunday', title: 'Zondag' },
  ];

  const app = document.querySelector('[data-gym-app]');
  if (!app) return;

  const list = app.querySelector('[data-exercise-list]');
  const restDay = app.querySelector('[data-rest-day]');
  const dayTrigger = app.querySelector('[data-day-trigger]');
  const dayPicker = app.querySelector('[data-day-picker]');
  const dayGrid = app.querySelector('[data-day-grid]');
  const addButton = app.querySelector('[data-add-exercise]');
  const closeDays = app.querySelector('[data-close-days]');
  let selectedDay = 'today';

  function upper(value) {
    return String(value || '').toLocaleUpperCase('nl-NL');
  }

  function currentWeekday() {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
  }

  function storageDay(day) {
    return day === 'today' ? currentWeekday() : day;
  }

  function orderKey(day) {
    return `${STORAGE_PREFIX}.${storageDay(day)}.exercise.order`;
  }

  function fieldKey(day, order, field) {
    return `${STORAGE_PREFIX}.${storageDay(day)}.exercise.${order}.${field}`;
  }

  function readOrders(day) {
    const raw = localStorage.getItem(orderKey(day));
    if (raw === null) return DEFAULT_ORDERS;
    if (!raw.trim()) return [];
    return raw
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter(Number.isFinite);
  }

  function saveOrders(day, orders) {
    const uniqueOrders = [];
    orders.forEach((order) => {
      if (Number.isFinite(order) && !uniqueOrders.includes(order)) uniqueOrders.push(order);
    });
    localStorage.setItem(orderKey(day), uniqueOrders.join(','));
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

  function readExercise(day, order) {
    const fallback = defaultExercise(order);
    return {
      order,
      title: localStorage.getItem(fieldKey(day, order, 'name')) || upper(fallback.title),
      notes: localStorage.getItem(fieldKey(day, order, 'notes')) || upper(fallback.notes),
      sets: localStorage.getItem(fieldKey(day, order, 'sets')) ?? fallback.sets,
      reps: localStorage.getItem(fieldKey(day, order, 'reps')) ?? fallback.reps,
      kg: localStorage.getItem(fieldKey(day, order, 'kilograms')) ?? fallback.kg,
    };
  }

  function writeField(day, order, field, value) {
    localStorage.setItem(fieldKey(day, order, field), value);
  }

  function dayTitle(day) {
    return DAYS.find((item) => item.id === day)?.title || 'Vandaag';
  }

  function renderDayChoices() {
    dayGrid.replaceChildren(
      ...DAYS.map((day) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `day-choice${day.id === selectedDay ? ' is-selected' : ''}`;
        button.textContent = upper(day.title);
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
      saveOrders(day, readOrders(day).filter((order) => order !== exercise.order));
      render();
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
    bindSwipe(card);
    return swipe;
  }

  function bindSwipe(card) {
    let startX = 0;
    let startY = 0;
    let active = false;
    let offset = 0;

    const setOffset = (nextOffset, animated = false) => {
      offset = Math.max(0, Math.min(108, nextOffset));
      card.style.transition = animated ? 'transform 180ms ease' : 'none';
      card.style.transform = `translateX(${offset}px)`;
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      active = true;
      startX = event.clientX;
      startY = event.clientY;
      card.setPointerCapture(event.pointerId);
    });

    card.addEventListener('pointermove', (event) => {
      if (!active) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) return;
      setOffset(dx, false);
    });

    const end = (event) => {
      if (!active) return;
      active = false;
      try {
        card.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // De browser kan de pointer al vrijgegeven hebben.
      }
      setOffset(offset > 48 ? 108 : 0, true);
    };

    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
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
    const orders = readOrders(selectedDay);
    const nextOrder = Math.max(100, ...orders) + 1;
    saveOrders(selectedDay, [...orders, nextOrder]);
    const exercise = readExercise(selectedDay, nextOrder);
    writeField(selectedDay, exercise.order, 'name', upper(exercise.title));
    writeField(selectedDay, exercise.order, 'notes', upper(exercise.notes));
    render();
  });

  dayTrigger.addEventListener('click', openDayPicker);
  closeDays.addEventListener('click', closeDayPicker);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDayPicker();
  });

  render();
})();
