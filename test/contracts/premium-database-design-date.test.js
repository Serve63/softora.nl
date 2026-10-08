const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../../assets/premium-database-design-date');
const { getDesignPhotoCreatedAt } = require('../../server/services/design-photo-created-at');
const row = (date) => ({ websitePhotoCreatedAt: date });

test('design dates use Amsterdam calendar days and handle summer/winter time', () => {
  assert.deepEqual(ui.parts(row('2026-10-07T22:30:00Z')), { day: '2026-10-08', label: '08-10-2026 · 00:30' });
  assert.equal(ui.parts(row('2026-12-01T12:00:00Z')).label, '01-12-2026 · 13:00');
  assert.equal(ui.parts(row('2026-10-25T00:30:00Z')).label, '25-10-2026 · 02:30');
  assert.equal(ui.parts(row('2026-10-25T01:30:00Z')).label, '25-10-2026 · 02:30');
  assert.equal(ui.matches(row('2026-10-07T22:30:00Z'), '2026-10-08'), true);
  assert.equal(ui.matches(row('2026-10-07T21:59:00Z'), '2026-10-08'), false);
  assert.equal(ui.matches({}, '2026-10-08'), false);
  assert.equal(ui.matches({}, ''), true);
});
test('sorting includes the time, leaves unknown dates last and does not mutate distance order', () => {
  const early = row('2026-10-08T08:00:00Z'), late = row('2026-10-08T13:00:00Z'), unknown = {};
  const rows = [unknown, early, late];
  assert.deepEqual(ui.sort(rows, 'newest'), [late, early, unknown]);
  assert.deepEqual(ui.sort(rows, 'oldest'), [early, late, unknown]);
  assert.deepEqual(rows, [unknown, early, late]);
  assert.equal(ui.sort(rows, ''), rows);
});
test('design creation never comes from customer updates, storage repair or signing dates', () => {
  const original = '2026-09-20T12:34:56.000Z';
  assert.equal(getDesignPhotoCreatedAt({ updated_at: '2026-10-08T10:00:00Z' }), '');
  assert.equal(getDesignPhotoCreatedAt({ legacy_meta: { generationJobId: 'job', mockupQualityCheckedAt: original, mockup: { qualityCheckedAt: '2026-10-08T10:00:00Z' } } }), original);
  assert.equal(getDesignPhotoCreatedAt({ legacy_meta: { websitePhotoCreatedAt: original, mockupQualityCheckedAt: '2026-10-08T10:00:00Z' } }), original);
  assert.equal(getDesignPhotoCreatedAt({ websitePhotoCreatedAt: '2026-10-08' }), '');
  assert.equal(ui.parts(row('<script>')), null);
  assert.match(ui.render({}), /Aanmaakdatum onbekend/);
});
test('date click, picker, ordering and clear reset pagination and cooperate with list navigation', () => {
  const elements = new Map();
  function element(id) { if (!elements.has(id)) elements.set(id, { value: '', hidden: false, events: {}, addEventListener(name, handler) { this.events[name] = handler; } }); return elements.get(id); }
  let resets = 0, renders = 0;
  const state = { activeStatus: 'instantly-ready' }, tbody = element('tbody');
  const controller = ui.createController({ document: { getElementById: element }, state, tbody, resetVisibleLimit() { resets++; }, renderPage() { renders++; } });
  controller.sync();
  tbody.events.click({ target: { closest: () => ({ dataset: { designDay: '2026-10-08' } }) }, preventDefault() {}, stopPropagation() {} });
  assert.equal(state.designDate, '2026-10-08');
  assert.equal(state.designDateOrder, 'newest');
  assert.equal(controller.matches(row('2026-10-07T10:00:00Z')), false);
  element('designDateInput').value = '2026-10-07'; element('designDateInput').events.change();
  assert.equal(controller.matches(row('2026-10-07T10:00:00Z')), true);
  state.activeStatus = 'instantly'; controller.sync();
  assert.equal(element('designDateFilter').hidden, true);
  assert.equal(controller.matches({}), true);
  state.activeStatus = 'benaderbaar'; controller.sync();
  assert.equal(element('designDateFilter').hidden, false);
  element('designDateClear').events.click(); controller.sync();
  assert.equal(state.designDate, ''); assert.equal(state.designDateOrder, '');
  assert.equal(element('designDateClear').hidden, true);
  assert.equal(resets, 3); assert.equal(renders, 3);
});
test('page integrates design filtering before pagination and renders clickable timestamps', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../premium-database.html'), 'utf8');
  assert.match(html, /!matchesActiveDatabaseFilter\(customer\) \|\| !designDateController.matches\(customer\)/);
  assert.match(html, /designDateController.sort\(databaseSortedLists.sorted\(customers\)\)/);
  assert.match(html, /SoftoraDatabaseDesignDate.render\(customer\)/);
  assert.ok(html.indexOf('const designDateController =') < html.indexOf('const customersCore ='));
});
test('canonical snapshots preserve the design date over later customer changes', () => {
  const snapshot = require('../../assets/premium-database-mail-ready-snapshot');
  const date = '2026-10-08T12:34:56.000Z';
  const result = snapshot.mergeWithCanonicalSnapshots([{ id: 'demo', updatedAt: '2026-10-09', websitePhotoCreatedAt: '' }], [], [], [{ id: 'demo', hasPhoto: true, hasMockup: true, instantlyReadySnapshot: true, webdesignMailProvider: 'instantly', websitePhotoCreatedAt: date }]);
  assert.equal(result[0].websitePhotoCreatedAt, date);
});
test('cached screens distinguish date filters and time ordering from the default list', () => {
  const { viewOf } = require('../../assets/premium-database-screen-snapshot');
  const state = { activeStatus: 'instantly-ready', query: '', sortKey: 'distance', sortAsc: true, visibleLimit: 25 };
  assert.notEqual(viewOf(state), viewOf({ ...state, designDate: '2026-10-08' }));
  assert.notEqual(viewOf(state), viewOf({ ...state, designDateOrder: 'newest' }));
  assert.notEqual(viewOf({ ...state, designDateOrder: 'newest' }), viewOf({ ...state, designDateOrder: 'oldest' }));
});
