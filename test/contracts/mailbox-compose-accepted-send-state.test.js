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

function createCollisionFixture(overrides = {}) {
  const acceptedAt = '2026-08-27T10:01:00.000Z';
  const conversationId = 'campaign:serve@softora.nl|klant@example.nl|kleine-vraag';
  const record = {
    key: 'serve|serve@softora.nl|message:accepted-collision@softora.nl',
    owner: ' SERVE ',
    accountEmail: ' Serve@Softora.nl ',
    acceptedAt,
    idempotencyKey: 'send-key-collision',
    sourceMailId: 'inbox:42',
    conversationKeys: [conversationId],
    message: {
      id: 'accepted-sent:<accepted-collision@softora.nl>',
      mailboxId: 'accepted-sent:<accepted-collision@softora.nl>',
      folder: 'sent',
      storageFolder: 'sent',
      direction: 'sent',
      accountEmail: 'serve@softora.nl',
      providerOwner: 'serve',
      messageId: '<accepted-collision@softora.nl>',
      receivedAt: acceptedAt,
      activityAt: acceptedAt,
      localAcceptedSend: true,
      localAcceptedSendFallback: false,
      softoraClientSendIdempotencyKey: 'send-key-collision',
    },
    ...overrides.record,
  };
  const serveMail = {
    id: 'inbox:42',
    mailboxId: 'inbox:42',
    conversationId,
    accountEmail: ' SERVE@SOFTORA.NL ',
    providerOwner: 'Serve',
    receivedAt: '2026-08-27T10:00:00.000Z',
    threadMessages: [],
    ...overrides.serveMail,
  };
  const martijnMail = {
    id: 'inbox:42',
    mailboxId: 'inbox:42',
    conversationId,
    accountEmail: 'martijn@softora.nl',
    providerOwner: 'martijn',
    receivedAt: '2026-08-27T10:00:00.000Z',
    threadMessages: [],
    ...overrides.martijnMail,
  };
  return { record, serveMail, martijnMail };
}

test('accepted-send scoped finder kiest Servé vóór ID- en conversationmatch in beide arrayvolgordes', () => {
  for (const matchBy of ['source-id', 'conversation']) {
    for (const reverse of [false, true]) {
      const state = createState();
      const { record, serveMail, martijnMail } = createCollisionFixture({
        record: { sourceMailId: matchBy === 'source-id' ? 'inbox:42' : 'inbox:niet-aanwezig' },
      });
      const mails = reverse ? [martijnMail, serveMail] : [serveMail, martijnMail];

      assert.equal(state.findScopedMail(record, mails), serveMail);
      state.remember(record);
      state.reconcile(martijnMail);
      assert.deepEqual(martijnMail.threadMessages, []);
      assert.equal(martijnMail.replyDismissedAt, undefined);
      state.reconcile(serveMail);
      assert.equal(serveMail.threadMessages.length, 1);
      assert.equal(serveMail.threadMessages[0].messageId, '<accepted-collision@softora.nl>');
    }
  }
});

test('accepted-send scope ontbreekt of botst: finder en reconcile falen gesloten', () => {
  const cases = [
    { name: 'record owner ontbreekt', overrides: { record: { owner: '' } } },
    { name: 'record account ontbreekt', overrides: { record: { accountEmail: '' } } },
    { name: 'mail owner ontbreekt', overrides: { serveMail: { providerOwner: '' } } },
    { name: 'mail account ontbreekt', overrides: { serveMail: { accountEmail: '' } } },
    { name: 'owner botst', overrides: { serveMail: { providerOwner: 'martijn' } } },
    { name: 'account botst', overrides: { serveMail: { accountEmail: 'martijn@softora.nl' } } },
  ];

  cases.forEach(({ name, overrides }) => {
    const state = createState();
    const { record, serveMail } = createCollisionFixture(overrides);
    assert.equal(state.findScopedMail(record, [serveMail]), null, name);
    state.remember(record);
    state.reconcile(serveMail);
    assert.deepEqual(serveMail.threadMessages, [], name);
    assert.equal(serveMail.replyDismissedAt, undefined, name);
  });
});

test('accepted-send scoped finder muteert niets bij twee exact passende kandidaten', () => {
  const state = createState();
  const { record, serveMail } = createCollisionFixture();
  const duplicate = { ...serveMail, threadMessages: [] };

  assert.equal(state.findScopedMail(record, [serveMail, duplicate]), null);
  assert.deepEqual(serveMail.threadMessages, []);
  assert.deepEqual(duplicate.threadMessages, []);
});

test('providerkopie-dedupe laat een Martijn-kopie met Serv\u00e9s canonieke Message-ID in beide volgordes ongemoeid', () => {
  for (const reverse of [false, true]) {
    const state = createState();
    const { record, serveMail } = createCollisionFixture();
    const martijnProviderCopy = {
      id: 'sent:martijn-provider-copy',
      mailboxId: 'sent:martijn-provider-copy',
      folder: 'sent',
      storageFolder: 'sent',
      direction: 'sent',
      accountEmail: 'martijn@softora.nl',
      providerOwner: 'martijn',
      messageId: '<accepted-collision@softora.nl>',
      receivedAt: record.acceptedAt,
    };
    const unrelatedServeCopy = {
      id: 'sent:serve-unrelated',
      mailboxId: 'sent:serve-unrelated',
      folder: 'sent',
      storageFolder: 'sent',
      direction: 'sent',
      accountEmail: 'serve@softora.nl',
      providerOwner: 'serve',
      messageId: '<serve-unrelated@softora.nl>',
      receivedAt: '2026-08-27T09:59:00.000Z',
    };
    serveMail.threadMessages = reverse
      ? [martijnProviderCopy, unrelatedServeCopy]
      : [unrelatedServeCopy, martijnProviderCopy];

    state.remember(record);
    state.reconcile(serveMail);

    assert.equal(serveMail.threadMessages.includes(martijnProviderCopy), true);
    assert.equal(serveMail.threadMessages.includes(unrelatedServeCopy), true);
    assert.equal(serveMail.threadMessages.filter((message) => (
      message.localAcceptedSend === true &&
      message.messageId === '<accepted-collision@softora.nl>'
    )).length, 1);
  }
});
