const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_INCOMING_FOLDERS,
  CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
  attachCrossAccountMailboxCopies,
  attachSentThreadMessages,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  isAutomatedCampaignReply,
} = require('../../server/services/mailbox-campaign-replies');

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
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: async ({ folder }) => (
        folder === 'coldmail'
          ? [filteredBounce, filteredReply, labeledOwnSent]
          : [staleInboxCopy]
      ),
      listMatchingMessagesForAccounts: async ({ folder }) => (
        folder === 'coldmail'
          ? [filteredReply, labeledOwnSent]
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
  assert.equal(conversations[0].activityAt, '2026-06-10T08:00:00.000Z');
});

test('campaign mailbox recognizes strong automatic reply signals without hiding normal replies', () => {
  assert.equal(isAutomatedCampaignReply({
    subject: 'Afwezigheidmelding Re: Kleine vraag over jullie website',
    preview: 'Vanaf 2 juli tot en met 3 augustus 2026 is ons kantoor gesloten.',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dit is een automatisch bericht van onze website.',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dit is een automatisch email van info@sushidetoren.com.',
    body: 'We hebben uw email in goede orde ontvangen en proberen uw email binnen 24 uur te beantwoorden.',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Automatisch antwoorden: Nieuw webdesign gemaakt!',
    preview: 'Hartelijk dank voor je email.',
    body: 'Ik streef er naar om deze binnen 2 werkdagen te beantwoorden.',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: '[Serviceaanvraag ontvangen] Kleine vraag over jullie website',
    preview: '##- Please type your reply above this line -##',
    body: 'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
  }), true);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Re: [Serviceaanvraag ontvangen] Kleine vraag over jullie website',
    preview: 'Dank voor het ontwerp. Kun je de preview doorsturen?',
    body: [
      'Dank voor het ontwerp. Kun je de preview doorsturen?',
      '',
      'On Tue, 29 Jul 2026, helpdesknl@sbsupply.eu wrote:',
      'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
    ].join('\n'),
  }), false);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Vraag over automatisch antwoorden in Gmail',
    preview: 'Kun je uitleggen hoe ik dit zelf instel?',
  }), false);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dank voor je mail. De automatische e-mail op onze website werkt inderdaad nog niet goed.',
  }), false);
  assert.equal(isAutomatedCampaignReply({
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dank voor je ontwerp. Wij werken al met een andere partij en hebben geen interesse.',
  }), false);
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
        },
        {
          id: 'inbox:4',
          accountEmail: 'martijn@softora.nl',
          email: 'leergeld@example.nl',
          subject: 'Nieuw Email adres Re: Kleine vraag over jullie website',
          preview: 'Beste lezer, wij hebben een nieuw e-mailadres. Dit bericht...',
          date: '2026-07-21T01:00:00.000Z',
          messageId: '<body-only-automatic-reply@example.nl>',
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

  assert.deepEqual(lookedUpEmails.sort(), ['human@example.nl', 'leergeld@example.nl']);
  assert.deepEqual(replies.map((message) => message.id), ['inbox:3']);
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
  assert.equal(replies[0].activityAt, '2026-06-16T12:31:32.000Z');
  assert.deepEqual(
    replies[0].threadMessages.map((message) => message.id),
    ['sent:111']
  );
  assert.deepEqual(replies[0].threadMessages.map((message) => message.body), [undefined]);
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
