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
      (normalizedSelectionPolicy === MAILBOX_UID_SELECTION_POLICY && normalizedSelectionTargets.length) ||
      (normalizedSelectionPolicy === MAILBOX_UID_TARGETED_SELECTION_POLICY && !normalizedSelectionTargets.length)
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
      (client) => client.rpc('softora_prepare_mailbox_uid_generation_v2', {
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
    const scanUpperUid = Math.max(0, Number(prepared && prepared.scan_upper_uid) || 0);
    const scannedThroughUid = Math.max(0, Number(prepared && prepared.scanned_through_uid) || 0);
    const preparedSelectionTargets = normalizeMailboxTargetReferences(
      prepared && prepared.selection_targets
    );
    const lockLost = prepared && prepared.lock_lost === true;
    if (
      !prepared || prepared.prepared !== true || lockLost ||
      !MAILBOX_UID_GENERATION_MODES.has(mode) || !targetGenerationId || !leaseExpiresAt ||
      !Number.isSafeInteger(scanUpperUid) || !Number.isSafeInteger(scannedThroughUid) ||
      scanUpperUid > normalizedUidNext - 1 || scannedThroughUid > scanUpperUid ||
      (normalizedSelectionPolicy === MAILBOX_UID_TARGETED_SELECTION_POLICY &&
        mode === 'rebuild' && !preparedSelectionTargets.length)
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
      selectionTargets: preparedSelectionTargets.length
        ? preparedSelectionTargets
        : normalizedSelectionTargets,
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

  return { confirmUidBaseline, prepareUidGeneration };
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
  normalizeMailboxUidNext,
  normalizeMailboxUidValidity,
};
