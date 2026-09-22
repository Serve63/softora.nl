const test = require('node:test');
const assert = require('node:assert/strict');
const {
  singleWebsitePreviewRequest, mergeWebsitePreviewLibrary,
  reconcileWebsitePreviewCards, createWebsitePreviewNavigation,
} = require('../../assets/premium-websitegenerator-ui-state');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test('overlapping library reads or status polls share one request and can retry after failure', async () => {
  const wait = deferred();
  let calls = 0;
  const read = singleWebsitePreviewRequest(() => { calls++; return calls === 1 ? wait.promise : 'ready'; });
  const first = read();
  assert.equal(read(), first);
  wait.reject(new Error('temporary failure'));
  await assert.rejects(first, /temporary failure/);
  assert.equal(await read(), 'ready');
  assert.equal(calls, 2);
});

test('thumbnail and open actions share the same image request but different images load independently', async () => {
  const wait = deferred();
  const calls = [];
  const read = singleWebsitePreviewRequest(id => { calls.push(id); return wait.promise; }, id => id);
  const first = read('a');
  assert.equal(read('a'), first);
  const second = read('b');
  assert.notEqual(second, first);
  wait.resolve('image');
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['a', 'b']);
});

test('metadata refresh preserves already loaded images and authoritative ordering/deletions', () => {
  const current = [{ id: 'a', dataUrl: 'image-a' }, { id: 'b', dataUrl: 'image-b' }, { id: 'deleted' }];
  const result = mergeWebsitePreviewLibrary([{ id: 'b', imageDeferred: true }, { id: 'a', dataUrl: 'updated' }], current);
  assert.deepEqual(result.map(x => [x.id, x.dataUrl]), [['b', 'image-b'], ['a', 'updated']]);
});

function navigationFixture(loadLibrary) {
  const make = (id, tab) => ({ id, dataset: { tab }, active: tab === 'scan', classList: { toggle(_, on) { this.owner.active = on; } } });
  const panels = [make('tab-library'), make('tab-scan')];
  const tabs = [make('', 'library'), make('', 'scan')];
  [...panels, ...tabs].forEach(el => { el.classList.owner = el; });
  const writes = [], listeners = {};
  const window = {
    location: { pathname: '/premium-websitegenerator', search: '', hash: '' },
    history: { replaceState(_, __, url) { writes.push(url); window.location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; } },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  let renders = 0;
  const nav = createWebsitePreviewNavigation({ window,
    document: { querySelectorAll: selector => selector === '.tab-panel' ? panels : tabs },
    loadLibrary, renderLibrary: () => renders++,
  });
  return { nav, window, panels, writes, listeners, renders: () => renders };
}

test('one library click updates the URL immediately and late data cannot reopen it after leaving', async () => {
  const wait = deferred();
  let calls = 0;
  const f = navigationFixture(() => { calls++; return wait.promise; });
  const loading = f.nav.switchTab('library');
  assert.equal(f.window.location.hash, '#bibliotheek');
  assert.equal(calls, 1);
  await f.nav.switchTab('scan');
  const renders = f.renders();
  wait.resolve();
  await loading;
  assert.equal(f.window.location.hash, '');
  assert.equal(f.panels.find(p => p.active).id, 'tab-scan');
  assert.equal(f.renders(), renders);
  assert.equal(f.writes.length, 2);
});

test('a library deep link loads once and browser hash navigation selects the scan tab', async () => {
  let calls = 0;
  const f = navigationFixture(async () => { calls++; });
  f.window.location.hash = '#bibliotheek';
  f.nav.init();
  await Promise.resolve();
  assert.equal(calls, 1);
  f.window.location.hash = '';
  f.listeners.hashchange();
  assert.equal(f.panels.find(p => p.active).id, 'tab-scan');
});

test('unchanged cards retain their image/focus nodes across refreshes, while additions and removals reconcile', () => {
  let creations = 0;
  const grid = { children: [], insertBefore(card, before) {
    const old = this.children.indexOf(card);
    if (old >= 0) this.children.splice(old, 1);
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, card);
  } };
  const create = entry => { creations++; return { dataset: { libraryId: entry.id }, remove() { grid.children.splice(grid.children.indexOf(this), 1); } }; };
  const entries = ['a', 'b', 'c'].map(id => ({ id, hostname: id }));
  reconcileWebsitePreviewCards(grid, entries, create);
  const original = [...grid.children];
  reconcileWebsitePreviewCards(grid, entries, create);
  assert.deepEqual(grid.children, original);
  assert.equal(creations, 3);
  reconcileWebsitePreviewCards(grid, [entries[2], { id: 'new', hostname: 'new' }], create);
  assert.equal(grid.children[0], original[2]);
  assert.deepEqual(grid.children.map(card => card.dataset.libraryId), ['c', 'new']);
});

test('a slow image open cannot override a newer image selection or tab click', async () => {
  const f = navigationFixture(async () => {});
  const first = f.nav.beginOpen();
  const latest = f.nav.beginOpen();
  assert.equal(first(), false);
  assert.equal(latest(), true);
  await f.nav.switchTab('scan');
  assert.equal(latest(), false);
});
