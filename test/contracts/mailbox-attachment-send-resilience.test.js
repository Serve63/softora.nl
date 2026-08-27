const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const {
  createMailboxPayloadFingerprint,
  createMailboxRequestPayloadFingerprint,
} = require('../../server/services/mailbox-send-provenance-store');

function threadProvenance(overrides = {}) {
  return {
    intentId: 'send:attachment-resilience',
    idempotencyKey: 'browser:attachment-resilience',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl',
    senderName: 'Servé Creusen',
    mode: 'reply',
    conversationId: 'conversation:attachment-resilience',
    replyTargetMessageId: '<incoming@example.nl>',
    references: '<root@example.nl> <incoming@example.nl>',
    messageId: '<planned@softora.nl>',
    provider: 'smtp',
    providerThreadId: '',
    ...overrides,
  };
}

function acceptedIntent(overrides = {}) {
  const attachmentsMetadata = [];
  return {
    ...threadProvenance({ intentId: 'send:accepted-resilience' }),
    subject: 'Bijlagebewijs',
    body: 'Zie de bijlage.',
    cc: '',
    bcc: '',
    attachmentsFingerprint: '',
    attachmentsMetadata,
    payloadFingerprint: createMailboxPayloadFingerprint({
      subject: 'Bijlagebewijs', body: 'Zie de bijlage.', cc: '', bcc: '', attachmentsFingerprint: '',
    }),
    requestPayloadFingerprint: createMailboxRequestPayloadFingerprint({
      subject: 'Bijlagebewijs', requestBody: 'Zie de bijlage.', cc: '', bcc: '', attachmentsMetadata,
    }),
    status: 'accepted',
    dispatchState: 'finished',
    reconcileRequired: false,
    sentReconcileRequired: false,
    acceptedAt: '2026-08-27T15:00:00.000Z',
    messageId: '<accepted@softora.nl>',
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true,
      smtpIdentityMatches: true, smtpHost: 'smtp.example.test', smtpPort: 465,
      smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'test-only',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    buildMailboxWebdesignSendParts: async () => null,
    reserveMailboxWebdesignOutboundRecipient: async () => null,
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async () => true,
    outboundRecipientGuardStore: {
      findRecipientSuppressionConflict: async () => ({ ok: true, conflict: null }),
    },
    logger: { warn() {}, error() {} },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    accountEmail: 'serve@softora.nl',
    to: 'prospect@example.nl',
    cc: '',
    bcc: '',
    subject: 'Bijlagebewijs',
    text: 'Zie de bijlage.',
    attachments: [],
    threadProvenance: threadProvenance(),
    ...overrides,
  };
}

test('accepted SMTP-replay zonder bijlagen stopt vóór alle vluchtige side-effects', async () => {
  const accepted = acceptedIntent();
  const calls = {
    builder: 0, transport: 0, suppression: 0, reserve: 0, start: 0,
    provider: 0, append: 0, cleanup: 0,
  };
  const send = createMailboxComposeSend(dependencies({
    buildMailboxWebdesignSendParts: async () => { calls.builder += 1; return null; },
    createTransport: () => { calls.transport += 1; return { sendMail: async () => { calls.provider += 1; } }; },
    appendSentMessage: async () => { calls.append += 1; return true; },
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() { calls.suppression += 1; return { ok: true, conflict: null }; },
    },
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => accepted,
      reserve: async () => { calls.reserve += 1; throw new Error('reserve mag niet starten'); },
      startDispatch: async () => { calls.start += 1; },
    },
    mailboxAttachmentService: {
      cleanupAttachments: async () => { calls.cleanup += 1; },
    },
  }));

  const result = await send(input());
  assert.equal(result.idempotentReplay, true);
  assert.deepEqual(result.sentMessage.attachments, []);
  assert.equal(result.sentMessage.attachmentEvidenceKnown, true);
  assert.deepEqual(calls, {
    builder: 0, transport: 0, suppression: 0, reserve: 0, start: 0,
    provider: 0, append: 0, cleanup: 0,
  });
});

test('accepted SMTP-replay faalt gesloten bij niet-terminale status of ontbrekende uitgaande identity', async (t) => {
  for (const [label, override] of [
    ['intent ontbreekt', { intentId: '' }],
    ['berichtidentiteit ontbreekt', { messageId: '', providerMessageId: '' }],
    ['berichtidentiteit is alleen het replydoel', {
      messageId: '<incoming@example.nl>', providerMessageId: '',
    }],
    ['dispatch is nog gestart', { dispatchState: 'started' }],
    ['reconcile staat nog open', { reconcileRequired: true }],
    ['sent-reconcile staat nog open', { sentReconcileRequired: true }],
  ]) {
    await t.test(label, async () => {
      const accepted = acceptedIntent(override);
      const calls = { builder: 0, reserve: 0, provider: 0 };
      const send = createMailboxComposeSend(dependencies({
        buildMailboxWebdesignSendParts: async () => { calls.builder += 1; return null; },
        createTransport: () => ({ sendMail: async () => { calls.provider += 1; } }),
        mailboxSendProvenanceStore: {
          findByIdempotencyKey: async () => accepted,
          reserve: async () => { calls.reserve += 1; throw new Error('reserve mag niet starten'); },
        },
      }));

      await assert.rejects(send(input()), (error) => (
        error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
          && ['MAILBOX_SEND_ACCEPTED_IDENTITY_MISSING', 'MAILBOX_SEND_DURABLE_STATUS_INVALID']
            .includes(error.cause?.code)
      ));
      assert.deepEqual(calls, { builder: 0, reserve: 0, provider: 0 });
    });
  }
});

test('legacy accepted attachmentsMetadata null faalt gesloten en wordt nooit als bewezen leeg getoond', async () => {
  const accepted = acceptedIntent({ attachmentsMetadata: null, requestPayloadFingerprint: '' });
  let builderCalls = 0;
  let providerCalls = 0;
  const send = createMailboxComposeSend(dependencies({
    buildMailboxWebdesignSendParts: async () => { builderCalls += 1; return null; },
    createTransport: () => ({ sendMail: async () => { providerCalls += 1; } }),
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => accepted,
      reserve: async () => { throw new Error('legacy replay mag niet reserveren'); },
    },
  }));

  await assert.rejects(send(input()), (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_SEND_ATTACHMENT_EVIDENCE_MISSING'
  ));
  assert.equal(builderCalls, 0);
  assert.equal(providerCalls, 0);
});

test('proof-gebonden signed references wijken nooit af vóór download, reserve of provider', async (t) => {
  const expected = [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }];
  for (const [label, inspected, expectedMetadata, inspectError] of [
    ['swapped reference', [{ filename: 'ander.pdf', contentType: 'application/pdf', size: 4 }], expected, null],
    ['filename', [{ filename: 'gewijzigd.pdf', contentType: 'application/pdf', size: 4 }], expected, null],
    ['content type', [{ filename: 'bewijs.png', contentType: 'image/png', size: 4 }], expected, null],
    ['size', [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 5 }], expected, null],
    ['zero-attachment proof', expected, [], null],
    ['expired reference', null, expected, Object.assign(new Error('upload verlopen'), {
      code: 'MAILBOX_ATTACHMENT_REFERENCE_EXPIRED', status: 409,
    })],
  ]) {
    await t.test(label, async () => {
      const calls = { inspect: 0, download: 0, find: 0, builder: 0, reserve: 0, provider: 0 };
      const send = createMailboxComposeSend(dependencies({
        buildMailboxWebdesignSendParts: async () => { calls.builder += 1; return null; },
        createTransport: () => ({ sendMail: async () => { calls.provider += 1; } }),
        mailboxSendProvenanceStore: {
          findByIdempotencyKey: async () => { calls.find += 1; return null; },
          reserve: async () => { calls.reserve += 1; throw new Error('reserve mag niet starten'); },
        },
        mailboxAttachmentService: {
          inspectAttachments() {
            calls.inspect += 1;
            if (inspectError) throw inspectError;
            return inspected;
          },
          downloadAttachments: async () => { calls.download += 1; return []; },
        },
      }));
      await assert.rejects(send(input({
        attachments: [{ reference: `signed-${label}` }],
        expectedAttachmentsMetadata: expectedMetadata,
      })), (error) => inspectError
        ? error.code === inspectError.code
        : error.code === 'MAILBOX_ATTACHMENT_METADATA_MISMATCH');
      assert.deepEqual(calls, {
        inspect: 1, download: 0, find: 0, builder: 0, reserve: 0, provider: 0,
      });
    });
  }
});

test('definitieve SMTP 550 plus mislukte fail-persist houdt dezelfde staging en blokkeert iedere retry-providercall', async () => {
  const metadata = [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }];
  const resolved = [{ ...metadata[0], content: Buffer.from([1, 2, 3, 4]), contentDisposition: 'attachment' }];
  let intent = null;
  let providerCalls = 0;
  let downloadCalls = 0;
  let cleanupCalls = 0;
  let failCalls = 0;
  const send = createMailboxComposeSend(dependencies({
    createTransport: () => ({
      async sendMail() {
        providerCalls += 1;
        throw Object.assign(new Error('550 mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 });
      },
    }),
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => intent,
      async reserve(values) {
        intent = { ...values, status: 'prepared', dispatchState: 'reserved' };
        return { created: true, intent };
      },
      async startDispatch() { intent.dispatchState = 'started'; },
      async fail() {
        failCalls += 1;
        throw Object.assign(new Error('fail-persist timeout'), { code: '57014' });
      },
    },
    mailboxAttachmentService: {
      inspectAttachments: () => metadata,
      downloadAttachments: async () => { downloadCalls += 1; return resolved; },
      cleanupAttachments: async () => { cleanupCalls += 1; },
    },
  }));
  const sendInput = input({ attachments: [{ reference: 'same-staged-reference' }] });

  await assert.rejects(send(sendInput), (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === '57014'
      && error.providerError?.responseCode === 550
  ));
  await assert.rejects(send(sendInput), (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN'
  ));
  assert.equal(intent.idempotencyKey, sendInput.threadProvenance.idempotencyKey);
  assert.equal(intent.intentId, sendInput.threadProvenance.intentId);
  assert.equal(providerCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(failCalls, 1);
  assert.equal(cleanupCalls, 0);
});

test('tijdelijke Nodemailer ECONNECTION wordt unknown en een retry start nooit een tweede provider', async () => {
  const metadata = [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }];
  const resolved = [{ ...metadata[0], content: Buffer.from([1, 2, 3, 4]), contentDisposition: 'attachment' }];
  let intent = null;
  let providerCalls = 0;
  let downloadCalls = 0;
  let cleanupCalls = 0;
  let unknownCalls = 0;
  let failCalls = 0;
  const send = createMailboxComposeSend(dependencies({
    createTransport: () => ({
      async sendMail() {
        providerCalls += 1;
        throw Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION' });
      },
    }),
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => intent,
      async reserve(values) {
        intent = { ...values, status: 'prepared', dispatchState: 'reserved' };
        return { created: true, intent };
      },
      async startDispatch() { intent.dispatchState = 'started'; },
      async markUnknown(_intentId, _error, values) {
        unknownCalls += 1;
        intent = {
          ...intent,
          ...values,
          status: 'unknown',
          dispatchState: 'started',
          reconcileRequired: true,
        };
        return intent;
      },
      async fail() { failCalls += 1; return { ...intent, status: 'failed' }; },
    },
    mailboxAttachmentService: {
      inspectAttachments: () => metadata,
      downloadAttachments: async () => { downloadCalls += 1; return resolved; },
      cleanupAttachments: async () => { cleanupCalls += 1; },
    },
  }));
  const sendInput = input({ attachments: [{ reference: 'same-econnection-staging' }] });

  await assert.rejects(send(sendInput), (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED' && error.cause?.code === 'ECONNECTION'
  ));
  await assert.rejects(send(sendInput), (error) => (
    error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN'
  ));
  assert.equal(intent.status, 'unknown');
  assert.equal(providerCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(unknownCalls, 1);
  assert.equal(failCalls, 0);
  assert.equal(cleanupCalls, 0);
});

test('legacy reserved expiry bereikt alleen na de gedeelde bounded lease het reserve-herstelpad', async () => {
  const nowValue = new Date('2026-08-27T16:00:00.000Z');
  function legacyIntent(updatedAt) {
    return {
      ...threadProvenance(),
      status: 'prepared',
      dispatchState: 'reserved',
      dispatchLeaseExpiresAt: '',
      updatedAt,
      createdAt: '2026-08-27T15:00:00.000Z',
    };
  }
  function harness(existingIntent) {
    let reserveCalls = 0;
    let providerCalls = 0;
    let builderCalls = 0;
    const send = createMailboxComposeSend(dependencies({
      now: () => nowValue,
      buildMailboxWebdesignSendParts: async () => { builderCalls += 1; return null; },
      createTransport: () => ({
        async sendMail() {
          providerCalls += 1;
          return { messageId: '<legacy-recovered@softora.nl>', accepted: ['prospect@example.nl'], rejected: [] };
        },
      }),
      mailboxSendProvenanceStore: {
        findByIdempotencyKey: async () => existingIntent,
        async reserve(values) {
          reserveCalls += 1;
          return { created: true, intent: { ...values, status: 'prepared', dispatchState: 'reserved' } };
        },
        startDispatch: async () => {},
        accept: async (intentId, values) => ({ intentId, status: 'accepted', ...values }),
        fail: async (intentId) => ({ intentId, status: 'failed' }),
      },
    }));
    return {
      send,
      counts: () => ({ reserveCalls, providerCalls, builderCalls }),
    };
  }

  const expired = harness(legacyIntent('2026-08-27T15:59:29.000Z'));
  await expired.send(input());
  assert.deepEqual(expired.counts(), { reserveCalls: 1, providerCalls: 1, builderCalls: 1 });

  const active = harness(legacyIntent('2026-08-27T15:59:31.000Z'));
  await assert.rejects(active.send(input()), (error) => error.code === 'MAILBOX_SEND_ALREADY_PROCESSING');
  assert.deepEqual(active.counts(), { reserveCalls: 0, providerCalls: 0, builderCalls: 0 });
});
