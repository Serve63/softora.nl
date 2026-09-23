(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sportschool-logboek-state'), require('./sportschool-logboek-sync'));
  } else if (root) root.SoftoraLogbookCloud = factory(root.SoftoraSportschoolLogbookState, root.SoftoraSportschoolLogbookSync);
})(typeof window === 'undefined' ? null : window, (state, sync) => {
  const LOCAL_KEY = 'softora_sportschool_logboek_v1';
  // Acknowledged server baseline and one recovery copy, never a second plan store.
  const SYNC_KEY = 'softora_sportschool_logboek_cloud_v1';
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const FIELDS = ['title', 'notes', 'sets', 'reps', 'kg'];
  function parse(raw) { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; } }
  function normalize(raw) {
    const input = parse(raw);
    if (!input?.days || typeof input.days !== 'object' || Array.isArray(input.days)) return null;
    const result = { version: 3, remoteBootstrapVersion: 2, exerciseSources: {}, formSessions: {}, days: {} };
    for (const day of DAYS) {
      const stored = input.days[day];
      const orders = [...new Set((Array.isArray(stored?.orders) ? stored.orders : []).map(Number).filter(Number.isInteger))];
      result.days[day] = { orders, exercises: {} };
      for (const order of orders) {
        const row = stored.exercises?.[order] || {};
        const title = String(row.title || '').toLocaleUpperCase('nl-NL').replace(/\s+/g, ' ').trim();
        const key = title && title !== 'NIEUWE OEFENING' ? `name:${title}` : row.exerciseKey || `slot:${day}:${order}`;
        const source = input.exerciseSources?.[key] || row;
        const values = Object.fromEntries(FIELDS.map(field => [field, String(source[field] ?? '')]));
        values.title = values.title.toLocaleUpperCase('nl-NL');
        values.notes = values.notes.toLocaleUpperCase('nl-NL');
        result.exerciseSources[key] ||= values;
        result.formSessions[key] ||= state.normalizeFormSessionHistory(input.formSessions?.[key] ?? row.formHistory);
        result.days[day].exercises[order] = { exerciseKey: key, ...result.exerciseSources[key],
          completedDates: state.normalizeCompletionDates(row.completedDates),
          formHistory: state.legacyFormHistoryFromSessions(result.formSessions[key]) };
      }
    }
    return result;
  }
  const equal = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  const populated = snapshot => DAYS.some(day => snapshot?.days?.[day]?.orders?.length);
  function differences(local, remote) {
    const rows = [];
    const a = normalize(local), b = normalize(remote);
    for (const key of new Set([...Object.keys(a?.exerciseSources || {}), ...Object.keys(b?.exerciseSources || {})])) {
      const left = a?.exerciseSources[key], right = b?.exerciseSources[key];
      const label = item => item ? `${item.kg || '—'} kg · ${item.sets || '—'} × ${item.reps || '—'}` : 'ontbreekt';
      if (label(left) !== label(right)) rows.push(`${left?.title || right?.title}: dit apparaat ${label(left)}, opgeslagen ${label(right)}`);
    }
    if (!rows.length && !equal(a, b)) rows.push('De dagindeling, notities of trainingshistorie verschillen.');
    return rows;
  }
  function create({ storage, fetchImpl, readLocal = () => parse(storage.getItem(LOCAL_KEY)),
    onSnapshot = () => {}, onStatus = () => {}, onSaved = () => {}, now = () => new Date().toISOString() }) {
    let remote = null, running = null, rerun = false, conflictCount = 0;
    const meta = () => parse(storage.getItem(SYNC_KEY)) || {};
    function status(kind, extra = {}) { onStatus({ kind, ...extra }); }
    function remember(base, previous = meta()) {
      storage.setItem(SYNC_KEY, JSON.stringify({ ...previous, base: base.snapshot, updatedAt: base.updatedAt }));
    }
    function apply(snapshot) {
      const next = normalize(snapshot);
      if (equal(readLocal(), next)) return;
      const value = { ...next, updatedAt: now() };
      storage.setItem(LOCAL_KEY, JSON.stringify(value));
      onSnapshot(value);
    }
    function info(body) {
      const snapshot = normalize(body?.values?.sportschool_logboek_v1);
      if (!body?.ok || !snapshot || !body.updatedAt) throw Error('Geen geldig opgeslagen schema ontvangen.');
      return { snapshot, updatedAt: body.updatedAt };
    }
    async function request(method, body) {
      const response = await fetchImpl(method === 'GET' ? '/api/sportschool-logboek-public' : '/api/sportschool-logboek', {
        method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409) return { conflict: true };
      if (!response.ok) throw Object.assign(Error(payload?.error || 'Schema opslaan niet gelukt.'), { status: response.status });
      return info(payload);
    }
    async function run() {
      try {
        remote = await request('GET');
        const local = normalize(readLocal()), saved = meta();
        if (!saved.base) {
          if (populated(local) && !equal(local, remote.snapshot)) {
            status('choice', { differences: differences(local, remote.snapshot) });
            return;
          }
          remember(remote); apply(remote.snapshot); status('synced'); return;
        }
        const merged = normalize(sync.mergeConflictSnapshots(normalize(saved.base), local || remote.snapshot, remote.snapshot));
        if (equal(merged, remote.snapshot)) {
          apply(remote.snapshot); remember(remote); status('synced'); conflictCount = 0; return;
        }
        // Persist the draft before any request; a failed login/network call must never discard it.
        apply(merged); remember(remote);
        status('saving');
        const result = await request('POST', { snapshot: { ...merged, updatedAt: now() },
          baseUpdatedAt: remote.updatedAt, source: 'sportschool-logboek-cloud' });
        if (result.conflict) {
          if (++conflictCount <= 1) { rerun = true; return; }
          throw Error('Het schema is opnieuw gewijzigd. Probeer nogmaals.');
        }
        const confirmed = await request('GET');
        if (!equal(confirmed.snapshot, result.snapshot)) throw Error('De gedeelde bron bevestigt de wijziging nog niet.');
        const latest = normalize(readLocal());
        const next = normalize(sync.mergeConflictSnapshots(merged, latest, confirmed.snapshot));
        remote = confirmed; apply(next); remember(confirmed); conflictCount = 0;
        if (!equal(next, confirmed.snapshot)) rerun = true;
        status(rerun ? 'saving' : 'synced'); onSaved();
      } catch (error) {
        status(error.status === 401 || error.status === 403 ? 'auth' : 'error');
      }
    }
    function refresh() {
      if (running) { rerun = true; return running; }
      running = run().finally(() => { running = null; if (rerun) { rerun = false; refresh(); } });
      return running;
    }
    async function useLocal() {
      if (!remote || running) return;
      try { remember(remote, { ...meta(), recovery: readLocal() }); }
      catch (_) { status('error'); return; }
      return refresh();
    }
    async function useRemote() {
      if (!remote || running) return;
      try { remember(remote, { ...meta(), recovery: readLocal() }); apply(remote.snapshot); }
      catch (_) { status('error'); return; }
      return refresh();
    }
    return { refresh, useLocal, useRemote, pending: () => status('saving') };
  }
  function mount({ target = window, readLocal, onSnapshot, onSaved, editor = false } = {}) {
    const host = target.document.querySelector('[data-logbook-cloud]');
    if (!host) return null;
    let timer;
    function action(label, handler) {
      const button = target.document.createElement('button');
      button.type = 'button'; button.textContent = label; button.addEventListener('click', handler); return button;
    }
    const client = create({ storage: target.localStorage, fetchImpl: target.fetch.bind(target), readLocal, onSnapshot, onSaved,
      onStatus({ kind, differences: changes = [] }) {
        host.replaceChildren(); host.hidden = kind === 'synced' && !editor;
        const message = target.document.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = ({ synced: 'Schema opgeslagen in Supabase', saving: 'Schema wordt opgeslagen…',
          choice: 'Op dit apparaat staat een ander logboek dan in Supabase. Welk schema klopt?',
          auth: 'Je schema is lokaal bewaard. Log in om deze gewichten ook in logboek-cut en op je andere apparaten te gebruiken.',
          error: 'Schema nog niet gesynchroniseerd. Je lokale gegevens zijn bewaard.' })[kind];
        host.append(message);
        if (kind === 'choice') {
          const details = target.document.createElement('details'), summary = target.document.createElement('summary');
          summary.textContent = 'Verschillen bekijken'; details.append(summary);
          for (const change of changes) { const row = target.document.createElement('p'); row.textContent = change; details.append(row); }
          host.append(details, action('Gebruik dit apparaat', client.useLocal), action('Gebruik Supabase', client.useRemote));
        }
        if (kind === 'auth') {
          const link = target.document.createElement('a');
          link.href = `/premium-personeel-login?next=${encodeURIComponent(target.location.pathname)}`;
          link.textContent = 'Inloggen en synchroniseren'; host.append(link);
        }
        if (kind === 'error' || kind === 'auth') host.append(action('Opnieuw proberen', client.refresh));
      },
    });
    const refresh = () => client.refresh();
    const changed = () => { client.pending(); target.clearTimeout(timer); timer = target.setTimeout(refresh, 650); };
    for (const event of ['online', 'pageshow', 'focus']) target.addEventListener(event, refresh);
    target.addEventListener('storage', event => {
      if (event.key === LOCAL_KEY && readLocal && event.newValue) {
        const next = normalize(sync.mergeConflictSnapshots(normalize(event.oldValue), normalize(readLocal()), normalize(event.newValue)));
        onSnapshot?.(next);
        if (!equal(next, event.newValue)) target.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      }
      if ([LOCAL_KEY, SYNC_KEY].includes(event.key)) changed();
    });
    target.document.addEventListener('visibilitychange', () => { if (target.document.visibilityState === 'visible') refresh(); });
    target.setInterval(() => { if (target.document.visibilityState === 'visible') refresh(); }, 30000);
    refresh();
    return { ...client, changed };
  }
  return { LOCAL_KEY, SYNC_KEY, normalize, equal, differences, create, mount };
});
