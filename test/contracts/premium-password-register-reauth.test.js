const test = require('node:test');
const assert = require('node:assert/strict');
const initializePasswordRegisterReauth = require('../../assets/premium-password-register-reauth.js');

function createHarness(responses, options = {}) {
  const timers = [];
  const requests = [];
  const navigation = [];
  const listeners = {};
  const buttonListeners = {};
  const status = { textContent: '' };
  const button = {
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { buttonListeners[name] = handler; },
  };
  const root = {
    getAttribute(name) {
      if (name === 'data-password-register-auth-recovery') return '1';
      if (name === 'data-password-register-auth-retryable') return options.retryable === false ? '0' : '1';
      return '';
    },
  };
  class AbortControllerFixture {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  }
  const window = {
    document: {
      documentElement: root,
      getElementById(id) {
        if (id === 'password-register-auth-retry') return button;
        if (id === 'password-register-auth-recovery-status') return status;
        return null;
      },
    },
    AbortController: AbortControllerFixture,
    fetch: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions });
      const response = responses.shift() || { status: 503, ok: false, body: { ok: false } };
      return {
        status: response.status,
        ok: response.ok,
        json: async () => response.body || {},
      };
    },
    location: {
      replace(url) { navigation.push({ type: 'replace', url }); },
      assign(url) { navigation.push({ type: 'assign', url }); },
    },
    setTimeout(handler, delay) {
      timers.push({ handler, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    addEventListener(name, handler) { listeners[name] = handler; },
  };
  initializePasswordRegisterReauth(window);
  return { button, buttonListeners, listeners, navigation, requests, status, timers };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('bounded automatic reauth retries use the JSON preflight and open only after confirmed freshness', async () => {
  const harness = createHarness([
    { status: 503, ok: false, body: { ok: false, retryable: true } },
    { status: 200, ok: true, body: { ok: true } },
  ]);

  assert.equal(harness.timers[0].delay, 900);
  harness.timers[0].handler();
  await flushPromises();
  const secondRetry = harness.timers.find((timer) => timer.delay === 2400 && !timer.cleared);
  assert.ok(secondRetry);
  secondRetry.handler();
  await flushPromises();

  assert.equal(harness.requests.length, 2);
  harness.requests.forEach((request) => {
    assert.equal(request.url, '/premium-wachtwoordenregister');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.headers.Accept, 'application/json');
    assert.equal(request.options.body, undefined);
  });
  assert.deepEqual(harness.navigation, [{ type: 'replace', url: '/premium-wachtwoordenregister' }]);
});

test('manual reauth never sends PIN or vault data and expired sessions use the fixed same-origin login return path', async () => {
  const harness = createHarness([
    { status: 401, ok: false, body: { ok: false, code: 'PREMIUM_SESSION_EXPIRED' } },
  ], { retryable: false });

  assert.equal(harness.timers.length, 0);
  harness.buttonListeners.click();
  await flushPromises();

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].options.method, 'GET');
  assert.equal(harness.requests[0].options.body, undefined);
  assert.deepEqual(harness.navigation, [{
    type: 'assign',
    url: '/premium-personeel-login?next=%2Fpremium-wachtwoordenregister&expired=1',
  }]);
});

test('leaving the recovery page aborts in-flight work and clears visible busy state', async () => {
  const harness = createHarness([], { retryable: false });
  harness.buttonListeners.click();
  assert.equal(harness.button.disabled, true);

  harness.listeners.pagehide();

  assert.equal(harness.button.disabled, false);
  assert.equal(harness.requests[0].options.signal.aborted, true);
});
