const MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC = 'softora_commit_mailbox_campaign_messages';
function createAtomicCommitError(message, code, { uncertain = false } = {}) {
  const error = new Error(message);
  error.code = code;
  if (uncertain) {
    error.status = 503;
    error.leaveMutationPending = true;
  }
  return error;
}
function createMailboxAtomicCommitQuery(client, {
  mutationId, requestKey, rows, result = {},
} = {}) {
  const normalizedMutationId = String(mutationId || '').trim().toLowerCase();
  const normalizedRequestKey = String(requestKey || '').trim();
  if (!normalizedMutationId || !normalizedRequestKey || !Array.isArray(rows)) {
    throw createAtomicCommitError(
      'Atomische mailboxwrite mist mutation identity of rijen.', 'MAILBOX_INDEX_ATOMIC_COMMIT_INVALID'
    );
  }
  if (!client || typeof client.rpc !== 'function') {
    throw createAtomicCommitError(
      'Atomische mailboxwrite-RPC is niet beschikbaar.', 'MAILBOX_INDEX_ATOMIC_COMMIT_UNAVAILABLE'
    );
  }
  return client.rpc(MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC, {
    p_mutation_id: normalizedMutationId,
    p_request_key: normalizedRequestKey,
    p_rows: rows,
    p_result: result && typeof result === 'object' ? result : {},
  });
}
function normalizeMailboxAtomicCommitResult(result, expectedCount) {
  if (!result?.ok) return result;
  const rows = Array.isArray(result.data) ? result.data : [];
  const row = rows.length === 1 && rows[0] && typeof rows[0] === 'object'
    ? rows[0]
    : null;
  const upserted = Number(row?.upserted_count);
  if (
    !row || row.mutation_status !== 'completed' ||
    !Number.isSafeInteger(upserted) || upserted !== expectedCount
  ) {
    return {
      ok: false,
      unavailable: false,
      data: null,
      error: createAtomicCommitError(
        'Atomische mailboxwrite gaf geen definitieve completed-response.',
        'MAILBOX_INDEX_ATOMIC_COMMIT_RESPONSE_INVALID', { uncertain: true }
      ),
    };
  }
  return { ...result, upserted };
}
module.exports = {
  MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC, createMailboxAtomicCommitQuery,
  normalizeMailboxAtomicCommitResult,
};
