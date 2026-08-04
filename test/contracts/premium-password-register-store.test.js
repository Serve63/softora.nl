const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');

const TEST_WRITE_PROOF = 'test-write-proof-v1';

function loadStore(initialValues = {}, options = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-password-register-store.js'),
    'utf8'
  );
  const posts = [];
  const requests = [];
  const requestOptions = [];
  let values = { ...initialValues };
  let revision = Object.prototype.hasOwnProperty.call(options, 'initialRevision')
    ? Number(options.initialRevision)
    : (Object.keys(values).length ? 1 : 0);
  let updatedAt = Object.prototype.hasOwnProperty.call(options, 'initialUpdatedAt')
    ? options.initialUpdatedAt
    : (revision ? '2026-08-04T12:00:01.000Z' : null);
  let gets = 0;

  function response(status, data) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    };
  }

  function commit(patch = {}) {
    values = { ...values, ...patch };
    revision += 1;
    updatedAt = `2026-08-04T12:00:${String(revision).padStart(2, '0')}.000Z`;
  }

  const window = {
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  const context = {
    window,
    AbortController,
    Buffer,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    fetch: async (url, fetchOptions = {}) => {
      const method = String(fetchOptions.method || 'GET').toUpperCase();
      requests.push({ url: String(url), method });
      requestOptions.push({
        url: String(url),
        method,
        credentials: fetchOptions.credentials,
        headers: { ...(fetchOptions.headers || {}) },
        body: String(fetchOptions.body || ''),
      });
      if (String(url).startsWith('/api/ui-state-read?')) {
        gets += 1;
        const readBody = JSON.parse(String(fetchOptions.body || '{}'));
        if (readBody.writeProof !== TEST_WRITE_PROOF) {
          return response(403, {
            ok: false,
            code: 'PASSWORD_REGISTER_WRITE_PROOF_INVALID',
            error: 'Beveiligingsbevestiging ongeldig.',
          });
        }
        const data = {
          ok: options.getOk !== false,
          scope: options.getScope || 'premium_password_register',
          source: options.getSource || 'supabase',
          values: { ...values },
          revision,
          updatedAt,
        };
        if (options.omitRevision) delete data.revision;
        return response(200, data);
      }
      if (method === 'POST') {
        const body = JSON.parse(String(fetchOptions.body || '{}'));
        posts.push(body);
        const postIndex = posts.length;
        if (typeof options.waitForPost === 'function') {
          await options.waitForPost(body, postIndex);
        }
        if (body.writeProof !== TEST_WRITE_PROOF) {
          return response(403, {
            ok: false,
            code: 'PASSWORD_REGISTER_WRITE_PROOF_INVALID',
            error: 'Beveiligingsbevestiging ongeldig.',
          });
        }
        if (body.expectedRevision !== revision || body.expectedUpdatedAt !== updatedAt) {
          return response(409, {
            ok: false,
            code: 'PASSWORD_REGISTER_REVISION_CONFLICT',
            error: 'De kluis is intussen gewijzigd.',
            revision,
            updatedAt,
          });
        }
        commit(body.patch || {});
        if (typeof options.throwAfterCommit === 'function' && options.throwAfterCommit(body, postIndex)) {
          throw new Error('Netwerkantwoord verloren na mogelijke commit.');
        }
        const responseData = {
          ok: true,
          scope: options.postScope || 'premium_password_register',
          source: options.postSource || 'supabase',
          revision: revision + Number(options.postRevisionDelta || 0),
          updatedAt,
        };
        if (options.omitPostUpdatedAt) delete responseData.updatedAt;
        return response(200, responseData);
      }

      throw new Error(`Onverwacht testverzoek: ${method} ${url}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    create: context.window.SoftoraPasswordRegisterStore.create,
    advanceRemote: commit,
    getCount: () => gets,
    posts: () => posts.slice(),
    requests: () => requests.slice(),
    requestOptions: () => requestOptions.map((entry) => ({
      ...entry,
      headers: { ...entry.headers },
    })),
    revision: () => revision,
    updatedAt: () => updatedAt,
    values: () => ({ ...values }),
  };
}

async function createLegacyV1Envelope(masterSecret, entries) {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const secretBytes = new TextEncoder().encode(masterSecret);
  const baseKey = await webcrypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
  secretBytes.fill(0);
  const key = await webcrypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: 210000,
  }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const ciphertext = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  plaintext.fill(0);
  return JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 210000,
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  });
}

async function decryptEnvelopeIndependently(serializedEnvelope, masterSecret) {
  const envelope = JSON.parse(serializedEnvelope);
  const secretBytes = new TextEncoder().encode(masterSecret);
  const baseKey = await webcrypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
  secretBytes.fill(0);
  const key = await webcrypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: Buffer.from(envelope.salt, 'base64'),
    iterations: envelope.iterations,
  }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plaintext = new Uint8Array(await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64') },
    key,
    Buffer.from(envelope.ciphertext, 'base64')
  ));
  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } finally {
    plaintext.fill(0);
  }
}

test('password-register store leest uitsluitend authoritative Supabase state', async () => {
  for (const options of [
    { getSource: 'bootstrap' },
    { getSource: 'fallback' },
    { getOk: false },
    { getScope: 'other_scope' },
    { omitRevision: true },
  ]) {
    const harness = loadStore({}, options);
    const store = harness.create();
    await assert.rejects(
      () => store.unlock('authoritative unieke master wachtzin 2026', TEST_WRITE_PROOF),
      /niet gezaghebbend door Supabase bevestigd/
    );
    assert.deepEqual(harness.requests(), [{
      url: '/api/ui-state-read?scope=premium_password_register',
      method: 'POST',
    }]);
    assert.equal(harness.posts().length, 0);
  }
});

test('password-register store weigert ontbrekende write-proof vóór iedere kluisread/write', async () => {
  const harness = loadStore();
  const store = harness.create();
  await assert.rejects(
    () => store.unlock('proof verplichte unieke master wachtzin 2026', ''),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_WRITE_PROOF_REQUIRED');
      return true;
    }
  );
  assert.equal(harness.requests().length, 0);

  const unlockedEntries = await store.unlock(
    'proof verplichte unieke master wachtzin 2026',
    TEST_WRITE_PROOF
  );
  await assert.rejects(
    () => store.persist(unlockedEntries, 'missing-proof-write', ''),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_WRITE_PROOF_REQUIRED');
      assert.equal(error.forceLock, true);
      return true;
    }
  );
  assert.equal(harness.posts().length, 0, 'zonder proof mag geen remote write starten');
});

test('password-register store weigert gemengde envelopeversies en KDF-sterktes', async () => {
  const secret = 'formaatcontrole unieke master wachtzin';
  const legacy = JSON.parse(await createLegacyV1Envelope(secret, [{ id: 1, pw: 'geheim' }]));
  for (const invalidEnvelope of [
    { ...legacy, version: 2, iterations: 210000 },
    { ...legacy, version: 1, iterations: 600000 },
  ]) {
    const harness = loadStore({ entries_encrypted_v1: JSON.stringify(invalidEnvelope) });
    const store = harness.create();
    await assert.rejects(
      () => store.unlock(secret, TEST_WRITE_PROOF),
      /Master-wachtzin klopt niet of de versleutelde kluis is beschadigd/
    );
    assert.equal(harness.posts().length, 0);
    assert.equal(store.getSecurityState().envelopeVersion, null);
  }
});

test('password-register store schrijft alleen AES-GCM v2 met CAS en bewaart whitespace exact', async () => {
  const harness = loadStore();
  const store = harness.create();
  const masterSecret = 'exacte unieke master wachtzin 2026';
  const exactPassword = '  exact geheim\nmet tab\t  ';
  await store.unlock(masterSecret, TEST_WRITE_PROOF);
  await store.persist([{
    id: 1,
    naam: 'Exact',
    url: 'exact.example',
    user: 'exact@example.test',
    pw: exactPassword,
    cat: 'Test',
  }], 'exact-save', TEST_WRITE_PROOF);

  const body = harness.posts()[0];
  const readRequest = harness.requestOptions()
    .find((request) => request.url.startsWith('/api/ui-state-read?'));
  const setRequest = harness.requestOptions()
    .find((request) => request.url.startsWith('/api/ui-state-set?'));
  assert.equal(readRequest.method, 'POST');
  assert.equal(readRequest.credentials, 'same-origin');
  assert.equal(readRequest.headers['X-Softora-Requested-With'], 'premium');
  assert.equal(Object.hasOwn(readRequest.headers, 'X-Softora-Password-Register-Proof'), false);
  assert.deepEqual(JSON.parse(readRequest.body), { writeProof: TEST_WRITE_PROOF });
  assert.doesNotMatch(readRequest.url, /test-write-proof|proof=/i);
  assert.equal(setRequest.credentials, 'same-origin');
  assert.equal(setRequest.method, 'POST');
  assert.equal(setRequest.headers['X-Softora-Requested-With'], 'premium');
  assert.equal(Object.hasOwn(setRequest.headers, 'X-Softora-Password-Register-Proof'), false);
  assert.doesNotMatch(setRequest.url, /test-write-proof|proof=/i);
  for (const request of [readRequest, setRequest]) {
    const serializedHeaders = JSON.stringify(request.headers);
    assert.doesNotMatch(serializedHeaders, /test-write-proof-v1/i);
  }
  assert.equal(body.expectedRevision, 0);
  assert.equal(body.expectedUpdatedAt, null);
  assert.equal(body.writeProof, TEST_WRITE_PROOF);
  assert.equal(Object.hasOwn(body, 'actionConfirmCode'), false);
  assert.equal(Object.hasOwn(body, 'actionConfirmScope'), false);
  assert.equal(Object.hasOwn(body.patch, 'writeProof'), false);
  assert.equal(body.patch.entries_json, '');
  assert.doesNotMatch(body.patch.entries_encrypted_v1, /exact geheim|exact@example\.test/);
  const envelope = JSON.parse(body.patch.entries_encrypted_v1);
  assert.equal(envelope.version, 2);
  assert.equal(envelope.algorithm, 'AES-GCM');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.iterations, 600000);
  assert.doesNotMatch(JSON.stringify(envelope), /test-write-proof/);
  const independentlyDecrypted = await decryptEnvelopeIndependently(
    body.patch.entries_encrypted_v1,
    masterSecret
  );
  assert.equal(independentlyDecrypted[0].pw, exactPassword);

  store.lock();
  const reopened = await store.unlock(masterSecret, TEST_WRITE_PROOF);
  assert.equal(reopened[0].pw, exactPassword);
});

test('password-register store migreert v1 vóór unlock-resultaat met exact één v2 CAS-write', async () => {
  const secret = 'oude korte zin';
  const legacyEnvelope = await createLegacyV1Envelope(secret, [{
    id: 1,
    naam: 'Legacy',
    url: 'legacy.example',
    user: 'legacy@example.test',
    pw: 'legacy testgeheim',
    cat: 'Test',
  }]);
  const harness = loadStore({ entries_encrypted_v1: legacyEnvelope });
  const store = harness.create();

  const entries = await store.unlock(secret, TEST_WRITE_PROOF);
  assert.equal(entries[0].pw, 'legacy testgeheim');
  assert.equal(harness.posts().length, 1);
  const body = harness.posts()[0];
  assert.equal(body.expectedRevision, 1);
  assert.equal(body.expectedUpdatedAt, '2026-08-04T12:00:01.000Z');
  assert.equal(body.writeProof, TEST_WRITE_PROOF);
  const migrated = JSON.parse(body.patch.entries_encrypted_v1);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.iterations, 600000);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getSecurityState())), {
    envelopeVersion: 2,
    kdfIterations: 600000,
    masterSecretMeetsPolicy: false,
    migrationPending: false,
  });
});

test('password-register store geeft v1-entries pas vrij nadat de migratie-CAS is bevestigd', async () => {
  const secret = 'migratie wacht op CAS bevestiging';
  const legacyEnvelope = await createLegacyV1Envelope(secret, [{
    id: 1,
    naam: 'Wachtende migratie',
    url: 'migration.example',
    user: 'migration@example.test',
    pw: 'tijdelijk ontsleuteld geheim',
    cat: 'Test',
  }]);
  let releaseMigration;
  let markMigrationStarted;
  const migrationStarted = new Promise((resolve) => { markMigrationStarted = resolve; });
  const harness = loadStore({ entries_encrypted_v1: legacyEnvelope }, {
    waitForPost: async () => {
      markMigrationStarted();
      await new Promise((resolve) => { releaseMigration = resolve; });
    },
  });
  const store = harness.create();
  let settled = false;
  const unlockPromise = store.unlock(secret, TEST_WRITE_PROOF);
  unlockPromise.then(
    () => { settled = true; },
    () => { settled = true; }
  );

  await migrationStarted;
  await Promise.resolve();
  assert.equal(settled, false, 'entries mogen niet vóór de authoritative CAS-response worden vrijgegeven');
  assert.equal(harness.posts().length, 1);
  releaseMigration();
  const entries = await unlockPromise;
  assert.equal(entries[0].pw, 'tijdelijk ontsleuteld geheim');
  assert.equal(settled, true);
});

test('password-register store faalt v1-migratie gesloten bij een CAS-conflict', async () => {
  const secret = 'migratie conflict unieke wachtzin';
  const legacyEnvelope = await createLegacyV1Envelope(secret, [{
    id: 1,
    naam: 'Conflict',
    pw: 'niet vrijgeven',
    cat: 'Test',
  }]);
  let harness;
  harness = loadStore({ entries_encrypted_v1: legacyEnvelope }, {
    waitForPost: async (_body, postIndex) => {
      if (postIndex === 1) harness.advanceRemote({ updated_by: 'andere-sessie' });
    },
  });
  const store = harness.create();

  await assert.rejects(
    () => store.unlock(secret, TEST_WRITE_PROOF),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_REVISION_CONFLICT');
      assert.equal(error.forceLock, true);
      return true;
    }
  );
  assert.equal(store.getSecurityState().envelopeVersion, null);
  assert.equal(store.getRevisionState().revision, null);
});

test('password-register store serialiseert writes en gebruikt de bevestigde CAS-basis', async () => {
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const harness = loadStore({}, {
    waitForPost: async (_body, postIndex) => {
      if (postIndex !== 1) return;
      markFirstStarted();
      await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });
  const store = harness.create();
  await store.unlock('serialisatie unieke master wachtzin 2026', TEST_WRITE_PROOF);
  const first = store.persist(
    [{ id: 1, naam: 'A', pw: 'A', cat: 'Test' }],
    'first',
    TEST_WRITE_PROOF
  );
  await firstStarted;
  const second = store.persist(
    [{ id: 1, naam: 'B', pw: 'B', cat: 'Test' }],
    'second',
    TEST_WRITE_PROOF
  );
  await Promise.resolve();
  assert.equal(harness.posts().length, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(
    harness.posts().map((body) => [body.expectedRevision, body.expectedUpdatedAt]),
    [[0, null], [1, '2026-08-04T12:00:01.000Z']]
  );
  assert.equal(store.getRevisionState().revision, 2);
});

test('password-register store stopt de write-queue na een ambigue eerste commit', async () => {
  const harness = loadStore({}, {
    throwAfterCommit: (_body, postIndex) => postIndex === 1,
  });
  const store = harness.create();
  await store.unlock('ambigue queue unieke master wachtzin 2026', TEST_WRITE_PROOF);
  const first = store.persist(
    [{ id: 1, naam: 'Eerste', pw: 'eerste', cat: 'Test' }],
    'first-ambiguous',
    TEST_WRITE_PROOF
  );
  const second = store.persist(
    [{ id: 1, naam: 'Tweede', pw: 'tweede', cat: 'Test' }],
    'must-not-run',
    TEST_WRITE_PROOF
  );

  await assert.rejects(first, (error) => {
    assert.equal(error.forceLock, true);
    assert.equal(error.requiresFreshRead, true);
    return true;
  });
  await assert.rejects(second, (error) => {
    assert.equal(error.code, 'PASSWORD_REGISTER_LOCKED');
    return true;
  });
  assert.equal(harness.posts().length, 1, 'de tweede write mag na onzekerheid niet remote starten');
  assert.equal(store.getSecurityState().envelopeVersion, null);
});

test('password-register store vergrendelt en wist state bij stale CAS', async () => {
  const harness = loadStore();
  const store = harness.create();
  const entries = await store.unlock('stale unieke master wachtzin 2026', TEST_WRITE_PROOF);
  harness.advanceRemote({ updated_by: 'other-session' });

  await assert.rejects(
    () => store.persist(entries, 'stale', TEST_WRITE_PROOF),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_REVISION_CONFLICT');
      assert.equal(error.forceLock, true);
      assert.equal(error.requiresFreshRead, true);
      return true;
    }
  );
  assert.equal(store.getRevisionState().revision, null);
  assert.equal(store.getSecurityState().envelopeVersion, null);
});

test('password-register store vertrouwt alleen een exacte authoritative SET-bevestiging', async () => {
  for (const options of [
    { postSource: 'memory' },
    { postScope: 'other_scope' },
    { postRevisionDelta: 1 },
    { omitPostUpdatedAt: true },
  ]) {
    const harness = loadStore({}, options);
    const store = harness.create();
    const secret = 'set bevestiging unieke master wachtzin 2026';
    const entries = await store.unlock(secret, TEST_WRITE_PROOF);
    await assert.rejects(
      () => store.persist(entries, 'invalid-ack', TEST_WRITE_PROOF),
      (error) => {
        assert.equal(error.forceLock, true);
        assert.equal(error.requiresFreshRead, true);
        return true;
      }
    );
    assert.equal(store.getRevisionState().revision, null);
    assert.equal(store.getSecurityState().envelopeVersion, null);
    assert.equal(harness.posts().length, 1);
    assert.equal((await store.unlock(secret, TEST_WRITE_PROOF)).length, entries.length);
    assert.equal(harness.getCount(), 2, 'herstel mag alleen via een verse authoritative read');
  }
});

test('password-register store herstelt een late remote commit alleen via een verse authoritative read', async () => {
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });
  const harness = loadStore({}, {
    waitForPost: async () => {
      markPostStarted();
      await new Promise((resolve) => { releasePost = resolve; });
    },
  });
  const store = harness.create();
  const secret = 'late commit unieke master wachtzin 2026';
  const entries = await store.unlock(secret, TEST_WRITE_PROOF);
  const save = store.persist(entries, 'late', TEST_WRITE_PROOF);
  await postStarted;
  store.lock();
  releasePost();
  const result = await save;
  assert.equal(result.stale, true);
  assert.equal(store.getSecurityState().envelopeVersion, null);
  assert.equal((await store.unlock(secret, TEST_WRITE_PROOF)).length, entries.length);
  assert.equal(harness.getCount(), 2);
});

test('password-register store vergrendelt na ambigue rekey en accepteert alleen remote nieuwe key', async () => {
  const oldSecret = 'oude unieke master wachtzin 2026';
  const newSecret = 'nieuwe unieke master wachtzin 2026';
  const harness = loadStore({}, {
    throwAfterCommit: (_body, postIndex) => postIndex === 2,
  });
  const store = harness.create();
  const entries = await store.unlock(oldSecret, TEST_WRITE_PROOF);
  await store.persist(entries, 'initial', TEST_WRITE_PROOF);

  await assert.rejects(
    () => store.changeMasterSecret(oldSecret, newSecret, entries, 'rekey', TEST_WRITE_PROOF),
    (error) => {
      assert.equal(error.forceLock, true);
      assert.equal(error.requiresFreshRead, true);
      return true;
    }
  );
  assert.equal(store.getSecurityState().envelopeVersion, null);
  assert.equal((await store.unlock(newSecret, TEST_WRITE_PROOF)).length, entries.length);
  await assert.rejects(
    () => store.unlock(oldSecret, TEST_WRITE_PROOF),
    /Master-wachtzin klopt niet/
  );
  assert.equal(harness.getCount(), 3);
});

test('password-register store markeert een late rekey-commit na lock expliciet onzeker', async () => {
  const oldSecret = 'oude late rekey master wachtzin 2026';
  const newSecret = 'nieuwe late rekey master wachtzin 2026';
  let releaseRekey;
  let markRekeyStarted;
  const rekeyStarted = new Promise((resolve) => { markRekeyStarted = resolve; });
  const harness = loadStore({}, {
    waitForPost: async (_body, postIndex) => {
      if (postIndex !== 2) return;
      markRekeyStarted();
      await new Promise((resolve) => { releaseRekey = resolve; });
    },
  });
  const store = harness.create();
  const entries = await store.unlock(oldSecret, TEST_WRITE_PROOF);
  await store.persist(entries, 'initial', TEST_WRITE_PROOF);
  const rekey = store.changeMasterSecret(
    oldSecret,
    newSecret,
    entries,
    'late-rekey',
    TEST_WRITE_PROOF
  );
  await rekeyStarted;
  store.lock();
  releaseRekey();

  await assert.rejects(rekey, (error) => {
    assert.equal(error.code, 'PASSWORD_REGISTER_REKEY_UNCERTAIN');
    assert.equal(error.forceLock, true);
    assert.equal(error.requiresFreshRead, true);
    return true;
  });
  assert.equal(store.getRevisionState().revision, null);
  assert.equal((await store.unlock(newSecret, TEST_WRITE_PROOF)).length, entries.length);
  await assert.rejects(
    () => store.unlock(oldSecret, TEST_WRITE_PROOF),
    /Master-wachtzin klopt niet/
  );
});
