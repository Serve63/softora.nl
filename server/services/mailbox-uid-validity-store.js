const { normalizeMailboxUidValidity } = require('./mailbox-uid-validity');

function createMailboxUidValidityStore({ run, buildSyncKey, normalizeString } = {}) {
  async function prepareUidValidity({
    accountEmail, folder = 'inbox', lockToken = '', uidValidity = 0, signal,
  } = {}) {
    const generation = normalizeMailboxUidValidity(uidValidity);
    const normalizedLockToken = normalizeString(lockToken);
    if (!generation || !normalizedLockToken) {
      const error = new Error('UIDVALIDITY-voorbereiding mist een geldige generatie of lease.');
      error.code = 'MAILBOX_SYNC_UIDVALIDITY_INVALID';
      return { ok: false, lockLost: !normalizedLockToken, error };
    }
    const result = await run('prepare-uid-validity', (client) => client.rpc(
      'softora_prepare_mailbox_uid_validity',
      {
        p_sync_key: buildSyncKey(accountEmail, folder),
        p_lock_token: normalizedLockToken,
        p_uid_validity: generation,
      }
    ), { signal, mutation: true });
    if (!result.ok) return result;
    const row = Array.isArray(result.data)
      ? (result.data.length === 1 ? result.data[0] : null)
      : result.data;
    if (
      row?.applied === true
      && row?.lock_lost !== true
      && normalizeMailboxUidValidity(row.current_uid_validity) === generation
    ) {
      return {
        ok: true,
        adoptedLegacy: row.adopted_legacy === true,
        previousUidValidity: normalizeMailboxUidValidity(row.previous_uid_validity),
        resetDetected: row.reset_detected === true,
        supersededCount: Math.max(0, Number(row.superseded_count) || 0),
        uidValidity: generation,
      };
    }
    const error = new Error('UIDVALIDITY-voorbereiding verloor zijn exacte mailboxlease.');
    error.code = 'MAILBOX_SYNC_LOCK_LOST';
    return { ok: false, lockLost: true, data: result.data, error };
  }

  return { prepareUidValidity };
}

module.exports = { createMailboxUidValidityStore };
