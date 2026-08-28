const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const { MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION } = require('../../server/services/mailbox-compose-email-renderer');
const { createMailboxSendProvenanceStore } = require('../../server/services/mailbox-send-provenance-store');
const {
  withMailboxPreDispatchProvenance,
} = require('../helpers/mailbox-pre-dispatch-provenance-fixture');

function createAllowingSuppressionStore() {
  return { findRecipientSuppressionConflict: async () => ({ ok: true, conflict: null }) };
}

function createComposeEdgeHarness(overrides = {}) {
  const calls = [];
  const content = Buffer.from([1, 2, 3, 4]);
  const attachmentsMetadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }];
  const threadProvenance = {
    intentId: 'send:compose-edge', idempotencyKey: 'browser:compose-edge', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl',
    senderName: 'Servé Creusen', mode: 'reply', conversationId: 'conversation:compose-edge',
    replyTargetMessageId: '<incoming@example.nl>', references: '<incoming@example.nl>',
    messageId: '<planned@softora.nl>', provider: 'smtp', providerThreadId: '',
  };
  const claimIntent = {
    ...threadProvenance, subject: 'Re: Website', body: 'Dankjewel voor je reactie.',
    requestBody: 'Dankjewel voor je reactie.', cc: '', bcc: '', attachmentsMetadata,
    status: 'prepared', dispatchState: 'reserved', transitionToken: 'claim-token',
    preDispatchClaimFingerprint: 'a'.repeat(64), preDispatchFinalizedAt: '',
  };
  const finalIntent = {
    ...claimIntent, transitionToken: 'final-token',
    preDispatchFinalizedAt: '2026-08-28T08:00:00.000Z',
  };
  const startedIntent = {
    ...finalIntent, dispatchState: 'started', transitionToken: 'started-token',
    dispatchStartedAt: '2026-08-28T08:00:01.000Z',
  };
  let failedHandle = null;
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        calls.push('suppression');
        return { ok: true, conflict: null };
      },
    },
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
      smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
      smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: (config) => {
      calls.push('transport');
      if (overrides.createTransport) return overrides.createTransport(config, calls);
      return {
        async sendMail() {
          calls.push('provider');
          return { messageId: '<accepted@softora.nl>', accepted: ['prospect@example.nl'], rejected: [] };
        },
      };
    },
    buildMailboxWebdesignSendParts: async () => {
      calls.push('builder');
      return {
        text: claimIntent.body, html: '<p>Dankjewel voor je reactie.</p>', attachments: [],
        outboundIdentity: { recipientEmail: claimIntent.recipientEmail },
      };
    },
    reserveMailboxWebdesignOutboundRecipient: async (_identity, options) => {
      calls.push(`guard:reserve:${options.reservationId}`);
      if (overrides.reserveGuard) return overrides.reserveGuard(options);
      return { reservationId: 'guard-compose-edge' };
    },
    releaseMailboxWebdesignOutboundRecipient: async (reservationId) => {
      calls.push(`guard:release:${reservationId}`);
      if (overrides.releaseGuard) return overrides.releaseGuard(reservationId);
      return undefined;
    },
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async () => true,
    mailboxAttachmentService: {
      downloadAttachments: async () => {
        calls.push('attachments:download');
        return [{ ...attachmentsMetadata[0], content, contentDisposition: 'attachment' }];
      },
      cleanupAttachments: async () => { calls.push('attachments:cleanup'); },
    },
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => null,
      claimPreDispatch: async () => {
        calls.push('provenance:claim');
        return { created: true, intent: claimIntent, claimToken: 'claim-token' };
      },
      finalizeClaim: async () => {
        calls.push('provenance:finalize');
        return { intent: finalIntent, finalToken: 'final-token' };
      },
      startDispatch: async () => {
        calls.push('provenance:start');
        return startedIntent;
      },
      failPreDispatch: async (handle) => {
        calls.push('provenance:abort');
        failedHandle = handle;
        return { ...handle.intent, status: 'failed', dispatchState: 'finished' };
      },
      fail: async (intentId, error) => {
        calls.push('provenance:fail');
        if (overrides.failProvenance) return overrides.failProvenance(intentId, error);
        return { intentId, status: 'failed', dispatchState: 'finished' };
      },
      accept: async () => ({ intentId: threadProvenance.intentId, status: 'accepted' }),
      markUnknown: async () => {},
    },
    logger: { warn() {}, error() {} },
  });
  return {
    attachmentsMetadata, calls, claimIntent, finalIntent,
    getFailedHandle: () => failedHandle,
    send: () => sendMessage({
      accountEmail: 'serve@softora.nl', to: 'prospect@example.nl',
      subject: claimIntent.subject, text: claimIntent.body,
      attachments: [{ reference: 'signed-compose-edge' }],
      expectedAttachmentsMetadata: attachmentsMetadata,
      threadProvenance,
    }),
    startedIntent,
  };
}

test('mailbox compose returns the exact accepted sent message for immediate reconciliation', async () => {
  const sentAt = new Date('2026-08-05T14:05:06.000Z');
  const sentCopies = [];
  const reservations = [];
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
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
    mailboxSendProvenanceStore: withMailboxPreDispatchProvenance({
      findByIdempotencyKey: async () => null,
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
    }),
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
  assert.deepEqual(reservations[0].attachmentsMetadata, []);
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
    attachments: [],
    attachmentEvidenceKnown: true,
    attachmentHydrationAttempted: true,
    conversationId: 'conversation:serve@softora.nl|customer',
    softoraSendIntentId: 'send:test-1',
    softoraSendMode: 'reply',
    softoraReplyTargetMessageId: '<received@example.nl>',
  });
});

test('mailbox compose claims and finalizes durably before suppression, then blocks before SMTP', async () => {
  let smtpCalls = 0;
  let provenanceCalls = 0;
  let checkedIdentities = [];
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict(identities) {
        checkedIdentities = identities;
        return {
          ok: true,
          conflict: {
            guard_key: 'domain:blocked-example',
            recipient_domain: 'blocked-example',
            suppressed: true,
            permanent: true,
          },
        };
      },
    },
    getAccount: () => ({
      email: 'serve@softora.nl', smtpConfigured: true, smtpIdentityMatches: true,
      smtpHost: 'smtp.example.test', smtpPort: 465, smtpSecure: true,
      smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({ sendMail: async () => { smtpCalls += 1; } }),
    buildMailboxWebdesignSendParts: async () => null,
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: withMailboxPreDispatchProvenance({
      findByIdempotencyKey: async () => null,
      reserve: async () => { provenanceCalls += 1; return { created: true, intent: {} }; },
    }),
  });

  await assert.rejects(() => sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'allowed@example.test',
    cc: 'contact@blocked.example',
    bcc: 'audit@example.test',
    subject: 'Mag niet weg',
    text: 'Concept',
    threadProvenance: {
      intentId: 'send:suppressed', idempotencyKey: 'suppressed', owner: 'serve',
      accountEmail: 'serve@softora.nl', recipientEmail: 'allowed@example.test',
      mode: 'new-message', conversationId: '', messageId: '<planned@softora.nl>', provider: 'smtp',
    },
  }), (error) => error.code === 'OUTBOUND_RECIPIENT_SUPPRESSED' && error.status === 409);

  assert.deepEqual(checkedIdentities.map((identity) => identity.recipientEmail), [
    'allowed@example.test', 'contact@blocked.example', 'audit@example.test',
  ]);
  assert.equal(provenanceCalls, 1);
  assert.equal(smtpCalls, 0);
});

test('mailbox compose stays fail-closed before SMTP when the isolated provenance guard remains unavailable', async () => {
  let provenanceCalls = 0;
  let smtpCalls = 0;
  const timeoutError = new Error('Supabase client timeout na 8000ms');
  timeoutError.name = 'AbortError';
  timeoutError.code = '57014';
  const query = {
    insert() { return query; },
    select() { return query; },
    eq() { return query; },
    async maybeSingle() {
      provenanceCalls += 1;
      return { data: null, error: timeoutError };
    },
    async single() { return { data: null, error: timeoutError }; },
  };
  const provenanceStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from: () => query,
      rpc: async () => ({ data: null, error: timeoutError }),
    }),
    retryDelayMs: 0,
  });
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
      smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
      smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      async sendMail() {
        smtpCalls += 1;
        return { messageId: '<must-not-exist@softora.nl>' };
      },
    }),
    buildMailboxWebdesignSendParts: async () => null,
    reserveMailboxWebdesignOutboundRecipient: async () => null,
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: provenanceStore,
    logger: { warn() {}, error() {} },
  });

  await assert.rejects(() => sendMessage({
    accountEmail: 'serve@softora.nl', to: 'prospect@example.nl', subject: 'Re: Website',
    text: 'Dankjewel voor je reactie.', attachments: [],
    threadProvenance: {
      intentId: 'send:guard-outage', idempotencyKey: 'browser:guard-outage', owner: 'serve',
      accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl',
      senderName: 'Servé Creusen', mode: 'reply', conversationId: 'conversation:guard-outage',
      replyTargetMessageId: '<incoming@example.nl>', references: '<incoming@example.nl>',
      messageId: '<planned@softora.nl>', provider: 'smtp', providerThreadId: '',
    },
  }), (error) => error.code === '57014' && error.status === 503);

  assert.equal(
    provenanceCalls,
    2,
    'de geïsoleerde claim-readback mag begrensd herstellen zonder SMTP te starten'
  );
  assert.equal(smtpCalls, 0, 'SMTP mag nooit starten zonder duurzame prepared provenance');
});

test('mailbox compose starts and completes the Sent copy when provenance finalization fails after SMTP accept', async () => {
  const calls = [];
  let releaseSentCopy;
  let sentCopyStartedResolve;
  const sentCopyStarted = new Promise((resolve) => { sentCopyStartedResolve = resolve; });
  const finalizeError = new Error('Supabase accepted update timeout');
  finalizeError.code = '57014';
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
      smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
      smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
      imapHost: 'imap.example.test', imapUser: 'serve@softora.nl', imapPass: 'imap-secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      async sendMail() {
        calls.push('smtp');
        return {
          messageId: '<accepted-before-db-timeout@softora.nl>',
          accepted: ['prospect@example.nl'], rejected: [],
        };
      },
    }),
    buildMailboxWebdesignSendParts: async () => null,
    reserveMailboxWebdesignOutboundRecipient: async () => null,
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async () => {
      calls.push('sent-copy:start');
      sentCopyStartedResolve();
      return new Promise((resolve) => { releaseSentCopy = resolve; });
    },
    mailboxSendProvenanceStore: withMailboxPreDispatchProvenance({
      findByIdempotencyKey: async () => null,
      reserve: async (input) => ({ created: true, intent: { ...input, status: 'prepared' } }),
      startDispatch: async () => calls.push('provenance:start'),
      accept: async () => {
        calls.push('provenance:accept-failed');
        throw finalizeError;
      },
      markUnknown: async (_intentId, _error, values) => {
        calls.push(['provenance:unknown', values]);
      },
      fail: async () => null,
    }),
    logger: { warn() {}, error() {} },
  });

  const sendPromise = sendMessage({
    accountEmail: 'serve@softora.nl', to: 'prospect@example.nl', subject: 'Re: Website',
    text: 'Dankjewel voor je reactie.', attachments: [],
    threadProvenance: {
      intentId: 'send:accepted-db-timeout', idempotencyKey: 'browser:accepted-db-timeout', owner: 'serve',
      accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl',
      senderName: 'Servé Creusen', mode: 'reply', conversationId: 'conversation:accepted-db-timeout',
      replyTargetMessageId: '<incoming@example.nl>', references: '<incoming@example.nl>',
      messageId: '<planned@softora.nl>', provider: 'smtp', providerThreadId: '',
    },
  });

  await Promise.race([
    sentCopyStarted,
    sendPromise.then(() => { throw new Error('Sent-kopie werd niet gestart.'); }, () => {
      throw new Error('De response werd afgehandeld voordat de Sent-kopie klaar was.');
    }),
  ]);
  assert.ok(calls.indexOf('smtp') < calls.indexOf('sent-copy:start'));
  assert.ok(calls.indexOf('smtp') < calls.indexOf('provenance:accept-failed'));
  releaseSentCopy(true);

  await assert.rejects(sendPromise, (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED');
  const unknownCall = calls.find((entry) => Array.isArray(entry) && entry[0] === 'provenance:unknown');
  assert.deepEqual(unknownCall[1], {
    messageId: '<accepted-before-db-timeout@softora.nl>',
    sentReconcileRequired: true,
  });
});

test('mailbox compose aborts a committed start-response-timeout before SMTP and releases its guard', async () => {
  const calls = [];
  const baseIntent = {
    intentId: 'send:start-response-timeout',
    idempotencyKey: 'browser:start-response-timeout',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl',
    mode: 'reply',
    conversationId: 'conversation:start-response-timeout',
    replyTargetMessageId: '<incoming@example.nl>',
    references: '<incoming@example.nl>',
    provider: 'smtp',
    providerThreadId: '',
    messageId: '<planned@softora.nl>',
    senderName: 'Servé Creusen',
    subject: 'Re: Website',
    body: 'Dankjewel voor je reactie.',
    cc: '',
    bcc: '',
    attachmentsMetadata: [],
    preDispatchClaimFingerprint: 'a'.repeat(64),
    status: 'prepared',
    dispatchState: 'reserved',
  };
  const claimIntent = { ...baseIntent, transitionToken: 'claim-token', preDispatchFinalizedAt: '' };
  const finalIntent = {
    ...claimIntent,
    transitionToken: 'final-token',
    preDispatchFinalizedAt: '2026-08-28T08:00:00.000Z',
  };
  const startedIntent = {
    ...finalIntent,
    dispatchState: 'started',
    transitionToken: 'started-token',
    dispatchStartedAt: '2026-08-28T08:00:01.000Z',
  };
  const startError = Object.assign(new Error('start committeerde maar response ging verloren'), {
    code: 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED',
    intent: startedIntent,
  });
  let failedHandle = null;
  let providerCalls = 0;
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
      smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
      smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      async sendMail() { providerCalls += 1; },
    }),
    buildMailboxWebdesignSendParts: async () => ({
      text: baseIntent.body,
      html: '<p>Dankjewel voor je reactie.</p>',
      attachments: [],
      outboundIdentity: { recipientEmail: baseIntent.recipientEmail },
    }),
    reserveMailboxWebdesignOutboundRecipient: async () => {
      calls.push('guard:reserve');
      return { reservationId: 'mailbox-guard-start-timeout' };
    },
    releaseMailboxWebdesignOutboundRecipient: async (reservationId) => {
      calls.push(`guard:release:${reservationId}`);
    },
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => null,
      claimPreDispatch: async () => ({ created: true, intent: claimIntent, claimToken: 'claim-token' }),
      finalizeClaim: async () => ({ intent: finalIntent, finalToken: 'final-token' }),
      startDispatch: async () => { calls.push('provenance:start'); throw startError; },
      failPreDispatch: async (handle) => {
        calls.push('provenance:abort-started');
        failedHandle = handle;
        return { ...handle.intent, status: 'failed', dispatchState: 'finished' };
      },
      accept: async () => { throw new Error('accept mag niet starten'); },
      fail: async () => { throw new Error('post-provider fail mag niet starten'); },
      markUnknown: async () => { throw new Error('unknown mag niet starten'); },
    },
    logger: { warn() {}, error() {} },
  });

  await assert.rejects(sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'prospect@example.nl',
    subject: baseIntent.subject,
    text: baseIntent.body,
    attachments: [],
    threadProvenance: baseIntent,
  }), (error) => error === startError);

  assert.equal(providerCalls, 0);
  assert.equal(failedHandle.intent.transitionToken, 'started-token');
  assert.equal(failedHandle.finalToken, 'started-token');
  assert.deepEqual(calls, [
    'guard:reserve',
    'provenance:start',
    'provenance:abort-started',
    'guard:release:mailbox-guard-start-timeout',
  ]);
});

test('synchrone transportconstructiefout wordt exact vóór provider failed en ruimt guard plus staging op', async () => {
  const transportError = Object.assign(new Error('transportconfig ongeldig'), { code: 'ECONFIG' });
  const harness = createComposeEdgeHarness({
    createTransport: () => { throw transportError; },
  });

  await assert.rejects(harness.send(), (error) => error === transportError);

  assert.equal(harness.calls.includes('provider'), false);
  assert.equal(harness.calls.filter((call) => call === 'provenance:abort').length, 1);
  assert.equal(harness.getFailedHandle().intent.transitionToken, 'started-token');
  assert.equal(harness.getFailedHandle().finalToken, 'started-token');
  assert.ok(harness.calls.indexOf('provenance:start') < harness.calls.indexOf('transport'));
  assert.ok(harness.calls.indexOf('provenance:abort') < harness.calls.indexOf('guard:release:guard-compose-edge'));
  assert.ok(harness.calls.indexOf('guard:release:guard-compose-edge') < harness.calls.indexOf('attachments:cleanup'));
});

test('definitieve SMTP-afwijzing wordt durable failed en geeft guard plus staging vrij', async () => {
  const smtpError = Object.assign(new Error('550 mailbox unavailable'), {
    code: 'EENVELOPE', responseCode: 550,
  });
  const harness = createComposeEdgeHarness({
    createTransport: (_config, calls) => ({
      async sendMail() {
        calls.push('provider');
        throw smtpError;
      },
    }),
  });

  await assert.rejects(harness.send(), (error) => error === smtpError && error.retryable === false);

  assert.equal(harness.calls.filter((call) => call === 'provider').length, 1);
  assert.equal(harness.calls.filter((call) => call === 'provenance:fail').length, 1);
  assert.equal(harness.calls.includes('provenance:abort'), false);
  assert.ok(harness.calls.indexOf('provider') < harness.calls.indexOf('provenance:fail'));
  assert.ok(harness.calls.indexOf('provenance:fail') < harness.calls.indexOf('guard:release:guard-compose-edge'));
  assert.ok(harness.calls.indexOf('guard:release:guard-compose-edge') < harness.calls.indexOf('attachments:cleanup'));
});

test('webdesign-guard responseverlies gebruikt de bekende ID en releaseverlies wordt reconcile-required', async (t) => {
  for (const releaseSucceeds of [true, false]) {
    await t.test(releaseSucceeds ? 'release bevestigd' : 'release niet bevestigd', async () => {
      const reserveError = Object.assign(new Error('guard committeerde maar response ging verloren'), {
        code: 'ETIMEDOUT',
      });
      const releaseError = Object.assign(new Error('guard release niet bevestigd'), {
        code: 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_RELEASE_FAILED', status: 503,
      });
      const harness = createComposeEdgeHarness({
        reserveGuard: async () => { throw reserveError; },
        releaseGuard: async () => {
          if (!releaseSucceeds) throw releaseError;
        },
      });

      await assert.rejects(harness.send(), (error) => {
        if (releaseSucceeds) return error === reserveError;
        return error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
          && error.cause === releaseError
          && error.preDispatchError === reserveError;
      });

      const knownReservationId = 'mailbox-webdesign-send:compose-edge';
      assert.equal(harness.calls.includes('provider'), false);
      assert.equal(harness.calls.includes('transport'), false);
      assert.equal(harness.calls.filter((call) => call === 'provenance:abort').length, 1);
      assert.equal(harness.getFailedHandle().intent.transitionToken, 'final-token');
      assert.deepEqual(harness.calls.filter((call) => call.startsWith('guard:')), [
        `guard:reserve:${knownReservationId}`,
        `guard:release:${knownReservationId}`,
      ]);
      assert.equal(harness.calls.filter((call) => call === 'attachments:cleanup').length, 1);
    });
  }
});
