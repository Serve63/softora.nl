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

test('beschadigde, uppercase of gemengde bijlagebewijzen falen gesloten', () => {
  const base = markerInput({ casToken: 'cas-token' });
  for (const changed of [
    { ...base, payloadFingerprint: 'A'.repeat(64) },
    { ...base, localScopeFingerprint: 'B'.repeat(64) },
    {
      ...base,
      attachmentsMetadata: [
        { filename: 'a.pdf', contentType: 'application/pdf', size: 1, sha256: 'a'.repeat(64) },
        { filename: 'b.pdf', contentType: 'application/pdf', size: 1 },
      ],
    },
  ]) {
    assert.throws(
      () => state.parseMarker(JSON.stringify(changed)),
      (error) => error.code === 'MAILBOX_SEND_DURABLE_STATE_CORRUPT'
    );
  }
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

test('ongeldige WebCrypto-digestlengte levert nooit een fingerprint op', async () => {
  await assert.rejects(
    state.sha256Hex('payload', {
      crypto: { subtle: { async digest() { return new ArrayBuffer(31); } } },
    }),
    (error) => error.code === 'MAILBOX_SEND_CRYPTO_INVALID'
  );
});
