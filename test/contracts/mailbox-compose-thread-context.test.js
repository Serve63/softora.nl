const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxComposeThreadContext,
} = require('../../server/services/mailbox-compose-thread-context');

function createResolver(message, onLookup = () => {}) {
  let sequence = 0;
  return createMailboxComposeThreadContext({
    mailboxIndexStore: {
      getMessage: async (input) => {
        onLookup(input);
        return message;
      },
    },
    getOwnerIdentity: (email) => ({
      profileKey: email === 'martijn@softora.nl' ? 'martijn' : 'serve',
      name: email === 'martijn@softora.nl' ? 'Martijn van de Ven' : 'Servé Creusen',
    }),
    randomUUID: () => `uuid-${++sequence}`,
  });
}

test('mailbox reply context is resolved from the exact stored message and builds RFC headers', async () => {
  let lookup = null;
  const resolver = createResolver({
    id: 'inbox:25',
    uid: 25,
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'info@blue-monkey.nl',
    messageId: '<blue-inbound@example.nl>',
    inReplyTo: '<blue-original@example.nl>',
    references: '<blue-original@example.nl>',
  }, (input) => { lookup = input; });
  const result = await resolver.resolve({
    accountEmail: 'martijn@softora.nl',
    recipientEmail: 'info@blue-monkey.nl',
    body: {
      owner: 'martijn',
      mode: 'reply',
      idempotencyKey: 'blue-reply-1',
      context: {
        id: 'inbox:25',
        uid: 25,
        uidValidity: 222,
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
  assert.deepEqual(lookup, {
    accountEmail: 'martijn@softora.nl',
    folder: 'inbox',
    id: 'inbox:25',
    uid: 25,
    uidValidity: 222,
  });
});

test('mailbox reply context fails closed across owners accounts and recipients', async () => {
  const resolver = createResolver({
    id: 'inbox:25',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
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

test('Instantly reply requires the exact provider thread and rejects new messages before reservation', async () => {
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
      context: { conversationId: 'conversation:instantly:provider-thread-1' },
    },
  });
  assert.equal(reply.providerThreadId, 'provider-thread-1');
  assert.equal(reply.replyTargetMessageId, 'provider-message-1');

  await assert.rejects(() => resolver.resolve({
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
  }), { code: 'INSTANTLY_NEW_MESSAGE_UNSUPPORTED', status: 409 });
});

test('compose weigert client-verzonnen providers vóór enige verzendcontext', async () => {
  const resolver = createResolver(null);
  for (const provider of ['foo', 'bar']) {
    await assert.rejects(() => resolver.resolve({
      accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', provider,
      body: { owner: 'serve', mode: 'new-message', idempotencyKey: `invalid-${provider}`, context: {} },
    }), { code: 'MAILBOX_SEND_PROVIDER_INVALID', status: 400 });
  }
});
