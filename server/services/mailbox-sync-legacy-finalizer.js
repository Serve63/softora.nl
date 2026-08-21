'use strict';

function createMailboxLegacySyncFinalizer({
  runDurableWrite,
  buildSyncKey,
  normalizeString,
  truncateText,
  isoNow,
} = {}) {
  return async function finishSync({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    messageCount = 0,
    lastUid = 0,
    error = '',
  } = {}) {
    const failed = Boolean(normalizeString(error));
    const patch = {
      status: failed ? 'error' : 'ok',
      last_error: failed ? truncateText(normalizeString(error), 1000) : null,
      lock_token: null,
      lock_expires_at: null,
      updated_at: isoNow(),
    };
    if (!failed) Object.assign(patch, {
      message_count: Math.max(0, Number(messageCount) || 0),
      last_uid: Math.max(0, Number(lastUid) || 0),
      last_synced_at: isoNow(),
    });
    return runDurableWrite(
      'finish-sync',
      (client) => client
        .from('softora_mailbox_sync_state')
        .update(patch)
        .eq('sync_key', buildSyncKey(accountEmail, folder))
        .eq('lock_token', normalizeString(lockToken))
    );
  };
}

module.exports = {
  createMailboxLegacySyncFinalizer,
};
