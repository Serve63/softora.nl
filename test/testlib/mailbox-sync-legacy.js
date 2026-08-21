const LEGACY_PROTOCOL_CHANGED_AT = '2026-08-21T00:00:00.000Z';

function getFutureLeaseExpiry() {
  return new Date(Date.now() + 10 * 60_000).toISOString();
}

function createMailboxSyncLegacyStore(store = {}) {
  const source = store && typeof store === 'object' ? store : {};
  return {
    ...source,
    async getUidGenerationProtocol() {
      return {
        ok: true,
        protocol: 'legacy',
        protocolChangedAt: LEGACY_PROTOCOL_CHANGED_AT,
        drainStartedAt: '',
        drainReadyAt: '',
        drainReady: false,
      };
    },
    async acquireSyncLockForProtocol(options = {}) {
      const acquired = typeof source.acquireSyncLock === 'function'
        ? await source.acquireSyncLock(options)
        : { ok: true, locked: false, lockToken: 'legacy-test-lock' };
      return {
        ...acquired,
        protocolMode: 'legacy',
        ...(acquired?.ok
          ? { lockExpiresAt: acquired.lockExpiresAt || getFutureLeaseExpiry() }
          : {}),
      };
    },
    async failSync() {
      throw new Error('Legacy testpad mag v2-fail niet gebruiken.');
    },
  };
}

module.exports = {
  createMailboxSyncLegacyStore,
};
