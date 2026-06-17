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

function createHarness(fetchImpl) {
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
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
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
