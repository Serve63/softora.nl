const { findExactInstantlySendReconciliation } = require('./mailbox-send-provenance-store');

const text = (value) => String(value || '').trim();
const email = (value) => text(value).toLowerCase();

async function prepareInstantlySendReconciliation({ store, accounts, logger = console }) {
  const state = { checked: false, degraded: false, intents: [], reapedUndispatched: 0 };
  if (!store) return state;
  if (typeof store.listReconcileRequired !== 'function') return { ...state, degraded: true };
  try {
    const accountEmails = accounts.map((account) => account.email);
    const expired = typeof store.listExpiredUndispatched === 'function' &&
      typeof store.abandonUndispatched === 'function'
      ? await store.listExpiredUndispatched({ accountEmails, limit: 25 })
      : [];
    for (const intent of expired.filter((candidate) => candidate.provider === 'instantly')) {
      const abandoned = await store.abandonUndispatched(intent.intentId);
      if (abandoned?.abandoned) state.reapedUndispatched += 1;
    }
    state.intents = await store.listReconcileRequired({
      accountEmails, provider: 'instantly', limit: 25,
    });
    state.checked = true;
  } catch (error) {
    state.degraded = true;
    logger.error('[InstantlyMailbox][ReconcileList]', error?.message || error);
  }
  return state;
}

function extendMinTimestamp(calculatedMinTimestamp, continuationMinTimestamp, intents = []) {
  const continued = continuationMinTimestamp || calculatedMinTimestamp;
  const requestedSince = Date.parse(continued);
  const reconcileSince = intents.reduce((earliest, intent) => {
    const createdAt = Date.parse(intent.createdAt);
    return Number.isFinite(createdAt) ? Math.min(earliest, createdAt - 120_000) : earliest;
  }, Number.POSITIVE_INFINITY);
  return new Date(Math.min(
    Number.isFinite(requestedSince) ? requestedSince : Date.parse(calculatedMinTimestamp), reconcileSince
  )).toISOString();
}

function reconciliationHealth(state) {
  return {
    reconciliationChecked: state.checked,
    reconciliationDegraded: state.degraded,
    remainingReconcileCount: state.checked ? state.intents.length : null,
    ...(Number(state.reapedUndispatched) > 0
      ? { reapedUndispatchedSendCount: Number(state.reapedUndispatched) } : {}),
  };
}

async function reconcileInstantlySends(options = {}) {
  const {
    state, owner, accountOwnership, apiRequest, normalizeMessage, extractItems, extractCursor,
    upsertMessages, throwStoreFailure, pageLimit, maxPages, normalPageCount, logger = console,
    nowMs = () => Date.now(),
  } = options;
  let intents = state.intents.slice();
  let degraded = state.degraded;
  let requestsRemaining = Math.max(0, 20 - normalPageCount);
  let budgetExhausted = false;
  let stored = 0;
  let seen = 0;
  let reconciled = 0;
  const deadlineAt = nowMs() + 20_000;
  const hydrated = new Set();
  const complete = new Set();
  const messagesByThread = new Map();
  for (const intent of intents.slice()) {
    const accountEmail = email(intent.accountEmail);
    const threadId = text(intent.providerThreadId);
    const threadKey = `${accountEmail}|${threadId}`;
    if (accountOwnership.get(accountEmail)?.owner !== owner || !threadId) continue;
    if (nowMs() >= deadlineAt) { degraded = true; break; }
    try {
      if (!hydrated.has(threadKey)) {
        hydrated.add(threadKey);
        let cursor = '';
        let page = 0;
        let fetched = false;
        do {
          if (requestsRemaining <= 0) { budgetExhausted = true; break; }
          requestsRemaining -= 1;
          const data = await apiRequest('emails', {
            signal: AbortSignal.timeout(Math.max(1, deadlineAt - nowMs())),
            query: {
              limit: pageLimit, starting_after: cursor, eaccount: accountEmail,
              search: `thread:${threadId}`, sort_order: 'asc',
            },
          });
          fetched = true;
          const rawItems = extractItems(data);
          const messages = rawItems.map(normalizeMessage).filter((message) => (
            message && message.providerOwner === owner && message.providerAccountEmail === accountEmail &&
            message.providerThreadId === threadId
          ));
          if (messages.length) {
            const upsert = await upsertMessages(messages);
            if (!upsert?.ok) throwStoreFailure(
              upsert, 'Instantly-reconcilethread kon niet duurzaam worden opgeslagen.',
              'INSTANTLY_RECONCILE_STORE_FAILED'
            );
            stored += Number(upsert.upserted) || 0;
            const byId = messagesByThread.get(threadKey) || new Map();
            messages.forEach((message) => byId.set(message.providerMessageId, message));
            messagesByThread.set(threadKey, byId);
          }
          seen += rawItems.length;
          cursor = extractCursor(data);
          page += 1;
        } while (cursor && page < maxPages && requestsRemaining > 0 && nowMs() < deadlineAt);
        if (cursor && requestsRemaining <= 0) budgetExhausted = true;
        if (fetched && !cursor) complete.add(threadKey);
      }
      if (!complete.has(threadKey)) continue;
      const match = findExactInstantlySendReconciliation(
        intent, Array.from(messagesByThread.get(threadKey)?.values() || [])
      );
      if (!match) continue;
      await options.store.accept(intent.intentId, {
        messageId: match.messageId, providerMessageId: match.providerMessageId,
        providerThreadId: match.providerThreadId, acceptedAt: match.providerCreatedAt,
        storageDegraded: false, reconcileRequired: false,
      });
      intents = intents.filter((candidate) => candidate.intentId !== intent.intentId);
      reconciled += 1;
    } catch (error) {
      degraded = true;
      logger.error('[InstantlyMailbox][Reconcile]', error?.message || error);
    }
  }
  return {
    checked: state.checked, degraded, intents, requestsRemaining,
    providerRequestBudgetExhausted: budgetExhausted, stored, seen, reconciled,
  };
}

module.exports = {
  extendMinTimestamp, prepareInstantlySendReconciliation,
  reconcileInstantlySends, reconciliationHealth,
};
