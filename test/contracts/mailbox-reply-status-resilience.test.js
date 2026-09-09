const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxIndexStore } = require('../../server/services/mailbox-index-store');
const { createMailboxCampaignRepliesService } = require('../../server/services/mailbox-campaign-replies');
const { createMailboxCampaignRepliesList } = require('../../server/services/mailbox-campaign-replies-list');
const { serializeMailboxCampaignSnapshot, MAILBOX_CAMPAIGN_SNAPSHOT_KEY } = require('../../server/services/mailbox-campaign-snapshot');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox');

const account = 'servecreusen7@gmail.com';
const contact = 'contact@example.test';
const incoming = {
  id: 'coldmail:346', messageKey: 'incoming-current', folder: 'coldmail',
  accountEmail: account, from: 'Voorbeeld', email: contact, to: account,
  subject: 'Re: Kleine vraag over jullie website', preview: 'Dank voor je bericht.',
  date: '2026-09-03T07:35:54.000Z', receivedAt: '2026-09-03T07:35:54.000Z',
  messageId: '<incoming@example.test>', inReplyTo: '<original@example.test>',
};
const reply = {
  id: 'sent:386', messageKey: 'sent-current-generation', folder: 'sent', direction: 'sent',
  accountEmail: account, email: account, to: contact, subject: incoming.subject,
  date: '2026-09-03T10:12:08.000Z', messageId: '<reply@example.test>', inReplyTo: '', references: '',
};
const targets = [{ conversationId: 'conversation:reply', accountEmail: account,
  counterpartyEmail: contact, canonicalSubject: 'kleine vraag over jullie website',
  latestInboundAt: incoming.date }];
const logger = { error() {}, info() {}, warn() {} };

function indexFor(rpc, options = {}) {
  return createMailboxIndexStore({ isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ rpc }), logger, ...options });
}

test('controle van oude verzonden antwoorden herstelt een tijdelijke leesfout met priority-read', async () => {
  const clientOptions = [];
  let calls = 0;
  const client = { rpc: async () => {
    calls += 1;
    return calls === 1 ? { error: new Error('temporary network timeout') } : { data: [], error: null };
  } };
  const store = indexFor(null, { getSupabaseClient: (options) => { clientOptions.push(options); return client; } });
  assert.deepEqual(await store.listUnthreadedSentCandidatesForConversations({ targets }), []);
  assert.equal(calls, 2);
  assert.ok(clientOptions.every((options) => options.ignoreFailureCooldown && options.suppressFailureCooldown));
});

test('blijvende leesfouten en ongeldige resultaten zijn geen bewijs dat een antwoord ontbreekt', async () => {
  for (const result of [{ error: new Error('network timeout') }, { data: null }, { data: {} }]) {
    const store = indexFor(async () => result);
    await assert.rejects(store.listUnthreadedSentCandidatesForConversations({ targets }),
      { code: 'MAILBOX_REPLY_ACTIVITY_UNAVAILABLE', status: 503 });
  }
  const empty = indexFor(async () => ({ data: [] }));
  assert.deepEqual(await empty.listUnthreadedSentCandidatesForConversations({ targets }), []);
});

function campaignFor(lookup) {
  return createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'sent' ? [] : [incoming],
      listMatchingMessagesForAccounts: async ({ folder }) => folder === 'sent' ? [] : [incoming],
      listMessagesByMessageIdsForAccounts: async () => [],
      listUnthreadedSentCandidatesForConversations: lookup,
    },
    dataOpsStore: { listCustomersByEmails: async () => [{ id: 'example', bedrijf: 'Voorbeeld',
      email: contact, campaignType: 'webdesign', lastColdmailProvider: 'softora' }] },
    logger,
  });
}

function listFor(service, overrides = {}) {
  return createMailboxCampaignRepliesList({ mailboxCampaignRepliesService: service,
    instantlyMailboxService: { isConfigured: () => false },
    filterVisibleMailboxMessages: (messages) => messages, setUiStateValues: async () => {},
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, length) => String(value || '').slice(0, length), logger, ...overrides });
}

test('mislukte verzendcontrole publiceert geen onvolledige lijst of gedeelde snapshot', async () => {
  const error = Object.assign(new Error('answer evidence unavailable'), { status: 503 });
  const service = campaignFor(async () => { throw error; });
  let writes = 0;
  const list = listFor(service, { setUiStateValues: async () => { writes += 1; } });
  await assert.rejects(list({ owner: 'serve', hydrateBodies: false }), (actual) => actual === error);
  assert.equal(writes, 0);
});

test('herstelde controle toont het echte oude antwoord al in de lijst voordat het gesprek wordt geopend', async () => {
  const service = campaignFor(async ({ targets }) => [{ targetConversationId: targets[0].conversationId, message: reply }]);
  const result = await listFor(service)({ owner: 'serve', hydrateBodies: false });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].latestOutboundAt, reply.date);
  assert.equal(campaignInbox.needsConversationReply(result.messages[0]), false);
  assert.equal(result.messages[0].threadMessages[0].messageId, reply.messageId);
});

test('snapshot met een vervangen fysieke antwoordrij herstelt de actieve generatie zonder een fout rood hoekje', async () => {
  const staleReply = { ...reply, messageKey: 'sent-old-generation' };
  const raw = serializeMailboxCampaignSnapshot({ ok: true, messages: [{ ...incoming, threadMessages: [staleReply] }] });
  let canonicalReads = 0;
  const service = campaignFor(async ({ targets }) => {
    canonicalReads += 1;
    return [{ targetConversationId: targets[0].conversationId, message: reply }];
  });
  const list = listFor(service, {
    getUiStateValues: async () => ({ values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: raw } }),
    mailboxIndexStore: { listMessageStatesByKeys: async () => [{ message_key: incoming.messageKey, account_email: account }] },
  });
  const result = await list({ owner: 'serve', hydrateBodies: false, preferSnapshot: true });
  assert.equal(canonicalReads, 1);
  assert.equal(result.fromSnapshot, undefined);
  assert.equal(campaignInbox.needsConversationReply(result.messages[0]), false);
  assert.equal(result.messages[0].threadMessages[0].messageKey, reply.messageKey);
  assert.ok(!JSON.stringify(result.messages).includes('sent-old-generation'));
});

test('een open mailbox behoudt de beantwoorde lijststatus wanneer de servercontrole tijdelijk faalt', async () => {
  const ownerSession = require('../../assets/premium-mailbox-owner-session');
  const answered = { ...incoming, latestOutboundAt: reply.date, threadMessages: [reply] };
  let messages = [answered];
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      load: () => listFor(campaignFor(async () => {
        throw Object.assign(new Error('answer evidence unavailable'), { status: 503 });
      }))({ owner: 'serve', hydrateBodies: false }),
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveMail: () => incoming.id,
    getListElement: () => ({ setAttribute() {} }),
    renderList() { assert.equal(campaignInbox.needsConversationReply(messages[0]), false); },
  });
  assert.equal(await view.load({ preserveOnError: true, showLoader: false, openLatest: false }), false);
  assert.equal(messages[0], answered);
  assert.equal(campaignInbox.needsConversationReply(messages[0]), false);
});
