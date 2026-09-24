const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start, CANONICAL_CATEGORIES } = require('../../assets/kvk-database-metrics');

const totalIds = [
  'companies-treated', 'companies-usable', 'companies-with-website',
  'companies-without-website', 'companies-successful-found',
  'companies-declared-unusable', 'companies-control-room',
];
const counts = {
  behandeld: 120, 'bruikbaar-verklaard': 110, 'onbruikbaar-verklaard': 3,
  controlekamer: 7, bruikbaar: 100, 'met-website': 90, 'zonder-werkende-website': 10,
};

function harness(initialSnapshot = { state: { treated: 12, usable: 10, without_website: 1 } }, initialFailed = false) {
  let snapshot = initialSnapshot;
  let failed = initialFailed;
  let requests = 0;
  const pending = new Set();
  const intervals = [];
  const elements = Object.fromEntries(totalIds.map((id) => {
    let text = '0';
    const element = {
      observers: new Set(), writes: 0,
      get textContent() { return text; },
      set textContent(value) {
        text = String(value);
        this.writes += 1;
        // Match DOM textContent: even assigning the same nonempty string
        // replaces a text node and enqueues a childList mutation.
        for (const observer of this.observers) pending.add(observer);
      },
    };
    return [id, element];
  }));
  class QueuedMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(element) { element.observers.add(this); }
  }
  const windowRef = {
    MutationObserver: QueuedMutationObserver,
    setInterval(fn, ms) { intervals.push({ fn, ms }); },
    addEventListener() {},
    async fetch(url, options) {
      requests += 1;
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'same-origin');
      const category = new URL(url, 'https://example.test').searchParams.get('categorie');
      return {
        ok: !failed,
        json: async () => ({ ok: true, total_is_exact: true, total: counts[category] }),
      };
    },
  };
  const controller = start({
    window: windowRef,
    document: { getElementById: id => elements[id] || null, addEventListener() {}, hidden: false },
    getSnapshot: () => snapshot,
  });
  return {
    controller, elements, intervals,
    setSnapshot(value) { snapshot = value; },
    setFailed(value) { failed = value; },
    getRequests: () => requests,
    flush() {
      let rounds = 0;
      while (pending.size) {
        assert.ok(++rounds <= 10, 'metrics observers must settle instead of starving the browser event loop');
        const callbacks = [...pending];
        pending.clear();
        for (const observer of callbacks) observer.callback([]);
      }
      return rounds;
    },
  };
}

test('canonical metrics and the two real observer paths converge without a feedback loop', async () => {
  const app = harness();
  assert.equal(await app.controller.refreshCanonicalCounts(), true);
  assert.ok(app.flush() <= 2);
  assert.equal(app.elements['companies-with-website'].textContent, '90');
  const writes = totalIds.map(id => app.elements[id].writes);
  for (let i = 0; i < 20; i += 1) app.controller.renderMetrics();
  assert.equal(app.flush(), 0);
  assert.deepEqual(totalIds.map(id => app.elements[id].writes), writes);
  assert.equal(app.getRequests(), Object.keys(CANONICAL_CATEGORIES).length);
});

test('core-renderer writes are corrected once, without restarting an observer loop', async () => {
  const app = harness();
  await app.controller.refreshCanonicalCounts();
  app.flush();
  app.elements['companies-treated'].textContent = '12';
  app.elements['companies-with-website'].textContent = '4';
  assert.ok(app.flush() <= 2);
  assert.equal(app.elements['companies-treated'].textContent, '120');
  assert.equal(app.elements['companies-with-website'].textContent, '90');
  assert.equal(app.flush(), 0);
});

test('canonical inventory renders even before the full planning snapshot arrives', async () => {
  const app = harness(null);
  assert.equal(await app.controller.refreshCanonicalCounts(), true);
  app.flush();
  assert.equal(app.elements['companies-usable'].textContent, '100');
  assert.equal(app.elements['companies-with-website'].textContent, '90');
  app.setSnapshot({ state: { usable: 10, without_website: 1 } });
  app.controller.renderMetrics();
  assert.equal(app.flush(), 0);
  assert.equal(app.elements['companies-usable'].textContent, '100');
});

test('unavailable canonical counts preserve the snapshot fallback and remain retryable', async () => {
  const app = harness(undefined, true);
  assert.equal(await app.controller.refreshCanonicalCounts(), false);
  app.flush();
  app.elements['companies-with-website'].textContent = '4';
  app.flush();
  assert.equal(app.elements['companies-with-website'].textContent, '9');
  app.setFailed(false);
  assert.equal(await app.controller.refreshCanonicalCounts(), true);
  app.flush();
  assert.equal(app.elements['companies-with-website'].textContent, '90');
  app.setFailed(true);
  assert.equal(await app.controller.refreshCanonicalCounts(), false);
  app.flush();
  assert.equal(app.elements['companies-with-website'].textContent, '90');
  assert.ok(app.intervals.some(({ ms }) => ms === 1000));
  assert.ok(app.intervals.some(({ ms }) => ms === 30000));
});

test('the dashboard requests the repaired metrics asset with a fresh cache key', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-kvk-database.html'), 'utf8');
  assert.match(page, /kvk-database-metrics\.js\?v=20260924-upload-refresh/);
  assert.doesNotMatch(page, /kvk-database-metrics\.js\?v=20260910-flow/);
});
