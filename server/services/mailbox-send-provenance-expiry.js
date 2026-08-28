const MAILBOX_EXPIRE_RESERVED_PRE_DISPATCH_RPC = 'softora_expire_mailbox_reserved_dispatch';
const MAILBOX_EXPIRE_STARTED_PRE_DISPATCH_RPC = 'softora_expire_mailbox_started_dispatch';
const RESERVED_EXPIRY_ERROR = 'De pre-dispatchreservering verliep voordat de provider werd gestart.';
const STARTED_EXPIRY_ERROR = 'De dispatchlease is verlopen; de provideruitkomst moet eerst worden gereconcilieerd.';

function createMailboxSendProvenanceExpiry(deps = {}) {
  const {
    createRequiredTransitionToken,
    createUpdateError,
    findByIntentId,
    firstRpcRow,
    normalizeRow,
    runCriticalQuery,
    sameTimestamp,
  } = deps;

  function expiredReservedTransitionMatches(intent, sourceIntent, transitionToken) {
    return intent?.intentId === sourceIntent?.intentId
      && intent?.status === 'failed'
      && intent?.dispatchState === 'finished'
      && !intent?.dispatchLeaseExpiresAt
      && intent?.reconcileRequired === false
      && intent?.sentReconcileRequired === false
      && intent?.error === RESERVED_EXPIRY_ERROR
      && intent?.transitionToken === transitionToken
      && intent?.transitionToken !== sourceIntent?.transitionToken
      && intent?.preDispatchClaimFingerprint === sourceIntent?.preDispatchClaimFingerprint
      && sameTimestamp(intent?.preDispatchFinalizedAt, sourceIntent?.preDispatchFinalizedAt);
  }

  function expiredStartedTransitionMatches(intent, sourceIntent, transitionToken) {
    return intent?.intentId === sourceIntent?.intentId
      && intent?.status === 'unknown'
      && intent?.dispatchState === 'started'
      && !intent?.dispatchLeaseExpiresAt
      && intent?.reconcileRequired === true
      && intent?.sentReconcileRequired === true
      && intent?.error === STARTED_EXPIRY_ERROR
      && intent?.transitionToken === transitionToken
      && intent?.transitionToken !== sourceIntent?.transitionToken
      && sameTimestamp(intent?.dispatchStartedAt, sourceIntent?.dispatchStartedAt)
      && intent?.preDispatchClaimFingerprint === sourceIntent?.preDispatchClaimFingerprint
      && sameTimestamp(intent?.preDispatchFinalizedAt, sourceIntent?.preDispatchFinalizedAt);
  }

  async function expireDispatchAtomically(sourceIntent, options = {}) {
    const started = options.started === true;
    const expectedState = started ? 'started' : 'reserved';
    if (sourceIntent?.status !== 'prepared' || sourceIntent?.dispatchState !== expectedState) {
      return sourceIntent;
    }
    const transitionToken = createRequiredTransitionToken(
      started ? 'onzeker na verlopen providerdispatch' : 'veilig vrijgegeven'
    );
    const args = {
      p_intent_id: sourceIntent.intentId,
      p_expected_transition_token: sourceIntent.transitionToken,
      p_expected_dispatch_lease_expires_at: sourceIntent.dispatchLeaseExpiresAt,
      p_expected_updated_at: sourceIntent.updatedAt,
      p_expected_claim_fingerprint: sourceIntent.preDispatchClaimFingerprint || null,
      p_expected_finalized_at: sourceIntent.preDispatchFinalizedAt || null,
      p_next_transition_token: transitionToken,
    };
    if (started) args.p_expected_dispatch_started_at = sourceIntent.dispatchStartedAt;
    const rpcName = started
      ? MAILBOX_EXPIRE_STARTED_PRE_DISPATCH_RPC
      : MAILBOX_EXPIRE_RESERVED_PRE_DISPATCH_RPC;
    const transitionMatches = started
      ? expiredStartedTransitionMatches
      : expiredReservedTransitionMatches;
    let transitionError = null;
    try {
      const result = await runCriticalQuery(
        (client) => client.rpc(rpcName, args),
        { maxAttempts: 1 }
      );
      const row = firstRpcRow(result.data);
      if (row) {
        const intent = normalizeRow(row);
        if (transitionMatches(intent, sourceIntent, transitionToken)) return intent;
      }
      transitionError = Object.assign(
        new Error('De databaselease was nog actief of de dispatchfence was verouderd.'),
        { code: 'PGRST116', status: 409 }
      );
    } catch (error) {
      transitionError = error;
    }

    let current = null;
    try {
      current = await findByIntentId(sourceIntent.intentId);
    } catch (readError) {
      const error = createUpdateError(transitionError, started ? 'onzeker' : 'veilig vrijgegeven');
      error.recoveryError = readError;
      throw error;
    }
    if (transitionMatches(current, sourceIntent, transitionToken)) return current;
    if (current) return current;
    throw createUpdateError(transitionError, started ? 'onzeker' : 'veilig vrijgegeven');
  }

  return {
    reconcileExpiredReservedDispatch(intent) {
      return intent?.status === 'prepared' && intent?.dispatchState === 'reserved'
        ? expireDispatchAtomically(intent, { started: false })
        : intent;
    },
    reconcileExpiredStartedDispatch(intent) {
      return intent?.status === 'prepared' && intent?.dispatchState === 'started'
        ? expireDispatchAtomically(intent, { started: true })
        : intent;
    },
  };
}

module.exports = {
  MAILBOX_EXPIRE_RESERVED_PRE_DISPATCH_RPC,
  MAILBOX_EXPIRE_STARTED_PRE_DISPATCH_RPC,
  createMailboxSendProvenanceExpiry,
};
