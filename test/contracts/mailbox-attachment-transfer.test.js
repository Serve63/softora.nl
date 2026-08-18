const test = require('node:test');
const assert = require('node:assert/strict');

const compose = require('../../assets/premium-mailbox-compose');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const mailboxError = require('../../assets/premium-mailbox-error');
const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const {
  createMailboxAttachmentService,
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
      reserve: async (input) => {
        reservedAttachments = input.attachments;
        return { created: true, intent: { intentId: input.intentId, status: 'prepared' } };
      },
      startDispatch: async () => {},
      accept: async (intentId, values) => ({ intentId, status: 'accepted', messageId: values.messageId }),
      fail: async () => null,
    },
    mailboxAttachmentService: {
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
});

test('ongeldige signed attachment wordt vóór provenance/provider afgewezen', async () => {
  let providerCalls = 0;
  let reserveCalls = 0;
  const sendMessage = createMailboxComposeSend({
    getAccount: () => ({ email: 'serve@softora.nl', smtpConfigured: true, smtpIdentityMatches: true, smtpHost: 'x', smtpUser: 'serve@softora.nl', smtpPass: 'secret' }),
    isValidEmail: () => true,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({ sendMail: async () => { providerCalls += 1; } }),
    buildMailboxWebdesignSendParts: async () => null,
    appendSentMessage: async () => true,
    mailboxSendProvenanceStore: { reserve: async () => { reserveCalls += 1; return { created: true, intent: {} }; } },
    mailboxAttachmentService: { downloadAttachments: async () => { throw Object.assign(new Error('bad reference'), { code: 'MAILBOX_ATTACHMENT_REFERENCE_INVALID', status: 400 }); } },
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
  compose.resetOptionalFields(documentRef);
});
