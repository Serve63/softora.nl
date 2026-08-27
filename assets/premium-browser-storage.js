(function (global) {
  'use strict';

  const MAILBOX_SEND_RETRY_STORAGE_KEY = 'softora.mailbox.send-retry.v1';
  const MAILBOX_SEND_RETRY_SCOPE_FIELDS = Object.freeze([
    'owner', 'account', 'recipient', 'provider', 'mode', 'conversationId',
    'replyTarget', 'providerThreadId',
  ]);
  const STRICT_STORAGE_PREFIX_PATTERN = /^softora\.[a-z0-9][a-z0-9._-]{2,126}:$/i;
  let mailboxSendRetryMemoryRecords = [];

  function createStrictPrefixedStorage(options = {}) {
    const prefix = String(options.prefix || '');
    if (!STRICT_STORAGE_PREFIX_PATTERN.test(prefix)) {
      throw new Error('Duurzame browseropslag mist een geldige afgeschermde prefix.');
    }
    let storage;
    if (Object.prototype.hasOwnProperty.call(options, 'storage')) {
      storage = options.storage;
    } else {
      try { storage = global.localStorage; } catch (error) {
        throw new Error('Duurzame browseropslag is niet beschikbaar.', { cause: error });
      }
    }
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
      || typeof storage.key !== 'function'
      || !Number.isFinite(Number(storage.length))
    ) {
      throw new Error('Duurzame browseropslag is niet beschikbaar.');
    }

    function scopedKey(value) {
      if (typeof value !== 'string' || !value.startsWith(prefix) || value.length <= prefix.length) {
        throw new Error('Browseropslagsleutel valt buiten de toegestane prefix.');
      }
      return value;
    }

    function scopedKeys() {
      const length = Number(storage.length);
      if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) {
        throw new Error('Duurzame browseropslag heeft een ongeldige omvang.');
      }
      const keys = [];
      for (let index = 0; index < length; index += 1) {
        const key = storage.key(index);
        if (typeof key === 'string' && key.startsWith(prefix) && key.length > prefix.length) keys.push(key);
      }
      return keys;
    }

    return Object.freeze({
      get length() { return scopedKeys().length; },
      key(index) {
        const position = Number(index);
        if (!Number.isSafeInteger(position) || position < 0) return null;
        return scopedKeys()[position] ?? null;
      },
      getItem(key) { return storage.getItem(scopedKey(key)); },
      setItem(key, value) {
        if (typeof value !== 'string') throw new Error('Browseropslag accepteert uitsluitend tekstwaarden.');
        storage.setItem(scopedKey(key), value);
      },
      removeItem(key) { storage.removeItem(scopedKey(key)); },
    });
  }

  function createScopedSendRetryStore(options = {}) {
    const storageKey = String(options.storageKey || MAILBOX_SEND_RETRY_STORAGE_KEY).trim();
    const ttlMs = Math.max(1, Number(options.ttlMs) || 2 * 60 * 60 * 1000);
    const maxEntries = Math.max(1, Math.min(100, Number(options.maxEntries) || 20));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    let storage = options.storage || null;
    if (!storage) {
      try { storage = global.localStorage || null; } catch (_) { storage = null; }
    }
    let locks = options.locks || null;
    if (!locks) {
      try { locks = global.navigator?.locks || null; } catch (_) { locks = null; }
    }

    function canonicalScope(value = {}) {
      return Object.fromEntries(MAILBOX_SEND_RETRY_SCOPE_FIELDS.map((field) => (
        [field, String(value?.[field] || '').trim().toLowerCase()]
      )));
    }

    function scopeKey(value) {
      const scope = canonicalScope(value);
      return JSON.stringify(MAILBOX_SEND_RETRY_SCOPE_FIELDS.map((field) => scope[field]));
    }

    function validRecords(value) {
      const currentTime = Number(now()) || Date.now();
      return (Array.isArray(value) ? value : []).map((record) => {
        const createdAt = Number(record?.createdAt);
        if (!(
          record && typeof record.scope === 'object'
          && String(record.idempotencyKey || '').trim()
          && Number.isFinite(createdAt)
          && createdAt > currentTime - ttlMs
          && createdAt <= currentTime + 60_000
        )) return null;
        return {
          scope: canonicalScope(record.scope),
          idempotencyKey: String(record.idempotencyKey).trim(),
          createdAt,
          reconcileRequired: record.reconcileRequired === true,
        };
      }).filter(Boolean).slice(-maxEntries);
    }

    function read() {
      if (!storage || typeof storage.getItem !== 'function') return validRecords(mailboxSendRetryMemoryRecords);
      try {
        return validRecords(JSON.parse(storage.getItem(storageKey) || '[]'));
      } catch (_) {
        return validRecords(mailboxSendRetryMemoryRecords);
      }
    }

    function write(records) {
      mailboxSendRetryMemoryRecords = validRecords(records);
      if (!storage || typeof storage.setItem !== 'function') return;
      try { storage.setItem(storageKey, JSON.stringify(mailboxSendRetryMemoryRecords)); }
      catch (_) { storage = null; }
    }

    function withScopeLock(_scopeValue, operation) {
      if (locks && typeof locks.request === 'function') {
        return locks.request('softora-mailbox-send-retry-storage', { mode: 'exclusive' }, operation);
      }
      return Promise.resolve().then(operation);
    }

    return {
      getOrCreate(scopeValue, createIdempotencyKey) {
        return withScopeLock(scopeValue, () => {
          const canonical = canonicalScope(scopeValue);
          const key = scopeKey(canonical);
          const records = read();
          write(records);
          const existing = records.find((record) => scopeKey(record.scope) === key);
          if (existing) return {
            ...existing,
            scope: canonicalScope(existing.scope),
            reused: true,
            durable: Boolean(storage),
          };
          const idempotencyKey = String(createIdempotencyKey?.() || '').trim();
          if (!idempotencyKey) throw new Error('Veilige verzend-ID ontbreekt.');
          const created = { scope: canonical, idempotencyKey, createdAt: Number(now()) || Date.now() };
          write([...records.filter((record) => scopeKey(record.scope) !== key), created]);
          return { ...created, scope: { ...canonical }, reused: false, durable: Boolean(storage) };
        });
      },
      remove(scopeValue) {
        return withScopeLock(scopeValue, () => {
          const key = scopeKey(scopeValue);
          write(read().filter((record) => scopeKey(record.scope) !== key));
        });
      },
      markReconcileRequired(scopeValue) {
        return withScopeLock(scopeValue, () => {
          const key = scopeKey(scopeValue);
          const records = read();
          const record = records.find((candidate) => scopeKey(candidate.scope) === key);
          if (!record) return null;
          const updated = { ...record, reconcileRequired: true };
          write([...records.filter((candidate) => scopeKey(candidate.scope) !== key), updated]);
          return { ...updated, scope: canonicalScope(updated.scope) };
        });
      },
    };
  }

  function createMemoryLatestRecordStore(options = {}) {
    const records = new Map();
    const leaseMs = Math.max(1, Number(options.leaseMs) || 30_000);
    return {
      async putLatest(record) {
        const current = records.get(record.resourceKey);
        if (!current || Number(current.revision) <= Number(record.revision)) records.set(record.resourceKey, { ...record });
        return records.get(record.resourceKey);
      },
      async get(resourceKey) { return records.get(resourceKey) || null; },
      async list() { return Array.from(records.values()); },
      async claim(resourceKey, owner, nowMs, force = false) {
        const current = records.get(resourceKey);
        if (!current || current.status === 'failed' || (!force && Number(current.nextAttemptAt) > nowMs)) return null;
        if (current.leaseOwner && current.leaseOwner !== owner && Number(current.leaseUntil) > nowMs) return null;
        const claimed = { ...current, leaseOwner: owner, leaseUntil: nowMs + leaseMs };
        records.set(resourceKey, claimed);
        return claimed;
      },
      async complete(resourceKey, mutationId) {
        const current = records.get(resourceKey);
        if (current?.mutationId !== mutationId) return false;
        records.delete(resourceKey);
        return true;
      },
      async update(resourceKey, mutationId, patch) {
        const current = records.get(resourceKey);
        if (current?.mutationId !== mutationId) return null;
        const updated = { ...current, ...patch };
        records.set(resourceKey, updated);
        return updated;
      },
    };
  }

  function createLatestRecordStore(options = {}) {
    const indexedDBImpl = options.indexedDB || global.indexedDB;
    if (!indexedDBImpl || typeof indexedDBImpl.open !== 'function') return createMemoryLatestRecordStore(options);
    const dbName = String(options.dbName || '').trim();
    const storeName = String(options.storeName || '').trim();
    const leaseMs = Math.max(1, Number(options.leaseMs) || 30_000);
    if (!dbName || !storeName) throw new Error('Browseropslag mist een geldige namespace.');
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDBImpl.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'resourceKey' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Browseropslag openen mislukt'));
      });
      return dbPromise;
    }
    function transaction(mode, operation) {
      return open().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('Browseropslag transactie mislukt'));
        tx.onabort = () => reject(tx.error || new Error('Browseropslag transactie afgebroken'));
        operation(store, (next) => { value = next; });
      }));
    }
    return {
      putLatest(record) {
        return transaction('readwrite', (store, done) => {
          const request = store.get(record.resourceKey);
          request.onsuccess = () => {
            const current = request.result;
            const selected = !current || Number(current.revision) <= Number(record.revision) ? record : current;
            store.put(selected); done(selected);
          };
        });
      },
      get(resourceKey) {
        return transaction('readonly', (store, done) => {
          const request = store.get(resourceKey);
          request.onsuccess = () => done(request.result || null);
        });
      },
      list() {
        return transaction('readonly', (store, done) => {
          const request = store.getAll();
          request.onsuccess = () => done(Array.isArray(request.result) ? request.result : []);
        });
      },
      claim(resourceKey, owner, nowMs, force = false) {
        return transaction('readwrite', (store, done) => {
          const request = store.get(resourceKey);
          request.onsuccess = () => {
            const current = request.result;
            if (!current || current.status === 'failed' || (!force && Number(current.nextAttemptAt) > nowMs) ||
              (current.leaseOwner && current.leaseOwner !== owner && Number(current.leaseUntil) > nowMs)) {
              done(null); return;
            }
            const claimed = { ...current, leaseOwner: owner, leaseUntil: nowMs + leaseMs };
            store.put(claimed); done(claimed);
          };
        });
      },
      complete(resourceKey, mutationId) {
        return transaction('readwrite', (store, done) => {
          const request = store.get(resourceKey);
          request.onsuccess = () => {
            const current = request.result;
            if (current?.mutationId !== mutationId) { done(false); return; }
            store.delete(resourceKey); done(true);
          };
        });
      },
      update(resourceKey, mutationId, patch) {
        return transaction('readwrite', (store, done) => {
          const request = store.get(resourceKey);
          request.onsuccess = () => {
            const current = request.result;
            if (current?.mutationId !== mutationId) { done(null); return; }
            const updated = { ...current, ...patch };
            store.put(updated); done(updated);
          };
        });
      },
    };
  }

  const api = {
    MAILBOX_SEND_RETRY_SCOPE_FIELDS,
    MAILBOX_SEND_RETRY_STORAGE_KEY,
    createLatestRecordStore,
    createMemoryLatestRecordStore,
    createScopedSendRetryStore,
    createScopedSessionRetryStore: createScopedSendRetryStore,
    createStrictPrefixedStorage,
  };
  global.SoftoraPremiumBrowserStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
