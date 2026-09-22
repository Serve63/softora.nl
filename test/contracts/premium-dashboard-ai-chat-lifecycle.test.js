const test = require('node:test');
const assert = require('node:assert/strict');
const createChat = require('../../assets/premium-dashboard-ai-chat');

function target() {
  const listeners = new Map();
  return {
    listeners,
    dataset: {},
    appended: 0,
    classList: { toggle() {} },
    addEventListener(name, handler) {
      const handlers = listeners.get(name) || new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
      if (!listeners.get(name)?.size) listeners.delete(name);
    },
    emit(name) {
      for (const handler of listeners.get(name) || []) handler({ preventDefault() {}, key: 'Enter', shiftKey: false });
    },
    setAttribute() {},
    appendChild() { this.appended += 1; },
    focus() {},
  };
}

function setup(fetch = async () => ({ ok: true, json: async () => ({ ok: true, answer: 'Antwoord' }) })) {
  const elements = Object.fromEntries([
    'dashboardAiChatToggle', 'dashboardAiChatClose', 'dashboardAiChatPanel',
    'dashboardAiChatMessages', 'dashboardAiChatStatus', 'dashboardAiChatForm',
    'dashboardAiChatInput', 'dashboardAiChatSend',
  ].map((id) => [id, target()]));
  const doc = target();
  doc.createElement = () => target();
  const chatRoot = target();
  chatRoot.ownerDocument = doc;
  chatRoot.querySelector = (selector) => elements[selector.slice(1)] || null;
  doc.querySelector = (selector) => selector === '#dashboardAiChat' ? chatRoot : null;
  const timers = new Map();
  let timerId = 0;
  const root = {
    ...target(), document: doc, fetch,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { chat: createChat(root), root, doc, chatRoot, elements, timers };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

test('chatmount is idempotent and dispose removes every listener and pending focus', () => {
  const env = setup();
  const first = env.chat.mount();
  assert.equal(env.chat.mount(), first);
  assert.equal(env.root.listeners.get('softora-dashboard-ai-management-change').size, 1);
  env.elements.dashboardAiChatToggle.emit('click');
  assert.equal(env.timers.size, 1);
  env.chat.dispose();
  assert.equal(env.timers.size, 0);
  assert.equal(env.root.listeners.size, 0);
  assert.equal(env.doc.listeners.size, 0);
  assert.equal(Object.values(env.elements).reduce((sum, node) => sum + node.listeners.size, 0), 0);
  assert.equal(env.elements.dashboardAiChatToggle.dataset.softoraActionBound, undefined);
  env.chat.mount();
  assert.equal(env.root.listeners.get('softora-dashboard-ai-management-change').size, 1);
  assert.equal(env.elements.dashboardAiChatToggle.dataset.softoraActionBound, 'true');
  env.root.emit('pagehide');
  assert.equal(env.root.listeners.size, 0);
});

test('disposing an in-flight chat request aborts it and prevents a late answer from changing the old screen', async () => {
  let resolveResponse;
  let signal;
  let calls = 0;
  const env = setup(async (_url, options) => {
    calls += 1;
    signal = options.signal;
    return new Promise((resolve) => { resolveResponse = resolve; });
  });
  env.chat.mount();
  const input = env.elements.dashboardAiChatInput;
  const messages = env.elements.dashboardAiChatMessages;
  input.value = 'Mijn vraag';
  env.elements.dashboardAiChatForm.emit('submit');
  await flush();
  assert.equal(calls, 1);
  const renderedBeforeDispose = messages.appended;
  env.chat.dispose();
  assert.equal(signal.aborted, true);
  resolveResponse({ ok: true, json: async () => ({ ok: true, answer: 'Te laat' }) });
  await flush();
  assert.equal(messages.appended, renderedBeforeDispose);
  assert.equal(calls, 1);
  assert.equal(input.disabled, false);
});
