const test = require('node:test');
const assert = require('node:assert/strict');

const compose = require('../../assets/premium-mailbox-compose');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const mailboxError = require('../../assets/premium-mailbox-error');
const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const {
  createMailboxAttachmentsFingerprint,
  createMailboxPayloadFingerprint,
  createMailboxRequestPayloadFingerprint,
} = require('../../server/services/mailbox-send-provenance-store');

function createAllowingSuppressionStore() {
  return { findRecipientSuppressionConflict: async () => ({ ok: true, conflict: null }) };
}
const {
  createMailboxAttachmentService,
  safeFilename: serverSafeFilename,
} = require('../../server/services/mailbox-attachment-service');

function makeBinding(overrides = {}) {
  return {
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    providerAccountEmail: '',
    recipientEmail: 'prospect@example.nl',
    provider: 'smtp',
    mode: 'reply',
    conversationId: 'conversation:serve|prospect',
    replyTargetMessageId: '<inbound@example.nl>',
    providerThreadId: '',
    idempotencyKey: 'send:test-attachments',
    ...overrides,
  };
}

function decodeReference(reference) {
  return JSON.parse(Buffer.from(String(reference).split('.')[0], 'base64url').toString('utf8'));
}

function createStorageFixture() {
  const objects = new Map();
  const calls = { signed: [], downloaded: [], removed: [] };
  return {
    objects,
    calls,
    storage: {
      from() {
        return {
          async createSignedUploadUrl(path) {
            calls.signed.push(path);
            return { data: { signedUrl: `https://storage.test/${path}?signed=1` }, error: null };
          },
          async download(path) {
            calls.downloaded.push(path);
            return { data: objects.get(path) || null, error: null };
          },
          async remove(paths) {
            calls.removed.push(paths);
            paths.forEach((path) => objects.delete(path));
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
}

test('directe mailbox attachment staging houdt drie PNGs buiten de send-JSON en hydrateert exact dezelfde bytes', async () => {
  const fixture = createStorageFixture();
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({ storage: fixture.storage }),
    secret: 'test-only-mailbox-attachment-secret',
    randomUUID: (() => {
      let index = 0;
      return () => `upload-${++index}`;
    })(),
    now: () => new Date('2026-08-18T15:00:00.000Z'),
    logger: { warn() {} },
  });
  const binding = makeBinding();
  const metadata = [1, 2, 3].map((index) => ({
    filename: `screenshot-${index}.png`,
    contentType: 'image/png',
    size: 4,
  }));

  const uploads = await service.createUploadPlan({ attachments: metadata, binding });
  assert.equal(uploads.length, 3);
  assert.equal(fixture.calls.signed.length, 3);
  assert.ok(uploads.every((upload) => upload.signedUrl.startsWith('https://storage.test/')));
  assert.ok(uploads.every((upload) => !upload.reference.includes('prospect@example.nl')));

  uploads.forEach((upload, index) => {
    fixture.objects.set(decodeReference(upload.reference).path, Buffer.from([index + 1, 2, 3, 4]));
  });
  const resolved = await service.downloadAttachments(uploads, binding);
  assert.deepEqual(resolved.map((attachment) => [...attachment.content]), [
    [1, 2, 3, 4],
    [2, 2, 3, 4],
    [3, 2, 3, 4],
  ]);
  assert.deepEqual(resolved.map(({ filename, contentType }) => ({ filename, contentType })), metadata.map(({ filename, contentType }) => ({ filename, contentType })));

  await service.cleanupAttachments(uploads, binding);
  assert.equal(fixture.calls.removed.length, 1);
  assert.equal(fixture.objects.size, 0);
});

test('attachment context mismatch en groottegrenzen falen voor opslag of send', async () => {
  const fixture = createStorageFixture();
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({ storage: fixture.storage }),
    secret: 'test-only-mailbox-attachment-secret',
    now: () => new Date('2026-08-18T15:00:00.000Z'),
    logger: { warn() {} },
  });
  const binding = makeBinding();
  const [upload] = await service.createUploadPlan({
    attachments: [{ filename: 'screen.png', contentType: 'image/png', size: 4 }],
    binding,
  });
  fixture.objects.set(decodeReference(upload.reference).path, Buffer.alloc(4, 1));
  await assert.rejects(
    service.downloadAttachments([upload], { ...binding, idempotencyKey: 'other-request' }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH' && error.status === 409
  );
  await assert.rejects(
    service.createUploadPlan({
      attachments: [{ filename: 'too-large.png', contentType: 'image/png', size: 4 * 1024 * 1024 + 1 }],
      binding,
    }),
    /maximaal 4 MB/
  );
  await assert.rejects(
    service.createUploadPlan({
      attachments: Array.from({ length: 3 }, (_, index) => ({
        filename: `total-${index}.png`, contentType: 'image/png', size: 2 * 1024 * 1024,
      })),
      binding,
    }),
    /samen maximaal 5 MB/
  );
  assert.equal(fixture.calls.signed.length, 1);
});

test('compose send resolveert signed references naar echte MIME-bytes en roept de provider eenmaal aan', async () => {
  let providerCalls = 0;
  let cleanupCalls = 0;
  let reservedAttachments = null;
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true, smtpIdentityMatches: true,
      smtpHost: 'smtp.example.test', smtpPort: 465, smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      sendMail: async (mail) => {
        providerCalls += 1;
        assert.equal(mail.attachments.length, 3);
        assert.deepEqual(mail.attachments.map((item) => [...item.content]), [[1, 2], [3, 4], [5, 6]]);
        return { messageId: '<attachment-success@softora.nl>', accepted: ['prospect@example.nl'], rejected: [] };
      },
    }),
    buildMailboxWebdesignSendParts: async () => null,
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => null,
      reserve: async (input) => {
        reservedAttachments = input.attachments;
        return { created: true, intent: { intentId: input.intentId, status: 'prepared' } };
      },
      startDispatch: async () => {},
      accept: async (intentId, values) => ({ intentId, status: 'accepted', messageId: values.messageId }),
      fail: async () => null,
    },
    mailboxAttachmentService: {
      inspectAttachments: () => [0, 1, 2].map((index) => ({
        filename: `screen-${index}.png`, contentType: 'image/png', size: 2,
      })),
      downloadAttachments: async () => [1, 2, 3].map((_, index) => ({
        filename: `screen-${index}.png`, contentType: 'image/png', content: Buffer.from([index * 2 + 1, index * 2 + 2]), contentDisposition: 'attachment',
      })),
      cleanupAttachments: async () => { cleanupCalls += 1; },
    },
  });
  const result = await sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'prospect@example.nl',
    subject: 'Drie schermbeelden',
    text: 'Zie de bijlagen.',
    attachments: [
      { reference: 'signed-1', filename: 'screen-0.png', contentType: 'image/png', size: 2 },
      { reference: 'signed-2', filename: 'screen-1.png', contentType: 'image/png', size: 2 },
      { reference: 'signed-3', filename: 'screen-2.png', contentType: 'image/png', size: 2 },
    ],
    threadProvenance: {
      intentId: 'send:attachment-test', idempotencyKey: 'attachment-test', owner: 'serve', accountEmail: 'serve@softora.nl',
      recipientEmail: 'prospect@example.nl', senderName: 'Servé Creusen', mode: 'new-message', conversationId: '',
      replyTargetMessageId: '', references: '', messageId: '<planned@softora.nl>', provider: 'smtp', providerThreadId: '',
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.equal(reservedAttachments.length, 3);
  assert.equal(result.messageId, '<attachment-success@softora.nl>');
  assert.deepEqual(result.sentMessage.attachments, [0, 1, 2].map((index) => ({
    filename: `screen-${index}.png`, contentType: 'image/png', size: 2,
  })));
  assert.equal(result.sentMessage.attachments.some((attachment) => 'content' in attachment || 'reference' in attachment), false);
});

test('accepted attachment-replay gebruikt HMAC-metadata zonder Storage en eist exact dezelfde duurzame requestpayload', async () => {
  let providerCalls = 0;
  let downloadCalls = 0;
  let reserveCalls = 0;
  let cleanupCalls = 0;
  const durableAttachment = {
    filename: 'bewijs.pdf',
    contentType: 'application/pdf',
    content: Buffer.from([1, 2, 3, 4]),
    contentDisposition: 'attachment',
  };
  const durableAttachmentsFingerprint = createMailboxAttachmentsFingerprint([durableAttachment]);
  const acceptedIntent = {
    intentId: 'send:accepted-before-response-loss',
    idempotencyKey: 'browser:attachment-response-loss',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl',
    mode: 'reply',
    conversationId: 'conversation:accepted-attachment-replay',
    replyTargetMessageId: '<inbound-replay@example.nl>',
    references: '<root-replay@example.nl> <inbound-replay@example.nl>',
    provider: 'smtp',
    providerThreadId: '',
    messageId: '<attachment-was-accepted@softora.nl>',
    senderName: 'Servé Creusen',
    subject: 'Bijlage',
    body: 'Zie de bijlage.',
    cc: 'cc@example.nl',
    bcc: 'audit@example.nl',
    attachmentsFingerprint: durableAttachmentsFingerprint,
    payloadFingerprint: createMailboxPayloadFingerprint({
      subject: 'Bijlage',
      body: 'Zie de bijlage.',
      cc: 'cc@example.nl',
      bcc: 'audit@example.nl',
      attachmentsFingerprint: durableAttachmentsFingerprint,
    }),
    attachmentsMetadata: [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }],
    requestPayloadFingerprint: createMailboxRequestPayloadFingerprint({
      subject: 'Bijlage', requestBody: 'Zie de bijlage.', cc: 'cc@example.nl', bcc: 'audit@example.nl',
      attachmentsMetadata: [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }],
    }),
    status: 'accepted',
    dispatchState: 'finished',
    reconcileRequired: false,
    sentReconcileRequired: false,
    acceptedAt: '2026-08-26T15:00:00.000Z',
  };
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({
      email: 'serve@softora.nl', name: 'Servé Creusen', smtpConfigured: true, smtpIdentityMatches: true,
      smtpHost: 'smtp.example.test', smtpPort: 465, smtpSecure: true, smtpUser: 'serve@softora.nl', smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({ sendMail: async () => { providerCalls += 1; } }),
    buildMailboxWebdesignSendParts: async () => null,
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => acceptedIntent,
      reserve: async () => {
        reserveCalls += 1;
        throw new Error('accepted replay mag niet opnieuw reserveren');
      },
    },
    mailboxAttachmentService: {
      inspectAttachments: (attachmentInputs) => [{
        filename: 'bewijs.pdf',
        contentType: 'application/pdf',
        size: attachmentInputs.some((attachment) => attachment.reference === 'different-content') ? 3 : 4,
      }],
      downloadAttachments: async (attachmentInputs) => {
        downloadCalls += 1;
        const changed = attachmentInputs.some((attachment) => attachment.reference === 'different-content');
        return [{
          ...durableAttachment,
          content: changed ? Buffer.from([9, 9, 9, 9]) : Buffer.from(durableAttachment.content),
        }];
      },
      cleanupAttachments: async () => { cleanupCalls += 1; },
    },
  });
  const threadProvenance = {
    intentId: 'send:new-request-id-after-response-loss',
    idempotencyKey: acceptedIntent.idempotencyKey,
    owner: acceptedIntent.owner,
    accountEmail: acceptedIntent.accountEmail,
    recipientEmail: acceptedIntent.recipientEmail,
    mode: acceptedIntent.mode,
    conversationId: acceptedIntent.conversationId,
    replyTargetMessageId: acceptedIntent.replyTargetMessageId,
    references: acceptedIntent.references,
    messageId: '<newly-planned-but-unused@softora.nl>',
    provider: acceptedIntent.provider,
    providerThreadId: '',
  };
  const result = await sendMessage({
    accountEmail: acceptedIntent.accountEmail,
    to: acceptedIntent.recipientEmail,
    cc: acceptedIntent.cc,
    bcc: acceptedIntent.bcc,
    subject: acceptedIntent.subject,
    text: acceptedIntent.body,
    attachments: [{
      reference: 'freshly-uploaded-reference',
      filename: 'client-metadata-wordt-niet-vertrouwd.pdf',
      contentType: 'text/plain',
      size: 999,
    }],
    threadProvenance,
  });

  assert.equal(result.idempotentReplay, true);
  assert.equal(result.messageId, acceptedIntent.messageId);
  assert.equal(result.intentId, acceptedIntent.intentId);
  assert.equal(result.sentMessage.subject, acceptedIntent.subject);
  assert.equal(result.sentMessage.body, acceptedIntent.body);
  assert.deepEqual(result.sentMessage.attachments, [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }]);
  assert.equal(result.sentMessage.attachmentEvidenceKnown, true);
  assert.equal(providerCalls, 0);
  assert.equal(downloadCalls, 0);
  assert.equal(reserveCalls, 0);
  assert.equal(cleanupCalls, 1);

  const mismatchCases = [
    { label: 'subject', overrides: { subject: 'Gewijzigd onderwerp' } },
    { label: 'body', overrides: { text: 'Gewijzigde body.' } },
    { label: 'CC', overrides: { cc: 'ander-cc@example.nl' } },
    { label: 'BCC', overrides: { bcc: 'ander-audit@example.nl' } },
    {
      label: 'attachment bytes',
      overrides: {
        attachments: [{
          reference: 'different-content', filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
        }],
      },
    },
  ];
  for (const { label, overrides } of mismatchCases) {
    await assert.rejects(sendMessage({
      accountEmail: acceptedIntent.accountEmail,
      to: acceptedIntent.recipientEmail,
      cc: acceptedIntent.cc,
      bcc: acceptedIntent.bcc,
      subject: acceptedIntent.subject,
      text: acceptedIntent.body,
      attachments: [{
        reference: `fresh-reference-${label}`,
        filename: 'bewijs.pdf',
        contentType: 'application/pdf',
        size: 4,
      }],
      threadProvenance,
      ...overrides,
    }), (error) => {
      assert.equal(error.code, 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH', label);
      assert.equal(error.status, 409, label);
      return true;
    });
  }

  const contextMismatchCases = [
    {
      label: 'recipient',
      accountEmail: acceptedIntent.accountEmail,
      to: 'other@example.nl',
      provenance: { recipientEmail: 'other@example.nl' },
    },
    {
      label: 'References met hetzelfde replyTarget',
      accountEmail: acceptedIntent.accountEmail,
      to: acceptedIntent.recipientEmail,
      provenance: { references: '<ander-root@example.nl> <inbound-replay@example.nl>' },
    },
    {
      label: 'owner',
      accountEmail: acceptedIntent.accountEmail,
      to: acceptedIntent.recipientEmail,
      provenance: { owner: 'martijn' },
    },
    {
      label: 'account',
      accountEmail: 'martijn@softora.nl',
      to: acceptedIntent.recipientEmail,
      provenance: { accountEmail: 'martijn@softora.nl' },
    },
    {
      label: 'providerThread',
      accountEmail: acceptedIntent.accountEmail,
      to: acceptedIntent.recipientEmail,
      provenance: { providerThreadId: 'ander-provider-thread' },
    },
  ];
  for (const mismatch of contextMismatchCases) {
    await assert.rejects(sendMessage({
      accountEmail: mismatch.accountEmail,
      to: mismatch.to,
      cc: acceptedIntent.cc,
      bcc: acceptedIntent.bcc,
      subject: acceptedIntent.subject,
      text: acceptedIntent.body,
      attachments: [{
        reference: `context-${mismatch.label}`,
        filename: 'bewijs.pdf',
        contentType: 'application/pdf',
        size: 4,
      }],
      threadProvenance: { ...threadProvenance, ...mismatch.provenance },
    }), (error) => {
      assert.equal(error.code, 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH', mismatch.label);
      assert.equal(error.status, 409, mismatch.label);
      return true;
    });
  }
  assert.equal(providerCalls, 0);
  assert.equal(downloadCalls, 0);
  assert.equal(reserveCalls, 0);
  assert.equal(cleanupCalls, 1, 'alleen de geldige replay ruimt de stagingreference op');
});

test('ongeldige signed attachment wordt vóór provenance/provider afgewezen', async () => {
  let providerCalls = 0;
  let reserveCalls = 0;
  const sendMessage = createMailboxComposeSend({
    outboundRecipientGuardStore: createAllowingSuppressionStore(),
    getAccount: () => ({ email: 'serve@softora.nl', smtpConfigured: true, smtpIdentityMatches: true, smtpHost: 'x', smtpUser: 'serve@softora.nl', smtpPass: 'secret' }),
    isValidEmail: () => true,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({ sendMail: async () => { providerCalls += 1; } }),
    buildMailboxWebdesignSendParts: async () => null,
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: {
      findByIdempotencyKey: async () => null,
      reserve: async () => { reserveCalls += 1; return { created: true, intent: {} }; },
    },
    mailboxAttachmentService: {
      inspectAttachments: () => { throw Object.assign(new Error('bad reference'), { code: 'MAILBOX_ATTACHMENT_REFERENCE_INVALID', status: 400 }); },
      downloadAttachments: async () => { throw new Error('Storage mag niet starten na ongeldige reference'); },
    },
  });
  await assert.rejects(sendMessage({
    accountEmail: 'serve@softora.nl', to: 'prospect@example.nl', subject: 'x', text: 'y', attachments: [{ reference: 'bad' }],
    threadProvenance: { intentId: 'send:bad', idempotencyKey: 'bad', owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'new-message', provider: 'smtp' },
  }), /bad reference/);
  assert.equal(providerCalls, 0);
  assert.equal(reserveCalls, 0);
});

test('clientfouten blijven menselijk en send-payload wordt vóór de platformlimiet begrensd', () => {
  assert.equal(
    mailboxError.normalize({ status: 413, payload: { error: { code: 'FUNCTION_PAYLOAD_TOO_LARGE' } } }),
    'De bijlagen zijn te groot voor deze verzending. Verwijder een bijlage of kies kleinere bestanden.'
  );
  assert.doesNotMatch(mailboxError.normalize({ payload: { error: { detail: { reason: 'hidden' } } } }), /\[object Object\]/);
  assert.throws(() => compose.serializeSendPayload({ text: 'x'.repeat(4_100_000) }), (error) => error.code === 'FUNCTION_PAYLOAD_TOO_LARGE' && error.status === 413);
  const serialized = compose.serializeSendPayload({ attachments: [{ reference: 'opaque-reference' }] });
  assert.ok(serialized.length < 1000);
});

test('lokale payloadafwijzing roept geen send-endpoint aan en dubbelklikken blijft single-flight', async () => {
  const requests = [];
  const toasts = [];
  const values = {
    'c-to': { value: 'prospect@example.nl' },
    'c-cc': { value: '' },
    'c-bcc': { value: '' },
    'c-subject': { value: 'Payloadcontrole' },
    'c-body': { value: 'x'.repeat(4_100_000) },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const documentRef = {
    getElementById: (id) => values[id] || null,
    querySelector: () => null,
  };
  const controller = composeController.create({
    document: documentRef,
    compose: {
      getAttachments: () => [],
      serializeSendPayload: compose.serializeSendPayload,
      reset() {},
      resetOptionalFields() {},
    },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'serve@softora.nl',
    fetch: async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
    toast: (message) => toasts.push(message),
  });
  await controller.send();
  assert.equal(requests.length, 0);
  assert.match(toasts.at(-1), /te groot/);
  assert.doesNotMatch(toasts.at(-1), /\[object Object\]/);

  values['c-body'].value = 'Korte tekst.';
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const singleFlightController = composeController.create({
    document: documentRef,
    compose: {
      getAttachments: () => [],
      serializeSendPayload: JSON.stringify,
      reset() {},
      resetOptionalFields() {},
    },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'serve@softora.nl',
    fetch: async (url, options) => {
      requests.push([url, options]);
      await pending;
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
    toast: () => {},
  });
  const first = singleFlightController.send();
  const second = singleFlightController.send();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(requests.length, 1);
});

test('compose uploadt drie normale PNGs direct en stuurt alleen korte references door', async () => {
  const documentRef = {
    getElementById: () => ({ innerHTML: '', value: '', hidden: false }),
  };
  compose.resetOptionalFields(documentRef);
  const files = [1, 2, 3].map((index) => {
    const file = new Blob([Buffer.from([index, index + 1, index + 2])], { type: 'image/png' });
    Object.defineProperty(file, 'name', { value: `screen-${index}.png` });
    return file;
  });
  assert.equal((await compose.addAttachments(files, documentRef)).ok, true);
  const calls = [];
  const uploads = files.map((file, index) => ({
    reference: `reference-${index}`,
    signedUrl: `https://storage.test/upload-${index}`,
    filename: file.name,
    contentType: file.type,
    size: file.size,
    expiresAt: Date.now() + 30 * 60 * 1000,
  }));
  const refs = await compose.uploadAttachments(compose.getAttachments(), {
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/mailbox/attachments/upload-url') {
        const payload = JSON.parse(options.body);
        assert.equal(payload.attachments.length, 3);
        assert.equal(payload.attachments.some((item) => 'contentBase64' in item), false);
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    payload: { account: 'serve@softora.nl', to: 'prospect@example.nl', subject: 'Screenshots' },
  });
  assert.deepEqual(refs.map((item) => item.reference), ['reference-0', 'reference-1', 'reference-2']);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.options.method === 'PUT').length, 3);
  assert.ok(calls.filter((call) => call.options.method === 'PUT').every((call) => call.options.body instanceof FormData));
  assert.ok(calls.filter((call) => call.options.method === 'PUT')
    .every((call) => call.options.headers['x-upsert'] === 'true'));
  compose.resetOptionalFields(documentRef);
});

function createAttachmentDocument() {
  return { getElementById: () => ({ innerHTML: '', value: '', hidden: false }) };
}

function createBrowserFile(name, type = 'image/png', bytes = [1, 2, 3]) {
  const file = new Blob([Buffer.from(bytes)], { type });
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function createValidUpload(file, index = 0, overrides = {}) {
  return {
    reference: `reference-${index}`,
    signedUrl: `https://storage.test/upload-${index}`,
    filename: serverSafeFilename(file.name),
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    expiresAt: Date.now() + 30 * 60 * 1000,
    ...overrides,
  };
}

test('clientbestandsnamen blijven exact gelijk aan de veilige serverpolicy', async () => {
  const documentRef = createAttachmentDocument();
  const names = [
    'ﬁle.pdf',
    'a\u0000b.pdf',
    '../route\\bewijs.pdf',
    '...report.pdf',
    'design..final.pdf',
    `offer\u200B\u202E${'a'.repeat(130)}.png`,
    'résumé € 100% #1.pdf',
  ];
  for (const name of names) {
    compose.resetOptionalFields(documentRef);
    const file = createBrowserFile(name, name.endsWith('.png') ? 'image/png' : 'application/pdf');
    assert.equal((await compose.addAttachments([file], documentRef)).ok, true, name);
    assert.equal(compose.getAttachments()[0].filename, serverSafeFilename(name), name);
  }
  compose.resetOptionalFields(documentRef);
});

test('tijdelijke plan- en PUT-fouten retryen eenmaal met now=0, zonder retryvertraging en op exact dezelfde URL', async () => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const file = createBrowserFile('retry.png');
  await compose.addAttachments([file], documentRef);
  const upload = createValidUpload(file, 0, { expiresAt: 1_800_000 });
  let planAttempts = 0;
  let putAttempts = 0;
  let sleepCalls = 0;
  const putUrls = [];
  const references = await compose.uploadAttachments(compose.getAttachments(), {
    now: () => 0,
    retryDelayMs: 0,
    sleep: async () => { sleepCalls += 1; },
    fetch: async (url, request) => {
      if (url === '/api/mailbox/attachments/upload-url') {
        planAttempts += 1;
        if (planAttempts === 1) {
          return { ok: false, status: 503, json: async () => ({ ok: false, retryable: true }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads: [upload] }) };
      }
      putUrls.push(url);
      putAttempts += 1;
      assert.equal(request.headers['x-upsert'], 'true');
      if (putAttempts === 1) throw Object.assign(new Error('response verloren'), { code: 'ECONNRESET' });
      return { ok: true, status: 200 };
    },
    payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
  });
  assert.equal(planAttempts, 2);
  assert.equal(putAttempts, 2);
  assert.deepEqual(putUrls, [upload.signedUrl, upload.signedUrl]);
  assert.equal(sleepCalls, 0);
  assert.deepEqual(references.map((item) => item.reference), [upload.reference]);
  compose.resetOptionalFields(documentRef);
});

test('tijdelijke HTTP-statussen retryen plan en PUT exact eenmaal en behouden de gekozen bijlage', async (t) => {
  const documentRef = createAttachmentDocument();
  for (const phase of ['plan', 'PUT']) {
    for (const status of [408, 425, 429, 500, 502, 504]) {
      await t.test(`${phase} HTTP ${status}`, async () => {
        compose.resetOptionalFields(documentRef);
        const file = createBrowserFile(`${phase.toLowerCase()}-${status}.png`);
        await compose.addAttachments([file], documentRef);
        const upload = createValidUpload(file);
        let planAttempts = 0;
        let putAttempts = 0;
        const references = await compose.uploadAttachments(compose.getAttachments(), {
          retryDelayMs: 0,
          fetch: async (url) => {
            if (url === '/api/mailbox/attachments/upload-url') {
              planAttempts += 1;
              if (phase === 'plan' && planAttempts === 1) {
                return {
                  ok: false,
                  status,
                  json: async () => ({ ok: false, code: 'ATTACHMENT_TEMPORARY' }),
                };
              }
              return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, uploads: [upload] }),
              };
            }
            putAttempts += 1;
            if (phase === 'PUT' && putAttempts === 1) {
              return {
                ok: false,
                status,
                json: async () => ({ ok: false, code: 'ATTACHMENT_TEMPORARY' }),
              };
            }
            return { ok: true, status: 200 };
          },
          payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
        });
        assert.equal(planAttempts, phase === 'plan' ? 2 : 1);
        assert.equal(putAttempts, phase === 'PUT' ? 2 : 1);
        assert.deepEqual(references.map((item) => item.reference), [upload.reference]);
        assert.equal(compose.getAttachments().length, 1);
        assert.strictEqual(compose.getAttachments()[0].file, file);
      });
    }
  }
  compose.resetOptionalFields(documentRef);
});

test('iedere definitieve 4xx stopt na één planrequest, ook als de body retryable claimt', async (t) => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const file = createBrowserFile('definitief.pdf', 'application/pdf');
  await compose.addAttachments([file], documentRef);
  for (const status of [400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 451, 499]) {
    await t.test(`HTTP ${status}`, async () => {
      let attempts = 0;
      await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
        retryDelayMs: 0,
        fetch: async () => {
          attempts += 1;
          return {
            ok: false,
            status,
            json: async () => ({ ok: false, retryable: true, code: 'PROVIDER_CLAIM' }),
          };
        },
        payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
      }));
      assert.equal(attempts, 1);
      assert.equal(compose.getAttachments().length, 1);
    });
  }
  compose.resetOptionalFields(documentRef);
});

test('hangende HTTP-400-body wordt voor plan en PUT nooit gelezen of als timeout geretryd', async (t) => {
  const documentRef = createAttachmentDocument();
  await t.test('plan', async () => {
    compose.resetOptionalFields(documentRef);
    const file = createBrowserFile('plan-400.pdf', 'application/pdf');
    await compose.addAttachments([file], documentRef);
    let planAttempts = 0;
    let putAttempts = 0;
    let bodyReads = 0;
    await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
      planTimeoutMs: 5,
      stagingTimeoutMs: 50,
      retryDelayMs: 0,
      fetch: async (url) => {
        if (url === '/api/mailbox/attachments/upload-url') {
          planAttempts += 1;
          return {
            ok: false,
            status: 400,
            json: () => {
              bodyReads += 1;
              return new Promise(() => {});
            },
          };
        }
        putAttempts += 1;
        return { ok: true, status: 200 };
      },
      payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
    }), (error) => error.status === 400 && error.retryable === false);
    assert.equal(planAttempts, 1);
    assert.equal(putAttempts, 0);
    assert.equal(bodyReads, 0);
    assert.equal(compose.getAttachments().length, 1);
    assert.strictEqual(compose.getAttachments()[0].file, file);
  });

  await t.test('PUT', async () => {
    compose.resetOptionalFields(documentRef);
    const file = createBrowserFile('put-400.pdf', 'application/pdf');
    await compose.addAttachments([file], documentRef);
    const upload = createValidUpload(file);
    let planAttempts = 0;
    let putAttempts = 0;
    let bodyReads = 0;
    await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
      uploadTimeoutMs: 5,
      stagingTimeoutMs: 50,
      retryDelayMs: 0,
      fetch: async (url) => {
        if (url === '/api/mailbox/attachments/upload-url') {
          planAttempts += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, uploads: [upload] }),
          };
        }
        if (url === '/api/mailbox/attachments/cleanup') return { ok: true, status: 200 };
        putAttempts += 1;
        return {
          ok: false,
          status: 400,
          json: () => {
            bodyReads += 1;
            return new Promise(() => {});
          },
        };
      },
      payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
    }), (error) => error.status === 400 && error.retryable === false);
    assert.equal(planAttempts, 1);
    assert.equal(putAttempts, 1);
    assert.equal(bodyReads, 0);
    assert.equal(compose.getAttachments().length, 1);
    assert.strictEqual(compose.getAttachments()[0].file, file);
  });
  compose.resetOptionalFields(documentRef);
});

test('malformed HTTP-200-planbody retryt eenmaal en start daarna precies één PUT', async () => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const file = createBrowserFile('malformed.png');
  await compose.addAttachments([file], documentRef);
  const upload = createValidUpload(file);
  let planAttempts = 0;
  let putAttempts = 0;
  const references = await compose.uploadAttachments(compose.getAttachments(), {
    retryDelayMs: 0,
    fetch: async (url) => {
      if (url === '/api/mailbox/attachments/upload-url') {
        planAttempts += 1;
        if (planAttempts === 1) {
          return { ok: true, status: 200, json: async () => { throw new SyntaxError('afgekapt JSON'); } };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads: [upload] }) };
      }
      putAttempts += 1;
      return { ok: true, status: 200 };
    },
    payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
  });
  assert.equal(planAttempts, 2);
  assert.equal(putAttempts, 1);
  assert.equal(references[0].reference, upload.reference);
  compose.resetOptionalFields(documentRef);
});

test('uploadplan valideert unieke references URLs HTTPS expiry contenttype bestandsnaam en integergrootte', async (t) => {
  const documentRef = createAttachmentDocument();
  const files = [createBrowserFile('strict-0.png'), createBrowserFile('strict-1.png', 'image/png', [4, 5, 6])];
  const variants = {
    'dubbele reference': (uploads) => { uploads[1].reference = uploads[0].reference; },
    'dubbele URL': (uploads) => { uploads[1].signedUrl = uploads[0].signedUrl; },
    'reference met witruimte': (uploads) => { uploads[0].reference = ` ${uploads[0].reference}`; },
    'URL met witruimte': (uploads) => { uploads[0].signedUrl = `${uploads[0].signedUrl} `; },
    'onveilige URL': (uploads) => { uploads[0].signedUrl = 'http://storage.test/upload'; },
    'URL zonder host': (uploads) => { uploads[0].signedUrl = 'https://'; },
    'verlopen': (uploads) => { uploads[0].expiresAt = 999; uploads[1].expiresAt = 999; },
    'expiry is tekst': (uploads) => { uploads[0].expiresAt = String(uploads[0].expiresAt); },
    'ongelijke expiry': (uploads) => { uploads[1].expiresAt += 1; },
    'contenttype ontbreekt': (uploads) => { uploads[0].contentType = ''; },
    'contenttype niet canoniek': (uploads) => { uploads[0].contentType = 'IMAGE/PNG'; },
    'contenttype ongeldig': (uploads) => { uploads[0].contentType = 'image/png; charset=x'; },
    'bestandsnaam wijkt af': (uploads) => { uploads[0].filename = 'ander.png'; },
    'grootte is tekst': (uploads) => { uploads[0].size = String(uploads[0].size); },
    'grootte is fractioneel': (uploads) => { uploads[0].size = 1.5; },
    'grootte wijkt af': (uploads) => { uploads[0].size += 1; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    await t.test(label, async () => {
      compose.resetOptionalFields(documentRef);
      await compose.addAttachments(files, documentRef);
      const validUploads = files.map((file, index) => createValidUpload(file, index, {
        expiresAt: 1_800_000,
      }));
      const malformedUploads = validUploads.map((upload) => ({ ...upload }));
      mutate(malformedUploads);
      let planAttempts = 0;
      let putAttempts = 0;
      const cleanupRequests = [];
      const references = await compose.uploadAttachments(compose.getAttachments(), {
        now: () => 1_000,
        retryDelayMs: 0,
        fetch: async (url, request) => {
          if (url === '/api/mailbox/attachments/upload-url') {
            planAttempts += 1;
            return {
              ok: true,
              status: 200,
              json: async () => ({ ok: true, uploads: planAttempts === 1 ? malformedUploads : validUploads }),
            };
          }
          if (url === '/api/mailbox/attachments/cleanup') {
            cleanupRequests.push(JSON.parse(request.body));
            return { ok: true, status: 200 };
          }
          putAttempts += 1;
          return { ok: true, status: 200 };
        },
        payload: { account: 'serve@softora.nl', to: 'prospect@example.nl', idempotencyKey: `strict:${label}` },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(planAttempts, 2);
      assert.equal(putAttempts, 2);
      assert.equal(references.length, 2);
      assert.equal(cleanupRequests.length, 1);
    });
  }
  compose.resetOptionalFields(documentRef);
});

test('hangende planbody en verloren PUT-response worden afgebroken en begrensd herhaald', async (t) => {
  const documentRef = createAttachmentDocument();
  await t.test('planbody', async () => {
    compose.resetOptionalFields(documentRef);
    const file = createBrowserFile('plan-timeout.png');
    await compose.addAttachments([file], documentRef);
    const signals = [];
    await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
      planTimeoutMs: 5,
      stagingTimeoutMs: 100,
      retryDelayMs: 0,
      fetch: async (_url, request) => {
        signals.push(request.signal);
        return { ok: true, status: 200, json: () => new Promise(() => {}) };
      },
      payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
    }), (error) => error.code === 'MAILBOX_ATTACHMENT_REQUEST_TIMEOUT' && error.status === 504);
    assert.equal(signals.length, 2);
    assert.ok(signals.every((signal) => signal.aborted));
  });

  await t.test('PUT-response', async () => {
    compose.resetOptionalFields(documentRef);
    const file = createBrowserFile('put-timeout.png');
    await compose.addAttachments([file], documentRef);
    const upload = createValidUpload(file);
    const putSignals = [];
    let putAttempts = 0;
    await compose.uploadAttachments(compose.getAttachments(), {
      uploadTimeoutMs: 5,
      stagingTimeoutMs: 100,
      retryDelayMs: 0,
      fetch: async (url, request) => {
        if (url === '/api/mailbox/attachments/upload-url') {
          return { ok: true, status: 200, json: async () => ({ ok: true, uploads: [upload] }) };
        }
        putAttempts += 1;
        putSignals.push(request.signal);
        if (putAttempts === 1) return new Promise(() => {});
        return { ok: true, status: 200 };
      },
      payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
    });
    assert.equal(putAttempts, 2);
    assert.equal(putSignals[0].aborted, true);
    assert.equal(putSignals[1].aborted, false);
  });
  compose.resetOptionalFields(documentRef);
});

test('gedeeltelijke upload ruimt alle references begrensd keepalive op zonder de uploadfout te maskeren', async () => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const files = [createBrowserFile('partial-0.png'), createBrowserFile('partial-1.png', 'image/png', [4])];
  await compose.addAttachments(files, documentRef);
  const uploads = files.map((file, index) => createValidUpload(file, index));
  let failedPutAttempts = 0;
  const cleanupCalls = [];
  await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
    retryDelayMs: 0,
    cleanupTimeoutMs: 5,
    fetch: async (url, request) => {
      if (url === '/api/mailbox/attachments/upload-url') {
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads }) };
      }
      if (url === '/api/mailbox/attachments/cleanup') {
        cleanupCalls.push({ request, payload: JSON.parse(request.body) });
        if (cleanupCalls.length === 1) return new Promise(() => {});
        return { ok: true, status: 200 };
      }
      if (url === uploads[0].signedUrl) return { ok: true, status: 200 };
      failedPutAttempts += 1;
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, code: 'ATTACHMENT_STORAGE_TEMPORARY', retryable: true }),
      };
    },
    payload: {
      account: 'serve@softora.nl',
      to: 'prospect@example.nl',
      idempotencyKey: 'partial-cleanup',
    },
  }), (error) => error.code === 'ATTACHMENT_STORAGE_TEMPORARY' && error.status === 503);
  assert.equal(failedPutAttempts, 2);
  assert.equal(cleanupCalls.length, 1, 'de uploadfout komt terug terwijl cleanup nog loopt');
  assert.equal(cleanupCalls[0].request.signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cleanupCalls.length, 2);
  assert.ok(cleanupCalls.every((call) => call.request.keepalive === true));
  assert.ok(cleanupCalls.every((call) => call.payload.account === 'serve@softora.nl'));
  assert.ok(cleanupCalls.every((call) => call.payload.idempotencyKey === 'partial-cleanup'));
  assert.ok(cleanupCalls.every((call) => (
    JSON.stringify(call.payload.attachments.map((item) => item.reference))
      === JSON.stringify(uploads.map((item) => item.reference))
  )));
  assert.equal(compose.getAttachments().length, 2);
  compose.resetOptionalFields(documentRef);
});

test('FormData-fallback uploadt hetzelfde File-object met het canonieke servercontenttype', async () => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const file = createBrowserFile('fallback.pdf', 'text/plain');
  await compose.addAttachments([file], documentRef);
  const upload = createValidUpload(file, 0, { contentType: 'application/pdf' });
  let putRequest = null;
  await compose.uploadAttachments(compose.getAttachments(), {
    FormData: function BrokenFormData() { throw new Error('FormData ontbreekt'); },
    fetch: async (url, request) => {
      if (url === '/api/mailbox/attachments/upload-url') {
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads: [upload] }) };
      }
      putRequest = request;
      return { ok: true, status: 200 };
    },
    payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
  });
  assert.strictEqual(putRequest.body, file);
  assert.equal(putRequest.headers['content-type'], 'application/pdf');
  assert.equal(putRequest.headers['x-upsert'], 'true');
  compose.resetOptionalFields(documentRef);
});

test('maximale batch deelt één absoluut stagingbudget over alle PUTs en retry', async () => {
  const documentRef = createAttachmentDocument();
  compose.resetOptionalFields(documentRef);
  const files = Array.from({ length: 5 }, (_, index) => createBrowserFile(`batch-${index}.png`, 'image/png', [index + 1]));
  await compose.addAttachments(files, documentRef);
  const uploads = files.map((file, index) => createValidUpload(file, index, { expiresAt: 1_800_000 }));
  let virtualNow = 1_000;
  const attempts = new Map();
  await assert.rejects(compose.uploadAttachments(compose.getAttachments(), {
    now: () => virtualNow,
    stagingTimeoutMs: 100,
    uploadTimeoutMs: 1_000,
    retryDelayMs: 0,
    fetch: async (url) => {
      if (url === '/api/mailbox/attachments/upload-url') {
        virtualNow += 5;
        return { ok: true, status: 200, json: async () => ({ ok: true, uploads }) };
      }
      if (url === '/api/mailbox/attachments/cleanup') return { ok: true, status: 200 };
      const count = (attempts.get(url) || 0) + 1;
      attempts.set(url, count);
      virtualNow += 15;
      if (url.endsWith('upload-1') && count === 1) {
        throw Object.assign(new Error('tijdelijke reset'), { code: 'ECONNRESET' });
      }
      if (url.endsWith('upload-4')) return new Promise(() => {});
      return { ok: true, status: 200 };
    },
    payload: { account: 'serve@softora.nl', to: 'prospect@example.nl' },
  }), (error) => error.code === 'MAILBOX_ATTACHMENT_STAGING_TIMEOUT' && error.status === 504);
  assert.equal(attempts.size, 5);
  assert.equal(attempts.get(uploads[1].signedUrl), 2);
  assert.equal(attempts.get(uploads[4].signedUrl), 1);
  assert.equal(compose.getAttachments().length, 5);
  compose.resetOptionalFields(documentRef);
});
