const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createController,
  getAvailableWithWebsiteCount,
  start,
} = require('../../assets/kvk-database-metrics');

function createTextNode() {
  return {
    textContent: '',
    hidden: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function createElement(selectors = []) {
  const nodes = Object.fromEntries(selectors.map((selector) => [selector, createTextNode()]));
  const classes = new Set();
  return {
    textContent: '',
    querySelector(selector) { return nodes[selector] || null; },
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    nodes,
  };
}

test('with-website stock is derived from usable minus without-website when the reported subtotal lags', () => {
  assert.equal(getAvailableWithWebsiteCount({
    state: { usable: 3162, with_website: 131, without_website: 310 },
  }), 2852);
});

test('with-website stock falls back to the reported subtotal when the partition is invalid', () => {
  assert.equal(getAvailableWithWebsiteCount({
    state: { usable: 100, with_website: 7, without_website: 120 },
  }), 7);
});

test('dashboard keeps the correct total while preserving the independent last-60 delta', () => {
  const total = createElement();
  const delta = createElement(['.stat-delta-number', '.stat-delta-label']);
  const elements = {
    'companies-with-website': total,
    'companies-with-website-last60': delta,
  };
  const snapshot = {
    generatedAt: '2026-09-15T22:44:16+02:00',
    state: {
      usable: 3162,
      with_website: 131,
      without_website: 310,
      last_60_minutes: { with_website: 579 },
    },
  };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => snapshot,
    now: () => Date.parse('2026-09-15T22:44:17+02:00'),
  });

  controller.renderMetrics();

  assert.equal(total.textContent, '2.852');
  assert.equal(delta.nodes['.stat-delta-number'].textContent, '+579');
});

test('mutation observer immediately repairs a stale total written by the core renderer', () => {
  const total = createElement();
  const elements = { 'companies-with-website': total };
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    trigger() { this.callback([]); }
  }
  const windowRef = {
    MutationObserver: FakeMutationObserver,
    setInterval() {},
    addEventListener() {},
  };
  const documentRef = {
    hidden: false,
    getElementById: (id) => elements[id] || null,
    addEventListener() {},
  };
  const controller = start({
    document: documentRef,
    window: windowRef,
    getSnapshot: () => ({
      state: { usable: 3162, with_website: 131, without_website: 310 },
    }),
  });

  assert.equal(total.textContent, '2.852');
  assert.ok(controller.withWebsiteObserver);
  total.textContent = '131';
  controller.withWebsiteObserver.trigger();
  assert.equal(total.textContent, '2.852');
  assert.ok(observers.length >= 1);
});
