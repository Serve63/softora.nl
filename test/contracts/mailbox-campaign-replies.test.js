const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
      ],
      hydrateMessageBodies: async ({ messages }) => messages,
    },
    dataOpsStore: {
      listCustomersByEmails: async ({ emails }) => {
        lookedUpEmails = emails;
        return [{
          id: 'human-customer',
          bedrijf: 'Menselijke reactie',
          email: 'human@example.nl',
          campaignType: 'webdesign',
          lastColdmailProvider: 'softora',
        }];
      },
    },
  });

  const replies = await service.listReplies({ limit: 100 });

  assert.deepEqual(lookedUpEmails, ['human@example.nl']);
  assert.deepEqual(replies.map((message) => message.id), ['inbox:3']);
});
