const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS,
  createInstantlyUnknownReplyReconciler,
} = require('../../server/services/mailbox-instantly-unknown-reply-reconcile');

const STARTED_AT = '2026-10-06T13:00:10.000Z';

function unknownIntent(overrides = {}) {
  return {
    intentId: 'send:kidssenz',
    idempotencyKey: 'browser:kidssenz',
    status: 'unknown',
    dispatchState: 'started',
    reconcileRequired: true,
    sentReconcileRequired: true,
    provider: 'instantly',
    mode: 'reply',
    owner: 'martijn',
    accountEmail: 'martijnven@websoftora.com',
    recipientEmail: 'info@kidssenz.nl',
    providerThreadId: 'thread-kidssenz',
    replyTargetMessageId: 'inbound-uuid',
    subject: 'Re: Kleine vraag over jullie website',
    dispatchStartedAt: STARTED_AT,
    ...overrides,
  };
}

function harness({ messages = [], nowIso, listError = null } = {}) {
  const calls = { list: [], accept: [], notSent: [] };
  const reconcile = createInstantlyUnknownReplyReconciler({
    instantlyMailboxService: {
      async listThreadMessages(input) {
        calls.list.push(input);
        if (listError) throw listError;
        return messages;
      },
    },
    mailboxSendProvenanceStore: {
      async accept(intentId, values) {
        calls.accept.push({ intentId, values });
        return unknownIntent({ status: 'accepted', dispatchState: 'finished', reconcileRequired: false,
          sentReconcileRequired: false, providerMessageId: values.providerMessageId });
      },
      async resolveUnknownAsNotSent(intentId, reason) {
        calls.notSent.push({ intentId, reason });
        return unknownIntent({ status: 'failed', dispatchState: 'finished', reconcileRequired: false,
          sentReconcileRequired: false });
      },
    },
    now: () => new Date(nowIso || STARTED_AT),
    logger: { warn() {} },
  });
  return { reconcile, calls };
}

function sentReply(overrides = {}) {
  return {
    direction: 'sent',
    originalCampaignOutbound: false,
    accountEmail: 'martijnven@websoftora.com',
    providerThreadId: 'thread-kidssenz',
    providerMessageId: 'reply-uuid',
    messageId: '<reply@instantly>',
    subject: 'Re:  Kleine vraag over jullie website',
    receivedAt: '2026-10-06T13:00:25.000Z',
    ...overrides,
  };
}

test('onzeker Instantly-antwoord dat in de thread staat wordt als verzonden vastgelegd', async () => {
  const { reconcile, calls } = harness({ messages: [sentReply()] });
  const result = await reconcile(unknownIntent());
  assert.equal(result.status, 'accepted');
  assert.deepEqual(calls.list, [{ threadId: 'thread-kidssenz', accountEmail: 'martijnven@websoftora.com' }]);
  assert.equal(calls.accept[0].values.providerMessageId, 'reply-uuid');
  assert.equal(calls.notSent.length, 0);
});

test('ontbrekend antwoord wordt pas na de wachttijd als niet verzonden vrijgegeven', async () => {
  const campaignOnly = [
    sentReply({ originalCampaignOutbound: true, providerMessageId: 'campaign', receivedAt: '2026-10-06T06:03:35.000Z' }),
    { ...sentReply({ providerMessageId: 'inbound-uuid' }), direction: 'received' },
  ];
  const early = harness({ messages: campaignOnly, nowIso: '2026-10-06T13:03:00.000Z' });
  assert.equal((await early.reconcile(unknownIntent())).status, 'unknown');
  assert.equal(early.calls.notSent.length, 0);

  const lateIso = new Date(Date.parse(STARTED_AT) + INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS + 1000).toISOString();
  const late = harness({ messages: campaignOnly, nowIso: lateIso });
  assert.equal((await late.reconcile(unknownIntent())).status, 'failed');
  assert.equal(late.calls.notSent.length, 1);
  assert.equal(late.calls.accept.length, 0);
});

test('oud antwoord van vóór de poging telt niet als bewijs van verzending', async () => {
  const lateIso = new Date(Date.parse(STARTED_AT) + INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS + 1000).toISOString();
  const { reconcile, calls } = harness({
    messages: [sentReply({ receivedAt: '2026-10-05T09:00:00.000Z' })],
    nowIso: lateIso,
  });
  assert.equal((await reconcile(unknownIntent())).status, 'failed');
  assert.equal(calls.accept.length, 0);
});

test('Instantly-fout laat de status onzeker en geeft niets vrij', async () => {
  const lateIso = new Date(Date.parse(STARTED_AT) + INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS + 1000).toISOString();
  const { reconcile, calls } = harness({ listError: new Error('Instantly down'), nowIso: lateIso });
  assert.equal((await reconcile(unknownIntent())).status, 'unknown');
  assert.equal(calls.accept.length + calls.notSent.length, 0);
});

test('alleen onzekere Instantly-antwoorden worden gecontroleerd', async () => {
  const { reconcile, calls } = harness({ messages: [sentReply()] });
  for (const intent of [
    unknownIntent({ provider: 'smtp' }),
    unknownIntent({ mode: 'new-message' }),
    unknownIntent({ status: 'prepared' }),
    unknownIntent({ providerThreadId: '' }),
  ]) {
    assert.equal(await reconcile(intent), intent);
  }
  assert.equal(calls.list.length, 0);
});

test('proof-only preflight lost een onzeker Instantly-antwoord via de thread op', async () => {
  const { createMailboxComposeRuntime } = require('../../server/services/mailbox-compose-runtime');
  const { createMailboxReconcileProof } = require('../../server/services/mailbox-send-reconcile-proof');
  const normalizeString = (value) => String(value || '').trim();
  const stored = unknownIntent({
    conversationId: 'conversation-kidssenz',
    references: 'inbound-uuid',
    sendScopeKey: `instantly-reply-scope:${'a'.repeat(64)}`,
    requestPayloadFingerprint: 'b'.repeat(64),
    attachmentsMetadata: [],
    messageId: '',
  });
  let current = stored;
  const runtime = createMailboxComposeRuntime({
    attachmentSigningSecret: 'unknown-reply-test-secret',
    composeSendDependencies: {},
    instantlyMailboxService: { async listThreadMessages() { return [sentReply()]; } },
    mailboxSendProvenanceStore: {
      async findByIdempotencyKey() { return current; },
      async reconcilePreflight() { return current; },
      async accept(intentId, values) {
        current = { ...current, status: 'accepted', dispatchState: 'finished', reconcileRequired: false,
          sentReconcileRequired: false, messageId: values.messageId, providerMessageId: values.providerMessageId,
          acceptedAt: values.acceptedAt };
        return current;
      },
      async resolveUnknownAsNotSent() { throw new Error('mag niet: antwoord staat in de thread'); },
    },
    normalizeEmail: (value) => normalizeString(value).toLowerCase(),
    normalizeString,
    logger: { error() {}, warn() {} },
  });
  const res = {
    statusCode: 0, body: null, setHeader() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  await runtime.preflightMessageResponse({
    body: {
      idempotencyKey: stored.idempotencyKey,
      reconcileProof: createMailboxReconcileProof(stored, normalizeString),
    },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.status, 'accepted');
  assert.equal(current.status, 'accepted');
});
