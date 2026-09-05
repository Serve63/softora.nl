const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createMailboxIndexStore, BODY_MAX_CHARS } = require('../../server/services/mailbox-index-store');
const { truncateText } = require('../../server/services/runtime-primitives');

const accountEmail = 'mailbox@example.test';
const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const store = createMailboxIndexStore({ truncateText });

test('a split emoji in one preview cannot block a four-message JSONB sync batch', async () => {
  // The live failure was a 142-code-unit preview ending in a split emoji plus "...".
  const preview = truncateText('a'.repeat(138) + '😁 more text', 140);
  assert.equal(preview.length, 142);
  assert.equal(preview.isWellFormed(), false);
  const messages = Array.from({ length: 4 }, (_, index) => ({
    uid: index + 1,
    messageId: `<message-${index}@example.test>`,
    preview: index === 0 ? preview : 'Other message 😁',
    body: 'Whole body with emoji 😁',
  }));
  const database = new PGlite();
  try {
    await assert.rejects(database.query('select $1::jsonb', [JSON.stringify({ preview })]), { code: '22P02' });
    const rows = store.buildSyncCommitRows({ accountEmail, folder: 'inbox', generationId, uidValidity: '123', messages });
    const result = await database.query('select jsonb_array_length($1::jsonb) as count', [JSON.stringify(rows)]);
    assert.equal(result.rows[0].count, 4);
    assert.deepEqual(rows.map((row) => row.uid), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((row) => row.message_id), messages.map((message) => message.messageId));
    assert.equal(rows[0].body_text, messages[0].body);
    assert.equal(rows[0].preview.isWellFormed(), true);
  } finally {
    await database.close();
  }
});

test('IMAP and provider rows make display text JSONB-safe without rewriting identity or provenance', () => {
  const message = {
    uid: 42, id: 'inbox:42', messageId: '<identity@example.test>',
    inReplyTo: '<parent@example.test>', references: '<older@example.test> <parent@example.test>',
    body: 'a'.repeat(BODY_MAX_CHARS - 1) + '😁 continued',
    subject: 'a'.repeat(498) + '😁 continued',
    preview: 'before\u0000after\ud83d', from: 'Name\ud83d',
    toDisplay: 'Customer\ud83d <customer@example.test>',
    attachments: [{ filename: 'file\ud83d.txt', contentType: 'text/plain', size: 10 }],
    softoraConversationId: 'conversation-1', softoraSendIntentId: 'intent-1',
    softoraReplyTargetMessageId: '<parent@example.test>',
  };
  const imap = store.buildMessageRow(message, accountEmail, 'inbox', 0, { generationId, uidValidity: '123' });
  const provider = store.buildProviderMessageRow({ ...message, provider: 'instantly', providerMessageId: 'provider-id', providerThreadId: 'thread-id', accountEmail, providerOwner: 'serve' });
  for (const row of [imap, provider]) {
    for (const value of [row.body_text, row.subject, row.preview, row.sender_name, row.payload.toDisplay, row.payload.attachments[0].filename]) {
      assert.equal(value.isWellFormed(), true);
      assert.equal(value.includes('\u0000'), false);
    }
    assert.equal(row.body_truncated, true);
    assert.equal(row.has_body, true);
    assert.equal(row.body_text.length <= BODY_MAX_CHARS, true);
    assert.equal(row.message_id, message.messageId);
    assert.equal(row.in_reply_to, message.inReplyTo);
    assert.equal(row.references_text, message.references);
  }
  assert.equal(imap.uid, 42);
  assert.equal(imap.uid_generation_id, generationId);
  assert.equal(imap.payload.softoraSendIntentId, message.softoraSendIntentId);
  assert.equal(imap.payload.softoraConversationId, message.softoraConversationId);
  assert.equal(imap.payload.softoraReplyTargetMessageId, message.softoraReplyTargetMessageId);
  assert.equal(provider.payload.providerThreadId, 'thread-id');
});

test('malformed durable identities stay unchanged so existing validation still fails closed', () => {
  const message = { uid: 1, messageId: '<invalid\ud83d@example.test>', softoraSendIntentId: 'invalid\ud83d', body: '' };
  const row = store.buildMessageRow(message, accountEmail, 'inbox');
  assert.equal(row.message_id, message.messageId);
  assert.equal(row.payload.softoraSendIntentId, message.softoraSendIntentId);
  assert.equal(row.body_text, null);
  assert.equal(row.has_body, false);
});
