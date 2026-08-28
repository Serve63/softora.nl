const test = require('node:test');
const assert = require('node:assert/strict');

require('../../assets/premium-mailbox-reply-identity');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const { createControllerSendHarness } = require('../helpers/mailbox-compose-send-resilience');
const {
  withMailboxPreDispatchProvenance,
} = require('../helpers/mailbox-pre-dispatch-provenance-fixture');
const { createMailboxComposeThreadContext } = require('../../server/services/mailbox-compose-thread-context');
const {
  TEMPORARY_MAILBOX_SEND_MESSAGE,
  createMailboxComposeRuntime,
} = require('../../server/services/mailbox-compose-runtime');
const {
  createMailboxRequestPayloadFingerprint,
  createMailboxSendProvenanceStore,
} = require('../../server/services/mailbox-send-provenance-store');
const {
  createMailboxReconcileProof,
} = require('../../server/services/mailbox-send-reconcile-proof');
const { createInstantlyMailboxService } = require('../../server/services/instantly-mailbox');
const { sendMailboxMessage } = require('../../server/services/mailbox-instantly-integration');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeString = (value) => String(value || '').trim();
const allowingSuppressionStore = {
  findRecipientSuppressionConflict: async () => ({ ok: true, conflict: null }),
};

function createRequiredInstantlyProvenanceStore(overrides = {}) {
  return withMailboxPreDispatchProvenance({
    findByIdempotencyKey: async () => null,
    reserve: async (input) => ({ created: true, intent: { ...input, status: 'prepared' } }),
    startDispatch: async () => {},
    accept: async (intentId, values) => ({ intentId, ...values, status: 'accepted' }),
    fail: async (intentId) => ({ intentId, status: 'failed' }),
    markUnknown: async (intentId) => ({ intentId, status: 'unknown' }),
    ...overrides,
  });
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createInstantlyService(adapterCalls = [], onProviderCall = () => {}) {
  return {
    getConfiguredAccounts(owner) {
      return [{ email: owner === 'martijn' ? 'martijn@websoftora.com' : 'servecreusen@websoftora.com' }];
    },
    async assertStoredMessageOwnership(input) {
      return { ...input, providerOwner: input.owner, providerAccountEmail: input.accountEmail, email: 'bestuur@mhcbe.nl' };
    },
    async reply(input) {
      if (typeof input.onProviderDispatchStarting === 'function') {
        await input.onProviderDispatchStarting();
      }
      onProviderCall(input);
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
    sendResilience: createControllerSendHarness(),
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

test('SMTP-router geeft proof-gebonden bijlagemetadata exact door aan de compose-guard', async () => {
  const metadata = [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }];
  const calls = [];
  const onProviderDispatchStarting = async () => {};
  await sendMailboxMessage({
    body: {
      provider: '', account: 'serve@softora.nl', to: 'prospect@example.nl',
      subject: 'Bijlagebewijs', body: 'Zie de bijlage.', attachments: [{ reference: 'signed' }],
      attachmentsMetadata: metadata, reconcileProof: { version: 1 },
    },
    sendMessage: async (input) => { calls.push(input); return { ok: true }; },
    normalizeString,
    threadProvenance: threadProvenanceForRouter(),
    onProviderDispatchStarting,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].expectedAttachmentsMetadata, metadata);
  assert.strictEqual(calls[0].onProviderDispatchStarting, onProviderDispatchStarting);
});

function threadProvenanceForRouter() {
  return {
    intentId: 'send:router-proof', idempotencyKey: 'browser:router-proof', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'reply',
    conversationId: 'conversation:router-proof', replyTargetMessageId: '<incoming@example.nl>',
    references: '<incoming@example.nl>', provider: 'smtp', providerThreadId: '',
  };
}

test('rapid conversation switching sends only the exact latest opened message context', async () => {
  const requests = [];
  const acceptedRecords = [];
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
    conversationId: 'conversation:stale-root',
    threadMessages: [secondLatest],
  };
  const current = new Map([[first.id, first], [second.id, second]]);
  const controller = composeController.create({
    sendResilience: createControllerSendHarness(),
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
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            intentId: 'send:rapid-switch',
            messageId: '<rapid-switch@softora.nl>',
            sentMessage: {
              softoraSendIntentId: 'send:rapid-switch',
              messageId: '<rapid-switch@softora.nl>',
            },
          },
        }),
      };
    },
    onAcceptedSend: (record) => acceptedRecords.push(record),
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
  assert.equal(acceptedRecords.length, 1);
  assert.equal(acceptedRecords[0].sourceMailId, second.id);
  assert.equal(acceptedRecords[0].replyTarget.id, secondLatest.id);
  assert.equal(acceptedRecords[0].replyTarget.uid, secondLatest.uid);
});

test('captured MHCBE payload passes real preflight and selects only the exact mocked Instantly adapter', async () => {
  const flow = createMhcbePayloadCapture();
  flow.controller.reply(flow.mail);
  flow.values['c-body'].value = 'Veilige adaptertest.';
  await flow.controller.send();
  const payload = flow.requests[0].payload;
  payload.attachmentsMetadata = [];
  const adapterCalls = [];
  const providerEvents = [];
  const instantlyMailboxService = createInstantlyService(
    adapterCalls,
    () => providerEvents.push('provider')
  );
  const resolver = createMailboxComposeThreadContext({ instantlyMailboxService, randomUUID: () => 'fixed-uuid' });
  const previewStore = createMailboxSendProvenanceStore();
  const intents = new Map();
  const reservedInputs = [];
  const provenanceStore = withMailboxPreDispatchProvenance({
    preview: (input) => previewStore.preview(input),
    async findByIdempotencyKey(idempotencyKey) {
      return intents.get(idempotencyKey) || null;
    },
    async reserve(input) {
      reservedInputs.push(input);
      if (intents.has(input.idempotencyKey)) return { created: false, intent: intents.get(input.idempotencyKey) };
      const intent = { ...previewStore.preview(input), status: 'prepared', dispatchState: 'reserved' };
      intents.set(input.idempotencyKey, intent);
      return { created: true, intent };
    },
    async startDispatch(intentId) {
      const entry = Array.from(intents.values()).find((intent) => intent.intentId === intentId);
      if (entry) entry.dispatchState = 'started';
    },
    async accept(intentId, values) {
      const entry = Array.from(intents.values()).find((intent) => intent.intentId === intentId);
      const accepted = { ...entry, ...values, intentId, status: 'accepted', dispatchState: 'finished' };
      if (entry?.idempotencyKey) intents.set(entry.idempotencyKey, accepted);
      return accepted;
    },
    async fail(intentId) { return { intentId, status: 'failed' }; },
    async markUnknown(intentId) { return { intentId, status: 'unknown' }; },
  });
  const runtime = createMailboxComposeRuntime({
    composeSendDependencies: { outboundRecipientGuardStore: allowingSuppressionStore }, getAccount: () => null, instantlyMailboxService,
    mailboxComposeThreadContext: resolver, mailboxSendProvenanceStore: provenanceStore,
    normalizeEmail, normalizeString,
    onProviderDispatchStarting: async (event) => {
      providerEvents.push('callback');
      assert.deepEqual(event, { provider: 'instantly', intentId: 'send:fixed-uuid' });
    },
    logger: { error() {} },
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
  assert.equal(preflight.body.result.reconcileProof.version, 1);
  payload.reconcileProof = preflight.body.result.reconcileProof;

  const readyAfterDurableMiss = responseRecorder();
  await runtime.preflightMessageResponse({ body: payload }, readyAfterDurableMiss);
  assert.equal(readyAfterDurableMiss.statusCode, 200);
  assert.equal(readyAfterDurableMiss.body.result.status, 'ready');
  assert.equal(readyAfterDurableMiss.body.result.reservationReady, true);
  assert.deepEqual(readyAfterDurableMiss.body.result.reconcileProof, payload.reconcileProof);

  const mismatchedSend = responseRecorder();
  await runtime.sendMessageResponse({
    body: {
      ...payload,
      reconcileProof: {
        ...payload.reconcileProof,
        requestPayloadFingerprint: 'f'.repeat(64),
      },
    },
  }, mismatchedSend);
  assert.equal(mismatchedSend.statusCode, 409);
  assert.equal(mismatchedSend.body.code, 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH');
  assert.equal(reservedInputs.length, 0);
  assert.equal(adapterCalls.length, 0);
  assert.deepEqual(providerEvents, []);

  const send = responseRecorder();
  await runtime.sendMessageResponse({ body: payload }, send);
  assert.equal(send.statusCode, 200);
  assert.equal(send.headers['x-softora-provider-message-id'], 'provider-outbound-1');
  assert.equal(send.headers['x-softora-message-id'], '<provider-outbound-1@instantly>');
  assert.equal(send.headers['x-softora-send-intent-id'], send.body.result.intentId);
  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(providerEvents, ['callback', 'provider']);
  assert.equal(adapterCalls[0].accountEmail, 'servecreusen@websoftora.com');
  assert.equal(adapterCalls[0].providerThreadId, flow.mail.providerThreadId);
  assert.equal(reservedInputs[0].requestBody, 'Veilige adaptertest.');
  assert.deepEqual(reservedInputs[0].attachmentsMetadata, []);
  assert.equal(
    intents.get(payload.idempotencyKey).requestPayloadFingerprint,
    payload.reconcileProof.requestPayloadFingerprint
  );

  const duplicate = responseRecorder();
  await runtime.sendMessageResponse({ body: payload }, duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.result.idempotentReplay, true);
  assert.deepEqual(duplicate.body.result.sentMessage.attachments, []);
  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(providerEvents, ['callback', 'provider']);
});

test('Instantly callbackfout stopt na durable start maar vóór iedere providercall', async () => {
  const body = {
    provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
    providerMessageId: 'incoming-callback-failure', providerThreadId: 'thread-callback-failure',
    to: 'prospect@example.nl', cc: '', bcc: '', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:instantly-callback-failure', idempotencyKey: 'browser:instantly-callback-failure',
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: body.account,
    recipientEmail: body.to, mode: 'reply', conversationId: 'instantly:thread-callback-failure',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
  };
  const callbackError = Object.assign(new Error('router kon providerstart niet markeren'), {
    code: 'TEST_PROVIDER_START_CALLBACK_FAILED',
  });
  const events = [];
  let providerCalls = 0;

  await assert.rejects(() => sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply(input) {
        await input.onProviderDispatchStarting();
        providerCalls += 1;
      },
    },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance,
    mailboxSendProvenanceStore: createRequiredInstantlyProvenanceStore(),
    outboundRecipientGuardStore: allowingSuppressionStore,
    async onProviderDispatchStarting(event) {
      events.push(event);
      throw callbackError;
    },
  }), (error) => error === callbackError);

  assert.deepEqual(events, [{
    provider: 'instantly', intentId: 'send:instantly-callback-failure',
  }]);
  assert.equal(providerCalls, 0);
});

test('preflight classificeert accepted, processing en failed alleen na exact duurzaam context- en payloadbewijs', async (t) => {
  const attachmentsMetadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }];
  const body = {
    account: 'serve@softora.nl', owner: 'serve', provider: '', mode: 'reply',
    idempotencyKey: 'browser:preflight-proof', to: 'prospect@example.nl',
    subject: 'Veilige retry', body: 'Exact verzonden antwoord', cc: '', bcc: '',
    attachmentsMetadata,
  };
  const threadProvenance = {
    intentId: 'send:preflight-proof', idempotencyKey: body.idempotencyKey,
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: body.account,
    recipientEmail: body.to, mode: 'reply', conversationId: 'conversation:preflight-proof',
    replyTargetMessageId: '<incoming-preflight@example.nl>',
    references: '<root-preflight@example.nl> <incoming-preflight@example.nl>',
    messageId: '<planned-preflight@softora.nl>', provider: 'smtp', providerThreadId: '',
  };
  const requestPayloadFingerprint = createMailboxRequestPayloadFingerprint({
    subject: body.subject,
    requestBody: body.body,
    cc: body.cc,
    bcc: body.bcc,
    attachmentsMetadata,
  });
  const durable = {
    ...threadProvenance,
    subject: body.subject,
    body: body.body,
    cc: body.cc,
    bcc: body.bcc,
    attachmentsMetadata,
    requestPayloadFingerprint,
    sendScopeKey: 'smtp-reply-scope:0a89c3e97b717763dc6c3976e663cb67e28465bd1697f49dac51b0c25ea4c2e5',
    reconcileRequired: false,
    sentReconcileRequired: false,
    messageId: '<accepted-preflight@softora.nl>',
    acceptedAt: '2026-08-27T17:00:00.000Z',
  };
  function runtimeFor(conflict) {
    return createMailboxComposeRuntime({
      composeSendDependencies: {},
      mailboxComposeThreadContext: { async resolve() { return threadProvenance; } },
      mailboxSendProvenanceStore: {
        async preflight(input) {
          assert.equal(input.requestBody, input.body);
          assert.deepEqual(input.attachmentsMetadata, attachmentsMetadata);
          return { intent: input, conflict };
        },
      },
      normalizeEmail,
      normalizeString,
      logger: { error() {}, warn() {} },
    });
  }

  for (const [status, expected] of [
    ['accepted', 'accepted'], ['prepared', 'processing'], ['failed', 'failed'],
  ]) {
    await t.test(status, async () => {
      const response = responseRecorder();
      const dispatchState = status === 'accepted' || status === 'failed' ? 'finished' : 'reserved';
      await runtimeFor({ ...durable, status, dispatchState }).preflightMessageResponse({ body }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.result.status, expected);
      assert.equal(response.body.result.reservationReady, false);
      assert.equal(Boolean(response.body.result.acceptedResult), status === 'accepted');
      if (status === 'accepted') {
        assert.deepEqual(
          response.body.result.acceptedResult.sentMessage.attachments,
          durable.attachmentsMetadata
        );
        assert.equal(response.body.result.acceptedResult.sentMessage.body, durable.body);
        assert.equal(response.headers['x-softora-send-intent-id'], durable.intentId);
        assert.equal(response.headers['x-softora-message-id'], durable.messageId);
        assert.equal(response.headers['x-softora-provider-message-id'], undefined);
      }
    });
  }

  await t.test('context mismatch', async () => {
    const response = responseRecorder();
    await runtimeFor({ ...durable, status: 'accepted', dispatchState: 'finished', owner: 'martijn' })
      .preflightMessageResponse({ body }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH');
  });

  await t.test('payload mismatch', async () => {
    const response = responseRecorder();
    await runtimeFor({ ...durable, status: 'accepted', dispatchState: 'finished' }).preflightMessageResponse({
      body: { ...body, body: 'Later gewijzigde tekst' },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  for (const [label, attachments, fingerprint] of [
    ['legacy null', null, ''],
    ['malformed', [{ filename: '../kapot.pdf', contentType: 'text/html', size: 9_000_000 }], requestPayloadFingerprint],
    ['missing request fingerprint', attachmentsMetadata, ''],
  ]) {
    await t.test(label, async () => {
      const response = responseRecorder();
      await runtimeFor({
        ...durable,
        status: 'accepted',
        dispatchState: 'finished',
        attachmentsMetadata: attachments,
        requestPayloadFingerprint: fingerprint,
      }).preflightMessageResponse({ body }, response);
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
      assert.equal(response.body.result, undefined);
    });
  }
});

test('gemarkeerde preflight reconcileert duurzaam zonder de verdwenen replybron opnieuw te lezen', async (t) => {
  const previewStore = createMailboxSendProvenanceStore();
  const attachmentsMetadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }];
  const baseIntent = previewStore.preview({
    intentId: 'send:durable-reconcile', idempotencyKey: 'browser:durable-reconcile',
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl', mode: 'reply', provider: 'smtp',
    conversationId: 'conversation:durable-reconcile',
    replyTargetMessageId: '<incoming-durable@example.nl>',
    references: '<root-durable@example.nl> <incoming-durable@example.nl>',
    providerThreadId: '', messageId: '<planned-durable@softora.nl>',
    subject: 'Re: Veilige retry', body: 'Exact duurzaam antwoord',
    requestBody: 'Exact duurzaam antwoord', cc: '', bcc: '', attachmentsMetadata,
  });
  const proof = createMailboxReconcileProof(baseIntent, normalizeString);

  function runtimeFor(intent, counters = { resolver: 0 }) {
    return createMailboxComposeRuntime({
      composeSendDependencies: {},
      mailboxComposeThreadContext: {
        async resolve() {
          counters.resolver += 1;
          const error = new Error('mailbox index tijdelijk onbereikbaar');
          error.code = 'MAILBOX_REPLY_TARGET_UNAVAILABLE';
          throw error;
        },
      },
      mailboxSendProvenanceStore: {
        async findByIdempotencyKey(idempotencyKey) {
          assert.equal(idempotencyKey, intent?.idempotencyKey || baseIntent.idempotencyKey);
          return intent;
        },
        async reconcilePreflight(idempotencyKey, previouslyReadIntent) {
          assert.equal(idempotencyKey, intent?.idempotencyKey || baseIntent.idempotencyKey);
          assert.equal(previouslyReadIntent, intent);
          return intent;
        },
      },
      normalizeEmail,
      normalizeString,
      logger: { error() {}, warn() {} },
    });
  }

  for (const [label, intent, expected] of [
    ['accepted', {
      ...baseIntent, status: 'accepted', dispatchState: 'finished',
      messageId: '<accepted-durable@softora.nl>', acceptedAt: '2026-08-27T18:00:00.000Z',
    }, 'accepted'],
    ['unknown', {
      ...baseIntent, status: 'unknown', dispatchState: 'started', reconcileRequired: true,
    }, 'processing'],
    ['failed', { ...baseIntent, status: 'failed', dispatchState: 'finished' }, 'failed'],
  ]) {
    await t.test(label, async () => {
      const counters = { resolver: 0 };
      const response = responseRecorder();
      await runtimeFor(intent, counters).preflightMessageResponse({
        body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.result.status, expected);
      assert.equal(response.body.result.reservationReady, false);
      assert.deepEqual(response.body.result.reconcileProof, proof);
      assert.equal(counters.resolver, 0, 'de verdwenen mutable replybron mag niet worden gelezen');
      assert.equal(Boolean(response.body.result.acceptedResult), expected === 'accepted');
      if (expected === 'accepted') {
        assert.equal(response.headers['x-softora-send-intent-id'], intent.intentId);
        assert.equal(response.headers['x-softora-message-id'], intent.messageId);
        assert.equal(response.headers['x-softora-provider-message-id'], undefined);
      }
    });
  }

  await t.test('Instantly accepted-preflight zet alle identityheaders en vereist providerthread', async () => {
    const instantlyBaseIntent = previewStore.preview({
      intentId: 'send:durable-instantly-reconcile',
      idempotencyKey: 'browser:durable-instantly-reconcile',
      owner: 'serve',
      senderName: 'Servé Creusen',
      accountEmail: 'servecreusen@websoftora.com',
      recipientEmail: 'prospect@example.nl',
      mode: 'reply',
      provider: 'instantly',
      conversationId: 'instantly:thread-durable-reconcile',
      replyTargetMessageId: 'incoming-durable-instantly',
      references: 'incoming-durable-instantly',
      providerThreadId: 'thread-durable-reconcile',
      messageId: '<planned-durable-instantly@softora.nl>',
      subject: 'Re: Veilige Instantly-retry',
      body: 'Exact duurzaam Instantly-antwoord',
      requestBody: 'Exact duurzaam Instantly-antwoord',
      cc: '',
      bcc: '',
      attachmentsMetadata: [],
    });
    const instantlyProof = createMailboxReconcileProof(instantlyBaseIntent, normalizeString);
    const acceptedInstantlyIntent = {
      ...instantlyBaseIntent,
      status: 'accepted',
      dispatchState: 'finished',
      reconcileRequired: false,
      sentReconcileRequired: false,
      messageId: '<accepted-durable-instantly@softora.nl>',
      providerMessageId: 'accepted-durable-instantly',
      acceptedAt: '2026-08-27T18:05:00.000Z',
    };
    const acceptedResponse = responseRecorder();
    await runtimeFor(acceptedInstantlyIntent).preflightMessageResponse({
      body: {
        idempotencyKey: instantlyBaseIntent.idempotencyKey,
        reconcileProof: instantlyProof,
      },
    }, acceptedResponse);
    assert.equal(acceptedResponse.statusCode, 200);
    assert.equal(acceptedResponse.body.result.status, 'accepted');
    assert.equal(
      acceptedResponse.headers['x-softora-send-intent-id'],
      acceptedInstantlyIntent.intentId
    );
    assert.equal(
      acceptedResponse.headers['x-softora-message-id'],
      acceptedInstantlyIntent.messageId
    );
    assert.equal(
      acceptedResponse.headers['x-softora-provider-message-id'],
      acceptedInstantlyIntent.providerMessageId
    );

    const missingThreadResponse = responseRecorder();
    await runtimeFor({ ...acceptedInstantlyIntent, providerThreadId: '' })
      .preflightMessageResponse({
        body: {
          idempotencyKey: instantlyBaseIntent.idempotencyKey,
          reconcileProof: instantlyProof,
        },
      }, missingThreadResponse);
    assert.equal(missingThreadResponse.statusCode, 409);
    assert.equal(missingThreadResponse.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
    assert.deepEqual(missingThreadResponse.headers, {});
  });

  for (const [label, changedProof, code] of [
    ['account', { ...proof, accountEmail: 'martijn@softora.nl' }, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH'],
    ['owner', { ...proof, owner: 'martijn' }, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH'],
    ['scope hash', {
      ...proof, scopeFingerprint: `smtp-reply-scope:${'a'.repeat(64)}`,
    }, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH'],
    ['request hash', {
      ...proof, requestPayloadFingerprint: 'b'.repeat(64),
    }, 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH'],
    ['attachments', {
      ...proof,
      attachmentsMetadata: [{ filename: 'ander.pdf', contentType: 'application/pdf', size: 4 }],
    }, 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH'],
    ['malformed hash', {
      ...proof, requestPayloadFingerprint: 'geen-sha256',
    }, 'MAILBOX_SEND_RECONCILE_PROOF_INVALID'],
  ]) {
    await t.test(`fail closed bij verkeerde ${label}`, async () => {
      const counters = { resolver: 0 };
      const response = responseRecorder();
      await runtimeFor({
        ...baseIntent, status: 'unknown', dispatchState: 'started', reconcileRequired: true,
      }, counters).preflightMessageResponse({
        body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: changedProof },
      }, response);
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, code);
      assert.equal(counters.resolver, 0);
    });
  }

  await t.test('proof-only zonder duurzame row autoriseert nooit ready', async () => {
    let resolverCalls = 0;
    const response = responseRecorder();
    const runtime = createMailboxComposeRuntime({
      composeSendDependencies: {},
      mailboxComposeThreadContext: { async resolve() { resolverCalls += 1; } },
      mailboxSendProvenanceStore: { async findByIdempotencyKey() { return null; } },
      normalizeEmail,
      normalizeString,
      logger: { error() {}, warn() {} },
    });
    await runtime.preflightMessageResponse({
      body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED');
    assert.equal(resolverCalls, 0);
  });

  await t.test('dezelfde scope en payload met een andere idempotency key accepteert het proof nooit', async () => {
    const swappedIntent = {
      ...baseIntent,
      intentId: 'send:durable-reconcile-swapped',
      idempotencyKey: 'browser:durable-reconcile-swapped',
    };
    const response = responseRecorder();
    await runtimeFor(swappedIntent).preflightMessageResponse({
      body: { idempotencyKey: swappedIntent.idempotencyKey, reconcileProof: proof },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH');
  });

  await t.test('accepted zonder duurzame berichtidentiteit faalt gesloten', async () => {
    const response = responseRecorder();
    await runtimeFor({
      ...baseIntent, status: 'accepted', dispatchState: 'finished', messageId: '', providerMessageId: '',
    }).preflightMessageResponse({
      body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
  });

  await t.test('accepted met alleen het inkomende replydoel als berichtidentiteit faalt gesloten', async () => {
    const response = responseRecorder();
    await runtimeFor({
      ...baseIntent,
      status: 'accepted',
      dispatchState: 'finished',
      messageId: baseIntent.replyTargetMessageId,
      providerMessageId: '',
    }).preflightMessageResponse({
      body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
    assert.deepEqual(response.headers, {});
  });

  await t.test('terminale status met open reconcilevlag faalt gesloten', async () => {
    const response = responseRecorder();
    await runtimeFor({
      ...baseIntent, status: 'accepted', dispatchState: 'finished', reconcileRequired: true,
      messageId: '<accepted-but-unreconciled@softora.nl>',
    }).preflightMessageResponse({
      body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
  });

  await t.test('onbekende duurzame status faalt gesloten', async () => {
    const response = responseRecorder();
    await runtimeFor({ ...baseIntent, status: 'ready', dispatchState: 'finished' })
      .preflightMessageResponse({
        body: { idempotencyKey: baseIntent.idempotencyKey, reconcileProof: proof },
      }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
  });
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

test('accepted Instantly-replay leest eenmaal duurzaam en start geen suppression, reserve of provider', async () => {
  const counts = { find: 0, suppression: 0, reserve: 0, provider: 0, providerStart: 0 };
  const body = {
    provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
    providerMessageId: 'incoming-accepted', providerThreadId: 'thread-accepted',
    to: 'bestuur@mhcbe.nl', cc: '', bcc: '', subject: 'Re: Vraag',
    body: 'Exact verzonden antwoord',
  };
  const threadProvenance = {
    intentId: 'send:accepted-replay', idempotencyKey: 'browser:accepted-replay',
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: body.account,
    recipientEmail: body.to, mode: 'reply', conversationId: 'instantly:thread-accepted',
    replyTargetMessageId: 'incoming-accepted', references: 'incoming-accepted',
    provider: 'instantly', providerThreadId: 'thread-accepted',
  };
  const accepted = {
    ...threadProvenance,
    status: 'accepted',
    dispatchState: 'finished',
    reconcileRequired: false,
    sentReconcileRequired: false,
    subject: body.subject,
    body: body.body,
    cc: '',
    bcc: '',
    attachmentsMetadata: [],
    requestPayloadFingerprint: createMailboxRequestPayloadFingerprint({
      subject: body.subject, requestBody: body.body, cc: '', bcc: '', attachmentsMetadata: [],
    }),
    messageId: '<outbound-accepted@instantly>',
    providerMessageId: 'outbound-accepted',
    acceptedAt: '2026-08-27T15:00:00.000Z',
  };
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { counts.find += 1; return accepted; },
    async reserve() { counts.reserve += 1; throw new Error('reserve mag niet starten'); },
  });
  const result = await sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply() { counts.provider += 1; throw new Error('provider mag niet starten'); },
    },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        counts.suppression += 1;
        return { ok: true, conflict: null };
      },
    },
    onProviderDispatchStarting: async () => { counts.providerStart += 1; },
  });

  assert.equal(result.idempotentReplay, true);
  assert.equal(result.sentMessage.body, accepted.body);
  assert.deepEqual(result.sentMessage.attachments, accepted.attachmentsMetadata);
  assert.equal(result.sentMessage.attachmentEvidenceKnown, true);
  assert.deepEqual(counts, { find: 1, suppression: 0, reserve: 0, provider: 0, providerStart: 0 });

  accepted.attachmentsMetadata = null;
  await assert.rejects(() => sendMailboxMessage({
    body,
    instantlyMailboxService: { async reply() { counts.provider += 1; } },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: allowingSuppressionStore,
    onProviderDispatchStarting: async () => { counts.providerStart += 1; },
  }), (error) => error.status === 409 && error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.deepEqual(counts, { find: 2, suppression: 0, reserve: 0, provider: 0, providerStart: 0 });
});

test('accepted Instantly-replay faalt gesloten bij niet-terminale status of ontbrekende uitgaande identity', async (t) => {
  const body = {
    provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
    providerMessageId: 'incoming-invalid-accepted', providerThreadId: 'thread-invalid-accepted',
    to: 'bestuur@mhcbe.nl', cc: '', bcc: '', subject: 'Re: Vraag',
    body: 'Exact verzonden antwoord',
  };
  const threadProvenance = {
    intentId: 'send:invalid-accepted-replay', idempotencyKey: 'browser:invalid-accepted-replay',
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: body.account,
    recipientEmail: body.to, mode: 'reply', conversationId: 'instantly:thread-invalid-accepted',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
  };
  const baseAccepted = {
    ...threadProvenance,
    status: 'accepted', dispatchState: 'finished',
    reconcileRequired: false, sentReconcileRequired: false,
    subject: body.subject, body: body.body, cc: '', bcc: '', attachmentsMetadata: [],
    requestPayloadFingerprint: createMailboxRequestPayloadFingerprint({
      subject: body.subject, requestBody: body.body, cc: '', bcc: '', attachmentsMetadata: [],
    }),
    messageId: '<outbound-invalid-check@instantly>',
    providerMessageId: 'outbound-invalid-check',
    acceptedAt: '2026-08-27T15:00:00.000Z',
  };

  for (const [label, override] of [
    ['intent ontbreekt', { intentId: '' }],
    ['berichtidentiteit ontbreekt', { messageId: '', providerMessageId: '' }],
    ['berichtidentiteit is alleen het replydoel', {
      messageId: body.providerMessageId, providerMessageId: body.providerMessageId,
    }],
    ['providerthread ontbreekt', { providerThreadId: '' }],
    ['dispatch is nog gestart', { dispatchState: 'started' }],
    ['reconcile staat nog open', { reconcileRequired: true }],
    ['sent-reconcile staat nog open', { sentReconcileRequired: true }],
  ]) {
    await t.test(label, async () => {
      let providerCalls = 0;
      let reserveCalls = 0;
      const accepted = { ...baseAccepted, ...override };
      const effectiveThreadProvenance = override.providerThreadId === ''
        ? { ...threadProvenance, providerThreadId: '' }
        : threadProvenance;
      const provenanceStore = createRequiredInstantlyProvenanceStore({
        async findByIdempotencyKey() { return accepted; },
        async reserve() { reserveCalls += 1; throw new Error('reserve mag niet starten'); },
      });
      await assert.rejects(() => sendMailboxMessage({
        body,
        instantlyMailboxService: { async reply() { providerCalls += 1; } },
        sendMessage: async () => {},
        normalizeString,
        threadProvenance: effectiveThreadProvenance,
        mailboxSendProvenanceStore: provenanceStore,
        outboundRecipientGuardStore: allowingSuppressionStore,
      }), (error) => (
        error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
          && ['MAILBOX_SEND_ACCEPTED_IDENTITY_MISSING', 'MAILBOX_SEND_DURABLE_STATUS_INVALID']
            .includes(error.cause?.code)
      ));
      assert.equal(reserveCalls, 0);
      assert.equal(providerCalls, 0);
    });
  }
});

test('ambiguous Instantly 5xx becomes reconcile-required and a retry never calls the adapter twice', async () => {
  let adapterCalls = 0;
  let intent = null;
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { return intent; },
    async reserve(input) {
      if (intent) return { created: false, intent };
      intent = { ...input, status: 'prepared', dispatchState: 'reserved' };
      return { created: true, intent };
    },
    async startDispatch() { intent.dispatchState = 'started'; },
    async markUnknown(_intentId, _error, values) {
      intent = {
        ...intent, status: 'unknown', dispatchState: 'started', reconcileRequired: true, ...values,
      };
      return intent;
    },
    async fail() { throw new Error('ambiguous outcome must not become failed'); },
  });
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
    async reply(input) {
      await input.onProviderDispatchStarting();
      adapterCalls += 1;
      const error = new Error('provider unavailable');
      error.status = 503;
      throw error;
    },
  };
  const send = () => sendMailboxMessage({
    body, instantlyMailboxService, sendMessage: async () => {}, normalizeString,
    threadProvenance, mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: allowingSuppressionStore,
  });
  await assert.rejects(send, (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  await assert.rejects(send, (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.equal(adapterCalls, 1);
  assert.equal(intent.status, 'unknown');
});

test('lokale parse- of protocolfout na Instantly-providerstart wordt unknown zonder tweede providercall', async () => {
  const counts = { find: 0, suppression: 0, reserve: 0, provider: 0, fail: 0, unknown: 0 };
  let intent = null;
  const body = {
    provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
    providerMessageId: 'incoming-local-parse', providerThreadId: 'thread-local-parse',
    to: 'prospect@example.nl', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:local-parse', idempotencyKey: 'browser:local-parse', owner: 'serve',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-local-parse',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
  };
  const providerError = Object.assign(new SyntaxError('providerantwoord kon lokaal niet worden geparsed'), {
    status: 400,
    code: 'LOCAL_PROVIDER_PARSE_400',
  });
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { counts.find += 1; return intent; },
    async reserve(input) {
      counts.reserve += 1;
      intent = { ...input, status: 'prepared', dispatchState: 'reserved' };
      return { created: true, intent };
    },
    async startDispatch() {
      intent = { ...intent, dispatchState: 'started' };
      return intent;
    },
    async fail() {
      counts.fail += 1;
      throw new Error('lokale parsefout mag nooit definitief failed worden');
    },
    async markUnknown(_intentId, _error, values) {
      counts.unknown += 1;
      intent = {
        ...intent, ...values, status: 'unknown', dispatchState: 'started', reconcileRequired: true,
      };
      return intent;
    },
  });
  const send = () => sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply(input) {
        await input.onProviderDispatchStarting();
        counts.provider += 1;
        throw providerError;
      },
    },
    sendMessage: async () => {}, normalizeString, threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        counts.suppression += 1;
        return { ok: true, conflict: null };
      },
    },
  });

  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED' && error.cause === providerError
  ));
  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN'
  ));
  assert.equal(intent.status, 'unknown');
  assert.deepEqual(counts, {
    find: 2, suppression: 1, reserve: 1, provider: 1, fail: 0, unknown: 1,
  });
});

test('provider 200 plus lokale upsert-TypeError blijft accepted en kan niet opnieuw extern verzenden', async () => {
  const counts = { provider: 0, upsert: 0, accept: 0, fail: 0, unknown: 0 };
  let intent = null;
  const body = {
    provider: 'instantly', owner: 'serve', account: 'serve-sender@example.com',
    providerMessageId: 'incoming-accepted-local-failure', providerThreadId: 'thread-local-failure',
    to: 'prospect@example.org', cc: '', bcc: '', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:local-failure', idempotencyKey: 'browser:local-failure', owner: 'serve',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-local-failure',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
    messageId: '<incoming-parent-must-not-be-outbound@example.org>',
  };
  const mailboxIndexStore = {
    async getProviderMessage() {
      return {
        providerOwner: 'serve', providerAccountEmail: body.account,
        providerMessageId: body.providerMessageId, providerThreadId: body.providerThreadId,
        folder: 'inbox', email: body.to,
      };
    },
    async upsertProviderMessages() {
      counts.upsert += 1;
      throw new TypeError('lokale providerindex accepteert deze row niet');
    },
  };
  const instantlyMailboxService = createInstantlyMailboxService({
    config: {
      enabled: true, apiKey: 'instant-key', webhookSecret: 'webhook-secret',
      apiBaseUrl: 'https://api.instantly.test/api/v2',
      accountOwners: { 'serve-sender@example.com': 'serve' },
    },
    mailboxIndexStore,
    logger: { error() {} },
    fetchJsonWithTimeout: async (url) => {
      assert.equal(url.endsWith('/emails/reply'), true);
      counts.provider += 1;
      return {
        response: { ok: true, status: 200 },
        data: {
          id: 'provider-outbound-local-failure', thread_id: body.providerThreadId,
          body: { text: body.body }, timestamp_created: '2026-08-27T15:30:00.000Z',
        },
      };
    },
  });
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey(key) {
      return intent?.idempotencyKey === key ? intent : null;
    },
    async reserve(input) {
      if (intent) return { created: false, intent };
      intent = {
        ...input, status: 'prepared', dispatchState: 'reserved',
        requestPayloadFingerprint: createMailboxRequestPayloadFingerprint(input),
      };
      return { created: true, intent };
    },
    async startDispatch() { intent.dispatchState = 'started'; },
    async accept(_intentId, values) {
      counts.accept += 1;
      intent = {
        ...intent,
        ...values,
        status: 'accepted',
        dispatchState: 'finished',
        reconcileRequired: false,
        sentReconcileRequired: false,
      };
      return intent;
    },
    async fail() { counts.fail += 1; throw new Error('accepted provider mag nooit failed worden'); },
    async markUnknown() { counts.unknown += 1; throw new Error('provider-ID is duurzaam bekend'); },
  });
  const send = (provenance = threadProvenance) => sendMailboxMessage({
    body, instantlyMailboxService, sendMessage: async () => {}, normalizeString,
    threadProvenance: provenance, mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: allowingSuppressionStore,
  });

  const first = await send();
  const replay = await send();
  assert.equal(first.providerAccepted, true);
  assert.equal(first.localIndexStored, false);
  assert.equal(first.postAcceptWarningCode, 'INSTANTLY_REPLY_INDEX_STORE_FAILED');
  assert.equal(first.sentMessage.messageId, 'provider-outbound-local-failure');
  assert.notEqual(first.sentMessage.messageId, threadProvenance.messageId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(intent.messageId, 'provider-outbound-local-failure');

  await assert.rejects(() => send({
    ...threadProvenance,
    intentId: 'send:local-failure-new-key',
    idempotencyKey: 'browser:local-failure-new-key',
  }), (error) => error.code === 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH');
  assert.deepEqual(counts, { provider: 1, upsert: 1, accept: 1, fail: 0, unknown: 0 });
});

test('provider 200 met alleen teruggekaatste parent-ID wordt unknown en retryt de provider nooit', async () => {
  let providerCalls = 0;
  let intent = null;
  const body = {
    provider: 'instantly', owner: 'serve', account: 'serve-sender@example.com',
    providerMessageId: 'incoming-no-outbound-id', providerThreadId: 'thread-no-outbound-id',
    to: 'prospect@example.org', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:no-outbound-id', idempotencyKey: 'browser:no-outbound-id', owner: 'serve',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-no-outbound-id',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
    messageId: '<incoming-parent-must-not-be-outbound@example.org>',
  };
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { return intent; },
    async reserve(input) {
      intent = {
        ...input, status: 'prepared', dispatchState: 'reserved',
        requestPayloadFingerprint: createMailboxRequestPayloadFingerprint(input),
      };
      return { created: true, intent };
    },
    async startDispatch() { intent.dispatchState = 'started'; },
    async accept() { throw new Error('lege provideridentiteit mag nooit accepted worden'); },
    async fail() { throw new Error('provider gaf al 200'); },
    async markUnknown(_intentId, _error, values) {
      intent = {
        ...intent, ...values, status: 'unknown', dispatchState: 'started', reconcileRequired: true,
      };
      return intent;
    },
  });
  const send = () => sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply() {
        providerCalls += 1;
        return {
          providerAccepted: true,
          providerMessageId: body.providerMessageId,
          providerThreadId: body.providerThreadId,
          sentMessage: { messageId: body.providerMessageId },
        };
      },
    },
    sendMessage: async () => {}, normalizeString, threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: allowingSuppressionStore,
  });

  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'INSTANTLY_REPLY_ACCEPTED_IDENTITY_MISSING'
  ));
  await assert.rejects(send, (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.equal(providerCalls, 1);
  assert.equal(intent.status, 'unknown');
  assert.equal(intent.providerMessageId || '', '');
  assert.notEqual(intent.status, 'accepted');
});

test('provider success followed by DB finalize failure records reconcile-required with provider IDs', async () => {
  let unknownValues = null;
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { return null; },
    async reserve(input) { return { created: true, intent: { ...input, status: 'prepared' } }; },
    async accept() { throw new Error('database finalize unavailable'); },
    async markUnknown(_intentId, _error, values) { unknownValues = values; },
  });
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
    outboundRecipientGuardStore: allowingSuppressionStore,
  }), (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.deepEqual(unknownValues, {
    messageId: '<outbound-1@instantly>',
    providerMessageId: 'outbound-1',
    sentReconcileRequired: true,
  });
});

test('bewezen definitieve Instantly-afwijzing blijft failed en start bij retry geen provider', async () => {
  const counts = { find: 0, suppression: 0, reserve: 0, provider: 0, fail: 0, unknown: 0 };
  let intent = null;
  const body = {
    provider: 'instantly', owner: 'martijn', account: 'martijn@websoftora.com',
    providerMessageId: 'incoming-definitive-failed', providerThreadId: 'thread-definitive-failed',
    to: 'bestuur@mhcbe.nl', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:definitive-failed', idempotencyKey: 'browser:definitive-failed', owner: 'martijn',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-definitive-failed',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
  };
  const providerError = Object.assign(new Error('reply definitief afgewezen'), {
    status: 422,
    code: 'INSTANTLY_REPLY_REJECTED',
    mailboxProviderResponseReceived: true,
    providerStatus: 422,
  });
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { counts.find += 1; return intent; },
    async reserve(input) {
      counts.reserve += 1;
      intent = { ...input, status: 'prepared', dispatchState: 'reserved' };
      return { created: true, intent };
    },
    async startDispatch() {
      intent = { ...intent, dispatchState: 'started' };
      return intent;
    },
    async fail(_intentId, error) {
      counts.fail += 1;
      intent = { ...intent, status: 'failed', dispatchState: 'finished', error };
      return intent;
    },
    async markUnknown() {
      counts.unknown += 1;
      throw new Error('definitieve providerafwijzing mag niet unknown worden');
    },
  });
  const send = () => sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply(input) {
        await input.onProviderDispatchStarting();
        counts.provider += 1;
        throw providerError;
      },
    },
    sendMessage: async () => {}, normalizeString, threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        counts.suppression += 1;
        return { ok: true, conflict: null };
      },
    },
  });

  await assert.rejects(send, (error) => error === providerError && error.retryable === false);
  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_PREVIOUSLY_FAILED' && error.retryable === false
  ));
  assert.equal(intent.status, 'failed');
  assert.deepEqual(counts, {
    find: 2, suppression: 1, reserve: 1, provider: 1, fail: 1, unknown: 0,
  });
});

test('definitieve Instantly-fout plus mislukte fail-persist wordt unknown en dezelfde key start nooit een tweede provider', async () => {
  const counts = { find: 0, suppression: 0, reserve: 0, provider: 0, fail: 0, unknown: 0 };
  let intent = null;
  const body = {
    provider: 'instantly', owner: 'martijn', account: 'martijn@websoftora.com',
    providerMessageId: 'incoming-definitive', providerThreadId: 'thread-definitive',
    to: 'bestuur@mhcbe.nl', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:definitive', idempotencyKey: 'browser:definitive', owner: 'martijn',
    accountEmail: body.account, recipientEmail: body.to, mode: 'reply',
    conversationId: 'instantly:thread-definitive',
    replyTargetMessageId: 'incoming-definitive', references: 'incoming-definitive',
    provider: 'instantly', providerThreadId: 'thread-definitive',
  };
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { counts.find += 1; return intent; },
    async reserve(input) {
      counts.reserve += 1;
      intent = { ...input, status: 'prepared', dispatchState: 'reserved' };
      return { created: true, intent };
    },
    async startDispatch() { intent.dispatchState = 'started'; },
    async fail() {
      counts.fail += 1;
      throw Object.assign(new Error('fail-persist timeout'), { code: '57014' });
    },
    async markUnknown(_intentId, _error, values) {
      counts.unknown += 1;
      intent = {
        ...intent, ...values, status: 'unknown', dispatchState: 'started', reconcileRequired: true,
      };
      return intent;
    },
  });
  const send = () => sendMailboxMessage({
    body,
    instantlyMailboxService: {
      async reply(input) {
        await input.onProviderDispatchStarting();
        counts.provider += 1;
        throw Object.assign(new Error('reply rejected'), {
          status: 422,
          code: 'INSTANTLY_REPLY_REJECTED',
          mailboxProviderResponseReceived: true,
          providerStatus: 422,
        });
      },
    },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        counts.suppression += 1;
        return { ok: true, conflict: null };
      },
    },
  });

  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === '57014'
      && error.providerError?.status === 422
  ));
  await assert.rejects(send, (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN'
  ));
  assert.equal(intent.idempotencyKey, threadProvenance.idempotencyKey);
  assert.deepEqual(counts, {
    find: 2, suppression: 1, reserve: 1, provider: 1, fail: 1, unknown: 1,
  });
});

test('suppressed Instantly mailbox reply is blocked after one durable claim but before provider', async () => {
  let provenanceReads = 0;
  let reserveCalls = 0;
  let providerCalls = 0;
  await assert.rejects(() => sendMailboxMessage({
    body: {
      provider: 'instantly', owner: 'serve', account: 'serve@softora.nl',
      providerMessageId: 'incoming-suppressed', providerThreadId: 'thread-suppressed',
      to: 'contact@blocked.example', subject: 'Re: Vraag', body: 'Antwoord',
    },
    instantlyMailboxService: { async reply() { providerCalls += 1; } },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance: { mode: 'reply' },
    mailboxSendProvenanceStore: createRequiredInstantlyProvenanceStore({
      async findByIdempotencyKey() { provenanceReads += 1; return null; },
      async reserve() { reserveCalls += 1; return { created: true, intent: {} }; },
    }),
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        return {
          ok: true,
          conflict: { guard_key: 'domain:blocked-example', recipient_domain: 'blocked-example' },
        };
      },
    },
  }), (error) => error.code === 'OUTBOUND_RECIPIENT_SUPPRESSED' && error.status === 409);
  assert.equal(provenanceReads, 1);
  assert.equal(reserveCalls, 1);
  assert.equal(providerCalls, 0);
});

test('Instantly aborts a committed start-response-timeout before provider through the rotated started handle', async () => {
  const body = {
    provider: 'instantly', owner: 'serve', account: 'servecreusen@websoftora.com',
    providerMessageId: 'incoming-start-timeout', providerThreadId: 'thread-start-timeout',
    to: 'prospect@example.nl', cc: '', bcc: '', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const threadProvenance = {
    intentId: 'send:instantly-start-timeout', idempotencyKey: 'browser:instantly-start-timeout',
    owner: 'serve', senderName: 'Servé Creusen', accountEmail: body.account,
    recipientEmail: body.to, mode: 'reply', conversationId: 'instantly:thread-start-timeout',
    replyTargetMessageId: body.providerMessageId, references: body.providerMessageId,
    provider: 'instantly', providerThreadId: body.providerThreadId,
  };
  let intent = null;
  let providerCalls = 0;
  let suppressionReads = 0;
  let failedHandle = null;
  let startError = null;
  const provenanceStore = createRequiredInstantlyProvenanceStore({
    async findByIdempotencyKey() { return intent; },
    async reserve(input) {
      intent = { ...input, status: 'prepared', dispatchState: 'reserved' };
      return { created: true, intent };
    },
    async startDispatch() {
      intent = {
        ...intent,
        status: 'prepared',
        dispatchState: 'started',
        transitionToken: 'started-token',
        preDispatchClaimFingerprint: 'a'.repeat(64),
        preDispatchFinalizedAt: '2026-08-28T09:00:00.000Z',
        dispatchStartedAt: '2026-08-28T09:00:01.000Z',
      };
      startError = Object.assign(new Error('startresponse ging verloren'), {
        code: 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED',
        intent,
      });
      throw startError;
    },
    async failPreDispatch(handle) {
      failedHandle = handle;
      intent = { ...handle.intent, status: 'failed', dispatchState: 'finished' };
      return intent;
    },
  });

  await assert.rejects(() => sendMailboxMessage({
    body,
    instantlyMailboxService: { async reply() { providerCalls += 1; } },
    sendMessage: async () => {},
    normalizeString,
    threadProvenance,
    mailboxSendProvenanceStore: provenanceStore,
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        suppressionReads += 1;
        return { ok: true, conflict: null };
      },
    },
  }), (error) => error === startError);

  assert.equal(providerCalls, 0);
  assert.equal(suppressionReads, 1);
  assert.equal(intent.status, 'failed');
  assert.equal(intent.dispatchState, 'finished');
  assert.equal(failedHandle.intent.transitionToken, 'started-token');
  assert.equal(failedHandle.finalToken, 'started-token');
});

test('mailbox send response hides raw Supabase cooldown details behind a safe retryable message', async () => {
  const runtime = createMailboxComposeRuntime({
    composeSendDependencies: {},
    getAccount: () => null,
    instantlyMailboxService: null,
    mailboxComposeThreadContext: {
      async resolve() {
        const error = new Error(
          'Supabase REST tijdelijk overgeslagen na timeout/504 (23s cooldown). Supabase client timeout na 1500ms.'
        );
        error.code = 'SUPABASE_REST_COOLDOWN';
        error.status = 503;
        throw error;
      },
    },
    mailboxSendProvenanceStore: null,
    normalizeEmail,
    normalizeString,
    logger: { error() {} },
  });
  const response = responseRecorder();

  await runtime.sendMessageResponse({ body: {
    account: 'serve@softora.nl', to: 'prospect@example.nl', subject: 'Re: Website',
    body: 'Dit concept moet blijven staan.', mode: 'reply', idempotencyKey: 'browser:safe-error',
  } }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    ok: false,
    code: 'MAILBOX_SEND_TEMPORARY',
    error: 'Mail niet verzonden',
    detail: TEMPORARY_MAILBOX_SEND_MESSAGE,
    retryable: true,
  });
  assert.match(response.body.detail, /niet verzonden.*concept blijft staan.*probeer het opnieuw/i);
  assert.doesNotMatch(JSON.stringify(response.body), /Supabase|REST|504|cooldown|1500ms|23s/i);
});
