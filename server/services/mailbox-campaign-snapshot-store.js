const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  getMailboxCampaignSnapshotAgeMs,
  isMailboxCampaignSnapshotInvalidated,
  markMailboxCampaignSnapshotStale,
  parseMailboxCampaignSnapshot,
  parseMailboxCampaignSnapshotInvalidatedAt,
  serializeMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');
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
function createMailboxCampaignSnapshotStore(deps = {}) {
  const {
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    logger = console,
    now = () => new Date(),
    maxStaleMs = MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
  } = deps;
  let localInvalidatedAt = '';
  async function persist(result, options = {}) {
    const savedAt = Number.isFinite(Date.parse(options.savedAt || ''))
      ? new Date(options.savedAt).toISOString()
      : now().toISOString();
    const contentAt = Number.isFinite(Date.parse(options.contentAt || result && result.contentAt || ''))
      ? new Date(options.contentAt || result.contentAt).toISOString()
      : savedAt;
    const serialized = serializeMailboxCampaignSnapshot(result, { savedAt, contentAt });
    if (!serialized) return { ok: false, savedAt, reason: 'empty' };
    try {
      const saved = await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serialized },
        {
          source: normalizeText(options.source) || 'mailbox-campaign-replies',
          actor: normalizeText(options.actor) || 'Mailbox index',
        }
      );
      if (!saved) return { ok: false, savedAt, reason: 'write_failed' };
      return { ok: true, savedAt };
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshot]', error?.message || error);
      return { ok: false, savedAt, reason: 'write_failed', error };
    }
  }
  async function readInvalidatedAt() {
    const result = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE, {
      uiStateReadTimeoutMs: 1000,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressReadFailureLog: true,
      preferSupabaseRestRead: true,
      ignoreSupabaseRestFailureCooldown: true,
      suppressSupabaseRestFailureCooldown: true,
    });
    if (!result || !result.values) throw new Error('Mailbox-snapshot invalidatiecontrole niet beschikbaar');
    const remote = parseMailboxCampaignSnapshotInvalidatedAt(result.values[MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]);
    return !localInvalidatedAt || Date.parse(remote) >= Date.parse(localInvalidatedAt) ? remote : localInvalidatedAt;
  }
  async function invalidate(options = {}) {
    const invalidatedAt = parseMailboxCampaignSnapshotInvalidatedAt(options.at) || now().toISOString();
    if (!localInvalidatedAt || Date.parse(invalidatedAt) > Date.parse(localInvalidatedAt)) localInvalidatedAt = invalidatedAt;
    try {
      const saved = await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]: invalidatedAt },
        {
          source: normalizeText(options.source) || 'mailbox-index-upsert',
          actor: normalizeText(options.actor) || 'Mailbox index',
        }
      );
      return saved ? { ok: true, invalidatedAt } : { ok: false, invalidatedAt, reason: 'write_failed' };
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshotInvalidation]', error?.message || error);
      return { ok: false, invalidatedAt, reason: 'write_failed', error };
    }
  }
  async function readDegraded({ owner = '', reason = 'index_unavailable' } = {}) {
    const requestedOwner = normalizeText(owner).toLowerCase().replace('servé', 'serve');
    if (requestedOwner && !['serve', 'martijn', 'both', 'all'].includes(requestedOwner)) return null;
    const selectedOwner = ['both', 'all'].includes(requestedOwner) ? '' : requestedOwner;
    try {
      const [result, invalidatedAt] = await Promise.all([getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
        uiStateReadTimeoutMs: 1000,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      }), readInvalidatedAt()]);
      const snapshot = parseMailboxCampaignSnapshot(
        result && result.values && result.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
      );
      if (!snapshot) return null;
      if (isMailboxCampaignSnapshotInvalidated(snapshot, invalidatedAt)) return null;
      if (getMailboxCampaignSnapshotAgeMs(snapshot, now()) > Math.max(0, Number(maxStaleMs) || 0)) {
        return null;
      }
      const degraded = markMailboxCampaignSnapshotStale(snapshot, reason);
      const messages = filterSnapshotMessagesByOwner(degraded.messages, selectedOwner);
      return { ...degraded, messages, owner: normalizeOwner(selectedOwner) || 'both' };
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSnapshotFallback]', error?.message || error);
      return null;
    }
  }
  return { invalidate, persist, readDegraded, readInvalidatedAt };
}
module.exports = { createMailboxCampaignSnapshotStore, filterSnapshotMessagesByOwner, getMessageOwner };
