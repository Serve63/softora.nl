'use strict';

const { createHash } = require('node:crypto');
const { MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE } = require('./mailbox-campaign-snapshot');

const REVISION_SCOPE = 'premium_mailbox_campaign_snapshot_revision';
const REVISION_KEY = 'content_revision_v1';
const MAX_REBUILD_INTERVAL_MS = 2 * 60 * 60 * 1000;
const READ_OPTIONS = Object.freeze({
  uiStateReadTimeoutMs: 1200,
  bypassReadFailureCooldown: true,
  suppressReadFailureCooldown: true,
  suppressReadFailureLog: true,
  preferSupabaseRestRead: true,
  ignoreSupabaseRestFailureCooldown: true,
  suppressSupabaseRestFailureCooldown: true,
});

function getSyncContentRevision(results, configured = true) {
  if (!configured) return 'not-configured';
  if (!Array.isArray(results) || results.length !== 2
    || results.some((result) => !result?.contentRevision || !['serve', 'martijn'].includes(result.owner))) return '';
  const owners = new Set(results.map((result) => result.owner));
  if (owners.size !== 2) return '';
  return createHash('sha256').update(results
    .map((result) => `${result.owner}:${result.contentRevision}`)
    .sort()
    .join('\n')).digest('hex');
}

function createMailboxCampaignSnapshotRefresh({ getUiStateValues, setUiStateValues, rebuild, now = Date.now } = {}) {
  if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function'
    || typeof rebuild !== 'function') throw new TypeError('Mailbox snapshot refresh requires durable state and a rebuild.');

  return async function refreshAfterSync({ results = [], configured = true, force = false } = {}) {
    const syncRevision = getSyncContentRevision(results, configured);
    const [snapshotMeta, revisionState] = await Promise.all([
      getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, { ...READ_OPTIONS, metadataOnly: true }),
      getUiStateValues(REVISION_SCOPE, READ_OPTIONS),
    ]);
    const stored = revisionState?.values?.[REVISION_KEY];
    let last = null;
    try { last = JSON.parse(stored || 'null'); } catch (_) { /* rebuild when the marker is invalid */ }
    const ageMs = now() - Date.parse(last?.builtAt || '');
    const snapshotExists = snapshotMeta?.source === 'supabase' && snapshotMeta.exists === true;
    const canSkip = !force && syncRevision && snapshotExists
      && revisionState?.source === 'supabase' && revisionState.exists !== false
      && last?.version === 1 && last.dirty !== true && last.contentRevision === syncRevision
      && last.snapshotRevision === snapshotMeta.revision
      && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < MAX_REBUILD_INTERVAL_MS;
    if (canSkip) return { skipped: true, reason: 'unchanged-content' };

    // The marker is written only after the complete presentation snapshot is
    // durable. A failed build or marker write is retried at the next sync.
    if (force) {
      const invalidated = await setUiStateValues(REVISION_SCOPE, {
        [REVISION_KEY]: JSON.stringify({ ...last, version: 1, dirty: true }),
      }, { source: 'mailbox-campaign-snapshot-invalidate', actor: 'Mailbox index' });
      if (invalidated?.source !== 'supabase') throw new Error('Mailbox-snapshot kon niet veilig ongeldig worden gemaakt.');
    }
    await rebuild();
    const persistedSnapshot = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
      ...READ_OPTIONS, metadataOnly: true,
    });
    if (persistedSnapshot?.source !== 'supabase' || persistedSnapshot.exists !== true) {
      throw new Error('Volledige mailboxweergave is niet duurzaam bevestigd.');
    }
    const written = await setUiStateValues(REVISION_SCOPE, {
      [REVISION_KEY]: JSON.stringify({
        version: 1,
        contentRevision: syncRevision || last?.contentRevision || '',
        snapshotRevision: persistedSnapshot.revision,
        builtAt: new Date(now()).toISOString(),
      }),
    }, { source: 'mailbox-campaign-snapshot-refresh', actor: 'Mailbox index' });
    if (written?.source !== 'supabase') throw new Error('Mailbox-snapshotrevisie kon niet duurzaam worden opgeslagen.');
    return { skipped: false, reason: 'rebuilt' };
  };
}

module.exports = {
  createMailboxCampaignSnapshotRefresh,
  getSyncContentRevision,
  MAX_REBUILD_INTERVAL_MS,
  REVISION_KEY,
  REVISION_SCOPE,
};
