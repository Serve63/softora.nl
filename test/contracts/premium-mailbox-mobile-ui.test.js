const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

test('mailbox laadt de pagina-eigen mobiele laag als laatste en ondersteunt veilige schermranden', () => {
  const page = read('premium-mailbox.html');
  assert.match(page, /content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
  assert.ok(page.indexOf('premium-mailbox-mobile.css?v=20260822a') > page.indexOf('</style>'));
  const mailboxScriptIndex = page.indexOf('premium-mailbox.js?v=20260907a');
  assert.ok(mailboxScriptIndex >= 0);
  assert.ok(page.indexOf('premium-mailbox-mobile.js?v=20260907a') > mailboxScriptIndex);
  assert.match(page, /data-mailbox-mobile-action="toggle-navigation"/);
  assert.match(page, /class="mailbox-mobile-sidebar-backdrop"[\s\S]*data-mailbox-mobile-action="close-navigation"/);
});

test('mobiele mailbox is drawer plus list-first master-detail met toetsenbordvaste compose', () => {
  const css = read('assets/premium-mailbox-mobile.css');
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.dashboard-layout > \.sidebar\[data-static-sidebar="1"\][\s\S]*position: fixed !important/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.mail-page-shell\.is-mobile-detail-open \.mail-detail/);
  assert.match(css, /--mailbox-viewport-height, 100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.detail-mail-contact-card \{ padding: 0; \}/);
  assert.doesNotMatch(css, /\.detail-mail-contact-item \{[^}]*grid-template-columns|\.detail-mail-contact-item \{[^}]*gap:\s*8px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('mobiele controller bewaart uitsluitend visuele state en sluit detail toegankelijk af', () => {
  const script = read('assets/premium-mailbox-mobile.js');
  assert.match(script, /window\.SoftoraMailboxMobile = \{ isSinglePane, showList, showDetail, syncVisualViewport \}/);
  assert.match(script, /detail\.inert = !showingDetail/);
  assert.match(script, /compose\.setAttribute\('aria-hidden', String\(!open\)\)/);
  assert.match(script, /event\.key === 'Escape'[\s\S]*close-compose/);
  assert.match(script, /new MutationObserver\([\s\S]*ensureDetailToolbar/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(|\/api\//);
});

test('sluiten van compose herstelt focus in het volgende frame zonder de gewiste referentie te gebruiken', () => {
  const modulePath = require.resolve('../../assets/premium-mailbox-mobile.js');
  const globalKeys = ['document', 'window', 'MutationObserver', 'requestAnimationFrame'];
  const previousGlobals = new Map(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const outcome of ['connected', 'removed', 'reopened']) {
    const callbacks = [];
    const events = new Map();
    const observers = new Map();
    let focused = 0;
    const target = { isConnected: true, focus() { focused += 1; }, getAttribute: () => 'new-message' };
    function element() {
      const classes = new Set();
      return {
        classList: {
          contains: (name) => classes.has(name),
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        },
        setAttribute() {}, removeAttribute() {}, querySelector() { return null; },
      };
    }
    const compose = element();
    const detail = element();
    try {
      global.document = {
        querySelector: () => element(),
        getElementById: (id) => id === 'compose-overlay' ? compose : detail,
        body: element(), documentElement: { style: { setProperty() {} } },
        addEventListener: (name, callback) => events.set(name, callback),
      };
      global.window = {
        location: { search: '' }, innerHeight: 900, addEventListener() {},
        matchMedia: () => ({ matches: false, addEventListener() {} }),
      };
      global.MutationObserver = class {
        constructor(callback) { this.callback = callback; }
        observe(node) { observers.set(node, this.callback); }
      };
      global.requestAnimationFrame = (callback) => callbacks.push(callback);
      delete require.cache[modulePath];
      require('../../assets/premium-mailbox-mobile.js');
      events.get('click')({ target: { closest: (selector) => selector === '[data-mailbox-action]' ? target : null } });
      observers.get(compose)();
      assert.equal(callbacks.length, 1);
      assert.equal(focused, 0);
      if (outcome === 'removed') target.isConnected = false;
      if (outcome === 'reopened') compose.classList.add('open');
      assert.doesNotThrow(() => callbacks.splice(0).forEach((callback) => callback()));
      assert.equal(focused, outcome === 'connected' ? 1 : 0);
      compose.classList.remove('open');
      observers.get(compose)();
      assert.equal(callbacks.length, 0, 'focus mag maar eenmaal worden hersteld');
    } finally {
      delete require.cache[modulePath];
      previousGlobals.forEach((descriptor, key) => {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      });
    }
  }
});
