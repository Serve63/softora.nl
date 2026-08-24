const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const { MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION } = require('../../server/services/mailbox-compose-email-renderer');
const { createMailboxSendProvenanceStore } = require('../../server/services/mailbox-send-provenance-store');

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
    softoraSendMode: 'reply',
    softoraReplyTargetMessageId: '<received@example.nl>',
  });
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
    async single() {
      provenanceCalls += 1;
      return { data: null, error: timeoutError };
    },
  };
  const provenanceStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => query }),
    retryDelayMs: 0,
  });
  const sendMessage = createMailboxComposeSend({
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
    1,
    'zonder geslaagde read-back mag de reserveringsmutatie niet blind worden herhaald'
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
    mailboxSendProvenanceStore: {
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
    },
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
