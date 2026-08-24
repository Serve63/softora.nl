'use strict';

const {
  MAILBOX_UID_SELECTION_POLICIES,
  MAILBOX_UID_SELECTION_POLICY,
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
  MAILBOX_UID_TARGET_REFERENCE_LIMIT,
  normalizeMailboxGenerationId,
  normalizeMailboxTargetReference,
  normalizeMailboxTargetReferences,
  normalizeMailboxUidValidity,
} = require('./mailbox-uid-validity');

const MAILBOX_SYNC_COMMIT_RESERVE_MS = 10_000;

function createMailboxSyncLeaseError() {
  const error = new Error('Mailbox-synclease is vóór de atomische mutatie verloren gegaan.');
  error.code = 'MAILBOX_SYNC_LEASE_LOST';
  return error;
}

function createMailboxSyncProtocolError(message = 'Mailbox-sync v2 gaf een ongeldig antwoord.') {
  const error = new Error(message);
  error.code = 'MAILBOX_SYNC_V2_PROTOCOL_INVALID';
  return error;
}

function getMailboxSyncLeaseDeadlineAtMs({
  requestDeadlineAtMs = null,
  leaseExpiresAt = '',
  reserveMs = MAILBOX_SYNC_COMMIT_RESERVE_MS,
  nowMs = Date.now(),
} = {}) {
  const leaseExpiryMs = Date.parse(String(leaseExpiresAt || '').trim());
  if (!Number.isFinite(leaseExpiryMs)) return 0;
  const leaseDeadlineAtMs = leaseExpiryMs - Math.max(0, Number(reserveMs) || 0);
  const requested = Number(requestDeadlineAtMs);
  const deadlineAtMs = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, leaseDeadlineAtMs)
    : leaseDeadlineAtMs;
  return deadlineAtMs > Number(nowMs) ? Math.floor(deadlineAtMs) : 0;
}

function getResultRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function normalizeMailboxTargetUidManifest(values) {
  if (!Array.isArray(values) || values.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT) return null;
  const normalized = values.map(Number);
  for (let index = 0; index < normalized.length; index += 1) {
    if (
      !Number.isSafeInteger(normalized[index]) || normalized[index] <= 0 ||
      (index > 0 && normalized[index] <= normalized[index - 1])
    ) return null;
  }
  return normalized;
}

function createMailboxSyncFinalizer({ runDurableWrite, buildSyncKey, normalizeString } = {}) {
  async function commitSyncPass({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    commitId = '',
    generationId = '',
    uidValidity,
    selectionPolicy = MAILBOX_UID_SELECTION_POLICY,
    targetReferenceIds = [],
    targetUidManifest = [],
    rows = [],
    scannedFromUid = 0,
    scannedThroughUid = 0,
    scanComplete = false,
    messageCount = 0,
    lastUid = 0,
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedCommitId = normalizeMailboxGenerationId(commitId);
    const normalizedGenerationId = normalizeMailboxGenerationId(generationId);
    const normalizedUidValidity = normalizeMailboxUidValidity(uidValidity);
    const normalizedSelectionPolicy = normalizeString(selectionPolicy);
    const normalizedTargetReferenceIds = normalizeMailboxTargetReferences(targetReferenceIds);
    const normalizedTargetUidManifest = normalizeMailboxTargetUidManifest(targetUidManifest);
    const targetReferencesValid = Array.isArray(targetReferenceIds) &&
      targetReferenceIds.every((value) => Boolean(normalizeMailboxTargetReference(value))) &&
      normalizedTargetReferenceIds.length <= MAILBOX_UID_TARGET_REFERENCE_LIMIT;
    const safeScannedFromUid = Math.max(0, Number(scannedFromUid) || 0);
    const safeScannedThroughUid = Math.max(0, Number(scannedThroughUid) || 0);
    if (
      !normalizedLockToken || !normalizedCommitId || !normalizedGenerationId ||
      !normalizedUidValidity || !Array.isArray(rows) ||
      !MAILBOX_UID_SELECTION_POLICIES.has(normalizedSelectionPolicy) ||
      !targetReferencesValid || !normalizedTargetUidManifest ||
      (normalizedSelectionPolicy === MAILBOX_UID_SELECTION_POLICY &&
        (normalizedTargetReferenceIds.length || normalizedTargetUidManifest.length)) ||
      !Number.isSafeInteger(safeScannedFromUid) || !Number.isSafeInteger(safeScannedThroughUid)
    ) {
      return { ok: false, committed: false, error: createMailboxSyncProtocolError('Ongeldige atomische mailbox-syncpass.') };
    }
    const result = await runDurableWrite(
      'commit-mailbox-sync-pass-v2',
      (client) => client.rpc('softora_commit_mailbox_sync_pass_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_commit_id: normalizedCommitId,
        p_generation_id: normalizedGenerationId,
        p_uid_validity: normalizedUidValidity,
        p_selection_policy: normalizedSelectionPolicy,
        p_target_reference_ids: normalizedTargetReferenceIds,
        p_target_uid_manifest: normalizedTargetUidManifest,
        p_rows: rows,
        p_scanned_from_uid: safeScannedFromUid,
        p_scanned_through_uid: safeScannedThroughUid,
        p_scan_complete: Boolean(scanComplete),
        p_message_count: Math.max(0, Number(messageCount) || 0),
        p_last_uid: Math.max(0, Number(lastUid) || 0),
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, committed: false };
    const committed = getResultRow(result.data);
    const currentGenerationId = normalizeMailboxGenerationId(committed && committed.current_generation_id);
    const currentUidValidity = normalizeMailboxUidValidity(committed && committed.current_uid_validity);
    if (!committed || committed.committed !== true) {
      return {
        ok: false,
        committed: false,
        error: createMailboxSyncLeaseError(),
      };
    }
    const activated = committed.activated === true;
    const rebuildPending = committed.rebuild_pending === true;
    const currentIdentityComplete = Boolean(currentGenerationId && currentUidValidity);
    const currentIdentityEmpty = !currentGenerationId && !currentUidValidity;
    const currentIdentityMatchesCommit =
      currentGenerationId === normalizedGenerationId && currentUidValidity === normalizedUidValidity;
    if (
      (activated && rebuildPending) ||
      (!currentIdentityComplete && !currentIdentityEmpty) ||
      (!rebuildPending && !currentIdentityMatchesCommit)
    ) {
      return {
        ok: false,
        committed: false,
        error: createMailboxSyncProtocolError('Atomische mailbox-synccommit gaf een ongeldige generatiestatus terug.'),
      };
    }
    return {
      ok: true,
      committed: true,
      replayed: committed.replayed === true,
      activated,
      rebuildPending,
      upserted: Math.max(0, Number(committed.upserted_count) || 0),
      lastUid: Math.max(0, Number(committed.last_uid) || 0),
      currentGenerationId,
      currentUidValidity,
    };
  }

  async function commitTargetedSyncPass(options = {}) {
    return commitSyncPass({
      ...options,
      selectionPolicy: MAILBOX_UID_TARGETED_SELECTION_POLICY,
      lastUid: 0,
    });
  }

  async function skipSync({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    commitId = '',
    reason = 'folder_missing',
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedCommitId = normalizeMailboxGenerationId(commitId);
    const normalizedReason = normalizeString(reason);
    if (!normalizedLockToken || !normalizedCommitId || normalizedReason !== 'folder_missing') {
      return {
        ok: false,
        skipped: false,
        error: createMailboxSyncProtocolError('Ongeldige mailbox-sync skipmutatie.'),
      };
    }
    const result = await runDurableWrite(
      'skip-mailbox-sync-v2',
      (client) => client.rpc('softora_skip_mailbox_sync_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_commit_id: normalizedCommitId,
        p_reason: normalizedReason,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, skipped: false };
    const skipped = getResultRow(result.data);
    if (!skipped || skipped.lock_lost === true || skipped.skipped !== true) {
      return {
        ok: false,
        skipped: false,
        lockLost: skipped && skipped.lock_lost === true,
        replayed: skipped && skipped.replayed === true,
        error: createMailboxSyncLeaseError(),
      };
    }
    return { ok: true, skipped: true, lockLost: false, replayed: skipped.replayed === true };
  }

  async function failSync({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    commitId = '',
    error = '',
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedCommitId = normalizeMailboxGenerationId(commitId);
    const errorText = normalizeString(error).slice(0, 1000);
    if (!normalizedLockToken || !normalizedCommitId || !errorText) {
      return { ok: false, applied: false, error: createMailboxSyncProtocolError('Ongeldige mailbox-sync failuremutatie.') };
    }
    const result = await runDurableWrite(
      'fail-mailbox-sync-v2',
      (client) => client.rpc('softora_fail_mailbox_sync_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_commit_id: normalizedCommitId,
        p_error: errorText,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, applied: false };
    const failed = getResultRow(result.data);
    if (!failed || failed.lock_lost === true || failed.applied !== true) {
      return {
        ok: false,
        applied: false,
        lockLost: failed && failed.lock_lost === true,
        replayed: failed && failed.replayed === true,
        error: createMailboxSyncLeaseError(),
      };
    }
    return { ok: true, applied: true, lockLost: false, replayed: failed.replayed === true };
  }

  return { commitSyncPass, commitTargetedSyncPass, failSync, skipSync };
}

module.exports = {
  MAILBOX_SYNC_COMMIT_RESERVE_MS,
  createMailboxSyncFinalizer,
  createMailboxSyncLeaseError,
  createMailboxSyncProtocolError,
  getMailboxSyncLeaseDeadlineAtMs,
  normalizeMailboxTargetUidManifest,
};
