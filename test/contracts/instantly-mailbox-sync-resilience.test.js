const test = require('node:test');
const assert = require('node:assert/strict');

const { createInstantlyMailboxService } = require('../../server/services/instantly-mailbox');
const {
  parseInstantlyEmailListResponse,
} = require('../../server/services/instantly-mailbox-provider-api');
const { buildRecentSyncResult } = require('../../server/services/instantly-mailbox-sync-cadence');
const { readInstantlyOwnerSyncState } = require('../../server/services/instantly-mailbox-sync-state');

function incoming(overrides = {}) {
  return {
    id: 'reply-1',
    eaccount: 'serve-sender@example.com',
    campaign_id: 'campaign-serve',
    thread_id: '',
    email_type: 'received',
    from_address_email: 'prospect@example.org',
    to_address_email_list: ['serve-sender@example.com'],
    subject: 'Re: Kleine vraag',
    body: { text: 'Ik heb interesse.' },
    timestamp_created: '2026-07-25T11:59:00.000Z',
    timestamp_email: '2026-07-25T11:59:00.000Z',
    ...overrides,
  };
}

function createStore(initialSyncState = null) {
  const rows = [];
  let syncState = initialSyncState;
  const finishCalls = [];
  return {
    rows,
    finishCalls,
    async getSyncState() { return syncState; },
    async acquireSyncLock() {
      syncState = { ...(syncState || {}), lock_token: 'lock-token' };
      return { ok: true, lockToken: 'lock-token' };
    },
    async finishSync(options) {
      finishCalls.push(options);
      syncState = {
        ...(syncState || {}),
        lock_token: null,
        last_synced_at: options.error
          ? syncState?.last_synced_at || null
          : options.syncedThroughAt,
        last_error: options.error || null,
      };
      return { ok: true };
    },
    async upsertProviderMessages({ messages }) {
      for (const message of messages) {
        const index = rows.findIndex((candidate) => candidate.id === message.id);
        if (index >= 0) rows[index] = message;
        else rows.push(message);
      }
      return { ok: true, upserted: messages.length };
    },
    async listProviderMessages() { return rows.slice(); },
    async listProviderActiveConversationAuditMessages() { return []; },
  };
}

function buildService({
  fetchJsonWithTimeout,
  initialSyncState = null,
  config = {},
  nowRef = { value: '2026-07-25T12:00:00.000Z' },
  initialUiStates = {},
} = {}) {
  const store = createStore(initialSyncState);
  const uiStates = new Map(Object.entries(initialUiStates));
  const requests = [];
  const service = createInstantlyMailboxService({
    config: {
      enabled: true,
      apiKey: 'test-key',
      webhookSecret: 'test-secret',
      apiBaseUrl: 'https://api.instantly.test/api/v2',
      accountOwners: {
        'serve-sender@example.com': 'serve',
        'martijn-sender@example.com': 'martijn',
      },
      campaignOwners: {
        'campaign-serve': 'serve',
        'campaign-martijn': 'martijn',
      },
      ...config,
    },
    mailboxIndexStore: store,
    now: () => new Date(nowRef.value),
    getUiStateValues: async (scope) => ({
      values: { ...(uiStates.get(scope) || {}) },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values) => {
      uiStates.set(scope, { ...(values || {}) });
      return { values: { ...(values || {}) }, source: 'supabase' };
    },
    fetchJsonWithTimeout: async (url, options) => {
      requests.push({ url, options });
      return fetchJsonWithTimeout(url, options);
    },
  });
  return { service, store, uiStates, requests };
}

test('Instantly email list parser rejects malformed HTTP 200 envelopes instead of declaring them empty', () => {
  for (const payload of [null, { unexpected: true }, { status: 'ok' }, { items: null }, []]) {
    assert.throws(
      () => parseInstantlyEmailListResponse(payload),
      { code: 'INSTANTLY_EMAIL_LIST_INVALID_RESPONSE', status: 502 }
    );
  }
  assert.deepEqual(
    parseInstantlyEmailListResponse({ items: [], next_starting_after: 'cursor-2' }),
    { items: [], nextCursor: 'cursor-2' }
  );
});

test('Instantly continuation leest duurzaam met een eigen ruime timeout zonder generieke cooldown', async () => {
  const reads = [];
  await readInstantlyOwnerSyncState({
    owner: 'serve',
    getUiStateValues: async (scope, options) => {
      reads.push({ scope, options });
      return { values: { state_json: '{"version":2,"segments":[],"quarantine":[]}' }, source: 'supabase' };
    },
  });

  assert.equal(reads.length, 1);
  assert.equal(reads[0].scope, 'instantly_mailbox_sync_serve');
  assert.deepEqual(reads[0].options, {
    uiStateReadTimeoutMs: 5000,
    preferSupabaseRestRead: true,
    bypassReadFailureCooldown: true,
    suppressReadFailureCooldown: true,
    suppressReadFailureLog: true,
    ignoreSupabaseRestFailureCooldown: true,
    suppressSupabaseRestFailureCooldown: true,
  });
});

test('malformed provider success leaves the watermark and continuation untouched', async () => {
  const { service, store, uiStates } = buildService({
    initialSyncState: { last_synced_at: '2026-07-25T11:00:00.000Z' },
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { unexpected: true },
    }),
  });

  await assert.rejects(service.syncOwner('serve'), {
    code: 'INSTANTLY_EMAIL_LIST_INVALID_RESPONSE',
  });
  assert.equal(store.rows.length, 0);
  assert.equal(store.finishCalls.at(-1).error.includes('ongeldig'), true);
  assert.equal(uiStates.has('instantly_mailbox_sync_serve'), false);
});

test('corrupt durable continuation fails closed before the provider is queried', async () => {
  const { service, store, requests } = buildService({
    initialUiStates: {
      instantly_mailbox_sync_serve: { state_json: '{broken' },
    },
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { items: [incoming()] },
    }),
  });

  await assert.rejects(service.syncOwner('serve'), {
    code: 'INSTANTLY_SYNC_STATE_INVALID',
  });
  assert.equal(requests.length, 0);
  assert.equal(store.finishCalls.at(-1).error.includes('beschadigd'), true);
});

test('fresh head is stored before an older durable segment and watermark stops at scan start', async () => {
  const storedState = JSON.stringify({
    version: 2,
    segments: [{
      cursor: 'old-cursor',
      minTimestamp: '2026-07-20T00:00:00.000Z',
      maxTimestamp: '2026-07-25T11:00:00.000Z',
      scanStartedAt: '2026-07-25T11:00:00.000Z',
    }],
    quarantine: [],
  });
  const { service, store, requests } = buildService({
    initialSyncState: { last_synced_at: '2026-07-25T11:55:00.000Z' },
    initialUiStates: {
      instantly_mailbox_sync_serve: { state_json: storedState },
    },
    fetchJsonWithTimeout: async (url) => {
      const cursor = new URL(url).searchParams.get('starting_after') || '';
      return {
        response: { ok: true, status: 200 },
        data: { items: [incoming({ id: cursor ? 'old-reply' : 'fresh-reply' })] },
      };
    },
  });

  const result = await service.syncOwner('serve');
  assert.equal(result.complete, true);
  assert.deepEqual(store.rows.map((row) => row.providerMessageId), ['fresh-reply', 'old-reply']);
  const firstQuery = new URL(requests[0].url).searchParams;
  const secondQuery = new URL(requests[1].url).searchParams;
  assert.equal(firstQuery.get('starting_after'), null);
  assert.equal(firstQuery.get('max_timestamp_created'), '2026-07-25T12:00:00.000Z');
  assert.equal(secondQuery.get('starting_after'), 'old-cursor');
  assert.equal(store.finishCalls.at(-1).syncedThroughAt, '2026-07-25T12:00:00.000Z');
});

test('one rejected item is durably quarantined while the next provider page remains visible', async () => {
  const nowRef = { value: '2026-07-25T12:00:00.000Z' };
  let recovered = false;
  const { service, store, uiStates } = buildService({
    nowRef,
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/emails/poison-reply')) {
        return {
          response: { ok: true, status: 200 },
          data: incoming({ id: 'poison-reply' }),
        };
      }
      const cursor = parsed.searchParams.get('starting_after') || '';
      if (!cursor && !recovered) {
        return {
          response: { ok: true, status: 200 },
          data: {
            items: [incoming({
              id: 'poison-reply',
              eaccount: 'unknown@example.org',
              to_address_email_list: ['unknown@example.org'],
            })],
            next_starting_after: 'healthy-page',
          },
        };
      }
      if (cursor === 'healthy-page') {
        recovered = true;
        return {
          response: { ok: true, status: 200 },
          data: { items: [incoming({ id: 'healthy-reply' })] },
        };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  const first = await service.syncOwner('serve');
  assert.equal(first.degraded, true);
  assert.equal(first.quarantined, 1);
  assert.deepEqual(store.rows.map((row) => row.providerMessageId), ['healthy-reply']);
  const firstState = JSON.parse(uiStates.get('instantly_mailbox_sync_serve').state_json);
  assert.equal(firstState.quarantine[0].providerMessageId, 'poison-reply');

  nowRef.value = '2026-07-25T12:20:00.000Z';
  const second = await service.syncOwner('serve');
  assert.equal(second.quarantined, 0);
  assert.equal(second.recoveredFromQuarantine, 1);
  assert.deepEqual(
    store.rows.map((row) => row.providerMessageId).sort(),
    ['healthy-reply', 'poison-reply']
  );
});

test('a quarantine retry with an uncertain database outcome is never downgraded to a warning', async () => {
  const dueState = JSON.stringify({
    version: 2,
    segments: [],
    quarantine: [{
      identity: 'id:poison-reply',
      providerMessageId: 'poison-reply',
      reason: 'normalization-rejected',
      firstSeenAt: '2026-07-25T11:00:00.000Z',
      lastSeenAt: '2026-07-25T11:00:00.000Z',
      nextRetryAt: '2026-07-25T11:15:00.000Z',
      attempts: 1,
    }],
  });
  const { service, store } = buildService({
    initialUiStates: {
      instantly_mailbox_sync_serve: { state_json: dueState },
    },
    fetchJsonWithTimeout: async (url) => ({
      response: { ok: true, status: 200 },
      data: url.includes('/emails/poison-reply')
        ? incoming({ id: 'poison-reply' })
        : { items: [] },
    }),
  });
  const uncertain = new Error('Database-uitkomst onzeker');
  uncertain.code = 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN';
  uncertain.leaveMutationPending = true;
  store.upsertProviderMessages = async () => ({ ok: false, error: uncertain });

  await assert.rejects(service.syncOwner('serve'), {
    code: 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN',
  });
  assert.equal(store.finishCalls.length, 0);
});

test('a prior degraded sync is never hidden by the interactive recent-sync shortcut', () => {
  const result = buildRecentSyncResult({
    state: {
      last_synced_at: '2026-07-25T12:00:00.000Z',
      last_error: 'INSTANTLY_ITEMS_QUARANTINED:1',
    },
    owner: 'serve',
    accounts: [{ email: 'serve-sender@example.com' }],
    minIntervalMs: 3 * 60 * 1000,
    nowMs: Date.parse('2026-07-25T12:01:00.000Z'),
  });
  assert.equal(result, null);
});

test('temporary global lease pressure is retried instead of skipping the Instantly owner', async () => {
  const { service, store } = buildService({
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { items: [] },
    }),
  });
  const acquire = store.acquireSyncLock.bind(store);
  let attempts = 0;
  store.acquireSyncLock = async (options) => {
    attempts += 1;
    if (attempts <= 2) {
      return { ok: false, locked: true, lockReason: 'global_capacity' };
    }
    return acquire(options);
  };

  const result = await service.syncOwner('serve');
  assert.equal(result.ok, true);
  assert.equal(result.lockAttempts, 3);
  assert.equal(attempts, 3);
});
