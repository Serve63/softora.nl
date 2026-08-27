const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const compose = require('../../assets/premium-mailbox-compose');
const digest = require('../../assets/premium-mailbox-attachment-digest');
const resilience = require('../../assets/premium-mailbox-compose-send-resilience');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

function createLocks() {
  return { request(_name, _options, operation) { return Promise.resolve(operation({ mode: 'exclusive' })); } };
}

function createFile(sequences) {
  const buffers = sequences.map((value) => Uint8Array.from(value));
  let reads = 0;
  return {
    name: 'bewijs.pdf', type: 'application/pdf', size: buffers[0].byteLength,
    get reads() { return reads; },
    async arrayBuffer() {
      const bytes = buffers[Math.min(reads, buffers.length - 1)];
      reads += 1;
      return bytes.slice().buffer;
    },
  };
}

function attachment(file) {
  return {
    filename: file.name, contentType: file.type, size: file.size, file,
  };
}

function payload(idempotencyKey = 'browser:v2-integration') {
  return {
    account: 'serve@softora.nl', owner: 'serve', provider: '', mode: 'reply', idempotencyKey,
    context: {
      conversationId: 'conversation:v2', id: 'inbox:42', folder: 'inbox', uid: 42,
      messageId: '<incoming@example.nl>', references: '<root@example.nl> <incoming@example.nl>',
    },
    to: 'prospect@example.nl', cc: '', bcc: '', subject: 'Re: Website', body: 'Zie de bijlage.',
    attachments: [],
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async json() { return body; },
  };
}

function readyResult(value) {
  const proof = {
    version: 1,
    idempotencyKey: value.idempotencyKey,
    owner: value.owner,
    accountEmail: value.account,
    recipientEmail: value.to,
    provider: value.provider || 'smtp',
    mode: value.mode,
    conversationId: value.context.conversationId,
    replyTargetMessageId: value.context.messageId,
    references: value.context.references,
    providerThreadId: '',
    scopeFingerprint: `smtp-reply-scope:${'a'.repeat(64)}`,
    requestPayloadFingerprint: 'b'.repeat(64),
    attachmentsMetadata: value.attachmentsMetadata,
  };
  return {
    preflight: true, status: 'ready', externalEffect: false,
    provider: 'smtp', owner: value.owner, accountEmail: value.account,
    mode: value.mode, conversationId: value.context.conversationId,
    replyTargetMessageId: value.context.messageId, providerThreadId: '',
    reservationReady: true, reconcileProof: proof,
  };
}

function acceptedResult(label) {
  return {
    intentId: `send:${label}`,
    messageId: `<${label}@softora.nl>`,
    sentMessage: {
      softoraSendIntentId: `send:${label}`,
      messageId: `<${label}@softora.nl>`,
    },
  };
}

function createProtocol(fetch, options = {}) {
  let sequence = 0;
  return resilience.create({
    storage: options.storage || new MemoryStorage(), locks: createLocks(), fetch,
    now: options.now || (() => 1_000), randomUUID: () => `v2-${++sequence}`,
    crypto: webcrypto, attachmentDigest: digest, logger: { warn() {} },
  });
}

async function seedAttachmentMarker(storage, options = {}) {
  const value = payload(options.idempotencyKey || `browser:reload-${options.state}`);
  const attachmentsMetadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }];
  const proofValue = { ...value, attachmentsMetadata };
  const payloadFingerprint = await resilience.createPayloadFingerprint(
    proofValue,
    attachmentsMetadata,
    { crypto: webcrypto }
  );
  const localScopeFingerprint = await resilience.createLocalScopeFingerprint(
    proofValue,
    { crypto: webcrypto }
  );
  const reconcileProof = readyResult(proofValue).reconcileProof;
  const marker = resilience.compareAndSwapMarker(storage, {
    version: 1,
    idempotencyKey: value.idempotencyKey,
    payloadFingerprint,
    localScopeFingerprint,
    state: options.state,
    createdAt: 1,
    updatedAt: 1,
    attachmentsMetadata,
    staging: options.state === 'staged' || options.state === 'dispatching' ? [{
      reference: 'opaque-reload-v2', filename: 'bewijs.pdf', contentType: 'application/pdf',
      size: 4, sha256: 'a'.repeat(64), referenceVersion: 2, expiresAt: 2_000_000,
    }] : [],
    durableIdentity: null,
    reconcileProof,
    ...(options.sendStartedAt ? { sendStartedAt: options.sendStartedAt } : {}),
  }, null, { now: () => 1, randomUUID: () => 'seed-cas-token' });
  return { marker, value: proofValue, attachmentsMetadata };
}

function uploadWithCompose(files, options) {
  return compose.uploadAttachments(files, {
    ...options,
    now: () => 1_000,
    retryDelayMs: 0,
    FormData: class UnsupportedTestFormData { constructor() { throw new Error('raw body test'); } },
  });
}

test('productieflow bindt bytes en doorloopt exact preflight naar v2-plan, PUT, rehash en send', async () => {
  const file = createFile([[1, 2, 3, 4]]);
  const events = [];
  let expectedSha256 = '';
  const fetch = async (url, request) => {
    if (url === '/api/mailbox/send/preflight') {
      events.push('preflight');
      const value = JSON.parse(request.body);
      expectedSha256 = value.attachmentsMetadata[0].sha256;
      assert.match(expectedSha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(value.attachments, []);
      return response(200, { ok: true, result: readyResult(value) });
    }
    if (url === '/api/mailbox/attachments/upload-url') {
      events.push('plan');
      const value = JSON.parse(request.body);
      assert.deepEqual(value.attachments, [{
        filename: file.name, contentType: file.type, size: file.size, sha256: expectedSha256,
      }]);
      return response(200, {
        ok: true,
        uploads: [{
          reference: 'opaque-v2-reference',
          signedUrl: 'https://storage.example.test/object?signed=1',
          filename: file.name, contentType: file.type, size: file.size,
          sha256: expectedSha256, referenceVersion: 2, expiresAt: 2_000_000,
        }],
      });
    }
    if (url === 'https://storage.example.test/object?signed=1') {
      events.push('put');
      assert.equal(request.method, 'PUT');
      assert.equal(request.body, file);
      return response(200, {});
    }
    if (url === '/api/mailbox/send') {
      events.push('send');
      const value = JSON.parse(request.body);
      assert.deepEqual(value.attachmentsMetadata, [{
        filename: file.name, contentType: file.type, size: file.size, sha256: expectedSha256,
      }]);
      assert.deepEqual(value.attachments, [{
        reference: 'opaque-v2-reference', filename: file.name, contentType: file.type,
        size: file.size, sha256: expectedSha256, referenceVersion: 2,
      }]);
      return response(200, { ok: true, result: acceptedResult('v2-exact') });
    }
    throw new Error(`onverwachte URL ${url}`);
  };

  const result = await createProtocol(fetch).execute({
    payload: payload(), attachments: [attachment(file)], uploadAttachments: uploadWithCompose,
  });

  assert.deepEqual(events, ['preflight', 'plan', 'put', 'send']);
  assert.equal(result.result.intentId, 'send:v2-exact');
  assert.equal(file.reads, 3);
});

test('bytes die vóór of tijdens upload wijzigen bereiken nooit het send-endpoint', async (t) => {
  for (const phase of ['before-upload', 'during-upload']) {
    await t.test(phase, async () => {
      const sequences = phase === 'before-upload'
        ? [[1, 2, 3, 4], [4, 3, 2, 1]]
        : [[1, 2, 3, 4], [1, 2, 3, 4], [4, 3, 2, 1]];
      const file = createFile(sequences);
      let uploadCalls = 0;
      let sendCalls = 0;
      const protocol = createProtocol(async (url, request) => {
        const value = JSON.parse(request.body);
        if (url.endsWith('/preflight')) return response(200, { ok: true, result: readyResult(value) });
        sendCalls += 1;
        throw new Error('send mag nooit starten');
      });
      await assert.rejects(protocol.execute({
        payload: payload(`browser:${phase}`),
        attachments: [attachment(file)],
        uploadAttachments: async (files) => {
          uploadCalls += 1;
          return [{
            reference: `opaque-${phase}`, filename: file.name, contentType: file.type,
            size: file.size, sha256: files[0].sha256, referenceVersion: 2, expiresAt: 2_000_000,
          }];
        },
      }), (error) => error.code === 'MAILBOX_ATTACHMENT_DIGEST_MISMATCH');
      assert.equal(uploadCalls, phase === 'before-upload' ? 0 : 1);
      assert.equal(sendCalls, 0);
    });
  }
});

test('ontbrekend of gemanipuleerd v2-planbewijs wordt opgeschoond en nooit verzonden', async (t) => {
  const variants = {
    'sha ontbreekt': (upload) => { delete upload.sha256; },
    'sha wijkt af': (upload) => { upload.sha256 = '0'.repeat(64); },
    'referenceVersion ontbreekt': (upload) => { delete upload.referenceVersion; },
    'referenceVersion is legacy': (upload) => { upload.referenceVersion = 1; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    await t.test(label, async () => {
      const file = createFile([[1, 2, 3, 4]]);
      let planCalls = 0;
      let cleanupCalls = 0;
      let putCalls = 0;
      let sendCalls = 0;
      let expectedSha256 = '';
      const fetch = async (url, request) => {
        if (url.endsWith('/preflight')) {
          const value = JSON.parse(request.body);
          expectedSha256 = value.attachmentsMetadata[0].sha256;
          return response(200, { ok: true, result: readyResult(value) });
        }
        if (url === '/api/mailbox/attachments/upload-url') {
          planCalls += 1;
          const upload = {
            reference: `opaque-invalid-${planCalls}`,
            signedUrl: `https://storage.example.test/invalid-${planCalls}`,
            filename: file.name, contentType: file.type, size: file.size,
            sha256: expectedSha256, referenceVersion: 2, expiresAt: 2_000_000,
          };
          mutate(upload);
          return response(200, { ok: true, uploads: [upload] });
        }
        if (url === '/api/mailbox/attachments/cleanup') {
          cleanupCalls += 1;
          return response(200, { ok: true });
        }
        if (String(url).startsWith('https://storage.example.test/')) {
          putCalls += 1;
          return response(200, {});
        }
        if (url === '/api/mailbox/send') {
          sendCalls += 1;
          return response(200, { ok: true, result: acceptedResult('verboden') });
        }
        throw new Error(`onverwachte URL ${url}`);
      };

      await assert.rejects(createProtocol(fetch).execute({
        payload: payload(`browser:invalid-${label}`),
        attachments: [attachment(file)],
        uploadAttachments: uploadWithCompose,
      }), (error) => error.code === 'MAILBOX_ATTACHMENT_PLAN_INVALID');
      await Promise.resolve();
      assert.equal(planCalls, 2);
      assert.equal(cleanupCalls, 2);
      assert.equal(putCalls, 0);
      assert.equal(sendCalls, 0);
    });
  }
});

test('reload zonder lokale File reconcileert accepted en processing uitsluitend proof-only', async (t) => {
  for (const status of ['accepted', 'processing']) {
    await t.test(status, async () => {
      const storage = new MemoryStorage();
      const seeded = await seedAttachmentMarker(storage, { state: 'dispatching', sendStartedAt: 10 });
      const calls = [];
      const protocol = createProtocol(async (url, request) => {
        calls.push({ url, value: JSON.parse(request.body) });
        const result = readyResult(seeded.value);
        result.status = status;
        result.reservationReady = false;
        if (status === 'accepted') result.acceptedResult = acceptedResult('reload-accepted');
        return response(200, { ok: true, result });
      }, { storage });

      const execution = protocol.execute({
        payload: payload('browser:fresh-after-reload'), attachments: [],
      });
      if (status === 'accepted') {
        const recovered = await execution;
        assert.equal(recovered.recoveredByPreflight, true);
        assert.equal(recovered.attachments[0].referenceVersion, 2);
      } else {
        await assert.rejects(execution, (error) => error.code === 'MAILBOX_SEND_ALREADY_PROCESSING');
      }
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/mailbox/send/preflight');
      assert.deepEqual(Object.keys(calls[0].value).sort(), ['idempotencyKey', 'reconcileProof']);
    });
  }
});

test('reload zonder lokale File dispatcht ready, staged en row-missing nooit en eist herselectie', async (t) => {
  for (const scenario of ['ready-armed', 'ready-staged', 'row-missing']) {
    await t.test(scenario, async () => {
      const storage = new MemoryStorage();
      const state = scenario === 'ready-armed' ? 'armed' : 'staged';
      const seeded = await seedAttachmentMarker(storage, { state });
      let sendCalls = 0;
      const calls = [];
      const protocol = createProtocol(async (url, request) => {
        const value = JSON.parse(request.body);
        calls.push({ url, value });
        if (url !== '/api/mailbox/send/preflight') {
          sendCalls += 1;
          return response(200, { ok: true, result: acceptedResult('verboden-reload') });
        }
        if (scenario === 'row-missing') {
          return response(409, {
            ok: false,
            code: 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED',
            error: 'Mailcontrole mislukt',
            detail: 'De verzend-ID is nog niet duurzaam geregistreerd.',
          });
        }
        return response(200, { ok: true, result: readyResult(seeded.value) });
      }, { storage });

      await assert.rejects(protocol.execute({
        payload: payload(`browser:fresh-${scenario}`), attachments: [],
      }), (error) => error.code === 'MAILBOX_ATTACHMENT_RESELECT_REQUIRED');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/mailbox/send/preflight');
      assert.deepEqual(Object.keys(calls[0].value).sort(), ['idempotencyKey', 'reconcileProof']);
      assert.equal(sendCalls, 0);
    });
  }
});
