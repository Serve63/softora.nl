const test = require('node:test');
const assert = require('node:assert/strict');

const resilienceModule = require('../../assets/premium-mailbox-compose-send-resilience');
const composeController = require('../../assets/premium-mailbox-compose-controller');

class MemoryStorage {
  constructor(options = {}) {
    this.values = new Map();
    this.throwOnSet = options.throwOnSet === true;
    this.silentSet = options.silentSet === true;
  }

  get length() { return this.values.size; }

  key(index) { return Array.from(this.values.keys())[index] ?? null; }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }

  setItem(key, value) {
    if (this.throwOnSet) throw new Error('quota/security failure');
    if (!this.silentSet) this.values.set(String(key), String(value));
  }

  removeItem(key) { this.values.delete(String(key)); }
}

function createLockManager() {
  let tail = Promise.resolve();
  return {
    request(name, options, callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      return previous.then(() => callback({ name, mode: options.mode })).finally(release);
    },
  };
}

function createRandomUUID(prefix = 'uuid') {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === String(name).toLowerCase());
        return entry ? entry[1] : null;
      },
    },
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

function basePayload(overrides = {}) {
  return {
    account: 'serve@softora.nl',
    owner: 'serve',
    provider: '',
    mode: 'reply',
    idempotencyKey: 'browser:initial',
    context: {
      conversationId: 'Conversation:CaseSensitive',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
      messageId: '<Inbound.Case@Example.nl>',
      references: '<Root.Case@Example.nl> <Inbound.Case@Example.nl>',
    },
    to: 'prospect@example.nl',
    cc: '',
    bcc: '',
    subject: 'Re: Website',
    body: 'Exact antwoord zonder lokale opslag van deze tekst.',
    attachments: [],
    ...overrides,
  };
}

function preflightResult(payload, status = 'ready', overrides = {}) {
  const suppliedProof = payload.reconcileProof && typeof payload.reconcileProof === 'object'
    ? payload.reconcileProof : null;
  const reconcileProof = suppliedProof || {
    version: 1,
    idempotencyKey: payload.idempotencyKey,
    owner: payload.owner,
    accountEmail: payload.account,
    recipientEmail: payload.to,
    provider: payload.provider || 'smtp',
    mode: payload.mode,
    conversationId: payload.context?.conversationId || '',
    replyTargetMessageId: payload.replyIdentity?.sourceMessageId || payload.context?.messageId || '',
    references: payload.context?.references || '',
    providerThreadId: payload.providerThreadId || payload.replyIdentity?.providerThreadId || '',
    scopeFingerprint: `${payload.provider || 'smtp'}-${payload.mode}-scope:${'a'.repeat(64)}`,
    requestPayloadFingerprint: 'b'.repeat(64),
    attachmentsMetadata: payload.attachmentsMetadata || [],
  };
  return {
    preflight: true,
    status,
    externalEffect: false,
    provider: reconcileProof.provider,
    owner: reconcileProof.owner,
    accountEmail: reconcileProof.accountEmail,
    mode: reconcileProof.mode,
    conversationId: reconcileProof.conversationId,
    replyTargetMessageId: reconcileProof.replyTargetMessageId,
    providerThreadId: reconcileProof.providerThreadId,
    reservationReady: status === 'ready',
    reconcileProof,
    ...(status === 'accepted' ? {
      acceptedResult: {
        intentId: `send:${payload.idempotencyKey}`,
        messageId: '<accepted@softora.nl>',
        sentMessage: {
          softoraSendIntentId: `send:${payload.idempotencyKey}`,
          messageId: '<accepted@softora.nl>',
          attachments: payload.attachmentsMetadata,
        },
      },
    } : {}),
    ...overrides,
  };
}

function parseRequest(request) {
  return JSON.parse(request.body);
}

function mutableProofRequiredResponse() {
  return response(409, {
    ok: false,
    code: 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED',
    error: 'Mailcontrole mislukt',
    detail: 'De verzend-ID is nog niet duurzaam geregistreerd; bewijs eerst opnieuw de actuele replybron.',
  });
}

function acceptedSendResult(label) {
  const intentId = `send:${label}`;
  const messageId = `<${label}@softora.nl>`;
  return {
    intentId,
    messageId,
    sentMessage: { softoraSendIntentId: intentId, messageId },
  };
}

async function seedMarker(options = {}) {
  const payload = options.payload || basePayload();
  const attachmentsMetadata = options.attachmentsMetadata || [];
  const payloadFingerprint = await resilienceModule.createPayloadFingerprint(
    payload,
    attachmentsMetadata,
    { crypto: globalThis.crypto }
  );
  const localScopeFingerprint = await resilienceModule.createLocalScopeFingerprint(
    payload,
    { crypto: globalThis.crypto }
  );
  const proofPayload = { ...payload, attachmentsMetadata };
  const reconcileProof = options.reconcileProof || preflightResult(proofPayload).reconcileProof;
  return resilienceModule.compareAndSwapMarker(options.storage, {
    version: 1,
    idempotencyKey: payload.idempotencyKey,
    payloadFingerprint,
    localScopeFingerprint,
    state: options.state || 'armed',
    createdAt: 1,
    updatedAt: 1,
    staging: options.staging || [],
    attachmentsMetadata,
    durableIdentity: null,
    reconcileProof,
    ...(options.sendStartedAt === undefined ? {} : { sendStartedAt: options.sendStartedAt }),
  }, null, { now: () => 1, randomUUID: createRandomUUID('seed') });
}

function createProtocol(options = {}) {
  return resilienceModule.create({
    ...options,
    storage: options.storage || new MemoryStorage(),
    locks: options.locks || createLockManager(),
    fetch: options.fetch,
    now: options.now,
    randomUUID: options.randomUUID || createRandomUUID(),
    crypto: globalThis.crypto,
    logger: { warn() {} },
  });
}

test('marker is verified by write/readback before preflight, upload and send', async () => {
  const storage = new MemoryStorage();
  const events = [];
  const payload = basePayload();
  let readyProof = null;
  const protocol = createProtocol({
    storage,
    fetch: async (url, request) => {
      events.push(url);
      const requestPayload = parseRequest(request);
      const markers = resilienceModule.listMarkers(storage);
      assert.equal(markers.length, 1);
      assert.equal(markers[0].idempotencyKey, requestPayload.idempotencyKey);
      assert.equal(markers[0].payloadFingerprint.length, 64);
      if (url.endsWith('/preflight')) {
        const result = preflightResult(requestPayload);
        readyProof = result.reconcileProof;
        return response(200, { ok: true, result });
      }
      assert.equal(markers[0].state, 'dispatching');
      assert.deepEqual(requestPayload.reconcileProof, readyProof);
      assert.equal(requestPayload.reconcileProof.idempotencyKey, requestPayload.idempotencyKey);
      assert.deepEqual(requestPayload.reconcileProof.attachmentsMetadata, requestPayload.attachmentsMetadata);
      return response(200, { ok: true, result: acceptedSendResult('durable-first') });
    },
  });

  const result = await protocol.execute({ payload, attachments: [] });
  assert.deepEqual(events, ['/api/mailbox/send/preflight', '/api/mailbox/send']);
  assert.equal(result.result.intentId, 'send:durable-first');
  const raw = storage.getItem(resilienceModule.markerStorageKey(payload.idempotencyKey));
  assert.doesNotMatch(raw, /Exact antwoord zonder lokale opslag/);
  assert.equal(JSON.parse(raw).state, 'accepted');
});

for (const [label, storage] of [
  ['setItem gooit', new MemoryStorage({ throwOnSet: true })],
  ['setItem is een stille no-op', new MemoryStorage({ silentSet: true })],
]) {
  test(`opslag faalt gesloten wanneer ${label}`, async () => {
    let fetchCalls = 0;
    const protocol = createProtocol({
      storage,
      fetch: async () => { fetchCalls += 1; throw new Error('fetch mag niet starten'); },
    });
    await assert.rejects(
      protocol.execute({ payload: basePayload(), attachments: [] }),
      (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_UNAVAILABLE'
    );
    assert.equal(fetchCalls, 0);
  });
}

test('ontbrekende Web Locks stoppen vóór opslag, preflight, upload en send', async () => {
  const storage = new MemoryStorage();
  let fetchCalls = 0;
  const protocol = resilienceModule.create({
    storage,
    locks: null,
    navigator: {},
    fetch: async () => { fetchCalls += 1; },
    crypto: globalThis.crypto,
  });
  await assert.rejects(
    protocol.execute({ payload: basePayload(), attachments: [] }),
    (error) => error.code === 'MAILBOX_SEND_CROSS_TAB_LOCK_UNAVAILABLE'
  );
  assert.equal(storage.length, 0);
  assert.equal(fetchCalls, 0);
});

test('verloren sendresponse en reload gebruiken dezelfde marker en preflighten vóór een retry', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let accepted = false;
  let sendCalls = 0;
  const calls = [];
  const payloads = [];
  const fetch = async (url, request) => {
    const payload = parseRequest(request);
    calls.push(url);
    payloads.push(payload);
    if (url.endsWith('/preflight')) {
      return response(200, {
        ok: true,
        result: preflightResult(payload, accepted ? 'accepted' : 'ready'),
      });
    }
    sendCalls += 1;
    accepted = true;
    throw Object.assign(new Error('response verloren bij tabsluiting'), { code: 'ECONNRESET' });
  };
  const firstTab = createProtocol({ storage, locks, fetch, randomUUID: createRandomUUID('first') });
  await assert.rejects(firstTab.execute({ payload: basePayload(), attachments: [] }), /response verloren/);
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');

  const reloadedTab = createProtocol({ storage, locks, fetch, randomUUID: createRandomUUID('reload') });
  const recovered = await reloadedTab.execute({
    payload: basePayload({ idempotencyKey: 'browser:new-after-reload' }),
    attachments: [],
  });
  assert.equal(recovered.recoveredByPreflight, true);
  assert.equal(recovered.idempotencyKey, 'browser:initial');
  assert.equal(sendCalls, 1);
  assert.deepEqual(calls, [
    '/api/mailbox/send/preflight', '/api/mailbox/send', '/api/mailbox/send/preflight',
  ]);
  assert.equal(payloads[0].body, basePayload().body);
  assert.deepEqual(Object.keys(payloads[2]).sort(), ['idempotencyKey', 'reconcileProof']);
  assert.equal('body' in payloads[2], false);
  assert.equal('attachments' in payloads[2], false);
});

test('twee tabbladen delen de volledige Web Lock-flow en starten extern maar één send', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let accepted = false;
  let sendCalls = 0;
  let releaseSend;
  let sendStartedResolve;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendStarted = new Promise((resolve) => { sendStartedResolve = resolve; });
  const fetch = async (url, request) => {
    const payload = parseRequest(request);
    if (url.endsWith('/preflight')) {
      return response(200, {
        ok: true,
        result: preflightResult(payload, accepted ? 'accepted' : 'ready'),
      });
    }
    sendCalls += 1;
    sendStartedResolve();
    await sendGate;
    accepted = true;
    return response(200, { ok: true, result: acceptedSendResult('one-external-effect') });
  };
  const firstTab = createProtocol({ storage, locks, fetch, randomUUID: createRandomUUID('tab-a') });
  const secondTab = createProtocol({ storage, locks, fetch, randomUUID: createRandomUUID('tab-b') });
  const first = firstTab.execute({ payload: basePayload({ idempotencyKey: 'browser:tab-a' }), attachments: [] });
  const second = secondTab.execute({ payload: basePayload({ idempotencyKey: 'browser:tab-b' }), attachments: [] });
  await sendStarted;
  assert.equal(sendCalls, 1);
  releaseSend();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(
    [firstResult.recoveredByPreflight, secondResult.recoveredByPreflight].sort(),
    [false, true]
  );
  assert.equal(sendCalls, 1);
});

test('processing blijft unresolved en start nooit upload of send', async () => {
  const storage = new MemoryStorage();
  let sendOrUploadCalls = 0;
  const payload = basePayload();
  const readyProtocol = createProtocol({
    storage,
    fetch: async (url, request) => {
      const current = parseRequest(request);
      if (url.endsWith('/preflight')) {
        return response(200, { ok: true, result: preflightResult(current) });
      }
      throw new Error('eerste request onduidelijk');
    },
  });
  await assert.rejects(readyProtocol.execute({ payload, attachments: [] }), /onduidelijk/);

  const retryProtocol = createProtocol({
    storage,
    fetch: async (url, request) => {
      if (!url.endsWith('/preflight')) sendOrUploadCalls += 1;
      const current = parseRequest(request);
      return response(200, { ok: true, result: preflightResult(current, 'processing') });
    },
  });
  await assert.rejects(
    retryProtocol.execute({ payload, attachments: [] }),
    (error) => error.code === 'MAILBOX_SEND_ALREADY_PROCESSING'
  );
  assert.equal(sendOrUploadCalls, 0);
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'processing');
});

test('failed roteert naar een nieuw key die vóór upload opnieuw wordt opgeslagen en gepreflight', async () => {
  const storage = new MemoryStorage();
  const events = [];
  const keys = [];
  let preflightCalls = 0;
  const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
  const protocol = createProtocol({
    storage,
    now: () => 1_000,
    randomUUID: createRandomUUID('rotation'),
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      events.push(`${url}:${payload.idempotencyKey}`);
      if (url.endsWith('/preflight')) {
        preflightCalls += 1;
        return response(200, {
          ok: true,
          result: preflightResult(payload, preflightCalls === 1 ? 'failed' : 'ready'),
        });
      }
      return response(200, { ok: true, result: acceptedSendResult('rotated') });
    },
  });
  const result = await protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:failed-old' }),
    attachments: [file],
    onIdempotencyKey: (key) => keys.push(key),
    uploadAttachments: async (_attachments, uploadOptions) => {
      const key = uploadOptions.payload.idempotencyKey;
      events.push(`upload:${key}`);
      assert.equal(resilienceModule.readMarker(storage, key).state, 'armed');
      return [{
        reference: `opaque-${key}`, filename: file.filename, contentType: file.contentType,
        size: file.size, expiresAt: 1_801_000,
      }];
    },
  });
  assert.notEqual(result.idempotencyKey, 'browser:failed-old');
  assert.deepEqual(keys, ['browser:failed-old', result.idempotencyKey]);
  assert.equal(resilienceModule.readMarker(storage, 'browser:failed-old').state, 'failed');
  assert.equal(resilienceModule.readMarker(storage, result.idempotencyKey).state, 'accepted');
  assert.deepEqual(events.map((event) => event.split(':').slice(0, 4).join(':')), [
    '/api/mailbox/send/preflight:browser:failed-old',
    `/api/mailbox/send/preflight:${result.idempotencyKey}`,
    `upload:${result.idempotencyKey}`,
    `/api/mailbox/send:${result.idempotencyKey}`,
  ]);
});

test('verlopen pre-dispatch staging doet proof-only row-missing, behoudt de key en uploadt opnieuw', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let now = 31 * 60 * 1000;
  let uploadCalls = 0;
  let sendCalls = 0;
  const file = { filename: 'foto.png', contentType: 'image/png', size: 3, file: {} };
  const payload = basePayload({ idempotencyKey: 'browser:staged-before-send' });
  const metadata = [{ filename: file.filename, contentType: file.contentType, size: file.size }];
  await seedMarker({
    storage,
    payload,
    attachmentsMetadata: metadata,
    state: 'staged',
    staging: [{
      reference: 'expired-opaque-reference',
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      expiresAt: 30 * 60 * 1000,
    }],
  });
  let preflightCalls = 0;
  const fetch = async (url, request) => {
    const requestPayload = parseRequest(request);
    if (url.endsWith('/preflight')) {
      preflightCalls += 1;
      if (preflightCalls === 1) {
        assert.deepEqual(Object.keys(requestPayload).sort(), ['idempotencyKey', 'reconcileProof']);
        return mutableProofRequiredResponse();
      }
      assert.equal('body' in requestPayload, true);
      assert.equal(requestPayload.idempotencyKey, payload.idempotencyKey);
      assert.deepEqual(requestPayload.reconcileProof, resilienceModule.readMarker(
        storage,
        payload.idempotencyKey
      ).reconcileProof);
      return response(200, { ok: true, result: preflightResult(requestPayload) });
    }
    sendCalls += 1;
    return response(200, { ok: true, result: acceptedSendResult('restaged') });
  };
  const uploadAttachments = async () => {
    uploadCalls += 1;
    return [{
      reference: `opaque-reference-${uploadCalls}`,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      expiresAt: now + 30 * 60 * 1000,
    }];
  };
  const retry = createProtocol({ storage, locks, fetch, now: () => now });
  const result = await retry.execute({
    payload: basePayload({ idempotencyKey: 'browser:reload' }),
    attachments: [file],
    uploadAttachments,
  });
  assert.equal(result.result.messageId, '<restaged@softora.nl>');
  assert.equal(preflightCalls, 2);
  assert.equal(uploadCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(result.attachments[0].reference, 'opaque-reference-1');
  assert.equal(resilienceModule.readMarker(storage, payload.idempotencyKey).state, 'accepted');
});

test('na ready-proof kan verwisselde bijlagemetadata nooit staging of send bereiken', async () => {
  const storage = new MemoryStorage();
  const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
  let sendCalls = 0;
  const protocol = createProtocol({
    storage,
    now: () => 100,
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        return response(200, { ok: true, result: preflightResult(payload) });
      }
      sendCalls += 1;
      throw new Error('send mag niet starten');
    },
  });
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:swapped-attachment' }),
    attachments: [file],
    uploadAttachments: async () => [{
      reference: 'opaque-swapped', filename: 'ander.pdf', contentType: file.contentType,
      size: file.size, expiresAt: 60 * 60 * 1000,
    }],
  }), (error) => error.code === 'MAILBOX_ATTACHMENT_STAGING_INVALID');
  assert.equal(sendCalls, 0);
  const marker = resilienceModule.listMarkers(storage)[0];
  assert.equal(marker.state, 'armed');
  assert.deepEqual(marker.attachmentsMetadata, [{
    filename: file.filename, contentType: file.contentType, size: file.size,
  }]);
  assert.ok(marker.reconcileProof);
});

test('lege opgeslagen bijlagemetadata met een bewezen bestand is corrupte state en stopt vóór netwerk', async () => {
  const storage = new MemoryStorage();
  const metadata = [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }];
  const payload = basePayload({ idempotencyKey: 'browser:asymmetric-attachments' });
  const marker = await seedMarker({ storage, payload, attachmentsMetadata: metadata });
  resilienceModule.compareAndSwapMarker(storage, {
    ...marker,
    attachmentsMetadata: [],
  }, marker.casToken, { now: () => 2, randomUUID: createRandomUUID('asymmetric') });
  let networkCalls = 0;
  const protocol = createProtocol({
    storage,
    fetch: async () => {
      networkCalls += 1;
      throw new Error('netwerk mag niet starten');
    },
  });
  await assert.rejects(protocol.execute({
    payload,
    attachments: [],
  }), (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_CORRUPT');
  assert.equal(networkCalls, 0);
});

test('bestaande gevraagde marker wordt nooit vervangen door een andere unieke bijlagefallback', async () => {
  const storage = new MemoryStorage();
  const requestedPayload = basePayload({ idempotencyKey: 'browser:requested-existing' });
  const fallbackPayload = basePayload({ idempotencyKey: 'browser:other-fallback' });
  const metadata = [{ filename: 'ander.pdf', contentType: 'application/pdf', size: 4 }];
  await seedMarker({ storage, payload: requestedPayload, attachmentsMetadata: [] });
  await seedMarker({ storage, payload: fallbackPayload, attachmentsMetadata: metadata });
  let networkCalls = 0;
  const protocol = createProtocol({
    storage,
    fetch: async () => {
      networkCalls += 1;
      throw new Error('netwerk mag niet starten');
    },
  });
  await assert.rejects(protocol.execute({
    payload: requestedPayload,
    attachments: [],
  }), (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_PAYLOAD_MISMATCH');
  assert.equal(networkCalls, 0);
  assert.equal(resilienceModule.listMarkers(storage).length, 2);
});

test('bijlagechip zonder lokale bestandsbytes eist herselectie vóór preflight of upload', async () => {
  let networkCalls = 0;
  let uploadCalls = 0;
  const protocol = createProtocol({
    fetch: async () => {
      networkCalls += 1;
      throw new Error('netwerk mag niet starten');
    },
  });
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:missing-file-bytes' }),
    attachments: [{ filename: 'chip.pdf', contentType: 'application/pdf', size: 4 }],
    uploadAttachments: async () => {
      uploadCalls += 1;
      return [];
    },
  }), (error) => error.code === 'MAILBOX_ATTACHMENT_RESELECT_REQUIRED');
  assert.equal(networkCalls, 0);
  assert.equal(uploadCalls, 0);
});

test('malformed preflightvarianten stoppen allemaal vóór upload en send', async (t) => {
  const variants = {
    'onbekende status': (result) => { result.status = 'maybe'; },
    'ready zonder reservering': (result) => { result.reservationReady = false; },
    'processing met reservering': (result) => { result.status = 'processing'; result.reservationReady = true; },
    'verkeerde owner': (result) => { result.owner = 'martijn'; },
    'verkeerde idempotency-key': (result) => { result.reconcileProof.idempotencyKey = 'browser:Initial'; },
    'verkeerde account': (result) => { result.accountEmail = 'martijn@softora.nl'; },
    'verkeerde provider': (result) => { result.provider = 'instantly'; },
    'verkeerde mode': (result) => { result.mode = 'new-message'; },
    'verkeerde opaque conversation': (result) => { result.conversationId = 'conversation:casesensitive'; },
    'verkeerd replydoel': (result) => { result.replyTargetMessageId = '<other@example.nl>'; },
    'scope zonder provider-mode-prefix': (result) => {
      result.reconcileProof.scopeFingerprint = 'a'.repeat(64);
    },
    'scope met verkeerde mode-prefix': (result) => {
      result.reconcileProof.scopeFingerprint = `smtp-new-message-scope:${'a'.repeat(64)}`;
    },
    'scope met hoofdletterhex': (result) => {
      result.reconcileProof.scopeFingerprint = `smtp-reply-scope:${'A'.repeat(64)}`;
    },
    'requesthash met hoofdletterhex': (result) => {
      result.reconcileProof.requestPayloadFingerprint = 'B'.repeat(64);
    },
    'references met case-drift': (result) => {
      result.reconcileProof.references = '<root.case@example.nl> <inbound.case@example.nl>';
    },
    'accepted zonder identiteit': (result) => {
      result.status = 'accepted'; result.reservationReady = false; result.acceptedResult = {};
    },
    'accepted met alleen intent': (result) => {
      result.status = 'accepted'; result.reservationReady = false;
      result.acceptedResult = { intentId: 'send:intent-only' };
    },
    'accepted met alleen message': (result) => {
      result.status = 'accepted'; result.reservationReady = false;
      result.acceptedResult = { messageId: '<message-only@softora.nl>' };
    },
    'accepted met strijdige intent IDs': (result) => {
      result.status = 'accepted'; result.reservationReady = false;
      result.acceptedResult = {
        intentId: 'send:one', messageId: '<accepted@softora.nl>',
        sentMessage: { softoraSendIntentId: 'send:two', messageId: '<accepted@softora.nl>' },
      };
    },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    await t.test(label, async () => {
      let nonPreflightCalls = 0;
      const protocol = createProtocol({
        storage: new MemoryStorage(),
        fetch: async (url, request) => {
          if (!url.endsWith('/preflight')) nonPreflightCalls += 1;
          const payload = parseRequest(request);
          const result = preflightResult(payload);
          mutate(result);
          return response(200, { ok: true, result });
        },
      });
      await assert.rejects(protocol.execute({ payload: basePayload(), attachments: [] }));
      assert.equal(nonPreflightCalls, 0);
    });
  }
});

test('HTTP 200 zonder duurzame intent-, message- of provider-ID is nooit succes', async () => {
  const storage = new MemoryStorage();
  let sendCalls = 0;
  const protocol = createProtocol({
    storage,
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        return response(200, { ok: true, result: preflightResult(payload) });
      }
      sendCalls += 1;
      return response(200, { ok: true, result: {} });
    },
  });
  await assert.rejects(
    protocol.execute({ payload: basePayload(), attachments: [] }),
    (error) => error.code === 'MAILBOX_SEND_DURABLE_IDENTITY_MISSING'
  );
  assert.equal(sendCalls, 1);
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');
});

test('HTTP 200 vereist exact ok true en twee onderling consistente duurzame identiteiten', async (t) => {
  const valid = acceptedSendResult('strict-success');
  const variants = {
    'ok ontbreekt': { result: valid },
    'ok is string': { ok: 'true', result: valid },
    'alleen intent': { ok: true, result: { intentId: valid.intentId } },
    'alleen message': { ok: true, result: { messageId: valid.messageId } },
    'strijdige intent': {
      ok: true,
      result: { ...valid, sentMessage: { ...valid.sentMessage, softoraSendIntentId: 'send:other' } },
    },
    'strijdige message': {
      ok: true,
      result: { ...valid, sentMessage: { ...valid.sentMessage, messageId: '<other@softora.nl>' } },
    },
  };
  for (const [label, sendBody] of Object.entries(variants)) {
    await t.test(label, async () => {
      const storage = new MemoryStorage();
      let sendCalls = 0;
      const protocol = createProtocol({
        storage,
        fetch: async (url, request) => {
          const payload = parseRequest(request);
          if (url.endsWith('/preflight')) {
            return response(200, { ok: true, result: preflightResult(payload) });
          }
          sendCalls += 1;
          return response(200, sendBody);
        },
      });
      await assert.rejects(protocol.execute({ payload: basePayload(), attachments: [] }));
      assert.equal(sendCalls, 1);
      assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');
    });
  }
});

test('alleen een numerieke HTTP 200 kan send-succes zijn en elke andere 2xx reconcileert zonder resend', async (t) => {
  const variants = [
    ['HTTP 201', 201],
    ['HTTP 202', 202],
    ['HTTP 204', 204],
    ['status als string', '200'],
    ['ontbrekende status', undefined],
  ];
  for (const [label, status] of variants) {
    await t.test(label, async () => {
      const storage = new MemoryStorage();
      const locks = createLockManager();
      let sendCalls = 0;
      const firstProtocol = createProtocol({
        storage,
        locks,
        fetch: async (url, request) => {
          const payload = parseRequest(request);
          if (url.endsWith('/preflight')) {
            return response(200, { ok: true, result: preflightResult(payload) });
          }
          sendCalls += 1;
          const ambiguousResponse = {
            ok: true,
            async json() {
              return { ok: true, result: { intentId: `send:ambiguous-${label}` } };
            },
          };
          if (status !== undefined) ambiguousResponse.status = status;
          return ambiguousResponse;
        },
      });
      await assert.rejects(firstProtocol.execute({ payload: basePayload(), attachments: [] }));
      assert.equal(sendCalls, 1);
      assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');

      let retryPayload = null;
      const retryProtocol = createProtocol({
        storage,
        locks,
        fetch: async (url, request) => {
          assert.equal(url, '/api/mailbox/send/preflight');
          retryPayload = parseRequest(request);
          return response(200, {
            ok: true,
            result: preflightResult(retryPayload, 'accepted'),
          });
        },
      });
      const recovered = await retryProtocol.execute({
        payload: basePayload({ idempotencyKey: `browser:retry-${label}` }),
        attachments: [],
      });
      assert.equal(recovered.recoveredByPreflight, true);
      assert.equal(sendCalls, 1);
      assert.deepEqual(Object.keys(retryPayload).sort(), ['idempotencyKey', 'reconcileProof']);
      assert.equal('body' in retryPayload, false);
      assert.equal('attachments' in retryPayload, false);
    });
  }
});

test('sendtimeout blijft unresolved en een retry doet uitsluitend proof-reconciliation', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let sendCalls = 0;
  const firstProtocol = createProtocol({
    storage,
    locks,
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        return response(200, { ok: true, result: preflightResult(payload) });
      }
      sendCalls += 1;
      const error = new Error('send request timed out');
      error.name = 'AbortError';
      throw error;
    },
  });
  await assert.rejects(
    firstProtocol.execute({ payload: basePayload(), attachments: [] }),
    (error) => error.name === 'AbortError'
  );
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');

  let retryPayload = null;
  const retryProtocol = createProtocol({
    storage,
    locks,
    fetch: async (url, request) => {
      assert.equal(url, '/api/mailbox/send/preflight');
      retryPayload = parseRequest(request);
      return response(200, {
        ok: true,
        result: preflightResult(retryPayload, 'accepted'),
      });
    },
  });
  const recovered = await retryProtocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:after-timeout' }),
    attachments: [],
  });
  assert.equal(recovered.recoveredByPreflight, true);
  assert.equal(sendCalls, 1);
  assert.deepEqual(Object.keys(retryPayload).sort(), ['idempotencyKey', 'reconcileProof']);
});

test('preflightdeadline omvat een hangende JSON-body, abort en geeft de Web Lock vrij', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let phase = 'hanging-preflight-body';
  let abortCalls = 0;
  let sendCalls = 0;
  class TrackingAbortController extends AbortController {
    abort() {
      abortCalls += 1;
      return super.abort();
    }
  }
  const protocol = createProtocol({
    storage,
    locks,
    preflightDeadlineMs: 5,
    AbortController: TrackingAbortController,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        if (phase === 'hanging-preflight-body') {
          return { status: 200, ok: true, json: () => new Promise(() => {}) };
        }
        return response(200, { ok: true, result: preflightResult(payload) });
      }
      sendCalls += 1;
      return response(200, { ok: true, result: acceptedSendResult('after-preflight-timeout') });
    },
  });
  await assert.rejects(
    protocol.execute({ payload: basePayload(), attachments: [] }),
    (error) => error.code === 'MAILBOX_SEND_PREFLIGHT_TIMEOUT' && error.retryable === true
  );
  assert.equal(abortCalls, 1);
  assert.equal(sendCalls, 0);
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'armed');
  assert.equal(resilienceModule.listMarkers(storage)[0].reconcileProof, null);

  phase = 'healthy';
  const completed = await protocol.execute({ payload: basePayload(), attachments: [] });
  assert.equal(completed.result.intentId, 'send:after-preflight-timeout');
  assert.equal(sendCalls, 1);
});

test('senddeadline houdt dispatching en proof vast, row-missing resendt nooit en accepted herstelt later', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  const file = { filename: 'deadline.pdf', contentType: 'application/pdf', size: 4, file: {} };
  let phase = 'hanging-send-body';
  let abortCalls = 0;
  let uploadCalls = 0;
  let sendCalls = 0;
  let providerStarts = 0;
  const proofOnlyPayloads = [];
  class TrackingAbortController extends AbortController {
    abort() {
      abortCalls += 1;
      return super.abort();
    }
  }
  const protocol = createProtocol({
    storage,
    locks,
    now: () => 100,
    sendDeadlineMs: 5,
    AbortController: TrackingAbortController,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    fetch: async (url, request) => {
      const payload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        if (phase === 'hanging-send-body') {
          return response(200, { ok: true, result: preflightResult(payload) });
        }
        proofOnlyPayloads.push(payload);
        if (phase === 'row-missing') return mutableProofRequiredResponse();
        return response(200, { ok: true, result: preflightResult(payload, 'accepted') });
      }
      sendCalls += 1;
      providerStarts += 1;
      return { status: 200, ok: true, json: () => new Promise(() => {}) };
    },
  });
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:send-deadline' }),
    attachments: [file],
    uploadAttachments: async () => {
      uploadCalls += 1;
      return [{
        reference: 'opaque-deadline', filename: file.filename, contentType: file.contentType,
        size: file.size, expiresAt: 60 * 60 * 1000,
      }];
    },
  }), (error) => error.code === 'MAILBOX_SEND_TIMEOUT' && error.retryable === true);
  const afterTimeout = resilienceModule.listMarkers(storage)[0];
  const durableProof = JSON.stringify(afterTimeout.reconcileProof);
  assert.equal(afterTimeout.state, 'dispatching');
  assert.equal(abortCalls, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(providerStarts, 1);

  phase = 'row-missing';
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:send-deadline-reload' }),
    attachments: [],
  }), (error) => error.code === 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED');
  assert.equal(JSON.stringify(resilienceModule.listMarkers(storage)[0].reconcileProof), durableProof);
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');
  assert.equal(uploadCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(providerStarts, 1);

  phase = 'accepted';
  const recovered = await protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:send-deadline-later' }),
    attachments: [],
  });
  assert.equal(recovered.recoveredByPreflight, true);
  assert.equal(recovered.attachments[0].reference, 'opaque-deadline');
  assert.equal(uploadCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(providerStarts, 1);
  assert.equal(proofOnlyPayloads.length, 2);
  assert.ok(proofOnlyPayloads.every((payload) => (
    Object.keys(payload).sort().join(',') === 'idempotencyKey,reconcileProof'
  )));
});

test('identity-headers zonder exacte successbody blijven dispatching en herstellen alleen via preflight', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  let accepted = false;
  let sendCalls = 0;
  const fetch = async (url, request) => {
    const payload = parseRequest(request);
    if (url.endsWith('/preflight')) {
      return response(200, {
        ok: true,
        result: preflightResult(payload, accepted ? 'accepted' : 'ready'),
      });
    }
    sendCalls += 1;
    accepted = true;
    return response(200, new SyntaxError('afgekapt JSON'), {
      'X-Softora-Send-Intent-Id': 'send:header-proof',
      'X-Softora-Message-Id': '<header-proof@softora.nl>',
    });
  };
  const first = createProtocol({ storage, locks, fetch });
  await assert.rejects(first.execute({ payload: basePayload(), attachments: [] }));
  assert.equal(resilienceModule.listMarkers(storage)[0].state, 'dispatching');
  const retry = createProtocol({ storage, locks, fetch });
  const recovered = await retry.execute({
    payload: basePayload({ idempotencyKey: 'browser:header-proof-retry' }),
    attachments: [],
  });
  assert.equal(recovered.recoveredByPreflight, true);
  assert.equal(sendCalls, 1);
});

test('meer dan twintig oude unresolved markers verdwijnen nooit door leeftijd of resolved-limiet', () => {
  const storage = new MemoryStorage();
  const randomUUID = createRandomUUID('marker');
  for (let index = 0; index < 25; index += 1) {
    resilienceModule.compareAndSwapMarker(storage, {
      version: 1,
      idempotencyKey: `browser:old-${index}`,
      payloadFingerprint: index.toString(16).padStart(64, '0'),
      localScopeFingerprint: 'f'.repeat(64),
      state: 'armed',
      createdAt: 0,
      updatedAt: 0,
      staging: [],
      durableIdentity: null,
    }, null, { now: () => 3 * 60 * 60 * 1000, randomUUID });
  }
  resilienceModule.pruneResolvedMarkers(storage, {
    now: () => 3 * 60 * 60 * 1000,
    maxResolvedMarkers: 20,
    randomUUID,
  });
  assert.equal(resilienceModule.listMarkers(storage).length, 25);
  assert.ok(resilienceModule.listMarkers(storage).every((marker) => marker.state === 'armed'));
});

test('keygebonden CAS weigert een verouderd token zonder de marker te wijzigen', () => {
  const storage = new MemoryStorage();
  const options = { now: () => 1, randomUUID: createRandomUUID('cas') };
  const first = resilienceModule.compareAndSwapMarker(storage, {
    version: 1,
    idempotencyKey: 'browser:cas',
    payloadFingerprint: 'a'.repeat(64),
    localScopeFingerprint: 'b'.repeat(64),
    state: 'armed',
    createdAt: 1,
    updatedAt: 1,
    staging: [],
  }, null, options);
  const second = resilienceModule.compareAndSwapMarker(storage, {
    ...first,
    state: 'staged',
  }, first.casToken, options);
  assert.throws(() => resilienceModule.compareAndSwapMarker(storage, {
    ...first,
    state: 'failed',
  }, first.casToken, options), (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_CONFLICT');
  assert.equal(resilienceModule.readMarker(storage, 'browser:cas').casToken, second.casToken);
  assert.equal(resilienceModule.readMarker(storage, 'browser:cas').state, 'staged');
});

test('reload zonder bijlage herstelt accepted en blokkeert processing uitsluitend via proof-only', async (t) => {
  for (const status of ['accepted', 'processing']) {
    await t.test(status, async () => {
      const storage = new MemoryStorage();
      const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
      const metadata = [{ filename: file.filename, contentType: file.contentType, size: file.size }];
      const payload = basePayload({ idempotencyKey: `browser:missing-${status}` });
      await seedMarker({
        storage,
        payload,
        attachmentsMetadata: metadata,
        state: 'dispatching',
        sendStartedAt: 10,
        staging: [{
          reference: `opaque-${status}`,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          expiresAt: 60 * 60 * 1000,
        }],
      });
      const calls = [];
      const protocol = createProtocol({
        storage,
        now: () => 100,
        fetch: async (url, request) => {
          calls.push({ url, payload: parseRequest(request) });
          assert.equal(url, '/api/mailbox/send/preflight');
          const proofPayload = parseRequest(request);
          return response(200, {
            ok: true,
            result: preflightResult(proofPayload, status),
          });
        },
      });
      const execution = protocol.execute({
        payload: basePayload({ idempotencyKey: `browser:reload-${status}` }),
        attachments: [],
      });
      if (status === 'accepted') {
        const recovered = await execution;
        assert.equal(recovered.recoveredByPreflight, true);
        assert.equal(recovered.attachments[0].reference, `opaque-${status}`);
        assert.equal(resilienceModule.readMarker(storage, payload.idempotencyKey).state, 'accepted');
      } else {
        await assert.rejects(execution, (error) => error.code === 'MAILBOX_SEND_ALREADY_PROCESSING');
        assert.equal(resilienceModule.readMarker(storage, payload.idempotencyKey).state, 'processing');
      }
      assert.equal(calls.length, 1);
      assert.deepEqual(Object.keys(calls[0].payload).sort(), ['idempotencyKey', 'reconcileProof']);
    });
  }
});

test('durable failed met verloren bijlage roteert key maar eist herselectie vóór een nieuwe send', async () => {
  const storage = new MemoryStorage();
  const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
  const metadata = [{ filename: file.filename, contentType: file.contentType, size: file.size }];
  const payload = basePayload({ idempotencyKey: 'browser:missing-failed' });
  await seedMarker({
    storage,
    payload,
    attachmentsMetadata: metadata,
    state: 'dispatching',
    sendStartedAt: 10,
    staging: [{
      reference: 'opaque-failed', filename: file.filename, contentType: file.contentType,
      size: file.size, expiresAt: 60 * 60 * 1000,
    }],
  });
  let phase = 'reconcile-failed';
  let sendCalls = 0;
  let uploadCalls = 0;
  let nextKey = '';
  const protocol = createProtocol({
    storage,
    now: () => 100,
    randomUUID: createRandomUUID('failed-reselect'),
    fetch: async (url, request) => {
      const requestPayload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        if (phase === 'reconcile-failed') {
          assert.deepEqual(Object.keys(requestPayload).sort(), ['idempotencyKey', 'reconcileProof']);
          phase = 'fresh-preflight';
          return response(200, { ok: true, result: preflightResult(requestPayload, 'failed') });
        }
        assert.equal(requestPayload.idempotencyKey, nextKey);
        return response(200, { ok: true, result: preflightResult(requestPayload) });
      }
      sendCalls += 1;
      return response(200, { ok: true, result: acceptedSendResult('failed-reselected') });
    },
  });
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:reload-failed' }),
    attachments: [],
    onIdempotencyKey: (value) => { nextKey = value; },
  }), (error) => error.code === 'MAILBOX_ATTACHMENT_RESELECT_REQUIRED');
  assert.notEqual(nextKey, payload.idempotencyKey);
  assert.equal(sendCalls, 0);
  assert.equal(resilienceModule.readMarker(storage, payload.idempotencyKey).state, 'failed');
  assert.equal(resilienceModule.readMarker(storage, nextKey).state, 'armed');

  const sent = await protocol.execute({
    payload: basePayload({ idempotencyKey: nextKey }),
    attachments: [file],
    uploadAttachments: async () => {
      uploadCalls += 1;
      return [{
        reference: 'opaque-reselected', filename: file.filename, contentType: file.contentType,
        size: file.size, expiresAt: 60 * 60 * 1000,
      }];
    },
  });
  assert.equal(sent.idempotencyKey, nextKey);
  assert.equal(uploadCalls, 1);
  assert.equal(sendCalls, 1);
});

test('row-missing vóór send behoudt dezelfde key maar verstuurt na reload nooit zonder herselecteerde bijlage', async () => {
  const storage = new MemoryStorage();
  const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
  const metadata = [{ filename: file.filename, contentType: file.contentType, size: file.size }];
  const payload = basePayload({ idempotencyKey: 'browser:staged-row-missing' });
  await seedMarker({
    storage,
    payload,
    attachmentsMetadata: metadata,
    state: 'staged',
    staging: [{
      reference: 'opaque-before-reload', filename: file.filename, contentType: file.contentType,
      size: file.size, expiresAt: 60 * 60 * 1000,
    }],
  });
  let nextKey = '';
  let preflightCalls = 0;
  let sendCalls = 0;
  const protocol = createProtocol({
    storage,
    now: () => 100,
    fetch: async (url, request) => {
      const requestPayload = parseRequest(request);
      if (url.endsWith('/preflight')) {
        preflightCalls += 1;
        if (Object.keys(requestPayload).length === 2) return mutableProofRequiredResponse();
        assert.equal(requestPayload.idempotencyKey, nextKey);
        assert.equal('body' in requestPayload, true);
        return response(200, { ok: true, result: preflightResult(requestPayload) });
      }
      sendCalls += 1;
      return response(200, { ok: true, result: acceptedSendResult('row-missing-reselected') });
    },
  });
  await assert.rejects(protocol.execute({
    payload: basePayload({ idempotencyKey: 'browser:reload-row-missing' }),
    attachments: [],
    onIdempotencyKey: (value) => { nextKey = value; },
  }), (error) => error.code === 'MAILBOX_ATTACHMENT_RESELECT_REQUIRED');
  assert.equal(preflightCalls, 1);
  assert.equal(sendCalls, 0);
  assert.equal(nextKey, payload.idempotencyKey);

  await protocol.execute({
    payload: basePayload({ idempotencyKey: nextKey }),
    attachments: [file],
    uploadAttachments: async () => [{
      reference: 'opaque-after-reselect', filename: file.filename, contentType: file.contentType,
      size: file.size, expiresAt: 60 * 60 * 1000,
    }],
  });
  assert.equal(preflightCalls, 3);
  assert.equal(sendCalls, 1);
});

test('row-missing na dispatching blijft bij elke retry proof-only en start nooit een extra send', async () => {
  const storage = new MemoryStorage();
  const file = { filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: {} };
  const metadata = [{ filename: file.filename, contentType: file.contentType, size: file.size }];
  const payload = basePayload({ idempotencyKey: 'browser:dispatching-row-missing' });
  await seedMarker({
    storage,
    payload,
    attachmentsMetadata: metadata,
    state: 'dispatching',
    sendStartedAt: 10,
    staging: [{
      reference: 'opaque-dispatching', filename: file.filename, contentType: file.contentType,
      size: file.size, expiresAt: 60 * 60 * 1000,
    }],
  });
  const calls = [];
  const protocol = createProtocol({
    storage,
    fetch: async (url, request) => {
      calls.push({ url, payload: parseRequest(request) });
      assert.equal(url, '/api/mailbox/send/preflight');
      return mutableProofRequiredResponse();
    },
  });
  for (let retry = 0; retry < 2; retry += 1) {
    await assert.rejects(protocol.execute({
      payload: basePayload({ idempotencyKey: `browser:dispatching-retry-${retry}` }),
      attachments: [],
    }), (error) => error.code === 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => Object.keys(call.payload).sort().join(',') === 'idempotencyKey,reconcileProof'));
  assert.equal(resilienceModule.listMarkers(storage).length, 1);
  assert.equal(resilienceModule.readMarker(storage, payload.idempotencyKey).state, 'dispatching');
});

test('uploadplan- en PUT-timeout vóór send herstellen via row-missing naar exact één send', async (t) => {
  for (const failurePoint of ['uploadplan', 'PUT']) {
    await t.test(failurePoint, async () => {
      const storage = new MemoryStorage();
      const file = { filename: `${failurePoint}.pdf`, contentType: 'application/pdf', size: 4, file: {} };
      const events = [];
      let fullPreflights = 0;
      let uploadCalls = 0;
      let sendCalls = 0;
      const protocol = createProtocol({
        storage,
        randomUUID: createRandomUUID(failurePoint),
        now: () => 100,
        fetch: async (url, request) => {
          const requestPayload = parseRequest(request);
          if (url.endsWith('/preflight')) {
            if (Object.keys(requestPayload).length === 2) {
              events.push('proof-only-row-missing');
              return mutableProofRequiredResponse();
            }
            fullPreflights += 1;
            events.push(`full-preflight-${fullPreflights}`);
            return response(200, { ok: true, result: preflightResult(requestPayload) });
          }
          sendCalls += 1;
          events.push('send');
          return response(200, { ok: true, result: acceptedSendResult(`${failurePoint}-recovered`) });
        },
      });
      const uploadAttachments = async () => {
        uploadCalls += 1;
        events.push(`${failurePoint}-${uploadCalls}`);
        if (uploadCalls === 1) {
          const error = new Error(`${failurePoint} timed out`);
          error.name = 'AbortError';
          throw error;
        }
        return [{
          reference: `opaque-${failurePoint}`, filename: file.filename, contentType: file.contentType,
          size: file.size, expiresAt: 60 * 60 * 1000,
        }];
      };
      await assert.rejects(protocol.execute({
        payload: basePayload({ idempotencyKey: `browser:${failurePoint}` }),
        attachments: [file],
        uploadAttachments,
      }), (error) => error.name === 'AbortError');
      assert.equal(sendCalls, 0);
      assert.equal(resilienceModule.listMarkers(storage)[0].state, 'armed');

      await protocol.execute({
        payload: basePayload({ idempotencyKey: `browser:${failurePoint}-reload` }),
        attachments: [file],
        uploadAttachments,
      });
      assert.deepEqual(events, [
        'full-preflight-1', `${failurePoint}-1`, 'proof-only-row-missing',
        'full-preflight-2', `${failurePoint}-2`, 'send',
      ]);
      assert.equal(sendCalls, 1);
    });
  }
});

test('controller houdt één immutable draft door preflight upload send en accepted kaart en sluit geen nieuwe composer', async () => {
  const storage = new MemoryStorage();
  const locks = createLockManager();
  const overlayClasses = new Set();
  const fields = {
    'c-to': { value: '' },
    'c-cc': { value: '' },
    'c-bcc': { value: '' },
    'c-subject': { value: '' },
    'c-body': { value: '' },
    'compose-overlay': {
      classList: {
        add: (value) => overlayClasses.add(value),
        remove: (value) => overlayClasses.delete(value),
      },
    },
  };
  const documentRef = {
    getElementById: (id) => fields[id] || null,
    querySelector: () => null,
  };
  const initialMail = {
    id: 'inbox:initial', accountEmail: 'serve@softora.nl', email: 'first@example.nl',
    subject: 'Eerste onderwerp', conversationId: 'Conversation:Initial',
  };
  const nextMail = {
    id: 'inbox:next', accountEmail: 'serve@softora.nl', email: 'second@example.nl',
    subject: 'Tweede onderwerp', conversationId: 'Conversation:Next',
  };
  const mails = new Map([[initialMail.id, initialMail], [nextMail.id, nextMail]]);
  const acceptedRecords = [];
  const requestBodies = [];
  let selectedAttachments = [];
  let releaseUpload;
  let uploadStartedResolve;
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  const uploadStarted = new Promise((resolve) => { uploadStartedResolve = resolve; });
  let readyProof = null;
  let uploadPayload = null;
  let sendPayload = null;
  const fetch = async (url, request) => {
    const payload = parseRequest(request);
    requestBodies.push({ url, payload });
    if (url.endsWith('/preflight')) {
      const result = preflightResult(payload);
      readyProof = result.reconcileProof;
      return response(200, { ok: true, result });
    }
    sendPayload = payload;
    return response(200, {
      ok: true,
      result: {
        intentId: 'send:immutable-draft',
        messageId: '<immutable-draft@softora.nl>',
        sentMessage: { messageId: '<immutable-draft@softora.nl>' },
      },
    });
  };
  const protocol = resilienceModule.create({
    storage, locks, fetch, now: () => 1_000,
    randomUUID: createRandomUUID('immutable'), crypto: globalThis.crypto,
    logger: { warn() {} },
  });
  const controller = composeController.create({
    document: documentRef,
    sendResilience: protocol,
    compose: {
      buildNewMessageContext(mail) {
        return {
          id: mail.id, mailboxId: mail.id, accountEmail: mail.accountEmail,
          to: mail.email, subject: mail.subject, conversationId: mail.conversationId,
          mode: 'new-message',
        };
      },
      getAttachments: () => selectedAttachments.map((attachment) => ({ ...attachment })),
      async uploadAttachments(attachments, options) {
        uploadPayload = JSON.parse(JSON.stringify(options.payload));
        uploadStartedResolve();
        await uploadGate;
        return attachments.map((attachment, index) => ({
          reference: `opaque-${index}`,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          expiresAt: 1_801_000,
        }));
      },
      serializeSendPayload: JSON.stringify,
      reset() {},
      resetOptionalFields() { selectedAttachments = []; },
    },
    campaignInbox: {
      getConversationAction: (mail) => ({ kind: 'new-message', message: mail }),
      getAccount: (mail) => mail.accountEmail,
      getOwnerByAccount: () => 'serve',
      getMessageOwner: () => 'serve',
      getOwnerLabel: () => 'Servé Creusen',
    },
    findMail: (id) => mails.get(id) || null,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'serve@softora.nl',
    getOwner: () => 'serve',
    getActiveFolder: () => 'inbox',
    fetch,
    onAcceptedSend: (record) => acceptedRecords.push(record),
    toast() {},
  });

  controller.newMessage(initialMail);
  fields['c-body'].value = 'Oorspronkelijke body';
  fields['c-cc'].value = 'cc@example.nl';
  selectedAttachments = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, file: { size: 4 },
  }];
  const sending = controller.send();
  await uploadStarted;

  fields['c-to'].value = 'mutated@example.nl';
  fields['c-subject'].value = 'Gemuteerd onderwerp';
  fields['c-body'].value = 'Gemuteerde body';
  controller.close();
  controller.newMessage(nextMail);
  fields['c-body'].value = 'Nieuwe composerbody';
  releaseUpload();
  await sending;

  assert.equal(requestBodies[0].url, '/api/mailbox/send/preflight');
  assert.equal(requestBodies[0].payload.body, 'Oorspronkelijke body');
  assert.equal(uploadPayload.body, 'Oorspronkelijke body');
  assert.deepEqual(uploadPayload.reconcileProof, readyProof);
  assert.equal(sendPayload.body, 'Oorspronkelijke body');
  assert.equal(sendPayload.to, 'first@example.nl');
  assert.equal(sendPayload.subject, 'Eerste onderwerp');
  assert.deepEqual(sendPayload.reconcileProof, readyProof);
  assert.equal(sendPayload.attachments[0].reference, 'opaque-0');
  assert.equal(acceptedRecords.length, 1);
  assert.equal(acceptedRecords[0].message.body, 'Oorspronkelijke body');
  assert.equal(acceptedRecords[0].message.to, 'first@example.nl');
  assert.equal(fields['c-to'].value, 'second@example.nl');
  assert.equal(fields['c-subject'].value, 'Tweede onderwerp');
  assert.equal(fields['c-body'].value, 'Nieuwe composerbody');
  assert.equal(overlayClasses.has('open'), true);
});
