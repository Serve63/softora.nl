const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxQuotedSentCandidateLookup } = require('../../server/repositories/mailbox-quoted-sent-candidate-lookup');
const { createMailboxCampaignRepliesService } = require('../../server/services/mailbox-campaign-replies');
const { createMailboxCampaignRepliesList } = require('../../server/services/mailbox-campaign-replies-list');

test('een mislukte volgende quote-lookup wist geen eerder bewijs als succesvol leeg antwoord', async () => {
  for (const broken of [{ ok: false }, { ok: true, data: null }]) {
    let calls = 0;
    const lookup = createMailboxQuotedSentCandidateLookup({
      run: async () => ++calls === 1 ? { ok: true, data: [{ message_key: 'sent:1' }] } : broken,
      normalizeString: (value) => String(value || ''), normalizeEmail: (value) => String(value || '').toLowerCase(),
      normalizeMessageRow: (row) => row,
    });
    const targets = ['one@example.nl', 'two@example.nl'].map((recipientEmail) => ({
      recipientEmail, accountEmail: 'serve@softora.nl', canonicalSubject: 'Website',
    }));
    await assert.rejects(lookup({ targets }), { code: 'MAILBOX_HISTORY_UNAVAILABLE', status: 503 });
    assert.equal(calls, 2);
  }
});

test('quote-lookup begrenst gelijktijdige databaselezingen en behoudt alle resultaten', async () => {
  let active = 0; let peak = 0; let sequence = 0;
  const lookup = createMailboxQuotedSentCandidateLookup({
    run: async () => {
      const id = ++sequence; active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve)); active--;
      return { ok: true, data: [{ message_key: `sent:${id}` }] };
    },
    normalizeString: (value) => String(value || ''), normalizeEmail: (value) => String(value || ''), normalizeMessageRow: (row) => row,
  });
  const rows = await lookup({ targets: Array.from({ length: 8 }, (_value, index) => ({
    recipientEmail: `${index}@example.nl`, accountEmail: 'serve@softora.nl', canonicalSubject: 'Website',
  })) });
  assert.equal(rows.length, 8); assert.equal(peak, 3); assert.equal(active, 0);
});

function evidenceFixture(overrides = {}, provenance = {}) {
  const incoming = {
    id: 'inbox:one', folder: 'inbox', accountEmail: 'serve@softora.nl', email: 'contact@example.nl',
    subject: 'Re: Kleine vraag over jullie website', body: 'Dank, ik heb een vraag.',
    date: '2026-09-09T10:00:00Z', messageId: '<incoming@example.nl>', inReplyTo: '<sent@example.nl>',
  };
  return createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? [incoming] : [],
      listMatchingMessagesForAccounts: async () => [],
      listMessagesByMessageIdsForAccounts: async () => [],
      listMessagesReferencingMessageIdsForAccounts: async () => [],
      hydrateMessageBodies: async ({ messages }) => messages,
      ...overrides,
    },
    dataOpsStore: { listCustomersByEmails: async () => [{ email: incoming.email, campaignType: 'webdesign' }] },
    mailboxSendProvenanceStore: { listAcceptedMessages: async () => [], ...provenance },
  });
}

test('onleesbare parent- en accepted-sendbewijzen worden niet als afwezig gepubliceerd', async () => {
  for (const result of ['null', 'throw']) {
    const read = async () => {
      if (result === 'throw') throw Object.assign(new Error('Tijdelijke leesfout'), { status: 503 });
      return null;
    };
    for (const service of [evidenceFixture({ listMessagesByMessageIdsForAccounts: read }), evidenceFixture({}, { listAcceptedMessages: read })]) {
      await assert.rejects(service.listReplies({ owner: 'serve', hydrateBodies: false }), { status: 503 });
    }
  }
});

test('interactieve eigenaarlijst doet geen gedeelde reconstructie of snapshotwrite', async () => {
  const requests = []; const providerOwners = []; let writes = 0;
  const create = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: { listRepliesWithSnapshot: async (options) => {
      requests.push(options);
      const message = { id: 'message', accountEmail: 'serve@softora.nl', receivedAt: '2026-09-09T10:00:00Z', threadMessages: [] };
      return { messages: [message], snapshotMessages: [message] };
    } },
    instantlyMailboxService: {
      isConfigured: () => true, getConfiguredAccounts: (owner) => [{ email: `${owner}@example.nl` }],
      listOwnerConversations: async (owner) => { providerOwners.push(owner); return []; },
    },
    setUiStateValues: async () => { writes++; }, filterVisibleMailboxMessages: (rows) => rows,
    normalizeString: (value) => String(value || ''), truncateText: (value, n) => String(value || '').slice(0, n), logger: { warn() {} },
  });
  const result = await create({ owner: 'martijn', hydrateBodies: false });
  assert.equal(result.ok, true);
  assert.deepEqual(providerOwners, ['martijn']); assert.equal(writes, 0);
  assert.equal(requests[0].snapshotLimit, 0);
  await create({ owner: '', hydrateBodies: false, includeSnapshotMessages: true });
  assert.equal(requests[1].snapshotLimit, 200); assert.equal(writes, 1);
  assert.deepEqual(providerOwners.slice(1), ['serve', 'martijn']);
});

test('een mislukte geschiedenisopbouw mag de gedeelde snapshot niet vervangen', async () => {
  let writes = 0;
  const list = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: { listReplies: async () => { throw Object.assign(new Error('Onvolledig'), { status: 503 }); } },
    setUiStateValues: async () => { writes++; },
  });
  await assert.rejects(list({ includeSnapshotMessages: true }), { status: 503 });
  assert.equal(writes, 0);
});
