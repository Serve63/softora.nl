const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxDiscoveryRepository } = require('../../server/repositories/mailbox-discovery');
const { createMailboxOutreachScope } = require('../../server/services/mailbox-outreach-scope');
const { createMailboxCampaignRepliesService } = require('../../server/services/mailbox-campaign-replies');
const discovery = require('../../assets/premium-mailbox-discovery');
const { parseMailboxCampaignSnapshot, serializeMailboxCampaignSnapshot } = require('../../server/services/mailbox-campaign-snapshot');

test('bekende benaderde lead maakt een losse nieuwsbrief geen campagnereactie of snapshotbericht', async () => {
  const newsletter = {
    id: 'inbox:1', uid: 1, messageKey: 'serve|inbox|generation-a|1',
    accountEmail: 'serve@softora.nl', folder: 'inbox', email: 'info@events.example',
    to: 'serve@softora.nl', subject: 'LAST WEEKEND TO SAVE',
    preview: 'VIEW IN BROWSER', body: 'You have subscribed to our newsletter.',
    messageId: '<newsletter@events.example>', inReplyTo: '', references: '',
    automatedReplyEvidence: false, date: '2026-09-04T17:48:00Z',
  };
  const reply = {
    ...newsletter, id: 'inbox:2', uid: 2, messageKey: 'serve|inbox|generation-a|2',
    subject: 'Nieuw onderwerp voor onze afspraak', body: 'Ik heb de afspraak genoteerd.',
    messageId: '<reply@events.example>', inReplyTo: '<our-mail@softora.nl>',
    references: '<our-mail@softora.nl>', date: '2026-09-03T17:48:00Z',
  };
  const requests = [];
  const legacy = {
    ...reply, id: 'inbox:3', uid: 3, messageKey: 'serve|inbox|generation-a|3',
    subject: 'Re: Kleine vraag over jullie website', messageId: '<legacy@events.example>',
    inReplyTo: '', references: '', date: '2026-09-02T17:48:00Z',
  };
  const scope = createMailboxOutreachScope({ repository: {
    filterCampaignMessages: async (input) => {
      requests.push(input);
      return [reply.messageKey];
    },
    filterOutreachContacts: async () => ['info@events.example'],
  } });
  const service = createMailboxCampaignRepliesService({
    mailboxOutreachScope: scope,
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? [newsletter, reply, legacy] : [],
      listMatchingMessagesForAccounts: async () => [],
    },
    dataOpsStore: { listCustomersByEmails: async () => [{
      id: 'events-fixture', email: newsletter.email, campaignType: 'webdesign',
      lastColdmailProvider: 'softora', outreachStatus: 'benaderd',
    }] },
  });
  const result = await service.listRepliesWithSnapshot({ owner: 'serve', snapshotLimit: 100, hydrateBodies: false });
  assert.equal(requests.length, 1);
  assert.deepEqual(new Set(requests[0].messages.map((m) => m.message_key)), new Set([newsletter.messageKey, reply.messageKey]));
  assert.deepEqual(result.messages.map((m) => m.id), [reply.id]);
  assert.deepEqual(result.snapshotMessages.map((m) => m.id), [reply.id]);
  assert.ok(result.messages.every((m) => !m.threadMessages.some((child) => child.id === newsletter.id)));
  assert.ok(result.messages.some((m) => m.threadMessages.some((child) => child.id === legacy.id)));
});

test('berichtscope controleert de eigenaar en exacte generatie-identiteit vóór de databaseaanvraag', async () => {
  const calls = [];
  const scope = createMailboxOutreachScope({ repository: {
    filterCampaignMessages: async (input) => { calls.push(input); return ['serve-key', 'other-key']; },
  } });
  const result = await scope.filterMessages({ owner: 'serve', messages: [
    { accountEmail: 'serve@softora.nl', email: 'contact@example.nl', messageKey: 'serve-key' },
    { accountEmail: 'martijn@softora.nl', email: 'contact@example.nl', messageKey: 'other-key' },
    { accountEmail: 'serve@softora.nl', email: 'contact@example.nl', id: 'inbox:123', uid: 123 },
  ] });
  assert.deepEqual(result.map((m) => m.messageKey), ['serve-key']);
  assert.deepEqual(calls[0].messages, [{ message_key: 'serve-key', contact_email: 'contact@example.nl' }]);
});

test('berichtbewijs wordt volledig in begrensde batches gelezen en databasefouten laten niets door', async () => {
  const calls = [];
  let failing = false;
  const repository = createMailboxDiscoveryRepository({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ rpc: async (name, args) => {
      assert.equal(name, 'softora_filter_mailbox_campaign_messages');
      calls.push(args);
      return failing ? { error: new Error('database unavailable') }
        : { data: args.p_messages.map((m) => ({ message_key: m.message_key })) };
    } }),
  });
  const messages = Array.from({ length: 401 }, (_, i) => ({ message_key: `key-${i}`, contact_email: 'contact@example.nl' }));
  assert.equal((await repository.filterCampaignMessages({ accountEmails: ['serve@softora.nl'], messages })).length, 401);
  assert.deepEqual(calls.map((c) => c.p_messages.length), [200, 200, 1]);
  failing = true;
  await assert.rejects(() => repository.filterCampaignMessages({ accountEmails: ['serve@softora.nl'], messages }), /database unavailable/);
});

test('een lege succesvolle contacttijdlijn verzint geen bericht en gebruikt correct enkelvoud', () => {
  const root = { id: 'inbox:1', accountEmail: 'serve@softora.nl', email: 'contact@example.nl', messageId: '<one@example.nl>' };
  discovery.mergeContactTimeline(root, [], root.email, 0, {
    accountEmails: ['serve@softora.nl'], canonicalOwner: 'serve', getMessageOwner: () => 'serve',
  });
  assert.equal(root.contactTimelineTotal, 0);
  assert.match(discovery.renderTimelineSummary(root, String), /0 berichten · 0 onderwerpen/);
  assert.match(discovery.renderTimelineSummary({ ...root, contactTimelineTotal: 1, contactTimelineThreadCount: 1 }, String), /1 bericht · 1 onderwerp/);
});

test('snapshots van vóór de berichtcontrole kunnen verwijderde nieuwsbriefvermeldingen niet terugbrengen', () => {
  const current = JSON.parse(serializeMailboxCampaignSnapshot({ messages: [{ id: 'inbox:1', accountEmail: 'serve@softora.nl' }] }));
  assert.ok(parseMailboxCampaignSnapshot(JSON.stringify(current)));
  assert.equal(parseMailboxCampaignSnapshot(JSON.stringify({ ...current, version: 15 })), null);
});
