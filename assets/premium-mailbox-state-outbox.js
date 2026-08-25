(function (global) {
  'use strict';

  const OUTBOX_SCHEMA_VERSION = 2;
  const DB_NAME = 'softora_mailbox_state_outbox_v2';
  const STORE_NAME = 'mutations';
  const CHANNEL_NAME = 'softora_mailbox_state_outbox_v2';
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

  function hasStrongIdentity(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return Boolean(normalize(source.account) && normalize(source.messageKey));
  }

  function isCurrentRecord(record) {
    return Boolean(
      record &&
      Number(record.schemaVersion) === OUTBOX_SCHEMA_VERSION &&
      normalize(record.resourceKey) &&
      hasStrongIdentity(record.payload)
    );
  }

  function humanFailureMessage(status, payload) {
    const code = normalize(payload?.code);
    if (status === 401 || status === 403) return 'Je sessie is verlopen. Vernieuw de pagina en probeer opnieuw.';
    if (status === 400 || status === 404 || status === 409 || /VALID|NOT_FOUND|OWNER|ACCOUNT/.test(code)) {
      return 'Deze mailboxstatus kan niet worden opgeslagen.';
    }
    return 'Opslaan lukt nog niet. Controleer je verbinding en probeer opnieuw.';
  }

  function create(options = {}) {
    const target = options.global || global;
    const now = options.now || Date.now;
    const random = options.random || Math.random;
    const fetchImpl = options.fetch || target.fetch?.bind(target);
    const cryptoImpl = options.crypto || target.crypto;
    const storage = options.storage || target.SoftoraPremiumBrowserStorage;
    const store = options.store || storage?.createLatestRecordStore?.({
      dbName: DB_NAME,
      storeName: STORE_NAME,
      leaseMs: LEASE_MS,
    }) || storage?.createMemoryLatestRecordStore?.({ leaseMs: LEASE_MS });
    if (!store) throw new Error('Duurzame mailboxopslag is niet beschikbaar.');
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
      if (!isCurrentRecord(record) || !record.ambiguous) return false;
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
      if (!isCurrentRecord(record)) return;
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
        .filter(isCurrentRecord)
        .filter((record) => record.status !== 'failed' && (settings.force || Number(record.nextAttemptAt || 0) <= nowMs))
        .sort((a, b) => Number(a.nextAttemptAt || 0) - Number(b.nextAttemptAt || 0));
      const sends = [];
      for (const candidate of due.slice(0, 2)) {
        const claimed = await store.claim(candidate.resourceKey, tabId, nowMs, settings.force === true).catch(() => null);
        if (claimed) sends.push(send(claimed));
      }
      await Promise.all(sends);
      const future = records.filter((record) => isCurrentRecord(record) && record.status !== 'failed' && Number(record.nextAttemptAt || 0) > nowMs);
      if (future.length) schedule(Math.min(...future.map((record) => Number(record.nextAttemptAt) - nowMs)));
      return due.length > 0;
    }

    async function enqueue(payload, meta = {}) {
      sequence = (sequence + 1) % 1000;
      const nowMs = now();
      const resourceKey = normalize(meta.resourceKey);
      if (!resourceKey || !hasStrongIdentity(payload)) {
        throw new Error('Mailbox-outbox mist generatievaste berichtidentiteit');
      }
      const mutationId = createMutationId(cryptoImpl, nowMs, sequence, random);
      const revision = nowRevision(nowMs, sequence);
      const record = {
        schemaVersion: OUTBOX_SCHEMA_VERSION,
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
      if (!isCurrentRecord(current)) return false;
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
      const currentRecords = records.filter(isCurrentRecord);
      currentRecords.forEach((record) => emit(record.status === 'failed' ? 'failed' : 'pending', record, { broadcast: false }));
      schedule(0);
      return currentRecords;
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
          if (!data?.type || !isCurrentRecord(data?.record)) return;
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

  const storage = global.SoftoraPremiumBrowserStorage || (typeof require === 'function'
    ? require('./premium-browser-storage.js')
    : null);
  const api = {
    OUTBOX_SCHEMA_VERSION,
    create,
    createMemoryStore: () => storage.createMemoryLatestRecordStore({ leaseMs: LEASE_MS }),
    isRetryableStatus,
  };
  global.SoftoraMailboxStateOutbox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
