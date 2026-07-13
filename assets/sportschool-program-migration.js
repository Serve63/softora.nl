(() => {
  const TABLE = 'softora_sportschool_logbook';
  const ROW_ID = 'serve_logbook';

  const PROGRAM = {
    monday: [
      ['Chest Press', '3', '8'],
      ['Lat Pulldown', '3', '8'],
      ['Incline Chest Press', '3', '8'],
      ['Seated Row', '3', '8'],
      ['Overhead Tricep', '3', '8-12'],
      ['Tricep Dip', '3', '8-12'],
    ],
    tuesday: [
      ['Leg Press', '3', '8'],
      ['Seated Leg Curl', '3', '8'],
      ['Leg Extensions', '3', '8'],
      ['Shoulder Press Machine', '3', '8'],
      ['Lateral Shoulder Machine', '3', '10-15'],
      ['Hammer Curls', '3', '8-12'],
    ],
    wednesday: [
      ['Incline Chest Press', '3', '8'],
      ['Seated Row', '3', '8'],
      ['Chest Press', '3', '8'],
      ['Lat Pulldown', '3', '8'],
      ['Cable Pushdown', '3', '8-12'],
      ['Overhead Tricep', '3', '8-12'],
    ],
    thursday: [
      ['Leg Press', '3', '8'],
      ['Seated Leg Curl', '3', '8'],
      ['Leg Extensions', '3', '8'],
      ['Shoulder Press Machine', '3', '8'],
      ['Lateral Shoulder Machine', '3', '10-15'],
      ['Sitting Bicep', '3', '8-12'],
    ],
    friday: [],
    saturday: [],
    sunday: [],
  };

  const normalizeTitle = (value) => String(value || '').toLocaleUpperCase('nl-NL').replace(/\s+/g, ' ').trim();
  const exerciseKey = (title) => `name:${normalizeTitle(title)}`;

  function currentTitles(payload, day) {
    const dayState = payload?.days?.[day];
    if (!dayState || !Array.isArray(dayState.orders)) return [];
    return dayState.orders.map((order) => normalizeTitle(dayState.exercises?.[String(order)]?.title));
  }

  function programAlreadyInstalled(payload) {
    return Object.entries(PROGRAM).every(([day, exercises]) => {
      const expected = exercises.map(([title]) => normalizeTitle(title));
      const current = currentTitles(payload, day);
      return expected.length === current.length && expected.every((title, index) => title === current[index]);
    });
  }

  function collectExistingSources(payload) {
    const sources = {};
    Object.values(payload?.exerciseSources || {}).forEach((source) => {
      const title = normalizeTitle(source?.title);
      if (title) sources[title] = source;
    });
    Object.values(payload?.days || {}).forEach((dayState) => {
      Object.values(dayState?.exercises || {}).forEach((source) => {
        const title = normalizeTitle(source?.title);
        if (title && !sources[title]) sources[title] = source;
      });
    });
    return sources;
  }

  function buildProgramPayload(existingPayload) {
    const existingSources = collectExistingSources(existingPayload);
    const exerciseSources = {};
    const days = {};

    Object.entries(PROGRAM).forEach(([day, exercises]) => {
      const orders = exercises.map((_, index) => index + 1);
      const dayExercises = {};

      exercises.forEach(([title, sets, reps], index) => {
        const order = index + 1;
        const normalizedTitle = normalizeTitle(title);
        const key = exerciseKey(title);
        const existing = existingSources[normalizedTitle] || {};
        const source = {
          title: normalizedTitle,
          notes: String(existing.notes || ''),
          sets,
          reps,
          kg: String(existing.kg || ''),
        };
        exerciseSources[key] = source;
        dayExercises[String(order)] = { exerciseKey: key, ...source };
      });

      days[day] = { orders, exercises: dayExercises };
    });

    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      exerciseSources,
      days,
    };
  }

  async function migrate() {
    const config = window.SoftoraSportschoolSupabase || {};
    const url = String(config.url || '').replace(/\/+$/, '');
    const key = String(config.publishableKey || config.anonKey || '');
    if (!url || !key) return;

    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    const readEndpoint = `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=payload`;
    const readResponse = await fetch(readEndpoint, { headers, cache: 'no-store' });
    if (!readResponse.ok) return;

    const rows = await readResponse.json().catch(() => []);
    const existingPayload = Array.isArray(rows) ? rows[0]?.payload : null;
    if (programAlreadyInstalled(existingPayload)) return;

    const payload = buildProgramPayload(existingPayload || {});
    const writeEndpoint = `${url}/rest/v1/${TABLE}?on_conflict=id`;
    const writeResponse = await fetch(writeEndpoint, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: ROW_ID, payload, updated_at: new Date().toISOString() }),
    });

    if (writeResponse.ok) window.location.reload();
  }

  migrate().catch(() => {});
})();
