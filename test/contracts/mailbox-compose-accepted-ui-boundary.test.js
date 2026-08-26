'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const composeModule = require('../../assets/premium-mailbox-compose.js');
const composeControllerModule = require('../../assets/premium-mailbox-compose-controller.js');
const readModule = require('../../assets/premium-mailbox-read.js');
const uiStateModule = require('../../assets/premium-mailbox-ui-state.js');

function createField(value = '') {
  return {
    value,
    textContent: '',
    disabled: false,
    hidden: false,
    attributes: {},
    classList: {
      added: [],
      removed: [],
      add(valueToAdd) { this.added.push(valueToAdd); },
      remove(valueToRemove) { this.removed.push(valueToRemove); },
    },
    setAttribute(name, valueToSet) { this.attributes[name] = valueToSet; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
  };
}

function createScenario({
  response,
  onAcceptedSend,
  attachments = [],
  accountEmail = 'serve290@gmail.com',
  owner = 'serve',
  messageKey = `${accountEmail}|coldmail|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|329`,
} = {}) {
  const fields = new Map([
    ['c-to', createField()],
    ['c-subject', createField()],
    ['c-body', createField()],
    ['c-cc', createField()],
    ['c-bcc', createField()],
    ['compose-overlay', createField()],
  ]);
  const sendButton = createField();
  sendButton.textContent = 'Versturen';
  const mail = {
    id: 'contact:peakboom',
    mailboxId: 'coldmail:329',
    uid: 329,
    folder: 'coldmail',
    accountEmail,
    providerOwner: owner,
    messageKey,
    email: 'info@peakboomadvies.nl',
    subject: 'RE: Kleine vraag over jullie website',
    messageId: '<reply@peakboomadvies.nl>',
    conversationId: 'campaign:serve290@gmail.com|info@peakboomadvies.nl|kleine-vraag',
    receivedAt: '2026-08-26T07:00:00.000Z',
    threadMessages: [],
  };
  const toasts = [];
  const logs = [];
  let fetchCount = 0;
  const controller = composeControllerModule.create({
    document: {
      getElementById: (id) => fields.get(id) || null,
      querySelector: (selector) => selector === '.btn-send' ? sendButton : null,
    },
    fetch: async () => {
      fetchCount += 1;
      return typeof response === 'function' ? response(fetchCount) : response;
    },
    compose: {
      buildReplyContext: composeModule.buildReplyContext,
      resetOptionalFields() {},
      reset() {},
      getAttachments: () => attachments,
      uploadAttachments: async (selected) => selected.map((attachment, index) => ({
        reference: `signed-reference-${index}`,
        filename: attachment.filename || attachment.name,
        contentType: attachment.contentType || attachment.type,
        size: attachment.size,
      })),
    },
    campaignInbox: {
      resolveReplyAccount: (message) => message.accountEmail,
      getMessageOwner: () => owner,
      getOwnerByAccount: () => owner,
      getOwnerLabel: () => owner === 'martijn' ? 'Martijn van de Ven' : 'Servé Creusen',
      getConversationAction: (message) => ({ kind: 'reply', isRoot: true, message }),
    },
    display: {
      getReplyToAddress: (message) => message.email,
      formatDetailSubject: (value) => value,
    },
    getActiveFolder: () => 'outreach',
    getAccount: () => accountEmail,
    getOwner: () => owner,
    findMail: () => mail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeAcceptedMessage: (message) => ({ ...message }),
    formatMailDate: () => ({ time: '', date: '', listDate: '' }),
    onAcceptedSend,
    logger: {
      error(label, detail) { logs.push({ label, detail }); },
    },
    composeWindow: { reset() {} },
    toast: (message) => toasts.push(message),
  });

  controller.reply(mail);
  fields.get('c-body').value = 'Dank voor je reactie.';
  return {
    controller,
    fields,
    getFetchCount: () => fetchCount,
    logs,
    mail,
    toasts,
  };
}

test('HTTP 200 blijft verzendsucces wanneer lokale accepted-send rendering faalt', async () => {
  const scenario = createScenario({
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          messageId: '<softora-accepted@gmail.com>',
          sentMessage: {
            messageId: '<softora-accepted@gmail.com>',
            receivedAt: '2026-08-26T07:54:03.667Z',
          },
        },
      }),
    },
    onAcceptedSend() {
      throw new Error('render callback faalde na acceptatie');
    },
  });
  const { controller, fields, getFetchCount, logs, mail, toasts } = scenario;
  await controller.send();

  assert.equal(getFetchCount(), 1);
  assert.equal(controller.getContext(), null);
  assert.ok(fields.get('compose-overlay').classList.removed.includes('open'));
  assert.ok(toasts.includes('✓ Mail verzonden'));
  assert.equal(toasts.some((message) => /verzenden mislukt/i.test(message)), false);
  assert.deepEqual(logs, [{
    label: '[MailboxCompose][AcceptedSendPostprocess]',
    detail: { phase: 'local-ui', message: 'render callback faalde na acceptatie' },
  }]);

  controller.reconcile(mail);
  assert.equal(mail.threadMessages.filter((message) => message.direction === 'sent').length, 1);
  assert.equal(mail.threadMessages[0].messageId, '<softora-accepted@gmail.com>');

  await controller.send();
  assert.equal(getFetchCount(), 1, 'een lokale naverwerkingsfout mag nooit dezelfde mail opnieuw versturen');
});

for (const bodyFailure of [
  {
    label: 'malformed JSON',
    error: new SyntaxError('Unexpected end of JSON input'),
  },
  {
    label: 'afgebroken response-body',
    error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
  },
]) {
  test(`HTTP 200 blijft verzendsucces bij ${bodyFailure.label}`, async () => {
    const scenario = createScenario({
      response: {
        ok: true,
        status: 200,
        json: async () => { throw bodyFailure.error; },
      },
    });
    const { controller, fields, getFetchCount, logs, mail, toasts } = scenario;

    await controller.send();

    assert.equal(getFetchCount(), 1);
    assert.equal(controller.getContext(), null);
    assert.ok(fields.get('compose-overlay').classList.removed.includes('open'));
    assert.ok(toasts.includes('✓ Mail verzonden'));
    assert.equal(toasts.some((message) => /verzenden mislukt/i.test(message)), false);
    assert.deepEqual(logs, [{
      label: '[MailboxCompose][AcceptedSendPostprocess]',
      detail: { phase: 'response-body', message: bodyFailure.error.message },
    }]);

    controller.reconcile(mail);
    const sentMessages = mail.threadMessages.filter((message) => message.direction === 'sent');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].body, 'Dank voor je reactie.');
    assert.equal(sentMessages[0].localAcceptedSend, true);
  });
}

test('een niet-200 response blijft een echte verzendfout, ook met onleesbare body', async () => {
  const scenario = createScenario({
    response: {
      ok: false,
      status: 503,
      json: async () => { throw new SyntaxError('upstream body afgebroken'); },
    },
  });
  const { controller, fields, getFetchCount, logs, mail, toasts } = scenario;

  await controller.send();

  assert.equal(getFetchCount(), 1);
  assert.notEqual(controller.getContext(), null);
  assert.equal(fields.get('compose-overlay').classList.removed.includes('open'), false);
  assert.equal(toasts.some((message) => /verzenden mislukt/i.test(message)), true);
  assert.equal(toasts.includes('✓ Mail verzonden'), false);
  assert.deepEqual(logs, []);
  controller.reconcile(mail);
  assert.equal(mail.threadMessages.filter((message) => message.direction === 'sent').length, 0);

  await controller.send();
  assert.equal(getFetchCount(), 2, 'een echte niet-200 fout moet opnieuw geprobeerd kunnen worden');
});

test('malformed HTTP-200 gebruikt responseheaders als canonieke provideridentiteit', async () => {
  const headers = new Map([
    ['x-softora-send-intent-id', 'send:peakboom-header'],
    ['x-softora-message-id', '<peakboom-provider@gmail.com>'],
  ]);
  const scenario = createScenario({
    response: {
      ok: true,
      status: 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
      json: async () => { throw new SyntaxError('providerbody was onleesbaar'); },
    },
  });
  const { controller, mail } = scenario;

  await controller.send();
  controller.reconcile(mail);
  let sentMessages = mail.threadMessages.filter((message) => message.direction === 'sent');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].messageId, '<peakboom-provider@gmail.com>');
  assert.equal(sentMessages[0].providerMessageId, '');
  assert.equal(sentMessages[0].softoraSendIntentId, 'send:peakboom-header');
  assert.equal(sentMessages[0].localAcceptedSendFallback, false);

  const providerCopy = {
    id: 'sent:peakboom-provider',
    mailboxId: 'sent:peakboom-provider',
    folder: 'sent',
    storageFolder: 'sent',
    direction: 'sent',
    accountEmail: 'serve290@gmail.com',
    messageId: '<peakboom-provider@gmail.com>',
    from: 'Servé Creusen <serve290@gmail.com>',
    email: 'serve290@gmail.com',
    to: 'info@peakboomadvies.nl',
    subject: 'RE: Kleine vraag over jullie website',
    body: 'Dank voor je reactie.',
    receivedAt: sentMessages[0].receivedAt,
    conversationId: mail.conversationId,
    softoraSendMode: 'reply',
    softoraReplyTargetMessageId: mail.messageId,
    localAcceptedSend: false,
  };
  mail.threadMessages.push(providerCopy);
  controller.reconcile(mail);

  sentMessages = mail.threadMessages.filter((message) => message.direction === 'sent');
  assert.equal(sentMessages.length, 1);
  assert.strictEqual(sentMessages[0], providerCopy);
  assert.equal(sentMessages[0].messageId, '<peakboom-provider@gmail.com>');
  assert.equal(sentMessages.some((message) => message.localAcceptedSendFallback === true), false);
  mail.threadMessages = [];
  controller.reconcile(mail);
  assert.equal(mail.threadMessages.length, 1, 'bij een partial refresh komt de canonieke clientkaart terug');
  assert.equal(mail.threadMessages[0].messageId, '<peakboom-provider@gmail.com>');
  mail.threadMessages.push(providerCopy);
  controller.reconcile(mail);
  assert.deepEqual(mail.threadMessages, [providerCopy]);
});

test('send-intent vervangt alleen de clientkaart en laat de providerkopie leidend', async () => {
  const scenario = createScenario({
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          messageId: '<planned-peakboom@gmail.com>',
          intentId: 'send:peakboom-intent',
          sentMessage: {
            messageId: '<planned-peakboom@gmail.com>',
            softoraSendIntentId: 'send:peakboom-intent',
            receivedAt: '2026-08-26T07:54:03.667Z',
          },
        },
      }),
    },
  });
  const { controller, mail } = scenario;
  await controller.send();
  controller.reconcile(mail);
  assert.equal(mail.threadMessages.length, 1);
  assert.equal(mail.threadMessages[0].localAcceptedSend, true);

  const providerCopy = {
    id: 'sent:peakboom-intent-provider',
    mailboxId: 'sent:peakboom-intent-provider',
    folder: 'sent', direction: 'sent', accountEmail: 'serve290@gmail.com',
    messageId: '<provider-rewritten-id@gmail.com>',
    softoraSendIntentId: 'send:peakboom-intent',
    to: 'info@peakboomadvies.nl', subject: 'RE: Kleine vraag over jullie website',
    body: 'Dank voor je reactie.', receivedAt: '2026-08-26T07:54:03.667Z',
    conversationId: mail.conversationId,
  };
  mail.threadMessages.push(providerCopy);
  controller.reconcile(mail);

  assert.deepEqual(mail.threadMessages, [providerCopy]);
});

test('geaccepteerde reply bewaart exact dezelfde accountgebonden messageKey zonder opslagwaarschuwing', async () => {
  for (const identity of [
    {
      owner: 'serve',
      accountEmail: 'serve290@gmail.com',
      messageKey: 'serve290@gmail.com|coldmail|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|329',
    },
    {
      owner: 'martijn',
      accountEmail: 'martijn@softora.nl',
      messageKey: 'martijn@softora.nl|coldmail|gen:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|329',
    },
  ]) {
    let acceptedRecord = null;
    const scenario = createScenario({
      ...identity,
      response: {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            messageId: '<same-rfc-message-id@softora.nl>',
            sentMessage: {
              messageId: '<same-rfc-message-id@softora.nl>',
              receivedAt: '2026-08-26T13:29:49.000Z',
            },
          },
        }),
      },
      onAcceptedSend: (record) => { acceptedRecord = record; },
    });
    const writes = [];
    let outboxListener = null;
    const outbox = {
      subscribe(listener) { outboxListener = listener; },
      async enqueue(payload, metadata) {
        const record = {
          mutationId: `mutation-${identity.owner}`,
          ...payload,
          identity: metadata.identity,
          identities: metadata.identities,
          previous: metadata.previous,
        };
        writes.push({ payload, metadata, record });
        return { ok: true, pending: true, record };
      },
    };
    const readController = readModule.create({
      outbox,
      getAccount: (message) => message.accountEmail,
      getFolder: (message) => message.folder,
      getOwner: (message) => message.providerOwner,
      getRequestId: (message) => message.mailboxId || message.id,
      getConversationAction: (message) => ({ kind: 'reply', isRoot: true, message }),
    });

    await scenario.controller.send();
    assert.ok(acceptedRecord);
    assert.equal(acceptedRecord.replyTarget.messageKey, identity.messageKey);
    const completion = uiStateModule.completeAcceptedSend({
      record: acceptedRecord,
      mails: [scenario.mail],
      composeController: scenario.controller,
      readController,
      findMail: (id) => id === scenario.mail.id ? scenario.mail : null,
      renderList() {},
      getActiveMail: () => scenario.mail.id,
      openMail() {},
    });
    const handled = await completion.handledPromise;

    assert.equal(handled.ok, true);
    assert.equal(handled.pending, true);
    assert.equal(writes.length, 1);
    assert.deepEqual({
      account: writes[0].payload.account,
      owner: writes[0].payload.owner,
      folder: writes[0].payload.folder,
      uid: writes[0].payload.uid,
      messageKey: writes[0].payload.messageKey,
      messageId: writes[0].payload.messageId,
      dismissReply: writes[0].payload.dismissReply,
    }, {
      account: identity.accountEmail,
      owner: identity.owner,
      folder: 'coldmail',
      uid: 329,
      messageKey: identity.messageKey,
      messageId: '<reply@peakboomadvies.nl>',
      dismissReply: true,
    });
    assert.equal(scenario.mail.readError || '', '');

    outboxListener({
      type: 'confirmed',
      record: writes[0].record,
      result: { replyDismissedAt: '2026-08-26T13:29:50.000Z' },
    });
    assert.equal(scenario.mail.readPending, false);
    assert.equal(scenario.mail.replyDismissPending, false);
    assert.equal(scenario.mail.readError || '', '');
    assert.equal(scenario.mail.replyDismissedAt, '2026-08-26T13:29:50.000Z');
  }
});

test('geaccepteerde response zonder leesbare JSON behoudt alleen veilige lokale bijlagemetadata', async () => {
  const selected = [{
    filename: 'voorbeeld.png',
    contentType: 'image/png',
    size: 4,
    file: { name: 'voorbeeld.png', privateBytes: 'niet tonen' },
  }];
  const scenario = createScenario({
    attachments: selected,
    response: {
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('afgebroken JSON'); },
    },
  });

  await scenario.controller.send();
  scenario.controller.reconcile(scenario.mail);
  const sent = scenario.mail.threadMessages.find((message) => message.direction === 'sent');
  assert.deepEqual(sent.attachments, [{
    filename: 'voorbeeld.png',
    contentType: 'image/png',
    size: 4,
  }]);
  assert.equal('file' in sent.attachments[0], false);
  assert.equal('reference' in sent.attachments[0], false);
  assert.doesNotMatch(JSON.stringify(sent.attachments), /privateBytes|niet tonen/);
});

test('exacte idempotente replay neemt nooit bijlagemetadata uit de nieuwe clientrequest over', async () => {
  const selected = [{
    filename: 'niet-duurzaam.pdf',
    contentType: 'application/pdf',
    size: 321,
    file: { name: 'niet-duurzaam.pdf', privateBytes: 'nooit tonen' },
  }];
  const scenario = createScenario({
    attachments: selected,
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          idempotentReplay: true,
          messageId: '<duurzaam-accepted@softora.nl>',
          sentMessage: {
            messageId: '<duurzaam-accepted@softora.nl>',
            subject: 'RE: Kleine vraag over jullie website',
            body: 'Duurzaam opgeslagen antwoord.',
            receivedAt: '2026-08-26T15:29:00.000Z',
          },
        },
      }),
    },
  });

  await scenario.controller.send();
  scenario.controller.reconcile(scenario.mail);
  const sent = scenario.mail.threadMessages.find((message) => message.direction === 'sent');
  assert.deepEqual(sent.attachments, []);
  assert.doesNotMatch(JSON.stringify(sent), /niet-duurzaam|privateBytes|nooit tonen/);
});
