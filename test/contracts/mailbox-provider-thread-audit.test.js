const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxProviderThreadAuditService,
  selectConnectedMessages,
  toSafeInventory,
} = require('../../server/services/mailbox-provider-thread-audit');

const ACCOUNT = 'servecreusen@softora.nl';
const PARTICIPANT = 'info@hoogstambrigade-hetgroenewoud.nl';
const OUTBOUND_ID = '<outbound@softora.nl>';
const INBOUND_ID = '<inbound@hoogstambrigade-hetgroenewoud.nl>';

function outbound(overrides = {}) {
  return {
    id: 'sent:147',
    uid: 147,
    folder: 'sent',
    email: ACCOUNT,
    to: PARTICIPANT,
    messageId: OUTBOUND_ID,
    inReplyTo: '',
    references: '',
    date: '2026-07-03T12:48:22.000Z',
    body: 'not returned',
    hasBody: true,
    bodyTruncated: false,
    ...overrides,
  };
}

function inbound(folder = 'inbox', uid = 16, overrides = {}) {
  return {
    id: `${folder}:${uid}`,
    uid,
    folder,
    email: PARTICIPANT,
    to: ACCOUNT,
    messageId: INBOUND_ID,
    inReplyTo: OUTBOUND_ID,
    references: OUTBOUND_ID,
    date: '2026-07-04T07:34:59.000Z',
    body: 'not returned',
    hasBody: true,
    bodyTruncated: false,
    ...overrides,
  };
}

function createService({ providerByFolder, indexedByFolder } = {}) {
  const calls = [];
  const service = createMailboxProviderThreadAuditService({
    assertReadableAccount(accountEmail) {
      assert.equal(accountEmail, ACCOUNT);
      return { email: ACCOUNT, imapConfigured: true };
    },
    async fetchMessagesFromImap(options) {
      calls.push(options);
      return providerByFolder?.[options.folder] || [];
    },
    isValidEmail(value) {
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    },
    logger: { info() {}, error() {} },
    mailboxIndexStore: {
      async listMessagesForAccounts({ accountEmails, folder, limit }) {
        assert.deepEqual(accountEmails, [ACCOUNT]);
        assert.equal(limit, 2000);
        return indexedByFolder?.[folder] || [];
      },
    },
  });
  return { service, calls };
}

test('targeted provider audit proves the two-message thread and dedupes Inbox/Coldmail copies', async () => {
  const { service, calls } = createService({
    indexedByFolder: {
      inbox: [inbound()],
      coldmail: [inbound('coldmail', 10)],
      sent: [outbound()],
    },
    providerByFolder: {
      inbox: [inbound()],
      coldmail: [inbound('coldmail', 10)],
      sent: [outbound()],
    },
  });

  const result = await service.auditProviderThread({ accountEmail: ACCOUNT, participantEmail: PARTICIPANT, anchorMessageId: INBOUND_ID });

  assert.deepEqual(result.counts, { indexCopies: 3, indexUnique: 2, providerCopies: 3, providerUnique: 2 });
  assert.equal(result.comparison.matches, true);
  assert.deepEqual(result.comparison.missingInIndex, []);
  assert.deepEqual(result.comparison.missingInProvider, []);
  assert.deepEqual(calls.map((call) => call.folder), ['inbox', 'coldmail', 'sent']);
  assert.ok(calls.every((call) => call.account.email === ACCOUNT));
  assert.ok(calls.every((call) => call.limit === 100 && call.prioritizeTargetedUids === true));
  assert.ok(calls.every((call) => call.threadRecipientTerms.length === 1 && call.threadRecipientTerms[0] === PARTICIPANT));
  assert.ok(calls.every((call) => call.threadReferenceIds.includes(OUTBOUND_ID.toLowerCase())));
  assert.ok(calls.every((call) => call.threadReferenceIds.includes(INBOUND_ID.toLowerCase())));
  assert.ok(result.providerInventory.every((message) => !Object.hasOwn(message, 'body') && !Object.hasOwn(message, 'preview')));
});

test('provider audit reports a truly missing provider message instead of claiming a match', async () => {
  const { service } = createService({
    indexedByFolder: { inbox: [inbound()], coldmail: [], sent: [outbound()] },
    providerByFolder: { inbox: [inbound()], coldmail: [], sent: [] },
  });

  const result = await service.auditProviderThread({ accountEmail: ACCOUNT, participantEmail: PARTICIPANT, anchorMessageId: INBOUND_ID });

  assert.equal(result.comparison.matches, false);
  assert.deepEqual(result.comparison.missingInProvider, [OUTBOUND_ID]);
  assert.deepEqual(result.comparison.missingInIndex, []);
});

test('provider audit validates the exact participant before opening IMAP', async () => {
  const { service, calls } = createService({ indexedByFolder: {}, providerByFolder: {} });
  await assert.rejects(
    service.auditProviderThread({ accountEmail: ACCOUNT, participantEmail: 'not-an-email', anchorMessageId: INBOUND_ID }),
    /geldig extern e-mailadres/
  );
  assert.equal(calls.length, 0);
});

test('thread selection uses the anchor chain and excludes unrelated mail from the same participant', () => {
  const secondReply = inbound('inbox', 17, {
    email: 'alias@example.org',
    to: ACCOUNT,
    messageId: '<second-reply@example.org>',
    inReplyTo: INBOUND_ID,
    references: `${OUTBOUND_ID} ${INBOUND_ID}`,
  });
  const unrelatedSameSubject = inbound('inbox', 18, {
    email: PARTICIPANT,
    to: ACCOUNT,
    messageId: '<unrelated@example.org>',
    inReplyTo: '',
    references: '',
  });
  const selected = selectConnectedMessages(
    [outbound(), inbound(), secondReply, unrelatedSameSubject],
    PARTICIPANT,
    [INBOUND_ID]
  );
  assert.deepEqual(selected.map((message) => message.messageId), [OUTBOUND_ID, INBOUND_ID, '<second-reply@example.org>']);
});

test('provider audit requires an exact indexed anchor before opening IMAP', async () => {
  const { service, calls } = createService({ indexedByFolder: { inbox: [inbound()] }, providerByFolder: {} });
  await assert.rejects(
    service.auditProviderThread({
      accountEmail: ACCOUNT,
      participantEmail: PARTICIPANT,
      anchorMessageId: '<unrelated@example.org>',
    }),
    /ankerbericht hoort niet bij/
  );
  assert.equal(calls.length, 0);
});

test('safe inventory exposes boundaries and status but never mail content or addresses', () => {
  const inventory = toSafeInventory([outbound(), inbound()], { accountEmail: ACCOUNT, provider: 'imap-live' });
  assert.equal(inventory.length, 2);
  for (const message of inventory) {
    assert.ok(['inbound', 'outbound'].includes(message.direction));
    assert.equal(Object.hasOwn(message, 'body'), false);
    assert.equal(Object.hasOwn(message, 'preview'), false);
    assert.equal(Object.hasOwn(message, 'from'), false);
    assert.equal(Object.hasOwn(message, 'to'), false);
    assert.equal(Object.hasOwn(message, 'subject'), false);
  }
});
