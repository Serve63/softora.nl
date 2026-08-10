const INSTANTLY_MAILBOX_SYNC_SCOPE = 'instantly_mailbox_sync';
const INSTANTLY_SYNC_STATE_VERSION = 2;
const MAX_SYNC_SEGMENTS = 1000;
const MAX_QUARANTINE_ITEMS = 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function getOwnerSyncScope(owner) {
  return `${INSTANTLY_MAILBOX_SYNC_SCOPE}_${normalizeText(owner).toLowerCase()}`;
}

function createStateError(createError, message, code) {
  if (typeof createError === 'function') return createError(message, code, 503);
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  return error;
}

function normalizeSegment(value = {}) {
  const cursor = normalizeText(value.cursor);
  const minTimestamp = normalizeTimestamp(value.minTimestamp);
  const maxTimestamp = normalizeTimestamp(value.maxTimestamp);
  if (!cursor || !minTimestamp) return null;
  return {
    cursor,
    minTimestamp,
    maxTimestamp,
    scanStartedAt: normalizeTimestamp(value.scanStartedAt) || maxTimestamp,
  };
}

function normalizeQuarantineItem(value = {}) {
  const identity = normalizeText(value.identity);
  if (!identity) return null;
  return {
    identity,
    providerMessageId: normalizeText(value.providerMessageId),
    reason: normalizeText(value.reason) || 'normalization-rejected',
    firstSeenAt: normalizeTimestamp(value.firstSeenAt),
    lastSeenAt: normalizeTimestamp(value.lastSeenAt),
    nextRetryAt: normalizeTimestamp(value.nextRetryAt),
    attempts: Math.max(1, Math.min(10_000, Number(value.attempts) || 1)),
  };
}

function normalizeStoredState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const segments = (Array.isArray(source.segments) ? source.segments : [])
    .map(normalizeSegment)
    .filter(Boolean);
  const quarantine = (Array.isArray(source.quarantine) ? source.quarantine : [])
    .map(normalizeQuarantineItem)
    .filter(Boolean);
  return {
    version: INSTANTLY_SYNC_STATE_VERSION,
    segments,
    quarantine,
  };
}

function parseStoredState(rawValue, createError) {
  const raw = normalizeText(rawValue);
  if (!raw) return normalizeStoredState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    if (
      (Array.isArray(parsed.segments) && parsed.segments.length > MAX_SYNC_SEGMENTS) ||
      (Array.isArray(parsed.quarantine) && parsed.quarantine.length > MAX_QUARANTINE_ITEMS)
    ) {
      throw createStateError(
        createError,
        'De duurzame Instantly-syncstatus overschrijdt de veilige wachtrijlimiet.',
        'INSTANTLY_SYNC_STATE_LIMIT_EXCEEDED'
      );
    }
    return normalizeStoredState(parsed);
  } catch (error) {
    if (error?.code === 'INSTANTLY_SYNC_STATE_LIMIT_EXCEEDED') throw error;
    throw createStateError(
      createError,
      'De duurzame Instantly-syncstatus is beschadigd en wordt niet leeg overschreven.',
      'INSTANTLY_SYNC_STATE_INVALID'
    );
  }
}

function assertDurableRead(result, createError) {
  if (
    !result ||
    typeof result.values !== 'object' ||
    result.values === null ||
    result.source === 'memory'
  ) {
    throw createStateError(
      createError,
      'De duurzame Instantly-syncstatus kon niet worden gelezen.',
      'INSTANTLY_SYNC_STATE_READ_FAILED'
    );
  }
  return result.values;
}

async function readInstantlyOwnerSyncState({ owner, getUiStateValues, createError }) {
  const ownerScope = getOwnerSyncScope(owner);
  const ownerResult = await getUiStateValues(ownerScope);
  const ownerValues = assertDurableRead(ownerResult, createError);
  if (normalizeText(ownerValues.state_json)) {
    return parseStoredState(ownerValues.state_json, createError);
  }

  const legacyResult = await getUiStateValues(INSTANTLY_MAILBOX_SYNC_SCOPE);
  const legacyValues = assertDurableRead(legacyResult, createError);
  const cursor = normalizeText(legacyValues[`cursor_${owner}`]);
  const minTimestamp = normalizeTimestamp(legacyValues[`min_timestamp_${owner}`]);
  return normalizeStoredState({
    segments: cursor && minTimestamp ? [{ cursor, minTimestamp }] : [],
  });
}

async function writeInstantlyOwnerSyncState({
  owner,
  state,
  setUiStateValues,
  createError,
}) {
  const normalized = normalizeStoredState(state);
  if (
    (state?.segments?.length || 0) > MAX_SYNC_SEGMENTS ||
    (state?.quarantine?.length || 0) > MAX_QUARANTINE_ITEMS
  ) {
    throw createStateError(
      createError,
      'De Instantly-syncwachtrij is groter dan veilig duurzaam kan worden vastgelegd.',
      'INSTANTLY_SYNC_BACKLOG_LIMIT_REACHED'
    );
  }
  const result = await setUiStateValues(
    getOwnerSyncScope(owner),
    { state_json: JSON.stringify(normalized) },
    { source: 'instantly-mailbox-sync', actor: 'Instantly mailbox' }
  );
  if (!result || result.source === 'memory') {
    throw createStateError(
      createError,
      'De duurzame Instantly-syncstatus kon niet worden opgeslagen.',
      'INSTANTLY_SYNC_STATE_WRITE_FAILED'
    );
  }
  return normalized;
}

module.exports = {
  INSTANTLY_MAILBOX_SYNC_SCOPE,
  INSTANTLY_SYNC_STATE_VERSION,
  MAX_QUARANTINE_ITEMS,
  MAX_SYNC_SEGMENTS,
  getOwnerSyncScope,
  normalizeStoredState,
  parseStoredState,
  readInstantlyOwnerSyncState,
  writeInstantlyOwnerSyncState,
};
