const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../../assets/ai-management-mode.js');

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadAiManagementModeSandbox({ initialMode = 'personnel', fetchImpl } = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const attributes = new Map([['data-ai-management-mode', initialMode]]);
  const dispatchedEvents = [];
  const listeners = [];
  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const windowRef = {
    location: { pathname: '/premium-bevestigingsmails' },
    fetch: fetchImpl,
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event);
      return true;
    },
  };
  const sandbox = {
    CustomEvent: TestCustomEvent,
    document: {
      documentElement: {
        getAttribute(name) {
          return attributes.get(name) || '';
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
      },
    },
    window: windowRef,
  };

  vm.runInNewContext(source, sandbox);

  return { attributes, dispatchedEvents, listeners, windowRef };
}

test('ai management mode hydrateert autopilot vanuit Supabase ui-state', async () => {
  const requests = [];
  const { attributes, dispatchedEvents, windowRef } = loadAiManagementModeSandbox({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          values: {
            softora_dashboard_ai_management_mode_v1: 'software',
          },
        }),
      };
    },
  });

  await waitForMicrotasks();

  assert.equal(attributes.get('data-ai-management-mode'), 'software');
  assert.equal(windowRef.SoftoraAiManagement.getMode(), 'software');
  assert.equal(requests[0].url, '/api/ui-state-get?scope=premium_dashboard_ai_management');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(dispatchedEvents.at(-1).type, 'softora-ai-management-change');
  assert.equal(dispatchedEvents.at(-1).detail.mode, 'software');
  assert.equal(dispatchedEvents.at(-1).detail.label, 'AI BEHEER');
});

test('ai management mode slaat autopilot-wijzigingen centraal op', async () => {
  const requests = [];
  const { attributes, windowRef } = loadAiManagementModeSandbox({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ values: {} }),
      };
    },
  });

  await waitForMicrotasks();
  windowRef.SoftoraAiManagement.setMode('software');
  await waitForMicrotasks();

  const writeRequest = requests.find((request) => request.options && request.options.method === 'POST');
  assert.equal(attributes.get('data-ai-management-mode'), 'software');
  assert.equal(writeRequest.url, '/api/ui-state-set?scope=premium_dashboard_ai_management');
  assert.deepEqual(JSON.parse(writeRequest.options.body), {
    values: {
      softora_dashboard_ai_management_mode_v1: 'software',
    },
  });
  assert.equal(sourceIncludesBrowserStorage(), false);
});

test('ai management mode overschrijft een geldige boot-stand niet met lege remote state', async () => {
  const { attributes, windowRef } = loadAiManagementModeSandbox({
    initialMode: 'software',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ values: {} }),
    }),
  });

  await waitForMicrotasks();

  assert.equal(attributes.get('data-ai-management-mode'), 'software');
  assert.equal(windowRef.SoftoraAiManagement.getMode(), 'software');
});

function sourceIncludesBrowserStorage() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  return /localStorage|sessionStorage|indexedDB/.test(source);
}
