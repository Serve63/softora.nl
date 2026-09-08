const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'relaxst-configurator-demo.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.js'), 'utf8');
const framingScript = fs.readFileSync(path.join(root, 'assets/relaxst/chair-framing.js'), 'utf8');

test('Relaxst demo keeps the configurator as a self-contained public page', () => {
  assert.match(html, /<title>Stel jouw ideale relaxstoel samen \| Relaxst<\/title>/);
  assert.match(html, /href="\/assets\/relaxst-configurator-demo\.css\?v=20260908-8"/);
  assert.match(html, /src="\/assets\/relaxst-configurator-demo\.js\?v=20260908-7"/);
  assert.match(html, /src="\/assets\/relaxst\/chair-framing\.js\?v=20260908-7" defer/);
  assert.ok(html.indexOf('/assets/relaxst/chair-framing.js') < html.indexOf('/assets/relaxst-configurator-demo.js'));
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
  assert.match(css, /\.builder-actions\s*\{[^}]*position: static/);
  assert.match(css, /@media \(min-width: 801px\) and \(max-height: 800px\)/);
  assert.match(css, /\.option-card\.is-selected/);
  assert.doesNotMatch(html, /hero-number|visual-orbit|id="stage-price"/);
  assert.match(html, /Jouw keuzes incl\. btw/);
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
    querySelectorAll(selector) { return selector === '[data-step-target]' ? stepButtons : []; },
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
  const stepButtons = Array.from({ length: 5 }, (_, i) => Object.assign(element(), { dataset: { stepTarget: String(i + 1) } }));
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
  vm.runInNewContext(framingScript, { window });
  vm.runInNewContext(script, { document, window, Intl, Set, Object, JSON, URL, URLSearchParams, encodeURIComponent });
  const node = (selector) => document.querySelector(selector);
  function choose(name, value, checked = true) {
    const input = inputs.find((candidate) => candidate.name === name && candidate.value === value);
    assert.ok(input, `choice exists: ${name}/${value}`);
    input.checked = checked;
    input.listeners.change();
  }
  const click = (selector) => node(selector).listeners.click();
  const step = (number) => stepButtons[number - 1].listeners.click();
  return { node, choose, click, step, stepButtons, location, framing: window.RelaxstChairFraming };
}

function finishChoices(demo, next = '#next-step') {
  demo.choose('model', 'linea');
  demo.click(next);
  demo.choose('upholstery', 'stof');
  demo.choose('color', 'zand');
  demo.click(next);
  demo.choose('size', 'M');
  demo.click(next);
  demo.choose('mechanism', 'handmatig');
  demo.click(next);
}

test('Relaxst starts without implied choices or costs and adds only deliberate selections', () => {
  const demo = demoHarness();
  assert.equal(demo.node('#compact-price').textContent, '—');
  assert.equal(demo.node('#mobile-price').textContent, '—');
  assert.equal(demo.node('#stage-label').textContent, 'Voorbeeldmodel');
  assert.equal(demo.node('#material-chip').hidden, true);
  assert.equal(demo.node('#selection-tags').hidden, true);
  assert.doesNotMatch(demo.node('#step-content').innerHTML, / checked/);
  assert.equal(demo.node('#next-step').disabled, true);
  demo.click('#next-step');
  demo.click('#mobile-next');
  demo.step(5);
  assert.equal(demo.node('#current-step-number').textContent, 1);
  assert.equal(demo.node('#success-dialog').open, undefined);
  assert.equal(demo.stepButtons[4].disabled, true);

  demo.choose('model', 'comfora');
  assert.match(demo.node('#compact-price').textContent, /2\.295/);
  assert.equal(demo.node('#stage-label').textContent, 'Jouw stoel');
  assert.equal(demo.node('#selection-tags').innerHTML, '');
  assert.equal(demo.node('#material-chip').hidden, true);
  demo.click('#next-step');
  assert.doesNotMatch(demo.node('#step-content').innerHTML, / checked/);
  demo.choose('upholstery', 'microleder');
  assert.equal(demo.node('#material-label').textContent, 'Microleder');
  assert.equal(demo.node('#material-swatch').hidden, true);
  assert.match(demo.node('#compact-price').textContent, /2\.590/);
  assert.equal(demo.node('#next-step').disabled, true);
  demo.click('#next-step');
  assert.equal(demo.node('#current-step-number').textContent, 2);
  demo.choose('color', 'antraciet');
  assert.equal(demo.node('#material-label').textContent, 'Microleder · Antraciet');
  demo.click('#next-step');
  assert.equal(demo.node('#selection-tags').innerHTML, '');
  assert.doesNotMatch(demo.node('#step-content').innerHTML, / checked/);
  demo.choose('size', 'S');
  assert.equal(demo.node('#selection-tags').innerHTML, '<span>Maat S</span>');
  demo.click('#next-step');
  assert.doesNotMatch(demo.node('#step-content').innerHTML, / checked/);
  demo.choose('mechanism', '2motor');
  assert.match(demo.node('#compact-price').textContent, /2\.985/);
  assert.doesNotMatch(demo.node('#selection-tags').innerHTML, /Draadloze accu/);
  demo.choose('extra', 'accu');
  assert.match(demo.node('#compact-price').textContent, /3\.234/);
  assert.match(demo.node('#selection-tags').innerHTML, /Draadloze accu/);
  demo.choose('extra', 'accu', false);
  assert.match(demo.node('#compact-price').textContent, /2\.985/);
  assert.doesNotMatch(demo.node('#selection-tags').innerHTML, /Draadloze accu/);
});

test('Relaxst computes and exports exactly the explicitly chosen configuration', () => {
  const demo = demoHarness();
  demo.choose('model', 'zeus');
  demo.click('#next-step');
  demo.choose('upholstery', 'leer');
  demo.choose('color', 'olijf');
  demo.click('#next-step');
  demo.choose('size', 'L');
  demo.click('#next-step');
  demo.choose('mechanism', '5motor');
  for (const extra of ['accu', 'topswing', 'lendenpomp', 'verwarming']) demo.choose('extra', extra);
  assert.match(demo.node('#compact-price').textContent, /5\.752/);
  demo.choose('extra', 'accu', false);
  assert.match(demo.node('#compact-price').textContent, /5\.503/);
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
  assert.match(demo.node('#chair-image').src, /\/assets\/relaxst\/chairs\/linea-original\.jpg$/);
  assert.match(demo.node('#chair-image').alt, /Linea/);
  assert.match(demo.node('#compact-price').textContent, /2\.343/);
});

test('Relaxst ignores legacy defaults and sanitizes incomplete saved choices without skipping steps', () => {
  const legacy = demoHarness(JSON.stringify({ model: 'comfora', size: 'S', mechanism: '2motor', extras: ['accu'] }));
  assert.equal(legacy.node('#compact-price').textContent, '—');
  assert.equal(legacy.node('#selection-tags').innerHTML, '');
  const corrupt = demoHarness(JSON.stringify({ version: 2, step: 5, model: 'zeus', upholstery: '__proto__', color: 'invalid', size: 'L', extras: ['accu'] }));
  assert.match(corrupt.node('#compact-price').textContent, /3\.195/);
  assert.equal(corrupt.node('#current-step-number').textContent, 2);
  assert.equal(corrupt.node('#selection-tags').innerHTML, '');
  assert.equal(demoHarness('{').node('#compact-price').textContent, '—');
  const blocked = demoHarness(null, true);
  finishChoices(blocked);
  blocked.click('#next-step');
  assert.equal(blocked.node('#success-dialog').open, true);
});

test('Relaxst resumes partial choices and the current step without filling future choices', () => {
  const demo = demoHarness();
  demo.choose('model', 'comfora');
  demo.click('#next-step');
  demo.choose('color', 'antraciet');
  const saved = JSON.parse(demo.location.searchParams.get('config'));
  assert.equal(saved.version, 2);
  assert.equal(saved.step, 2);
  assert.equal(saved.size, undefined);
  assert.equal(saved.mechanism, undefined);
  assert.equal(saved.upholstery, undefined);
  assert.deepEqual(saved.extras, []);
  const restored = demoHarness(JSON.stringify(saved));
  assert.equal(restored.node('#current-step-number').textContent, 2);
  assert.equal(restored.node('#material-label').textContent, 'Antraciet');
  assert.equal(restored.node('#selection-tags').innerHTML, '');
  assert.match(restored.node('#compact-price').textContent, /2\.295/);
  assert.equal(restored.node('#next-step').disabled, true);
  restored.choose('upholstery', 'microleder');
  restored.click('#next-step');
  assert.equal(restored.node('#current-step-number').textContent, 3);
  assert.equal(restored.node('#next-step').disabled, true);
});

test('Relaxst mobile navigation preserves explicit choices and allows a result without optional extras', () => {
  const demo = demoHarness();
  assert.equal(demo.node('#mobile-previous').disabled, true);
  assert.equal(demo.node('#mobile-next').disabled, true);
  finishChoices(demo, '#mobile-next');
  demo.click('#mobile-previous');
  assert.equal(demo.node('#current-step-number').textContent, 4);
  assert.match(demo.node('#selection-tags').innerHTML, /Maat M/);
  assert.doesNotMatch(demo.node('#selection-tags').innerHTML, /Draadloze accu/);
  demo.click('#mobile-next');
  assert.match(demo.node('#mobile-next').innerHTML, /Bekijk resultaat/);
  demo.click('#mobile-next');
  assert.equal(demo.node('#success-dialog').open, true);
  assert.match(demo.node('#dialog-summary').innerHTML, /Geen extra functies/);
  assert.match(demo.node('#mobile-price').textContent, /2\.343/);
  const reloaded = demoHarness(demo.location.searchParams.get('config'));
  assert.equal(reloaded.node('#current-step-number').textContent, 5);
  assert.match(reloaded.node('#step-content').innerHTML, /Handmatig/);
});

test('Relaxst back navigation clears later choices, their price and URL on desktop and mobile', () => {
  for (const back of ['#previous-step', '#mobile-previous']) {
    const demo = demoHarness();
    demo.choose('model', 'zeus');
    demo.click('#next-step');
    demo.choose('upholstery', 'microleder');
    demo.choose('color', 'olijf');
    demo.click('#next-step');
    demo.choose('size', 'L');
    demo.click('#next-step');
    demo.choose('mechanism', '5motor');
    demo.choose('extra', 'verwarming');
    assert.match(demo.node('#compact-price').textContent, /4\.775/);
    demo.click(back);
    let saved = JSON.parse(demo.location.searchParams.get('config'));
    assert.equal(saved.step, 3);
    assert.equal(saved.size, 'L');
    assert.equal(saved.mechanism, undefined);
    assert.deepEqual(saved.extras, []);
    assert.match(demo.node('#compact-price').textContent, /3\.585/);
    demo.click(back);
    saved = JSON.parse(demo.location.searchParams.get('config'));
    assert.equal(saved.step, 2);
    assert.equal(saved.size, undefined);
    assert.equal(saved.upholstery, 'microleder');
    assert.equal(demo.node('#size-marker').hidden, true);
    assert.match(demo.node('#compact-price').textContent, /3\.490/);
    demo.click(back);
    saved = JSON.parse(demo.location.searchParams.get('config'));
    assert.deepEqual(saved, { version: 2, step: 1, model: 'zeus', extras: [] });
    assert.match(demo.node('#compact-price').textContent, /3\.195/);
    assert.equal(demo.node('#selection-tags').innerHTML, '');
    assert.equal(demo.node('#material-chip').hidden, true);
    assert.match(demo.node('#chair-image').src, /zeus-original\.jpg$/);
    const restored = demoHarness(demo.location.searchParams.get('config'));
    restored.click('#next-step');
    assert.equal(restored.node('#next-step').disabled, true);
    assert.doesNotMatch(restored.node('#step-content').innerHTML, / checked/);
  }
});

test('Relaxst clicking an earlier step or reopening an older URL removes stale future choices', () => {
  const complete = { version: 2, step: 5, model: 'zeus', upholstery: 'leer', color: 'cognac', size: 'L', mechanism: '5motor', extras: ['accu'] };
  const demo = demoHarness(JSON.stringify(complete));
  demo.step(1);
  assert.deepEqual(JSON.parse(demo.location.searchParams.get('config')), { version: 2, step: 1, model: 'zeus', extras: [] });
  demo.step(5);
  assert.equal(demo.node('#current-step-number').textContent, 2);
  assert.equal(demo.node('#next-step').disabled, true);
  const oldLink = demoHarness(JSON.stringify({ ...complete, step: 1 }));
  assert.equal(oldLink.node('#selection-tags').innerHTML, '');
  assert.equal(oldLink.node('#material-chip').hidden, true);
  assert.match(oldLink.node('#compact-price').textContent, /3\.195/);
});

test('Relaxst shows all 45 generated material/color variants and scales the selected size', () => {
  for (const model of ['comfora', 'linea', 'zeus']) {
    const demo = demoHarness();
    demo.choose('model', model);
    demo.click('#next-step');
    for (const [row, material] of ['stof', 'microleder', 'leer'].entries()) {
      demo.choose('upholstery', material);
      for (const [column, color] of ['zand', 'cognac', 'olijf', 'kiezel', 'antraciet'].entries()) {
        demo.choose('color', color);
        assert.equal(demo.node('#chair-image').src, `/assets/relaxst/chairs/${model}-variants-v1.webp`);
        const [left, top, width, height] = demo.framing[model].variants.frames[row * 5 + column].tile;
        assert.equal(demo.node('#chair-image').style.left, `${-left / width * 100}%`);
        assert.equal(demo.node('#chair-image').style.top, `${-top / height * 100}%`);
        assert.match(demo.node('#chair-image').alt, /digitale impressie/);
        assert.ok(fs.statSync(path.join(root, demo.node('#chair-image').src)).size > 0);
      }
    }
    demo.click('#next-step');
    for (const [size, cm] of [['S', 43], ['M', 46], ['L', 49]]) {
      demo.choose('size', size);
      assert.equal(demo.node('#chair-frame').style.transform, `scale(${cm / 49})`);
      assert.equal(demo.node('#size-marker').textContent, `Zithoogte ca. ${cm} cm`);
      assert.equal(demo.node('#size-marker').hidden, false);
      assert.ok(demo.node('#chair-image').alt.includes(`maat ${size}`));
    }
    demo.click('#next-step');
    const visual = () => JSON.stringify([demo.node('#chair-image').src, demo.node('#chair-image').style, demo.node('#chair-frame').style, demo.node('#chair-artwork').style]);
    const before = visual();
    for (const mechanism of ['handmatig', '2motor', '3motor', '5motor']) demo.choose('mechanism', mechanism);
    for (const extra of ['accu', 'topswing', 'lendenpomp', 'verwarming']) demo.choose('extra', extra);
    assert.equal(visual(), before, 'comfort choices do not change the chair image');
  }
});

test('Relaxst registration matches the actual source pixels and detects stale framing', async () => {
  const { measureChairFraming, serializeFraming } = require('../../scripts/measure-relaxst-chair-framing');
  assert.equal(serializeFraming(await measureChairFraming(root)), framingScript);
});

test('Relaxst fixes the top, floor and pedestal across every color/material and the original photo', () => {
  const percent = (value) => parseFloat(value) / 100;
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.000001, `${label}: ${actual} vs ${expected}`);
  assert.match(css, /\.chair-artwork\s*\{[^}]*overflow: hidden/);
  assert.match(css, /\.chair-frame\s*\{[^}]*transform-origin: 50% 96%/);
  for (const model of ['comfora', 'linea', 'zeus']) {
    const demo = demoHarness();
    demo.choose('model', model);
    const reference = demo.framing[model].original.frames[0];
    const footWidth = 0.88 * (reference.foot[2] - reference.foot[0]) / (reference.bounds[3] - reference.bounds[1]);
    const verify = (source, frame) => {
      const artwork = demo.node('#chair-artwork').style;
      const image = demo.node('#chair-image').style;
      const x = (pixel) => percent(artwork.left) + percent(artwork.width) * (percent(image.left) + pixel / source.width * percent(image.width));
      const y = (pixel) => percent(artwork.top) + percent(artwork.height) * (percent(image.top) + pixel / source.height * percent(image.height));
      near(y(frame.bounds[1]), 0.08, 'chair top');
      near(y(frame.bounds[3]), 0.96, 'floor');
      near((x(frame.foot[0]) + x(frame.foot[2])) / 2, 0.5, 'pedestal center');
      near(x(frame.foot[2]) - x(frame.foot[0]), footWidth, 'pedestal width');
      assert.ok(x(frame.bounds[0]) >= 0 && x(frame.bounds[2]) <= 1, 'entire chair stays inside frame');
      const [left, top, width, height] = frame.tile;
      near(x(left), percent(artwork.left), 'crop left');
      near(x(left + width), percent(artwork.left) + percent(artwork.width), 'crop right');
      near(y(top), percent(artwork.top), 'crop top');
      near(y(top + height), percent(artwork.top) + percent(artwork.height), 'crop bottom');
    };
    verify(demo.framing[model].original, reference);
    demo.click('#next-step');
    for (const [row, material] of ['stof', 'microleder', 'leer'].entries()) {
      demo.choose('upholstery', material);
      for (const [column, color] of ['zand', 'cognac', 'olijf', 'kiezel', 'antraciet'].entries()) {
        demo.choose('color', color);
        const source = demo.framing[model].variants;
        verify(source, source.frames[row * 5 + column]);
      }
    }
    demo.click('#previous-step');
    verify(demo.framing[model].original, reference);
  }
});

test('Relaxst reacts to either material or color first without selecting an unchosen option', () => {
  for (const first of [['upholstery', 'leer'], ['color', 'olijf']]) {
    const demo = demoHarness();
    demo.choose('model', 'linea');
    demo.click('#next-step');
    demo.choose(...first);
    assert.match(demo.node('#chair-image').src, /linea-variants-v1.webp/);
    assert.equal(demo.node('#next-step').disabled, true);
    const saved = JSON.parse(demo.location.searchParams.get('config'));
    assert.equal(saved[first[0] === 'color' ? 'upholstery' : 'color'], undefined);
    demo.node('#chair-image').listeners.error();
    assert.equal(demo.node('#chair-image').hidden, true);
    assert.equal(demo.node('#preview-feedback').hidden, false);
    demo.node('#chair-image').listeners.load();
    assert.equal(demo.node('#preview-feedback').hidden, true);
  }
});

test('Relaxst result stays open when clicking its own padding and closes on the backdrop', () => {
  const demo = demoHarness();
  finishChoices(demo);
  demo.click('#next-step');
  const dialog = demo.node('#success-dialog');
  dialog.listeners.click({ target: dialog, clientX: 20, clientY: 20 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 450, clientY: 20 });
  assert.equal(dialog.open, false);
});

test('Relaxst preview contains only its static assets and no server compute', () => {
  const os = require('node:os');
  const { buildRelaxstPreview } = require('../../scripts/build-relaxst-preview');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relaxst-output-'));
  const output = path.join(temp, 'output');
  try {
    const result = buildRelaxstPreview(root, output);
    assert.equal(result.files.length, 10);
    assert.deepEqual(fs.readdirSync(output).sort(), ['config.json', 'static']);
    const config = JSON.parse(fs.readFileSync(path.join(output, 'config.json'), 'utf8'));
    assert.equal(config.version, 3);
    assert.equal(config.routes[0].dest, '/index.html');
    assert.equal(config.functions, undefined);
    assert.equal(config.crons, undefined);
    assert.equal(config.images, undefined);
    assert.equal(fs.readFileSync(path.join(output, 'static/index.html'), 'utf8'), html);
    assert.equal(fs.readFileSync(path.join(output, 'static/assets/relaxst-configurator-demo.js'), 'utf8'), script);
    assert.equal(fs.readFileSync(path.join(output, 'static/assets/relaxst-configurator-demo.css'), 'utf8'), css);
    assert.equal(fs.readFileSync(path.join(output, 'static/assets/relaxst/chair-framing.js'), 'utf8'), framingScript);
    for (const file of result.files.filter((file) => file.includes('/chairs/'))) {
      assert.deepEqual(fs.readFileSync(path.join(output, 'static', file)), fs.readFileSync(path.join(root, file)));
    }
    assert.throws(() => buildRelaxstPreview(root, output), /Output bestaat al/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
