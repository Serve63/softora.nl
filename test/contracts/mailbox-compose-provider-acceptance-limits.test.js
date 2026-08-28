const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const {
  withMailboxPreDispatchProvenance,
} = require('../helpers/mailbox-pre-dispatch-provenance-fixture');

const MIB = 1024 * 1024;

function threadProvenance(overrides = {}) {
  return {
    intentId: 'send:provider-acceptance',
    idempotencyKey: 'browser:provider-acceptance',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl',
    senderName: 'Servé Creusen',
    mode: 'new-message',
    conversationId: 'draft:prospect@example.nl',
    replyTargetMessageId: '',
    references: '',
    messageId: '<planned-provider-acceptance@softora.nl>',
    provider: 'smtp',
    providerThreadId: '',
    ...overrides,
  };
}

function autoAttachment(filename, size, cid) {
  return {
    filename,
    content: Buffer.alloc(size, 1),
    contentType: 'image/png',
    contentDisposition: 'inline',
    cid,
  };
}

function createHarness(options = {}) {
  const manualSizes = Array.isArray(options.manualSizes) ? options.manualSizes : [];
  const attachmentInputs = manualSizes.map((size, index) => ({
    reference: `signed-reference-${index}`,
    filename: `manual-${index}.png`,
    contentType: 'image/png',
    size,
    sha256: crypto.createHash('sha256').update(Buffer.alloc(size, 2)).digest('hex'),
  }));
  const resolvedManualAttachments = manualSizes.map((size, index) => ({
    filename: `manual-${index}.png`,
    content: Buffer.alloc(size, 2),
    contentType: 'image/png',
    contentDisposition: 'attachment',
    sha256: attachmentInputs[index].sha256,
  }));
  const webdesignParts = Array.isArray(options.webdesignAttachments) ? {
    text: 'Bekijk het webdesign in deze mail.',
    html: '<p>Bekijk het webdesign in deze mail.</p>',
    outboundIdentity: {
      recipientEmail: 'prospect@example.nl',
      recipientDomain: 'example.nl',
      recipientCompany: 'Prospect',
    },
    attachments: options.webdesignAttachments,
  } : null;
  const calls = {
    accept: [],
    append: [],
    cleanup: [],
    confirm: [],
    fail: [],
    finalize: [],
    markUnknown: [],
    outboundReserve: [],
    providerStart: [],
    provenanceReserve: [],
    smtp: [],
    startDispatch: [],
    suppression: [],
    events: [],
  };
  const provenanceStore = {
    async findByIdempotencyKey() {
      return null;
    },
    async reserve(input) {
      calls.provenanceReserve.push(input);
      return { created: true, intent: { ...input, status: 'prepared' } };
    },
    async startDispatch(intentId) {
      calls.startDispatch.push(intentId);
    },
    async finalizeClaim(handle, input) {
      calls.finalize.push(input);
      const intent = {
        ...handle.intent,
        ...input,
        status: 'prepared',
        dispatchState: 'reserved',
        transitionToken: 'test-final-token',
        preDispatchClaimFingerprint: 'a'.repeat(64),
        preDispatchFinalizedAt: '2026-08-26T15:44:59.000Z',
      };
      return { intent, finalToken: intent.transitionToken };
    },
    async accept(intentId, values) {
      calls.accept.push({ intentId, values });
      return { intentId, status: 'accepted', messageId: values.messageId };
    },
    async fail(intentId, error) {
      calls.fail.push({ intentId, error });
      return { intentId, status: 'failed' };
    },
    async markUnknown(intentId, error, values) {
      calls.markUnknown.push({ intentId, error, values });
      return { intentId, status: 'unknown', ...values };
    },
  };
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
      async sendMail(mail) {
        calls.events.push('provider');
        calls.smtp.push(mail);
        return options.providerInfo || {
          messageId: '<accepted-provider-result@softora.nl>',
          accepted: ['prospect@example.nl'],
          rejected: [],
        };
      },
    }),
    buildMailboxWebdesignSendParts: async () => webdesignParts,
    reserveMailboxWebdesignOutboundRecipient: async (identity, settings) => {
      calls.outboundReserve.push({ identity, settings });
      return { reservationId: 'webdesign-reservation-1' };
    },
    confirmMailboxWebdesignOutboundRecipient: async (reservationId, sentItem) => {
      calls.confirm.push({ reservationId, sentItem });
    },
    appendSentMessage: async (payload) => {
      calls.append.push(payload);
      return true;
    },
    webdesignEmailTemplateVersion: 'test-webdesign-template',
    mailboxSendProvenanceStore: withMailboxPreDispatchProvenance(provenanceStore),
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict(identities, settings) {
        calls.suppression.push({ identities, settings });
        return { ok: true, conflict: null };
      },
    },
    mailboxAttachmentService: {
      inspectAttachments() {
        return resolvedManualAttachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.content.length,
          sha256: crypto.createHash('sha256').update(attachment.content).digest('hex'),
        }));
      },
      async downloadAttachments() {
        return resolvedManualAttachments;
      },
      async cleanupAttachments(references, binding) {
        calls.cleanup.push({ references, binding });
      },
    },
    onProviderDispatchStarting: options.onProviderDispatchStarting || (async (event) => {
      calls.providerStart.push(event);
      calls.events.push('callback');
    }),
    logger: { error() {}, warn() {} },
    now: () => new Date('2026-08-26T15:45:00.000Z'),
  });

  return {
    calls,
    send(overrides = {}) {
      return sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'Prospect@Example.nl',
        cc: '',
        bcc: '',
        subject: 'Bijlagecontrole',
        text: 'Hierbij mijn bericht.',
        attachments: attachmentInputs,
        expectedAttachmentsMetadata: attachmentInputs.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          sha256: attachment.sha256,
        })),
        threadProvenance: threadProvenance(),
        ...overrides,
      });
    },
  };
}

test('SMTP-resolutie zonder primaire TO wordt unknown zonder valse Sent- of accepted-status', async () => {
  const harness = createHarness({
    manualSizes: [32],
    webdesignAttachments: [autoAttachment('webdesign.png', 48, 'webdesign@softora')],
    providerInfo: {
      messageId: '<partial-provider-result@softora.nl>',
      accepted: ['cc@example.nl'],
      rejected: ['PROSPECT@example.nl'],
    },
  });

  await assert.rejects(
    harness.send({ cc: 'cc@example.nl' }),
    (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_PRIMARY_RECIPIENT_NOT_ACCEPTED'
  );

  assert.equal(harness.calls.smtp.length, 1);
  assert.equal(harness.calls.markUnknown.length, 1);
  assert.equal(harness.calls.markUnknown[0].intentId, 'send:provider-acceptance');
  assert.deepEqual(harness.calls.markUnknown[0].values, {
    messageId: '<partial-provider-result@softora.nl>',
    sentReconcileRequired: true,
  });
  assert.match(harness.calls.markUnknown[0].error.message, /Geaccepteerd: cc@example\.nl/);
  assert.match(harness.calls.markUnknown[0].error.message, /Afgewezen: prospect@example\.nl/);
  assert.equal(harness.calls.cleanup.length, 0, 'onzekere provideruitkomst bewaart staging voor reconciliatie');
  assert.equal(harness.calls.accept.length, 0);
  assert.equal(harness.calls.fail.length, 0);
  assert.equal(harness.calls.append.length, 0);
  assert.equal(harness.calls.confirm.length, 0);
});

test('expliciete providerafwijzing wint ook wanneer primaire TO tegelijk als accepted terugkomt', async () => {
  const harness = createHarness({
    providerInfo: {
      messageId: '<contradictory-provider-result@softora.nl>',
      accepted: [{ address: 'PROSPECT@EXAMPLE.NL' }],
      rejected: ['prospect@example.nl'],
    },
  });

  await assert.rejects(
    harness.send(),
    (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
      && error.cause?.code === 'MAILBOX_PRIMARY_RECIPIENT_NOT_ACCEPTED'
  );
  assert.equal(harness.calls.markUnknown.length, 1);
  assert.equal(harness.calls.accept.length, 0);
  assert.equal(harness.calls.append.length, 0);
});

test('automatische en handmatige bijlagen worden samen op maximaal vijf MIME-parts begrensd', async () => {
  const harness = createHarness({
    manualSizes: [1, 1, 1, 1],
    webdesignAttachments: [
      autoAttachment('webdesign.png', 1, 'webdesign@softora'),
      autoAttachment('mockup.png', 1, 'mockup@softora'),
    ],
  });

  await assert.rejects(harness.send(), (error) => {
    assert.equal(error.code, 'MAILBOX_ATTACHMENT_COMBINED_LIMIT');
    assert.equal(error.status, 400);
    assert.match(error.message, /Automatische webdesignafbeeldingen en handmatige bijlagen tellen samen mee/);
    assert.match(error.message, /maximaal 5 bijlagen/);
    return true;
  });
  assert.equal(harness.calls.cleanup.length, 1);
  assert.equal(harness.calls.suppression.length, 0);
  assert.equal(harness.calls.outboundReserve.length, 0);
  assert.equal(harness.calls.provenanceReserve.length, 1, 'de stop wordt eerst duurzaam geclaimd');
  assert.equal(harness.calls.finalize.length, 0);
  assert.equal(harness.calls.fail.length, 1);
  assert.equal(harness.calls.providerStart.length, 0);
  assert.equal(harness.calls.smtp.length, 0);
});

test('gecombineerde bijlagen begrenzen zowel ieder Buffer als het totaal vóór externe side-effects', async (t) => {
  await t.test('automatische bijlage boven 4 MiB', async () => {
    const harness = createHarness({
      manualSizes: [1],
      webdesignAttachments: [autoAttachment('webdesign.png', 4 * MIB + 1, 'webdesign@softora')],
    });
    await assert.rejects(harness.send(), (error) => {
      assert.equal(error.code, 'MAILBOX_ATTACHMENT_COMBINED_LIMIT');
      assert.match(error.message, /maximaal 4 MB/);
      return true;
    });
    assert.equal(harness.calls.cleanup.length, 1);
    assert.equal(harness.calls.provenanceReserve.length, 1);
    assert.equal(harness.calls.finalize.length, 0);
    assert.equal(harness.calls.fail.length, 1);
    assert.equal(harness.calls.providerStart.length, 0);
    assert.equal(harness.calls.smtp.length, 0);
  });

  await t.test('automatisch plus handmatig boven 5 MiB', async () => {
    const harness = createHarness({
      manualSizes: [2 * MIB + 1],
      webdesignAttachments: [autoAttachment('webdesign.png', 3 * MIB, 'webdesign@softora')],
    });
    await assert.rejects(harness.send(), (error) => {
      assert.equal(error.code, 'MAILBOX_ATTACHMENT_COMBINED_LIMIT');
      assert.match(error.message, /samen maximaal 5 MB/);
      return true;
    });
    assert.equal(harness.calls.cleanup.length, 1);
    assert.equal(harness.calls.provenanceReserve.length, 1);
    assert.equal(harness.calls.finalize.length, 0);
    assert.equal(harness.calls.fail.length, 1);
    assert.equal(harness.calls.providerStart.length, 0);
    assert.equal(harness.calls.smtp.length, 0);
  });
});

test('exacte gecombineerde grens bewaart CID-bytes en accepteert TO hoofdletterongevoelig', async () => {
  const harness = createHarness({
    manualSizes: [MIB, MIB, MIB],
    webdesignAttachments: [
      autoAttachment('webdesign.png', MIB, 'webdesign@softora'),
      autoAttachment('mockup.png', MIB, 'mockup@softora'),
    ],
    providerInfo: {
      messageId: '<combined-boundary@softora.nl>',
      accepted: [{ address: 'PROSPECT@EXAMPLE.NL' }, 'cc@example.nl'],
      rejected: ['bcc@example.nl'],
    },
  });

  const result = await harness.send({ cc: 'cc@example.nl', bcc: 'bcc@example.nl' });

  assert.equal(result.messageId, '<combined-boundary@softora.nl>');
  assert.equal(harness.calls.smtp.length, 1);
  assert.equal(harness.calls.smtp[0].attachments.length, 5);
  assert.equal(
    harness.calls.smtp[0].attachments.reduce((total, attachment) => total + attachment.content.length, 0),
    5 * MIB
  );
  assert.deepEqual(
    harness.calls.smtp[0].attachments.slice(0, 2).map((attachment) => attachment.cid),
    ['webdesign@softora', 'mockup@softora']
  );
  assert.strictEqual(harness.calls.finalize[0].attachments, harness.calls.smtp[0].attachments);
  assert.strictEqual(harness.calls.append[0].mail.attachments, harness.calls.smtp[0].attachments);
  assert.equal(harness.calls.confirm.length, 1);
  assert.deepEqual(harness.calls.providerStart, [{
    provider: 'smtp', intentId: 'send:provider-acceptance',
  }]);
  assert.deepEqual(harness.calls.events, ['callback', 'provider']);
  assert.equal(harness.calls.accept.length, 1);
  assert.equal(harness.calls.markUnknown.length, 0);
  assert.equal(harness.calls.fail.length, 0);
  assert.equal(harness.calls.cleanup.length, 1);
});

test('SMTP callbackfout stopt na durable start maar vóór iedere providercall', async () => {
  const callbackError = Object.assign(new Error('router kon providerstart niet markeren'), {
    code: 'TEST_PROVIDER_START_CALLBACK_FAILED',
  });
  const callbackCalls = [];
  const harness = createHarness({
    manualSizes: [32],
    async onProviderDispatchStarting(event) {
      callbackCalls.push(event);
      throw callbackError;
    },
  });

  await assert.rejects(harness.send(), (error) => error === callbackError);
  assert.deepEqual(callbackCalls, [{ provider: 'smtp', intentId: 'send:provider-acceptance' }]);
  assert.equal(harness.calls.startDispatch.length, 1);
  assert.equal(harness.calls.smtp.length, 0);
  assert.equal(harness.calls.fail.length, 1);
  assert.equal(harness.calls.cleanup.length, 1);
});
