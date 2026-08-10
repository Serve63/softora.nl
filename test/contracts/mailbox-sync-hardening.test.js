const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxSyncService,
} = require('../../server/services/mailbox-campaign-sync');
const { selectMailboxSyncUids } = require('../../server/services/mailbox-campaign-history-sync');
const {
  getMailboxSyncResponseStatus,
  summarizeMailboxSyncResults,
} = require('../../server/services/mailbox-sync-runtime');
const { createMailboxImapSyncSession } = require('../../server/services/mailbox-imap-sync-deadline');

function createAccount(email) {
  return { email, imapConfigured: true, imapHost: 'imap.example.test' };
}

function withSyncReadHealth(messages = [], overrides = {}) {
  const selectedUids = messages.map((message) => Number(message?.uid) || 0).filter(Boolean);
  Object.defineProperty(messages, 'syncReadHealth', {
    configurable: true,
    value: {
      uidValidity: 777,
      folderMissing: false,
      parseFailures: [],
      selectedUids,
      yieldedUids: selectedUids,
      missingUids: [],
      selectedCount: selectedUids.length,
      yieldedCount: selectedUids.length,
      ...overrides,
    },
  });
  return messages;
}

function createService(overrides = {}) {
  const accounts = overrides.accounts || [createAccount('serve@softora.nl')];
  const mailboxIndexStore = {
    acquireSyncLock: async () => ({ ok: true, lockToken: 'lock-token' }),
    prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
    upsertMessages: async () => ({ ok: true, upserted: 0 }),
    finishSync: async () => ({ ok: true }),
    ...overrides.mailboxIndexStore,
  };
  return createMailboxSyncService({
    mailboxIndexStore,
    assertReadableAccount: (email) => accounts.find((account) => account.email === email) || createAccount(email),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: overrides.fetchMessagesFromImap || (async () => withSyncReadHealth([])),
    getSafeLimit: (value) => Number(value) || 4,
    getAccounts: () => accounts,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    invalidateCampaignSnapshot: overrides.invalidateCampaignSnapshot,
    logger: { info() {}, error() {} },
  });
}

test('sync lock failures fail closed while an active lock is an explicit accepted outcome', async () => {
  const lockFailure = createService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: false, locked: false, error: new Error('rpc unavailable') }),
    },
  });
  const failed = await lockFailure.syncMailbox({ folders: ['inbox'] });
  assert.equal(failed.ok, false);
  assert.equal(failed.complete, false);
  assert.equal(failed.freshnessConfirmed, false);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.results[0].reason, 'lock_failed');

  let activeLockClaims = 0;
  const activeLock = createService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        activeLockClaims += 1;
        return {
          ok: false,
          locked: true,
          lockExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
      },
    },
  });
  const accepted = await activeLock.syncMailbox({ folders: ['inbox'] });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.complete, false);
  assert.equal(accepted.freshnessConfirmed, false);
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.results[0].lockReason, 'active_target');
  assert.ok(accepted.results[0].retryAfterMs > 0);
  assert.equal(activeLockClaims, 1);
});

test('mailbox sync runs no more than three accounts concurrently', async () => {
  const accounts = Array.from({ length: 8 }, (_, index) => createAccount(`account${index}@softora.nl`));
  let active = 0;
  let maximumActive = 0;
  const service = createService({
    accounts,
    fetchMessagesFromImap: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return withSyncReadHealth([]);
    },
  });

  const result = await service.syncMailbox({ folders: ['inbox'], maxConcurrentAccounts: 99 });
  assert.equal(result.complete, true);
  assert.equal(result.summary.succeeded, 8);
  assert.equal(maximumActive, 3);
});

test('globale lease-cap zet accounts in een begrensde retryqueue zonder starvation', async () => {
  const accounts = Array.from({ length: 8 }, (_, index) => createAccount(`fair${index}@softora.nl`));
  let activeLeases = 2;
  let maximumActiveLeases = activeLeases;
  let claimCalls = 0;
  const service = createService({
    accounts,
    mailboxIndexStore: {
      acquireSyncLock: async ({ accountEmail }) => {
        claimCalls += 1;
        if (activeLeases >= 3) return { ok: false, locked: true, lockExpiresAt: null };
        activeLeases += 1;
        maximumActiveLeases = Math.max(maximumActiveLeases, activeLeases);
        return { ok: true, lockToken: `lock:${accountEmail}` };
      },
      finishSync: async () => {
        activeLeases -= 1;
        return { ok: true };
      },
    },
    fetchMessagesFromImap: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return withSyncReadHealth([]);
    },
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    deadlineAt: Date.now() + 5_000,
    folderTimeoutMs: 5_000,
  });

  assert.equal(result.complete, true);
  assert.equal(result.summary.succeeded, 8);
  assert.equal(result.summary.locked, 0);
  assert.ok(claimCalls > accounts.length);
  assert.equal(maximumActiveLeases, 3);
  assert.equal(activeLeases, 2);
});

test('blijvend volle globale lease-cap eindigt eerlijk als timeout met retrymetadata', async () => {
  const service = createService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({
        ok: false,
        locked: true,
        lockExpiresAt: null,
        lockReason: 'global_capacity',
      }),
    },
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    deadlineAt: Date.now() + 100,
    folderTimeoutMs: 5_000,
  });

  assert.equal(result.statusCode, 504);
  assert.equal(result.complete, false);
  assert.equal(result.results[0].code, 'MAILBOX_SYNC_GLOBAL_CAP_TIMEOUT');
  assert.equal(result.results[0].lockReason, 'global_capacity');
  assert.ok(result.results[0].retryAfterMs > 0);
  assert.ok(result.results[0].lockAttempts >= 2);
});

test('fast IMAP cap is complete at 20 and honestly partial at 21 or more', async () => {
  const requestedLimits = [];
  const finishCalls = [];
  let providerCount = 20;
  const service = createService({
    mailboxIndexStore: {
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
      finishSync: async (options) => { finishCalls.push(options); return { ok: true }; },
    },
    fetchMessagesFromImap: async ({ limit }) => {
      requestedLimits.push(limit);
      return withSyncReadHealth(Array.from({ length: providerCount }, (_item, index) => ({
        uid: index + 1, id: `inbox:${index + 1}`,
      })));
    },
  });

  const twenty = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true,
  });
  providerCount = 21;
  const twentyOne = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true,
  });

  assert.deepEqual(requestedLimits, [21, 21]);
  assert.equal(twenty.complete, true);
  assert.equal(twenty.freshnessConfirmed, true);
  assert.equal(twentyOne.ok, true);
  assert.equal(twentyOne.complete, false);
  assert.equal(twentyOne.freshnessConfirmed, false);
  assert.equal(twentyOne.partial, true);
  assert.equal(twentyOne.truncated, true);
  assert.equal(twentyOne.code, 'MAILBOX_SYNC_FETCH_TRUNCATED');
  assert.equal(twentyOne.upserted, 21);
  assert.equal(finishCalls[0].error, undefined);
  assert.match(finishCalls[1].error, /fetchlimiet/i);
});

test('fast refresh forwards the durable UID frontier and advances it only after completeness', async () => {
  const fetches = [];
  const finishes = [];
  const service = createService({
    mailboxIndexStore: {
      getSyncState: async () => ({ last_uid: 100, uid_validity: 777 }),
      listMessageUidsForAccount: async () => [98, 99, 100],
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
      finishSync: async (options) => { finishes.push(options); return { ok: true }; },
    },
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      return withSyncReadHealth([{ uid: 101, id: 'inbox:101' }], {
        frontierMode: true,
        frontierAfterUid: 100,
        frontierProviderNewestUid: 101,
      });
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true,
  });

  assert.equal(result.complete, true);
  assert.equal(result.freshnessConfirmed, true);
  assert.equal(fetches[0].incrementalAfterUid, 100);
  assert.equal(fetches[0].incrementalUidValidity, 777);
  assert.deepEqual(fetches[0].indexedUids, [98, 99, 100]);
  assert.equal(finishes[0].lastUid, 101);
});

test('fast refresh rebuilds a legacy zero cursor from all active indexed UIDs', async () => {
  const fetches = [];
  const finishes = [];
  let indexedSince = 'not-called';
  const service = createService({
    mailboxIndexStore: {
      getSyncState: async () => ({
        last_uid: 0,
        uid_validity: 777,
        last_synced_at: '2026-08-10T13:15:51.012Z',
      }),
      listMessageUidSyncStateForAccount: async (options) => {
        indexedSince = options.since;
        return {
          indexedUids: [30, 50],
          deferredQuarantineUids: [],
          retryDueQuarantineUids: [],
        };
      },
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
      finishSync: async (options) => { finishes.push(options); return { ok: true }; },
    },
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      return withSyncReadHealth([], {
        frontierMode: true,
        frontierAfterUid: 50,
        frontierProviderNewestUid: 50,
      });
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true,
  });

  assert.equal(result.complete, true);
  assert.equal(indexedSince, '');
  assert.equal(fetches[0].incrementalAfterUid, 50);
  assert.equal(fetches[0].incrementalUidValidity, 777);
  assert.equal(finishes[0].lastUid, 50);
});

test('fast refresh never invents a zero cursor without a prior successful sync', async () => {
  const fetches = [];
  const service = createService({
    mailboxIndexStore: {
      getSyncState: async () => ({ last_uid: 0, uid_validity: 777, last_synced_at: null }),
      listMessageUidSyncStateForAccount: async () => ({
        indexedUids: [50], deferredQuarantineUids: [], retryDueQuarantineUids: [],
      }),
    },
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      return withSyncReadHealth([]);
    },
  });

  await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true,
  });

  assert.equal(fetches[0].incrementalAfterUid, 0);
});

test('successful empty sync preserves an existing durable UID high-water mark', async () => {
  const updates = [];
  const store = require('../../server/services/mailbox-sync-runtime').createMailboxSyncStateStore({
    run: async (_label, operation) => operation({
      from() {
        return {
          update(patch) {
            updates.push(patch);
            return {
              eq() { return this; },
              select: async () => ({ data: [{ sync_key: 'serve@softora.nl|inbox' }], error: null }),
            };
          },
        };
      },
    }).then((result) => ({ ok: true, data: result.data })),
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, length) => String(value || '').slice(0, length),
    now: () => new Date('2026-08-10T18:00:00.000Z'),
    tableName: 'softora_mailbox_sync_state',
  });

  const result = await store.finishSync({
    accountEmail: 'serve@softora.nl', folder: 'inbox', lockToken: 'lock',
    messageCount: 0, lastUid: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0], 'last_uid'), false);
});

test('ordinary IMAP sync verwerkt 31 berichten over twee runs en noemt de eerste nooit vers', async () => {
  const allUids = Array.from({ length: 31 }, (_item, index) => index + 1);
  const indexed = new Set();
  const indexedUidReads = [];
  const service = createService({
    mailboxIndexStore: {
      listMessageUidsForAccount: async () => {
        const current = Array.from(indexed);
        indexedUidReads.push(current);
        return current;
      },
      upsertMessages: async ({ messages }) => {
        messages.forEach((message) => indexed.add(message.uid));
        return { ok: true, upserted: messages.length };
      },
    },
    fetchMessagesFromImap: async ({ indexedUids, limit }) => {
      const selected = selectMailboxSyncUids({ allUids, indexedUids, limit });
      const messages = selected.map((uid) => ({ uid, id: `inbox:${uid}` }));
      Object.defineProperty(messages, 'syncReadHealth', {
        value: {
          uidValidity: 777,
          parseFailures: [],
          selectedUids: selected,
          yieldedUids: selected,
          missingUids: [],
          selectedCount: selected.length,
          yieldedCount: selected.length,
          folderMissing: false,
          ...selected.syncSelectionHealth,
          selectionTruncated: selected.syncSelectionHealth.truncated,
        },
      });
      return messages;
    },
  });

  const first = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', limit: 30,
  });
  const second = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', limit: 30,
  });

  assert.equal(first.complete, false);
  assert.equal(first.freshnessConfirmed, false);
  assert.equal(first.code, 'MAILBOX_SYNC_SELECTION_TRUNCATED');
  assert.equal(first.remainingUidCount, 1);
  assert.equal(second.complete, true);
  assert.equal(second.freshnessConfirmed, true);
  assert.equal(second.synced, 1);
  assert.equal(indexed.size, 31);
  assert.deepEqual(indexedUidReads.map((uids) => uids.length), [0, 30]);
});

test('snapshot invalidation failure prevents freshness confirmation after an index upsert', async () => {
  const finishCalls = [];
  const service = createService({
    mailboxIndexStore: {
      upsertMessages: async () => ({ ok: true, upserted: 1 }),
      finishSync: async (input) => {
        finishCalls.push(input);
        return { ok: true };
      },
    },
    fetchMessagesFromImap: async () => withSyncReadHealth([{ uid: 91, id: 'inbox:91' }]),
    invalidateCampaignSnapshot: async () => ({ ok: false }),
  });

  const result = await service.syncMailbox({ folders: ['inbox'], campaignOnly: true });
  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.results[0].code, 'MAILBOX_SNAPSHOT_INVALIDATION_FAILED');
  assert.match(String(finishCalls[0].error), /invalidatie mislukt/i);
});

test('a lost finish token is a hard sync failure', async () => {
  const lockLostError = new Error('lock lost');
  lockLostError.code = 'MAILBOX_SYNC_LOCK_LOST';
  const service = createService({
    mailboxIndexStore: {
      finishSync: async () => ({ ok: false, lockLost: true, error: lockLostError }),
    },
  });

  const result = await service.syncMailbox({ folders: ['inbox'] });
  assert.equal(result.ok, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.results[0].lockLost, true);
  assert.equal(result.results[0].code, 'MAILBOX_SYNC_LOCK_LOST');
});

test('an uncertain index write never finishes its lease or claims mailbox freshness', async () => {
  const finishCalls = [];
  const unknownOutcome = new Error('database-uitkomst onbekend');
  unknownOutcome.code = 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN';
  unknownOutcome.leaveMutationPending = true;
  const service = createService({
    mailboxIndexStore: {
      upsertMessages: async () => ({ ok: false, error: unknownOutcome }),
      finishSync: async (input) => {
        finishCalls.push(input);
        return { ok: true };
      },
    },
    fetchMessagesFromImap: async () => withSyncReadHealth([{ uid: 91, id: 'inbox:91' }]),
  });

  const result = await service.syncMailbox({ folders: ['inbox'] });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.results[0].uncertain, true);
  assert.equal(result.results[0].code, 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN');
  assert.deepEqual(finishCalls, []);
});

test('run deadlines abort active folder work and report a total timeout as 504', async () => {
  let aborted = false;
  const service = createService({
    fetchMessagesFromImap: async ({ signal }) => new Promise((resolve, reject) => {
      const handleAbort = () => {
        aborted = true;
        reject(signal.reason);
      };
      if (signal.aborted) handleAbort();
      else signal.addEventListener('abort', handleAbort, { once: true });
    }),
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    deadlineAt: Date.now() + 20,
    folderTimeoutMs: 10_000,
  });
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.statusCode, 504);
  assert.equal(result.summary.timedOut, 1);
  assert.equal(result.results[0].code, 'MAILBOX_SYNC_RUN_TIMEOUT');
});

test('an already expired run deadline starts no lock or provider work', async () => {
  let lockCalls = 0;
  let providerCalls = 0;
  const service = createService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockCalls += 1;
        return { ok: true, lockToken: 'must-not-be-used' };
      },
    },
    fetchMessagesFromImap: async () => {
      providerCalls += 1;
      return withSyncReadHealth([]);
    },
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    deadlineAt: Date.now() - 1,
  });
  assert.equal(result.statusCode, 504);
  assert.equal(lockCalls, 0);
  assert.equal(providerCalls, 0);
});

test('HTTP sync contracts preserve accepted, partial, unavailable and timeout outcomes', () => {
  assert.equal(getMailboxSyncResponseStatus({ ok: true, complete: true, statusCode: 200 }), 200);
  assert.equal(getMailboxSyncResponseStatus({ ok: true, accepted: true, statusCode: 202 }), 202);
  assert.equal(getMailboxSyncResponseStatus({ ok: false, complete: false, statusCode: 207 }), 207);
  assert.equal(getMailboxSyncResponseStatus({ ok: false, statusCode: 503 }), 503);
  assert.equal(getMailboxSyncResponseStatus({ ok: false, statusCode: 504 }), 504);
});

test('an empty IMAP target set can never claim complete freshness', () => {
  const result = summarizeMailboxSyncResults([]);
  assert.equal(result.ok, true);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.statusCode, 207);
  assert.equal(result.summary.total, 0);
});

test('a 92-of-113 sync is reported honestly as partial without dropping successful accounts', async () => {
  const accounts = Array.from({ length: 113 }, (_, index) => createAccount(`account${index}@softora.nl`));
  const successfulAccounts = new Set(accounts.slice(0, 92).map((account) => account.email));
  const service = createService({
    accounts,
    fetchMessagesFromImap: async ({ account }) => {
      if (!successfulAccounts.has(account.email)) throw new Error('tijdelijke accountfout');
      return withSyncReadHealth([]);
    },
  });

  const result = await service.syncMailbox({ folders: ['inbox'] });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.statusCode, 207);
  assert.deepEqual(result.summary, {
    total: 113,
    succeeded: 92,
    locked: 0,
    failed: 21,
    timedOut: 0,
    skipped: 0,
  });
});

test('one timed-out account cannot block another account from being indexed', async () => {
  const accounts = [createAccount('slow@softora.nl'), createAccount('healthy@softora.nl')];
  const upsertedAccounts = [];
  const service = createService({
    accounts,
    mailboxIndexStore: {
      upsertMessages: async ({ accountEmail }) => {
        upsertedAccounts.push(accountEmail);
        return { ok: true, upserted: 1 };
      },
    },
    fetchMessagesFromImap: async ({ account, signal }) => {
      if (account.email === 'healthy@softora.nl') {
        return withSyncReadHealth([{ uid: 7, id: 'inbox:7' }]);
      }
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    deadlineAt: Date.now() + 25,
    folderTimeoutMs: 10_000,
  });

  assert.deepEqual(upsertedAccounts, ['healthy@softora.nl']);
  assert.equal(result.statusCode, 207);
  assert.equal(result.summary.succeeded, 1);
  assert.equal(result.summary.timedOut, 1);
});

test('deadline aborts an in-flight index write and prevents late invalidation or success', async () => {
  let lateWrites = 0;
  let invalidations = 0;
  let successFinishes = 0;
  const service = createService({
    mailboxIndexStore: {
      upsertMessages: ({ signal }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          lateWrites += 1;
          resolve({ ok: true, upserted: 1 });
        }, 80);
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }),
      finishSync: async (input) => {
        if (!input.error) successFinishes += 1;
        return { ok: true };
      },
    },
    fetchMessagesFromImap: async () => withSyncReadHealth([{ uid: 91, id: 'inbox:91' }]),
    invalidateCampaignSnapshot: async () => {
      invalidations += 1;
      return { ok: true };
    },
  });

  const result = await service.syncMailbox({
    folders: ['inbox'],
    campaignOnly: true,
    deadlineAt: Date.now() + 20,
    folderTimeoutMs: 10_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(result.statusCode, 504);
  assert.equal(lateWrites, 0);
  assert.equal(invalidations, 0);
  assert.equal(successFinishes, 0);
});

test('IMAP abort listener stays active while logout is still pending', async () => {
  const controller = new AbortController();
  let closeCalls = 0;
  let rejectLogout;
  let startLogout;
  const logoutStarted = new Promise((resolve) => { startLogout = resolve; });
  const client = {
    usable: true,
    close() {
      closeCalls += 1;
      this.usable = false;
      rejectLogout?.(new Error('socket closed'));
    },
    async logout() {
      startLogout();
      return new Promise((_resolve, reject) => { rejectLogout = reject; });
    },
  };
  const session = createMailboxImapSyncSession({ client, signal: controller.signal });
  const running = session.run(async () => 'done');
  await logoutStarted;
  const reason = Object.assign(new Error('logout deadline'), {
    code: 'MAILBOX_SYNC_FOLDER_TIMEOUT', timedOut: true,
  });
  controller.abort(reason);

  await assert.rejects(Promise.race([
    running,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('logout bleef hangen')), 50)),
  ]), (error) => error === reason);
  assert.equal(closeCalls, 1);
});
