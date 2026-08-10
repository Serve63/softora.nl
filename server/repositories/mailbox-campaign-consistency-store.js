const crypto = require('crypto');

const MAILBOX_CAMPAIGN_CONSISTENCY_RPCS = Object.freeze({
  beginMutation: 'softora_begin_mailbox_campaign_mutation',
  completeMutation: 'softora_complete_mailbox_campaign_mutation',
  getFence: 'softora_get_mailbox_campaign_fence',
});

const MUTATION_STATUSES = new Set(['pending', 'completed', 'abandoned']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_BIGINT_MAX = 9223372036854775807n;

function createConsistencyError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function createMailboxCampaignConsistencyStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    randomUUID = () => crypto.randomUUID(),
  } = deps;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function invalid(message) {
    throw createConsistencyError(
      message,
      'MAILBOX_CAMPAIGN_CONSISTENCY_INVALID'
    );
  }

  function responseInvalid(message, cause = null) {
    throw createConsistencyError(
      message,
      'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
      cause
    );
  }

  function normalizeBoundedText(value, field, maxLength, { optional = false, lower = false } = {}) {
    const normalized = text(value);
    if (!normalized && optional) return null;
    if (!normalized || normalized.length > maxLength) invalid(`${field} is ongeldig.`);
    return lower ? normalized.toLowerCase() : normalized;
  }

  function normalizeUuid(value, field = 'mutationId') {
    const normalized = text(value).toLowerCase();
    if (!UUID_PATTERN.test(normalized)) invalid(`${field} is ongeldig.`);
    return normalized;
  }

  function normalizeVersion(value, field, { optional = false } = {}) {
    if ((value === null || value === undefined || value === '') && optional) return null;
    if (typeof value === 'bigint') {
      if (value < 0n || value > POSTGRES_BIGINT_MAX) invalid(`${field} is ongeldig.`);
      return value.toString();
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) invalid(`${field} is niet veilig representabel.`);
      return String(value);
    }
    const normalized = text(value);
    if (!/^\d+$/.test(normalized)) invalid(`${field} is ongeldig.`);
    const bigint = BigInt(normalized);
    if (bigint > POSTGRES_BIGINT_MAX) invalid(`${field} valt buiten PostgreSQL bigint.`);
    return bigint.toString();
  }

  function normalizeCount(value, field) {
    const normalized = normalizeVersion(value, field);
    const count = Number(normalized);
    if (!Number.isSafeInteger(count)) invalid(`${field} is niet veilig representabel.`);
    return count;
  }

  function normalizeStatus(value) {
    const status = text(value).toLowerCase();
    if (!MUTATION_STATUSES.has(status)) invalid('mutation_status ontbreekt of is ongeldig.');
    return status;
  }

  function firstRow(data, rpcName) {
    if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
      responseInvalid(`${rpcName} moet exact één consistente rij teruggeven.`);
    }
    return data[0];
  }

  function getClient() {
    const client = isSupabaseConfigured() ? getSupabaseClient() : null;
    if (!client || typeof client.rpc !== 'function') {
      throw createConsistencyError(
        'Mailbox-campagneconsistentie is niet duurzaam beschikbaar.',
        'MAILBOX_CAMPAIGN_CONSISTENCY_UNAVAILABLE'
      );
    }
    return client;
  }

  async function callRpc(rpcName, args) {
    try {
      const response = await getClient().rpc(rpcName, args);
      if (response && response.error) throw response.error;
      return firstRow(response && response.data, rpcName);
    } catch (error) {
      if (String(error?.code || '').startsWith('MAILBOX_CAMPAIGN_CONSISTENCY_')) throw error;
      if (typeof logger.error === 'function') {
        logger.error(`[MailboxCampaignConsistency][${rpcName}]`, error?.message || error);
      }
      throw createConsistencyError(
        `Mailbox-campagneconsistentie-RPC ${rpcName} is mislukt.`,
        'MAILBOX_CAMPAIGN_CONSISTENCY_RPC_FAILED',
        error
      );
    }
  }

  function normalizeMutationRow(row, { includeRequestKey = false } = {}) {
    try {
      const mutation = {
        mutationId: normalizeUuid(row.mutation_id, 'mutation_id'),
        status: normalizeStatus(row.mutation_status),
        startedContentVersion: normalizeVersion(
          row.started_content_version,
          'started_content_version'
        ),
        completedContentVersion: normalizeVersion(
          row.completed_content_version,
          'completed_content_version',
          { optional: true }
        ),
        contentVersion: normalizeVersion(row.current_content_version, 'current_content_version'),
        replayed: row.replayed === true,
      };
      if (includeRequestKey) {
        mutation.requestKey = normalizeBoundedText(row.request_key, 'request_key', 200);
        mutation.leaseExpiresAt = normalizeBoundedText(
          row.lease_expires_at,
          'lease_expires_at',
          80
        );
      }
      const started = BigInt(mutation.startedContentVersion);
      const current = BigInt(mutation.contentVersion);
      const completed = mutation.completedContentVersion === null
        ? null
        : BigInt(mutation.completedContentVersion);
      if (current < started || (completed !== null && (completed < started || completed > current))) {
        responseInvalid('Mailboxmutatie bevat niet-monotone contentversies.');
      }
      if ((mutation.status === 'pending') !== (completed === null)) {
        responseInvalid('Mailboxmutatiestatus en completed_content_version spreken elkaar tegen.');
      }
      return mutation;
    } catch (error) {
      if (error?.code === 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID') throw error;
      responseInvalid('Mailboxmutatie-RPC gaf een ongeldige response.', error);
    }
  }

  async function beginMutation({
    mutationId = randomUUID(),
    requestKey,
    kind,
    accountEmail = '',
    folder = '',
    leaseSeconds = 120,
  } = {}) {
    const normalizedMutationId = normalizeUuid(mutationId);
    const normalizedRequestKey = normalizeBoundedText(requestKey, 'requestKey', 200);
    const normalizedKind = normalizeBoundedText(kind, 'kind', 120, { lower: true });
    const normalizedLease = Math.max(15, Math.min(900, Math.trunc(Number(leaseSeconds) || 120)));
    const row = await callRpc(MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.beginMutation, {
      p_mutation_id: normalizedMutationId,
      p_request_key: normalizedRequestKey,
      p_mutation_kind: normalizedKind,
      p_account_email: normalizeBoundedText(accountEmail, 'accountEmail', 320, {
        optional: true,
        lower: true,
      }),
      p_folder: normalizeBoundedText(folder, 'folder', 80, { optional: true, lower: true }),
      p_lease_seconds: normalizedLease,
    });
    const mutation = normalizeMutationRow(row, { includeRequestKey: true });
    if (mutation.requestKey !== normalizedRequestKey
      || (!mutation.replayed && mutation.mutationId !== normalizedMutationId)
      || (!mutation.replayed && mutation.status !== 'pending')) {
      responseInvalid('Begin-RPC gaf een conflicterende mutation identity terug.');
    }
    return mutation;
  }

  async function completeMutation({ mutationId, requestKey, result = {} } = {}) {
    const normalizedMutationId = normalizeUuid(mutationId);
    const normalizedRequestKey = normalizeBoundedText(requestKey, 'requestKey', 200);
    let serializedResult;
    try {
      serializedResult = JSON.stringify(result == null ? {} : result);
    } catch (error) {
      invalid(`result is niet JSON-serialiseerbaar: ${error.message}`);
    }
    if (Buffer.byteLength(serializedResult, 'utf8') > 64 * 1024) invalid('result is te groot.');
    const row = await callRpc(MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.completeMutation, {
      p_mutation_id: normalizedMutationId,
      p_request_key: normalizedRequestKey,
      p_result: JSON.parse(serializedResult),
    });
    const mutation = normalizeMutationRow(row);
    if (mutation.mutationId !== normalizedMutationId || mutation.status === 'pending') {
      responseInvalid('Complete-RPC gaf een conflicterende mutation identity terug.');
    }
    return mutation;
  }

  async function getFence({ reapExpired = true } = {}) {
    const row = await callRpc(MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.getFence, {
      p_reap_expired: reapExpired !== false,
    });
    let fence;
    try {
      fence = {
        contentVersion: normalizeVersion(row.content_version, 'content_version'),
        pendingCount: normalizeCount(row.pending_count, 'pending_count'),
        ready: row.ready === true,
        reapedCount: normalizeCount(row.reaped_count, 'reaped_count'),
        checkedAt: normalizeBoundedText(row.checked_at, 'checked_at', 80),
      };
    } catch (error) {
      if (error?.code === 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID') throw error;
      responseInvalid('Mailbox-campagnefence-RPC gaf een ongeldige response.', error);
    }
    if (fence.ready !== (fence.pendingCount === 0)) {
      throw createConsistencyError(
        'Mailbox-campagnefence bevat een tegenstrijdige ready-status.',
        'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID'
      );
    }
    return fence;
  }

  return {
    beginMutation,
    completeMutation,
    getFence,
    isAvailable: () => Boolean(isSupabaseConfigured() && getSupabaseClient()?.rpc),
  };
}

module.exports = {
  MAILBOX_CAMPAIGN_CONSISTENCY_RPCS,
  createMailboxCampaignConsistencyStore,
};
