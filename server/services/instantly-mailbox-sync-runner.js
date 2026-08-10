const { buildRecentSyncResult } = require('./instantly-mailbox-sync-cadence');
const {
  extendMinTimestamp,
  prepareInstantlySendReconciliation,
  reconcileInstantlySends,
  reconciliationHealth,
} = require('./instantly-mailbox-send-reconciliation');
const { buildRejectedItem, mergeQuarantine } = require('./instantly-mailbox-quarantine');
const {
  extractInstantlyCursor,
  extractInstantlyItems,
  parseInstantlyEmailListResponse,
} = require('./instantly-mailbox-provider-api');
const {
  readInstantlyOwnerSyncState,
  writeInstantlyOwnerSyncState,
} = require('./instantly-mailbox-sync-state');

const MAX_QUARANTINE_RETRIES_PER_RUN = 3;
const SYNC_LOCK_RETRY_BASE_MS = 75;
const SYNC_LOCK_RETRY_MAX_MS = 500;
const SYNC_LOCK_RETRY_DEADLINE_MS = 10_000;

function normalizeText(value) {
  return String(value || '').trim();
}

function groupMessagesByAccount(messages = []) {
  const groups = new Map();
  for (const message of messages) {
    const accountEmail = normalizeText(message?.providerAccountEmail).toLowerCase();
    if (!accountEmail) {
      const error = new Error('Genormaliseerd Instantly-bericht mist het exacte provideraccount.');
      error.code = 'INSTANTLY_MESSAGE_ACCOUNT_MISSING';
      error.status = 503;
      throw error;
    }
    if (!groups.has(accountEmail)) groups.set(accountEmail, []);
    groups.get(accountEmail).push(message);
  }
  return Array.from(groups.entries()).map(([accountEmail, accountMessages]) => ({
    accountEmail,
    messages: accountMessages,
  }));
}

function waitForLockRetry(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(1, Number(delayMs) || 1));
  });
}

function createInstantlyMailboxSyncRunner({
  accountOwnership,
  apiRequest,
  assertConfigured,
  assertOwner,
  auditThreadCandidates,
  createError,
  getConfiguredAccounts,
  getSyncStateKey,
  getUiStateValues,
  logger = console,
  mailboxIndexStore,
  mailboxSendProvenanceStore,
  normalizeInstantlyMessage,
  normalizedConfig,
  now,
  setUiStateValues,
  throwStoreFailure,
  upsertMessages,
}) {
  const syncPromiseByOwner = new Map();

  function assertStoreAvailable() {
    const requiredMethods = ['acquireSyncLock', 'finishSync', 'getSyncState', 'upsertProviderMessages'];
    if (requiredMethods.every((method) => typeof mailboxIndexStore?.[method] === 'function')) return;
    throw createError(
      'Duurzame Instantly-mailboxopslag is niet beschikbaar.',
      'INSTANTLY_MAILBOX_STORE_UNAVAILABLE',
      503
    );
  }

  async function persistMessages(messages, configuredAccounts) {
    let stored = 0;
    for (const group of groupMessagesByAccount(messages)) {
      if (!configuredAccounts.has(group.accountEmail)) {
        throw createError(
          'Instantly-paginagroep hoort niet bij het geselecteerde owneraccount.',
          'INSTANTLY_ACCOUNT_GROUP_OWNER_DRIFT',
          503
        );
      }
      const upsert = await upsertMessages.runMutationLifecycle({
        accountEmail: group.accountEmail,
      }, async (mutationContext) => {
        const result = await upsertMessages(group.messages, mutationContext);
        if (!result?.ok) {
          throwStoreFailure(
            result,
            'Instantly-berichten konden niet duurzaam worden opgeslagen.',
            'INSTANTLY_MAILBOX_STORE_FAILED'
          );
        }
        return result;
      });
      stored += Number(upsert?.upserted) || 0;
    }
    return stored;
  }

  async function fetchPage({ accounts, cursor = '', minTimestamp, maxTimestamp = '' }) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const data = await apiRequest('emails', {
      ...(controller ? { signal: controller.signal } : {}),
      query: {
        limit: normalizedConfig.pageLimit,
        starting_after: cursor,
        eaccount: accounts.map((account) => account.email).join(','),
        min_timestamp_created: minTimestamp,
        max_timestamp_created: maxTimestamp,
        sort_order: 'desc',
      },
    });
    return parseInstantlyEmailListResponse(data, createError);
  }

  async function processPage({ accounts, owner, cursor, minTimestamp, maxTimestamp, at }) {
    const page = await fetchPage({ accounts, cursor, minTimestamp, maxTimestamp });
    const messages = [];
    const rejected = [];
    for (const rawMessage of page.items) {
      const message = normalizeInstantlyMessage(rawMessage);
      if (message && message.providerOwner === owner) messages.push(message);
      else rejected.push(buildRejectedItem(rawMessage, at));
    }
    const configuredAccounts = new Set(accounts.map((account) => account.email));
    const stored = await persistMessages(messages, configuredAccounts);
    return {
      seen: page.items.length,
      stored,
      messages,
      rejected,
      nextCursor: page.nextCursor,
    };
  }

  async function retryQuarantined({ state, accounts, owner, at }) {
    const nowMs = Date.parse(at);
    const due = state.quarantine
      .filter((item) => item.providerMessageId && Date.parse(item.nextRetryAt) <= nowMs)
      .slice(0, MAX_QUARANTINE_RETRIES_PER_RUN);
    if (!due.length) return { stored: 0, recovered: 0 };
    const recovered = new Set();
    let stored = 0;
    for (const item of due) {
      let rawMessage = null;
      try {
        rawMessage = await apiRequest(`emails/${encodeURIComponent(item.providerMessageId)}`);
      } catch (_) {
        state.quarantine = mergeQuarantine(state.quarantine, [{ ...item }], at);
        continue;
      }
      const message = normalizeInstantlyMessage(rawMessage);
      if (!message || message.providerOwner !== owner) {
        state.quarantine = mergeQuarantine(state.quarantine, [{ ...item }], at);
        continue;
      }
      stored += await persistMessages(
        [message],
        new Set(accounts.map((account) => account.email))
      );
      recovered.add(item.identity);
    }
    state.quarantine = state.quarantine.filter((item) => !recovered.has(item.identity));
    return { stored, recovered: recovered.size };
  }

  function captureThreadCandidates(threadCandidates, messages) {
    messages
      .filter((message) => message.folder !== 'sent' && message.providerThreadId)
      .forEach((message) => {
        const key = `${message.providerAccountEmail}|${message.providerThreadId}`;
        if (!threadCandidates.has(key)) threadCandidates.set(key, message);
      });
  }

  async function finishFailedSync({ syncKey, lockToken, error }) {
    if (!lockToken) return;
    try {
      await mailboxIndexStore.finishSync({
        accountEmail: syncKey,
        folder: 'instantly',
        lockToken,
        error: error?.message || error,
      });
    } catch (_) {
      // The lease expires by itself; never mask the primary sync failure.
    }
  }

  async function runOwnerSync(owner, accounts, options) {
    const syncKey = getSyncStateKey(owner);
    const initialState = await mailboxIndexStore.getSyncState({
      accountEmail: syncKey,
      folder: 'instantly',
    });
    let reconciliation = await prepareInstantlySendReconciliation({
      store: mailboxSendProvenanceStore,
      accounts,
      logger,
    });
    const recentSync = buildRecentSyncResult({
      state: initialState,
      owner,
      accounts,
      minIntervalMs: options.minIntervalMs,
      nowMs: now().getTime(),
    });
    if (recentSync && !reconciliation.degraded && reconciliation.intents.length === 0) {
      return { ...recentSync, ...reconciliationHealth(reconciliation) };
    }

    const lockDeadlineAt = Date.now() + SYNC_LOCK_RETRY_DEADLINE_MS;
    let lock = null;
    let lockAttempts = 0;
    while (true) {
      lockAttempts += 1;
      lock = await mailboxIndexStore.acquireSyncLock({
        accountEmail: syncKey,
        folder: 'instantly',
        lockTtlMs: 120_000,
      });
      if (lock?.ok) break;
      if (!lock?.locked) {
        throw createError(
          'Instantly-sync kon geen duurzame lock verkrijgen.',
          'INSTANTLY_SYNC_LOCK_FAILED',
          503
        );
      }
      if (lock.lockReason === 'active_target' || lock.lockExpiresAt) {
        return {
          ok: true,
          complete: false,
          freshnessConfirmed: false,
          owner,
          accounts: accounts.map((account) => account.email),
          seen: 0,
          stored: 0,
          pages: 0,
          skipped: true,
          reason: 'sync-in-progress',
          partial: true,
          degraded: reconciliation.degraded || reconciliation.intents.length > 0,
          ...reconciliationHealth(reconciliation),
          lockReason: 'active_target',
          retryAt: lock.lockExpiresAt || null,
          retryAfterMs: Math.max(
            1,
            Math.min(300_000, Date.parse(lock.lockExpiresAt || '') - Date.now() || 1)
          ),
          lockAttempts,
        };
      }
      const retryDelayMs = Math.min(
        SYNC_LOCK_RETRY_MAX_MS,
        SYNC_LOCK_RETRY_BASE_MS * (2 ** Math.min(4, lockAttempts - 1))
      );
      if (Date.now() + retryDelayMs >= lockDeadlineAt) {
        const error = createError(
          'Instantly-sync kreeg vóór de deadline geen globale leasecapaciteit.',
          'INSTANTLY_SYNC_GLOBAL_CAP_TIMEOUT',
          504
        );
        error.lockReason = 'global_capacity';
        error.retryAfterMs = retryDelayMs;
        error.lockAttempts = lockAttempts;
        throw error;
      }
      await waitForLockRetry(retryDelayMs);
    }
    const lockToken = normalizeText(lock.lockToken);
    let lockHeld = true;
    try {
      const durableState = await readInstantlyOwnerSyncState({
        owner,
        getUiStateValues,
        createError,
      });
      const runStartedAt = now().toISOString();
      const runStartedMs = Date.parse(runStartedAt);
      const lastSyncedAt = Date.parse(normalizeText(initialState?.last_synced_at));
      const fallbackSince = runStartedMs
        - normalizedConfig.initialLookbackDays * 24 * 60 * 60 * 1000;
      const overlapMs = normalizedConfig.syncOverlapMinutes * 60 * 1000;
      const calculatedMinTimestamp = new Date(
        Math.max(fallbackSince, Number.isFinite(lastSyncedAt) ? lastSyncedAt - overlapMs : fallbackSince)
      ).toISOString();
      const minTimestamp = extendMinTimestamp(
        calculatedMinTimestamp,
        calculatedMinTimestamp,
        reconciliation.intents
      );
      let seen = 0;
      let stored = 0;
      let pages = 0;
      const threadCandidates = new Map();

      const head = await processPage({
        accounts,
        owner,
        cursor: '',
        minTimestamp,
        maxTimestamp: runStartedAt,
        at: runStartedAt,
      });
      seen += head.seen;
      stored += head.stored;
      pages += 1;
      captureThreadCandidates(threadCandidates, head.messages);
      durableState.quarantine = mergeQuarantine(
        durableState.quarantine,
        head.rejected,
        runStartedAt
      );
      let newestSegment = -1;
      if (head.nextCursor) {
        durableState.segments.push({
          cursor: head.nextCursor,
          minTimestamp,
          maxTimestamp: runStartedAt,
          scanStartedAt: runStartedAt,
        });
        newestSegment = durableState.segments.length - 1;
      }

      while (pages < normalizedConfig.maxPages && durableState.segments.length) {
        const segmentIndex = newestSegment >= 0
          ? Math.min(newestSegment, durableState.segments.length - 1)
          : 0;
        newestSegment = -1;
        const segment = durableState.segments[segmentIndex];
        const page = await processPage({
          accounts,
          owner,
          cursor: segment.cursor,
          minTimestamp: segment.minTimestamp,
          maxTimestamp: segment.maxTimestamp,
          at: runStartedAt,
        });
        seen += page.seen;
        stored += page.stored;
        pages += 1;
        captureThreadCandidates(threadCandidates, page.messages);
        durableState.quarantine = mergeQuarantine(
          durableState.quarantine,
          page.rejected,
          runStartedAt
        );
        if (page.nextCursor) durableState.segments[segmentIndex].cursor = page.nextCursor;
        else durableState.segments.splice(segmentIndex, 1);
      }

      const retried = await retryQuarantined({
        state: durableState,
        accounts,
        owner,
        at: runStartedAt,
      });
      stored += retried.stored;
      reconciliation = await reconcileInstantlySends({
        state: reconciliation,
        store: mailboxSendProvenanceStore,
        owner,
        accountOwnership,
        apiRequest,
        normalizeMessage: normalizeInstantlyMessage,
        extractItems: extractInstantlyItems,
        extractCursor: extractInstantlyCursor,
        upsertMessages: async (messages) => ({
          ok: true,
          upserted: await persistMessages(
            messages,
            new Set(accounts.map((account) => account.email))
          ),
        }),
        throwStoreFailure,
        pageLimit: normalizedConfig.pageLimit,
        maxPages: normalizedConfig.maxPages,
        normalPageCount: pages,
        logger,
        nowMs: () => now().getTime(),
      });
      stored += Number(reconciliation.stored) || 0;
      seen += Number(reconciliation.seen) || 0;
      await writeInstantlyOwnerSyncState({
        owner,
        state: durableState,
        setUiStateValues,
        createError,
      });
      const syncWarnings = [
        durableState.segments.length
          ? `INSTANTLY_BACKLOG_SEGMENTS:${durableState.segments.length}`
          : '',
        durableState.quarantine.length
          ? `INSTANTLY_ITEMS_QUARANTINED:${durableState.quarantine.length}`
          : '',
        reconciliation.intents.length
          ? `INSTANTLY_SEND_RECONCILE_PENDING:${reconciliation.intents.length}`
          : '',
        reconciliation.degraded ? 'INSTANTLY_SEND_RECONCILE_DEGRADED' : '',
        reconciliation.providerRequestBudgetExhausted
          ? 'INSTANTLY_PROVIDER_REQUEST_BUDGET_EXHAUSTED'
          : '',
      ].filter(Boolean);
      const finish = await mailboxIndexStore.finishSync({
        accountEmail: syncKey,
        folder: 'instantly',
        lockToken,
        messageCount: stored,
        warning: syncWarnings.join(';'),
        syncedThroughAt: runStartedAt,
      });
      if (!finish?.ok) {
        throw finish?.error || createError(
          'Instantly-sync kon zijn duurzame eindstatus niet vastleggen.',
          'INSTANTLY_SYNC_FINISH_FAILED',
          503
        );
      }
      lockHeld = false;

      let auditStored = 0;
      let auditError = '';
      try {
        const auditResult = await auditThreadCandidates({
          accounts,
          owner,
          threadCandidates,
          maxHydrations: reconciliation.requestsRemaining,
        });
        auditStored = Number(auditResult?.stored ?? auditResult) || 0;
        reconciliation.requestsRemaining = Math.max(
          0,
          Number(reconciliation.requestsRemaining) - (Number(auditResult?.requestsUsed) || 0)
        );
        if (auditResult?.providerRequestBudgetExhausted === true) {
          reconciliation.providerRequestBudgetExhausted = true;
        }
      } catch (error) {
        if (
          error?.leaveMutationPending === true ||
          normalizeText(error?.code) === 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN'
        ) {
          throw error;
        }
        auditError = normalizeText(error?.message || error);
      }
      const reconciliationIncomplete = Boolean(
        reconciliation.degraded ||
        reconciliation.providerRequestBudgetExhausted ||
        reconciliation.intents.length > 0
      );
      return {
        ok: true,
        complete:
          durableState.segments.length === 0 &&
          durableState.quarantine.length === 0 &&
          !reconciliationIncomplete,
        freshnessConfirmed:
          durableState.segments.length === 0 &&
          durableState.quarantine.length === 0 &&
          !auditError &&
          !reconciliationIncomplete,
        headFreshnessConfirmed: true,
        owner,
        accounts: accounts.map((account) => account.email),
        seen,
        stored: stored + auditStored,
        reconciled: Number(reconciliation.reconciled) || 0,
        ...reconciliationHealth(reconciliation),
        providerRequestBudgetExhausted: reconciliation.providerRequestBudgetExhausted,
        pages,
        partial:
          durableState.segments.length > 0 ||
          durableState.quarantine.length > 0 ||
          reconciliationIncomplete,
        backlogSegments: durableState.segments.length,
        quarantined: durableState.quarantine.length,
        recoveredFromQuarantine: retried.recovered,
        lockAttempts,
        degraded:
          durableState.quarantine.length > 0 ||
          Boolean(auditError) ||
          reconciliationIncomplete,
        ...(auditError ? { warning: 'Instantly-threadverrijking is tijdelijk mislukt.' } : {}),
        syncedAt: runStartedAt,
      };
    } catch (error) {
      if (lockHeld && error?.leaveMutationPending !== true) {
        await finishFailedSync({ syncKey, lockToken, error });
      }
      throw error;
    }
  }

  return async function syncOwner(owner, options = {}) {
    const selectedOwner = assertOwner(owner);
    assertConfigured();
    assertStoreAvailable();
    if (syncPromiseByOwner.has(selectedOwner)) return syncPromiseByOwner.get(selectedOwner);
    const promise = (async () => {
      const accounts = getConfiguredAccounts(selectedOwner);
      if (!accounts.length) {
        throw createError(
          `Er zijn geen Instantly-accounts aan ${selectedOwner} gekoppeld.`,
          'INSTANTLY_OWNER_HAS_NO_ACCOUNTS',
          409
        );
      }
      return runOwnerSync(selectedOwner, accounts, options);
    })().finally(() => {
      syncPromiseByOwner.delete(selectedOwner);
    });
    syncPromiseByOwner.set(selectedOwner, promise);
    return promise;
  };
}

module.exports = {
  createInstantlyMailboxSyncRunner,
  groupMessagesByAccount,
};
