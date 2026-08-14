(function (global) {
  'use strict';

  const DB_NAME = 'softora_mailbox_state_outbox_v1';
  const STORE_NAME = 'mutations';
  const CHANNEL_NAME = 'softora_mailbox_state_outbox_v1';
  const MAX_ATTEMPTS = 8;
  const REQUEST_TIMEOUT_MS = 20_000;
  const LEASE_MS = 30_000;
  const MAX_BACKOFF_MS = 60_000;

  function normalize(value) {
    return String(value || '').trim();
  }

  function nowRevision(nowMs, sequence) {
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(nowMs) * 1000 + (sequence % 1000)));
  }

  function createMutationId(cryptoImpl, nowMs, sequence, random) {
    if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
    return `mailbox-${nowMs.toString(36)}-${sequence.toString(36)}-${Math.floor(random() * 0x100000000).toString(36)}`;
  }

  function isRetryableStatus(status) {
    return [408, 429, 502, 503, 504].includes(Number(status));
  }

  function humanFailureMessage(status, payload) {
    const code = normalize(payload?.code);
    if (status === 401 || status === 403) return 'Je sessie is verlopen. Vernieuw de pagina en probeer opnieuw.';
    if (status === 400 || status === 404 || status === 409 || /VALID|NOT_FOUND|OWNER|ACCOUNT/.test(code)) {
      return 'Deze mailboxstatus kan niet worden opgeslagen.';
    }
    return 'Opslaan lukt nog niet. Controleer je verbinding en probeer opnieuw.';
  }

  function createMemoryStore() {
    const records = new Map();
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
        const claimed = { ...current, leaseOwner: owner, leaseUntil: nowMs + LEASE_MS };
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

  function createIndexedDbStore(indexedDBImpl) {
    if (!indexedDBImpl || typeof indexedDBImpl.open !== 'function') return createMemoryStore();
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDBImpl.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'resourceKey' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Mailbox-outbox openen mislukt'));
      });
      return dbPromise;
    }
    function transaction(mode, operation) {
      return open().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('Mailbox-outbox transactie mislukt'));
        tx.onabort = () => reject(tx.error || new Error('Mailbox-outbox transactie afgebroken'));
        operation(store, (next) => { value = next; });
      }));
    }
    return {
      putLatest(record) {
        return transaction('readwrite', (store, done) => {
          const get = store.get(record.resourceKey);
          get.onsuccess = () => {
            const current = get.result;
            const selected = !current || Number(current.revision) <= Number(record.revision) ? record : current;
            store.put(selected);
            done(selected);
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
              done(null);
              return;
            }
            const claimed = { ...current, leaseOwner: owner, leaseUntil: nowMs + LEASE_MS };
            store.put(claimed);
            done(claimed);
          };
        });
      },
      complete(resourceKey, mutationId) {
        return transaction('readwrite', (store, done) => {
          const request = store.get(resourceKey);
          request.onsuccess = () => {
            const current = request.result;
            if (current?.mutationId !== mutationId) { done(false); return; }
            store.delete(resourceKey);
            done(true);
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
            store.put(updated);
            done(updated);
          };
        });
      },
    };
  }

  function create(options = {}) {
    const target = options.global || global;
    const now = options.now || Date.now;
    const random = options.random || Math.random;
    const fetchImpl = options.fetch || target.fetch?.bind(target);
    const cryptoImpl = options.crypto || target.crypto;
    const store = options.store || createIndexedDbStore(options.indexedDB || target.indexedDB);
    const listeners = new Set();
    const inflight = new Set();
    const tabId = createMutationId(cryptoImpl, now(), 0, random);
    const BroadcastChannelImpl = options.BroadcastChannel || target.BroadcastChannel;
    const setTimer = options.setTimeout || target.setTimeout?.bind(target) || setTimeout;
    const clearTimer = options.clearTimeout || target.clearTimeout?.bind(target) || clearTimeout;
    let channel = null;
    let sequence = 0;
    let timer = null;
    let stopped = false;

    function emit(type, record, detail = {}) {
      const event = { type, record, ...detail };
      listeners.forEach((listener) => {
        try { listener(event); } catch (_) {}
      });
      if (channel && detail.broadcast !== false) {
        try { channel.postMessage({ ...event, broadcast: false }); } catch (_) {}
      }
    }

    function nextDelay(attempt) {
      const base = Math.min(MAX_BACKOFF_MS, 500 * (2 ** Math.max(0, attempt - 1)));
      return Math.round(base * (0.75 + random() * 0.5));
    }

    function schedule(delayMs = 0) {
      if (stopped) return;
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; void flush(); }, Math.max(0, Number(delayMs) || 0));
    }

    async function request(url, record) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimer(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
      try {
        const response = await fetchImpl(url, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: controller?.signal,
          body: JSON.stringify(record.payload),
        });
        const data = await response.json().catch(() => ({}));
        return { response, data };
      } finally {
        if (timeout) clearTimer(timeout);
      }
    }

    async function reconcileAmbiguous(record) {
      if (!record.ambiguous) return false;
      try {
        const { response, data } = await request('/api/mailbox/messages/read/status', record);
        if (!response.ok || !data?.ok) return false;
        if (data.result?.confirmed || data.result?.superseded) {
          const completed = await store.complete(record.resourceKey, record.mutationId);
          if (completed) emit('confirmed', record, { result: data.result });
          return true;
        }
      } catch (_) {}
      return false;
    }

    async function send(record) {
      if (inflight.has(record.resourceKey)) return;
      inflight.add(record.resourceKey);
      try {
        if (await reconcileAmbiguous(record)) return;
        const { response, data } = await request('/api/mailbox/messages/read', record);
        if (response.ok && data?.ok) {
          const completed = await store.complete(record.resourceKey, record.mutationId);
          if (completed) emit('confirmed', record, { result: data.result || null });
          return;
        }
        const retryable = data?.retryable === true || isRetryableStatus(response.status);
        if (!retryable) {
          const failed = await store.update(record.resourceKey, record.mutationId, {
            status: 'failed', leaseOwner: '', leaseUntil: 0,
            errorMessage: humanFailureMessage(response.status, data),
          });
          if (failed) emit('failed', failed, { message: failed.errorMessage });
          return;
        }
        throw Object.assign(new Error('retryable mailbox state response'), { ambiguous: true });
      } catch (error) {
        const attempt = Number(record.attempts || 0) + 1;
        if (attempt >= MAX_ATTEMPTS) {
          const failed = await store.update(record.resourceKey, record.mutationId, {
            status: 'failed', attempts: attempt, leaseOwner: '', leaseUntil: 0,
            ambiguous: true,
            errorMessage: 'Opslaan lukt nog niet. Controleer je verbinding en probeer opnieuw.',
          });
          if (failed) emit('failed', failed, { message: failed.errorMessage });
          return;
        }
        const delay = nextDelay(attempt);
        const pending = await store.update(record.resourceKey, record.mutationId, {
          status: 'pending', attempts: attempt, nextAttemptAt: now() + delay,
          leaseOwner: '', leaseUntil: 0, ambiguous: true, errorMessage: '',
        });
        if (pending) emit('retry-scheduled', pending, { delayMs: delay });
        schedule(delay);
      } finally {
        inflight.delete(record.resourceKey);
      }
    }

    async function flush(settings = {}) {
      if (stopped || typeof fetchImpl !== 'function') return false;
      const records = await store.list().catch(() => []);
      const nowMs = now();
      const due = records
        .filter((record) => record.status !== 'failed' && (settings.force || Number(record.nextAttemptAt || 0) <= nowMs))
        .sort((a, b) => Number(a.nextAttemptAt || 0) - Number(b.nextAttemptAt || 0));
      const sends = [];
      for (const candidate of due.slice(0, 2)) {
        const claimed = await store.claim(candidate.resourceKey, tabId, nowMs, settings.force === true).catch(() => null);
        if (claimed) sends.push(send(claimed));
      }
      await Promise.all(sends);
      const future = records.filter((record) => record.status !== 'failed' && Number(record.nextAttemptAt || 0) > nowMs);
      if (future.length) schedule(Math.min(...future.map((record) => Number(record.nextAttemptAt) - nowMs)));
      return due.length > 0;
    }

    async function enqueue(payload, meta = {}) {
      sequence = (sequence + 1) % 1000;
      const nowMs = now();
      const resourceKey = normalize(meta.resourceKey);
      if (!resourceKey) throw new Error('Mailbox-outbox mist resource-identiteit');
      const mutationId = createMutationId(cryptoImpl, nowMs, sequence, random);
      const revision = nowRevision(nowMs, sequence);
      const record = {
        resourceKey, mutationId, revision,
        payload: { ...payload, mutationId, revision },
        identity: meta.identity || null,
        identities: Array.isArray(meta.identities) ? meta.identities.filter(Boolean) : [],
        previous: meta.previous || null,
        dismissReply: payload?.dismissReply === true,
        unread: payload?.unread === true,
        status: 'pending', attempts: 0, nextAttemptAt: nowMs,
        leaseOwner: '', leaseUntil: 0, ambiguous: false,
        createdAt: nowMs, updatedAt: nowMs, errorMessage: '',
      };
      const saved = await store.putLatest(record);
      emit('pending', saved);
      schedule(0);
      return { ok: true, pending: true, record: saved };
    }

    async function retry(resourceKey) {
      const current = await store.get(resourceKey);
      if (!current) return false;
      const updated = await store.update(resourceKey, current.mutationId, {
        status: 'pending', attempts: 0, nextAttemptAt: now(),
        leaseOwner: '', leaseUntil: 0, errorMessage: '',
      });
      if (!updated) return false;
      emit('pending', updated);
      schedule(0);
      return true;
    }

    async function hydrate() {
      const records = await store.list().catch(() => []);
      records.forEach((record) => emit(record.status === 'failed' ? 'failed' : 'pending', record, { broadcast: false }));
      schedule(0);
      return records;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function triggerRecovery() { void flush({ force: true }); }
    target.addEventListener?.('online', triggerRecovery);
    target.addEventListener?.('pageshow', triggerRecovery);
    target.document?.addEventListener?.('visibilitychange', () => {
      if (target.document.visibilityState === 'visible') triggerRecovery();
    });
    if (typeof BroadcastChannelImpl === 'function') {
      try {
        channel = new BroadcastChannelImpl(CHANNEL_NAME);
        channel.addEventListener?.('message', (event) => {
          const data = event?.data;
          if (!data?.type || !data?.record) return;
          emit(data.type, data.record, { result: data.result, message: data.message, broadcast: false });
          if (data.type === 'pending' || data.type === 'retry-scheduled') schedule(0);
        });
      } catch (_) { channel = null; }
    }

    void hydrate();
    return {
      enqueue,
      flush,
      hydrate,
      retry,
      subscribe,
      store,
      destroy() {
        stopped = true;
        if (timer) clearTimer(timer);
        channel?.close?.();
      },
    };
  }

  const api = { create, createMemoryStore, isRetryableStatus };
  global.SoftoraMailboxStateOutbox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
