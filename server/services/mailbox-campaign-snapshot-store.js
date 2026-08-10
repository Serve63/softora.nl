const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  getMailboxCampaignSnapshotAgeMs,
  markMailboxCampaignSnapshotStale,
  normalizeMailboxCampaignContentVersion,
  parseMailboxCampaignSnapshot,
  parseMailboxCampaignSnapshotInvalidatedAt,
  serializeMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');
const {
  createMailboxCampaignConsistencyStore,
} = require('../repositories/mailbox-campaign-consistency-store');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

const SNAPSHOT_READ_OPTIONS = Object.freeze({
  uiStateReadTimeoutMs: 1000,
  bypassReadFailureCooldown: true,
  suppressReadFailureCooldown: true,
  suppressReadFailureLog: true,
  preferSupabaseRestRead: true,
  ignoreSupabaseRestFailureCooldown: true,
  suppressSupabaseRestFailureCooldown: true,
});

function normalizeText(value) { return String(value || '').trim(); }
function normalizeOwner(value) {
  const owner = normalizeText(value).toLowerCase().replace('servé', 'serve');
  return ['serve', 'martijn'].includes(owner) ? owner : '';
}
function getMessageOwner(message) {
  const providerOwner = normalizeOwner(message && (
    message.providerOwner || message.outreach && message.outreach.owner
  ));
  if (providerOwner) return providerOwner;
  const copyContext = message && message.copyContext;
  const accountEmail = normalizeText(
    copyContext && copyContext.evidenceKnown === true
      ? copyContext.sourceAccountEmail
      : message && (message.accountEmail || message.campaign && message.campaign.account)
  ).toLowerCase();
  return getOutboundSenderIdentity(accountEmail)?.profileKey || '';
}
function filterSnapshotMessagesByOwner(messages, owner) {
  const selectedOwner = normalizeOwner(owner);
  const source = Array.isArray(messages) ? messages : [];
  return selectedOwner
    ? source.filter((message) => getMessageOwner(message) === selectedOwner)
    : source;
}

function compareContentVersions(left, right) {
  const normalizedLeft = normalizeMailboxCampaignContentVersion(left);
  const normalizedRight = normalizeMailboxCampaignContentVersion(right);
  if (normalizedLeft === null || normalizedRight === null) return null;
  const leftValue = BigInt(normalizedLeft);
  const rightValue = BigInt(normalizedRight);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function createSnapshotInvalidationTimeoutError() {
  const error = new Error('Mailbox-snapshot invalidatie overschreed de syncdeadline.');
  error.code = 'MAILBOX_SYNC_FOLDER_TIMEOUT';
  error.status = 504;
  error.timedOut = true;
  return error;
}

async function awaitSnapshotInvalidation(promise, { signal, deadlineAt = 0 } = {}) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason : createSnapshotInvalidationTimeoutError();
  const remainingMs = Number(deadlineAt) > 0 ? Number(deadlineAt) - Date.now() : 0;
  if (Number(deadlineAt) > 0 && remainingMs <= 0) throw createSnapshotInvalidationTimeoutError();
  let timer = null;
  let abortHandler = null;
  const stops = [];
  if (signal) stops.push(new Promise((_resolve, reject) => {
    abortHandler = () => reject(signal.reason instanceof Error
      ? signal.reason : createSnapshotInvalidationTimeoutError());
    signal.addEventListener('abort', abortHandler, { once: true });
  }));
  if (remainingMs > 0) stops.push(new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(createSnapshotInvalidationTimeoutError()), remainingMs);
  }));
  try {
    return await Promise.race([Promise.resolve(promise), ...stops]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

function createMailboxCampaignSnapshotStore(deps = {}) {
  const {
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    compareAndSwapUiStateValues = async () => ({ ok: false, unavailable: true }),
    logger = console,
    now = () => new Date(),
    maxStaleMs = MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
  } = deps;
  const consistencyStore = deps.mailboxCampaignConsistencyStore ||
    createMailboxCampaignConsistencyStore({
      isSupabaseConfigured: deps.isSupabaseConfigured,
      getSupabaseClient: deps.getSupabaseClient,
      logger,
    });
  let localInvalidatedAt = '';

  async function getFence(options = {}) {
    return consistencyStore.getFence(options);
  }

  async function readSnapshotState({ includeRevision = false } = {}) {
    return getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
      ...SNAPSHOT_READ_OPTIONS,
      ...(includeRevision ? { includeRevision: true } : {}),
    });
  }

  function fenceMatchesVersion(fence, contentVersion) {
    return Boolean(
      fence &&
      fence.ready === true &&
      Number(fence.pendingCount) === 0 &&
      compareContentVersions(fence.contentVersion, contentVersion) === 0
    );
  }

  function rejectPersist(savedAt, reason, extra = {}) {
    return { ok: false, savedAt, reason, ...extra };
  }

  async function persist(result, options = {}) {
    const savedAt = Number.isFinite(Date.parse(options.savedAt || ''))
      ? new Date(options.savedAt).toISOString()
      : now().toISOString();
    const contentAt = Number.isFinite(Date.parse(options.contentAt || result && result.contentAt || ''))
      ? new Date(options.contentAt || result.contentAt).toISOString()
      : savedAt;
    const contentVersion = normalizeMailboxCampaignContentVersion(
      options.contentVersion ?? result?.contentVersion ?? result?.sync?.contentVersion
    );
    if (contentVersion === null) return rejectPersist(savedAt, 'content_version_missing');

    let fenceBefore;
    try {
      fenceBefore = await getFence();
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshotFence]', error?.message || error);
      return rejectPersist(savedAt, 'consistency_unavailable', { error });
    }
    if (fenceBefore.ready !== true || Number(fenceBefore.pendingCount) > 0) {
      return rejectPersist(savedAt, 'mutation_pending', { fence: fenceBefore });
    }
    if (!fenceMatchesVersion(fenceBefore, contentVersion)) {
      return rejectPersist(savedAt, 'content_version_mismatch', { fence: fenceBefore });
    }

    const serialized = serializeMailboxCampaignSnapshot(result, {
      savedAt,
      contentAt,
      contentVersion,
    });
    if (!serialized) return rejectPersist(savedAt, 'empty');

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await readSnapshotState({ includeRevision: true });
        if (!current || current.source !== 'supabase') {
          return rejectPersist(savedAt, 'snapshot_state_unavailable');
        }
        const currentSnapshot = parseMailboxCampaignSnapshot(
          current.values && current.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
        );
        if (currentSnapshot) {
          const versionOrder = compareContentVersions(currentSnapshot.contentVersion, contentVersion);
          if (versionOrder > 0) {
            return rejectPersist(savedAt, 'stale_content_version', {
              currentContentVersion: currentSnapshot.contentVersion,
            });
          }
          const currentContentAt = Date.parse(currentSnapshot.contentAt || '');
          const candidateContentAt = Date.parse(contentAt);
          if (versionOrder === 0 && currentContentAt > candidateContentAt) {
            return rejectPersist(savedAt, 'stale_snapshot');
          }
        }

        const expectedRevision = Number.isSafeInteger(Number(current.revision))
          ? Number(current.revision)
          : 0;
        const saved = await compareAndSwapUiStateValues(
          MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
          { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serialized },
          {
            expectedRevision,
            expectedUpdatedAt: current.exists ? current.updatedAt || null : null,
            source: normalizeText(options.source) || 'mailbox-campaign-replies',
            actor: normalizeText(options.actor) || 'Mailbox index',
          }
        );
        if (saved?.ok === true) {
          let fenceAfter;
          try {
            fenceAfter = await getFence();
          } catch (error) {
            logger.warn?.('[Mailbox][CampaignSnapshotFenceAfterWrite]', error?.message || error);
            return rejectPersist(savedAt, 'consistency_unavailable_after_write', { error });
          }
          if (!fenceMatchesVersion(fenceAfter, contentVersion)) {
            return rejectPersist(savedAt, 'consistency_changed_after_write', { fence: fenceAfter });
          }
          return {
            ok: true,
            savedAt,
            contentVersion,
            revision: Number(saved.revision) || expectedRevision + 1,
          };
        }
        if (!saved?.conflict) {
          return rejectPersist(savedAt, 'write_failed', { result: saved || null });
        }
      }
      return rejectPersist(savedAt, 'write_conflict');
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshot]', error?.message || error);
      return rejectPersist(savedAt, 'write_failed', { error });
    }
  }

  async function readInvalidatedAt() {
    const result = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE, {
      ...SNAPSHOT_READ_OPTIONS,
    });
    if (!result || !result.values) throw new Error('Mailbox-snapshot invalidatiecontrole niet beschikbaar');
    const remote = parseMailboxCampaignSnapshotInvalidatedAt(
      result.values[MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]
    );
    return !localInvalidatedAt || Date.parse(remote) >= Date.parse(localInvalidatedAt)
      ? remote
      : localInvalidatedAt;
  }

  // Timestamp invalidation remains only for rolling compatibility with the v2
  // runtime. All v3 authority decisions use content_version and the DB fence.
  async function invalidate(options = {}) {
    const invalidatedAt = parseMailboxCampaignSnapshotInvalidatedAt(options.at) || now().toISOString();
    try {
      const saved = await awaitSnapshotInvalidation(setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]: invalidatedAt },
        {
          source: normalizeText(options.source) || 'mailbox-index-upsert',
          actor: normalizeText(options.actor) || 'Mailbox index',
          signal: options.signal,
          deadlineAt: options.deadlineAt,
        }
      ), options);
      if (saved && (!localInvalidatedAt || Date.parse(invalidatedAt) > Date.parse(localInvalidatedAt))) {
        localInvalidatedAt = invalidatedAt;
      }
      return saved
        ? { ok: true, invalidatedAt }
        : { ok: false, invalidatedAt, reason: 'write_failed' };
    } catch (error) {
      if (options.signal?.aborted || error?.timedOut === true) throw error;
      logger.warn?.('[Mailbox][CampaignSnapshotInvalidation]', error?.message || error);
      return { ok: false, invalidatedAt, reason: 'write_failed', error };
    }
  }

  async function readDegraded({ owner = '', reason = 'index_unavailable' } = {}) {
    const requestedOwner = normalizeText(owner).toLowerCase().replace('servé', 'serve');
    if (requestedOwner && !['serve', 'martijn', 'both', 'all'].includes(requestedOwner)) return null;
    const selectedOwner = ['both', 'all'].includes(requestedOwner) ? '' : requestedOwner;
    let snapshot;
    try {
      const result = await readSnapshotState();
      snapshot = parseMailboxCampaignSnapshot(
        result && result.values && result.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
      );
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshotFallbackRead]', error?.message || error);
      return null;
    }
    if (!snapshot) return null;
    if (getMailboxCampaignSnapshotAgeMs(snapshot, now()) > Math.max(0, Number(maxStaleMs) || 0)) {
      return null;
    }

    let fence = null;
    let degradedReason = reason;
    try {
      fence = await getFence();
      if (fence.ready !== true || Number(fence.pendingCount) > 0) {
        degradedReason = 'campaign_mutation_pending';
      } else if (!fenceMatchesVersion(fence, snapshot.contentVersion)) {
        degradedReason = 'content_version_mismatch';
      }
    } catch (error) {
      degradedReason = 'campaign_consistency_unavailable';
      logger.warn?.('[Mailbox][CampaignSnapshotFallbackFence]', error?.message || error);
    }

    const degraded = markMailboxCampaignSnapshotStale(snapshot, degradedReason);
    const messages = filterSnapshotMessagesByOwner(degraded.messages, selectedOwner);
    return {
      ...degraded,
      messages,
      owner: normalizeOwner(selectedOwner) || 'both',
      sync: {
        ...degraded.sync,
        contentVersion: snapshot.contentVersion,
        consistency: {
          verified: Boolean(fence),
          ready: fence?.ready === true,
          pendingCount: Number(fence?.pendingCount) || 0,
          currentContentVersion: fence?.contentVersion || null,
          snapshotMatches: fenceMatchesVersion(fence, snapshot.contentVersion),
          reason: degradedReason,
        },
      },
    };
  }

  return {
    getFence,
    invalidate,
    persist,
    readDegraded,
    readInvalidatedAt,
    isAvailable: () => consistencyStore.isAvailable?.() === true,
  };
}

module.exports = {
  compareContentVersions,
  createMailboxCampaignSnapshotStore,
  filterSnapshotMessagesByOwner,
  getMessageOwner,
};
