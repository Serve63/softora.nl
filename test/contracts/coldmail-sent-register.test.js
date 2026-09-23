const test = require('node:test');
const assert = require('node:assert/strict');
const { getColdmailStatsResponse } = require('../../server/services/coldmail-sent-register-response');
const { createColdmailProviderSentStats } = require('../../server/services/coldmail-provider-sent-stats');
require('../../assets/premium-database-sent-register');
const view = globalThis.SoftoraDatabaseSentRegister;
const recipients = [
  { key: 'email:old@example.com', email: 'old@example.com', company: 'Historisch', senderEmail: 'sender@example.com', sentAt: '2026-09-01' },
  { key: 'email:current@example.com', email: 'current@example.com', company: 'Huidig', senderEmail: 'sender@example.com', sentAt: '2026-09-10' },
];
test('sent KPI and rows replace a stale count atomically, leaving the ordinary stats contract unchanged', async () => {
  const old = { ok: true, stats: { systemTotalSent: 99, hardBounces: 4 } };
  const service = { getColdmailLiveStats: async () => old, getColdmailSentRegister: async () => ({ available: true, recipients, todayRecipientCounts: { 'email:current@example.com': 1 } }) };
  assert.equal(await getColdmailStatsResponse(service), old);
  const response = await getColdmailStatsResponse(service, true);
  assert.equal(response.stats.systemTotalSent, response.stats.sentRegister.recipients.length);
  assert.equal(response.stats.systemSentToday, 1);
  assert.equal(response.stats.hardBounces, 4);
  assert.equal(old.stats.systemTotalSent, 99);
  view.accept(response.stats.sentRegister);
  const customers = [{ id: 'live', email: 'current@example.com', stad: 'Voorbeeldstraat 1', lastColdmailProvider: 'instantly' }, { email: 'transfer@example.com', lastColdmailProvider: 'instantly' }];
  assert.deepEqual(view.rows(customers, '').map(row => row.email), ['current@example.com', 'old@example.com']);
  assert.equal(view.rows(customers, 'historisch').length, 1);
  assert.equal(view.rows(customers, 'voorbeeldstraat')[0].email, 'current@example.com');
  assert.equal(customers[0].lastColdmailProvider, 'instantly');
});
test('unavailable and malformed registers cannot masquerade as an empty sent list', async () => {
  await assert.rejects(getColdmailStatsResponse({ getColdmailLiveStats: async () => ({ ok: true }), getColdmailSentRegister: async () => ({ available: false }) }, true));
  assert.throws(() => view.accept({ source: 'central-outbound-recipient-guard', total: 3, recipients }));
  assert.throws(() => view.accept({ source: 'central-outbound-recipient-guard', total: 2, recipients: [recipients[0], recipients[0]] }));
});
test('complete register requests fail closed when no database client exists', async () => {
  const { createOutboundRecipientGuardStore } = require('../../server/services/outbound-recipient-guard-store');
  const store = createOutboundRecipientGuardStore({ getSupabaseClient: () => null });
  await assert.rejects(store.listSentRecipientGroups({ requireComplete: true }));
});
test('complete reads reject truncated or duplicated pages instead of lowering the sent total', async () => {
  const { createOutboundRecipientGuardStore } = require('../../server/services/outbound-recipient-guard-store');
  let data = [{ guard_key: 'email:a@example.com', recipient_email: 'a@example.com', reservation_id: 'a' }], count = 1;
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, async range() { return { data, count, error: null }; } };
  const store = createOutboundRecipientGuardStore({ isSupabaseConfigured: () => true, getSupabaseClient: () => ({ from: () => query }) });
  assert.equal((await store.listSentRecipientGroups({ requireComplete: true })).length, 1);
  count = 2;
  await assert.rejects(store.listSentRecipientGroups({ requireComplete: true }));
  data = [data[0], data[0]];
  await assert.rejects(store.listSentRecipientGroups({ requireComplete: true }));
});

test('concurrent full register reads share one in-flight query and retry after it settles', async () => {
  let calls = 0;
  let finishRead;
  const store = { listSentRecipientGroups: () => {
    calls += 1;
    return new Promise((resolve) => { finishRead = resolve; });
  } };
  const stats = createColdmailProviderSentStats({
    store, now: () => new Date('2026-09-23T08:00:00Z'), logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    normalizeEmailAddress: (value) => String(value || '').trim().toLowerCase(),
    buildRecipientKey: ({ recipientEmail }) => `email:${recipientEmail}`,
    setRecipientCount: (counts, key, count) => { counts[key] = count; },
    getDateKey: () => '2026-09-23', parseTimestampMs: (value) => Date.parse(value) || 0,
    resolveSentAt: (group) => group.sent_at, timezone: 'Europe/Amsterdam', sentTimestampModel: 'test',
  });
  const first = stats.load({ provider: 'softora', channel: 'coldmail' });
  const second = stats.load({ provider: 'softora', channel: 'coldmail' });
  await Promise.resolve();
  assert.equal(calls, 1);
  finishRead([{ provider: 'softora', channel: 'coldmail', sender_email: 'sender@example.com',
    recipient_email: 'recipient@example.com', sent_at: '2026-09-23T07:30:00Z' }]);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.available, true);
  assert.deepEqual(firstResult.recipients, secondResult.recipients);
  assert.equal(firstResult.recipients.length, 1);
  const third = stats.load({ provider: 'softora', channel: 'coldmail' });
  await Promise.resolve();
  assert.equal(calls, 2);
  finishRead([]);
  assert.equal((await third).available, true);
});
