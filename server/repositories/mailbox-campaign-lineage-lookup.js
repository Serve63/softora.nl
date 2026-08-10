'use strict';

const MAILBOX_CAMPAIGN_LINEAGE_MAX_ACCOUNTS = 12;
const MAILBOX_CAMPAIGN_LINEAGE_MAX_DEPTH = 20;
const MAILBOX_CAMPAIGN_LINEAGE_MAX_REPLIES = 200;
const MAILBOX_CAMPAIGN_LINEAGE_MAX_RESULTS = 9000;
const MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS = 8000;
const MAILBOX_CAMPAIGN_LINEAGE_MAX_DEADLINE_MS = 8000;

function createLineageError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  return error;
}

function createMailboxCampaignLineageLookup(deps = {}) {
  const {
    run,
    normalizeString,
    normalizeEmail,
    normalizeMessageRow,
  } = deps;

  return async function listCampaignLineageMessages({
    accountEmails = [],
    replyLimit = MAILBOX_CAMPAIGN_LINEAGE_MAX_REPLIES,
    maxDepth = MAILBOX_CAMPAIGN_LINEAGE_MAX_DEPTH,
    maxResults = MAILBOX_CAMPAIGN_LINEAGE_MAX_RESULTS,
    deadlineMs = MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS,
    beforeMessageDate = '',
    beforeMessageKey = '',
    beforeDiscoveredAt = '',
    beforeDiscoveredKey = '',
  } = {}) {
    const normalizedAccounts = Array.from(new Set(
      (Array.isArray(accountEmails) ? accountEmails : [])
        .map(normalizeEmail)
        .filter(Boolean)
    ));
    if (normalizedAccounts.length > MAILBOX_CAMPAIGN_LINEAGE_MAX_ACCOUNTS) {
      throw createLineageError(
        'Campagne-lineage bevat te veel mailboxaccounts.',
        'MAILBOX_CAMPAIGN_LINEAGE_ACCOUNT_LIMIT'
      );
    }
    if (!normalizedAccounts.length) return [];

    const safeReplyLimit = Math.max(
      1,
      Math.min(MAILBOX_CAMPAIGN_LINEAGE_MAX_REPLIES, Math.floor(Number(replyLimit) || 0))
    );
    const safeDepth = Math.max(
      1,
      Math.min(MAILBOX_CAMPAIGN_LINEAGE_MAX_DEPTH, Math.floor(Number(maxDepth) || 0))
    );
    const safeMaxResults = Math.max(
      1,
      Math.min(MAILBOX_CAMPAIGN_LINEAGE_MAX_RESULTS, Math.floor(Number(maxResults) || 0))
    );
    const safeDeadlineMs = Math.max(
      250,
      Math.min(
        MAILBOX_CAMPAIGN_LINEAGE_MAX_DEADLINE_MS,
        Math.floor(Number(deadlineMs) || MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS)
      )
    );
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const abortTimer = abortController
      ? setTimeout(() => abortController.abort(), safeDeadlineMs)
      : null;
    let result;
    try {
      result = await run('list-mailbox-campaign-lineage', (client) => {
        let query = client.rpc('softora_find_mailbox_campaign_lineage_metadata', {
          p_account_emails: normalizedAccounts,
          p_reply_limit: safeReplyLimit,
          p_max_depth: safeDepth,
          p_max_context_messages: safeMaxResults,
          p_deadline_ms: safeDeadlineMs,
          p_before_message_date: normalizeString(beforeMessageDate) || null,
          p_before_message_key: normalizeString(beforeMessageKey) || null,
          p_before_discovered_at: normalizeString(beforeDiscoveredAt) || null,
          p_before_discovered_key: normalizeString(beforeDiscoveredKey) || null,
        });
        if (abortController && query && typeof query.abortSignal === 'function') {
          query = query.abortSignal(abortController.signal);
        }
        return query;
      }, { timeoutMs: safeDeadlineMs });
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }
    if (!result?.ok) return null;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length > safeMaxResults) {
      throw createLineageError(
        'Campagne-lineage overschreed de veilige resultaatlimiet.',
        'MAILBOX_CAMPAIGN_LINEAGE_RESULT_LIMIT'
      );
    }
    return rows.map((row) => {
      const message = normalizeMessageRow(row && row.message);
      const lineageDepth = Math.max(0, Number(row && row.lineage_depth) || 0);
      const rootMessageId = normalizeString(row && row.campaign_root_message_id);
      const lineageDiscoveredAt = normalizeString(row && row.lineage_discovered_at);
      const selectionSource = normalizeString(row && row.lineage_selection_source);
      if (
        !message ||
        !normalizedAccounts.includes(normalizeEmail(message.accountEmail)) ||
        !rootMessageId
      ) {
        throw createLineageError(
          'Campagne-lineage bevatte ongeldige account- of rootprovenance.',
          'MAILBOX_CAMPAIGN_LINEAGE_PROVENANCE_INVALID'
        );
      }
      return {
        ...message,
        campaignLineageEvidenceKnown: true,
        campaignLineageDepth: lineageDepth,
        campaignLineageRootMessageId: rootMessageId,
        campaignLineageEvidence: 'exact-same-account-message-id-ancestry',
        campaignLineageDiscoveredAt: lineageDiscoveredAt,
        campaignLineageSelectedReply: row && row.lineage_selected_reply === true,
        campaignLineageSelectionSource: selectionSource,
        campaignLineageHasMore: row && row.lineage_has_more === true,
        campaignLineageContextTruncated: row && row.lineage_context_truncated === true,
      };
    });
  };
}

module.exports = {
  MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS,
  MAILBOX_CAMPAIGN_LINEAGE_MAX_ACCOUNTS,
  MAILBOX_CAMPAIGN_LINEAGE_MAX_DEADLINE_MS,
  MAILBOX_CAMPAIGN_LINEAGE_MAX_DEPTH,
  MAILBOX_CAMPAIGN_LINEAGE_MAX_REPLIES,
  MAILBOX_CAMPAIGN_LINEAGE_MAX_RESULTS,
  createMailboxCampaignLineageLookup,
};
