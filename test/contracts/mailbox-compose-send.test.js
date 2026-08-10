const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const {
  createMailboxSendIdentityKey,
  createMailboxSendScopeKey,
} = require('../../server/services/mailbox-send-provenance-store');
const { MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION } = require('../../server/services/mailbox-compose-email-renderer');

test('mailbox compose returns the exact accepted sent message for immediate reconciliation', async () => {
  const sentAt = new Date('2026-08-05T14:05:06.000Z');
  const sentCopies = [];
  const reservations = [];
  const sendMessage = createMailboxComposeSend({
    getAccount: () => ({
      email: 'serve@softora.nl',
      name: 'Servé Creusen',
      smtpConfigured: true,
      smtpIdentityMatches: true,
      smtpHost: 'smtp.example.test',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'serve@softora.nl',
      smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      sendMail: async () => ({
        messageId: '<accepted-compose@softora.nl>',
        accepted: ['ontvanger@example.nl'],
        rejected: [],
      }),
    }),
    buildMailboxWebdesignSendParts: async () => null,
    reserveMailboxWebdesignOutboundRecipient: async () => null,
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async (payload) => { sentCopies.push(payload); return true; },
    mailboxSendProvenanceStore: {
      reserve: async (payload) => {
        reservations.push(payload);
        return { created: true, intent: { intentId: payload.intentId, status: 'prepared' } };
      },
      accept: async (intentId, payload) => ({
        intentId,
        status: 'accepted',
        messageId: payload.messageId,
      }),
      fail: async () => null,
      markDispatchStarted: async (intentId) => ({ intentId, status: 'prepared', dispatchState: 'started' }),
    },
    now: () => sentAt,
    logger: { warn() {} },
  });

  const result = await sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'Ontvanger@Example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    subject: 'Re: Kleine vraag',
    text: 'Dankjewel voor je reactie 😁',
    threadProvenance: {
      intentId: 'send:test-1',
      idempotencyKey: 'test-1',
      owner: 'serve',
      accountEmail: 'serve@softora.nl',
      recipientEmail: 'ontvanger@example.nl',
      senderName: 'Servé Creusen',
      mode: 'reply',
      conversationId: 'conversation:serve@softora.nl|customer',
      replyTargetMessageId: '<received@example.nl>',
      references: '<original@example.nl> <received@example.nl>',
      messageId: '<planned-compose@softora.nl>',
      provider: 'smtp',
      providerThreadId: '',
    },
  });

  assert.equal(sentCopies.length, 1);
  assert.equal(sentCopies[0].mail.text, 'Dankjewel voor je reactie 😁');
  assert.match(sentCopies[0].mail.html, /class="softora-webdesign-email-body softora-mailbox-compose-body"/);
  assert.match(sentCopies[0].mail.html, /font-size:16px;line-height:26px/);
  assert.equal(sentCopies[0].mail.headers['X-Softora-Template-Version'], MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION);
  assert.equal(sentCopies[0].mail.inReplyTo, '<received@example.nl>');
  assert.equal(sentCopies[0].mail.references, '<original@example.nl> <received@example.nl>');
  assert.equal(sentCopies[0].mail.headers['X-Softora-Conversation-Id'], 'conversation:serve@softora.nl|customer');
  assert.equal(sentCopies[0].mail.headers['X-Softora-Send-Intent-Id'], 'send:test-1');
  assert.equal(reservations.length, 1);
  assert.equal(result.messageId, '<accepted-compose@softora.nl>');
  assert.deepEqual(result.sentMessage, {
    id: 'accepted-sent:<accepted-compose@softora.nl>',
    mailboxId: 'accepted-sent:<accepted-compose@softora.nl>',
    folder: 'sent',
    storageFolder: 'sent',
    direction: 'sent',
    accountEmail: 'serve@softora.nl',
    messageId: '<accepted-compose@softora.nl>',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'ontvanger@example.nl',
    toDisplay: 'ontvanger@example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    recipientRoutingEvidenceKnown: true,
    subject: 'Re: Kleine vraag',
    body: 'Dankjewel voor je reactie 😁',
    preview: 'Dankjewel voor je reactie 😁',
    receivedAt: sentAt.toISOString(),
    activityAt: sentAt.toISOString(),
    hasBody: true,
    bodyTruncated: false,
    unread: false,
    conversationId: 'conversation:serve@softora.nl|customer',
    softoraSendIntentId: 'send:test-1',
    softoraPayloadFingerprint: reservations[0].payloadFingerprint,
    softoraSendMode: 'reply',
    softoraReplyTargetMessageId: '<received@example.nl>',
  });
});

const baseAccount = {
  email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
  smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
  smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
};
const baseInput = {
  accountEmail: 'serve@softora.nl', to: 'klant@example.nl', cc: '', bcc: '',
  subject: 'Vraag', text: 'Bericht', threadProvenance: {
    intentId: 'send:one', idempotencyKey: 'browser:one', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'klant@example.nl',
    senderName: 'Servé Creusen', mode: 'new-message', conversationId: 'draft:klant',
    replyTargetMessageId: '', references: '', messageId: '<planned@softora.nl>',
    provider: 'smtp', providerThreadId: '',
  },
};

function durableMemoryStore(options = {}) {
  const intents = [];
  return {
    intents,
    async reserve(payload) {
      const identity = createMailboxSendIdentityKey(payload);
      const scope = createMailboxSendScopeKey(payload);
      const existing = intents.find((intent) => intent.idempotencyKey === payload.idempotencyKey ||
        (intent.sendIdentityKey === identity && ['prepared', 'unknown', 'accepted'].includes(intent.status)) ||
        (payload.mode === 'new-message' && intent.sendScopeKey === scope && ['prepared', 'unknown'].includes(intent.status)));
      if (existing) return { created: false, intent: existing };
      const intent = { ...payload, sendIdentityKey: identity, sendScopeKey: scope,
        status: 'prepared', dispatchState: 'reserved', reconcileRequired: false, sentReconcileRequired: false };
      intents.push(intent);
      return { created: true, intent };
    },
    async accept(intentId, values) {
      if (options.acceptFails) throw new Error('accept store down');
      const intent = intents.find((item) => item.intentId === intentId);
      Object.assign(intent, values, { status: 'accepted', dispatchState: 'finished' });
      return intent;
    },
    async markDispatchStarted(intentId) {
      const intent = intents.find((item) => item.intentId === intentId);
      Object.assign(intent, { dispatchState: 'started', reconcileRequired: true, sentReconcileRequired: true });
      return intent;
    },
    async markUnknown(intentId, error) {
      if (options.markUnknownFails) throw new Error('unknown store down');
      const intent = intents.find((item) => item.intentId === intentId);
      Object.assign(intent, { status: 'unknown', dispatchState: 'started', providerOutcomeUnknown: true,
        storageDegraded: true, reconcileRequired: true, error: error?.message });
      return intent;
    },
    async fail(intentId, error) {
      const intent = intents.find((item) => item.intentId === intentId);
      Object.assign(intent, { status: 'failed', dispatchState: 'finished', error: error?.message });
      return intent;
    },
  };
}

function composeHarness({ store = durableMemoryStore(), sendMail, appendSentMessage = async () => true,
  confirm = async () => {}, release = async () => ({ ok: true }), webdesignParts = null,
  transportFactory = null } = {}) {
  const transports = [];
  const sender = createMailboxComposeSend({
    getAccount: () => baseAccount, isValidEmail: () => true,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: (options) => {
      transports.push(options);
      return transportFactory ? transportFactory(options) : { sendMail };
    },
    buildMailboxWebdesignSendParts: async () => webdesignParts,
    reserveMailboxWebdesignOutboundRecipient: async (_identity, options) => ({ reservationId: options.reservationId }),
    confirmMailboxWebdesignOutboundRecipient: confirm, appendSentMessage,
    releaseMailboxWebdesignOutboundRecipient: release,
    mailboxSendProvenanceStore: store, logger: { error() {}, warn() {} },
    now: () => new Date('2026-08-10T11:00:00.000Z'),
  });
  return { sender, store, transports };
}

test('SMTP timeout na DATA blijft durable unknown en een nieuwe browserkey verzendt niet opnieuw', async () => {
  let providerSends = 0;
  const store = durableMemoryStore({ markUnknownFails: true });
  const { sender, transports } = composeHarness({
    store,
    sendMail: async () => {
      providerSends += 1;
      throw Object.assign(new Error('socket timeout after DATA'), { code: 'ETIMEDOUT', command: 'DATA' });
    },
  });
  const first = await sender(baseInput);
  const second = await sender({
    ...baseInput, subject: 'Gewijzigd', text: 'Andere inhoud', cc: 'cc@example.nl',
    threadProvenance: { ...baseInput.threadProvenance, intentId: 'send:two', idempotencyKey: 'browser:two' },
  });
  assert.equal(first.providerOutcomeUnknown, true);
  assert.equal(second.providerOutcomeUnknown, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(providerSends, 1);
  assert.equal(store.intents[0].status, 'prepared');
  assert.deepEqual(
    Object.fromEntries(['connectionTimeout', 'greetingTimeout', 'socketTimeout'].map((key) => [key, transports[0][key]])),
    { connectionTimeout: 45000, greetingTimeout: 30000, socketTimeout: 90000 }
  );
});

test('SMTP netwerkfouten blijven na sendMail-start unknown ongeacht DATA, CONN of ontbrekende fase', async (t) => {
  const scenarios = [
    { code: 'ECONNECTION', command: 'DATA' },
    { code: 'ECONNECTION' },
    { code: 'ECONNECTION', command: 'CONN' },
    { code: 'ETIMEDOUT' },
  ];
  for (const [index, failure] of scenarios.entries()) {
    await t.test(`${failure.code}:${failure.command || 'undefined'}`, async () => {
      let providerSends = 0;
      const store = durableMemoryStore();
      const { sender } = composeHarness({
        store, sendMail: async () => {
          providerSends += 1;
          throw Object.assign(new Error('connection outcome unknown'), failure);
        },
      });
      const first = await sender({
        ...baseInput,
        threadProvenance: { ...baseInput.threadProvenance, intentId: `send:network-${index}`,
          idempotencyKey: `browser:network-${index}` },
      });
      const replay = await sender({
        ...baseInput, text: 'Gewijzigd tijdens onzekerheid',
        threadProvenance: { ...baseInput.threadProvenance, intentId: `send:network-replay-${index}`,
          idempotencyKey: `browser:network-replay-${index}` },
      });
      assert.equal(first.providerOutcomeUnknown, true);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(providerSends, 1);
    });
  }
});

test('alleen een expliciete negatieve SMTP-reply markeert het intent definitief failed', async () => {
  const store = durableMemoryStore();
  const { sender } = composeHarness({
    store, sendMail: async () => {
      throw Object.assign(new Error('535 authentication rejected'), {
        code: 'EAUTH', command: 'AUTH', responseCode: 535,
      });
    },
  });
  await assert.rejects(() => sender(baseInput), { responseCode: 535 });
  assert.equal(store.intents[0].status, 'failed');
});

test('SMTP response-loss replayt accepted exact payload maar laat een echt volgend bericht toe', async () => {
  let providerSends = 0;
  const store = durableMemoryStore();
  const { sender } = composeHarness({
    store, sendMail: async () => ({
      messageId: `<accepted-${++providerSends}@softora.nl>`, accepted: ['klant@example.nl'], rejected: [],
    }),
  });
  const first = await sender(baseInput);
  const replay = await sender({
    ...baseInput,
    threadProvenance: { ...baseInput.threadProvenance, intentId: 'send:replay', idempotencyKey: 'browser:replay' },
  });
  const next = await sender({
    ...baseInput, text: 'Echt volgend bericht',
    threadProvenance: { ...baseInput.threadProvenance, intentId: 'send:next', idempotencyKey: 'browser:next' },
  });
  assert.equal(first.messageId, '<accepted-1@softora.nl>');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.messageId, first.messageId);
  assert.equal(next.messageId, '<accepted-2@softora.nl>');
  assert.equal(providerSends, 2);
});

test('na bewezen SMTP-acceptatie kunnen guard, Sent en provenance geen 500 of resend meer veroorzaken', async () => {
  let sends = 0;
  let releases = 0;
  const store = durableMemoryStore({ acceptFails: true });
  const { sender } = composeHarness({
    store,
    sendMail: async () => ({ messageId: '<accepted@softora.nl>',
      accepted: ['klant@example.nl'], rejected: ['cc@example.nl'] }),
    appendSentMessage: async () => { throw new Error('IMAP down'); },
    confirm: async () => { throw new Error('guard down'); },
    release: async () => { releases += 1; },
    webdesignParts: { text: 'Bericht', outboundIdentity: { recipientEmail: 'klant@example.nl' } },
  });
  const result = await sender({ ...baseInput, cc: 'cc@example.nl' });
  sends += 1;
  assert.equal(sends, 1);
  assert.equal(result.providerOutcomeUnknown, false);
  assert.equal(result.storageDegraded, true);
  assert.equal(result.deliveryDegraded, true);
  assert.equal(result.reconcileRequired, true);
  assert.deepEqual(result.accepted, ['klant@example.nl']);
  assert.deepEqual(result.rejected, ['cc@example.nl']);
  assert.equal(releases, 0);
});

test('alle definitief geweigerde SMTP-ontvangers falen vóór iedere accepted claim', async () => {
  const store = durableMemoryStore();
  const { sender } = composeHarness({
    store, sendMail: async () => ({ messageId: '', accepted: [], rejected: ['klant@example.nl'] }),
  });
  await assert.rejects(() => sender(baseInput), { code: 'MAILBOX_SMTP_RECIPIENTS_REJECTED' });
  assert.equal(store.intents[0].status, 'failed');
});

test('definitieve SMTP-rejectie geeft webdesign-guard vrij; unknown en accepted doen dat nooit', async () => {
  const webdesignParts = { text: 'Bericht', outboundIdentity: { recipientEmail: 'klant@example.nl' } };
  for (const scenario of ['rejected', 'unknown', 'accepted']) {
    let releases = 0;
    const store = durableMemoryStore();
    const { sender } = composeHarness({
      store, webdesignParts, release: async () => { releases += 1; },
      sendMail: async () => {
        if (scenario === 'rejected') {
          throw Object.assign(new Error('SMTP rejected'), { responseCode: 550, command: 'DATA' });
        }
        if (scenario === 'unknown') throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
        return { messageId: '<accepted-guard@softora.nl>', accepted: ['klant@example.nl'], rejected: [] };
      },
    });
    if (scenario === 'rejected') await assert.rejects(() => sender({ ...baseInput }));
    else await sender({ ...baseInput });
    assert.equal(releases, scenario === 'rejected' ? 1 : 0, scenario);
  }
});

test('createTransport-fout ruimt reserved provenance en webdesign-guard op vóór providerdispatch', async () => {
  const events = [];
  const store = durableMemoryStore();
  const { sender } = composeHarness({
    store,
    webdesignParts: { text: 'Bericht', outboundIdentity: { recipientEmail: 'klant@example.nl' } },
    release: async (intentId) => events.push(`release:${intentId}`),
    transportFactory: () => { throw new Error('transport config invalid'); },
  });
  await assert.rejects(() => sender(baseInput), /transport config invalid/);
  assert.deepEqual(events, ['release:send:one']);
  assert.equal(store.intents[0].status, 'failed');
  assert.equal(store.intents[0].dispatchState, 'finished');
});
