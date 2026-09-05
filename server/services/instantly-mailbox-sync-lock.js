'use strict';

function syncLockError(code, message) {
  return Object.assign(new Error(message), { code, status: 503, retryable: true });
}

async function acquireInstantlyMailboxSyncLock(store, { accountEmail, now = Date.now }) {
  if (typeof store?.acquireSyncLockForProtocol !== 'function') {
    throw syncLockError('INSTANTLY_SYNC_LOCK_FAILED', 'Duurzame Instantly-protocolcontrole ontbreekt.');
  }
  const options = { accountEmail, folder: 'instantly' };
  const lock = await store.acquireSyncLockForProtocol(options);
  if (!['legacy', 'v2'].includes(lock?.protocolMode)) {
    throw syncLockError('INSTANTLY_SYNC_PROTOCOL_UNAVAILABLE', 'Mailboxprotocol is tijdelijk niet beschikbaar voor Instantly.');
  }
  if (lock.ok && String(lock.lockToken || '').trim()) return lock;
  if (lock.locked && lock.contention === 'active_lock') {
    // A protocol mismatch also returns a blocked-until timestamp. Only an
    // actual, unexpired owner lease proves another provider sync is running.
    const state = await store.getSyncState(options);
    if (state?.status === 'syncing' && state.lock_token && Date.parse(state.lock_expires_at) > now()) {
      return { ...lock, ok: false };
    }
  }
  throw syncLockError(
    lock?.contention === 'capacity' ? 'INSTANTLY_SYNC_CAPACITY_BUSY' : 'INSTANTLY_SYNC_LOCK_FAILED',
    'Instantly-sync kon geen duurzame lock verkrijgen.'
  );
}

module.exports = { acquireInstantlyMailboxSyncLock };
