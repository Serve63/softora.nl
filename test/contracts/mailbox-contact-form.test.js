const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTACT_FORM_SUBJECT, buildContactFormConversations, createMailboxContactFormService, getMailboxSenderIdentity } = require('../../server/services/mailbox-contact-form');
const { createMailboxComposeThreadContext } = require('../../server/services/mailbox-compose-thread-context');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox');
const display = require('../../assets/premium-mailbox-display');

const root = { id: 'inbox:1', uid: 1, accountEmail: 'info@softora.nl', folder: 'inbox', messageId: '<request@softora.nl>',
  email: 'info@softora.nl', replyTo: 'visitor@example.nl', subject: CONTACT_FORM_SUBJECT + 'Voorbeeld bezoeker', date: '2026-10-06T10:00:00Z', hasBody: true };
const reply = { id: 'sent:2', accountEmail: 'info@softora.nl', folder: 'sent', messageId: '<reply@softora.nl>',
  email: 'info@softora.nl', to: 'visitor@example.nl', inReplyTo: root.messageId, references: root.messageId, date: '2026-10-06T11:00:00Z' };

test('formulierlijst toont alleen echte formulieraanvragen en exacte bijbehorende correspondentie', () => {
  const followup = { ...root, id: 'inbox:3', email: root.replyTo, messageId: '<followup@example.nl>', subject: 'Ander onderwerp', inReplyTo: reply.messageId, date: '2026-10-06T12:00:00Z' };
  const rows = [root, reply, followup, { ...root, id: 'inbox:4', subject: 'Gewone mail' },
    { ...root, accountEmail: 'serve@softora.nl' }, { ...root, id: 'inbox:5', replyTo: '' },
    { ...reply, id: 'sent:6', messageId: '<notlead@softora.nl>', to: 'notvisitor@example.nl' },
    { ...root, folder: 'allmail' }];
  const result = buildContactFormConversations(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].from, 'Voorbeeld bezoeker');
  assert.equal(result[0].email, root.replyTo);
  assert.equal(result[0].direction, 'received');
  assert.deepEqual(result[0].threadMessages.map((mail) => mail.id), ['inbox:3', 'sent:2']);
  assert.equal(result[0].activityAt, followup.date);
  assert.equal(display.getReplyToAddress(result[0], { account: 'info@softora.nl' }), root.replyTo);
  assert.equal(campaignInbox.resolveReplyAccount(result[0], '', 'serve'), 'info@softora.nl');
  assert.equal(campaignInbox.resolveReplyAccount(result[0], '', 'martijn'), '');
  assert.equal(campaignInbox.isCampaignAccount('info@softora.nl'), false);
});

test('contactformulier gebruikt de bestaande index en zoekt uitsluitend in formuliergesprekken', async () => {
  const calls = [];
  const service = createMailboxContactFormService({ mailboxIndexStore: {
    async listMatchingMessagesForAccounts(input) { calls.push(input); return [root]; },
    async listMessagesReferencingMessageIdsForAccounts(input) { calls.push(input); return input.folder === 'sent' ? [reply] : []; },
    async hydrateMessageBodies({ messages }) { return messages.map((mail) => ({ ...mail, body: 'Vraag over maatwerk' })); },
  } });
  const result = await service.list({ query: 'maatwerk', limit: 1 });
  assert.equal(result.totalCount, 1);
  assert.equal(result.messages[0].threadMessages.length, 1);
  assert.ok(calls.every((call) => call.accountEmails.join(',') === 'info@softora.nl'));
  assert.equal((await service.list({ query: 'onbekend' })).totalCount, 0);
  await assert.rejects(service.list({ cursor: '-1' }), { status: 400 });
});

test('ontbrekende index weigert de formulierweergave en valt niet terug op de algemene inbox', async () => {
  const service = createMailboxContactFormService({ mailboxIndexStore: { listMatchingMessagesForAccounts: async () => null } });
  await assert.rejects(service.list(), { status: 503 });
});

test('antwoord gaat vanaf de gedeelde inbox uitsluitend naar het bewezen Reply-To van de invuller', async () => {
  let proof;
  const resolver = createMailboxComposeThreadContext({ mailboxIndexStore: {
    async getMessage(input) { proof = input; return root; },
  } });
  const conversation = buildContactFormConversations([root])[0];
  const body = { owner: 'serve', mode: 'reply', idempotencyKey: 'contact-form-test', context: {
    id: root.id, folder: root.folder, messageId: root.messageId, accountEmail: root.accountEmail, conversationId: conversation.conversationId,
  } };
  const result = await resolver.resolve({ accountEmail: root.accountEmail, recipientEmail: root.replyTo, body });
  assert.equal(result.accountEmail, 'info@softora.nl');
  assert.equal(result.replyTargetMessageId, root.messageId);
  assert.deepEqual(proof, { accountEmail: root.accountEmail, folder: root.folder, id: root.id });
  await assert.rejects(resolver.resolve({ accountEmail: root.accountEmail, recipientEmail: 'wrong@example.nl', body }), { code: 'MAILBOX_REPLY_TARGET_MISMATCH' });
  await assert.rejects(resolver.resolve({ accountEmail: root.accountEmail, recipientEmail: root.replyTo, body: { ...body, owner: 'martijn' } }), { code: 'MAILBOX_SEND_OWNER_MISMATCH' });
  assert.equal(getMailboxSenderIdentity('unknown@softora.nl'), null);
});

test('formuliermailbox-route behoudt de bestaande adminpoort', () => {
  const { registerMailboxRoutes } = require('../../server/routes/mailbox');
  const routes = [];
  const gate = () => {};
  const coordinator = { contactFormResponse: () => {} };
  registerMailboxRoutes({ get: (...args) => routes.push(args), post() {} }, { coordinator, requirePremiumAdminApiAccess: gate });
  const route = routes.find(([path]) => path === '/api/mailbox/contact-form');
  assert.equal(route[1], gate);
});


test('formuliergesprek haalt ook een vervolg op dat uitsluitend het vorige antwoord refereert', async () => {
  const followup = { ...root, id: 'inbox:3', messageId: '<followup@example.nl>', email: root.replyTo, inReplyTo: reply.messageId, subject: 'Vervolgvraag' };
  const calls = [];
  const service = createMailboxContactFormService({ mailboxIndexStore: {
    async listMatchingMessagesForAccounts() { return [root]; },
    async listMessagesReferencingMessageIdsForAccounts({ folder, messageIds }) {
      calls.push(messageIds);
      if (folder === 'sent' && messageIds.includes('request@softora.nl')) return [reply];
      if (folder === 'inbox' && messageIds.includes('reply@softora.nl')) return [followup];
      return [];
    },
  } });
  const result = await service.list();
  assert.deepEqual(new Set(result.messages[0].threadMessages.map((mail) => mail.id)), new Set([reply.id, followup.id]));
  assert.ok(calls.some((ids) => ids.includes('reply@softora.nl')));
});


test('extra formulierbericht behoudt de bewezen replyketen terwijl gewone nieuwe berichten ongewijzigd blijven', () => {
  const conversation = buildContactFormConversations([root, reply])[0];
  assert.equal(campaignInbox.getConversationAction(conversation).kind, 'new-message');
  assert.equal(campaignInbox.getComposeAction('new-message', conversation), 'reply-mail');
  assert.equal(campaignInbox.getComposeAction('new-message', { ...conversation, contactFormSource: false }), 'new-message');
  assert.equal(campaignInbox.getComposeAction('new-message', { ...conversation, accountEmail: 'serve@softora.nl' }), 'new-message');
  assert.equal(campaignInbox.getComposeAction('reply-mail', conversation), 'reply-mail');
  assert.equal(campaignInbox.getComposeAction('new-message', null), 'new-message');
});
