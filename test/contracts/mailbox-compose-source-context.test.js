const test = require('node:test');
const assert = require('node:assert/strict');
const compose = require('../../assets/premium-mailbox-compose');
const { createMailboxComposeThreadContext } = require('../../server/services/mailbox-compose-thread-context');

test('new-message proof metadata and participants come from the same latest message', () => {
  const root = { id: 'serve@softora.nl|coldmail:390', mailboxId: 'coldmail:390',
    folder: 'coldmail', uid: 390, accountEmail: 'serve@softora.nl',
    email: 'info@autospeciaalmandemakers.nl', messageId: '<incoming@example.nl>',
    conversationId: 'conversation:mandemakers' };
  const latest = { id: 'servecreusen7@gmail.com|sent:427', mailboxId: 'sent:427',
    folder: 'sent', uid: 427, accountEmail: 'servecreusen7@gmail.com',
    email: 'serve.creusen7@gmail.com', to: 'info@autospeciaalmandemakers.nl',
    messageId: '<softora-follow-up@gmail.com>', references: '<incoming@example.nl>',
    subject: 'Re: Kleine vraag over jullie website', conversationId: root.conversationId };
  const context = compose.buildNewMessageContext(root, { latestMessage: latest });
  assert.equal(context.id, latest.id);
  assert.equal(context.mailboxId, latest.mailboxId);
  assert.equal(context.folder, latest.folder);
  assert.equal(context.uid, latest.uid);
  assert.equal(context.messageId, latest.messageId);
  assert.equal(context.references, latest.references);
  assert.equal(context.accountEmail, latest.accountEmail);
  assert.equal(context.to, latest.to);
  assert.equal(context.conversationId, root.conversationId);
});

test('outgoing coldmail copies retain exact storage identity despite a sent display folder', () => {
  const source = { id: 'servecreusen7@gmail.com|coldmail:392', mailboxId: 'coldmail:392',
    folder: 'sent', storageFolder: 'coldmail', uid: 392,
    accountEmail: 'servecreusen7@gmail.com', to: 'info@autospeciaalmandemakers.nl',
    messageId: '<softora-follow-up@gmail.com>' };
  const context = compose.buildNewMessageContext(source);
  assert.equal(context.folder, 'coldmail');
  assert.equal(context.uid, 392);
  assert.equal(context.messageId, source.messageId);
  assert.equal(context.mailboxId, 'coldmail:392');
});

test('context from an outgoing coldmail copy resolves against its exact durable source', async () => {
  const stored = { id: 'coldmail:392', folder: 'coldmail', uid: 392,
    accountEmail: 'servecreusen7@gmail.com', email: 'serve.creusen7@gmail.com',
    to: 'info@autospeciaalmandemakers.nl', messageId: '<softora-follow-up@gmail.com>',
    originalCampaignOutbound: false, inReplyTo: '<incoming@example.nl>' };
  const context = compose.buildNewMessageContext({ id: 'coldmail:390',
    accountEmail: stored.accountEmail, email: stored.to }, {
    latestMessage: { ...stored, folder: 'sent', storageFolder: 'coldmail' },
  });
  const resolver = createMailboxComposeThreadContext({
    getOwnerIdentity: () => ({ profileKey: 'serve', name: 'Servé Creusen' }),
    mailboxIndexStore: { async getMessageForReplyProof(input) {
      assert.deepEqual(input, { accountEmail: stored.accountEmail, folder: stored.folder, id: stored.id });
      return stored;
    } },
  });
  const result = await resolver.resolve({ accountEmail: context.accountEmail, recipientEmail: context.to,
    body: { owner: 'serve', mode: context.mode, idempotencyKey: 'exact-copy-proof',
      context: { ...context, id: context.mailboxId } } });
  assert.equal(result.correspondenceSourceMessageId, stored.messageId);
});
