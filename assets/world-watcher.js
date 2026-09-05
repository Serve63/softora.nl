(function () {
  'use strict';
  const FIVE_MINUTES = 300000, HOUR = 3600000;
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const project = (lat, lon) => ({ x: (lon + 180) / 360 * 100, y: (85 - lat) / 145 * 100 });
  function filterItems(items, { kind = 'all', query = '', region = '' } = {}) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return items.filter((item) => (kind === 'all' || item.kind === kind) && (!region || item.regionId === region) && words.every((word) => normalize([item.title, item.description, item.sourceName, item.region, item.eventType].join(' ')).includes(word)));
  }
  function currentSnapshot(snapshot, disconnected, now = Date.now()) {
    if (!snapshot) return { sources: [], items: [], regions: [] };
    const sources = snapshot.sources.map((source) => {
      const age = now - Date.parse(source.fetchedAt);
      const status = !Number.isFinite(age) || age >= HOUR ? 'unavailable' : disconnected || age > FIVE_MINUTES + 15000 || source.status === 'stale' ? 'stale' : source.status;
      return { ...source, status, count: status === 'unavailable' ? null : source.count };
    });
    return { ...snapshot, sources, items: snapshot.items.filter((item) => sources.some((source) => source.id === item.source && source.status !== 'unavailable')).map((item) => ({ ...item, stale: sources.find((source) => source.id === item.source).status === 'stale' })) };
  }
  if (typeof module === 'object' && module.exports) module.exports = { filterItems, project, currentSnapshot };
  if (typeof document === 'undefined' || !document.body.hasAttribute('data-world-watcher')) return;
  const byId = (id) => document.getElementById(id);
  const state = { snapshot: null, disconnected: false, busy: false, attemptedAt: 0, error: '', kind: 'all', query: '', region: '', detailId: '' };
  const view = () => currentSnapshot(state.snapshot, state.disconnected);
  let renderedSourceStates = '';
  const sourceStates = (data) => data.sources.map((source) => source.id + ':' + source.status).join(',');
  const dateFormat = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const timeFormat = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const levelName = { news: 'Nieuws', red: 'GDACS rood', orange: 'GDACS oranje', green: 'GDACS groen' };
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function link(text, url) { const node = element('a', '', text); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }
  function button(text, className, action) { const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node; }
  function warn(message) { byId('ww-warning').textContent = message; byId('ww-warning').hidden = !message; }
  function renderStatus(data) {
    const ready = data.sources.filter((source) => source.status === 'ready').length;
    const available = data.sources.some((source) => source.status !== 'unavailable');
    const newsAvailable = data.sources.some((source) => source.id !== 'gdacs' && source.status !== 'unavailable'), natureAvailable = data.sources.some((source) => source.id === 'gdacs' && source.status !== 'unavailable');
    byId('ww-stat-news').textContent = newsAvailable ? data.items.filter((item) => item.kind === 'geopolitics').length : '—';
    byId('ww-stat-alerts').textContent = natureAvailable ? data.items.filter((item) => ['red', 'orange'].includes(item.level)).length : '—';
    byId('ww-stat-regions').textContent = newsAvailable ? new Set(data.items.filter((item) => item.kind === 'geopolitics' && item.regionId).map((item) => item.regionId)).size : '—';
    byId('ww-stat-sources').textContent = ready + ' / 3';
    byId('ww-updated').textContent = state.snapshot ? 'Gecontroleerd om ' + timeFormat.format(new Date(state.snapshot.checkedAt)) : 'Nog geen brongegevens';
    byId('ww-connection').dataset.state = ready === 3 ? 'ready' : available ? 'partial' : 'error';
    byId('ww-connection').textContent = state.busy ? 'Bronnen ophalen' : ready === 3 ? 'Bronnen bijgewerkt' : available ? 'Beperkte verbinding' : 'Geen verbinding';
    const affected = data.sources.filter((source) => source.status !== 'ready');
    warn(state.error || (affected.length ? affected.map((source) => source.name + ': ' + (source.status === 'stale' ? 'eerder opgehaalde gegevens' : 'tijdelijk niet beschikbaar')).join(' · ') : ''));
    byId('ww-source-strip').replaceChildren(...data.sources.map((source) => {
      const card = element('div', 'ww-source'), status = element('span', 'ww-source-state'); status.dataset.state = source.status;
      status.append(element('i', 'ww-dot'), document.createTextNode(source.status === 'ready' ? source.count + ' berichten · ' + timeFormat.format(new Date(source.fetchedAt)) : source.status === 'stale' ? 'Verouderd · ' + timeFormat.format(new Date(source.fetchedAt)) : 'Niet bereikbaar'));
      card.append(link(source.name + ' ↗', source.url), status); return card;
    }));
  }
  function openDetail(id, focus = false) {
    const item = view().items.find((candidate) => candidate.id === id);
    state.detailId = item ? id : ''; byId('ww-map-detail').hidden = !item;
    if (!item) { byId('ww-markers').querySelectorAll('[data-item]').forEach((pin) => pin.dataset.selected = 'false'); return; }
    byId('ww-detail-type').textContent = (item.eventType || 'Nieuws · regiopunt') + ' · ' + levelName[item.level] + (item.stale ? ' · verouderd' : '');
    byId('ww-detail-title').textContent = item.title;
    byId('ww-detail-description').textContent = item.description || item.region;
    byId('ww-detail-link').href = item.url; byId('ww-detail-link').textContent = 'Lees bij ' + item.sourceName + ' ↗';
    byId('ww-markers').querySelectorAll('[data-item]').forEach((pin) => pin.dataset.selected = String(pin.dataset.item === id));
    if (focus) { byId('ww-map-detail').focus({ preventScroll: true }); if (window.innerWidth <= 1150) byId('ww-map-viewport').scrollIntoView({ behavior: 'instant', block: 'center' }); }
  }
  function clearSelection() { state.region = ''; state.detailId = ''; renderContent(); }
  function renderFeed(data) {
    const items = filterItems(data.items, state), list = byId('ww-news-list');
    byId('ww-feed-count').textContent = items.length;
    byId('ww-selection').hidden = !state.region;
    byId('ww-selection-name').textContent = data.regions.find((region) => region.id === state.region)?.name || '';
    list.replaceChildren(...items.map((item) => {
      const row = element('article', 'ww-news-item'), meta = element('div', 'ww-item-meta'), title = element('h3'), bottom = element('div', 'ww-item-bottom');
      const time = element('time', '', dateFormat.format(new Date(item.publishedAt))); time.dateTime = item.publishedAt; time.title = 'Gepubliceerd: ' + new Date(item.publishedAt).toLocaleString('nl-NL');
      const dot = element('i', 'ww-dot ww-dot-' + item.level); dot.title = levelName[item.level];
      meta.append(dot, element('span', 'ww-source-label', item.sourceName), time); title.append(link(item.title, item.url));
      bottom.append(element('span', '', item.region));
      if (item.lat !== null && (item.kind === 'nature' || item.kind === 'geopolitics')) bottom.append(button('Op de kaart ↗', 'ww-locate', () => { openDetail(item.id, true); centerOn(item.lat, item.lon); }));
      row.append(meta, title, bottom); if (item.stale) row.append(element('small', 'ww-item-stale', 'Eerder opgehaald · bron niet actueel')); return row;
    }));
    if (!items.length) { const empty = element('div', 'ww-empty', state.error || (!data.sources.some((source) => source.status !== 'unavailable') ? 'Er zijn nog geen brongegevens beschikbaar.' : 'Geen berichten binnen deze selectie.')); empty.append(button(state.region || state.query || state.kind !== 'all' ? 'Wis filters' : 'Opnieuw proberen', '', () => { if (state.region || state.query || state.kind !== 'all') { state.kind = 'all'; state.query = ''; byId('ww-search').value = ''; clearSelection(); } else refresh(); })); list.append(empty); }
  }
  function renderMap(data) {
    const items = filterItems(data.items, { kind: state.kind, query: state.query }), pins = [];
    function pin(lat, lon, level, name) {
      const point = project(lat, lon), node = element('button', 'ww-pin ww-pin--' + level); node.type = 'button'; node.style.left = point.x + '%'; node.style.top = point.y + '%'; node.style.transform = 'translate(-50%,-50%) scale(' + 1 / map.scale + ')'; node.setAttribute('aria-label', name); node.title = name; return node;
    }
    items.filter((item) => item.kind === 'nature').sort((a, b) => ({green:1,orange:2,red:3}[a.level] - {green:1,orange:2,red:3}[b.level])).forEach((item) => {
      const node = pin(item.lat, item.lon, item.level, levelName[item.level] + ': ' + item.title); node.dataset.item = item.id; node.dataset.selected = String(state.detailId === item.id); node.addEventListener('click', () => openDetail(item.id, true)); pins.push(node);
    });
    data.regions.forEach((region) => {
      const count = items.filter((item) => item.kind === 'geopolitics' && item.regionId === region.id).length; if (!count) return;
      const node = pin(region.lat, region.lon, 'news', region.name + ': ' + count + ' geopolitieke berichten'); node.dataset.region = region.id; node.dataset.selected = String(state.region === region.id); node.setAttribute('aria-pressed', String(state.region === region.id));
      node.append(element('span', 'ww-pin-label', region.name + ' · ' + count)); node.addEventListener('click', () => { state.region = state.region === region.id ? '' : region.id; state.detailId = ''; renderContent(); byId('ww-markers').querySelector('[data-region="' + region.id + '"]')?.focus({ preventScroll: true }); byId('ww-news-list').scrollTop = 0; if (state.region && window.innerWidth <= 1150) byId('ww-feed-title').scrollIntoView({ behavior: 'instant', block: 'start' }); }); pins.push(node);
    });
    byId('ww-markers').replaceChildren(...pins); byId('ww-map-caption').textContent = pins.length + ' kaartpunten · brongegevens';
  }
  function renderContent() {
    const data = view(); renderedSourceStates = sourceStates(data); document.querySelectorAll('[data-ww-kind]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.wwKind === state.kind)));
    renderStatus(data); renderFeed(data); renderMap(data); openDetail(state.detailId);
  }
  async function refresh() {
    if (state.busy) return; state.busy = true; state.attemptedAt = Date.now(); byId('ww-refresh').disabled = true; byId('ww-connection').textContent = 'Bronnen ophalen';
    try {
      const response = await fetch('/api/world-watcher', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if ([401, 403].includes(response.status)) { state.snapshot = null; throw new Error('Open Instellingen om je toegang opnieuw te controleren.'); }
      const snapshot = await response.json();
      if (!Array.isArray(snapshot.sources) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.regions) || !Number.isFinite(Date.parse(snapshot.checkedAt))) throw new Error('De monitor is tijdelijk niet bereikbaar. Probeer opnieuw.');
      state.snapshot = snapshot; state.disconnected = false; state.error = '';
    } catch (error) { state.disconnected = true; state.error = error.message.startsWith('Open Instellingen') ? error.message : 'Verbinding onderbroken. Beschikbare eerdere gegevens zijn als verouderd gemarkeerd.'; }
    finally { state.busy = false; byId('ww-refresh').disabled = false; renderContent(); }
  }
  const viewport = byId('ww-map-viewport'), plane = byId('ww-map-plane'), map = { scale: 1, x: 0, y: 0, drag: null };
  function applyMap() {
    const maxX = Math.max(viewport.clientWidth * .2, (plane.offsetWidth * map.scale - viewport.clientWidth) / 2), maxY = Math.max(viewport.clientHeight * .2, (plane.offsetHeight * map.scale - viewport.clientHeight) / 2);
    map.x = Math.max(-maxX, Math.min(maxX, map.x)); map.y = Math.max(-maxY, Math.min(maxY, map.y));
    plane.style.transform = 'translate(' + map.x + 'px, calc(-50% + ' + map.y + 'px)) scale(' + map.scale + ')';
    byId('ww-markers').querySelectorAll('.ww-pin').forEach((pin) => pin.style.transform = 'translate(-50%,-50%) scale(' + 1 / map.scale + ')');
    byId('ww-zoom-in').disabled = map.scale >= 4; byId('ww-zoom-out').disabled = map.scale <= 1;
  }
  function zoom(delta) { map.scale = Math.max(1, Math.min(4, map.scale + delta)); applyMap(); }
  function centerOn(lat, lon) { const point = project(lat, lon); map.scale = 2; map.x = (50 - point.x) / 100 * plane.offsetWidth * map.scale; map.y = (50 - point.y) / 100 * plane.offsetHeight * map.scale; applyMap(); }
  byId('ww-zoom-in').addEventListener('click', () => zoom(.5)); byId('ww-zoom-out').addEventListener('click', () => zoom(-.5));
  byId('ww-reset-map').addEventListener('click', () => { map.scale = 1; map.x = map.y = 0; applyMap(); clearSelection(); });
  viewport.addEventListener('pointerdown', (event) => { if (event.button !== 0 || !event.isPrimary || event.target.closest('button,a,.ww-map-detail')) return; map.drag = { id: event.pointerId, x: event.clientX - map.x, y: event.clientY - map.y }; viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', (event) => { if (map.drag?.id !== event.pointerId) return; map.x = event.clientX - map.drag.x; map.y = event.clientY - map.drag.y; applyMap(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => viewport.addEventListener(name, () => { map.drag = null; }));
  viewport.addEventListener('keydown', (event) => { if (event.target !== viewport) return; const moves = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }; if (moves[event.key]) { event.preventDefault(); map.x += moves[event.key][0]; map.y += moves[event.key][1]; applyMap(); } else if (['+', '-', '='].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? -.5 : .5); } });
  new ResizeObserver(applyMap).observe(viewport);
  byId('ww-search').addEventListener('input', (event) => { state.query = event.target.value; state.detailId = ''; renderContent(); });
  document.querySelectorAll('[data-ww-kind]').forEach((node) => node.addEventListener('click', () => { state.kind = node.dataset.wwKind; clearSelection(); }));
  byId('ww-clear-selection').addEventListener('click', () => { clearSelection(); byId('ww-search').focus(); });
  byId('ww-close-detail').addEventListener('click', () => { const id = state.detailId; openDetail(''); byId('ww-markers').querySelector('[data-item="' + id + '"]')?.focus({ preventScroll: true }); });
  byId('ww-refresh').addEventListener('click', refresh);
  byId('ww-fullscreen').hidden = !document.fullscreenEnabled;
  byId('ww-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await byId('ww-monitor').requestFullscreen(); } catch { warn('Volledig scherm is niet beschikbaar in deze browser.'); } });
  document.addEventListener('fullscreenchange', () => { byId('ww-fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Volledig scherm sluiten' : 'Volledig scherm'); applyMap(); });
  byId('ww-about').addEventListener('click', () => byId('ww-about-dialog').showModal()); byId('ww-close-about').addEventListener('click', () => byId('ww-about-dialog').close());
  byId('ww-about-dialog').addEventListener('close', () => byId('ww-about').focus());
  function toggleNavigation(open) { document.body.classList.toggle('ww-nav-open', open); byId('ww-shade').hidden = !open; byId('ww-menu').setAttribute('aria-expanded', String(open)); byId('ww-menu').setAttribute('aria-label', open ? 'Sluit navigatie' : 'Open navigatie'); byId('ww-menu').textContent = open ? '×' : '☰'; if (!open) byId('ww-menu').focus(); }
  byId('ww-menu').addEventListener('click', () => toggleNavigation(!document.body.classList.contains('ww-nav-open'))); byId('ww-shade').addEventListener('click', () => toggleNavigation(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !byId('ww-about-dialog').open) { if (document.body.classList.contains('ww-nav-open')) toggleNavigation(false); else if (state.detailId) byId('ww-close-detail').click(); } });
  window.matchMedia('(max-width:900px)').addEventListener('change', () => { if (document.body.classList.contains('ww-nav-open')) toggleNavigation(false); });
  const sidebar = byId('ww-sidebar');
  function syncSidebar() {
    if (!sidebar.children.length) return;
    sidebar.setAttribute('data-static-sidebar', '1'); sidebar.setAttribute('data-sidebar-ready', 'true'); if (sidebar.classList.contains('sidebar-fit-compact') || sidebar.classList.contains('sidebar-fit-tight')) sidebar.classList.remove('sidebar-fit-compact', 'sidebar-fit-tight'); sidebar.style.transform = ''; sidebar.style.translate = ''; sidebar.style.willChange = '';
    sidebar.querySelectorAll('.sidebar-link').forEach((node) => { const active = node.getAttribute('href') === '/premium-instellingen'; if (node.classList.contains('active') !== active) node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'location'); else node.removeAttribute('aria-current'); });
  }
  syncSidebar(); new MutationObserver(syncSidebar).observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  function tick() { byId('ww-clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }
  setInterval(tick, 1000); tick(); applyMap(); refresh();
  setInterval(() => { if (document.hidden) return; if (Date.now() - state.attemptedAt >= FIVE_MINUTES) refresh(); else { const data = view(); if (renderedSourceStates !== sourceStates(data)) renderContent(); else renderStatus(data); } }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderContent(); if (Date.now() - state.attemptedAt >= FIVE_MINUTES) refresh(); } });
})();
