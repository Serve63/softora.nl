const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const state = require('../../assets/premium-mailbox-compose-send-state');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

function markerInput(overrides = {}) {
  return {
    version: state.MARKER_VERSION,
    idempotencyKey: 'browser:test',
    payloadFingerprint: 'a'.repeat(64),
    localScopeFingerprint: 'b'.repeat(64),
    state: 'armed',
    createdAt: 1,
    updatedAt: 1,
    staging: [],
    attachmentsMetadata: [],
    durableIdentity: null,
    reconcileProof: null,
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    account: 'serve@softora.nl',
    owner: 'serve',
    provider: 'smtp',
    mode: 'reply',
    providerMessageId: '<incoming@example.nl>',
    providerThreadId: 'thread-1',
    context: {
      conversationId: 'conversation-1', id: 'inbox:1', folder: 'inbox', uid: 1,
      messageId: '<incoming@example.nl>', references: '<root@example.nl>',
    },
    to: 'prospect@example.nl', cc: '', bcc: '', subject: 'Re: Website', body: 'Bijlage.',
    ...overrides,
  };
}

test('send-state publiceert alleen de afgeschermde state- en cryptohelpers', () => {
  assert.equal(state.STORAGE_PREFIX, 'softora.mailbox.send-resilience.v1:');
  assert.equal(state.LOCK_NAME, 'softora-mailbox-send-resilience:v1');
  assert.equal(typeof state.compareAndSwapMarker, 'function');
  assert.equal(typeof state.createPayloadFingerprint, 'function');
  assert.equal(typeof state.bindAttachmentSelection, 'function');
  assert.equal(Object.isFrozen(state), true);
});

test('marker-CAS bewaart readback en weigert stale of parallelle tokens', () => {
  const storage = new MemoryStorage();
  const created = state.compareAndSwapMarker(storage, markerInput(), null, {
    now: () => 10,
    randomUUID: () => 'cas-1',
  });
  assert.equal(created.casToken, 'cas-1');
  assert.equal(state.readMarker(storage, created.idempotencyKey).casToken, 'cas-1');

  const changed = state.patchMarker(storage, created, { state: 'staged' }, {
    now: () => 20,
    randomUUID: () => 'cas-2',
  });
  assert.equal(changed.state, 'staged');
  assert.equal(changed.casToken, 'cas-2');
  assert.throws(
    () => state.patchMarker(storage, created, { state: 'failed' }, {
      now: () => 30,
      randomUUID: () => 'cas-stale',
    }),
    (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_CONFLICT'
  );
});

test('beschadigde, non-canonieke of gemengde markers falen vóór selectie zonder tweede marker', () => {
  const base = markerInput({ casToken: 'cas-token' });
  for (const changed of [
    { ...base, payloadFingerprint: 'A'.repeat(64) },
    { ...base, localScopeFingerprint: 'B'.repeat(64) },
    { ...base, state: ' armed ' },
    { ...base, createdAt: '1' },
    { ...base, updatedAt: null },
    { ...base, attachmentsMetadata: {} },
    { ...base, reconcileProof: [] },
    {
      ...base,
      attachmentsMetadata: [
        { filename: 'a.pdf', contentType: 'application/pdf', size: 1, sha256: 'a'.repeat(64) },
        { filename: 'b.pdf', contentType: 'application/pdf', size: 1 },
      ],
    },
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(state.markerStorageKey(base.idempotencyKey), JSON.stringify(changed));
    assert.throws(
      () => state.selectMarker(
        storage,
        '',
        'c'.repeat(64),
        base.localScopeFingerprint,
        [],
        { now: () => 2, randomUUID: () => 'mag-niet-worden-gebruikt' }
      ),
      (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_CORRUPT'
    );
    assert.equal(storage.length, 1);
  }
});

test('canonieke marker wordt met genormaliseerde metadata teruggelezen', () => {
  const parsed = state.parseMarker(JSON.stringify(markerInput({
    casToken: 'cas-token',
    attachmentsMetadata: [{
      filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'c'.repeat(64),
    }],
  })));
  assert.equal(parsed.idempotencyKey, 'browser:test');
  assert.equal(parsed.state, 'armed');
  assert.deepEqual(parsed.attachmentsMetadata, [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'c'.repeat(64),
  }]);
});

test('payloadfingerprint bindt exacte SHA-256 bijlagebytes en lokale scope niet', async () => {
  const metadataA = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }];
  const metadataB = [{ ...metadataA[0], sha256: 'b'.repeat(64) }];
  const fingerprintA = await state.createPayloadFingerprint(payload(), metadataA, { crypto: webcrypto });
  const fingerprintB = await state.createPayloadFingerprint(payload(), metadataB, { crypto: webcrypto });
  const scopeA = await state.createLocalScopeFingerprint(payload(), { crypto: webcrypto });
  const scopeB = await state.createLocalScopeFingerprint(payload({ body: 'Andere tekst.' }), { crypto: webcrypto });
  assert.match(fingerprintA, /^[0-9a-f]{64}$/);
  assert.notEqual(fingerprintA, fingerprintB);
  assert.equal(scopeA, scopeB);
});

test('selectMarker weigert een onopgeloste context met andere inhoud of bijlagen', () => {
  const storage = new MemoryStorage();
  state.compareAndSwapMarker(storage, markerInput(), null, {
    now: () => 10,
    randomUUID: () => 'cas-existing',
  });
  assert.throws(
    () => state.selectMarker(
      storage,
      '',
      'c'.repeat(64),
      'b'.repeat(64),
      [],
      { now: () => 20, randomUUID: () => 'new-key' }
    ),
    (error) => error.code === 'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT'
  );
});

test('selectMarker vervangt op verzoek alleen een aantoonbaar pre-dispatch scopeconflict', () => {
  const storage = new MemoryStorage();
  const existing = state.compareAndSwapMarker(storage, markerInput({
    state: 'staged',
    staging: [{ reference: 'oude-tijdelijke-referentie' }],
    reconcileProof: { version: 1 },
  }), null, {
    now: () => 10,
    randomUUID: () => 'cas-existing',
  });
  const tokens = ['cas-retired', 'cas-successor'];

  const selected = state.selectMarker(
    storage,
    'browser:fresh-click',
    'c'.repeat(64),
    existing.localScopeFingerprint,
    [],
    {
      now: () => 20,
      randomUUID: () => tokens.shift(),
      replaceProvenPreDispatch: true,
    }
  );

  assert.equal(selected.idempotencyKey, 'browser:fresh-click');
  assert.equal(selected.state, 'armed');
  const retired = state.readMarker(storage, existing.idempotencyKey);
  assert.equal(retired.state, 'failed');
  assert.deepEqual(retired.staging, []);
  assert.equal(retired.reconcileProof, null);
});

test('selectMarker roteert een expliciete pre-dispatch key met gewijzigde inhoud naar een verse key', () => {
  const storage = new MemoryStorage();
  const existing = state.compareAndSwapMarker(storage, markerInput(), null, {
    now: () => 10,
    randomUUID: () => 'cas-existing',
  });
  const tokens = ['cas-retired', 'fresh-key', 'cas-successor'];

  const selected = state.selectMarker(
    storage,
    existing.idempotencyKey,
    'c'.repeat(64),
    existing.localScopeFingerprint,
    [],
    {
      now: () => 20,
      randomUUID: () => tokens.shift(),
      replaceProvenPreDispatch: true,
    }
  );

  assert.equal(selected.idempotencyKey, 'browser:fresh-key');
  assert.equal(state.readMarker(storage, existing.idempotencyKey).state, 'failed');
});

test('selectMarker vervangt nooit dispatching processing of een marker met sendStartedAt', () => {
  for (const [label, marker] of [
    ['dispatching', markerInput({ state: 'dispatching', sendStartedAt: 9 })],
    ['processing', markerInput({ state: 'processing', sendStartedAt: 9 })],
    ['armed met send-start', markerInput({ state: 'armed', sendStartedAt: 9 })],
    ['armed met duurzame identiteit', markerInput({
      state: 'armed',
      durableIdentity: { intentId: 'send:uncertain', messageId: '<uncertain@softora.nl>' },
    })],
  ]) {
    const storage = new MemoryStorage();
    const existing = state.compareAndSwapMarker(storage, marker, null, {
      now: () => 10,
      randomUUID: () => `cas-${label}`,
    });
    assert.throws(
      () => state.selectMarker(
        storage,
        'browser:fresh-click',
        'c'.repeat(64),
        existing.localScopeFingerprint,
        [],
        {
          now: () => 20,
          randomUUID: () => 'mag-niet-worden-gebruikt',
          replaceProvenPreDispatch: true,
        }
      ),
      (error) => error.code === 'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT',
      label
    );
    assert.equal(state.readMarker(storage, existing.idempotencyKey).state, marker.state, label);
  }
});

test('veilige exacte mismatch blijft ongemuteerd zolang een tweede poging onzeker is', () => {
  const storage = new MemoryStorage();
  const safe = state.compareAndSwapMarker(storage, markerInput({
    idempotencyKey: 'browser:exact-old-content',
    payloadFingerprint: 'a'.repeat(64),
    state: 'armed',
  }), null, {
    now: () => 10,
    randomUUID: () => 'cas-safe',
  });
  const unsafe = state.compareAndSwapMarker(storage, markerInput({
    idempotencyKey: 'browser:uncertain-other-content',
    payloadFingerprint: 'd'.repeat(64),
    state: 'dispatching',
    sendStartedAt: 9,
  }), null, {
    now: () => 10,
    randomUUID: () => 'cas-unsafe',
  });

  const selectCurrent = (randomUUID) => state.selectMarker(
    storage,
    safe.idempotencyKey,
    'c'.repeat(64),
    safe.localScopeFingerprint,
    [],
    {
      now: () => 20,
      randomUUID,
      replaceProvenPreDispatch: true,
    }
  );
  assert.throws(
    () => selectCurrent(() => 'mag-niet-worden-gebruikt'),
    (error) => error.code === 'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT'
  );
  assert.equal(state.readMarker(storage, safe.idempotencyKey).state, 'armed');
  assert.equal(state.readMarker(storage, unsafe.idempotencyKey).state, 'dispatching');

  state.patchMarker(storage, unsafe, { state: 'accepted' }, {
    now: () => 15,
    randomUUID: () => 'cas-resolved',
  });
  const tokens = ['cas-retired', 'fresh-after-resolve', 'cas-successor'];
  const selected = selectCurrent(() => tokens.shift());
  assert.equal(selected.idempotencyKey, 'browser:fresh-after-resolve');
  assert.equal(state.readMarker(storage, safe.idempotencyKey).state, 'failed');
  assert.equal(state.readMarker(storage, unsafe.idempotencyKey).state, 'accepted');
});

test('failed marker met duurzame identiteit roteert nooit naar nieuwe inhoud', () => {
  const storage = new MemoryStorage();
  const existing = state.compareAndSwapMarker(storage, markerInput({
    state: 'failed',
    durableIdentity: { intentId: 'send:failed-uncertain', messageId: '<failed@softora.nl>' },
  }), null, {
    now: () => 10,
    randomUUID: () => 'cas-existing',
  });

  assert.throws(
    () => state.selectMarker(
      storage,
      existing.idempotencyKey,
      'c'.repeat(64),
      existing.localScopeFingerprint,
      [],
      {
        now: () => 20,
        randomUUID: () => 'mag-niet-worden-gebruikt',
        replaceProvenPreDispatch: true,
      }
    ),
    (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_PAYLOAD_MISMATCH'
  );
  const unchanged = state.readMarker(storage, existing.idempotencyKey);
  assert.equal(unchanged.state, 'failed');
  assert.equal(unchanged.casToken, existing.casToken);
  assert.equal(unchanged.durableIdentity.intentId, 'send:failed-uncertain');
});

test('een expliciete of payloadgelijke marker omzeilt nooit een tweede onzekere poging', () => {
  for (const requestedKey of ['browser:exact-current', '']) {
    const storage = new MemoryStorage();
    state.compareAndSwapMarker(storage, markerInput({
      idempotencyKey: 'browser:exact-current',
      payloadFingerprint: 'c'.repeat(64),
      state: 'armed',
    }), null, {
      now: () => 10,
      randomUUID: () => 'cas-current',
    });
    state.compareAndSwapMarker(storage, markerInput({
      idempotencyKey: 'browser:uncertain-other-content',
      payloadFingerprint: 'd'.repeat(64),
      state: 'dispatching',
      sendStartedAt: 9,
    }), null, {
      now: () => 10,
      randomUUID: () => 'cas-uncertain',
    });

    assert.throws(
      () => state.selectMarker(
        storage,
        requestedKey,
        'c'.repeat(64),
        'b'.repeat(64),
        [],
        {
          now: () => 20,
          randomUUID: () => 'mag-niet-worden-gebruikt',
          replaceProvenPreDispatch: true,
        }
      ),
      (error) => error.code === 'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT',
      requestedKey || 'payload match'
    );
    assert.equal(
      state.readMarker(storage, 'browser:uncertain-other-content').state,
      'dispatching'
    );
  }
});

test('een expliciete marker omzeilt nooit een dubbele onopgeloste payload', () => {
  const storage = new MemoryStorage();
  for (const [idempotencyKey, stateName, sendStartedAt] of [
    ['browser:exact-current', 'armed', undefined],
    ['browser:duplicate-current', 'processing', 9],
  ]) {
    state.compareAndSwapMarker(storage, markerInput({
      idempotencyKey,
      payloadFingerprint: 'c'.repeat(64),
      state: stateName,
      ...(sendStartedAt === undefined ? {} : { sendStartedAt }),
    }), null, {
      now: () => 10,
      randomUUID: () => `cas-${idempotencyKey}`,
    });
  }

  assert.throws(
    () => state.selectMarker(
      storage,
      'browser:exact-current',
      'c'.repeat(64),
      'b'.repeat(64),
      [],
      {
        now: () => 20,
        randomUUID: () => 'mag-niet-worden-gebruikt',
        replaceProvenPreDispatch: true,
      }
    ),
    (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_AMBIGUOUS'
  );
});

test('selectMarker gebruikt de expliciet meegegeven storage ook bij een nieuwe marker', () => {
  const storage = new MemoryStorage();
  const created = state.selectMarker(
    storage,
    '',
    'c'.repeat(64),
    'd'.repeat(64),
    [],
    { now: () => 20, randomUUID: (() => {
      const values = ['idempotency', 'cas-token'];
      return () => values.shift();
    })() }
  );
  assert.equal(created.idempotencyKey, 'browser:idempotency');
  assert.equal(created.casToken, 'cas-token');
  assert.equal(state.readMarker(storage, created.idempotencyKey).state, 'armed');
});

test('ongeldige WebCrypto-digestlengte levert nooit een fingerprint op', async () => {
  await assert.rejects(
    state.sha256Hex('payload', {
      crypto: { subtle: { async digest() { return new ArrayBuffer(31); } } },
    }),
    (error) => error.code === 'MAILBOX_SEND_CRYPTO_INVALID'
  );
});
