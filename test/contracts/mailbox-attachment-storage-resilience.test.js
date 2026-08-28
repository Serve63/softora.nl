'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  MAILBOX_ATTACHMENT_STORAGE_PREFIX,
  MAILBOX_ATTACHMENT_SWEEP_GRACE_MS,
  createMailboxAttachmentService,
} = require('../../server/services/mailbox-attachment-service');
const { createMailboxComposeRuntime } = require('../../server/services/mailbox-compose-runtime');

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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

test('attachment storage omzeilt de gedeelde cooldown en herstelt begrensd van één tijdelijke fout', async () => {
  const clientPolicies = [];
  const signedOptions = [];
  const retryDelays = [];
  let attempts = 0;
  const service = createMailboxAttachmentService({
    getSupabaseClient(policy = {}) {
      clientPolicies.push(policy);
      if (!policy.ignoreFailureCooldown || !policy.suppressFailureCooldown) {
        throw Object.assign(new Error('algemene 60s cooldown staat open'), { code: 'SUPABASE_REST_COOLDOWN' });
      }
      return {
        storage: {
          from: () => ({
            async createSignedUploadUrl(path, options) {
              attempts += 1;
              signedOptions.push({ path, options });
              if (attempts === 1) {
                return { data: null, error: Object.assign(new Error('tijdelijke 504'), { status: 504 }) };
              }
              return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
            },
            async remove() { return { data: [], error: null }; },
          }),
        },
      };
    },
    secret: 'test-only-mailbox-attachment-secret',
    randomUUID: () => 'isolated-timeout-retry',
    retryDelayMs: 1,
    sleep: async (delay) => { retryDelays.push(delay); },
    logger: { warn() {} },
  });

  const [upload] = await service.createUploadPlan({
    attachments: [{
      filename: 'bewijs.pdf', contentType: 'text/plain', size: 4,
      sha256: sha256(Buffer.alloc(4, 1)),
    }],
    binding: makeBinding(),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(retryDelays, [1]);
  assert.ok(clientPolicies.every((policy) => policy.timeoutMs === 8_000));
  assert.ok(clientPolicies.every((policy) => policy.ignoreFailureCooldown === true));
  assert.ok(clientPolicies.every((policy) => policy.suppressFailureCooldown === true));
  assert.ok(signedOptions.every((call) => call.options.upsert === true));
  assert.equal(upload.contentType, 'application/pdf', 'de extensie bepaalt het veilige MIME-type');
});

test('gedeeltelijk uploadplan ruimt alle eerder uitgegeven paden op en lekt geen providerfout', async () => {
  const issuedPaths = [];
  const removedPaths = [];
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          async createSignedUploadUrl(path) {
            issuedPaths.push(path);
            if (issuedPaths.length === 2) {
              return {
                data: null,
                error: Object.assign(new Error('providerdetail mag niet lekken'), { status: 400 }),
              };
            }
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
          async remove(paths) {
            removedPaths.push(...paths);
            return { data: [], error: null };
          },
        }),
      },
    }),
    secret: 'test-only-mailbox-attachment-secret',
    randomUUID: () => 'partial-plan',
    logger: { warn() {} },
  });

  await assert.rejects(
    service.createUploadPlan({
      attachments: [
        { filename: 'eerste.png', size: 4, sha256: sha256(Buffer.alloc(4, 1)) },
        { filename: 'tweede.png', size: 4, sha256: sha256(Buffer.alloc(4, 2)) },
      ],
      binding: makeBinding(),
    }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_STORAGE_FAILED'
      && error.status === 400
      && error.retryable === false
      && !error.message.includes('providerdetail')
  );

  assert.equal(issuedPaths.length, 2);
  assert.deepEqual(removedPaths, [issuedPaths[0]]);
  assert.equal(issuedPaths[0].split('/').slice(0, -1).join('/'), issuedPaths[1].split('/').slice(0, -1).join('/'));
});

test('zichtbare bestandsnamen blijven intact terwijl Storage exact dezelfde URL-veilige objectkey gebruikt', async () => {
  const objects = new Map();
  const signedPaths = [];
  const downloadedPaths = [];
  const removedPaths = [];
  const filenames = [
    'Offerte #1.pdf',
    'vraag?.pdf',
    '100%.pdf',
    'route%2Fnaam.pdf',
    'résumé € 100%.pdf',
  ];
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          async createSignedUploadUrl(path) {
            signedPaths.push(path);
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
          async download(path) {
            downloadedPaths.push(path);
            return { data: objects.get(path), error: null };
          },
          async remove(paths) {
            removedPaths.push(...paths);
            return { data: [], error: null };
          },
        }),
      },
    }),
    secret: 'test-only-mailbox-attachment-secret',
    randomUUID: () => 'special-filenames',
    now: () => new Date('2026-08-27T18:00:00.000Z'),
    logger: { warn() {} },
  });
  const binding = makeBinding();

  const contents = filenames.map((_filename, index) => Buffer.from([index + 1, 2, 3, 4]));
  const uploads = await service.createUploadPlan({
    attachments: filenames.map((filename, index) => ({
      filename, size: 4, sha256: sha256(contents[index]),
    })),
    binding,
  });
  assert.deepEqual(uploads.map((upload) => upload.filename), filenames);
  assert.equal(signedPaths.length, filenames.length);
  signedPaths.forEach((path, index) => {
    assert.match(path, new RegExp(`/\\d{1,2}-[a-f0-9]{24}\\.pdf$`));
    assert.doesNotMatch(path, /[#?%\s\u0080-\uFFFF]/);
    objects.set(path, contents[index]);
  });

  const resolved = await service.downloadAttachments(uploads, binding);
  assert.deepEqual(resolved.map((attachment) => attachment.filename), filenames);
  assert.deepEqual(downloadedPaths, signedPaths);

  await service.cleanupAttachments(uploads, binding);
  assert.deepEqual(removedPaths, signedPaths);
});

test('attachment storage stopt na twee tijdelijke fouten en retryt definitieve 4xx nooit', async (t) => {
  let transientAttempts = 0;
  const transientService = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          async createSignedUploadUrl() {
            transientAttempts += 1;
            return {
              data: null,
              error: Object.assign(new Error('raw provider timeout mag niet naar de browser'), { status: 503 }),
            };
          },
          async remove() { return { data: [], error: null }; },
        }),
      },
    }),
    secret: 'test-only-mailbox-attachment-secret',
    sleep: async () => {},
    logger: { warn() {} },
  });
  await assert.rejects(
    transientService.createUploadPlan({
      attachments: [{ filename: 'bewijs.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)) }],
      binding: makeBinding(),
    }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_ATTACHMENT_STORAGE_FAILED');
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /raw provider timeout/);
      return true;
    }
  );
  assert.equal(transientAttempts, 2);

  for (const status of [400, 401, 403, 404]) {
    await t.test(`HTTP ${status}`, async () => {
      let attempts = 0;
      const service = createMailboxAttachmentService({
        getSupabaseClient: () => ({
          storage: {
            from: () => ({
              async createSignedUploadUrl() {
                attempts += 1;
                return { data: null, error: Object.assign(new Error('definitieve storagefout'), { status }) };
              },
              async remove() { return { data: [], error: null }; },
            }),
          },
        }),
        secret: 'test-only-mailbox-attachment-secret',
        sleep: async () => {},
        logger: { warn() {} },
      });
      await assert.rejects(
        service.createUploadPlan({
          attachments: [{ filename: 'bewijs.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)) }],
          binding: makeBinding(),
        }),
        (error) => error.code === 'MAILBOX_ATTACHMENT_STORAGE_FAILED'
          && error.status === status
          && error.retryable === false
      );
      assert.equal(attempts, 1);
    });
  }

  for (const [label, storageError, expectedStatus] of [
    ['statusCode', Object.assign(new Error('definitieve statusCode-fout'), { statusCode: 400 }), 400],
    ['response.status', Object.assign(new Error('definitieve response-statusfout'), {
      response: { status: 403 },
    }), 403],
  ]) {
    await t.test(label, async () => {
      let attempts = 0;
      const service = createMailboxAttachmentService({
        getSupabaseClient: () => ({
          storage: {
            from: () => ({
              async createSignedUploadUrl() {
                attempts += 1;
                return { data: null, error: storageError };
              },
              async remove() { return { data: [], error: null }; },
            }),
          },
        }),
        secret: 'test-only-mailbox-attachment-secret',
        sleep: async () => {},
        logger: { warn() {} },
      });
      await assert.rejects(
        service.createUploadPlan({
          attachments: [{ filename: 'bewijs.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)) }],
          binding: makeBinding(),
        }),
        (error) => error.code === 'MAILBOX_ATTACHMENT_STORAGE_FAILED'
          && error.status === expectedStatus
          && error.retryable === false
      );
      assert.equal(attempts, 1);
    });
  }
});

test('service-deadline begrenst zowel een hangende Storage-call als een hangende downloadbody', async () => {
  let signedAttempts = 0;
  const immediateTimer = (callback) => {
    queueMicrotask(callback);
    return Symbol('test-timeout');
  };
  const stalledPlanService = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          createSignedUploadUrl() {
            signedAttempts += 1;
            return new Promise(() => {});
          },
          async remove() { return { data: [], error: null }; },
        }),
      },
    }),
    secret: 'test-only-mailbox-attachment-secret',
    setTimeoutFn: immediateTimer,
    clearTimeoutFn() {},
    sleep: async () => {},
    logger: { warn() {} },
  });
  await assert.rejects(
    stalledPlanService.createUploadPlan({
      attachments: [{ filename: 'hang.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)) }],
      binding: makeBinding(),
    }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_STORAGE_TIMEOUT'
      && error.status === 504
      && error.retryable === true
  );
  assert.equal(signedAttempts, 2);

  const fixture = createStorageFixture();
  const secret = 'test-only-mailbox-attachment-secret';
  const planService = createMailboxAttachmentService({
    getSupabaseClient: () => ({ storage: fixture.storage }),
    secret,
    randomUUID: () => 'body-stall',
    logger: { warn() {} },
  });
  const binding = makeBinding();
  const [upload] = await planService.createUploadPlan({
    attachments: [{ filename: 'body.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)) }],
    binding,
  });
  let downloadAttempts = 0;
  const stalledBodyService = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          async download() {
            downloadAttempts += 1;
            return { data: { arrayBuffer: () => new Promise(() => {}) }, error: null };
          },
          async remove() { return { data: [], error: null }; },
        }),
      },
    }),
    secret,
    setTimeoutFn: immediateTimer,
    clearTimeoutFn() {},
    sleep: async () => {},
    logger: { warn() {} },
  });
  await assert.rejects(
    stalledBodyService.downloadAttachments([upload], binding),
    (error) => error.code === 'MAILBOX_ATTACHMENT_STORAGE_FAILED'
      && error.status === 504
      && error.retryable === true
  );
  assert.equal(downloadAttempts, 2);
});
test('download, cleanup en verlopen references blijven begrensd, retrybaar en accountgebonden', async () => {
  const calls = { download: 0, remove: 0 };
  let currentTime = Date.parse('2026-08-18T15:00:00.000Z');
  let storedPath = '';
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          async createSignedUploadUrl(path) {
            storedPath = path;
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
          async download(path) {
            calls.download += 1;
            assert.equal(path, storedPath);
            if (calls.download === 1) {
              return { data: null, error: Object.assign(new Error('tijdelijke downloadfout'), { status: 502 }) };
            }
            return { data: Buffer.from([1, 2, 3, 4]), error: null };
          },
          async remove(paths) {
            calls.remove += 1;
            assert.deepEqual(paths, [storedPath]);
            if (calls.remove === 1) {
              return { data: null, error: Object.assign(new Error('tijdelijke cleanupfout'), { status: 503 }) };
            }
            return { data: [{ name: storedPath }], error: null };
          },
        }),
      },
    }),
    secret: 'test-only-mailbox-attachment-secret',
    now: () => new Date(currentTime),
    randomUUID: () => 'download-cleanup-retry',
    sleep: async () => {},
    logger: { warn() {} },
  });
  const binding = makeBinding();
  const [upload] = await service.createUploadPlan({
    attachments: [{
      filename: 'design..final.pdf', contentType: 'text/plain', size: 4,
      sha256: sha256(Buffer.from([1, 2, 3, 4])),
    }],
    binding,
  });
  assert.equal(upload.filename, 'design.final.pdf');
  const resolved = await service.downloadAttachments([upload], binding);
  assert.deepEqual([...resolved[0].content], [1, 2, 3, 4]);
  assert.equal(calls.download, 2);

  currentTime += 31 * 60 * 1000;
  await assert.rejects(
    service.downloadAttachments([upload], binding),
    (error) => error.code === 'MAILBOX_ATTACHMENT_REFERENCE_EXPIRED'
  );
  assert.equal(calls.download, 2, 'verlopen download faalt vóór Storage');
  await service.cleanupAttachments([upload], binding);
  assert.equal(calls.remove, 2, 'cleanup mag na expiry één tijdelijke fout herstellen');
});

test('alle Servé/Martijn-, provider-, ontvanger- en threadmismatches falen vóór Storage', async () => {
  const fixture = createStorageFixture();
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({ storage: fixture.storage }),
    secret: 'test-only-mailbox-attachment-secret',
    randomUUID: () => 'binding-matrix',
    logger: { warn() {} },
  });
  const binding = makeBinding({ providerAccountEmail: 'serve-provider@example.nl' });
  const [upload] = await service.createUploadPlan({
    attachments: [{
      filename: 'bewijs.pdf', size: 4, sha256: sha256(Buffer.alloc(4, 1)),
    }],
    binding,
  });
  fixture.objects.set(decodeReference(upload.reference).path, Buffer.alloc(4, 1));
  const mismatches = [
    { owner: 'martijn' },
    { accountEmail: 'martijn@softora.nl' },
    { providerAccountEmail: 'martijn-provider@example.nl' },
    { recipientEmail: 'ander@example.nl' },
    { provider: 'instantly' },
    { mode: 'new-message' },
    { conversationId: 'conversation:martijn|prospect' },
    { replyTargetMessageId: '<ander@example.nl>' },
    { providerThreadId: 'provider-thread-ander' },
    { idempotencyKey: 'send:ander' },
  ];
  for (const mismatch of mismatches) {
    await assert.rejects(
      service.downloadAttachments([upload], { ...binding, ...mismatch }),
      (error) => error.code === 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH'
    );
    await assert.rejects(
      service.cleanupAttachments([upload], { ...binding, ...mismatch }),
      (error) => error.code === 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH'
    );
  }
  assert.equal(fixture.calls.downloaded.length, 0);
  assert.equal(fixture.calls.removed.length, 0);
});

function createStorageHarness(initialBatches = {}) {
  const batches = new Map(Object.entries(initialBatches).map(([name, files]) => [name, [...files]]));
  const removedCalls = [];
  const listCalls = [];
  const store = {
    async list(prefix, options = {}) {
      listCalls.push({ prefix, options: { ...options } });
      const limit = Number(options.limit) || 100;
      const offset = Number(options.offset) || 0;
      if (prefix === MAILBOX_ATTACHMENT_STORAGE_PREFIX) {
        return {
          data: Array.from(batches.keys()).sort().slice(offset, offset + limit).map((name) => ({ name })),
          error: null,
        };
      }
      const batchName = String(prefix).slice(`${MAILBOX_ATTACHMENT_STORAGE_PREFIX}/`.length);
      return {
        data: (batches.get(batchName) || []).slice(offset, offset + limit).map((name) => ({ name })),
        error: null,
      };
    },
    async remove(paths) {
      removedCalls.push([...paths]);
      paths.forEach((path) => {
        const relative = String(path).slice(`${MAILBOX_ATTACHMENT_STORAGE_PREFIX}/`.length);
        const slash = relative.indexOf('/');
        if (slash < 0) return;
        const batchName = relative.slice(0, slash);
        const filename = relative.slice(slash + 1);
        const remaining = (batches.get(batchName) || []).filter((name) => name !== filename);
        if (remaining.length) batches.set(batchName, remaining);
        else batches.delete(batchName);
      });
      return { data: [], error: null };
    },
  };
  return {
    batches,
    listCalls,
    removedCalls,
    getSupabaseClient: () => ({ storage: { from: () => store } }),
  };
}

function batchName(expiresAt, suffix) {
  return `${expiresAt}-${suffix}`;
}

test('attachment sweeper pagineert begrensd en verwijdert alleen batches na reference-expiry plus twee uur grace', async () => {
  const nowMs = Date.parse('2026-08-27T18:00:00.000Z');
  const active = batchName(nowMs + 30_000, 'active');
  const stillInGrace = batchName(nowMs - MAILBOX_ATTACHMENT_SWEEP_GRACE_MS + 1, 'grace');
  const expired = batchName(nowMs - MAILBOX_ATTACHMENT_SWEEP_GRACE_MS, 'expired');
  const crashOrphan = batchName(nowMs - MAILBOX_ATTACHMENT_SWEEP_GRACE_MS - 60_000, 'orphan');
  const harness = createStorageHarness({
    [active]: ['0-active.png'],
    [stillInGrace]: ['0-grace.png'],
    [expired]: ['0-expired.png', '1-expired.png'],
    [crashOrphan]: ['0-orphan.png'],
    malformed: ['0-never-touch.png'],
  });
  const service = createMailboxAttachmentService({
    getSupabaseClient: harness.getSupabaseClient,
    secret: 'sweeper-secret',
    now: () => new Date(nowMs),
  });

  const first = await service.sweepExpiredAttachments({ rootPageSize: 2, maxRootPages: 4 });

  assert.deepEqual(first, { batches: 2, removed: 3, scannedPages: 3, timedOut: false });
  assert.equal(harness.batches.has(active), true);
  assert.equal(harness.batches.has(stillInGrace), true);
  assert.equal(harness.batches.has('malformed'), true);
  assert.equal(harness.batches.has(expired), false);
  assert.equal(harness.batches.has(crashOrphan), false);
  assert.ok(harness.listCalls.some((call) => call.prefix === MAILBOX_ATTACHMENT_STORAGE_PREFIX && call.options.offset === 2));

  const second = await service.sweepExpiredAttachments({ rootPageSize: 2, maxRootPages: 4 });
  assert.equal(second.removed, 0);
  assert.equal(second.batches, 0);
  assert.equal(harness.removedCalls.length, 2);
});

test('attachment sweeper respecteert batch- en padlimieten', async () => {
  const nowMs = Date.parse('2026-08-27T18:00:00.000Z');
  const old = nowMs - MAILBOX_ATTACHMENT_SWEEP_GRACE_MS - 1;
  const harness = createStorageHarness({
    [batchName(old - 3, 'a')]: ['0-a.png', '1-a.png'],
    [batchName(old - 2, 'b')]: ['0-b.png', '1-b.png'],
    [batchName(old - 1, 'c')]: ['0-c.png'],
  });
  const service = createMailboxAttachmentService({
    getSupabaseClient: harness.getSupabaseClient,
    secret: 'sweeper-secret',
    now: () => new Date(nowMs),
  });

  const result = await service.sweepExpiredAttachments({ maxBatches: 2, maxPaths: 3 });

  assert.equal(result.batches, 2);
  assert.equal(result.removed, 3);
  assert.equal(harness.removedCalls.flat().length, 3);
  assert.equal(harness.batches.size, 2);
});

test('attachment sweeper heeft een harde totaaldeadline bij een hangende Storage-call', async () => {
  let listCalls = 0;
  const service = createMailboxAttachmentService({
    getSupabaseClient: () => ({
      storage: {
        from: () => ({
          list() {
            listCalls += 1;
            return new Promise(() => {});
          },
        }),
      },
    }),
    secret: 'sweeper-secret',
  });
  const startedAt = Date.now();

  const result = await service.sweepExpiredAttachments({ totalTimeoutMs: 15 });

  assert.equal(result.timedOut, true);
  assert.equal(result.removed, 0);
  assert.equal(listCalls, 0, 'start nooit een Storage-call die niet binnen het resterende budget past');
  assert.ok(Date.now() - startedAt < 250);
});

test('compose runtime gebruikt voor cleanup uitsluitend de lokale bindingresolver en exposeert de begrensde sweeper', async () => {
  const calls = { resolve: 0, cleanupBinding: 0, cleanup: 0, sweep: 0 };
  const expectedBinding = makeBinding({ idempotencyKey: 'send:runtime-cleanup' });
  const runtime = createMailboxComposeRuntime({
    composeSendDependencies: {},
    mailboxComposeThreadContext: {
      async resolve() {
        calls.resolve += 1;
        throw new Error('cleanup mag de mailboxindex nooit lezen');
      },
      resolveAttachmentCleanupBinding(input) {
        calls.cleanupBinding += 1;
        assert.equal(input.body.idempotencyKey, expectedBinding.idempotencyKey);
        return expectedBinding;
      },
    },
    mailboxAttachmentService: {
      async cleanupAttachments(attachments, binding) {
        calls.cleanup += 1;
        assert.deepEqual(attachments, [{ reference: 'signed-cleanup-reference' }]);
        assert.deepEqual(binding, expectedBinding);
        return { removed: 1 };
      },
      async sweepExpiredAttachments(options) {
        calls.sweep += 1;
        assert.deepEqual(options, { totalTimeoutMs: 3210 });
        return { batches: 1, removed: 2, timedOut: false };
      },
    },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    logger: { warn() {}, error() {} },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await runtime.attachmentCleanupResponse({
    body: {
      account: expectedBinding.accountEmail,
      to: expectedBinding.recipientEmail,
      owner: expectedBinding.owner,
      mode: expectedBinding.mode,
      idempotencyKey: expectedBinding.idempotencyKey,
      attachments: [{ reference: 'signed-cleanup-reference' }],
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, removed: 1 });
  assert.deepEqual(await runtime.sweepExpiredAttachments({ totalTimeoutMs: 3210 }), {
    batches: 1, removed: 2, timedOut: false,
  });
  assert.deepEqual(calls, { resolve: 0, cleanupBinding: 1, cleanup: 1, sweep: 1 });
});

test('compose cleanup faalt gesloten zonder lokale bindingresolver en gebruikt nooit prepareMessage als fallback', async () => {
  let resolveCalls = 0;
  let cleanupCalls = 0;
  const runtime = createMailboxComposeRuntime({
    composeSendDependencies: {},
    mailboxComposeThreadContext: {
      async resolve() { resolveCalls += 1; return makeBinding(); },
    },
    mailboxAttachmentService: {
      async cleanupAttachments() { cleanupCalls += 1; return { removed: 1 }; },
    },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    logger: { warn() {}, error() {} },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await runtime.attachmentCleanupResponse({ body: {
    account: 'serve@softora.nl', to: 'prospect@example.nl', mode: 'new-message',
    idempotencyKey: 'send:no-cleanup-binding', attachments: [{ reference: 'never-touch' }],
  } }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'MAILBOX_ATTACHMENT_CLEANUP_BINDING_UNAVAILABLE');
  assert.equal(resolveCalls, 0);
  assert.equal(cleanupCalls, 0);
});
