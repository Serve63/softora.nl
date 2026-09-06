const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('htmlparser2');
const { createPublicContactService } = require('../../server/services/public-contact');
const { initWebsiteSalespage } = require('../../assets/website-salespage');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'website.html'), 'utf8');

function nodes(node, result = []) {
  if (node.attribs) result.push(node);
  for (const child of node.children || []) nodes(child, result);
  return result;
}

test('website sales page has real local assets, unique anchors and accessible contact alternatives', () => {
  const elements = nodes(parseDocument(html));
  const ids = elements.map((node) => node.attribs.id).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(elements.filter((node) => node.name === 'h1').length, 1);
  for (const node of elements) {
    const { href, src } = node.attribs;
    if (href?.startsWith('#')) assert.ok(ids.includes(href.slice(1)), href);
    for (const url of [href, src].filter((url) => url?.startsWith('/assets/'))) {
      assert.ok(fs.existsSync(path.join(root, url.split('?')[0])), url);
    }
    if (node.name === 'img') {
      assert.ok(Object.hasOwn(node.attribs, 'alt'));
      assert.ok(node.attribs.width && node.attribs.height);
    }
    if (node.name === 'script') assert.ok(src, 'Page logic belongs in an external script');
    if (node.attribs.target === '_blank') assert.match(node.attribs.rel, /noopener/);
  }
  assert.match(html, /href="tel:\+31643262792"/);
  assert.match(html, /href="mailto:info@softora.nl"/);
  assert.match(html, /https:\/\/wa\.me\/31643262792/);
  assert.match(html, /<noscript>/);
  assert.match(html, /data-intake-success hidden/);
  assert.match(html, /data-intake-status role="status" aria-live="polite"/);
});

function setup({ fetchImpl, valid = true, fields = {} } = {}) {
  const values = { name: 'Website Test', email: 'website-test@example.invalid', website: 'www.example.invalid', message: 'Een duidelijke website voor onze diensten.', company_website: '', ...fields };
  const handlers = {};
  const button = { innerHTML: 'Bespreek mijn website', disabled: false, setAttribute() {}, removeAttribute() {} };
  const status = { textContent: '', isError: false, classList: { toggle(_name, value) { status.isError = value; } } };
  const success = { hidden: true, focused: false, focus() { this.focused = true; } };
  const form = {
    hidden: false,
    reportValidity: () => valid,
    elements: { namedItem: (name) => ({ value: values[name] }) },
    querySelector: (selector) => selector === '[data-intake-submit]' ? button : status,
    addEventListener: (event, handler) => { handlers[event] = handler; },
    reset: () => { Object.keys(values).forEach((key) => { values[key] = ''; }); },
  };
  const calls = [];
  let timeoutCallback;
  let cleared = false;
  initWebsiteSalespage({
    document: {
      getElementById: (id) => id === 'website-intake' ? form : null,
      querySelector: (selector) => selector === '[data-intake-success]' ? success : null,
    },
    setTimeout(callback, ms) { assert.equal(ms, 15000); timeoutCallback = callback; return 1; },
    clearTimeout() { cleared = true; },
    AbortController,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, json: async () => ({ ok: true }) };
    },
  });
  return { form, button, status, success, calls, values, submit: () => handlers.submit({ preventDefault() {} }), timeout: () => timeoutCallback(), cleared: () => cleared };
}

test('successful intake preserves website context, uses the established contract, and confirms only after acceptance', async () => {
  let accept;
  const fixture = setup({ fetchImpl: () => new Promise((resolve) => { accept = resolve; }) });
  const pending = fixture.submit();
  assert.equal(fixture.success.hidden, true);
  assert.equal(fixture.button.disabled, true);
  await fixture.submit();
  assert.equal(fixture.calls.length, 1, 'A double submit must not send two requests');
  const request = fixture.calls[0];
  assert.equal(request.url, '/api/public-contact');
  assert.equal(request.method, 'POST');
  const payload = JSON.parse(request.body);
  const service = createPublicContactService();
  assert.doesNotThrow(() => service.validateContactPayload(payload));
  assert.equal(payload.page, '/website');
  assert.match(payload.message, /Huidige website: www\.example\.invalid/);
  assert.match(payload.message, /Een duidelijke website/);
  accept({ ok: true, json: async () => ({ ok: true }) });
  await pending;
  assert.equal(fixture.form.hidden, true);
  assert.equal(fixture.success.hidden, false);
  assert.equal(fixture.success.focused, true);
  assert.equal(fixture.values.email, '');
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.cleared(), true);
});

for (const [label, fetchImpl] of [
  ['HTTP failure', async () => ({ ok: false, json: async () => ({ ok: false }) })],
  ['application refusal', async () => ({ ok: true, json: async () => ({ ok: false }) })],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new Error('invalid'); } })],
  ['network failure', async () => { throw new Error('offline'); }],
]) {
  test(`intake ${label} preserves entered data and offers recovery without a false success`, async () => {
    const fixture = setup({ fetchImpl });
    await fixture.submit();
    assert.equal(fixture.form.hidden, false);
    assert.equal(fixture.success.hidden, true);
    assert.equal(fixture.values.email, 'website-test@example.invalid');
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.status.isError, true);
    assert.match(fixture.status.textContent, /info@softora\.nl/);
    assert.equal(fixture.cleared(), true);
  });
}

test('a slow intake is aborted, retains the enquiry and avoids claiming it was never received', async () => {
  const fixture = setup({ fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
  }) });
  const pending = fixture.submit();
  fixture.timeout();
  await pending;
  assert.equal(fixture.success.hidden, true);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.calls[0].signal.aborted, true);
  assert.match(fixture.status.textContent, /ontvangst nog niet bevestigen/);
  assert.equal(fixture.values.name, 'Website Test');
});

test('invalid fields, whitespace-only enquiries and honeypots cannot dispatch requests', async () => {
  for (const options of [{ valid: false }, { fields: { name: ' ' } }, { fields: { message: '   ' } }, { fields: { company_website: 'bot' } }]) {
    const fixture = setup(options);
    await fixture.submit();
    assert.equal(fixture.calls.length, 0);
  }
});
