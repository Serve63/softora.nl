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
      return ['inbox', 'sent', 'coldmail', 'allmail'].includes(folder) ? folder : 'inbox';
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
          attachmentEvidenceKnown: true,
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
    resolved: true,
    requestMessageId: '',
    providerMessageIdLookup: false,
    providerLookupRetryable: false,
    body: 'Volledige inhoud voor sent:42',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    bodyImages: [],
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
    attachmentEvidenceKnown: true,
    attachments: [{ filename: 'ontwerp.pdf', contentType: 'application/pdf', size: 2048 }],
    optOutUrl: '',
  }, {
    id: 'inbox:43',
    uid: 43,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    resolved: true,
    requestMessageId: '',
    providerMessageIdLookup: false,
    providerLookupRetryable: false,
    body: 'Volledige inhoud voor inbox:43',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    bodyImages: [],
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
    attachmentEvidenceKnown: true,
    attachments: [],
    optOutUrl: '',
  }]);
});

test('mailbox detailresponse logt alleen veilige correlatie en gerichte timing', async () => {
  const logs = [];
  const headers = {};
  const service = createService({ logger: { info: (line) => logs.push(line), error: (line) => logs.push(line) } });
  const response = {
    statusCode: 0,
    body: null,
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await service.getMessageBodiesResponse({
    headers: { 'x-mailbox-request-id': 'detail-equans-safe-1' },
    body: { messages: [{ account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42' }] },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(headers['x-mailbox-request-id'], 'detail-equans-safe-1');
  assert.match(headers['server-timing'], /^mailbox-detail;dur=\d+$/);
  assert.match(logs[0], /"source":"index-targeted"/);
  assert.match(logs[0], /"resolved":1/);
  assert.doesNotMatch(logs.join('\n'), /serve@softora\.nl|Volledige inhoud/);
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
      messages: [{
        account: 'serve@softora.nl',
        folder: 'sent',
        id: '',
        messageId: '<unproven@example.test>',
      }],
    }),
    (error) => error && error.status === 400
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
    folder: 'instantly',
    accountEmail: 'serve@websoftora.com',
    resolved: true,
    requestMessageId: '',
    providerMessageIdLookup: false,
    providerLookupRetryable: false,
    body: 'Volledige inhoud voor instantly:abc-123',
    hasBody: true,
    bodyTruncated: false,
    bodyImageEvidenceKnown: true,
    bodyImages: [],
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
    attachmentEvidenceKnown: true,
    attachments: [],
    optOutUrl: '',
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

test('UID-loze bewezen Sent-root hydrateert exact op Message-ID via Sent en daarna All Mail', async () => {
  const calls = [];
  const requestedMessageId = '<5A61FA42-RuUd@GMAIL.COM>';
  const exactUrl = 'https://www.softora.nl/webdesign/ruud-bos?cid=ruud-1&sender=martijn';
  const attachments = [{
    filename: 'webdesign-ruud-bos.pdf',
    contentType: 'application/pdf',
    size: 48123,
  }];
  const service = createService({
    assertReadableAccount(accountEmail) {
      const email = String(accountEmail || '').trim().toLowerCase();
      assert.equal(email, 'martijn@softora.nl');
      return { email };
    },
    mailboxIndexStore: {
      async hydrateMessageBodies() {
        assert.fail('Een UID-loze Message-ID-root mag niet via de UID-index worden gehydrateerd.');
      },
    },
    async fetchMessagesFromImap(options) {
      calls.push(options);
      if (options.folder === 'sent') return [];
      return [{
        id: 'allmail:912',
        uid: 912,
        folder: 'allmail',
        messageId: '<5a61fa42-ruud@gmail.com>',
        body: 'Dit is de echte MIME-body met de previewlink en bijlage.',
        hasBody: true,
        bodyTruncated: false,
        bodyImageEvidenceKnown: true,
        bodyImages: [{ alt: 'Preview', dataUrl: '/api/mailbox/message-image?id=allmail%3A912&index=0' }],
        embeddedImageCount: 1,
        originalCampaignOutbound: true,
        webdesignLinkEvidenceKnown: true,
        webdesignLinkUrl: exactUrl,
        recipientRoutingEvidenceKnown: true,
        to: 'ruud@example.nl',
        toDisplay: 'Ruud Bos <ruud@example.nl>',
        attachmentEvidenceKnown: true,
        attachments,
      }];
    },
  });

  const [message] = await service.getMessageBodies({
    messages: [{
      account: 'martijn@softora.nl',
      folder: 'sent',
      id: 'accepted-sent:<5A61FA42-RuUd@GMAIL.COM>',
      messageId: requestedMessageId,
      providerMessageIdHydrationEligible: true,
    }],
  });

  assert.deepEqual(calls.map((call) => call.folder), ['sent', 'allmail']);
  assert.equal(calls.every((call) => call.account.email === 'martijn@softora.nl'), true);
  assert.equal(calls.every((call) => call.targetedOnly === true), true);
  assert.equal(calls.every((call) => call.exactMessageIdOnly === true), true);
  assert.equal(calls.every((call) => call.limit === 2), true);
  assert.equal(calls.every((call) => call.imapOperationTimeoutMs === 18_000), true);
  assert.deepEqual(calls.map((call) => call.threadReferenceIds), [
    [requestedMessageId],
    [requestedMessageId],
  ]);
  assert.equal(message.resolved, true);
  assert.equal(message.accountEmail, 'martijn@softora.nl');
  assert.equal(message.requestMessageId, requestedMessageId);
  assert.equal(message.providerMessageIdLookup, true);
  assert.equal(message.providerLookupRetryable, false);
  assert.equal(message.body, 'Dit is de echte MIME-body met de previewlink en bijlage.');
  assert.equal(message.webdesignLinkEvidenceKnown, true);
  assert.equal(message.webdesignLinkUrl, exactUrl);
  assert.equal(message.attachmentEvidenceKnown, true);
  assert.deepEqual(message.attachments, attachments);
  assert.deepEqual(message.bodyImages, [{
    alt: 'Preview',
    dataUrl: '/api/mailbox/message-image?id=allmail%3A912&index=0',
  }]);
});

test('tijdelijk onopgeloste Message-ID-providerlookup blijft retryable en probeert beide Gmail-mappen', async () => {
  const calls = [];
  const service = createService({
    mailboxIndexStore: {
      async hydrateMessageBodies() {
        assert.fail('Een UID-loze Message-ID-root mag niet via de UID-index worden gehydrateerd.');
      },
    },
    async fetchMessagesFromImap(options) {
      calls.push(options);
      if (options.folder === 'sent') {
        const error = new Error('IMAP-operatie timeout na 18000ms');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return [];
    },
    logger: { warn() {} },
  });

  const [message] = await service.getMessageBodies({
    messages: [{
      account: 'serve@softora.nl',
      folder: 'sent',
      id: '',
      messageId: '<retry-root@GMAIL.COM>',
      providerMessageIdHydrationEligible: true,
    }],
  });

  assert.deepEqual(calls.map((call) => call.folder), ['sent', 'allmail']);
  assert.equal(message.resolved, false);
  assert.equal(message.requestMessageId, '<retry-root@GMAIL.COM>');
  assert.equal(message.providerMessageIdLookup, true);
  assert.equal(message.providerLookupRetryable, true);
  assert.equal(message.attachmentEvidenceKnown, false);
  assert.deepEqual(message.attachments, []);
});

test('permanente providerfout blijft terminal en wordt niet als tijdelijke retry gemarkeerd', async () => {
  const service = createService({
    async fetchMessagesFromImap() {
      const error = new Error('Authentication failed');
      error.code = 'EAUTH';
      error.status = 401;
      throw error;
    },
    logger: { warn() {} },
  });

  const [message] = await service.getMessageBodies({
    messages: [{
      account: 'serve@softora.nl',
      folder: 'sent',
      id: '',
      messageId: '<permanent-root@example.test>',
      providerMessageIdHydrationEligible: true,
    }],
  });

  assert.equal(message.resolved, false);
  assert.equal(message.providerLookupRetryable, false);
});

test('dubbele exacte Message-ID-providerresultaten worden terminal geweigerd', async () => {
  const calls = [];
  const service = createService({
    async fetchMessagesFromImap(options) {
      calls.push(options);
      return [71, 72].map((uid) => ({
        id: `sent:${uid}`,
        uid,
        folder: 'sent',
        messageId: '<duplicate-root@example.test>',
        body: `Dubbel ${uid}`,
        bodyResolved: true,
      }));
    },
    logger: { warn() {} },
  });

  const [message] = await service.getMessageBodies({
    messages: [{
      account: 'serve@softora.nl',
      folder: 'sent',
      id: '',
      messageId: '<duplicate-root@example.test>',
      providerMessageIdHydrationEligible: true,
    }],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 2);
  assert.equal(message.resolved, false);
  assert.equal(message.providerLookupRetryable, false);
});

test('Message-ID-providerhydratie is per batch begrensd tot één echte IMAP-lookup', async () => {
  const calls = [];
  const service = createService({
    mailboxIndexStore: {
      async hydrateMessageBodies() {
        assert.fail('UID-loze Message-ID-roots mogen niet via de UID-index worden gehydrateerd.');
      },
    },
    async fetchMessagesFromImap(options) {
      calls.push(options);
      return [];
    },
  });

  const messages = await service.getMessageBodies({
    messages: [{
      account: 'serve@softora.nl', folder: 'sent', id: '', messageId: '<first@example.test>', providerMessageIdHydrationEligible: true,
    }, {
      account: 'serve@softora.nl', folder: 'sent', id: '', messageId: '<second@example.test>', providerMessageIdHydrationEligible: true,
    }],
  });

  assert.deepEqual(calls.map((call) => call.threadReferenceIds), [
    ['<first@example.test>'],
    ['<first@example.test>'],
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages.every((message) => message.resolved === false), true);
  assert.deepEqual(messages.map((message) => message.providerLookupRetryable), [false, true]);
  assert.deepEqual(messages.map((message) => message.requestMessageId), [
    '<first@example.test>',
    '<second@example.test>',
  ]);
});
