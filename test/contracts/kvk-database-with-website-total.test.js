const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createController,
  fetchCanonicalDirectoryCounts,
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

test('with-website snapshot fallback is derived from usable minus without-website when the reported subtotal lags', () => {
  assert.equal(getAvailableWithWebsiteCount({
    state: { usable: 3162, with_website: 131, without_website: 310 },
  }), 2852);
});

test('with-website snapshot fallback uses the reported subtotal when the partition is invalid', () => {
  assert.equal(getAvailableWithWebsiteCount({
    state: { usable: 100, with_website: 7, without_website: 120 },
  }), 7);
});

test('canonical directory counts are read from the same exact category endpoints as the open buttons', async () => {
  const totals = {
    behandeld: 46_227,
    'bruikbaar-verklaard': 20_783,
    'onbruikbaar-verklaard': 1_238,
    controlekamer: 24_206,
    bruikbaar: 14_053,
    'met-website': 13_743,
    'zonder-werkende-website': 310,
  };
  const requested = [];
  const counts = await fetchCanonicalDirectoryCounts(async (url, options) => {
    const parsed = new URL(url, 'https://softora.nl');
    const category = parsed.searchParams.get('categorie');
    requested.push([category, parsed.searchParams.get('limit'), options.credentials]);
    return {
      ok: true,
      async json() {
        return { ok: true, total: totals[category], total_is_exact: true };
      },
    };
  });

  assert.deepEqual(counts, {
    treated: 46_227,
    successfulFound: 20_783,
    declaredUnusable: 1_238,
    controlRoom: 24_206,
    usable: 14_053,
    withWebsite: 13_743,
    withoutWebsite: 310,
  });
  assert.equal(requested.length, 7);
  assert.ok(requested.every(([, limit, credentials]) => limit === '1' && credentials === 'same-origin'));
});

test('dashboard replaces stale snapshot stock totals with canonical directory totals while keeping last-60 activity', async () => {
  const withWebsiteTotal = createElement();
  const usableTotal = createElement();
  const withoutWebsiteTotal = createElement();
  const treatedTotal = createElement();
  const successfulFound = createElement();
  const declaredUnusable = createElement();
  const controlRoom = createElement();
  const withWebsiteDelta = createElement(['.stat-delta-number', '.stat-delta-label']);
  const elements = {
    'companies-with-website': withWebsiteTotal,
    'companies-usable': usableTotal,
    'companies-without-website': withoutWebsiteTotal,
    'companies-treated': treatedTotal,
    'companies-successful-found': successfulFound,
    'companies-declared-unusable': declaredUnusable,
    'companies-control-room': controlRoom,
    'companies-with-website-last60': withWebsiteDelta,
  };
  const totals = {
    behandeld: 46_227,
    'bruikbaar-verklaard': 20_783,
    'onbruikbaar-verklaard': 1_238,
    controlekamer: 24_206,
    bruikbaar: 14_053,
    'met-website': 13_743,
    'zonder-werkende-website': 310,
  };
  const snapshot = {
    generatedAt: '2026-09-15T22:44:16+02:00',
    state: {
      treated: 4_000,
      usable: 3_162,
      with_website: 131,
      without_website: 310,
      declared_usable: 4_000,
      declared_unusable: 900,
      control_room: 800,
      last_60_minutes: { with_website: 579 },
    },
  };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => snapshot,
    now: () => Date.parse('2026-09-15T22:44:17+02:00'),
    fetchImpl: async (url) => {
      const category = new URL(url, 'https://softora.nl').searchParams.get('categorie');
      return {
        ok: true,
        async json() { return { ok: true, total: totals[category], total_is_exact: true }; },
      };
    },
  });

  controller.renderMetrics();
  assert.equal(withWebsiteTotal.textContent, '2.852');

  assert.equal(await controller.refreshCanonicalCounts(), true);
  assert.equal(treatedTotal.textContent, '46.227');
  assert.equal(successfulFound.textContent, '20.783');
  assert.equal(declaredUnusable.textContent, '1.238');
  assert.equal(controlRoom.textContent, '24.206');
  assert.equal(usableTotal.textContent, '14.053');
  assert.equal(withWebsiteTotal.textContent, '13.743');
  assert.equal(withoutWebsiteTotal.textContent, '310');
  assert.equal(withWebsiteDelta.nodes['.stat-delta-number'].textContent, '+579');
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
