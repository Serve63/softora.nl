const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxComposeThreadContext,
} = require('../../server/services/mailbox-compose-thread-context');

function createResolver(message) {
  let sequence = 0;
  return createMailboxComposeThreadContext({
    mailboxIndexStore: {
      getMessage: async () => message,
    },
    getOwnerIdentity: (email) => ({
      profileKey: email === 'martijn@softora.nl' ? 'martijn' : 'serve',
      name: email === 'martijn@softora.nl' ? 'Martijn van de Ven' : 'Servé Creusen',
    }),
    randomUUID: () => `uuid-${++sequence}`,
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
