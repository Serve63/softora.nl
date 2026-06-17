const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createFakeElement(document, tagName) {
  const element = {
    tagName,
    id: '',
    className: '',
    hidden: false,
    style: {},
    parentNode: null,
    __parts: null,
    appendChild(child) {
      child.parentNode = this;
      if (child.id) document.__elements.set(child.id, child);
      return child;
    },
    insertBefore(child) {
      return this.appendChild(child);
    },
    addEventListener() {},
    querySelector(selector) {
      return this.__parts && this.__parts[selector] ? this.__parts[selector] : null;
    },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this.__html || '';
    },
    set(value) {
      this.__html = String(value || '');
      if (!this.__html.includes('webdesign-bulk-num')) return;
      this.__parts = {
        '.webdesign-bulk-num': createFakeElement(document, 'span'),
        '.webdesign-bulk-fill': createFakeElement(document, 'span'),
        '.webdesign-bulk-rest': createFakeElement(document, 'span'),
        '.webdesign-bulk-cancel': createFakeElement(document, 'button'),
      };
    },
  });
  return element;
}

function createHarness(fetchImpl, options = {}) {
  const document = {
    __elements: new Map(),
    head: null,
    body: null,
    createElement(tagName) {
      return createFakeElement(document, tagName);
    },
    getElementById(id) {
      return this.__elements.get(id) || null;
    },
  };
  document.head = createFakeElement(document, 'head');
  document.body = createFakeElement(document, 'body');
  const context = {
    window: null,
    document,
    fetch: fetchImpl,
    Date,
    Math,
    Number,
    String,
    Array,
    JSON,
    Promise,
    setTimeout: options.setTimeout || function () {
      return 1;
    },
    clearTimeout: options.clearTimeout || function () {},
    requestAnimationFrame(callback) {
      callback();
    },
  };
  context.window = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../../assets/premium-database-webdesign-bulk.js'), 'utf8'),
    context
  );
  return { context, document };
}

test('webdesign bulk cancel hides the status bar after the server confirms cancellation', async () => {
  const fetchCalls = [];
  const cancelCallbacks = [];
  const { context, document } = createHarness(async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    if (String(url).endsWith('/run')) return { ok: true, json: async () => ({ ok: true }) };
    if (String(url).endsWith('/batch-1/cancel')) {
      return {
        ok: true,
        json: async () => ({
          batch: { id: 'batch-1', status: 'cancelled', total: 10, made: 0, done: 0, cancelled: 10 },
          cancelledJobIds: ['job-cancelled-1'],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        batches: [{ id: 'batch-1', status: 'running', total: 10, made: 0, done: 0, cancelled: 0, createdAt: Date.now() }],
      }),
    };
  });
  const controller = context.SoftoraDatabaseWebdesignBulk.createController({
    onCancel(result) {
      cancelCallbacks.push(result);
    },
  });

  await controller.loadLatestBatch();
  assert.equal(document.getElementById('webdesignBulkStatus').hidden, false);

  await controller.cancelActiveBatch();

  assert.equal(document.getElementById('webdesignBulkStatus').hidden, true);
  assert.deepEqual(cancelCallbacks.map((result) => result.cancelledJobIds), [['job-cancelled-1']]);
  assert.equal(fetchCalls.some((call) => String(call.url).endsWith('/batch-1/cancel')), true);
});

test('webdesign bulk cancel keeps the status bar hidden when an older poll returns running later', async () => {
  const timers = [];
  let releaseStalePoll;
  let stalePollRequested = false;
  const stalePollGate = new Promise((resolve) => {
    releaseStalePoll = resolve;
  });
  const { context, document } = createHarness(
    async (url, options = {}) => {
      const target = String(url || '');
      if (target.endsWith('/run')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (target.endsWith('/batch-race/cancel')) {
        assert.equal(options.method, 'POST');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            batch: { id: 'batch-race', status: 'cancelled', total: 10, made: 4, done: 4, cancelled: 6 },
            cancelledJobIds: [],
          }),
        };
      }
      if (target.endsWith('/batch-race')) {
        stalePollRequested = true;
        await stalePollGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({ batch: { id: 'batch-race', status: 'running', total: 10, made: 4, done: 4 } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          batches: [{ id: 'batch-race', status: 'running', total: 10, made: 4, done: 4, createdAt: Date.now() }],
        }),
      };
    },
    {
      setTimeout(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      },
    }
  );
  const controller = context.SoftoraDatabaseWebdesignBulk.createController({});

  await controller.loadLatestBatch();
  await Promise.resolve();
  await Promise.resolve();
  const node = document.getElementById('webdesignBulkStatus');
  assert.equal(node.hidden, false);

  const pollTimer = timers.find((timer) => Number(timer.delay) === 0);
  assert.ok(pollTimer, 'running batch should schedule a status poll');
  pollTimer.callback();
  await Promise.resolve();
  assert.equal(stalePollRequested, true);

  await controller.cancelActiveBatch();
  assert.equal(node.hidden, true);

  releaseStalePoll();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(node.hidden, true);
});

test('webdesign bulk restore ignores cancelled batches instead of showing a cancelled bar', async () => {
  const { context, document } = createHarness(async () => ({
    ok: true,
    json: async () => ({
      batches: [{ id: 'batch-cancelled', status: 'cancelled', total: 10, made: 0, done: 0, cancelled: 10, finishedAt: Date.now() }],
    }),
  }));
  const controller = context.SoftoraDatabaseWebdesignBulk.createController({});

  const batch = await controller.loadLatestBatch();

  assert.equal(batch, null);
  assert.equal(document.getElementById('webdesignBulkStatus'), null);
});
