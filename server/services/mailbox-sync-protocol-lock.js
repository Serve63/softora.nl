const crypto = require('crypto');

const MAILBOX_UID_PROTOCOL_LEGACY = 'legacy';
const MAILBOX_UID_PROTOCOL_DRAINING = 'draining';
const MAILBOX_UID_PROTOCOL_V2 = 'v2';
const MAILBOX_UID_PROTOCOLS = Object.freeze([
  MAILBOX_UID_PROTOCOL_LEGACY,
  MAILBOX_UID_PROTOCOL_DRAINING,
  MAILBOX_UID_PROTOCOL_V2,
]);

function normalizeMailboxUidProtocol(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MAILBOX_UID_PROTOCOLS.includes(normalized) ? normalized : '';
}

function createMailboxUidProtocolError(message = 'Mailbox UID-protocol gaf een ongeldig antwoord.') {
  const error = new Error(message);
  error.code = 'MAILBOX_UID_PROTOCOL_INVALID';
  return error;
}

function createMailboxSyncProtocolLockStore({
  runDurableWrite,
  buildSyncKey,
  normalizeEmail,
  normalizeFolder,
  normalizeString,
  syncLockTtlMs = 90_000,
  createLockToken = () => (
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex')
  ),
} = {}) {
  function parseProtocolRow(data) {
    const row = Array.isArray(data) ? data[0] : data;
    const protocol = normalizeMailboxUidProtocol(row && row.protocol);
    if (!row || !protocol) return null;
    return {
      protocol,
      protocolChangedAt: normalizeString(row.protocol_changed_at),
      drainStartedAt: normalizeString(row.drain_started_at),
      drainReadyAt: normalizeString(row.drain_ready_at),
      drainReady: row.drain_ready === true,
    };
  }

  function normalizeClaimResult({ claim, syncKey, lockToken, protocolMode }) {
    if (!claim || claim.acquired !== true) {
      const lockExpiresAt = normalizeString(claim && claim.lock_expires_at);
      return {
        ok: false,
        locked: Boolean(claim && claim.locked),
        syncKey,
        protocolMode,
        contention: lockExpiresAt ? 'active_lock' : 'capacity',
        ...(lockExpiresAt ? { lockExpiresAt } : {}),
      };
    }
    return {
      ok: true,
      locked: false,
      syncKey,
      protocolMode,
      lockToken: normalizeString(claim.claimed_lock_token) || lockToken,
      lockExpiresAt: normalizeString(claim.lock_expires_at),
    };
  }

  async function claimSyncLock({
    accountEmail,
    folder = 'inbox',
    force = false,
    lockTtlMs = syncLockTtlMs,
    protocolMode = MAILBOX_UID_PROTOCOL_LEGACY,
    explicitProtocol = false,
  } = {}) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const lockToken = createLockToken();
    const args = {
      p_sync_key: syncKey,
      p_account_email: normalizeEmail(accountEmail),
      p_folder: normalizeFolder(folder),
      p_lock_token: lockToken,
      p_lock_ttl_seconds: Math.ceil(
        Math.max(10_000, Number(lockTtlMs) || syncLockTtlMs) / 1000
      ),
      p_force: Boolean(force),
      ...(explicitProtocol ? { p_protocol: protocolMode } : {}),
    };
    const result = await runDurableWrite('acquire-sync-lock', (client) =>
      client.rpc('softora_claim_mailbox_sync_lock', args)
    );
    if (!result.ok) {
      return { ok: false, locked: false, syncKey, protocolMode, error: result.error };
    }
    const claim = Array.isArray(result.data) ? result.data[0] : result.data;
    return normalizeClaimResult({ claim, syncKey, lockToken, protocolMode });
  }

  async function acquireSyncLock(options = {}) {
    return claimSyncLock({
      ...options,
      protocolMode: MAILBOX_UID_PROTOCOL_LEGACY,
      explicitProtocol: false,
    });
  }

  async function acquireSyncLockForProtocol(options = {}) {
    const syncKey = buildSyncKey(options.accountEmail, options.folder || 'inbox');
    const protocolResult = await runDurableWrite(
      'get-uid-generation-protocol',
      (client) => client.rpc('softora_get_mailbox_uid_generation_protocol', {})
    );
    if (!protocolResult.ok) {
      return {
        ok: false,
        locked: false,
        syncKey,
        protocolMode: '',
        error: protocolResult.error,
      };
    }
    const protocolState = parseProtocolRow(protocolResult.data);
    if (!protocolState) {
      return {
        ok: false,
        locked: false,
        syncKey,
        protocolMode: '',
        error: createMailboxUidProtocolError(),
      };
    }
    if (protocolState.protocol === MAILBOX_UID_PROTOCOL_DRAINING) {
      return {
        ok: false,
        locked: true,
        syncKey,
        protocolMode: protocolState.protocol,
        contention: 'active_lock',
        drainReady: protocolState.drainReady,
        ...(protocolState.drainReadyAt ? { lockExpiresAt: protocolState.drainReadyAt } : {}),
      };
    }
    const claimed = await claimSyncLock({
      ...options,
      protocolMode: protocolState.protocol,
      explicitProtocol: true,
    });
    return {
      ...claimed,
      protocolChangedAt: protocolState.protocolChangedAt,
      drainStartedAt: protocolState.drainStartedAt,
      drainReadyAt: protocolState.drainReadyAt,
    };
  }

  return {
    acquireSyncLock,
    acquireSyncLockForProtocol,
  };
}

module.exports = {
  MAILBOX_UID_PROTOCOL_DRAINING,
  MAILBOX_UID_PROTOCOL_LEGACY,
  MAILBOX_UID_PROTOCOL_V2,
  createMailboxSyncProtocolLockStore,
  createMailboxUidProtocolError,
  normalizeMailboxUidProtocol,
};
