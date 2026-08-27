const test = require('node:test');
const assert = require('node:assert/strict');

const browserStorage = require('../../assets/premium-browser-storage');

function createFakeLocalStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('strikte prefixopslag ziet en wijzigt uitsluitend de toegewezen namespace', () => {
  const storage = createFakeLocalStorage();
  const prefix = 'softora.mailbox.send-resilience.v1:';
  storage.setItem('softora.mailbox.send-retry.v1', 'blijft-afgeschermd');
  storage.setItem(`${prefix}existing`, 'bestaand');
  const scoped = browserStorage.createStrictPrefixedStorage({ storage, prefix });

  assert.equal(scoped.length, 1);
  assert.equal(scoped.key(0), `${prefix}existing`);
  assert.equal(scoped.key(1), null);
  assert.equal(scoped.getItem(`${prefix}existing`), 'bestaand');
  scoped.setItem(`${prefix}new`, 'nieuw');
  assert.equal(storage.getItem(`${prefix}new`), 'nieuw');
  assert.equal(scoped.length, 2);

  assert.throws(() => scoped.getItem('softora.mailbox.send-retry.v1'), /buiten de toegestane prefix/);
  assert.throws(() => scoped.setItem(prefix, 'leeg'), /buiten de toegestane prefix/);
  assert.throws(() => scoped.setItem(`${prefix}object`, { fout: true }), /uitsluitend tekstwaarden/);
  scoped.removeItem(`${prefix}existing`);
  assert.equal(storage.getItem(`${prefix}existing`), null);
  assert.equal(storage.getItem('softora.mailbox.send-retry.v1'), 'blijft-afgeschermd');
});

test('strikte prefixopslag faalt gesloten bij ongeldige prefix of ontbrekende duurzame storage', () => {
  const storage = createFakeLocalStorage();
  for (const prefix of ['', 'mailbox:', 'softora:', 'softora.mailbox', 'softora.mailbox:extra']) {
    assert.throws(
      () => browserStorage.createStrictPrefixedStorage({ storage, prefix }),
      /geldige afgeschermde prefix/
    );
  }
  assert.throws(
    () => browserStorage.createStrictPrefixedStorage({ storage: null, prefix: 'softora.mailbox.safe:' }),
    /niet beschikbaar/
  );
  assert.throws(
    () => browserStorage.createStrictPrefixedStorage({
      storage: { length: 0, getItem() {}, setItem() {}, removeItem() {} },
      prefix: 'softora.mailbox.safe:',
    }),
    /niet beschikbaar/
  );
});

function createScope(overrides = {}) {
  return {
    owner: 'serve',
    account: 'serve@softora.nl',
    recipient: 'prospect@example.nl',
    provider: 'smtp',
    mode: 'reply',
    conversationId: 'conversation-1',
    replyTarget: '<incoming@example.nl>',
    providerThreadId: '',
    ...overrides,
  };
}

test('duurzame retry-opslag serialiseert tabs en bewaart uitsluitend context plus verzend-ID', async () => {
  const storage = createFakeLocalStorage();
  let queue = Promise.resolve();
  const locks = {
    request(_name, _options, operation) {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    },
  };
  const firstTab = browserStorage.createScopedSendRetryStore({ storage, locks });
  const secondTab = browserStorage.createScopedSendRetryStore({ storage, locks });
  const scope = createScope();

  const [first, second] = await Promise.all([
    firstTab.getOrCreate(scope, () => 'tab-a-key'),
    secondTab.getOrCreate(scope, () => 'tab-b-key'),
  ]);

  assert.equal(first.idempotencyKey, 'tab-a-key');
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(first.durable, true);
  assert.equal(second.reused, true);
  const serialized = storage.getItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY);
  assert.doesNotMatch(serialized, /mailtekst|contentBase64|attachments|filename|body/i);
});

test('reconcilemarkering blijft duurzaam maar corrupte, verlopen en extra velden worden verwijderd', async () => {
  const storage = createFakeLocalStorage();
  const scope = createScope();
  const store = browserStorage.createScopedSendRetryStore({ storage });
  await store.getOrCreate(scope, () => 'durable-key');
  await store.markReconcileRequired(scope);

  const reused = await browserStorage.createScopedSendRetryStore({ storage }).getOrCreate(
    scope,
    () => 'unused-key'
  );
  assert.equal(reused.idempotencyKey, 'durable-key');
  assert.equal(reused.reconcileRequired, true);

  storage.setItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY, '{kapot');
  const repaired = await browserStorage.createScopedSendRetryStore({ storage }).getOrCreate(
    createScope({ recipient: 'corrupt@example.nl' }),
    () => 'repaired-key'
  );
  assert.equal(repaired.idempotencyKey, 'repaired-key');
  assert.doesNotThrow(() => JSON.parse(storage.getItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY)));

  const storedAt = Date.now();
  storage.setItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY, JSON.stringify([{
    scope: { ...scope, body: 'mag nooit blijven staan' },
    idempotencyKey: 'sanitize-key',
    createdAt: storedAt,
    attachments: [{ contentBase64: 'verboden' }],
  }]));
  await browserStorage.createScopedSendRetryStore({ storage }).getOrCreate(scope, () => 'unused-key');
  assert.doesNotMatch(
    storage.getItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY),
    /mag nooit|contentBase64|attachments|body/i
  );

  storage.setItem(browserStorage.MAILBOX_SEND_RETRY_STORAGE_KEY, JSON.stringify([{
    scope,
    idempotencyKey: 'expired-key',
    createdAt: 1,
  }]));
  const refreshed = await browserStorage.createScopedSendRetryStore({
    storage,
    now: () => 10_000,
    ttlMs: 100,
  }).getOrCreate(scope, () => 'fresh-key');
  assert.equal(refreshed.idempotencyKey, 'fresh-key');
});

test('verwijderen wist exact de bijbehorende scope en laat andere accounts intact', async () => {
  const storage = createFakeLocalStorage();
  const store = browserStorage.createScopedSendRetryStore({ storage });
  const serve = createScope({ owner: 'serve', account: 'serve@softora.nl' });
  const martijn = createScope({ owner: 'martijn', account: 'martijn@softora.nl' });
  await store.getOrCreate(serve, () => 'serve-key');
  await store.getOrCreate(martijn, () => 'martijn-key');

  await store.remove(serve);

  const serveFresh = await store.getOrCreate(serve, () => 'serve-fresh-key');
  const martijnExisting = await store.getOrCreate(martijn, () => 'martijn-unused-key');
  assert.equal(serveFresh.idempotencyKey, 'serve-fresh-key');
  assert.equal(martijnExisting.idempotencyKey, 'martijn-key');
});
