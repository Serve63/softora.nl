const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstantlyMailboxApi, retryDelayMs } = require('../../server/services/instantly-mailbox-api');
const { buildRecentSyncResult } = require('../../server/services/instantly-mailbox-sync-cadence');
const refresh = require('../../assets/premium-mailbox-refresh');
const { createInstantlyStateFixture } = require('../helpers/instantly-mailbox-state');

function harness({ values = {}, response = { ok: true }, data = {}, fetch, key = 'test' } = {}) {
  let time = Date.parse('2026-09-09T12:00:00Z');
  const calls = [], writes = [];
  const durable = createInstantlyStateFixture(values);
  const api = createInstantlyMailboxApi({
    config: { apiBaseUrl: 'https://api.example.test', apiKey: key },
    now: () => new Date(time), assertConfigured() {}, logger: { warn() {} },
    createError: (message, code, status, extra) => Object.assign(new Error(message), { code, status, ...extra }),
    getUiStateValues: (...args) => durable.store.getUiStateValues(...args),
    setUiStateValues: async (...args) => { writes.push(args[1]); return durable.store.setUiStateValues(...args); },
    fetchJsonWithTimeout: async (...args) => { calls.push(args); return fetch ? fetch(...args) : { response, data }; },
  });
  return { api, calls, writes, values, durable, advance: (ms) => { time += ms; } };
}

test('continuation and audit writes preserve permission and rate cooldowns through the real UI store', async () => {
  const h = harness({ response: { ok: false, status: 403 }, data: { message: 'Missing scope: leads:read' } });
  await assert.rejects(h.api.request('leads/one'), { providerStatus: 403 });
  await h.durable.store.setUiStateValues('instantly_mailbox_sync', { cursor_serve: 'page-serve', min_timestamp_serve: '2026-09-09' });
  h.api.noteAudit('serve|one'); await h.api.persistAudits();
  await h.durable.store.setUiStateValues('instantly_mailbox_sync', { cursor_martijn: 'page-martijn' });
  const next = harness({ values: h.values });
  await assert.rejects(next.api.request('leads/two'), { code: 'INSTANTLY_LEADS_READ_UNAVAILABLE' });
  assert.equal(next.calls.length, 0);
  assert.equal(h.values.cursor_serve, 'page-serve');
  assert.equal(h.values.cursor_martijn, 'page-martijn');
  assert.equal(next.api.canAudit('serve|one'), false);
});

test('unavailable durable policy refuses provider reads without blocking sends', async () => {
  const h = harness(); h.durable.setUnavailable(true);
  await assert.rejects(h.api.request('emails'), { code: 'INSTANTLY_READ_POLICY_UNAVAILABLE', externalEffect: false });
  assert.equal(h.calls.length, 0);
  await h.api.request('emails/reply', { method: 'POST', body: { test: true } });
  assert.equal(h.calls.length, 1);
});

test('429 Retry-After survives a new service instance and blocks both owners before another provider read', async () => {
  const first = harness({ response: { ok: false, status: 429, headers: { get: () => '120' } } });
  await assert.rejects(first.api.request('emails', { query: { eaccount: 'serve@example.test' } }), { retryAfterMs: 120_000, providerStatus: 429 });
  await assert.rejects(first.api.request('emails', { query: { eaccount: 'martijn@example.test' } }), { status: 429, externalEffect: false });
  assert.equal(first.calls.length, 1);
  await first.durable.store.setUiStateValues('instantly_mailbox_sync', { cursor_martijn: 'next-page' });
  first.api.noteAudit('serve|rate-limited-thread'); await first.api.persistAudits();
  const next = harness({ values: first.values });
  await assert.rejects(next.api.request('emails'), { status: 429 });
  assert.equal(next.calls.length, 0);
  next.advance(120_001);
  await next.api.request('emails');
  assert.equal(next.calls.length, 1);
});

test('missing leads scope is cached across threads and instances without asserting source evidence', async () => {
  const first = harness({ response: { ok: false, status: 403 }, data: { message: 'Missing required scopes: leads:read' } });
  await assert.rejects(first.api.request('leads/one'), { providerStatus: 403 });
  assert.equal(first.api.canReadLeads(), false);
  await assert.rejects(first.api.request('leads/two'), { code: 'INSTANTLY_LEADS_READ_UNAVAILABLE' });
  const next = harness({ values: first.values });
  await assert.rejects(next.api.request('leads/list', { method: 'POST', body: {} }), { code: 'INSTANTLY_LEADS_READ_UNAVAILABLE' });
  await next.api.request('emails');
  assert.equal(next.calls.length, 1);
  assert.equal(Object.keys(first.values).some((key) => /evidence/i.test(key)), false);
  const reconnected = harness({ values: first.values, key: 'new-connection' });
  await reconnected.api.request('leads/one');
  assert.equal(reconnected.calls.length, 1);
});

test('read budget reserves capacity for foreground reads and never dispatches over the bounded window', async () => {
  const h = harness();
  for (let i = 0; i < 13; i++) await h.api.request('emails');
  assert.equal(h.api.canStartAudit(), false);
  for (let i = 13; i < 18; i++) await h.api.request('emails');
  await assert.rejects(h.api.request('emails'), { code: 'INSTANTLY_READ_BUDGET_EXHAUSTED', externalEffect: false });
  assert.equal(h.calls.length, 18);
  h.advance(60_001);
  await h.api.request('emails');
  assert.equal(h.calls.length, 19);
});

test('audit backoff is durable and expires without pretending an unavailable source was verified', async () => {
  const h = harness();
  h.api.noteAudit('serve|thread1'); await h.api.persistAudits();
  const next = harness({ values: h.values }); await next.api.refreshPolicy();
  assert.equal(next.api.canAudit('serve|thread1'), false);
  assert.equal(next.api.canAudit('martijn|thread1'), true);
  assert.equal(next.api.canAudit('serve|thread1', 'new-reply'), true);
  next.advance(15 * 60_000 + 1);
  assert.equal(next.api.canAudit('serve|thread1'), true);
});

test('read backoff does not retry or alter provider mutation dispatch semantics', async () => {
  const h = harness({ response: { ok: false, status: 429 } });
  await assert.rejects(h.api.request('emails'), { status: 429 });
  await assert.rejects(h.api.request('emails/reply', { method: 'POST', body: { test: true } }), { providerStatus: 429, mailboxProviderResponseReceived: true });
  assert.equal(h.calls.length, 2);
  assert.equal(h.writes.length, 1);
});

test('recent durable failure takes precedence over an earlier successful sync', () => {
  const nowMs = Date.parse('2026-09-09T12:00:00Z');
  const args = { nowMs, state: { status: 'error', last_error: 'Timeout', updated_at: '2026-09-09T11:59:40Z', last_synced_at: '2026-09-09T11:59:00Z' }, minIntervalMs: 180_000 };
  assert.throws(() => buildRecentSyncResult(args), { code: 'INSTANTLY_SYNC_RECENT_FAILURE', retryAfterMs: 40_000 });
  assert.equal(retryDelayMs('Wed, 09 Sep 2026 12:02:00 GMT', nowMs), 120_000);
  assert.equal(retryDelayMs('nonsense', nowMs), 60_000);
});

test('browser honors provider cooldown without 500ms retries while healthy mailbox reads continue', async () => {
  let now = 1_000_000;
  const calls = [], waits = [];
  const controller = refresh.create({
    getFolder: () => 'outreach', getOwner: () => 'serve', now: () => now,
    document: { visibilityState: 'visible' }, window: {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    wait: async (delay) => waits.push(delay), loadMessages: async () => {},
    fetch: async (url) => { calls.push(url); return url.includes('instantly')
      ? { ok: false, status: 429, headers: { get: () => '120' }, json: async () => ({ ok: false }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  await controller.refresh({ manual: true });
  await controller.refresh({ manual: true });
  assert.equal(calls.filter((url) => url.includes('instantly')).length, 1);
  assert.equal(calls.filter((url) => !url.includes('instantly')).length, 2);
  assert.deepEqual(waits, []);
  now += 120_001;
  await controller.refresh({ manual: true });
  assert.equal(calls.filter((url) => url.includes('instantly')).length, 2);
  controller.destroy();
});
