(function (global) {
  'use strict';

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

  const api = { createLatestRecordStore, createMemoryLatestRecordStore };
  global.SoftoraPremiumBrowserStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
