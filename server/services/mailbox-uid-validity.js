'use strict';

const MAILBOX_UID_VALIDITY_MAX = 4_294_967_295;
const MAILBOX_UID_NEXT_MAX = MAILBOX_UID_VALIDITY_MAX + 1;
const MAILBOX_UID_SELECTION_POLICY = 'staged-rebuild-v2';
const MAILBOX_UID_TARGETED_SELECTION_POLICY = 'targeted-sparse-v2';
const MAILBOX_UID_SELECTION_POLICIES = new Set([
  MAILBOX_UID_SELECTION_POLICY,
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
]);
const MAILBOX_UID_TARGET_REFERENCE_LIMIT = 2000;
const MAILBOX_UID_GENERATION_MODES = new Set(['steady', 'rebuild']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMailboxUidValidity(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) &&
    normalized >= 1 &&
    normalized <= MAILBOX_UID_VALIDITY_MAX
    ? normalized
    : 0;
}

function normalizeMailboxUidNext(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) &&
    normalized >= 1 &&
    normalized <= MAILBOX_UID_NEXT_MAX
    ? normalized
    : 0;
}

function normalizeMailboxGenerationId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeMailboxTargetReference(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^[<>,\s]+|[<>,\s]+$/g, '')
    .toLowerCase();
  return normalized && normalized.length <= 998 && !/[<>,\s]/.test(normalized)
    ? normalized
    : '';
}

function compareMailboxTargetReferenceBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizeMailboxTargetReferences(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeMailboxTargetReference)
      .filter(Boolean)
  )).sort(compareMailboxTargetReferenceBytes);
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

function normalizeMailboxUidCursor(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : Number.NaN;
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Number.NaN;
  }
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) ? normalized : Number.NaN;
}

function normalizeMailboxFoundUids(values) {
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

function normalizeMailboxLeaseExpiry(value) {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function buildMailboxMessageKey({
  accountEmail = '', folder = '', uid = 0, generationId = null,
} = {}) {
  const base = `${accountEmail}|${folder}`;
  const normalizedGenerationId = normalizeMailboxGenerationId(generationId);
  return normalizedGenerationId
    ? `${base}|gen:${normalizedGenerationId}|${Number(uid) || 0}`
    : `${base}|${Number(uid) || 0}`;
}

function createMailboxUidValidityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getResultRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function createMailboxUidValidityStore({ runDurableWrite, buildSyncKey, normalizeString } = {}) {
  async function prepareUidGeneration({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    uidValidity,
    uidNext,
    selectionPolicy = MAILBOX_UID_SELECTION_POLICY,
    selectionTargets = [],
    deadlineAtMs = null,
  } = {}) {
    const normalizedUidValidity = normalizeMailboxUidValidity(uidValidity);
    const normalizedUidNext = normalizeMailboxUidNext(uidNext);
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedSelectionPolicy = normalizeString(selectionPolicy);
    const normalizedSelectionTargets = normalizeMailboxTargetReferences(selectionTargets);
    if (
      !normalizedUidValidity || !normalizedUidNext || !normalizedLockToken ||
      !MAILBOX_UID_SELECTION_POLICIES.has(normalizedSelectionPolicy) ||
      normalizedSelectionTargets.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT ||
      (normalizedSelectionPolicy === MAILBOX_UID_SELECTION_POLICY && normalizedSelectionTargets.length)
    ) {
      return {
        ok: false,
        prepared: false,
        error: createMailboxUidValidityError(
          'MAILBOX_UID_GENERATION_INVALID',
          'Mailbox UIDVALIDITY, UIDNEXT, synclease of selectiebeleid is ongeldig.'
        ),
      };
    }
    const result = await runDurableWrite(
      'prepare-uid-generation-v2',
      (client) => client.rpc('softora_prepare_mailbox_uid_generation_v3', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_uid_validity: normalizedUidValidity,
        p_uid_next: normalizedUidNext,
        p_selection_policy: normalizedSelectionPolicy,
        p_selection_targets: normalizedSelectionTargets,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, prepared: false };
    const prepared = getResultRow(result.data);
    const mode = normalizeString(prepared && prepared.mode).toLowerCase();
    const activeGenerationId = normalizeMailboxGenerationId(prepared && prepared.active_generation_id);
    const targetGenerationId = normalizeMailboxGenerationId(prepared && prepared.target_generation_id);
    const leaseExpiresAt = normalizeMailboxLeaseExpiry(prepared && prepared.lease_expires_at);
    const scanUpperUid = normalizeMailboxUidCursor(prepared && prepared.scan_upper_uid);
    const scannedThroughUid = normalizeMailboxUidCursor(prepared && prepared.scanned_through_uid);
    const targetManifestScannedThroughUid = normalizeMailboxUidCursor(
      prepared && prepared.selection_manifest_scanned_through_uid
    );
    const targetUidManifest = normalizeMailboxTargetUidManifest(
      prepared && prepared.target_uid_manifest
    );
    const targetManifestComplete = prepared && prepared.target_manifest_complete;
    const preparedSelectionTargets = normalizeMailboxTargetReferences(
      prepared && prepared.selection_targets
    );
    const lockLost = prepared && prepared.lock_lost === true;
    if (
      !prepared || prepared.prepared !== true || lockLost ||
      !MAILBOX_UID_GENERATION_MODES.has(mode) || !targetGenerationId || !leaseExpiresAt ||
      prepared.scan_upper_uid === null || prepared.scanned_through_uid === null ||
      prepared.selection_manifest_scanned_through_uid === null ||
      !Number.isSafeInteger(scanUpperUid) || !Number.isSafeInteger(scannedThroughUid) ||
      !Number.isSafeInteger(targetManifestScannedThroughUid) || !targetUidManifest ||
      !Array.isArray(prepared.selection_targets) ||
      prepared.selection_targets.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT ||
      preparedSelectionTargets.length !== prepared.selection_targets.length ||
      prepared.selection_targets.some((target, index) => (
        typeof target !== 'string' || target !== preparedSelectionTargets[index]
      )) ||
      scanUpperUid < 0 || scannedThroughUid < 0 || targetManifestScannedThroughUid < 0 ||
      typeof targetManifestComplete !== 'boolean' ||
      scanUpperUid > normalizedUidNext - 1 || scannedThroughUid > scanUpperUid ||
      targetManifestScannedThroughUid > scanUpperUid ||
      targetUidManifest.some((uid) => uid > targetManifestScannedThroughUid) ||
      (normalizedSelectionPolicy === MAILBOX_UID_TARGETED_SELECTION_POLICY &&
        targetManifestComplete !== (targetManifestScannedThroughUid === scanUpperUid) && !(
          mode === 'rebuild' && targetManifestScannedThroughUid === 0 &&
          scanUpperUid === 0 && targetManifestComplete === false
        )) ||
      (normalizedSelectionPolicy === MAILBOX_UID_TARGETED_SELECTION_POLICY &&
        mode === 'steady' && !targetManifestComplete) ||
      (normalizedSelectionPolicy === MAILBOX_UID_SELECTION_POLICY && (
        targetManifestScannedThroughUid !== 0 || targetUidManifest.length || targetManifestComplete
      ))
    ) {
      return {
        ok: false,
        prepared: false,
        lockLost,
        error: createMailboxUidValidityError(
          lockLost ? 'MAILBOX_UID_GENERATION_LEASE_INVALID' : 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID',
          lockLost
            ? 'Mailbox UID-generatie kon niet onder de actieve synclease worden voorbereid.'
            : 'Mailbox UID-generatie gaf een ongeldig v2-protocolantwoord.'
        ),
      };
    }
    if (mode === 'steady' && activeGenerationId !== targetGenerationId) {
      return {
        ok: false,
        prepared: false,
        lockLost: false,
        error: createMailboxUidValidityError(
          'MAILBOX_UID_GENERATION_PROTOCOL_INVALID',
          'Steady mailboxsync verwijst niet naar de actieve UID-generatie.'
        ),
      };
    }
    return {
      ok: true,
      prepared: true,
      lockLost: false,
      mode,
      resetDetected: prepared.reset_detected === true,
      resumed: prepared.resumed === true,
      activeGenerationId,
      targetGenerationId,
      currentUidValidity: normalizeMailboxUidValidity(prepared.current_uid_validity),
      observedUidValidity: normalizeMailboxUidValidity(prepared.observed_uid_validity) || normalizedUidValidity,
      scanUpperUid,
      scannedThroughUid,
      leaseExpiresAt,
      selectionPolicy: normalizedSelectionPolicy,
      selectionTargets: preparedSelectionTargets,
      targetManifestScannedThroughUid,
      targetUidManifest,
      targetManifestComplete,
    };
  }

  async function checkpointTargetUidManifest({
    accountEmail,
    folder = 'allmail',
    lockToken = '',
    checkpointId = '',
    generationId = '',
    uidValidity,
    expectedScannedThroughUid = 0,
    scannedThroughUid = 0,
    foundUids = [],
    scanComplete = false,
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedCheckpointId = normalizeMailboxGenerationId(checkpointId);
    const normalizedGenerationId = normalizeMailboxGenerationId(generationId);
    const normalizedUidValidity = normalizeMailboxUidValidity(uidValidity);
    const safeExpectedScannedThroughUid = normalizeMailboxUidCursor(expectedScannedThroughUid);
    const safeScannedThroughUid = normalizeMailboxUidCursor(scannedThroughUid);
    const normalizedFoundUids = normalizeMailboxFoundUids(foundUids);
    if (
      !normalizedLockToken || !normalizedCheckpointId || !normalizedGenerationId ||
      !normalizedUidValidity || !Number.isSafeInteger(safeExpectedScannedThroughUid) ||
      safeExpectedScannedThroughUid < 0 || !Number.isSafeInteger(safeScannedThroughUid) ||
      safeScannedThroughUid < safeExpectedScannedThroughUid || !normalizedFoundUids ||
      typeof scanComplete !== 'boolean' ||
      normalizedFoundUids.some((uid) => (
        uid <= safeExpectedScannedThroughUid || uid > safeScannedThroughUid
      )) || (safeScannedThroughUid === safeExpectedScannedThroughUid && !(
        scanComplete === true && safeScannedThroughUid === 0
      ))
    ) {
      return {
        ok: false,
        checkpointed: false,
        error: createMailboxUidValidityError(
          'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID',
          'Mailbox targetmanifest-checkpoint is ongeldig.'
        ),
      };
    }
    const result = await runDurableWrite(
      'checkpoint-mailbox-uid-target-manifest-v2',
      (client) => client.rpc('softora_checkpoint_mailbox_uid_target_manifest_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_checkpoint_id: normalizedCheckpointId,
        p_generation_id: normalizedGenerationId,
        p_uid_validity: normalizedUidValidity,
        p_expected_scanned_through_uid: safeExpectedScannedThroughUid,
        p_scanned_through_uid: safeScannedThroughUid,
        p_found_uids: normalizedFoundUids,
        p_scan_complete: scanComplete === true,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, checkpointed: false };
    const checkpoint = getResultRow(result.data);
    const lockLost = checkpoint && checkpoint.lock_lost === true;
    const returnedScannedThroughUid = normalizeMailboxUidCursor(
      checkpoint && checkpoint.scanned_through_uid
    );
    const targetUidManifest = normalizeMailboxTargetUidManifest(
      checkpoint && checkpoint.target_uid_manifest
    );
    const targetManifestComplete = checkpoint && checkpoint.scan_complete;
    const lockReleased = checkpoint && checkpoint.lock_released;
    const replayed = checkpoint && checkpoint.replayed;
    if (
      !checkpoint || checkpoint.checkpointed !== true || lockLost ||
      typeof checkpoint.lock_lost !== 'boolean' || typeof replayed !== 'boolean' ||
      typeof targetManifestComplete !== 'boolean' || typeof lockReleased !== 'boolean' ||
      checkpoint.scanned_through_uid === null ||
      !Number.isSafeInteger(returnedScannedThroughUid) || returnedScannedThroughUid < 0 ||
      returnedScannedThroughUid !== safeScannedThroughUid || !targetUidManifest ||
      targetUidManifest.some((uid) => uid > returnedScannedThroughUid) ||
      targetManifestComplete !== (scanComplete === true) ||
      lockReleased !== !targetManifestComplete
    ) {
      return {
        ok: false,
        checkpointed: false,
        lockLost,
        error: createMailboxUidValidityError(
          lockLost
            ? 'MAILBOX_UID_GENERATION_LEASE_INVALID'
            : 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID',
          lockLost
            ? 'Mailbox targetmanifest-checkpoint verloor de actieve synclease.'
            : 'Mailbox targetmanifest-checkpoint gaf een ongeldig v2-protocolantwoord.'
        ),
      };
    }
    return {
      ok: true,
      checkpointed: true,
      lockLost: false,
      replayed,
      targetManifestScannedThroughUid: returnedScannedThroughUid,
      targetUidManifest,
      targetManifestComplete,
      lockReleased,
    };
  }

  async function invalidateTargetUidManifest({
    accountEmail,
    folder = 'allmail',
    lockToken = '',
    invalidationId = '',
    generationId = '',
    uidValidity,
    expectedStagedCount = 0,
    missingUids = [],
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedInvalidationId = normalizeMailboxGenerationId(invalidationId);
    const normalizedGenerationId = normalizeMailboxGenerationId(generationId);
    const normalizedUidValidity = normalizeMailboxUidValidity(uidValidity);
    const safeExpectedStagedCount = normalizeMailboxUidCursor(expectedStagedCount);
    const normalizedMissingUids = normalizeMailboxFoundUids(missingUids);
    if (
      !normalizedLockToken || !normalizedInvalidationId || !normalizedGenerationId ||
      !normalizedUidValidity || !Number.isSafeInteger(safeExpectedStagedCount) ||
      safeExpectedStagedCount < 0 ||
      safeExpectedStagedCount > MAILBOX_UID_TARGET_REFERENCE_LIMIT ||
      !normalizedMissingUids || !normalizedMissingUids.length
    ) {
      return {
        ok: false,
        invalidated: false,
        error: createMailboxUidValidityError(
          'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID',
          'Mailbox targetmanifest-invalidatie is ongeldig.'
        ),
      };
    }
    const result = await runDurableWrite(
      'invalidate-mailbox-uid-target-manifest-v2',
      (client) => client.rpc('softora_invalidate_mailbox_uid_target_manifest_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_invalidation_id: normalizedInvalidationId,
        p_generation_id: normalizedGenerationId,
        p_uid_validity: normalizedUidValidity,
        p_expected_staged_count: safeExpectedStagedCount,
        p_missing_uids: normalizedMissingUids,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, invalidated: false };
    const invalidation = getResultRow(result.data);
    const lockLost = invalidation && invalidation.lock_lost === true;
    const generationRole = normalizeString(
      invalidation && invalidation.generation_role
    ).toLowerCase();
    const replayed = invalidation && invalidation.replayed;
    const pendingAbandoned = invalidation && invalidation.pending_abandoned;
    const activeManifestInvalidated = invalidation &&
      invalidation.active_manifest_invalidated;
    const lockReleased = invalidation && invalidation.lock_released;
    if (
      !invalidation || invalidation.invalidated !== true || lockLost ||
      typeof invalidation.lock_lost !== 'boolean' ||
      typeof replayed !== 'boolean' ||
      !['pending', 'active'].includes(generationRole) ||
      typeof pendingAbandoned !== 'boolean' ||
      pendingAbandoned !== (generationRole === 'pending') ||
      typeof activeManifestInvalidated !== 'boolean' ||
      (generationRole === 'active' && !activeManifestInvalidated) ||
      lockReleased !== true
    ) {
      return {
        ok: false,
        invalidated: false,
        lockLost,
        error: createMailboxUidValidityError(
          lockLost
            ? 'MAILBOX_UID_GENERATION_LEASE_INVALID'
            : 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID',
          lockLost
            ? 'Mailbox targetmanifest-invalidatie verloor de actieve synclease.'
            : 'Mailbox targetmanifest-invalidatie gaf een ongeldig v2-protocolantwoord.'
        ),
      };
    }
    return {
      ok: true,
      invalidated: true,
      lockLost: false,
      replayed,
      generationRole,
      pendingAbandoned,
      activeManifestInvalidated,
      lockReleased: true,
    };
  }

  async function confirmUidBaseline({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    generationId,
    uidValidity,
    evidence = [],
    deadlineAtMs = null,
  } = {}) {
    const normalizedLockToken = normalizeString(lockToken);
    const normalizedGenerationId = normalizeMailboxGenerationId(generationId);
    const normalizedUidValidity = normalizeMailboxUidValidity(uidValidity);
    if (!normalizedLockToken || !normalizedGenerationId || !normalizedUidValidity || !Array.isArray(evidence)) {
      return {
        ok: false,
        confirmed: false,
        error: createMailboxUidValidityError('MAILBOX_UID_BASELINE_INVALID', 'Mailbox UID-baselinebewijs is ongeldig.'),
      };
    }
    const result = await runDurableWrite(
      'confirm-uid-baseline-v2',
      (client) => client.rpc('softora_confirm_mailbox_uid_baseline_v2', {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_generation_id: normalizedGenerationId,
        p_uid_validity: normalizedUidValidity,
        p_evidence: evidence,
      }),
      { deadlineAtMs }
    );
    if (!result.ok) return { ...result, confirmed: false };
    const confirmed = getResultRow(result.data);
    const lockLost = confirmed && confirmed.lock_lost === true;
    const activeGenerationId = normalizeMailboxGenerationId(confirmed && confirmed.active_generation_id);
    const currentUidValidity = normalizeMailboxUidValidity(confirmed && confirmed.current_uid_validity);
    const resumeAfterUid = Number(confirmed && confirmed.resume_after_uid);
    if (
      !confirmed || confirmed.confirmed !== true || lockLost ||
      activeGenerationId !== normalizedGenerationId || currentUidValidity !== normalizedUidValidity ||
      !Number.isSafeInteger(resumeAfterUid) || resumeAfterUid !== 0
    ) {
      return {
        ok: false,
        confirmed: false,
        lockLost,
        error: createMailboxUidValidityError(
          lockLost ? 'MAILBOX_UID_GENERATION_LEASE_INVALID' : 'MAILBOX_UID_BASELINE_REJECTED',
          lockLost ? 'Mailbox UID-baseline verloor de actieve synclease.' : 'Mailbox UID-baseline kon niet exact worden bevestigd.'
        ),
      };
    }
    return {
      ok: true,
      confirmed: true,
      lockLost: false,
      activeGenerationId,
      currentUidValidity,
      resumeAfterUid,
      adoptedCount: Math.max(0, Number(confirmed.adopted_count) || 0),
    };
  }

  return {
    checkpointTargetUidManifest,
    confirmUidBaseline,
    invalidateTargetUidManifest,
    prepareUidGeneration,
  };
}

module.exports = {
  MAILBOX_UID_GENERATION_MODES,
  MAILBOX_UID_NEXT_MAX,
  MAILBOX_UID_SELECTION_POLICY,
  MAILBOX_UID_SELECTION_POLICIES,
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
  MAILBOX_UID_TARGET_REFERENCE_LIMIT,
  MAILBOX_UID_VALIDITY_MAX,
  buildMailboxMessageKey,
  createMailboxUidValidityStore,
  normalizeMailboxGenerationId,
  normalizeMailboxLeaseExpiry,
  normalizeMailboxTargetReference,
  normalizeMailboxTargetReferences,
  normalizeMailboxTargetUidManifest,
  normalizeMailboxUidNext,
  normalizeMailboxUidValidity,
};
