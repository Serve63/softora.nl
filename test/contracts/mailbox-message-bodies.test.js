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
    getProviderAccount(accountEmail) {
      const email = String(accountEmail || '').trim().toLowerCase();
      return email === 'serve@websoftora.com' ? { email, owner: 'serve' } : null;
    },
    canUseMailboxIndex: () => true,
    assertMailboxMessageVisible: (message) => message,
    normalizeFolder: (value) => {
      const folder = String(value || 'inbox').trim().toLowerCase() || 'inbox';
      return ['inbox', 'sent', 'coldmail'].includes(folder) ? folder : 'inbox';
    },
    mailboxIndexStore: {
      async getMessage({ accountEmail, folder, id }) {
        if (
          accountEmail === 'serve@websoftora.com' &&
          folder === 'instantly' &&
          id === 'instantly:abc-123'
        ) {
          return { id, accountEmail, folder, body: 'Exact detailbericht.' };
        }
        return null;
      },
      async hydrateMessageBodies({ messages }) {
        return messages.map((message) => ({
          ...message,
          bodyResolved: true,
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
          to: message.id === 'sent:42' ? 'klant@example.nl' : 'serve@softora.nl',
          toDisplay: message.id === 'sent:42'
            ? 'Klant <klant@example.nl>'
            : 'Servé Creusen <serve@softora.nl>',
          cc: message.id === 'sent:42' ? 'boekhouder@example.nl' : '',
          bcc: '',
          deliveredTo: message.id === 'sent:42' ? '' : 'serve@softora.nl',
          recipientRoutingEvidenceKnown: true,
          attachments: message.id === 'sent:42'
            ? [{ filename: 'ontwerp.pdf', contentType: 'application/pdf', size: 2048 }]
            : [],
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
      uidValidity: 222,
    }, {
      account: 'serve@softora.nl',
      folder: 'inbox',
      uid: 43,
      uidValidity: 222,
      id: 'inbox:43',
    }],
  });

  assert.deepEqual(messages, [{
    id: 'sent:42',
    uid: 42,
    uidValidity: 222,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    resolved: true,
    body: 'Volledige inhoud voor sent:42',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 2,
    originalCampaignOutbound: true,
    webdesignLinkEvidenceKnown: true,
    webdesignLinkUrl: 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1',
    to: 'klant@example.nl',
    toDisplay: 'Klant <klant@example.nl>',
    cc: 'boekhouder@example.nl',
    bcc: '',
    deliveredTo: '',
    recipientRoutingEvidenceKnown: true,
    attachments: [{ filename: 'ontwerp.pdf', contentType: 'application/pdf', size: 2048 }],
  }, {
    id: 'inbox:43',
    uid: 43,
    uidValidity: 222,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    resolved: true,
    body: 'Volledige inhoud voor inbox:43',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 0,
    originalCampaignOutbound: false,
    webdesignLinkEvidenceKnown: false,
    webdesignLinkUrl: '',
    to: 'serve@softora.nl',
    toDisplay: 'Servé Creusen <serve@softora.nl>',
    cc: '',
    bcc: '',
    deliveredTo: 'serve@softora.nl',
    recipientRoutingEvidenceKnown: true,
    attachments: [],
  }]);
});

test('mailbox detail leest Instantly uitsluitend uit de providerindex', async () => {
  const service = createService();

  assert.deepEqual(
    await service.getInstantlyMessage({
      accountEmail: 'serve@websoftora.com',
      id: 'instantly:abc-123',
    }),
    {
      id: 'instantly:abc-123',
      accountEmail: 'serve@websoftora.com',
      folder: 'instantly',
      body: 'Exact detailbericht.',
    }
  );
  await assert.rejects(
    service.getInstantlyMessage({ accountEmail: 'serve@websoftora.com', id: 'instantly:missing' }),
    (error) => error && error.status === 404
  );
  await assert.rejects(
    service.getInstantlyMessage({ accountEmail: 'serve@websoftora.com', id: 'sent:42' }),
    (error) => error && error.status === 400
  );
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
  await assert.rejects(
    service.getMessageBodies({
      messages: [{ account: 'serve@softora.nl', id: 'inbox:42' }],
    }),
    (error) => error && error.status === 409 && error.code === 'MAILBOX_UIDVALIDITY_REQUIRED'
  );
});

test('mailbox body batch hydrateert Instantly via exact provideraccount en provider-id', async () => {
  const service = createService();

  const messages = await service.getMessageBodies({
    messages: [{
      account: 'SERVE@WEBSOFTORA.COM',
      folder: 'INSTANTLY',
      id: 'instantly:abc-123',
    }],
  });

  assert.deepEqual(messages, [{
    id: 'instantly:abc-123',
    uid: 0,
    uidValidity: 0,
    folder: 'instantly',
    accountEmail: 'serve@websoftora.com',
    resolved: true,
    body: 'Volledige inhoud voor instantly:abc-123',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 0,
    originalCampaignOutbound: false,
    webdesignLinkEvidenceKnown: false,
    webdesignLinkUrl: '',
    to: 'serve@softora.nl',
    toDisplay: 'Servé Creusen <serve@softora.nl>',
    cc: '',
    bcc: '',
    deliveredTo: 'serve@softora.nl',
    recipientRoutingEvidenceKnown: true,
    attachments: [],
  }]);

  await assert.rejects(
    service.getMessageBodies({
      messages: [{ account: 'unknown@websoftora.com', folder: 'instantly', id: 'instantly:abc-123' }],
    }),
    (error) => error && error.status === 404
  );
  await assert.rejects(
    service.getMessageBodies({
      messages: [{ account: 'serve@websoftora.com', folder: 'instantly', id: 'inbox:42' }],
    }),
    (error) => error && error.status === 400
  );
});
