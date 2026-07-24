const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MAILBOX_BODY_BATCH_SIZE,
  createMailboxMessageBodiesService,
} = require('../../server/services/mailbox-message-bodies');

function createService(overrides = {}) {
  return createMailboxMessageBodiesService({
    assertReadableAccount(accountEmail) {
      const email = String(accountEmail || '').trim().toLowerCase();
      if (email !== 'serve@softora.nl') {
        const error = new Error('Mailbox-account niet gevonden.');
        error.status = 404;
        throw error;
      }
      return { email };
    },
    normalizeFolder: (value) => String(value || 'inbox').trim().toLowerCase() || 'inbox',
    mailboxIndexStore: {
      async hydrateMessageBodies({ messages }) {
        return messages.map((message) => ({
          ...message,
          body: `Volledige inhoud voor ${message.id}`,
          hasBody: true,
          bodyTruncated: false,
          bodyImageEvidenceKnown: true,
          embeddedImageCount: message.id === 'sent:42' ? 2 : 0,
          originalCampaignOutbound: message.id === 'sent:42',
          webdesignLinkEvidenceKnown: message.id === 'sent:42',
          webdesignLinkUrl: message.id === 'sent:42'
            ? 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1'
            : '',
        }));
      },
    },
    ...overrides,
  });
}

test('mailbox body batch hydrateert alleen de expliciet zichtbare berichtreferenties', async () => {
  const service = createService();

  const messages = await service.getMessageBodies({
    messages: [{
      account: 'SERVE@SOFTORA.NL',
      folder: 'SENT',
      id: 'sent:42',
    }, {
      account: 'serve@softora.nl',
      folder: 'inbox',
      uid: 43,
      id: 'inbox:43',
    }],
  });

  assert.deepEqual(messages, [{
    id: 'sent:42',
    uid: 42,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    body: 'Volledige inhoud voor sent:42',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 2,
    originalCampaignOutbound: true,
    webdesignLinkEvidenceKnown: true,
    webdesignLinkUrl: 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1',
  }, {
    id: 'inbox:43',
    uid: 43,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    body: 'Volledige inhoud voor inbox:43',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 0,
    originalCampaignOutbound: false,
    webdesignLinkEvidenceKnown: false,
    webdesignLinkUrl: '',
  }]);
});

test('mailbox body batch weigert onbegrensde, ongeldige en onbevoegde requests', async () => {
  const service = createService();

  await assert.rejects(
    service.getMessageBodies({ messages: [] }),
    (error) => error && error.status === 400
  );
  await assert.rejects(
    service.getMessageBodies({
      messages: Array.from({ length: MAX_MAILBOX_BODY_BATCH_SIZE + 1 }, (_, index) => ({
        account: 'serve@softora.nl',
        id: `inbox:${index + 1}`,
      })),
    }),
    (error) => error && error.status === 400
  );
  await assert.rejects(
    service.getMessageBodies({
      messages: [{ account: 'martijn@softora.nl', id: 'inbox:42' }],
    }),
    (error) => error && error.status === 404
  );
  await assert.rejects(
    service.getMessageBodies({
      messages: [{ account: 'serve@softora.nl', id: 'geen-uid' }],
    }),
    (error) => error && error.status === 400
  );
});
