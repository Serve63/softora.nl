const {
  assertMailboxClientUidValidity,
  createMailboxUidValidityError,
  requireMailboxUidValidity,
} = require('./mailbox-uid-validity');

function createMailboxUidValidityActionGuard(deps = {}) {
  const {
    createClient,
    mailboxIndexStore,
    resolveMailboxName,
    logger = console,
  } = deps;

  async function acquireSyncLease({ account, folder }) {
    if (!mailboxIndexStore || mailboxIndexStore.isAvailable?.() !== true) return null;
    if (
      typeof mailboxIndexStore.acquireSyncLock !== 'function' ||
      typeof mailboxIndexStore.releaseSyncLock !== 'function'
    ) {
      const error = new Error('Mailbox-generatielease is niet beschikbaar.');
      error.code = 'MAILBOX_GENERATION_LEASE_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const previousState = typeof mailboxIndexStore.getSyncState === 'function'
      ? await mailboxIndexStore.getSyncState({ accountEmail: account.email, folder })
      : null;
    const previousStatus = ['idle', 'ok', 'error'].includes(String(previousState?.status || '').toLowerCase())
      ? String(previousState.status).toLowerCase()
      : 'idle';
    const lease = await mailboxIndexStore.acquireSyncLock({
      accountEmail: account.email,
      folder,
      lockTtlMs: 30_000,
    });
    if (lease?.ok === true && lease.lockToken) {
      return { account, folder, previousStatus, previousLastError: previousState?.last_error || '', ...lease };
    }
    const error = lease?.error || new Error(
      lease?.locked ? 'De mailbox wordt bijgewerkt; probeer de actie opnieuw.' : 'Mailbox-generatielease kon niet worden verkregen.'
    );
    error.code ||= lease?.locked ? 'MAILBOX_GENERATION_LEASE_LOCKED' : 'MAILBOX_GENERATION_LEASE_FAILED';
    error.status ||= lease?.locked ? 409 : 503;
    throw error;
  }

  async function releaseResource(resource) {
    try {
      resource?.lock?.release();
    } catch (_) {}
    try {
      if (resource?.client?.usable) await resource.client.logout();
    } catch (_) {}
    if (resource?.syncLease) {
      await mailboxIndexStore.releaseSyncLock({
        accountEmail: resource.syncLease.account.email,
        folder: resource.syncLease.folder,
        lockToken: resource.syncLease.lockToken,
        status: resource.syncLease.previousStatus,
        lastError: resource.syncLease.previousLastError,
      }).then((result) => {
        if (result?.ok !== true) logger.error('[Mailbox][GenerationLeaseRelease]', result?.error?.message || 'lease release failed');
      }).catch((error) => logger.error('[Mailbox][GenerationLeaseRelease]', error?.message || error));
    }
  }

  async function acquireCurrentUidValidity({ account, folder, uidValidity }) {
    const requestedUidValidity = requireMailboxUidValidity(uidValidity);
    let client = null;
    let lock = null;
    let syncLease = null;
    try {
      syncLease = await acquireSyncLease({ account, folder });
      client = createClient(account);
      await client.connect();
      const mailboxName = await resolveMailboxName(client, folder);
      lock = await client.getMailboxLock(mailboxName);
      const currentUidValidity = assertMailboxClientUidValidity(client, requestedUidValidity);
      return {
        client,
        lock,
        currentUidValidity,
        mailboxName,
        syncLease,
      };
    } catch (error) {
      await releaseResource({ client, lock, syncLease });
      throw error;
    }
  }

  async function withCurrentUidValidity(input, action = async () => null) {
    const resource = await acquireCurrentUidValidity(input);
    try {
      return await action(resource.client, resource);
    } finally {
      await releaseResource(resource);
    }
  }

  function getUniqueTargetInputs(targets = []) {
    const seen = new Map();
    const inputs = [];
    for (const target of Array.isArray(targets) ? targets : []) {
      if (!target?.account || target?.messageRef?.folder === 'instantly') continue;
      const uidValidity = requireMailboxUidValidity(target.messageRef.uidValidity);
      const key = `${target.account.email}|${target.messageRef.folder}`;
      if (seen.has(key)) {
        if (seen.get(key) !== uidValidity) {
          throw createMailboxUidValidityError(
            'MAILBOX_UIDVALIDITY_STALE',
            'Het gesprek bevat berichten uit verschillende UIDVALIDITY-generaties.'
          );
        }
        continue;
      }
      seen.set(key, uidValidity);
      inputs.push({
        account: target.account,
        folder: target.messageRef.folder,
        uidValidity,
      });
    }
    return inputs;
  }

  async function withCurrentUidValidities(targets = [], action = async () => null) {
    const resources = [];
    try {
      for (const input of getUniqueTargetInputs(targets)) {
        resources.push(await acquireCurrentUidValidity(input));
      }
      return await action(resources);
    } finally {
      for (const resource of resources.reverse()) await releaseResource(resource);
    }
  }

  async function assertTargetsCurrent(targets = []) {
    return withCurrentUidValidities(targets, async () => true);
  }

  return {
    assertTargetsCurrent,
    withCurrentUidValidity,
    withCurrentUidValidities,
  };
}

module.exports = { createMailboxUidValidityActionGuard };
