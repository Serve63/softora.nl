const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxReadLimiter } = require('../../server/repositories/mailbox-read-evidence');
const { createMailboxMessageReferenceLookup } = require('../../server/repositories/mailbox-message-reference-lookup');
const { loadMailboxCampaignContactHistory } = require('../../server/services/mailbox-campaign-contact-history');
const session = require('../../assets/premium-mailbox-owner-session');

test('full fresh server body replaces an older loaded body without losing independent attachment evidence', () => {
  const old = { id: 'one', body: 'Oud', bodyLoaded: true, bodyTruncated: false, attachments: [{ filename: 'doc.pdf' }], attachmentEvidenceKnown: true };
  const [updated] = session.reconcileMessages([old], [{ id: 'one', body: 'Nieuw', bodyTruncated: false }]);
  assert.equal(updated.body, 'Nieuw');
  assert.deepEqual(updated.attachments, [{ filename: 'doc.pdf' }]);
  assert.equal(updated.bodyLoaded, true);
  const [retained] = session.reconcileMessages([updated], [{ id: 'one', body: 'Preview', bodyLoaded: false, bodyTruncated: true }]);
  assert.equal(retained.body, 'Nieuw');
});

test('shared read limiter bounds concurrent callers and releases slots after failure', async () => {
  const limit = createMailboxReadLimiter(3);
  let active = 0, max = 0;
  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) => limit(async () => {
    active++; max = Math.max(max, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (index === 2) throw new Error('read failed');
    return index;
  })));
  assert.equal(max, 3);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 8);
  assert.equal(await limit(async () => 'available'), 'available');
});

test('reference batches fill free slots across accounts while exact token and failure rules remain intact', async () => {
  let active = 0, max = 0, fail = false;
  const lookup = createMailboxMessageReferenceLookup({
    run: async (_label, operation) => {
      active++; max = Math.max(max, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      if (fail && _label.includes(':25:')) return { ok: false };
      const query = { select() { return this; }, eq(_column, value) { if (_column === 'account_email') this.account = value; return this; }, or() { return this; }, is() { return this; }, order() { return this; }, range() { return [
        { account_email: this.account, message_key: this.account, references_text: '<id-0@example.test>' },
        { account_email: this.account, message_key: 'substring', references_text: '<prefix-id-0@example.test>' },
      ]; } };
      return { ok: true, data: await operation({ from: () => query }) };
    },
    tableName: 'messages', metadataColumns: '*', normalizeString: (value) => String(value || ''),
    normalizeEmail: (value) => String(value || '').toLowerCase(), normalizeFolder: String, normalizeMessageRow: (row) => row,
  });
  const messageIds = Array.from({ length: 80 }, (_, index) => `id-${index}@example.test`);
  const results = await Promise.all(['serve', 'martijn'].map((owner) => lookup({ accountEmails: [`${owner}@example.test`], messageIds })));
  assert.equal(max, 3);
  assert.deepEqual(results.map((rows) => rows.length), [1, 1]);
  fail = true;
  assert.equal(await lookup({ accountEmails: ['serve@example.test'], messageIds }), null);
});

test('incoming and sent contact reads run together and incomplete data cannot become empty history', async () => {
  const started = [], releases = [];
  const run = (folder) => { started.push(folder); return new Promise((resolve) => releases.push(resolve)); };
  const args = {
    mailboxIndexStore: {
      listMatchingMessagesForAccounts: async () => [],
      listMessagesBySenderEmailsForAccounts: ({ folder }) => run(folder),
      listMessagesByRecipientEmailsForAccounts: () => run('sent'),
    },
    messages: [{ id: 'incoming' }], collectCampaignThreadParticipantEmails: () => ['contact@example.test'],
    dedupeCampaignMessages: (rows) => rows,
  };
  const request = loadMailboxCampaignContactHistory(args);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['coldmail', 'inbox', 'sent']);
  releases.forEach((release, index) => release(index === 2 ? [{ id: 'own-reply' }] : []));
  assert.deepEqual((await request).sentMessages, [{ id: 'own-reply' }]);
  args.mailboxIndexStore.listMessagesBySenderEmailsForAccounts = async () => [];
  args.mailboxIndexStore.listMessagesByRecipientEmailsForAccounts = async () => null;
  await assert.rejects(loadMailboxCampaignContactHistory(args), { status: 503 });
});
