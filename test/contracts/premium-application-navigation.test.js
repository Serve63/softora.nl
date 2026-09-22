const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumApplicationNavigation } = require('../../assets/premium-application-navigation');

function createTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      const current = listeners.get(name) || new Set();
      current.add(listener);
      listeners.set(name, current);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name, event) { for (const listener of listeners.get(name) || []) listener(event); },
  };
}

class FakeClassList extends Set {
  toggle(name, force) {
    if (force === undefined) force = !this.has(name);
    if (force) this.add(name);
    else this.delete(name);
    return force;
  }
}

function createAnchor(href, options = {}) {
  return {
    href: new URL(href, 'https://softora.test/premium-personeel-dashboard').href,
    attributes: {
      href,
      target: options.target || null,
      rel: options.rel || null,
      'data-sidebar-key': options.sidebarKey || null,
    },
    download: Boolean(options.download),
    inSidebar: options.inSidebar !== false,
    appLink: Boolean(options.appLink),
    classList: new FakeClassList(),
    current: '',
    hasAttribute(name) { return name === 'download' ? this.download : Object.hasOwn(this.attributes, name); },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'aria-current') this.current = String(value); },
    removeAttribute(name) { delete this.attributes[name]; if (name === 'aria-current') this.current = ''; },
    closest(selector) {
      if (selector === 'a[href]') return this;
      if (selector === '.sidebar' && this.inSidebar) return {};
      return null;
    },
  };
}

function createHarness({ initialUrl = '/premium-personeel-dashboard', navigate } = {}) {
  const address = { href: new URL(initialUrl, 'https://softora.test').href };
  const windowTarget = createTarget();
  const documentTarget = createTarget();
  const links = [
    createAnchor('/premium-personeel-dashboard', { sidebarKey: 'dashboard' }),
    createAnchor('/premium-actieve-opdrachten', { sidebarKey: 'active_orders' }),
  ];
  let historyEntries = [{ url: address.href, state: null }];
  let historyIndex = 0;
  const history = {
    get state() { return historyEntries[historyIndex]?.state || null; },
    pushState(state, _title, href) {
      historyEntries = historyEntries.slice(0, historyIndex + 1);
      historyEntries.push({ state, url: new URL(href, address.href).href });
      historyIndex += 1;
      address.href = historyEntries[historyIndex].url;
    },
    replaceState(state, _title, href) {
      historyEntries[historyIndex] = { state, url: new URL(href, address.href).href };
      address.href = historyEntries[historyIndex].url;
    },
    back() {
      if (!historyIndex) return;
      historyIndex -= 1;
      address.href = historyEntries[historyIndex].url;
      windowTarget.dispatch('popstate', { state: history.state });
    },
  };
  const window = {
    ...windowTarget,
    history,
    document: null,
    get location() { return { href: address.href, origin: new URL(address.href).origin }; },
  };
  const document = {
    ...documentTarget,
    title: 'Softora',
    querySelectorAll(selector) { return selector === '.sidebar-link[data-sidebar-key]' ? links : []; },
  };
  window.document = document;
  const calls = [];
  const runtime = {
    async navigate(moduleId, route) {
      calls.push({ moduleId, route });
      return navigate ? navigate(moduleId, route) : { status: 'mounted' };
    },
  };
  const navigation = createPremiumApplicationNavigation({
    runtime,
    window,
    document,
    routes: {
      '/premium-personeel-dashboard': { moduleId: 'dashboard', sidebarKey: 'dashboard', title: 'Dashboard' },
      '/premium-actieve-opdrachten': { moduleId: 'orders', sidebarKey: 'active_orders', title: 'Opdrachten' },
    },
  });
  return { navigation, window, document, links, calls, history, address };
}

function click(document, anchor, overrides = {}) {
  const event = {
    target: anchor,
    button: 0,
    defaultPrevented: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
  document.dispatch('click', event);
  return event;
}

test('registered sidebar navigation uses one document and updates browser history and active state', async () => {
  const harness = createHarness();
  assert.equal(harness.navigation.start(), true);
  const event = click(harness.document, harness.links[1]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(event.prevented, true);
  assert.equal(harness.address.href, 'https://softora.test/premium-actieve-opdrachten');
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].moduleId, 'orders');
  assert.equal(harness.document.title, 'Opdrachten');
  assert.equal(harness.links[1].current, 'page');
  assert.equal(harness.links[1].classList.has('active'), true);
  assert.equal(harness.links[0].classList.has('active'), false);
});

test('modified, external, download, new-tab, hash-only, and unregistered links keep native browser behavior', () => {
  const harness = createHarness();
  harness.navigation.start();
  const candidates = [
    [harness.links[1], { ctrlKey: true }],
    [createAnchor('/premium-actieve-opdrachten', { target: '_blank' }), {}],
    [createAnchor('/premium-actieve-opdrachten', { download: true }), {}],
    [createAnchor('https://other.test/premium-actieve-opdrachten'), {}],
    [createAnchor('/premium-onbekend'), {}],
    [createAnchor('/premium-actieve-opdrachten', { inSidebar: false }), {}],
    [createAnchor('/premium-personeel-dashboard#agenda'), {}],
  ];
  for (const [anchor, eventOptions] of candidates) assert.equal(click(harness.document, anchor, eventOptions).prevented, false);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.address.href, 'https://softora.test/premium-personeel-dashboard');
});

test('blocked dirty-form navigation keeps the old URL and screen active', async () => {
  const harness = createHarness({ navigate: async () => ({ status: 'blocked' }) });
  harness.navigation.start();
  const event = click(harness.document, harness.links[1]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(event.prevented, true);
  assert.equal(harness.address.href, 'https://softora.test/premium-personeel-dashboard');
  assert.equal(harness.document.title, 'Dashboard');
  assert.equal(harness.links[0].current, 'page');
  assert.equal(harness.links[1].current, '');
});

test('browser back and forward remount the registered module and restore route state', async () => {
  const harness = createHarness();
  harness.navigation.start();
  click(harness.document, harness.links[1]);
  await new Promise((resolve) => setImmediate(resolve));
  harness.history.back();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.address.href, 'https://softora.test/premium-personeel-dashboard');
  assert.equal(harness.navigation.getState().moduleId, 'dashboard');
  assert.deepEqual(harness.calls.map((call) => call.moduleId), ['orders', 'dashboard']);
  assert.equal(harness.document.title, 'Dashboard');
});

test('a rejected browser back restores the current route and failed navigation leaves its URL unchanged', async () => {
  const harness = createHarness({ navigate: async (_moduleId, route) => route.pathname.endsWith('actieve-opdrachten') ? { status: 'mounted' } : { status: 'blocked' } });
  harness.navigation.start();
  click(harness.document, harness.links[1]);
  await new Promise((resolve) => setImmediate(resolve));
  harness.history.back();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.address.href, 'https://softora.test/premium-actieve-opdrachten');
  assert.equal(harness.navigation.getState().moduleId, 'orders');
});

test('stop removes click and history listeners', () => {
  const harness = createHarness();
  harness.navigation.start();
  harness.navigation.stop();
  assert.equal(harness.document.listeners.get('click').size, 0);
  assert.equal(harness.window.listeners.get('popstate').size, 0);
  assert.equal(harness.navigation.getState().disposed, true);
});
