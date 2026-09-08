const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'relaxst-configurator-demo.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.js'), 'utf8');

test('Relaxst demo keeps the configurator as a self-contained public page', () => {
  assert.match(html, /<title>Stel jouw ideale relaxstoel samen \| Relaxst<\/title>/);
  assert.match(html, /href="\/assets\/relaxst-configurator-demo\.css\?v=20260908-1"/);
  assert.match(html, /src="\/assets\/relaxst-configurator-demo\.js\?v=20260908-1"/);
  assert.match(html, /data-step-target="1"/);
  assert.match(html, /data-step-target="5"/);
  assert.match(html, /Interactieve conceptdemo/);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /id="benefits"/);
  assert.doesNotMatch(html, /<footer\b/i);
  assert.doesNotMatch(html, /Een stoel die klopt|Geen verrassingen|Altijd persoonlijk advies/);
  assert.doesNotMatch(html, /Kies stap voor stap het model/);
});

test('Relaxst demo exposes the promised product choices and live price logic', () => {
  assert.match(script, /const MODELS =/);
  assert.match(script, /comfora:/);
  assert.match(script, /linea:/);
  assert.match(script, /zeus:/);
  assert.match(script, /const UPHOLSTERY =/);
  assert.match(script, /const MECHANISMS =/);
  assert.match(script, /upholstery-grid/);
  assert.match(script, /mechanism-grid/);
  assert.match(script, /function totalPrice\(\)/);
  assert.match(script, /Bekijk resultaat/);
  assert.match(html, /href="https:\/\/www\.relaxst\.nl\/afspraak\/"/);
  assert.match(html, /id="download-configuration" download/);
  assert.doesNotMatch(html + script, /Udenhout/);
});

test('Relaxst demo includes responsive and accessible interaction states', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /white-space: nowrap/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /\.hero \{[\s\S]*?min-height: 300px;[\s\S]*?align-items: center;/);
  assert.match(css, /@media \(min-width: 1051px\)[\s\S]*?height: calc\(100dvh - 268px\);/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<dialog id="success-dialog" aria-labelledby="result-title">/);
  assert.match(html, /id="mobile-previous" aria-label="Vorige stap"/);
});


// Exercise the real event handlers without network or external effects.
function demoHarness(saved = null, historyBlocked = false) {
  const vm = require('node:vm');
  const nodes = new Map();
  const inputs = [];
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
  };
  function element() {
    const listeners = {};
    return {
      listeners, style: {}, dataset: {}, textContent: '', src: '',
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, fn) { listeners[type] = fn; },
      setAttribute() {}, focus() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector(selector) { return document.querySelector(selector); },
      querySelectorAll() { return inputs; },
      getBoundingClientRect() { return { left: 10, right: 400, top: 10, bottom: 700 }; },
      set innerHTML(value) {
        this.html = value;
        if (this !== nodes.get('#step-content')) return;
        inputs.length = 0;
        for (const match of value.matchAll(/<input type="(radio|checkbox)" name="([^"]+)" value="([^"]+)"([^>]*)>/g)) {
          const input = element();
          Object.assign(input, { type: match[1], name: match[2], value: match[3], checked: match[4].includes('checked') });
          input.closest = () => element();
          inputs.push(input);
        }
      },
      get innerHTML() { return this.html; },
    };
  }
  const location = new URL('https://demo.example/relaxst-configurator-demo');
  if (saved !== null) location.searchParams.set('config', saved);
  const window = {
    innerWidth: 1200,
    location,
    history: {
      replaceState(state, title, url) { if (historyBlocked) throw Error('blocked'); location.href = url.href; },
    },
    matchMedia: () => ({ matches: false }),
  };
  vm.runInNewContext(script, { document, window, Intl, Set, Object, JSON, URL, URLSearchParams, encodeURIComponent });
  const node = (selector) => document.querySelector(selector);
  function choose(name, value, checked = true) {
    const input = inputs.find((candidate) => candidate.name === name && candidate.value === value);
    assert.ok(input, `choice exists: ${name}/${value}`);
    input.checked = checked;
    input.listeners.change();
  }
  const click = (selector) => node(selector).listeners.click();
  return { node, choose, click, location };
}

test('Relaxst computes selected prices, subtracts unchecked extras and exports exactly the chosen configuration', () => {
  const demo = demoHarness();
  assert.match(demo.node('#stage-price').textContent, /2\.987/);
  demo.choose('model', 'zeus');
  demo.click('#next-step');
  demo.choose('upholstery', 'leer');
  demo.choose('color', 'olijf');
  demo.click('#next-step');
  demo.choose('size', 'L');
  demo.click('#next-step');
  demo.choose('mechanism', '5motor');
  for (const extra of ['topswing', 'lendenpomp', 'verwarming']) demo.choose('extra', extra);
  assert.match(demo.node('#stage-price').textContent, /5\.752/);
  demo.choose('extra', 'accu', false);
  assert.match(demo.node('#stage-price').textContent, /5\.503/);
  demo.click('#next-step');
  demo.click('#next-step');
  assert.equal(demo.node('#success-dialog').open, true);
  const link = demo.node('#download-configuration');
  const overview = decodeURIComponent(link.href.split(',').slice(1).join(','));
  for (const expected of ['Zeus (ZE-05)', 'Premium leder - Olijf', 'L - Ruim', '5 motoren premium', '5.503', 'geen bestelling']) assert.ok(overview.includes(expected), expected);
  assert.ok(!overview.includes('Draadloze accu'));
  assert.equal(link.download, 'Relaxst-Zeus-samenstelling.txt');
  assert.equal(demo.node('#compact-price').textContent, demo.node('#mobile-price').textContent);
});

test('Relaxst keeps the latest model image when switching rapidly back to the initial model', () => {
  const demo = demoHarness();
  demo.choose('model', 'comfora');
  demo.choose('model', 'zeus');
  demo.choose('model', 'linea');
  assert.equal(demo.node('#selected-model-name').textContent, 'Linea');
  assert.match(demo.node('#chair-image').src, /2024\/11\/Relaxst-1-12\.jpg$/);
  assert.match(demo.node('#chair-image').alt, /Linea/);
});

test('Relaxst restores only valid choices from its URL and works with corrupt data or blocked history', () => {
  const demo = demoHarness(JSON.stringify({ model: 'zeus', upholstery: '__proto__', color: 'invalid', size: 'L', extras: ['accu', 'accu', 'invalid'] }));
  assert.equal(demo.node('#selected-model-name').textContent, 'Zeus');
  assert.match(demo.node('#stage-price').textContent, /3\.934/);
  const restored = demoHarness(JSON.stringify({ model: 'comfora', mechanism: 'handmatig', extras: [] }));
  assert.match(restored.node('#stage-price').textContent, /2\.295/);
  assert.match(demoHarness('{').node('#stage-price').textContent, /2\.987/);
  const blocked = demoHarness(null, true);
  blocked.choose('model', 'comfora');
  assert.match(blocked.node('#stage-price').textContent, /2\.939/);
  demo.choose('model', 'linea');
  const reloaded = demoHarness(demo.location.searchParams.get('config'));
  assert.equal(reloaded.node('#selected-model-name').textContent, 'Linea');
  assert.match(reloaded.node('#stage-price').textContent, /3\.082/);
});

test('Relaxst mobile navigation reaches the result and back without losing selections', () => {
  const demo = demoHarness();
  assert.equal(demo.node('#mobile-previous').disabled, true);
  demo.click('#mobile-next');
  demo.choose('upholstery', 'microleder');
  demo.click('#mobile-previous');
  assert.equal(demo.node('#current-step-number').textContent, 1);
  assert.match(demo.node('#stage-price').textContent, /3\.282/);
  for (let step = 1; step < 5; step++) demo.click('#mobile-next');
  assert.match(demo.node('#mobile-next').innerHTML, /Bekijk resultaat/);
  demo.click('#mobile-next');
  assert.equal(demo.node('#success-dialog').open, true);
  assert.match(demo.node('#dialog-summary').innerHTML, /Microleder/);
});

test('Relaxst result stays open when clicking its own padding and closes on the backdrop', () => {
  const demo = demoHarness();
  for (let step = 1; step <= 5; step++) demo.click('#next-step');
  const dialog = demo.node('#success-dialog');
  dialog.listeners.click({ target: dialog, clientX: 20, clientY: 20 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 450, clientY: 20 });
  assert.equal(dialog.open, false);
});
