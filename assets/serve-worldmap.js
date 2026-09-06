(function () {
  'use strict';
  const SCOPE = 'premium_serve_worldmap';
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const storageKey = (code) => 'visited_' + code.toLowerCase();
  function filterCountries(countries, visited, query = '', filter = 'all') {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return countries.filter((country) => (filter === 'all' || visited.has(country.code) === (filter === 'visited')) && words.every((word) => normalize(country.name + ' ' + country.searchName + ' ' + country.code).includes(word)));
  }
  function createProgressStore(client, countries) {
    const known = new Set(countries.map((country) => country.code));
    const state = { ready: false, busy: false, visited: new Set(), error: '' };
    function accept(data) {
      if (!data || data.ok !== true || data.source !== 'supabase' || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) throw new Error('Opslag niet bevestigd. Probeer opnieuw.');
      state.visited = new Set(countries.filter((country) => data.values[storageKey(country.code)] === '1').map((country) => country.code));
      state.ready = true;
    }
    async function load() {
      if (state.busy) return false;
      state.busy = true; state.error = '';
      try { client.invalidate(SCOPE); accept(await client.get(SCOPE)); return true; }
      catch (_error) { state.ready = false; state.error = 'Je voortgang is niet bereikbaar. Probeer opnieuw; je opgeslagen landen blijven bewaard.'; return false; }
      finally { state.busy = false; }
    }
    async function save(code, visited) {
      if (!state.ready || state.busy || !known.has(code) || typeof visited !== 'boolean') return false;
      state.busy = true; state.error = '';
      const key = storageKey(code), value = visited ? '1' : '0';
      try {
        // Patch only this country; do not replace another tab/device's list.
        const data = await client.set(SCOPE, { patch: { [key]: value }, source: 'serve-worldmap' }, { timeoutMs: 15000 });
        if (!data || data.values?.[key] !== value) throw new Error('Wijziging niet bevestigd.');
        accept(data); return true;
      } catch (_error) {
        // A timed-out write may have succeeded. Reconcile before permitting another change.
        try { client.invalidate(SCOPE); accept(await client.get(SCOPE)); if (state.visited.has(code) === visited) return true; }
        catch (_readError) { state.ready = false; }
        state.error = 'Opslaan is niet bevestigd. Controleer je verbinding en probeer opnieuw.'; return false;
      } finally { state.busy = false; }
    }
    return { state, load, save };
  }
  if (typeof module === 'object' && module.exports) module.exports = { SCOPE, filterCountries, createProgressStore };
  if (typeof document === 'undefined' || !document.body.hasAttribute('data-serve-worldmap')) return;
  const byId = (id) => document.getElementById(id), svgNS = 'http://www.w3.org/2000/svg';
  const ui = { countries: [], selected: '', query: '', filter: 'all', store: null, loading: false, mapError: '' };
  const camera = { x: 0, y: 0, width: 1200, height: 500 };
  const countryNodes = new Map();
  const flag = (code) => /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))) : '◌';
  const visited = () => ui.store?.state.visited || new Set();
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function status(message, error = false) { byId('wm-save-status').textContent = message; byId('wm-save-status').parentElement.dataset.error = String(error); byId('wm-retry').hidden = !error; }
  function renderSelection() {
    const country = ui.countries.find((item) => item.code === ui.selected), unlocked = visited().has(ui.selected), button = byId('wm-unlock');
    const state = ui.store?.state;
    button.disabled = !country || !state?.ready || state.busy;
    button.dataset.visited = String(unlocked);
    button.textContent = state?.busy && country ? 'Even wachten…' : !country ? 'Selecteer een land' : unlocked ? 'Ontgrendeling ongedaan maken' : 'Ik ben hier geweest · Ontgrendel';
    if (!country) return;
    byId('wm-country-flag').textContent = flag(country.code); byId('wm-country-region').textContent = country.continent;
    byId('wm-country-name').textContent = country.name;
    byId('wm-country-status').textContent = !state?.ready ? 'Wacht tot je opgeslagen voortgang is geladen.' : unlocked ? 'Ontgrendeld. Deze plek hoort bij jouw verhaal.' : 'Nog te ontdekken. Al geweest? Maak dit land groen.';
  }
  function renderList() {
    const list = byId('wm-list'), scrollTop = list.scrollTop, focusCode = document.activeElement?.closest('[data-wm-country]')?.dataset.wmCountry;
    const countries = filterCountries(ui.countries, visited(), ui.query, ui.filter);
    byId('wm-list-count').textContent = countries.length;
    list.replaceChildren(...countries.map((country) => {
      const unlocked = visited().has(country.code), node = element('button', 'wm-country-row'); node.type = 'button';
      node.dataset.wmCountry = country.code; node.dataset.selected = String(ui.selected === country.code); node.dataset.visited = String(unlocked);
      node.setAttribute('aria-label', country.name + (unlocked ? ', ontgrendeld' : ', nog te ontdekken')); node.setAttribute('aria-pressed', String(ui.selected === country.code));
      const symbol = element('span', '', flag(country.code)); symbol.setAttribute('aria-hidden', 'true');
      node.append(symbol, element('span', '', country.name), element('small', '', unlocked ? '✓' : '+'));
      node.addEventListener('click', () => select(country.code, true)); return node;
    }));
    if (!countries.length) list.append(element('p', 'wm-empty', ui.query ? 'Geen land gevonden. Probeer een andere naam.' : ui.filter === 'visited' ? 'Je eerste herinnering wacht. Ontgrendel een land waar je bent geweest.' : 'Alles in deze selectie is ontgrendeld.'));
    list.scrollTop = scrollTop;
    if (focusCode) list.querySelector('[data-wm-country="' + focusCode + '"]')?.focus({ preventScroll: true });
    document.querySelectorAll('[data-wm-filter]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.wmFilter === ui.filter)));
  }
  function render() {
    const state = ui.store?.state, unlocked = visited(), ready = state?.ready, total = ui.countries.length;
    byId('wm-count').textContent = ready ? unlocked.size : '—'; byId('wm-total').textContent = 'van ' + total + ' landen & gebieden';
    const percent = total ? unlocked.size / total * 100 : 0;
    byId('wm-percent').textContent = ready ? percent.toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + '%' : '—'; byId('wm-progress').value = ready ? percent : 0;
    const continents = new Set(ui.countries.filter((country) => unlocked.has(country.code)).map((country) => country.continent));
    byId('wm-continents').textContent = ready ? continents.size + ' / ' + new Set(ui.countries.map((country) => country.continent)).size : '—';
    countryNodes.forEach((nodes, code) => nodes.forEach((node) => { node.dataset.visited = String(unlocked.has(code)); node.dataset.selected = String(code === ui.selected); node.setAttribute('aria-label', ui.countries.find((country) => country.code === code).name + (unlocked.has(code) ? ', ontgrendeld' : ', nog te ontdekken')); }));
    renderList(); renderSelection();
  }
  function select(code, center = false) {
    ui.selected = code;
    if (center) {
      const country = ui.countries.find((item) => item.code === code);
      camera.width = country.small ? 140 : 420; camera.height = camera.width * 500 / 1200;
      camera.x = country.center[0] - camera.width / 2; camera.y = country.center[1] - camera.height / 2; applyCamera();
    }
    render();
    if (window.innerWidth <= 1250 && center) byId('wm-selection').scrollIntoView({ behavior: 'instant', block: 'center' });
  }
  function applyCamera() {
    camera.x = Math.max(-60, Math.min(1260 - camera.width, camera.x)); camera.y = Math.max(-40, Math.min(540 - camera.height, camera.y));
    byId('wm-map').setAttribute('viewBox', [camera.x, camera.y, camera.width, camera.height].join(' '));
    byId('wm-zoom-in').disabled = camera.width <= 75; byId('wm-zoom-out').disabled = camera.width >= 1200;
    document.querySelectorAll('.wm-country-dot').forEach((node) => node.setAttribute('r', Math.max(.5, 2.4 * camera.width / 1200)));
  }
  function zoom(factor) { const width = Math.max(75, Math.min(1200, camera.width * factor)), height = width * 500 / 1200; camera.x += (camera.width - width) / 2; camera.y += (camera.height - height) / 2; camera.width = width; camera.height = height; applyCamera(); }
  function drawMap() {
    byId('wm-countries').replaceChildren(); byId('wm-small-countries').replaceChildren(); countryNodes.clear();
    ui.countries.forEach((country) => {
      const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', country.path); path.setAttribute('class', 'wm-country'); path.setAttribute('fill-rule', 'evenodd');
      const title = document.createElementNS(svgNS, 'title'); title.textContent = country.name; path.append(title);
      const nodes = [path]; byId('wm-countries').append(path);
      if (country.small) { const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('cx', country.center[0]); dot.setAttribute('cy', country.center[1]); dot.setAttribute('r', '2.4'); dot.setAttribute('class', 'wm-country wm-country-dot'); nodes.push(dot); byId('wm-small-countries').append(dot); }
      nodes.forEach((node) => { node.dataset.wmCountry = country.code; node.setAttribute('role', 'button'); node.setAttribute('tabindex', '-1'); }); countryNodes.set(country.code, nodes);
    });
    byId('wm-map-message').hidden = true; applyCamera();
  }
  async function refresh() {
    if (ui.loading || ui.store?.state.busy) return;
    ui.loading = true; status('Je wereldmap laden…');
    try {
      if (!ui.countries.length) {
        const response = await fetch('/assets/serve-worldmap-countries.json?v=20260906a', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Kaart niet beschikbaar');
        const data = await response.json();
        if (!Array.isArray(data.countries) || data.countries.length < 190) throw new Error('Kaart onvolledig');
        ui.countries = data.countries.sort((a, b) => a.name.localeCompare(b.name, 'nl')); drawMap();
        ui.store = createProgressStore(window.SoftoraUiStateClient, ui.countries);
      }
      const pending = ui.store.load(); render(); const ok = await pending; render();
      status(ok ? 'Je voortgang is opgeslagen in je account.' : ui.store.state.error, !ok);
    } catch (_error) { byId('wm-map-message').textContent = 'De kaart kon niet laden. Probeer het opnieuw.'; byId('wm-map-message').hidden = false; status('De wereldmap is even niet bereikbaar.', true); }
    finally { ui.loading = false; }
  }
  byId('wm-unlock').addEventListener('click', async () => {
    const code = ui.selected, country = ui.countries.find((item) => item.code === code), unlocked = !visited().has(code);
    if (!country || !ui.store?.state.ready || ui.store.state.busy) return;
    const pending = ui.store.save(code, unlocked); renderSelection(); status('Wijziging opslaan…');
    const ok = await pending; render(); status(ok ? country.name + (unlocked ? ' ontgrendeld. Op naar je volgende avontuur!' : ' staat weer op te ontdekken.') : ui.store.state.error, !ok);
  });
  byId('wm-search').addEventListener('input', (event) => { ui.query = event.target.value; byId('wm-list').scrollTop = 0; renderList(); });
  document.querySelectorAll('[data-wm-filter]').forEach((node) => node.addEventListener('click', () => { ui.filter = node.dataset.wmFilter; byId('wm-list').scrollTop = 0; renderList(); }));
  byId('wm-retry').addEventListener('click', refresh); byId('wm-zoom-in').addEventListener('click', () => zoom(.7)); byId('wm-zoom-out').addEventListener('click', () => zoom(1 / .7));
  byId('wm-reset').addEventListener('click', () => { Object.assign(camera, { x: 0, y: 0, width: 1200, height: 500 }); applyCamera(); });
  const viewport = byId('wm-viewport'), map = byId('wm-map'); let drag = null;
  viewport.addEventListener('pointerdown', (event) => { if (event.target.closest('.wm-map-controls') || event.button !== 0) return; drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y, moved: false, code: event.target.closest('[data-wm-country]')?.dataset.wmCountry }; viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', (event) => { if (!drag || event.pointerId !== drag.pointer) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.hypot(dx, dy) > 5) drag.moved = true; if (!drag.moved) return; const rect = map.getBoundingClientRect(), scale = Math.min(rect.width / camera.width, rect.height / camera.height); camera.x = drag.startX - dx / scale; camera.y = drag.startY - dy / scale; applyCamera(); });
  viewport.addEventListener('pointerup', (event) => { if (!drag || event.pointerId !== drag.pointer) return; const completed = drag; drag = null; viewport.releasePointerCapture(event.pointerId); if (!completed.moved && completed.code) select(completed.code); });
  viewport.addEventListener('pointercancel', () => { drag = null; });
  // Keyboard/assistive click events do not have a pointer gesture.
  map.addEventListener('click', (event) => { const code = event.target.closest('[data-wm-country]')?.dataset.wmCountry; if (event.detail === 0 && code) select(code); });
  viewport.addEventListener('keydown', (event) => { if (event.target.closest('.wm-map-controls')) return; if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) event.preventDefault(); if (['+', '='].includes(event.key)) zoom(.7); else if (event.key === '-') zoom(1 / .7); else if (event.key === 'Home') byId('wm-reset').click(); else { if (event.key === 'ArrowLeft') camera.x -= camera.width / 8; if (event.key === 'ArrowRight') camera.x += camera.width / 8; if (event.key === 'ArrowUp') camera.y -= camera.height / 8; if (event.key === 'ArrowDown') camera.y += camera.height / 8; applyCamera(); } });
  function toggleNavigation(open) { document.body.classList.toggle('wm-nav-open', open); byId('wm-shade').hidden = !open; byId('wm-menu').setAttribute('aria-expanded', String(open)); byId('wm-menu').setAttribute('aria-label', open ? 'Sluit navigatie' : 'Open navigatie'); byId('wm-menu').textContent = open ? '×' : '☰'; if (!open) byId('wm-menu').focus(); }
  byId('wm-menu').addEventListener('click', () => toggleNavigation(!document.body.classList.contains('wm-nav-open'))); byId('wm-shade').addEventListener('click', () => toggleNavigation(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('wm-nav-open')) toggleNavigation(false); });
  window.matchMedia('(max-width:900px)').addEventListener('change', () => { if (document.body.classList.contains('wm-nav-open')) toggleNavigation(false); });
  const sidebar = byId('wm-sidebar');
  function syncSidebar() {
    if (!sidebar.children.length) return;
    sidebar.setAttribute('data-static-sidebar', '1'); sidebar.setAttribute('data-sidebar-ready', 'true');
    if (sidebar.classList.contains('sidebar-fit-compact') || sidebar.classList.contains('sidebar-fit-tight')) sidebar.classList.remove('sidebar-fit-compact', 'sidebar-fit-tight');
    sidebar.style.transform = ''; sidebar.style.translate = ''; sidebar.style.willChange = '';
    sidebar.querySelectorAll('.sidebar-link').forEach((node) => { const active = node.getAttribute('href') === '/premium-instellingen'; if (node.classList.contains('active') !== active) node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'location'); else node.removeAttribute('aria-current'); });
  }
  syncSidebar(); new MutationObserver(syncSidebar).observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh); refresh();
})();
