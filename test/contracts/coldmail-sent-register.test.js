const test = require('node:test');
const assert = require('node:assert/strict');
const { getColdmailStatsResponse } = require('../../server/services/coldmail-sent-register-response');
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
