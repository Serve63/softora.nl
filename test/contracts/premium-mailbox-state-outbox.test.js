const test = require('node:test');
const assert = require('node:assert/strict');
const outboxModule = require('../../assets/premium-mailbox-state-outbox.js');

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

let harnessId = 0;
function createHarness(fetchImpl, options = {}) {
  let nowMs = options.nowMs || Date.parse('2026-08-14T15:00:00.000Z');
  const events = [];
  const store = options.store || outboxModule.createMemoryStore();
  const target = {
    addEventListener() {},
    document: { addEventListener() {}, visibilityState: 'visible' },
  };
  const outbox = outboxModule.create({
    global: target,
    store,
    fetch: fetchImpl,
    now: () => nowMs,
    random: () => 0,
    crypto: { randomUUID: (() => { let id = ++harnessId * 1000; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`; })() },
    setTimeout: () => 1,
    clearTimeout() {},
  });
  outbox.subscribe((event) => events.push(event));
  return { outbox, store, events, advance(ms) { nowMs += ms; } };
}

function mutationPayload(overrides = {}) {
  return {
    account: 'serve290@gmail.com', owner: 'serve', folder: 'coldmail',
    id: 'coldmail:259', uid: 259, unread: false, dismissReply: true,
    ...overrides,
  };
}

test('mailbox state outbox blijft pending bij een trage write en bevestigt zonder UI rollback', async () => {
  let resolveFetch;
  const harness = createHarness(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const enqueued = await harness.outbox.enqueue(mutationPayload(), { resourceKey: 'serve|coldmail|259' });
  const flush = harness.outbox.flush({ force: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal((await harness.store.get('serve|coldmail|259')).status, 'pending');
  assert.equal(harness.events.some((event) => event.type === 'failed'), false);
  resolveFetch(response(200, { ok: true, result: { replyDismissedAt: '2026-08-14T15:00:10.000Z' } }));
  await flush;

  assert.equal(await harness.store.get('serve|coldmail|259'), null);
  assert.equal(harness.events.some((event) => event.type === 'confirmed' && event.record.mutationId === enqueued.record.mutationId), true);
});

test('mailbox state outbox reconcilieert een ambigue 504 vóór een idempotente retry', async () => {
  const calls = [];
  const harness = createHarness(async (url) => {
    calls.push(url);
    if (url.endsWith('/status')) return response(200, { ok: true, result: { confirmed: true } });
    return response(504, { ok: false, retryable: true, error: 'raw REST 504 cooldown' });
  });
  await harness.outbox.enqueue(mutationPayload(), { resourceKey: 'serve|coldmail|259' });
  await harness.outbox.flush({ force: true });
  assert.equal((await harness.store.get('serve|coldmail|259')).ambiguous, true);

  await harness.outbox.flush({ force: true });
  assert.deepEqual(calls, ['/api/mailbox/messages/read', '/api/mailbox/messages/read/status']);
  assert.equal(await harness.store.get('serve|coldmail|259'), null);
});

test('mailbox state outbox bewaart pending state over een reload en herstelt online', async () => {
  const sharedStore = outboxModule.createMemoryStore();
  const offline = createHarness(async () => { throw new Error('offline'); }, { store: sharedStore });
  await offline.outbox.enqueue(mutationPayload(), { resourceKey: 'serve|coldmail|259' });
  await offline.outbox.flush({ force: true });
  assert.equal((await sharedStore.get('serve|coldmail|259')).status, 'pending');
  offline.outbox.destroy();

  const online = createHarness(async (url) => url.endsWith('/status')
    ? response(200, { ok: true, result: { confirmed: false } })
    : response(200, { ok: true, result: { replyDismissedAt: '2026-08-14T15:01:00.000Z' } }), { store: sharedStore });
  await online.outbox.hydrate();
  await online.outbox.flush({ force: true });
  assert.equal(await sharedStore.get('serve|coldmail|259'), null);
});

test('nieuwere mailboxmutatie wint wanneer een oude response later arriveert', async () => {
  const deferred = [];
  const sent = [];
  const harness = createHarness((_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Promise((resolve) => deferred.push(resolve));
  });
  const first = await harness.outbox.enqueue(mutationPayload({ unread: true, dismissReply: false }), { resourceKey: 'serve|coldmail|259' });
  const firstFlush = harness.outbox.flush({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await harness.outbox.enqueue(mutationPayload({ unread: false, dismissReply: true }), { resourceKey: 'serve|coldmail|259' });
  assert.ok(second.record.revision > first.record.revision);
  deferred[0](response(200, { ok: true, result: { unread: true } }));
  await firstFlush;
  assert.equal((await harness.store.get('serve|coldmail|259')).mutationId, second.record.mutationId);

  const secondFlush = harness.outbox.flush({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  deferred[1](response(200, { ok: true, result: { unread: false, replyDismissedAt: 'now' } }));
  await secondFlush;
  assert.equal(await harness.store.get('serve|coldmail|259'), null);
  assert.deepEqual(sent.map((entry) => entry.unread), [true, false]);
});

test('twee tabs claimen dezelfde pending mutatie slechts eenmaal', async () => {
  const sharedStore = outboxModule.createMemoryStore();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(200, { ok: true, result: {} }); };
  const first = createHarness(fetchImpl, { store: sharedStore });
  const second = createHarness(fetchImpl, { store: sharedStore });
  await first.outbox.enqueue(mutationPayload(), { resourceKey: 'serve|coldmail|259' });
  await Promise.all([first.outbox.flush({ force: true }), second.outbox.flush({ force: true })]);
  assert.equal(calls, 1);
});

test('niet-retrybare serverfout lekt geen raw Supabase- of cooldowntekst', async () => {
  const harness = createHarness(async () => response(400, {
    ok: false,
    code: 'MAILBOX_STATE_VALIDATION',
    error: 'Supabase REST timeout 504 (59s cooldown, Error: stack)',
  }));
  await harness.outbox.enqueue(mutationPayload(), { resourceKey: 'serve|coldmail|259' });
  await harness.outbox.flush({ force: true });
  const failed = await harness.store.get('serve|coldmail|259');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorMessage, 'Deze mailboxstatus kan niet worden opgeslagen.');
  assert.doesNotMatch(JSON.stringify(harness.events), /Supabase|REST|504|cooldown|stack/i);
});
