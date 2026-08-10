const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_INCOMING_FOLDERS,
  CAMPAIGN_MAILBOX_ACCOUNTS,
  CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
  attachCrossAccountMailboxCopies,
  attachSentThreadMessages,
  attachTargetedUnthreadedSentMessages,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  getCampaignConversationAccountEmail,
  isAutomatedCampaignReply,
  shouldShowCampaignConversation,
} = require('../../server/services/mailbox-campaign-replies');

test('durable lineage keeps a newly discovered transitive reply visible in one bounded read', async () => {
  const root = {
    id: 'sent:root', folder: 'sent', accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl', to: 'lead@example.test',
    subject: 'Kleine vraag over jullie website', date: '2026-08-01T08:00:00.000Z',
    messageId: '<root@softora.test>', originalCampaignOutbound: true,
    campaignLineageEvidenceKnown: true, campaignLineageDepth: 0,
    campaignLineageRootMessageId: 'root@softora.test',
    campaignLineageEvidence: 'exact-same-account-message-id-ancestry',
  };
  const sentDescendant = {
    id: 'sent:manual', folder: 'sent', accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl', to: 'lead@example.test',
    subject: 'Even terugkomend op je vraag', date: '2026-08-02T08:00:00.000Z',
    messageId: '<manual@softora.test>', inReplyTo: root.messageId,
    references: root.messageId,
    campaignLineageEvidenceKnown: true, campaignLineageDepth: 1,
    campaignLineageRootMessageId: 'root@softora.test',
    campaignLineageEvidence: 'exact-same-account-message-id-ancestry',
  };
  const changedSubjectReply = {
    id: 'inbox:changed', folder: 'inbox', accountEmail: 'serve@softora.nl',
    email: 'lead@example.test', to: 'serve@softora.nl',
    subject: 'Los onderwerp maar exact antwoord', preview: 'Ja, stuur de preview maar.',
    date: '2026-08-03T08:00:00.000Z', messageId: '<reply@example.test>',
    inReplyTo: sentDescendant.messageId,
    references: `${root.messageId} ${sentDescendant.messageId}`,
    campaignLineageEvidenceKnown: true, campaignLineageDepth: 2,
    campaignLineageRootMessageId: 'root@softora.test',
    campaignLineageEvidence: 'exact-same-account-message-id-ancestry',
  };
  const sentAfterReply = {
    id: 'sent:after-reply', folder: 'sent', accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl', to: 'lead@example.test',
    subject: 'Re: Los onderwerp maar exact antwoord', preview: 'Dank, ik stuur hem vandaag.',
    date: '2026-08-04T08:00:00.000Z', messageId: '<after-reply@softora.test>',
    inReplyTo: changedSubjectReply.messageId,
    references: `${root.messageId} ${sentDescendant.messageId} ${changedSubjectReply.messageId}`,
    campaignLineageEvidenceKnown: true, campaignLineageDepth: 3,
    campaignLineageRootMessageId: 'root@softora.test',
    campaignLineageEvidence: 'exact-same-account-message-id-ancestry',
  };
  const calls = { lineage: 0, recent: 0, matching: 0, legacy: 0 };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listCampaignLineageMessages: async ({ replyLimit, maxDepth, maxResults, deadlineMs }) => {
        calls.lineage += 1;
        assert.equal(replyLimit, 200);
        assert.equal(maxDepth, 20);
        assert.equal(maxResults, 9000);
        assert.equal(deadlineMs, 8000);
        return [changedSubjectReply, sentAfterReply, sentDescendant, root];
      },
      listMessagesForAccounts: async () => { calls.recent += 1; return []; },
      listMatchingMessagesForAccounts: async () => {
        calls.matching += 1;
        throw new Error('duurzame lineage mag geen groeiende subject-historyscan starten');
      },
      listMessagesByMessageIdsForAccounts: async () => {
        calls.legacy += 1;
        throw new Error('legacy per-ID lookup mag niet draaien');
      },
      listMessagesReferencingMessageIdsForAccounts: async () => {
        calls.legacy += 1;
        throw new Error('legacy reference lookup mag niet draaien');
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: { listCustomersByEmails: async () => [] },
  });

  const replies = await service.listReplies({ limit: 10, owner: 'serve' });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 'inbox:changed');
  assert.deepEqual(replies[0].threadMessages.map((message) => message.id), [
    'sent:after-reply',
    'sent:manual',
    'sent:root',
  ]);
  assert.deepEqual(calls, { lineage: 1, recent: 2, matching: 0, legacy: 0 });
});

test('durable lineage fails closed before a partial context can replace the mailbox', async () => {
  let recentReads = 0;
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listCampaignLineageMessages: async () => [{
        id: 'inbox:partial',
        folder: 'inbox',
        accountEmail: 'serve@softora.nl',
        campaignLineageContextTruncated: true,
      }],
      listMessagesForAccounts: async () => { recentReads += 1; return []; },
    },
    dataOpsStore: { listCustomersByEmails: async () => [] },
  });

  await assert.rejects(
    service.listReplies({ limit: 100, owner: 'serve' }),
    { code: 'MAILBOX_CAMPAIGN_LINEAGE_UNAVAILABLE', status: 503 }
  );
  assert.equal(recentReads, 0);
});

test('campaign mailbox applies the selected owner before limiting older conversations', async () => {
  const serveAccounts = [
    'serve@softora.nl',
    'servecreusen@softora.nl',
    'servec321@gmail.com',
    'serve290@gmail.com',
    'servecreusen7@gmail.com',
  ];
  const martijnMessages = Array.from({ length: 220 }, (_value, index) => ({
    id: `martijn:${index}`,
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    from: `Martijn lead ${index}`,
    email: `martijn-lead-${index}@example.test`,
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Menselijke reactie van Martijns lead.',
    date: new Date(Date.UTC(2026, 6, 31, 23, 59, index % 60)).toISOString(),
    messageId: `<martijn-${index}@example.test>`,
  }));
  const olderServeMessages = Array.from({ length: 3 }, (_value, index) => ({
    id: `serve:${index}`,
    folder: 'inbox',
    accountEmail: serveAccounts[index],
    from: `Oudere Servé lead ${index}`,
    email: `serve-lead-${index}@example.test`,
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Oudere menselijke reactie voor Servé.',
    date: new Date(Date.UTC(2026, 4, 22 + index, 10)).toISOString(),
    messageId: `<serve-${index}@example.test>`,
  }));
  const sourceMessages = [...martijnMessages, ...olderServeMessages];
  const requestedAccountSets = [];
  const mailboxIndexStore = {
    listMessagesForAccounts: async ({ accountEmails, folder }) => {
      requestedAccountSets.push(accountEmails.slice().sort());
      return folder === 'inbox'
        ? sourceMessages.filter((message) => accountEmails.includes(message.accountEmail))
        : [];
    },
    listMatchingMessagesForAccounts: async ({ accountEmails, folder }) => {
      requestedAccountSets.push(accountEmails.slice().sort());
      return folder === 'inbox'
        ? sourceMessages.filter((message) => accountEmails.includes(message.accountEmail))
        : [];
    },
    hydrateMessageBodies: async ({ messages }) => messages,
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore,
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => emails.map((email) => ({
        id: email,
        bedrijf: email,
        email,
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      })),
    },
  });

  const replies = await service.listReplies({ limit: 200, owner: 'serve' });

  assert.deepEqual(replies.map((reply) => reply.id), ['serve:2', 'serve:1', 'serve:0']);
  assert.ok(requestedAccountSets.length > 0);
  requestedAccountSets.forEach((accounts) => assert.deepEqual(accounts, serveAccounts.slice().sort()));

  requestedAccountSets.length = 0;
  const result = await service.listRepliesWithSnapshot({
    limit: 200,
    owner: 'serve',
    snapshotLimit: 100,
  });

  assert.deepEqual(result.messages.map((reply) => reply.id), ['serve:2', 'serve:1', 'serve:0']);
  assert.equal(result.snapshotMessages.length, 103);
  assert.deepEqual(
    result.snapshotMessages.filter((reply) => reply.accountEmail !== 'martijn@softora.nl')
      .map((reply) => reply.id),
    ['serve:2', 'serve:1', 'serve:0']
  );
  requestedAccountSets.forEach((accounts) => assert.deepEqual(
    accounts,
    CAMPAIGN_MAILBOX_ACCOUNTS.slice().sort()
  ));
});

test('CRM-uitval verbergt directe campagnereplies niet en laat onbewezen CRM-only mail dicht', async () => {
  const directReply = {
    id: 'inbox:direct-reply',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Burgers Hondenpension',
    email: 'burgershondenpension@gmail.com',
    to: 'serve@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Geen interesse.',
    date: '2026-08-07T14:56:02.000Z',
    messageId: '<direct-reply@example.test>',
  };
  const unprovenCustomerOnlyMail = {
    ...directReply,
    id: 'inbox:customer-only',
    email: 'mogelijk-klant@example.test',
    subject: 'Los bericht zonder campagnebewijs',
    messageId: '<customer-only@example.test>',
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox'
        ? [directReply, unprovenCustomerOnlyMail]
        : [],
      listMatchingMessagesForAccounts: async ({ folder }) => folder === 'inbox'
        ? [directReply, unprovenCustomerOnlyMail]
        : [],
      listMessagesByMessageIdsForAccounts: async () => [],
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async () => {
        const error = new Error('Supabase CRM timeout');
        error.code = 'SUPABASE_TIMEOUT';
        throw error;
      },
    },
    logger: { warn() {} },
  });

  const result = await service.listRepliesWithSnapshot({ limit: 100, owner: 'serve' });

  assert.deepEqual(result.messages.map((message) => message.id), ['inbox:direct-reply']);
  assert.deepEqual(result.warnings, ['campaign_customer_link_unavailable']);
  assert.equal(result.messages[0].campaign.customerId, '');
  assert.equal(result.messages[0].outreach, null);
});

test('campaign mailbox bouwt een bewezen BCC-kopie als volledige chronologische thread', () => {
  const original = {
    id: 'sent:original',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-24T15:00:00.000Z',
    messageId: '<original@softora.nl>',
  };
  const incoming = {
    id: 'inbox:sandra',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    from: 'Sandra van Berkel',
    email: 'equirehab4you@gmail.com',
    to: 'martijn@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T15:30:00.000Z',
    messageId: '<sandra@gmail.com>',
    inReplyTo: original.messageId,
    references: original.messageId,
  };
  const sentReply = {
    id: 'sent:reply',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>',
    bcc: 'Servé Creusen <serve@softora.nl>',
    recipientRoutingEvidenceKnown: true,
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T16:15:00.000Z',
    messageId: '<reply@softora.nl>',
    inReplyTo: incoming.messageId,
    references: `${original.messageId} ${incoming.messageId}`,
  };
  const copy = {
    ...sentReply,
    id: 'inbox:copy',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
  };
  const conversations = attachCrossAccountMailboxCopies(
    [
      { ...incoming, threadMessages: [sentReply, original] },
      { ...copy, threadMessages: [] },
    ],
    [incoming, copy],
    [original, sentReply]
  );

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, 'inbox:copy');
  assert.equal(getCampaignConversationAccountEmail(conversations[0]), 'martijn@softora.nl');
  assert.deepEqual(conversations[0].threadMessages.map((message) => message.id), [
    'sent:original',
    'inbox:sandra',
  ]);
  assert.deepEqual(conversations[0].copyContext, {
    evidenceKnown: true,
    kind: 'bcc',
    sourceAccountEmail: 'martijn@softora.nl',
    sourceName: 'Martijn van de Ven',
    sourceEmail: 'martijn@softora.nl',
    recipientName: 'Sandra van Berkel',
    recipientEmail: 'equirehab4you@gmail.com',
    copyAccountEmail: 'serve@softora.nl',
    evidence: 'exact-bcc-recipient-and-cross-account-sent-message-id',
  });
});

test('campaign mailbox schrijft een bewezen collega-kopie aan de bron-eigenaar toe', async () => {
  const original = {
    id: 'sent:original', folder: 'sent', accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven', email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>',
    subject: 'Kleine vraag over jullie website', date: '2026-07-24T15:00:00.000Z',
    messageId: '<original@softora.nl>',
  };
  const incoming = {
    id: 'inbox:sandra', folder: 'inbox', accountEmail: 'martijn@softora.nl',
    from: 'Sandra van Berkel', email: 'equirehab4you@gmail.com', to: 'martijn@softora.nl',
    subject: 'Re: Kleine vraag over jullie website', date: '2026-07-24T15:30:00.000Z',
    messageId: '<sandra@gmail.com>', inReplyTo: original.messageId, references: original.messageId,
  };
  const sentReply = {
    id: 'sent:reply', folder: 'sent', accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven', email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>', bcc: 'Servé Creusen <serve@softora.nl>',
    recipientRoutingEvidenceKnown: true, subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T16:15:00.000Z', messageId: '<reply@softora.nl>',
    inReplyTo: incoming.messageId, references: `${original.messageId} ${incoming.messageId}`,
  };
  const copy = { ...sentReply, id: 'inbox:copy', folder: 'inbox', accountEmail: 'serve@softora.nl' };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ accountEmails, folder }) => folder === 'inbox'
        ? [incoming, copy].filter((message) => accountEmails.includes(message.accountEmail))
        : [],
      listMatchingMessagesForAccounts: async ({ accountEmails, folder }) => (
        folder === 'sent' ? [original, sentReply] : [incoming, copy]
      ).filter((message) => accountEmails.includes(message.accountEmail)),
      listMessagesByMessageIdsForAccounts: async () => [original, sentReply],
      listMessagesReferencingMessageIdsForAccounts: async () => [],
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'sandra', bedrijf: 'Equirehab4you', email: 'equirehab4you@gmail.com',
        campaignType: 'webdesign', lastColdmailProvider: 'softora',
      }],
    },
  });

  const serve = await service.listRepliesWithSnapshot({ limit: 100, owner: 'serve', snapshotLimit: 100 });
  const martijn = await service.listRepliesWithSnapshot({ limit: 100, owner: 'martijn', snapshotLimit: 100 });

  assert.deepEqual(serve.messages, []);
  assert.equal(martijn.messages.length, 1);
  assert.equal(martijn.messages[0].id, 'inbox:copy');
  assert.equal(getCampaignConversationAccountEmail(martijn.messages[0]), 'martijn@softora.nl');
});

test('campaign mailbox labelt CC exact en gokt niet zonder recipient-provenance', () => {
  const sent = {
    id: 'sent:cc',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'klant@example.nl',
    cc: 'serve@softora.nl',
    date: '2026-07-24T16:15:00.000Z',
    messageId: '<cc@softora.nl>',
  };
  const copy = {
    ...sent,
    id: 'inbox:cc-copy',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
  };
  const exact = attachCrossAccountMailboxCopies([{ ...copy, threadMessages: [] }], [copy], [sent]);
  assert.equal(exact[0].copyContext.kind, 'cc');

  const uncertainSent = { ...sent, id: 'sent:unknown', messageId: '<unknown@softora.nl>', cc: '' };
  const uncertainCopy = {
    ...uncertainSent,
    id: 'inbox:unknown-copy',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
  };
  const uncertain = attachCrossAccountMailboxCopies(
    [{ ...uncertainCopy, threadMessages: [] }],
    [uncertainCopy],
    [uncertainSent]
  );
  assert.equal(uncertain[0].copyContext, undefined);
});

test('campaign mailbox toont een bewezen eigen kopie alleen met een externe reactie in de thread', () => {
  const ownCopy = {
    id: 'inbox:own-copy',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'martijn@softora.nl',
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
    },
    threadMessages: [{
      id: 'sent:own-message',
      folder: 'sent',
      accountEmail: 'martijn@softora.nl',
      email: 'martijn@softora.nl',
    }],
  };

  assert.equal(shouldShowCampaignConversation(ownCopy), false);
  assert.equal(shouldShowCampaignConversation({
    ...ownCopy,
    threadMessages: [
      ...ownCopy.threadMessages,
      {
        id: 'inbox:customer-reply',
        folder: 'inbox',
        accountEmail: 'martijn@softora.nl',
        email: 'klant@example.nl',
      },
    ],
  }), true);
  assert.equal(shouldShowCampaignConversation({
    id: 'inbox:external',
    accountEmail: 'serve@softora.nl',
    email: 'klant@example.nl',
  }), true);
});

test('campaign mailbox bewijst een BCC-kopie via exact Message-ID wanneer Outlook de BCC-header verwijdert', () => {
  const original = {
    id: 'sent:291',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-24T07:44:00.000Z',
    messageId: '<original@softora.nl>',
    recipientRoutingEvidenceKnown: true,
  };
  const incoming = {
    id: 'inbox:45',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    from: 'Sandra van Berkel',
    email: 'equirehab4you@gmail.com',
    to: 'martijn@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T08:58:25.000Z',
    messageId: '<sandra@gmail.com>',
    inReplyTo: original.messageId,
    references: original.messageId,
    recipientRoutingEvidenceKnown: true,
  };
  const sentReply = {
    id: 'sent:297',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'martijn@softora.nl',
    email: 'martijn@softora.nl',
    to: 'Sandra van Berkel <equirehab4you@gmail.com>',
    cc: '',
    bcc: '',
    recipientRoutingEvidenceKnown: true,
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T16:15:29.000Z',
    messageId: '<outlook-reply@outlook.com>',
    inReplyTo: incoming.messageId,
    references: `${original.messageId} ${incoming.messageId}`,
  };
  const strippedBccCopy = {
    ...sentReply,
    id: 'inbox:107',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
  };

  const conversations = attachCrossAccountMailboxCopies(
    [
      { ...incoming, threadMessages: [sentReply, original] },
      { ...strippedBccCopy, threadMessages: [] },
    ],
    [incoming, strippedBccCopy],
    [original, sentReply]
  );

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, 'inbox:107');
  assert.deepEqual(conversations[0].threadMessages.map((message) => message.id), [
    'sent:291',
    'inbox:45',
  ]);
  assert.deepEqual(conversations[0].copyContext, {
    evidenceKnown: true,
    kind: 'bcc',
    sourceAccountEmail: 'martijn@softora.nl',
    sourceName: 'martijn@softora.nl',
    sourceEmail: 'martijn@softora.nl',
    recipientName: 'Sandra van Berkel',
    recipientEmail: 'equirehab4you@gmail.com',
    copyAccountEmail: 'serve@softora.nl',
    evidence: 'exact-cross-account-message-id-with-stripped-bcc-header',
  });
});

test('campaign mailbox removes duplicate IMAP rows for the same internet message', () => {
  const messages = dedupeCampaignMessages([
    {
      id: 'inbox:7',
      accountEmail: 'servecreusen@softora.nl',
      messageId: '<same-reply@example.com>',
    },
    {
      id: 'inbox:6',
      accountEmail: 'servecreusen@softora.nl',
      messageId: '<same-reply@example.com>',
    },
    {
      id: 'inbox:8',
      accountEmail: 'martijn@softora.nl',
      messageId: '<same-reply@example.com>',
    },
  ]);

  assert.deepEqual(messages.map((message) => message.id), ['inbox:7', 'inbox:8']);
});

test('campaign mailbox prefers exact Gmail label provenance over a stale Inbox copy', () => {
  const messages = dedupeCampaignMessages([
    {
      id: 'inbox:7',
      uid: 7,
      folder: 'inbox',
      accountEmail: 'servec321@gmail.com',
      messageId: '<same-filtered-reply@example.com>',
    },
    {
      id: 'coldmail:91',
      uid: 91,
      folder: 'coldmail',
      accountEmail: 'servec321@gmail.com',
      messageId: '<same-filtered-reply@example.com>',
    },
  ]);

  assert.deepEqual(CAMPAIGN_INCOMING_FOLDERS, ['coldmail', 'inbox']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'coldmail:91');
  assert.deepEqual(messages[0].sourceFolders.sort(), ['coldmail', 'inbox']);
});

test('campaign reply service shows filtered replies and bounces once without exposing labeled own sent mail', async () => {
  const filteredReply = {
    id: 'coldmail:20',
    uid: 20,
    folder: 'coldmail',
    accountEmail: 'servec321@gmail.com',
    from: 'Klant',
    email: 'klant@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dank voor je ontwerp.',
    date: '2026-07-25T10:00:00.000Z',
    messageId: '<reply@example.nl>',
  };
  const staleInboxCopy = {
    ...filteredReply,
    id: 'inbox:10',
    uid: 10,
    folder: 'inbox',
  };
  const filteredBounce = {
    id: 'coldmail:21',
    uid: 21,
    folder: 'coldmail',
    accountEmail: 'servec321@gmail.com',
    from: 'Mail Delivery Subsystem',
    email: 'mailer-daemon@googlemail.com',
    subject: 'Adres niet gevonden',
    preview: 'Je bericht is niet bezorgd aan oud@example.nl.',
    date: '2026-07-25T10:05:00.000Z',
    messageId: '<bounce@googlemail.com>',
  };
  const labeledOwnSent = {
    id: 'coldmail:22',
    uid: 22,
    folder: 'coldmail',
    accountEmail: 'servec321@gmail.com',
    from: 'Servé Creusen',
    email: 'servec321@gmail.com',
    to: 'klant@example.nl',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-25T09:00:00.000Z',
    messageId: '<sent@gmail.com>',
  };
  const unprovenCrossAccountOwnCopy = {
    id: 'coldmail:23',
    uid: 23,
    folder: 'coldmail',
    accountEmail: 'servec321@gmail.com',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'klant@example.nl',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-25T08:55:00.000Z',
    messageId: '<unproven-cross-account-copy@softora.nl>',
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (
        folder === 'coldmail'
          ? [filteredBounce, filteredReply, labeledOwnSent, unprovenCrossAccountOwnCopy]
          : [staleInboxCopy]
      ),
      listMatchingMessagesForAccounts: async ({ folder }) => (
        folder === 'coldmail'
          ? [filteredReply, labeledOwnSent, unprovenCrossAccountOwnCopy]
          : folder === 'inbox'
            ? [staleInboxCopy]
            : []
      ),
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'klant',
        bedrijf: 'Klant BV',
        email: 'klant@example.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.deepEqual(replies.map((message) => message.id), ['coldmail:21', 'coldmail:20']);
  assert.equal(replies.filter((message) => message.messageId === '<reply@example.nl>').length, 1);
  assert.equal(replies.some((message) => message.id === 'coldmail:22'), false);
  assert.equal(replies.some((message) => message.id === 'coldmail:23'), false);
});

test('campaign mailbox classificeert Gmail-dot-aliassen als eigen outbound en bouwt geen Altiflex-megathread', async () => {
  const ownColdmailCopies = Array.from({ length: 60 }, (_item, index) => ({
    id: `coldmail:${index + 1}`,
    uid: index + 1,
    folder: 'coldmail',
    accountEmail: 'servecreusen7@gmail.com',
    from: 'Servé Creusen',
    email: 'serve.creusen7@gmail.com',
    to: index === 0 ? 'info@altiflexpersoneelsdiensten.nl' : `bedrijf-${index}@example.nl`,
    subject: 'Kleine vraag over jullie website',
    date: new Date(Date.UTC(2026, 6, 28, 12, index)).toISOString(),
    messageId: `<outbound-${index}@gmail.com>`,
    hasBody: true,
  }));
  const sentCopies = ownColdmailCopies.map((message, index) => ({
    ...message,
    id: `sent:${index + 1}`,
    uid: index + 101,
    folder: 'sent',
  }));
  const realReply = {
    id: 'coldmail:reply',
    uid: 900,
    folder: 'coldmail',
    accountEmail: 'servecreusen7@gmail.com',
    from: 'Bedrijf 3',
    email: 'bedrijf-3@example.nl',
    to: 'serve.creusen7@gmail.com',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-28T15:30:00.000Z',
    messageId: '<reply-3@example.nl>',
    inReplyTo: '<outbound-3@gmail.com>',
    references: '<outbound-3@gmail.com>',
    hasBody: true,
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'coldmail' ? [realReply, ...ownColdmailCopies] : [],
      listMatchingMessagesForAccounts: async ({ folder }) => folder === 'sent' ? sentCopies : folder === 'coldmail' ? [realReply, ...ownColdmailCopies] : [],
      listMessagesByMessageIdsForAccounts: async () => [sentCopies[3]],
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => emails.map((email) => ({
        id: email,
        bedrijf: email,
        email,
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      })),
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 'coldmail:reply');
  assert.deepEqual(replies[0].threadMessages.map((message) => message.id), ['sent:4']);
  assert.equal(replies[0].threadMessages[0].direction, 'sent');
  assert.equal(replies[0].threadMessages[0].folder, 'sent');
  assert.equal(replies.some((message) => String(message.to).includes('altiflex')), false);
});

test('campaign mailbox sorteert alleen op exact gekoppelde threadactiviteit', () => {
  const conversations = attachSentThreadMessages(
    [
      {
        id: 'inbox:ralph',
        folder: 'inbox',
        accountEmail: 'martijn@softora.nl',
        email: 'rruyters@road2value.com',
        date: '2026-06-15T13:58:18.000Z',
      },
      {
        id: 'inbox:later-contact',
        folder: 'inbox',
        accountEmail: 'martijn@softora.nl',
        email: 'later@example.test',
        date: '2026-06-20T09:00:00.000Z',
      },
    ],
    [{
      id: 'sent:ralph-followup',
      folder: 'sent',
      accountEmail: 'martijn@softora.nl',
      to: 'rruyters@road2value.com',
      date: '2026-06-23T11:32:58.000Z',
    }]
  );

  assert.equal(conversations[0].email, 'later@example.test');
  assert.equal(conversations[1].email, 'rruyters@road2value.com');
  assert.equal(conversations[1].threadMessages.length, 0);
});

test('campaign mailbox koppelt een later antwoord via mailheaders ook bij een ander contactadres', () => {
  const originalMessageId = '<initial-vangestel@gmail.com>';
  const incomingMessageId = '<reply-vangestel@example.nl>';
  const conversations = attachSentThreadMessages(
    [{
      id: 'inbox:2429',
      folder: 'inbox',
      accountEmail: 'serve290@gmail.com',
      email: 'info@vangestelsteigerbouw.nl',
      to: 'serve290@gmail.com',
      subject: 'Re: Kleine vraag over jullie website',
      date: '2026-06-09T21:38:29.000Z',
      messageId: incomingMessageId,
      inReplyTo: originalMessageId,
      references: originalMessageId,
    }],
    [{
      id: 'sent:joey',
      folder: 'sent',
      accountEmail: 'serve290@gmail.com',
      email: 'serve290@gmail.com',
      to: 'Joey <joey@vangestelsteigerbouw.nl>',
      subject: 'Re: Kleine vraag over jullie website',
      date: '2026-06-10T08:00:00.000Z',
      messageId: '<serve-follow-up@gmail.com>',
      inReplyTo: incomingMessageId,
      references: `${originalMessageId} ${incomingMessageId}`,
    }]
  );

  assert.equal(conversations.length, 1);
  assert.equal(
    conversations[0].conversationId,
    'conversation:serve290@gmail.com|initial-vangestel@gmail.com'
  );
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.id),
    ['sent:joey']
  );
  assert.equal(conversations[0].activityAt, '2026-06-09T21:38:29.000Z');
  assert.equal(conversations[0].latestInboundAt, '2026-06-09T21:38:29.000Z');
  assert.equal(conversations[0].latestOutboundAt, '2026-06-10T08:00:00.000Z');
});

test('campaign mailbox hides only source-proven automatic replies and keeps unknown text visible', () => {
  assert.equal(isAutomatedCampaignReply({
    subject: 'zomersluiting Re: Kleine vraag over jullie website',
    body: 'Beste mailer, tot 1 juli zijn wij gesloten.',
    automatedReplyEvidence: true,
  }), false, 'een los pre-genormaliseerd vlaggetje zonder bronbewijs blijft zichtbaar');
  assert.equal(isAutomatedCampaignReply({
    subject: 'Out of the office Re: Kleine vraag over jullie website',
    autoSubmitted: 'auto-replied',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Automatisch antwoord: Re: Kleine vraag over jullie website',
    precedence: 'bulk',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Automatisch antwoord: Re: Kleine vraag over jullie website',
    autoResponseSuppress: 'All',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Bedankt voor je bericht',
    body: 'Het ontwerp ziet er goed uit; wat kost een nieuwe website?',
    autoSubmitted: 'no',
  }), false);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Vraag over automatisch antwoorden in Gmail',
    body: 'Kun je uitleggen hoe ik dit zelf instel?',
  }), false);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Automatisch antwoord: Re: Kleine vraag over jullie website',
    automatedReplyEvidenceKnown: true,
    automatedReplyEvidence: false,
    automatedReplyEvidenceSource: 'instantly:is_auto_reply',
  }), false, 'providerbewijs dat is_auto_reply false is houdt het menselijke antwoord zichtbaar');
});

test('campaign mailbox koppelt een unieke nabije automatische reactie zonder RFC-referenties fail-closed', () => {
  const incoming = {
    id: 'inbox:festival-cement',
    folder: 'inbox',
    accountEmail: 'servec321@gmail.com',
    email: 'info@festivalcement.nl',
    to: 'servec321@gmail.com',
    subject: 'Bedankt voor jouw mail! Re: Kleine vraag over jullie website',
    preview: 'Beste mailer, dank voor je mail.',
    body: 'Beste mailer, dank voor je mail. Check vooral onze contactgegevens.',
    date: '2026-07-28T13:17:06.000Z',
    messageId: '<auto-reply@festivalcement.nl>',
    inReplyTo: '',
    references: '',
    autoSubmitted: 'auto-generated',
  };
  const sent = {
    id: 'sent:festival-cement',
    folder: 'sent',
    accountEmail: 'servec321@gmail.com',
    email: 'servec321@gmail.com',
    to: 'info@festivalcement.nl',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-28T13:17:00.000Z',
    messageId: '<campaign@servec321.gmail.com>',
    originalCampaignOutbound: true,
  };

  const conversations = attachSentThreadMessages([incoming], [sent]);

  assert.deepEqual(conversations[0].threadMessages.map((message) => message.id), [sent.id]);
  assert.equal(
    conversations[0].threadMessages[0].threadCorrelationEvidence,
    'exact-account-recipient-subject-nearby-auto-reply'
  );

  const ambiguous = attachSentThreadMessages([incoming], [
    sent,
    { ...sent, id: 'sent:festival-cement-duplicate', messageId: '<campaign-2@servec321.gmail.com>' },
  ]);
  assert.deepEqual(ambiguous[0].threadMessages, []);
});

test('campaign reply service excludes duplicates and automatic replies before customer lookup', async () => {
  let lookedUpEmails = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async () => [
        {
          id: 'inbox:3',
          accountEmail: 'serve@softora.nl',
          email: 'human@example.nl',
          subject: 'Re: Kleine vraag over jullie website',
          preview: 'Dank voor je mail, maar wij hebben geen interesse.',
          date: '2026-07-23T01:00:00.000Z',
          messageId: '<human-reply@example.nl>',
        },
        {
          id: 'inbox:2',
          accountEmail: 'serve@softora.nl',
          email: 'human@example.nl',
          subject: 'Re: Kleine vraag over jullie website',
          preview: 'Dank voor je mail, maar wij hebben geen interesse.',
          date: '2026-07-23T01:00:00.000Z',
          messageId: '<human-reply@example.nl>',
        },
        {
          id: 'inbox:1',
          accountEmail: 'martijn@softora.nl',
          email: 'info@qccs.nl',
          subject: 'Afwezigheidmelding Re: Kleine vraag over jullie website',
          preview: 'Vanaf 2 juli tot en met 3 augustus 2026 is ons kantoor gesloten.',
          date: '2026-07-22T01:00:00.000Z',
          messageId: '<automatic-reply@example.nl>',
          autoSubmitted: 'auto-replied',
        },
        {
          id: 'inbox:4',
          accountEmail: 'martijn@softora.nl',
          email: 'leergeld@example.nl',
          subject: 'Nieuw Email adres Re: Kleine vraag over jullie website',
          preview: 'Beste lezer, wij hebben een nieuw e-mailadres. Dit bericht...',
          date: '2026-07-21T01:00:00.000Z',
          messageId: '<body-only-automatic-reply@example.nl>',
          autoResponseSuppress: 'All',
        },
      ],
      hydrateMessageBodies: async ({ messages }) => messages.map((message) => (
        message.id === 'inbox:4'
          ? { ...message, body: 'Dit bericht is automatisch gegenereerd.' }
          : message
      )),
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => {
        lookedUpEmails = emails;
        return [
          {
            id: 'human-customer',
            bedrijf: 'Menselijke reactie',
            email: 'human@example.nl',
            campaignType: 'webdesign',
            lastColdmailProvider: 'softora',
          },
          {
            id: 'body-only-automatic-customer',
            bedrijf: 'Automatische reactie',
            email: 'leergeld@example.nl',
            campaignType: 'webdesign',
            lastColdmailProvider: 'softora',
          },
        ];
      },
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.deepEqual(lookedUpEmails.sort(), ['human@example.nl']);
  assert.deepEqual(replies.map((message) => message.id), ['inbox:3']);
});

test('campaign reply service houdt gewijzigde onderwerpregels van een alternatief adres zichtbaar via exacte Sent-lineage', async () => {
  const parent = {
    id: 'sent:8042',
    uid: 8042,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'Contact <contact@voorbeeldbedrijf.test>',
    subject: 'Kleine vraag over jullie website',
    preview: 'Goedendag, ik heb een nieuw webdesign gemaakt.',
    date: '2026-08-01T09:00:00.000Z',
    messageId: '<campaign-8042@softora.test>',
    originalCampaignOutbound: true,
  };
  const incoming = {
    id: 'inbox:9104',
    uid: 9104,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Directie Voorbeeld Holding',
    email: 'directie@voorbeeldholding.test',
    to: 'serve@softora.nl',
    subject: 'Even terugkomend op je bericht',
    preview: 'Bel mij hierover maar even.',
    date: '2026-08-04T14:04:04.000Z',
    messageId: '<reply-9104@voorbeeldholding.test>',
    inReplyTo: parent.messageId,
    references: `<older-thread@voorbeeldbedrijf.test> ${parent.messageId}`,
  };
  let targetedLookup = null;
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? [incoming] : [],
      listMatchingMessagesForAccounts: async () => [],
      listMessagesByMessageIdsForAccounts: async (options) => {
        targetedLookup = options;
        return [parent];
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: { listCustomersByEmails: async () => [] },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'serve' });

  assert.ok(targetedLookup.messageIds.includes(parent.messageId));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, incoming.id);
  assert.equal(replies[0].campaign.customerId, '');
  assert.equal(replies[0].outreach, null);
  assert.equal(replies[0].threadCorrelationEvidence, 'exact-same-account-sent-campaign-parent');
  assert.deepEqual(replies[0].threadMessages.map((message) => message.id), [parent.id]);
});

test('campaign reply lineage vertrouwt directe In-Reply-To en alleen één ondubbelzinnige References-ouder', async () => {
  const sentParent = (id, overrides = {}) => ({
    id: `sent:${id}`,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl',
    to: `${id}@example.test`,
    subject: 'Kleine vraag over jullie website',
    date: '2026-08-01T09:00:00.000Z',
    messageId: `<${id}@softora.test>`,
    originalCampaignOutbound: true,
    ...overrides,
  });
  const directCampaignParent = sentParent('direct-campaign');
  const referencesCampaignParent = sentParent('references-campaign');
  const otherCampaignParent = sentParent('other-campaign');
  const explicitNonCampaignParent = sentParent('manual-non-campaign', {
    originalCampaignOutbound: false,
  });
  const incoming = (id, overrides = {}) => ({
    id: `inbox:${id}`,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: `${id}@example.test`,
    to: 'serve@softora.nl',
    subject: `Ander onderwerp ${id}`,
    preview: 'Los vervolgbericht.',
    date: '2026-08-04T09:00:00.000Z',
    messageId: `<${id}@example.test>`,
    ...overrides,
  });
  const incomingMessages = [
    incoming('direct-campaign', {
      inReplyTo: directCampaignParent.messageId,
      references: `${otherCampaignParent.messageId} ${directCampaignParent.messageId}`,
    }),
    incoming('references-unique', {
      references: referencesCampaignParent.messageId,
    }),
    incoming('direct-non-campaign', {
      inReplyTo: explicitNonCampaignParent.messageId,
      references: `${directCampaignParent.messageId} ${explicitNonCampaignParent.messageId}`,
    }),
    incoming('references-ambiguous', {
      references: `${directCampaignParent.messageId} ${otherCampaignParent.messageId}`,
    }),
    incoming('references-forwarded', {
      references: `${referencesCampaignParent.messageId} ${explicitNonCampaignParent.messageId}`,
    }),
    incoming('subject-fallback-forbidden', {
      inReplyTo: explicitNonCampaignParent.messageId,
    }),
  ];
  const parents = [
    directCampaignParent,
    referencesCampaignParent,
    otherCampaignParent,
    explicitNonCampaignParent,
  ];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? incomingMessages : [],
      listMatchingMessagesForAccounts: async () => [],
      listMessagesByMessageIdsForAccounts: async ({ messageIds }) => {
        const normalized = new Set(messageIds.map((value) => String(value).replace(/^<+|>+$/g, '')));
        return parents.filter((message) => (
          normalized.has(String(message.messageId).replace(/^<+|>+$/g, ''))
        ));
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: { listCustomersByEmails: async () => [] },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'serve' });
  const repliesById = new Map(replies.map((reply) => [reply.id, reply]));

  assert.deepEqual(Array.from(repliesById.keys()).sort(), [
    'inbox:direct-campaign',
    'inbox:references-unique',
  ]);
  assert.deepEqual(
    repliesById.get('inbox:direct-campaign').threadMessages.map((message) => message.id),
    [directCampaignParent.id]
  );
  assert.deepEqual(
    repliesById.get('inbox:references-unique').threadMessages.map((message) => message.id),
    [referencesCampaignParent.id]
  );
});

test('campaign reply lineage blijft dicht voor onbekende ouders andere accounts niet-campagnemail en automaten', async () => {
  const validParent = {
    id: 'sent:valid', folder: 'sent', accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl', subject: 'Kleine vraag over jullie website',
    date: '2026-08-01T09:00:00.000Z', messageId: '<valid-parent@softora.test>',
    originalCampaignOutbound: true,
  };
  const crossAccountParent = {
    ...validParent,
    id: 'sent:other-owner',
    accountEmail: 'martijn@softora.nl',
    email: 'martijn@softora.nl',
    messageId: '<other-owner-parent@softora.test>',
  };
  const nonCampaignParent = {
    ...validParent,
    id: 'sent:invoice',
    subject: 'Factuur augustus',
    messageId: '<invoice-parent@softora.test>',
    originalCampaignOutbound: false,
  };
  const base = {
    folder: 'inbox', accountEmail: 'serve@softora.nl', to: 'serve@softora.nl',
    subject: 'Ander onderwerp', preview: 'Los bericht.', date: '2026-08-04T15:00:00.000Z',
  };
  const incoming = [
    { ...base, id: 'inbox:cross', email: 'cross@example.test', messageId: '<cross@example.test>', inReplyTo: crossAccountParent.messageId },
    { ...base, id: 'inbox:unknown', email: 'unknown@example.test', messageId: '<unknown@example.test>', inReplyTo: '<missing-parent@softora.test>' },
    { ...base, id: 'inbox:invoice', email: 'invoice@example.test', messageId: '<invoice@example.test>', inReplyTo: nonCampaignParent.messageId },
    { ...base, id: 'inbox:loose', email: 'loose@example.test', messageId: '<loose@example.test>', inReplyTo: '' },
    { ...base, id: 'inbox:auto', email: 'auto@example.test', messageId: '<auto@example.test>', inReplyTo: validParent.messageId, autoSubmitted: 'auto-replied' },
    { ...base, id: 'inbox:bounce', email: 'mailer-daemon@example.test', messageId: '<bounce@example.test>', inReplyTo: validParent.messageId, subject: 'Delivery Status Notification (Failure)', autoSubmitted: 'auto-generated' },
  ];
  let requestedMessageIds = [];
  let lookedUpEmails = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? incoming : [],
      listMatchingMessagesForAccounts: async () => [],
      listMessagesByMessageIdsForAccounts: async ({ messageIds }) => {
        requestedMessageIds = messageIds;
        const normalized = new Set(messageIds.map((value) => String(value).replace(/^<+|>+$/g, '')));
        return [validParent, crossAccountParent, nonCampaignParent].filter((message) => (
          normalized.has(String(message.messageId).replace(/^<+|>+$/g, ''))
        ));
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => {
        lookedUpEmails = emails;
        return [];
      },
    },
  });

  const result = await service.listRepliesWithSnapshot({
    limit: 100,
    owner: 'serve',
    snapshotLimit: 100,
  });

  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.snapshotMessages, []);
  assert.ok(requestedMessageIds.includes(crossAccountParent.messageId));
  assert.ok(requestedMessageIds.includes(nonCampaignParent.messageId));
  assert.equal(requestedMessageIds.includes(validParent.messageId), false);
  assert.equal(lookedUpEmails.includes('auto@example.test'), false);
  assert.equal(lookedUpEmails.includes('mailer-daemon@example.test'), false);
});

test('campaign reply service koppelt een later verzonden antwoord aan dezelfde ontvangen mail', async () => {
  const requestedFolders = [];
  const requestedLimits = {};
  const inboxMessage = {
    id: 'inbox:91',
    uid: 91,
    folder: 'inbox',
    accountEmail: 'martijnven123@gmail.com',
    from: 'Seats 2 Meet Station Den Bosch',
    email: 'info@seats2meetstationdenbosch.nl',
    to: 'martijnven123@gmail.com',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Mag ik vragen waar jij het liefst je sites mee bouwt?',
    body: 'Mag ik vragen waar jij het liefst je sites mee bouwt?',
    date: '2026-07-22T15:36:00.000Z',
    messageId: '<incoming-seats2meet@example.nl>',
  };
  const sentReply = {
    id: 'sent:102',
    uid: 102,
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    from: 'Martijn van de Ven',
    email: 'martijnven123@gmail.com',
    to: 'info@seats2meetstationdenbosch.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Hoi Helma, ik bouw onze websites...',
    date: '2026-07-23T09:21:00.000Z',
    messageId: '<martijn-answer@example.nl>',
    inReplyTo: '<incoming-seats2meet@example.nl>',
    references: '<campaign-start@example.nl> <incoming-seats2meet@example.nl>',
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder, limit }) => {
        requestedFolders.push(folder);
        requestedLimits[folder] = limit;
        return folder === 'sent' ? [sentReply] : [inboxMessage];
      },
      listMatchingMessagesForAccounts: async ({ folder, limit }) => {
        requestedFolders.push(`matching:${folder}`);
        requestedLimits[`matching:${folder}`] = limit;
        return folder === 'sent' ? [sentReply] : [inboxMessage];
      },
      hydrateMessageBodies: async ({ messages }) => messages.map((message) => (
        message.id === 'sent:102'
          ? { ...message, body: 'Hoi Helma,\n\nIk bouw onze websites met maatwerk.' }
          : message
      )),
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'seats2meet',
        bedrijf: 'Seats 2 Meet Station Den Bosch',
        email: 'info@seats2meetstationdenbosch.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.deepEqual(requestedFolders.sort(), [
    'coldmail',
    'inbox',
    'matching:coldmail',
    'matching:inbox',
    'matching:sent',
  ]);
  assert.equal(requestedLimits.coldmail, CAMPAIGN_MESSAGE_SCAN_LIMIT);
  assert.equal(requestedLimits.inbox, CAMPAIGN_MESSAGE_SCAN_LIMIT);
  assert.equal(requestedLimits['matching:coldmail'], CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT);
  assert.equal(requestedLimits['matching:inbox'], CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT);
  assert.equal(requestedLimits['matching:sent'], CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].threadMessages.length, 1);
  assert.equal(replies[0].threadMessages[0].id, 'sent:102');
  assert.equal(replies[0].threadMessages[0].body, undefined);
  assert.equal(replies[0].threadMessages[0].preview, 'Hoi Helma, ik bouw onze websites...');
});

test('campaign reply service houdt vervolgreacties in één bestaande conversatie', async () => {
  const originalMessageId = '<222ba73e-2480-c995-627e-2386c4ef08da@gmail.com>';
  const firstReplyMessageId = '<first-seats-reply@mail.gmail.com>';
  const martijnReplyMessageId = '<martijn-seats-answer@mail.gmail.com>';
  const firstReply = {
    id: 'inbox:37467',
    uid: 37467,
    folder: 'inbox',
    accountEmail: 'martijnven123@gmail.com',
    from: 'Seats 2 Meet Station Den Bosch',
    email: 'info@seats2meetstationdenbosch.nl',
    to: 'martijnven123@gmail.com',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Mag ik vragen waar jij het liefst je sites mee bouwt?',
    date: '2026-07-22T15:36:03.000Z',
    messageId: firstReplyMessageId,
    inReplyTo: originalMessageId,
    references: originalMessageId,
  };
  const latestReply = {
    ...firstReply,
    id: 'inbox:37476',
    uid: 37476,
    preview: 'Dank voor je antwoord. Kun je ons daar meer over vertellen?',
    date: '2026-07-23T09:31:11.000Z',
    messageId: '<latest-seats-reply@mail.gmail.com>',
    inReplyTo: martijnReplyMessageId,
    references: `${originalMessageId} ${firstReplyMessageId} ${martijnReplyMessageId}`,
    unread: true,
  };
  const sentReply = {
    id: 'sent:656',
    uid: 656,
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    from: 'Martijn van de Ven',
    email: 'martijnven123@gmail.com',
    to: 'info@seats2meetstationdenbosch.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Hoi Helma, ik bouw onze websites met maatwerk.',
    date: '2026-07-23T09:08:10.000Z',
    messageId: martijnReplyMessageId,
    inReplyTo: firstReplyMessageId,
    references: `${originalMessageId} ${firstReplyMessageId}`,
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (
        folder === 'sent' ? [sentReply] : [latestReply, firstReply]
      ),
      listMatchingMessagesForAccounts: async ({ folder }) => (
        folder === 'sent' ? [sentReply] : [latestReply, firstReply]
      ),
      hydrateMessageBodies: async ({ messages }) => messages.map((message) => ({
        ...message,
        body: message.preview,
      })),
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'seats2meet',
        bedrijf: 'Seats 2 Meet Station Den Bosch',
        email: 'info@seats2meetstationdenbosch.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 'inbox:37476');
  assert.equal(replies[0].date, '2026-07-23T09:31:11.000Z');
  assert.equal(replies[0].unread, true);
  assert.equal(
    replies[0].conversationId,
    'conversation:martijnven123@gmail.com|222ba73e-2480-c995-627e-2386c4ef08da@gmail.com'
  );
  assert.deepEqual(
    replies[0].threadMessages.map((message) => message.id),
    ['sent:656', 'inbox:37467']
  );
  assert.equal(replies[0].threadMessages[0].folder, 'sent');
  assert.equal(replies[0].threadMessages[1].folder, 'inbox');
});

test('campaign mailbox houdt een menselijke vervolgthread heel wanneer RFC-headers halverwege ontbreken', () => {
  const originalSent = {
    id: 'sent:salon-original',
    folder: 'sent',
    accountEmail: 'serve290@gmail.com',
    email: 'serve290@gmail.com',
    to: 'Info | Salon TOF <info@salontof.nl>',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-24T12:59:00.000Z',
    messageId: '<salon-original@gmail.com>',
    originalCampaignOutbound: true,
  };
  const firstReply = {
    id: 'coldmail:4',
    folder: 'coldmail',
    accountEmail: 'serve290@gmail.com',
    from: 'Info | Salon TOF',
    email: 'info@salontof.nl',
    to: 'serve290@gmail.com',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-07-24T13:54:00.000Z',
    messageId: '<salon-first-reply@salontof.nl>',
    inReplyTo: originalSent.messageId,
    references: originalSent.messageId,
  };
  const sentFollowUp = {
    id: 'sent:salon-follow-up',
    folder: 'sent',
    accountEmail: 'serve290@gmail.com',
    email: 'serve290@gmail.com',
    to: 'Info | Salon TOF <info@salontof.nl>',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-08-01T11:42:00.000Z',
    messageId: '<salon-follow-up@gmail.com>',
    inReplyTo: '',
    references: '',
  };
  const latestReply = {
    ...firstReply,
    id: 'coldmail:237',
    date: '2026-08-01T12:35:00.000Z',
    messageId: '<salon-latest-reply@salontof.nl>',
    inReplyTo: sentFollowUp.messageId,
    references: sentFollowUp.messageId,
    unread: true,
  };

  const conversations = attachSentThreadMessages(
    [latestReply, firstReply],
    [sentFollowUp, originalSent]
  );

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, latestReply.id);
  assert.equal(conversations[0].unread, true);
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.id),
    [sentFollowUp.id, firstReply.id, originalSent.id]
  );
});

test('campaign mailbox fallback blijft fail-closed voor andere accounts contacten en onderwerpen', () => {
  const base = {
    folder: 'inbox',
    accountEmail: 'serve290@gmail.com',
    email: 'info@salontof.nl',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-08-01T12:35:00.000Z',
    inReplyTo: '',
    references: '',
  };
  const conversations = attachSentThreadMessages([
    { ...base, id: 'same-thread', messageId: '<same-thread@salontof.nl>' },
    {
      ...base,
      id: 'other-account',
      accountEmail: 'servecreusen7@gmail.com',
      messageId: '<other-account@salontof.nl>',
    },
    {
      ...base,
      id: 'other-contact',
      email: 'boekhouding@salontof.nl',
      messageId: '<other-contact@salontof.nl>',
    },
    {
      ...base,
      id: 'other-subject',
      subject: 'Re: Nieuw webdesign',
      messageId: '<other-subject@salontof.nl>',
    },
  ], []);

  assert.equal(conversations.length, 4);
  assert.deepEqual(
    new Set(conversations.map((conversation) => conversation.id)),
    new Set(['same-thread', 'other-account', 'other-contact', 'other-subject'])
  );
});

test('campaign reply service koppelt alleen exact bewezen historische vervolgreacties', async () => {
  const inboxMessage = {
    id: 'inbox:23',
    uid: 23,
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    from: 'Ralph Ruyters',
    email: 'rruyters@road2value.com',
    to: 'martijn@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Leuk dat je op deze manier marketing bedrijft.',
    date: '2026-06-15T13:58:18.000Z',
    messageId: '<ralph-reply@example.test>',
  };
  const sentMessages = [
    {
      id: 'sent:111',
      uid: 111,
      folder: 'sent',
      accountEmail: 'martijn@softora.nl',
      from: 'Martijn van de Ven',
      email: 'martijn@softora.nl',
      to: 'Ralph Ruyters <rruyters@road2value.com>',
      subject: 'Re: Kleine vraag over jullie website',
      preview: 'Hoi Ralph, dankjewel voor je reactie.',
      date: '2026-06-16T12:31:32.000Z',
      messageId: '<martijn-reply@example.test>',
      inReplyTo: '<ralph-reply@example.test>',
    },
    {
      id: 'sent:149',
      uid: 149,
      folder: 'sent',
      accountEmail: 'martijn@softora.nl',
      from: 'Martijn van de Ven',
      email: 'martijn@softora.nl',
      to: 'rruyters@road2value.com',
      subject: 'Andere onderwerpregel',
      preview: 'Hoi Ralph, misschien heb je mijn mailtje gemist.',
      date: '2026-06-23T11:32:58.000Z',
      messageId: '<martijn-followup@example.test>',
    },
  ];
  const requestedMethods = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder, limit }) => {
        requestedMethods.push([`recent:${folder}`, limit]);
        return folder === 'inbox' ? [inboxMessage] : [];
      },
      listMatchingMessagesForAccounts: async ({ folder, limit }) => {
        requestedMethods.push([`matching:${folder}`, limit]);
        return folder === 'sent' ? sentMessages : [inboxMessage];
      },
      hydrateMessageBodies: async ({ messages }) => messages.map((message) => ({
        ...message,
        body: message.preview,
      })),
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'road2value',
        bedrijf: 'Road2Value',
        email: 'rruyters@road2value.com',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.deepEqual(requestedMethods, [
    ['recent:coldmail', CAMPAIGN_MESSAGE_SCAN_LIMIT],
    ['recent:inbox', CAMPAIGN_MESSAGE_SCAN_LIMIT],
    ['matching:coldmail', CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT],
    ['matching:inbox', CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT],
    ['matching:sent', CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT],
  ]);
  assert.equal(replies.length, 1);
  assert.equal(
    replies[0].conversationId,
    'conversation:martijn@softora.nl|martijn-reply@example.test'
  );
  assert.equal(replies[0].activityAt, '2026-06-15T13:58:18.000Z');
  assert.equal(replies[0].latestOutboundAt, '2026-06-16T12:31:32.000Z');
  assert.deepEqual(
    replies[0].threadMessages.map((message) => message.id),
    ['sent:111']
  );
  assert.deepEqual(replies[0].threadMessages.map((message) => message.body), [undefined]);
});

test('campaign reply service herstelt TTV Irene via exacte forward-recipient en geciteerde bronbody', async () => {
  const originalBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website ttvirene.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const incomingBody = [
    'Beste Martijn,',
    '',
    'Bedankt voor de toelichting. Ik ontvang graag een offerte.',
    '',
    'Met vriendelijke groet,',
    'Steven van den Brink',
    'Webmaster TTV Irene',
    '',
    'From: secretaris@ttvirene.nl',
    'Sent: donderdag 16 juli 2026 19:35',
    'To: webmaster@ttvirene.nl',
    'Subject: Fwd: Kleine vraag over jullie website',
    '',
    'Verstuurd vanaf mijn iPhone',
    'Begin doorgestuurd bericht:',
    'Van: secretaris@ttvirene.nl',
    'Datum: 16 juli 2026 om 17:42:31 CEST',
    'Aan: Bas Van der Steen',
    'Onderwerp: Doorst: Kleine vraag over jullie website',
    '',
    'Begin doorgestuurd bericht:',
    'Van: Martijn van de Ven',
    'Datum: 16 juli 2026 om 11:56:48 CEST',
    'Aan: info@ttvirene.nl',
    'Onderwerp: Kleine vraag over jullie website',
    'Antwoord aan: martijn@softora.nl',
    '',
    originalBody,
  ].join('\n');
  const incoming = {
    id: 'inbox:41',
    uid: 41,
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    from: 'Steven van den Brink - Webmaster TTV Irene',
    email: 'webmaster@ttvirene.nl',
    to: 'martijn@softora.nl',
    // Exact production shape: the outer reply no longer contains Fwd/FW.
    subject: 'RE: Kleine vraag over jullie website',
    preview: 'Beste Martijn, bedankt voor de toelichting.',
    body: incomingBody,
    date: '2026-07-16T18:12:01.000Z',
    messageId: '<steven-forward@ttvirene.nl>',
    references: '<secretaris-forward@ttvirene.nl>',
  };
  const indexedIncoming = { ...incoming, body: undefined };
  const original = {
    id: 'sent:242',
    uid: 242,
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    from: 'Martijn van de Ven',
    email: 'martijn@softora.nl',
    to: 'info@ttvirene.nl',
    subject: 'Kleine vraag over jullie website',
    preview: 'Goedendag, afgelopen week kwam ik jullie website ttvirene.nl tegen.',
    body: originalBody,
    date: '2026-07-16T09:56:41.000Z',
    messageId: '<ttv-original@softora.nl>',
    originalCampaignOutbound: true,
  };
  let quotedTargets = [];
  let hydrationCalls = 0;
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [indexedIncoming] : []),
      listMatchingMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [indexedIncoming] : []),
      hydrateMessageBodies: async ({ messages }) => {
        hydrationCalls += 1;
        return messages.map((message) => (
          message.id === indexedIncoming.id ? { ...message, body: incomingBody } : message
        ));
      },
      listSentCandidatesForQuotedReplies: async ({ targets }) => {
        quotedTargets = targets;
        return [original];
      },
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'ttv-irene',
        bedrijf: 'TTV Irene',
        email: 'webmaster@ttvirene.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'martijn' });

  assert.ok(hydrationCalls >= 1);
  assert.equal(replies.length, 1);
  assert.equal(quotedTargets.some((target) => (
    target.accountEmail === 'martijn@softora.nl' &&
    target.recipientEmail === 'info@ttvirene.nl'
  )), true);
  assert.deepEqual(replies[0].threadMessages.map((message) => message.id), ['sent:242']);
  assert.equal(
    replies[0].threadMessages[0].threadCorrelationEvidence,
    'exact-account-subject-quoted-body-and-recipient'
  );
  assert.equal(replies[0].threadMessages[0].originalCampaignOutbound, true);
});

test('campaign reply service herstelt een Bossche Brouwers origineel uit een losse ONTVANGER-kop met providerartefacten', async () => {
  const originalBody = [
    'Goedendag,',
    'Afgelopen week kwam ik jullie website bosschebrouwers.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const incomingBody = [
    'Hallo Servé, leuk dat je aandacht schenkt aan ons bedrijf.',
    '',
    '-------- Oorspronkelijke bericht --------',
    'ONDERWERP:',
    'Kleine vraag over jullie website',
    'DATUM:',
    '2026-07-16 07:34',
    'AFZENDER:',
    'Servé Creusen',
    'ONTVANGER:',
    'arie@bosschebrouwers.nl',
    'ANTWOORD-AAN:',
    'servec321@gmail.com',
    'Goedendag,',
    'Afgelopen week kwam ik jullie website bosschebrouwers.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat > leuk vind.',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke > mening 😁',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via > deze link [1] bekijken 🎨',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '[1] https://www.softora.nl/webdesign/bossche-brouwers-aan-de-vaart?sender=serve',
  ].join('\n');
  const incoming = {
    id: 'inbox:bossche-brouwers',
    folder: 'inbox',
    accountEmail: 'servec321@gmail.com',
    email: 'administratie@bosschebrouwers.nl',
    to: 'servec321@gmail.com',
    subject: 'Re: Fwd: Kleine vraag over jullie website',
    preview: 'Hallo Servé, leuk dat je aandacht schenkt aan ons bedrijf.',
    body: incomingBody,
    date: '2026-07-25T07:25:00.000Z',
    messageId: '<bossche-brouwers-reply@example.nl>',
  };
  const original = {
    id: 'sent:bossche-brouwers',
    folder: 'sent',
    accountEmail: 'servec321@gmail.com',
    email: 'servec321@gmail.com',
    to: 'arie@bosschebrouwers.nl',
    subject: 'Kleine vraag over jullie website',
    body: originalBody,
    date: '2026-07-16T05:34:00.000Z',
    messageId: '<bossche-brouwers-original@gmail.com>',
    originalCampaignOutbound: true,
  };
  let quotedTargets = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [incoming] : []),
      listMatchingMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [incoming] : []),
      hydrateMessageBodies: async ({ messages }) => messages,
      listSentCandidatesForQuotedReplies: async ({ targets }) => {
        quotedTargets = targets;
        return [original];
      },
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'bossche-brouwers',
        bedrijf: 'Bossche Brouwers',
        email: 'administratie@bosschebrouwers.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'serve' });

  assert.equal(quotedTargets.some((target) => target.recipientEmail === 'arie@bosschebrouwers.nl'), true);
  assert.deepEqual(replies[0].threadMessages.map((message) => message.id), ['sent:bossche-brouwers']);
  assert.equal(
    replies[0].threadMessages[0].threadCorrelationEvidence,
    'exact-account-subject-quoted-body-and-recipient'
  );
});

test('campaign reply service koppelt forwarded originals niet bij ambiguïteit of ander account', async () => {
  const originalBody = [
    'Goedendag,',
    'Dit is een lang genoeg exact campagnebericht voor een veilige bronvergelijking.',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n\n');
  const incoming = {
    id: 'inbox:ambiguous-forward',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'webmaster@example.nl',
    to: 'martijn@softora.nl',
    subject: 'Re: Fwd: Kleine vraag over jullie website',
    date: '2026-07-16T18:12:01.000Z',
    body: [
      'Mijn echte antwoord.',
      '',
      'Begin doorgestuurd bericht:',
      'Van: Martijn van de Ven',
      'Datum: 16 juli 2026',
      'Aan: info@example.nl',
      'Onderwerp: Kleine vraag over jullie website',
      '',
      originalBody,
    ].join('\n'),
  };
  const candidate = {
    id: 'sent:a',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    email: 'martijn@softora.nl',
    to: 'info@example.nl',
    subject: 'Kleine vraag over jullie website',
    date: '2026-07-16T09:56:41.000Z',
    body: originalBody,
    messageId: '<a@softora.nl>',
    originalCampaignOutbound: true,
  };
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [incoming] : []),
      listMatchingMessagesForAccounts: async ({ folder }) => (folder === 'inbox' ? [incoming] : []),
      hydrateMessageBodies: async ({ messages }) => messages,
      listSentCandidatesForQuotedReplies: async () => [
        candidate,
        { ...candidate, id: 'sent:b', messageId: '<b@softora.nl>' },
        { ...candidate, id: 'sent:other-owner', accountEmail: 'serve@softora.nl', messageId: '<c@softora.nl>' },
      ],
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'ambiguous', bedrijf: 'Ambiguous', email: 'webmaster@example.nl',
        campaignType: 'webdesign', lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'martijn' });

  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].threadMessages, []);
});

test('campaign reply service koppelt Brigit, Karlien en Marjolein via exacte oude Sent-ouders buiten de globale scan', async () => {
  const fixtures = [
    {
      id: 'inbox:59',
      uid: 59,
      accountEmail: 'serve@softora.nl',
      from: 'Marjolein de Kroon',
      email: 'marjolein@dekroonopjewerk.eu',
      messageId: '<marjolein-reply@example.nl>',
      parentMessageId: '<marjolein-parent@softora.nl>',
      sentId: 'sent:60',
      sentUid: 60,
    },
    {
      id: 'inbox:60',
      uid: 60,
      accountEmail: 'serve@softora.nl',
      from: 'Brigit',
      email: 'info@bizzylizzy.nl',
      messageId: '<brigit-reply@example.nl>',
      parentMessageId: '<brigit-parent@softora.nl>',
      sentId: 'sent:62',
      sentUid: 62,
    },
    {
      id: 'inbox:61',
      uid: 61,
      accountEmail: 'serve@softora.nl',
      from: 'Karlien Vis',
      email: 'info@misverstant.nl',
      messageId: '<karlien-reply@example.nl>',
      parentMessageId: '<karlien-parent@softora.nl>',
      sentId: 'sent:66',
      sentUid: 66,
    },
  ];
  const inboxMessages = fixtures.map((fixture, index) => ({
    id: fixture.id,
    uid: fixture.uid,
    folder: 'inbox',
    accountEmail: fixture.accountEmail,
    from: fixture.from,
    email: fixture.email,
    to: fixture.accountEmail,
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Bedankt voor je ontwerp.',
    date: new Date(Date.UTC(2026, 5, 3, 10, index)).toISOString(),
    messageId: fixture.messageId,
    inReplyTo: fixture.parentMessageId,
    references: fixture.parentMessageId,
  }));
  const targetedSent = fixtures.map((fixture, index) => ({
    id: fixture.sentId,
    uid: fixture.sentUid,
    folder: 'sent',
    accountEmail: fixture.accountEmail,
    from: 'Servé Creusen',
    email: fixture.accountEmail,
    to: fixture.email,
    subject: 'Kleine vraag over jullie website',
    preview: 'Goedendag, afgelopen week kwam ik jullie website tegen.',
    date: new Date(Date.UTC(2026, 5, 2, 8, index)).toISOString(),
    messageId: fixture.parentMessageId,
    originalCampaignOutbound: true,
    webdesignLinkEvidenceKnown: false,
  }));
  const targetedLookups = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async () => inboxMessages,
      listMatchingMessagesForAccounts: async ({ folder }) => (
        folder === 'sent' ? [] : inboxMessages
      ),
      listMessagesByMessageIdsForAccounts: async (options) => {
        targetedLookups.push(options);
        return targetedSent;
      },
      hydrateMessageBodies: async ({ messages }) => messages.map((message) => ({
        ...message,
        body: message.preview,
      })),
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => emails.map((email) => ({
        id: email,
        bedrijf: email,
        email,
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      })),
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.equal(targetedLookups.length, 1);
  fixtures.forEach((fixture) => {
    assert.ok(targetedLookups[0].messageIds.includes(fixture.parentMessageId));
    const conversation = replies.find((message) => message.id === fixture.id);
    assert.ok(conversation);
    assert.deepEqual(conversation.threadMessages.map((message) => message.id), [fixture.sentId]);
    assert.equal(conversation.threadMessages[0].originalCampaignOutbound, true);
  });
});

test('campaign reply service laadt een latere Sent-descendant buiten de globale scan bronvast bij', async () => {
  const inbound = {
    id: 'inbox:60',
    uid: 60,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Brigit',
    email: 'info@bizzylizzy.nl',
    to: 'serve@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Bedankt voor je bericht.',
    date: '2026-06-01T14:46:38.000Z',
    messageId: '<brigit-reply@example.nl>',
    inReplyTo: '<brigit-parent@softora.nl>',
    references: '<brigit-parent@softora.nl>',
  };
  const originalOutbound = {
    id: 'sent:62',
    uid: 62,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'info@bizzylizzy.nl',
    subject: 'Kleine vraag over jullie website',
    preview: 'Goedendag,',
    date: '2026-05-31T10:33:11.000Z',
    messageId: '<brigit-parent@softora.nl>',
    originalCampaignOutbound: true,
  };
  const laterOutbound = {
    id: 'sent:71',
    uid: 71,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'info@bizzylizzy.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dankjewel voor je reactie.',
    date: '2026-06-02T11:12:14.000Z',
    messageId: '<brigit-follow-up@softora.nl>',
    inReplyTo: '<brigit-reply@example.nl>',
    references: '<brigit-parent@softora.nl>, <brigit-reply@example.nl>',
  };
  const descendantLookups = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'inbox' ? [inbound] : [],
      listMatchingMessagesForAccounts: async ({ folder }) => folder === 'sent' ? [] : [inbound],
      listMessagesByMessageIdsForAccounts: async () => [originalOutbound],
      listMessagesReferencingMessageIdsForAccounts: async (options) => {
        descendantLookups.push(options);
        assert.deepEqual(options.accountEmails, ['serve@softora.nl']);
        return options.messageIds.some((messageId) => String(messageId).includes('brigit-reply@example.nl'))
          ? [laterOutbound]
          : [];
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'bizzylizzy',
        bedrijf: 'Bizzylizzy',
        email: 'info@bizzylizzy.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'serve' });

  assert.ok(descendantLookups.length >= 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].activityAt, inbound.date);
  assert.equal(replies[0].latestInboundAt, inbound.date);
  assert.equal(replies[0].latestOutboundAt, laterOutbound.date);
  assert.deepEqual(
    replies[0].threadMessages.map((message) => message.id),
    ['sent:71', 'sent:62']
  );
});

test('campaign reply service herstelt Blue Monkey via gerichte unieke later-Sent lookup buiten de globale cap', async () => {
  const inbound = {
    id: 'coldmail:245',
    uid: 245,
    folder: 'coldmail',
    accountEmail: 'contact.venvisuals@gmail.com',
    from: 'Blue Monkey',
    email: 'info@blue-monkey.nl',
    to: 'contact.venvisuals@gmail.com',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dat klinkt goed.',
    date: '2026-06-25T11:27:19.000Z',
    messageId: '<blue-inbound@example.nl>',
    inReplyTo: '<blue-june-outbound@example.nl>',
    references: '<blue-original@example.nl> <blue-june-outbound@example.nl>',
  };
  const laterSent = {
    id: 'sent:216',
    uid: 216,
    folder: 'sent',
    accountEmail: 'contact.venvisuals@gmail.com',
    from: 'Martijn van de Ven',
    email: 'contact.venvisuals@gmail.com',
    to: 'info@blue-monkey.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dankjewel voor je reactie.',
    date: '2026-08-05T16:26:02.000Z',
    messageId: '<4647162d-bc58-4cd7-e0bb-50c7d1e00675@gmail.com>',
    inReplyTo: '',
    references: '',
  };
  const targetedCalls = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => folder === 'sent' ? [] : [inbound],
      listMatchingMessagesForAccounts: async ({ folder }) => folder === 'sent' ? [] : [inbound],
      listMessagesByMessageIdsForAccounts: async () => [],
      listUnthreadedSentCandidatesForConversations: async ({ targets }) => {
        targetedCalls.push(targets);
        return [{ targetConversationId: targets[0].conversationId, message: laterSent }];
      },
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async () => [{
        id: 'blue-monkey',
        bedrijf: 'Blue Monkey',
        email: 'info@blue-monkey.nl',
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      }],
    },
  });

  const replies = await service.listReplies({ limit: 100, owner: 'martijn' });

  assert.equal(targetedCalls.length, 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].latestOutboundAt, laterSent.date);
  assert.equal(replies[0].threadMessages[0].id, 'sent:216');
  assert.equal(
    replies[0].threadMessages[0].threadCorrelationEvidence,
    'unique-account-counterparty-subject-later-sent'
  );
});

test('targeted later-Sent recovery fails closed when two same-thread candidates exist', () => {
  const conversation = {
    id: 'inbox:1',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'lead@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-06-01T10:00:00.000Z',
    messageId: '<inbound@example.nl>',
    conversationId: 'conversation:serve@softora.nl|inbound@example.nl',
    threadMessages: [],
  };
  const candidate = {
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    email: 'serve@softora.nl',
    to: 'lead@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    date: '2026-06-02T10:00:00.000Z',
    inReplyTo: '',
    references: '',
  };
  const [result] = attachTargetedUnthreadedSentMessages([conversation], [{
    targetConversationId: conversation.conversationId,
    message: { ...candidate, id: 'sent:1', messageId: '<sent-1@example.nl>' },
  }, {
    targetConversationId: conversation.conversationId,
    message: { ...candidate, id: 'sent:2', messageId: '<sent-2@example.nl>' },
  }]);

  assert.deepEqual(result.threadMessages, []);
});

test('campaign reply service hydrateert alleen de zichtbare conversatieroots en niet alle threadbodies', async () => {
  const hydratedIds = [];
  const replies = Array.from({ length: 140 }, (_item, index) => ({
    id: `inbox:${index + 1}`,
    uid: index + 1,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: `lead-${index + 1}@example.nl`,
    subject: 'Re: Kleine vraag over jullie website',
    preview: `Reactie ${index + 1}`,
    date: new Date(Date.UTC(2026, 6, 24, 12, index % 60)).toISOString(),
    messageId: `<reply-${index + 1}@example.nl>`,
  }));
  const sent = replies.flatMap((reply, index) => Array.from({ length: 12 }, (_item, threadIndex) => ({
    id: `sent:${index + 1}-${threadIndex + 1}`,
    folder: 'sent',
    accountEmail: reply.accountEmail,
    to: reply.email,
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Grote historische body blijft ongehydrateerd.',
    body: '',
    messageId: `<sent-${index + 1}-${threadIndex + 1}@example.nl>`,
    inReplyTo: reply.messageId,
    references: reply.messageId,
    date: new Date(Date.UTC(2026, 6, 25, threadIndex, 0)).toISOString(),
  })));
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async () => replies,
      listMatchingMessagesForAccounts: async ({ folder }) => (folder === 'sent' ? sent : replies),
      hydrateMessageBodies: async ({ messages }) => {
        hydratedIds.push(...messages.map((message) => message.id));
        return messages.map((message) => ({ ...message, body: `Volledig ${message.id}` }));
      },
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => emails.map((email) => ({
        id: email,
        bedrijf: email,
        email,
        campaignType: 'webdesign',
        lastColdmailProvider: 'softora',
      })),
    },
  });

  const messages = await service.listReplies({ limit: 100 });

  assert.equal(messages.length, 100);
  assert.equal(hydratedIds.length, 100);
  assert.ok(hydratedIds.every((id) => id.startsWith('inbox:')));
  assert.ok(messages.every((message) => message.threadMessages.length === 12));
  assert.ok(messages.every((message) => message.threadMessages.every((thread) => !thread.body)));
});
