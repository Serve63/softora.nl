'use strict';

const { getMailboxMessageDirection } = require('./mailbox-message-provenance');
const { getMessageReferenceLookupValues } = require('./mailbox-campaign-reply-lineage');

const CAMPAIGN_LINEAGE_CONTEXT_LIMIT = 9000;

function createLineageUnavailableError() {
  const error = new Error('Duurzame campagne-lineage kon niet volledig worden gelezen.');
  error.code = 'MAILBOX_CAMPAIGN_LINEAGE_UNAVAILABLE';
  error.status = 503;
  return error;
}

async function loadMailboxCampaignMessageSources({
  mailboxIndexStore,
  accountEmails,
  subjectTerms,
  replyLimit,
  recentLimit,
  matchingLimit,
  sentLimit,
  maxDepth,
  listMessagesAcrossFolders,
} = {}) {
  const hasDurableLineageIndex =
    typeof mailboxIndexStore.listCampaignLineageMessages === 'function';
  const durableLineageMessages = hasDurableLineageIndex
    ? await mailboxIndexStore.listCampaignLineageMessages({
        accountEmails,
        replyLimit,
        maxDepth,
        maxResults: CAMPAIGN_LINEAGE_CONTEXT_LIMIT,
        deadlineMs: 8000,
      })
    : [];
  if (
    hasDurableLineageIndex &&
    (
      !Array.isArray(durableLineageMessages) ||
      durableLineageMessages.some((message) => message?.campaignLineageContextTruncated === true)
    )
  ) {
    throw createLineageUnavailableError();
  }

  const recentMessages = await listMessagesAcrossFolders({
    mailboxIndexStore,
    method: 'listMessagesForAccounts',
    options: { accountEmails, limit: recentLimit },
  });
  const matchingMessages = hasDurableLineageIndex
    ? []
    : typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
      ? await listMessagesAcrossFolders({
          mailboxIndexStore,
          method: 'listMatchingMessagesForAccounts',
          options: { accountEmails, subjectTerms, limit: matchingLimit },
        })
      : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ? await listMessagesAcrossFolders({
            mailboxIndexStore,
            method: 'listAllMessagesForAccounts',
            options: { accountEmails, limit: matchingLimit },
          })
        : [];
  const completeSentCampaignMessages = hasDurableLineageIndex
    ? durableLineageMessages.filter((message) => getMailboxMessageDirection(message) === 'sent')
    : typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
      ? await mailboxIndexStore.listMatchingMessagesForAccounts({
          accountEmails,
          folder: 'sent',
          subjectTerms,
          limit: sentLimit,
        })
      : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ? await mailboxIndexStore.listAllMessagesForAccounts({
            accountEmails,
            folder: 'sent',
            limit: sentLimit,
          })
        : [];
  const sentCampaignMessageIds = hasDurableLineageIndex
    ? []
    : getMessageReferenceLookupValues(
        Array.isArray(completeSentCampaignMessages) ? completeSentCampaignMessages : [],
        Number.MAX_SAFE_INTEGER
      );
  const exactLineageReplies = hasDurableLineageIndex
    ? durableLineageMessages.filter((message) => getMailboxMessageDirection(message) !== 'sent')
    : sentCampaignMessageIds.length &&
        typeof mailboxIndexStore.listMessagesReferencingMessageIdsForAccounts === 'function'
      ? await listMessagesAcrossFolders({
          mailboxIndexStore,
          method: 'listMessagesReferencingMessageIdsForAccounts',
          options: { accountEmails, messageIds: sentCampaignMessageIds },
        })
      : [];

  return {
    hasDurableLineageIndex,
    recentMessages,
    matchingMessages,
    completeSentCampaignMessages,
    exactLineageReplies,
  };
}

module.exports = {
  CAMPAIGN_LINEAGE_CONTEXT_LIMIT,
  createLineageUnavailableError,
  loadMailboxCampaignMessageSources,
};
