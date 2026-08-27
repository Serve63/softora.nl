const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxComposeThreadContext,
} = require('../../server/services/mailbox-compose-thread-context');
const { createBindingHash } = require('../../server/services/mailbox-attachment-service');

function createResolver(message, overrides = {}) {
  let sequence = 0;
  return createMailboxComposeThreadContext({
    mailboxIndexStore: {
      getMessage: async () => message,
    },
    getOwnerIdentity: (email) => ({
      profileKey: email === 'martijn@softora.nl' ? 'martijn' : 'serve',
      name: email === 'martijn@softora.nl' ? 'Martijn van de Ven' : 'Servé Creusen',
    }),
    instantlyMailboxService: {
      getConfiguredAccounts: (owner) => [{
        email: owner === 'martijn' ? 'martijn@websoftora.com' : 'servecreusen@websoftora.com',
      }],
      assertStoredMessageOwnership: async ({ owner, accountEmail, providerMessageId, providerThreadId }) => ({
        providerOwner: owner,
        providerAccountEmail: accountEmail,
        providerMessageId,
        providerThreadId,
        email: 'lead@example.nl',
      }),
    },
    randomUUID: () => `uuid-${++sequence}`,
    ...overrides,
  });
}

test('mailbox reply context is resolved from the exact stored message and builds RFC headers', async () => {
  const resolver = createResolver({
    id: 'inbox:25',
    uid: 25,
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'info@blue-monkey.nl',
    messageId: '<blue-inbound@example.nl>',
    inReplyTo: '<blue-original@example.nl>',
    references: '<blue-original@example.nl>',
  });
  const result = await resolver.resolve({
    accountEmail: 'martijn@softora.nl',
    recipientEmail: 'info@blue-monkey.nl',
    body: {
      owner: 'martijn',
      mode: 'reply',
      idempotencyKey: 'blue-reply-1',
      context: {
        id: 'inbox:25',
        folder: 'inbox',
        messageId: '<blue-inbound@example.nl>',
        conversationId: 'conversation:martijn@softora.nl|blue',
      },
    },
  });

  assert.equal(result.replyTargetMessageId, '<blue-inbound@example.nl>');
  assert.equal(result.references, '<blue-original@example.nl> <blue-inbound@example.nl>');
  assert.equal(result.owner, 'martijn');
  assert.equal(result.mode, 'reply');
});

test('attachment cleanup reconstrueert exact dezelfde HMAC-binding zonder mailbox-indexread', async () => {
  const storedMessage = {
    id: 'inbox:25', folder: 'inbox', accountEmail: 'martijn@softora.nl',
    email: 'info@blue-monkey.nl', messageId: '<blue-inbound@example.nl>',
    references: '<blue-original@example.nl>',
  };
  const body = {
    account: 'martijn@softora.nl', to: 'info@blue-monkey.nl', owner: 'martijn',
    mode: 'reply', idempotencyKey: 'blue-cleanup-1',
    context: {
      id: 'inbox:25', folder: 'inbox', messageId: '<blue-inbound@example.nl>',
      references: '<blue-original@example.nl>',
      conversationId: 'conversation:martijn@softora.nl|blue',
    },
  };
  const expected = await createResolver(storedMessage).resolve({
    body, accountEmail: body.account, recipientEmail: body.to,
  });
  let indexReads = 0;
  const outageResolver = createResolver(null, {
    mailboxIndexStore: {
      async getMessageForReplyProof() {
        indexReads += 1;
        throw new Error('index offline');
      },
    },
  });
  const cleanupBinding = outageResolver.resolveAttachmentCleanupBinding({
    body, accountEmail: body.account, recipientEmail: body.to,
  });
  assert.equal(indexReads, 0);
  assert.equal(createBindingHash(cleanupBinding), createBindingHash(expected));
  assert.equal(cleanupBinding.replyTargetMessageId, '<blue-inbound@example.nl>');
  assert.equal(cleanupBinding.owner, 'martijn');
});

test('mailbox reply proof uses the priority reader and accepts a normalized Reply-To target', async () => {
  let ordinaryReads = 0;
  let proofReads = 0;
  const resolver = createResolver(null, {
    mailboxIndexStore: {
      async getMessage() {
        ordinaryReads += 1;
        return null;
      },
      async getMessageForReplyProof(input) {
        proofReads += 1;
        return {
          accountEmail: input.accountEmail,
          email: 'mailer@salontof.nl',
          replyTo: 'INFO@SALONTOF.NL',
          messageId: '<salon-latest@salontof.nl>',
          references: '<salon-parent@softora.nl>',
        };
      },
    },
  });

  const result = await resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: ' info@salontof.nl ',
    body: {
      owner: 'serve', mode: 'reply', idempotencyKey: 'salon-proof-1',
      replyIdentity: {
        provider: 'smtp', owner: 'serve', accountEmail: 'serve@softora.nl',
        sourceMessageId: '<salon-latest@salontof.nl>', conversationId: 'conversation:salon',
      },
      context: {
        id: 'coldmail:278', folder: 'coldmail', messageId: '<stale-client-value@invalid>',
        conversationId: 'conversation:salon',
      },
    },
  });

  assert.equal(ordinaryReads, 0);
  assert.equal(proofReads, 1);
  assert.equal(result.replyTargetMessageId, '<salon-latest@salontof.nl>');
});

test('mailbox reply proof distinguishes temporary unavailability from a real target mismatch', async () => {
  const unavailableResolver = createResolver(null, {
    mailboxIndexStore: {
      async getMessageForReplyProof() {
        const error = new Error('Supabase timeout');
        error.code = 'MAILBOX_INDEX_EXACT_READ_UNAVAILABLE';
        throw error;
      },
    },
  });
  const body = {
    owner: 'serve', mode: 'reply', idempotencyKey: 'salon-unavailable',
    context: {
      id: 'coldmail:278', folder: 'coldmail', messageId: '<salon-latest@salontof.nl>',
      conversationId: 'conversation:salon',
    },
  };
  await assert.rejects(() => unavailableResolver.resolve({
    accountEmail: 'serve@softora.nl', recipientEmail: 'info@salontof.nl', body,
  }), (error) => error.code === 'MAILBOX_REPLY_TARGET_UNAVAILABLE' && error.status === 503);

  const mismatchResolver = createResolver(null, {
    mailboxIndexStore: {
      async getMessageForReplyProof() {
        return {
          accountEmail: 'serve@softora.nl', email: 'other@example.nl',
          messageId: '<salon-latest@salontof.nl>',
        };
      },
    },
  });
  await assert.rejects(() => mismatchResolver.resolve({
    accountEmail: 'serve@softora.nl', recipientEmail: 'info@salontof.nl', body,
  }), (error) => error.code === 'MAILBOX_REPLY_TARGET_MISMATCH' && error.status === 409);
});

test('mailbox reply context fails closed across owners accounts and recipients', async () => {
  const resolver = createResolver({
    id: 'inbox:25',
    folder: 'inbox',
    accountEmail: 'servecreusen@websoftora.com',
    email: 'lead@example.nl',
    messageId: '<lead@example.nl>',
  });
  await assert.rejects(() => resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'other@example.nl',
    body: {
      owner: 'martijn',
      mode: 'reply',
      idempotencyKey: 'blocked-1',
      context: {
        id: 'inbox:25',
        folder: 'inbox',
        conversationId: 'conversation:serve@softora.nl|lead',
      },
    },
  }), (error) => error.code === 'MAILBOX_SEND_OWNER_MISMATCH');
});

test('new message remains deliberately unthreaded', async () => {
  const resolver = createResolver(null);
  const result = await resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'lead@example.nl',
    body: {
      owner: 'serve',
      mode: 'new-message',
      idempotencyKey: 'new-1',
      context: { conversationId: 'conversation:serve@softora.nl|lead' },
    },
  });
  assert.equal(result.mode, 'new-message');
  assert.equal(result.replyTargetMessageId, '');
  assert.equal(result.references, '');
});

test('aggregate mailbox selection is canonicalized to the exact sender account owner', async () => {
  const resolver = createResolver(null);
  const result = await resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'lead@example.nl',
    body: {
      owner: 'both',
      mode: 'new-message',
      idempotencyKey: 'aggregate-owner-1',
      context: {},
    },
  });

  assert.equal(result.owner, 'serve');
  assert.equal(result.senderName, 'Servé Creusen');
});

test('Instantly reply requires the exact provider thread and new message does not become a reply', async () => {
  const resolver = createResolver(null);
  const reply = await resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'lead@example.nl',
    provider: 'instantly',
    body: {
      owner: 'serve',
      mode: 'reply',
      idempotencyKey: 'instantly-1',
      providerMessageId: 'provider-message-1',
      providerThreadId: 'provider-thread-1',
      replyIdentity: {
        version: 1,
        provider: 'instantly',
        owner: 'serve',
        accountEmail: 'servecreusen@websoftora.com',
        providerAccountEmail: 'servecreusen@websoftora.com',
        providerMessageId: 'provider-message-1',
        providerThreadId: 'provider-thread-1',
        conversationId: 'conversation:instantly:provider-thread-1',
      },
      context: { conversationId: 'conversation:instantly:provider-thread-1' },
    },
  });
  assert.equal(reply.providerThreadId, 'provider-thread-1');
  assert.equal(reply.replyTargetMessageId, 'provider-message-1');

  const fresh = await resolver.resolve({
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'lead@example.nl',
    provider: 'instantly',
    body: {
      owner: 'serve',
      mode: 'new-message',
      idempotencyKey: 'instantly-new-1',
      providerMessageId: 'provider-message-1',
      providerThreadId: 'provider-thread-1',
      context: { conversationId: 'conversation:instantly:provider-thread-1' },
    },
  });
  assert.equal(fresh.mode, 'new-message');
  assert.equal(fresh.providerThreadId, '');
  assert.equal(fresh.replyTargetMessageId, '');
});
