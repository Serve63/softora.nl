'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const acceptedSendModule = require('../../assets/premium-mailbox-compose-accepted-send.js');

function createState(acceptedRecords = []) {
  return acceptedSendModule.create({
    campaignInbox: {
      getMessageOwner(message) {
        return message?.providerOwner || message?.owner || '';
      },
    },
    normalizeAcceptedMessage: (message) => ({ ...message }),
    formatMailDate: () => ({ time: '10:01', date: 'Vandaag', listDate: 'Vandaag' }),
    onAcceptedSend: (record) => acceptedRecords.push(record),
  });
}

test('accepted-send state blijft per controller, accountgebonden en wijkt voor de providerkopie', () => {
  const acceptedRecords = [];
  const state = createState(acceptedRecords);
  const acceptedAt = '2026-08-27T10:01:00.000Z';
  const conversationId = 'campaign:serve@softora.nl|klant@example.nl|kleine-vraag';
  const localMessage = {
    id: 'accepted-sent:<accepted@softora.nl>',
    mailboxId: 'accepted-sent:<accepted@softora.nl>',
    folder: 'sent',
    storageFolder: 'sent',
    direction: 'sent',
    accountEmail: 'serve@softora.nl',
    providerOwner: 'serve',
    messageId: '<accepted@softora.nl>',
    receivedAt: acceptedAt,
    activityAt: acceptedAt,
    localAcceptedSend: true,
    localAcceptedSendFallback: false,
    softoraClientSendIdempotencyKey: 'send-key-1',
  };
  const record = {
    key: 'serve|serve@softora.nl|message:accepted@softora.nl',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    acceptedAt,
    idempotencyKey: 'send-key-1',
    sourceMailId: 'contact:klant',
    conversationKeys: [conversationId],
    message: localMessage,
  };
  const mail = {
    id: 'contact:klant',
    mailboxId: 'inbox:42',
    conversationId,
    accountEmail: 'serve@softora.nl',
    providerOwner: 'serve',
    receivedAt: '2026-08-27T10:00:00.000Z',
    threadMessages: [],
  };

  state.remember(record);
  assert.deepEqual(acceptedRecords, [record]);
  assert.equal(state.getMessageIdentity(localMessage), 'message:accepted@softora.nl');
  assert.equal(state.getConversationKeys(mail).has(conversationId), true);

  state.reconcile(mail);
  assert.equal(mail.threadMessages.length, 1);
  assert.equal(mail.threadMessages[0].localAcceptedSend, true);
  assert.equal(mail.replyDismissedAt, acceptedAt);
  assert.equal(mail.activityTime, '10:01');

  const providerCopy = {
    ...localMessage,
    id: 'sent:provider-copy',
    mailboxId: 'sent:provider-copy',
    localAcceptedSend: false,
  };
  mail.threadMessages.push(providerCopy);
  state.reconcile(mail);
  assert.deepEqual(mail.threadMessages, [providerCopy]);

  const otherOwner = {
    ...mail,
    id: 'contact:martijn',
    mailboxId: 'inbox:99',
    accountEmail: 'martijn@softora.nl',
    providerOwner: 'martijn',
    threadMessages: [],
  };
  state.reconcile(otherOwner);
  assert.deepEqual(otherOwner.threadMessages, []);

  const freshState = createState();
  const freshMail = { ...mail, threadMessages: [] };
  freshState.reconcile(freshMail);
  assert.deepEqual(freshMail.threadMessages, []);
});
