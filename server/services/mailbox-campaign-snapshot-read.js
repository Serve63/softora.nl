'use strict';

const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');
const { getMailboxMessageOwner } = require('./mailbox-instantly-integration');

const SNAPSHOT_READ_BUDGET_MS = 3500;
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function createMailboxCampaignSnapshotRead({ getUiStateValues, mailboxIndexStore, filterVisibleMailboxMessages }) {
  return async function readCampaignSnapshot({ owner = '', limit = 200 } = {}) {
    if (typeof getUiStateValues !== 'function'
      || typeof mailboxIndexStore?.listMessageStatesByKeys !== 'function') return null;
    const selectedOwner = String(owner || '').trim().toLowerCase();
    if (selectedOwner && !['serve', 'martijn'].includes(selectedOwner)) return null;
    const deadlineAtMs = Date.now() + SNAPSHOT_READ_BUDGET_MS;
    let timer;
    async function read() {
      const stored = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
        uiStateReadTimeoutMs: 1200,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      });
      const snapshot = parseMailboxCampaignSnapshot(stored?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]);
      const ageMs = Date.now() - Date.parse(snapshot?.savedAt || '');
      if (!snapshot?.ok || !Number.isFinite(ageMs) || ageMs > SNAPSHOT_MAX_AGE_MS
        || ageMs < -60_000 || Date.now() >= deadlineAtMs) return null;
      const candidates = snapshot.messages.filter((message) => (
        selectedOwner ? getMailboxMessageOwner(message) === selectedOwner : Boolean(getMailboxMessageOwner(message))
      )).slice(0, Math.max(1, Math.min(200, Number(limit) || 200)));
      if (!candidates.length) return null;
      const messageKeys = candidates.flatMap((message) => [message, ...message.threadMessages])
        .map((message) => message.messageKey).filter(Boolean);
      const rows = await mailboxIndexStore.listMessageStatesByKeys({ messageKeys, deadlineAtMs });
      if (!Array.isArray(rows)) return null;
      const states = new Map(rows.filter((row) => !row.deleted_at && !row.generation_superseded_at)
        .map((row) => [`${row.account_email}|${row.message_key}`, row]));
      function reconcile(message, fallbackAccount = '') {
        const account = message.accountEmail || fallbackAccount;
        const state = states.get(`${account}|${message.messageKey}`);
        // A snapshot is a presentation cache, never proof that a message still
        // exists. Missing identities (including synthetic history) wait for the
        // canonical refresh instead of reviving hidden or superseded messages.
        if (!state) return null;
        return {
          ...message,
          unread: Boolean(state.unread) && !state.softora_read_at,
          readAt: state.softora_read_at || '',
          replyDismissedAt: state.reply_dismissed_at || '',
          stateRevision: Math.max(0, Number(state.state_revision) || 0),
          stateMutationKey: state.state_mutation_key || '',
          stateMutationAt: state.state_mutation_at || '',
          starred: Boolean(state.starred),
        };
      }
      const messages = candidates.flatMap((message) => {
        const root = reconcile(message);
        if (!root) return [];
        return [{ ...root, threadMessages: message.threadMessages
          .map((entry) => reconcile(entry, message.accountEmail)).filter(Boolean) }];
      });
      return {
        ok: true,
        owner: selectedOwner,
        savedAt: snapshot.savedAt,
        fromSnapshot: true,
        messages: filterVisibleMailboxMessages(messages),
        sync: {
          ...snapshot.sync,
          indexed: true,
          stale: true,
          source: 'campaign-replies-snapshot',
          refreshRecommended: true,
          warming: false,
        },
      };
    }
    try {
      return await Promise.race([
        read(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), SNAPSHOT_READ_BUDGET_MS); }),
      ]);
    } catch (_error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createMailboxCampaignSnapshotRead };
