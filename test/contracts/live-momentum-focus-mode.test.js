const test = require('node:test');
const assert = require('node:assert/strict');

const focusMode = require('../../assets/live-momentum-focus-mode.js');

function createClassList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
  };
}

function createHarness() {
  const buttonListeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const attributes = new Map();
  const scrollers = [{ scrollLeft: 31, scrollTop: 7 }, { scrollLeft: 92, scrollTop: 0 }];
  let focusCalls = 0;
  const button = {
    dataset: {},
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) || null,
    addEventListener: (name, handler) => buttonListeners.set(name, handler),
    removeEventListener: (name) => buttonListeners.delete(name),
    focus: () => { focusCalls += 1; },
  };
  const body = { classList: createClassList() };
  const document = {
    body,
    querySelector: (selector) => selector === '[data-momentum-focus-toggle]' ? button : null,
    querySelectorAll: () => scrollers,
    addEventListener: (name, handler) => documentListeners.set(name, handler),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  const window = {
    scrollX: 14,
    scrollY: 280,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
    requestAnimationFrame: (callback) => callback(),
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    removeEventListener: (name) => windowListeners.delete(name),
  };
  return { button, body, document, window, attributes, scrollers, buttonListeners, documentListeners, windowListeners, get focusCalls() { return focusCalls; } };
}

test('focusmodus is standaard uit, wisselt zonder remount en bewaart alle scroll/state', () => {
  const harness = createHarness();
  const originalScrollerRefs = [...harness.scrollers];
  const controller = focusMode.init(harness);

  assert.ok(controller);
  assert.equal(harness.attributes.get('aria-pressed'), 'false');
  assert.equal(harness.body.classList.contains('momentum-focus-mode'), false);

  harness.buttonListeners.get('click')();
  assert.equal(harness.attributes.get('aria-pressed'), 'true');
  assert.equal(harness.attributes.get('aria-label'), 'Normale weergave herstellen');
  assert.equal(harness.body.classList.contains('momentum-focus-mode'), true);
  assert.deepEqual(harness.scrollers, originalScrollerRefs);
  assert.deepEqual(harness.scrollers.map((item) => item.scrollLeft), [31, 92]);
  assert.deepEqual([harness.window.scrollX, harness.window.scrollY], [14, 280]);

  harness.documentListeners.get('keydown')({ key: 'Escape' });
  assert.equal(harness.attributes.get('aria-pressed'), 'false');
  assert.equal(harness.attributes.get('title'), 'Vergrote weergave openen');
  assert.equal(harness.body.classList.contains('momentum-focus-mode'), false);
  assert.equal(harness.focusCalls, 1);
});

test('pageshow en herinitialisatie lekken geen focusstate of dubbele listeners', () => {
  const harness = createHarness();
  const controller = focusMode.init(harness);
  const firstClick = harness.buttonListeners.get('click');
  firstClick();
  assert.equal(harness.body.classList.contains('momentum-focus-mode'), true);

  harness.windowListeners.get('pageshow')();
  assert.equal(harness.body.classList.contains('momentum-focus-mode'), false);
  assert.equal(harness.attributes.get('aria-pressed'), 'false');
  assert.equal(focusMode.init(harness), null);
  assert.equal(harness.buttonListeners.get('click'), firstClick);

  controller.destroy();
  assert.equal(harness.buttonListeners.size, 0);
  assert.equal(harness.documentListeners.size, 0);
  assert.equal(harness.windowListeners.size, 0);
});
