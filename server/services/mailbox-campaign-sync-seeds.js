'use strict';

const CAMPAIGN_SYNC_SENT_DESCENDANT_MAX_DEPTH = 20;
const CAMPAIGN_SYNC_REFERENCE_LOOKUP_MAX_IDS = 2000;

function normalizeText(value) {
  return String(value || '').trim();
}

function getMessageIdentity(message = {}) {
  const account = normalizeText(message.accountEmail).toLowerCase();
  const messageId = normalizeText(message.messageId).toLowerCase();
  if (account && messageId) return `${account}|message:${messageId}`;
  return `${account}|${normalizeText(message.folder).toLowerCase()}|${normalizeText(message.id || message.uid)}`;
}

function mergeMessages(...groups) {
  const messagesByIdentity = new Map();
  groups.flat().filter(Boolean).forEach((message) => {
    const identity = getMessageIdentity(message);
    if (identity && !messagesByIdentity.has(identity)) messagesByIdentity.set(identity, message);
  });
  return Array.from(messagesByIdentity.values());
}

async function expandCampaignSyncSeeds({
  mailboxIndexStore,
  accountEmail,
  seedMessages = [],
  incomingFolders = ['inbox', 'coldmail', 'allmail'],
  collectCampaignThreadReferenceIds,
  collectMissingCampaignThreadReferenceIds,
  priorityRead = false,
} = {}) {
  let messages = mergeMessages(seedMessages);
  if (
    !messages.length ||
    typeof collectCampaignThreadReferenceIds !== 'function' ||
    typeof collectMissingCampaignThreadReferenceIds !== 'function'
  ) {
    return messages;
  }

  if (typeof mailboxIndexStore?.listMessagesReferencingMessageIdsForAccounts === 'function') {
    const queriedIds = new Set();
    let frontier = collectCampaignThreadReferenceIds(messages);
    for (
      let depth = 0;
      frontier.length && depth < CAMPAIGN_SYNC_SENT_DESCENDANT_MAX_DEPTH;
      depth += 1
    ) {
      const references = frontier
        .filter((value) => {
          const key = normalizeText(value).toLowerCase();
          if (!key || queriedIds.has(key)) return false;
          queriedIds.add(key);
          return true;
        })
        .slice(0, CAMPAIGN_SYNC_REFERENCE_LOOKUP_MAX_IDS);
      if (!references.length) break;
      const linkedSent = await mailboxIndexStore.listMessagesReferencingMessageIdsForAccounts({
        accountEmails: [accountEmail],
        folder: 'sent',
        messageIds: references,
        priorityRead,
      });
      if (!Array.isArray(linkedSent)) {
        const error = new Error('Gerichte Sent-threadindex kon niet worden gelezen.');
        error.status = 503;
        throw error;
      }
      const known = new Set(messages.map(getMessageIdentity));
      const added = linkedSent.filter((message) => !known.has(getMessageIdentity(message)));
      messages = mergeMessages(messages, linkedSent);
      frontier = added.map((message) => message.messageId).filter(Boolean);
    }
  }

  if (typeof mailboxIndexStore?.listMessagesByMessageIdsForAccounts !== 'function') return messages;
  const unresolvedIds = collectMissingCampaignThreadReferenceIds(messages);
  if (!unresolvedIds.length) return messages;
  const indexedIncoming = await Promise.all(incomingFolders.map((folder) =>
    mailboxIndexStore.listMessagesByMessageIdsForAccounts({
      accountEmails: [accountEmail],
      folder,
      messageIds: unresolvedIds,
      priorityRead,
    })
  ));
  if (indexedIncoming.some((batch) => !Array.isArray(batch))) {
    const error = new Error('Gerichte incoming-threadindex kon niet worden gelezen.');
    error.status = 503;
    throw error;
  }
  return mergeMessages(messages, indexedIncoming.flat());
}

module.exports = {
  CAMPAIGN_SYNC_SENT_DESCENDANT_MAX_DEPTH,
  expandCampaignSyncSeeds,
};
