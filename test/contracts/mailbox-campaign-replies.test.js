const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  isAutomatedCampaignReply,
} = require('../../server/services/mailbox-campaign-replies');

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
    preview: 'Dank voor je ontwerp. Wij werken al met een andere partij en hebben geen interesse.',
  }), false);
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

  assert.deepEqual(requestedFolders.sort(), ['inbox', 'sent']);
  assert.equal(requestedLimits.inbox, CAMPAIGN_MESSAGE_SCAN_LIMIT);
  assert.equal(requestedLimits.sent, CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].threadMessages.length, 1);
  assert.equal(replies[0].threadMessages[0].id, 'sent:102');
  assert.equal(replies[0].threadMessages[0].body, 'Hoi Helma,\n\nIk bouw onze websites met maatwerk.');
});
