const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../assets/articles/ebook.js'), 'utf8');

function browser(initialTime = 0) {
  let time = initialTime, nextId = 0;
  const timers = new Map(), elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, events: {}, value: '', open: false,
      addEventListener(type, handler) { this.events[type] = handler; },
      querySelector: element, querySelectorAll: () => [],
      focus() { document.activeElement = this; },
      showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); },
      setAttribute() {}, removeAttribute() {}, reportValidity: () => true,
    });
    return elements.get(selector);
  }
  const document = { hidden: false, activeElement: null, events: {},
    querySelector: (selector) => selector.startsWith('dialog[open]') ? null : element(selector),
    querySelectorAll: () => [element('[data-ebook-open]')],
    addEventListener(type, handler) { this.events[type] = handler; },
  };
  element('[data-ebook-form]').elements = { name: element('name'), email: element('email'), website: element('website') };
  const window = { setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, { document, window, performance: { now: () => time }, AbortController });
  return { document, element, tick(ms) {
    const target = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target;
  } };
}

test('the offer appears at ten seconds from navigation without moving reading focus', () => {
  const b = browser(2000);
  b.tick(7999); assert.equal(b.element('[data-ebook-teaser]').hidden, true);
  b.tick(1); assert.equal(b.element('[data-ebook-teaser]').hidden, false);
  assert.equal(b.document.activeElement, null);
});

test('time in another tab pauses the offer and dismissing it does not restart it', () => {
  const b = browser(1000); b.tick(3000);
  b.document.hidden = true; b.document.events.visibilitychange(); b.tick(60000);
  assert.equal(b.element('[data-ebook-teaser]').hidden, true);
  b.document.hidden = false; b.document.events.visibilitychange(); b.tick(5999);
  assert.equal(b.element('[data-ebook-teaser]').hidden, true);
  b.tick(1); assert.equal(b.element('[data-ebook-teaser]').hidden, false);
  b.element('[data-ebook-dismiss]').events.click(); b.tick(60000);
  assert.equal(b.element('[data-ebook-teaser]').hidden, true);
  assert.equal(b.element('[data-ebook-launcher]').hidden, false);
  b.element('[data-ebook-open]').events.click();
  assert.equal(b.element('[data-ebook-dialog]').open, true);
  assert.equal(b.document.activeElement, b.element('name'));
});
