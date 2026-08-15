const test = require('node:test');
const assert = require('node:assert/strict');

require('../../assets/premium-mailbox-reply-identity');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const { createMailboxComposeThreadContext } = require('../../server/services/mailbox-compose-thread-context');
const { createMailboxComposeRuntime } = require('../../server/services/mailbox-compose-runtime');
const { createMailboxSendProvenanceStore } = require('../../server/services/mailbox-send-provenance-store');
const { sendMailboxMessage } = require('../../server/services/mailbox-instantly-integration');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeString = (value) => String(value || '').trim();

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createInstantlyService(adapterCalls = []) {
  return {
    getConfiguredAccounts(owner) {
      return [{ email: owner === 'martijn' ? 'martijn@websoftora.com' : 'servecreusen@websoftora.com' }];
    },
    async assertStoredMessageOwnership(input) {
      return { ...input, providerOwner: input.owner, providerAccountEmail: input.accountEmail, email: 'bestuur@mhcbe.nl' };
    },
    async reply(input) {
      adapterCalls.push(input);
      return {
        providerMessageId: 'provider-outbound-1',
        providerThreadId: input.providerThreadId,
        sentMessage: { messageId: '<provider-outbound-1@instantly>', receivedAt: '2026-08-13T10:00:00.000Z' },
      };
    },
  };
}

function createMhcbePayloadCapture() {
  const requests = [];
  const values = {
    'c-to': { value: '' }, 'c-cc': { value: '' }, 'c-bcc': { value: '' },
    'c-subject': { value: '' }, 'c-body': { value: '' },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const mail = {
    id: 'instantly:019fd108-155e-7f5a-8e59-7ffed87c35a8',
    mailboxId: 'instantly:019fd108-155e-7f5a-8e59-7ffed87c35a8',
    provider: 'instantly', providerOwner: 'serve',
    providerAccountEmail: 'servecreusen@websoftora.com',
    providerMessageId: '019fd108-155e-7f5a-8e59-7ffed87c35a8',
    providerThreadId: '6b-e1D0pA2Y6HJuoZhbKJS1ZKI',
    conversationId: 'instantly:servecreusen@websoftora.com:6b-e1D0pA2Y6HJuoZhbKJS1ZKI',
    messageId: '<mhcbe-inbound@mail.gmail.com>', folder: 'inbox',
    accountEmail: 'servecreusen@websoftora.com', email: 'bestuur@mhcbe.nl',
    subject: 'Kleine vraag over jullie website', body: 'Mogelijk kun je een screenshot delen.',
  };
  const controller = composeController.create({
    document: {
      getElementById: (id) => values[id] || null,
      querySelector: () => null,
    },
    compose: {
      buildReplyContext(message, options) {
        const accountEmail = options.getAccount();
        return {
          ...message, accountEmail, mode: 'reply',
          replyIdentity: globalThis.SoftoraMailboxReplyIdentity.createReplyIdentity(
            message, accountEmail, options.getOwner()
          ),
        };
      },
      getAttachments: () => [], isUsed: () => false,
      complete() {}, finish() {}, reset() {}, resetOptionalFields() {},
    },
    campaignInbox: {
      resolveReplyAccount: () => mail.providerAccountEmail,
      getAccount: () => mail.providerAccountEmail,
      getMessageOwner: () => 'serve',
      getOwnerByAccount: () => '',
    },
    display: { getReplyToAddress: () => mail.email, formatDetailSubject: (value) => value },
    findMail: () => mail,
    normalizeEmail,
    getAccount: () => 'martijn@softora.nl',
    getOwner: () => 'both',
    getActiveFolder: () => 'outreach',
    loadSenderProfile: async () => ({}),
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      requests.push({ url, payload });
      if (url.endsWith('/rewrite')) return { ok: true, json: async () => ({ ok: true, text: 'Dankjewel voor je reactie.' }) };
      return { ok: true, json: async () => ({ ok: true, result: { providerThreadId: mail.providerThreadId } }) };
    },
    toast() {},
  });
  return { controller, mail, requests, values };
}

test('MHCBE suggested reply keeps one canonical identity through edit and send payload', async () => {
  const flow = createMhcbePayloadCapture();
  flow.controller.reply(flow.mail);
  await flow.controller.rewrite();
  assert.equal(flow.values['c-body'].value, 'Dankjewel voor je reactie.');
  flow.values['c-body'].value += '\n\nIk stuur geen mail in deze test.';
  await flow.controller.send();

  assert.equal(flow.requests.length, 2);
  const rewriteIdentity = flow.requests[0].payload.context.replyIdentity;
  const sendPayload = flow.requests[1].payload;
  assert.deepEqual(sendPayload.replyIdentity, rewriteIdentity);
  assert.equal(sendPayload.account, 'servecreusen@websoftora.com');
  assert.equal(sendPayload.owner, 'serve');
  assert.equal(sendPayload.provider, 'instantly');
  assert.equal(sendPayload.providerMessageId, flow.mail.providerMessageId);
  assert.equal(sendPayload.providerThreadId, flow.mail.providerThreadId);
  assert.match(sendPayload.body, /geen mail in deze test/);
});

test('rapid conversation switching sends only the exact latest opened message context', async () => {
  const requests = [];
  const values = {
    'c-to': { value: '' }, 'c-cc': { value: '' }, 'c-bcc': { value: '' },
    'c-subject': { value: '' }, 'c-body': { value: 'Veilige synthetische test.' },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const first = {
    id: 'serve@softora.nl|coldmail:10', mailboxId: 'coldmail:10', folder: 'coldmail', uid: 10,
    accountEmail: 'serve@softora.nl', email: 'first@example.nl', subject: 'Eerste gesprek',
    messageId: '<first@example.nl>', conversationId: 'conversation:first', threadMessages: [],
  };
  const secondLatest = {
    id: 'serve@softora.nl|coldmail:20', mailboxId: 'coldmail:20', folder: 'coldmail', uid: 20,
    accountEmail: 'serve@softora.nl', email: 'second@example.nl', replyTo: 'reply@example.nl',
    subject: 'Tweede gesprek', messageId: '<second@example.nl>', conversationId: 'conversation:second',
    threadMessages: [],
  };
  const second = {
    ...secondLatest,
    id: 'serve@softora.nl|coldmail:19', mailboxId: 'coldmail:19', uid: 19,
    email: 'stale@example.nl', replyTo: '', messageId: '<stale@example.nl>',
    threadMessages: [secondLatest],
  };
  const current = new Map([[first.id, first], [second.id, second]]);
  const controller = composeController.create({
    document: {
      getElementById: (id) => values[id] || null,
      querySelector: () => null,
    },
    compose: {
      buildReplyContext(message, options) {
        const accountEmail = options.getAccount();
        return {
          ...message, accountEmail, mode: 'reply',
          replyIdentity: globalThis.SoftoraMailboxReplyIdentity.createReplyIdentity(
            message, accountEmail, options.getOwner()
          ),
        };
      },
      getAttachments: () => [], isUsed: () => false,
      reset() {}, resetOptionalFields() {},
    },
    campaignInbox: {
      resolveReplyAccount: (mail) => mail.accountEmail,
      getMessageOwner: () => 'serve',
      getOwnerByAccount: () => 'serve',
      getConversationAction: (mail) => {
        const message = mail === second ? secondLatest : mail;
        return {
          kind: 'reply', isRoot: message === mail, message,
          messageKey: `message:${message.messageId}`,
        };
      },
    },
    display: {
      getReplyToAddress: (mail) => mail.replyTo || mail.email,
      formatDetailSubject: (value) => value,
    },
    findMail: (id) => current.get(id),
    normalizeEmail,
    getAccount: () => 'serve@softora.nl', getOwner: () => 'both', getActiveFolder: () => 'outreach',
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
    toast() {},
  });

  controller.reply(first, 'message:<first@example.nl>');
  controller.reply(second, 'message:<second@example.nl>');
  values['c-body'].value = 'Veilige synthetische test.';
  await controller.send();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.to, 'reply@example.nl');
  assert.equal(requests[0].payload.context.id, 'coldmail:20');
  assert.equal(requests[0].payload.context.messageId, '<second@example.nl>');
  assert.equal(requests[0].payload.replyIdentity.sourceMessageId, '<second@example.nl>');
  assert.equal(requests[0].payload.context.conversationId, 'conversation:second');
});

test('captured MHCBE payload passes real preflight and selects only the exact mocked Instantly adapter', async () => {
  const flow = createMhcbePayloadCapture();
  flow.controller.reply(flow.mail);
  flow.values['c-body'].value = 'Veilige adaptertest.';
  await flow.controller.send();
  const payload = flow.requests[0].payload;
  const adapterCalls = [];
  const instantlyMailboxService = createInstantlyService(adapterCalls);
  const resolver = createMailboxComposeThreadContext({ instantlyMailboxService, randomUUID: () => 'fixed-uuid' });
  const previewStore = createMailboxSendProvenanceStore();
  const intents = new Map();
  const provenanceStore = {
    preview: (input) => previewStore.preview(input),
    async reserve(input) {
      if (intents.has(input.idempotencyKey)) return { created: false, intent: intents.get(input.idempotencyKey) };
      const intent = { ...input, status: 'prepared' };
      intents.set(input.idempotencyKey, intent);
      return { created: true, intent };
    },
    async startDispatch() {},
    async accept(intentId, values) { return { intentId, ...values, status: 'accepted' }; },
    async fail() {}, async markUnknown() {},
  };
  const runtime = createMailboxComposeRuntime({
    composeSendDependencies: {}, getAccount: () => null, instantlyMailboxService,
    mailboxComposeThreadContext: resolver, mailboxSendProvenanceStore: provenanceStore,
    normalizeEmail, normalizeString, logger: { error() {} },
  });

  const preflight = responseRecorder();
  await runtime.preflightMessageResponse({ body: payload }, preflight);
  assert.equal(preflight.statusCode, 200);
  assert.deepEqual({
    externalEffect: preflight.body.result.externalEffect,
    provider: preflight.body.result.provider,
    owner: preflight.body.result.owner,
    accountEmail: preflight.body.result.accountEmail,
    reservationReady: preflight.body.result.reservationReady,
  }, {
    externalEffect: false, provider: 'instantly', owner: 'serve',
    accountEmail: 'servecreusen@websoftora.com', reservationReady: true,
  });
  assert.equal(adapterCalls.length, 0);

  const send = responseRecorder();
  await runtime.sendMessageResponse({ body: payload }, send);
  assert.equal(send.statusCode, 200);
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].accountEmail, 'servecreusen@websoftora.com');
  assert.equal(adapterCalls[0].providerThreadId, flow.mail.providerThreadId);

  const duplicate = responseRecorder();
  await runtime.sendMessageResponse({ body: payload }, duplicate);
  assert.equal(adapterCalls.length, 1);
});

test('canonical source identity wins over stale opposite-provider sender while mismatched provenance fails closed', async () => {
  const instantlyMailboxService = createInstantlyService();
  const resolver = createMailboxComposeThreadContext({
    instantlyMailboxService,
    mailboxIndexStore: {
      getMessage: async ({ accountEmail }) => ({
        accountEmail, email: 'bestuur@mhcbe.nl', messageId: '<imap-inbound@example.nl>', references: '',
      }),
    },
    randomUUID: () => 'fixed-uuid',
  });
  const instantly = await resolver.resolve({
    accountEmail: 'martijn@softora.nl', recipientEmail: 'bestuur@mhcbe.nl', provider: 'instantly',
    body: {
      account: 'martijn@softora.nl', owner: 'both', mode: 'reply', idempotencyKey: 'stale-imap',
      replyIdentity: {
        version: 1, provider: 'instantly', owner: 'serve', accountEmail: 'servecreusen@websoftora.com',
        providerAccountEmail: 'servecreusen@websoftora.com', providerMessageId: 'message-1',
        providerThreadId: 'thread-1', conversationId: 'instantly:thread-1',
      },
      context: { conversationId: 'instantly:thread-1' },
    },
  });
  assert.equal(instantly.accountEmail, 'servecreusen@websoftora.com');
  assert.equal(instantly.owner, 'serve');

  const imap = await resolver.resolve({
    accountEmail: 'martijn@websoftora.com', recipientEmail: 'bestuur@mhcbe.nl', provider: 'instantly',
    body: {
      account: 'martijn@websoftora.com', owner: 'all', mode: 'reply', idempotencyKey: 'stale-instantly',
      replyIdentity: {
        version: 1, provider: 'smtp', owner: 'serve', accountEmail: 'serve@softora.nl',
        sourceMessageId: '<imap-inbound@example.nl>', conversationId: 'conversation:imap',
      },
      context: { id: 'inbox:1', folder: 'inbox', messageId: '<imap-inbound@example.nl>', conversationId: 'conversation:imap' },
    },
  });
  assert.equal(imap.accountEmail, 'serve@softora.nl');
  assert.equal(imap.provider, 'smtp');

  await assert.rejects(() => resolver.resolve({
    accountEmail: 'servecreusen@websoftora.com', recipientEmail: 'bestuur@mhcbe.nl', provider: 'instantly',
    body: {
      owner: 'martijn', mode: 'reply', idempotencyKey: 'wrong-owner',
      replyIdentity: {
        provider: 'instantly', owner: 'serve', accountEmail: 'servecreusen@websoftora.com',
        providerAccountEmail: 'servecreusen@websoftora.com', providerMessageId: 'message-1',
        providerThreadId: 'thread-1', conversationId: 'instantly:thread-1',
      },
      context: { conversationId: 'instantly:thread-1' },
    },
  }), (error) => error.code === 'INSTANTLY_REPLY_IDENTITY_MISMATCH');
});

test('ambiguous Instantly 5xx becomes reconcile-required and a retry never calls the adapter twice', async () => {
  let adapterCalls = 0;
  let intent = null;
  const provenanceStore = {
    async reserve(input) {
      if (intent) return { created: false, intent };
      intent = { ...input, status: 'prepared' };
      return { created: true, intent };
    },
    async startDispatch() {},
    async markUnknown(_intentId, _error, values) {
      intent = { ...intent, status: 'unknown', ...values };
      return intent;
    },
    async fail() { throw new Error('ambiguous outcome must not become failed'); },
  };
  const body = {
    provider: 'instantly', owner: 'martijn', account: 'martijn@websoftora.com',
    providerMessageId: 'message-1', providerThreadId: 'thread-1',
    to: 'bestuur@mhcbe.nl', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:ambiguous', idempotencyKey: 'browser:ambiguous', owner: 'martijn',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-1', replyTargetMessageId: 'message-1',
    references: 'message-1', provider: 'instantly', providerThreadId: 'thread-1',
  };
  const instantlyMailboxService = {
    async reply() {
      adapterCalls += 1;
      const error = new Error('provider unavailable');
      error.status = 503;
      throw error;
    },
  };
  const send = () => sendMailboxMessage({
    body, instantlyMailboxService, sendMessage: async () => {}, normalizeString,
    threadProvenance, mailboxSendProvenanceStore: provenanceStore,
  });
  await assert.rejects(send, (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  await assert.rejects(send, (error) => error.code === 'MAILBOX_SEND_ALREADY_PROCESSING');
  assert.equal(adapterCalls, 1);
  assert.equal(intent.status, 'unknown');
});

test('provider success followed by DB finalize failure records reconcile-required with provider IDs', async () => {
  let unknownValues = null;
  const provenanceStore = {
    async reserve(input) { return { created: true, intent: { ...input, status: 'prepared' } }; },
    async startDispatch() {},
    async accept() { throw new Error('database finalize unavailable'); },
    async markUnknown(_intentId, _error, values) { unknownValues = values; },
    async fail() {},
  };
  await assert.rejects(() => sendMailboxMessage({
    body: {
      provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
      providerMessageId: 'incoming-1', providerThreadId: 'thread-1',
      to: 'bestuur@mhcbe.nl', subject: 'Re: Vraag', body: 'Antwoord',
    },
    instantlyMailboxService: {
      async reply() {
        return {
          providerMessageId: 'outbound-1', providerThreadId: 'thread-1',
          sentMessage: { messageId: '<outbound-1@instantly>', receivedAt: '2026-08-13T10:00:00.000Z' },
        };
      },
    },
    sendMessage: async () => {}, normalizeString,
    threadProvenance: {
      intentId: 'send:finalize', idempotencyKey: 'browser:finalize', owner: 'serve',
      accountEmail: 'servecreusen@websoftora.com', recipientEmail: 'bestuur@mhcbe.nl', mode: 'reply',
      conversationId: 'instantly:thread-1', replyTargetMessageId: 'incoming-1', references: 'incoming-1',
      provider: 'instantly', providerThreadId: 'thread-1',
    },
    mailboxSendProvenanceStore: provenanceStore,
  }), (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.deepEqual(unknownValues, {
    messageId: '<outbound-1@instantly>',
    providerMessageId: 'outbound-1',
    sentReconcileRequired: true,
  });
});
