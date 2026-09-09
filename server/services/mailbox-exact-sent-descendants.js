'use strict';
const { mapMailboxReads } = require('./mailbox-campaign-read-batches');
const CAMPAIGN_SENT_DESCENDANT_LOOKUP_LIMIT = 2000;
const CAMPAIGN_SENT_DESCENDANT_MAX_DEPTH = 20;

function createExactSentDescendantReader({ dedupeCampaignMessages, normalizeEmail,
  normalizeMessageId, getMessageReferenceIds, getMailboxMessageDirection, getMessageIdentity }) {
async function listExactSentDescendants({
  mailboxIndexStore,
  seedMessages = [],
  knownSentMessages = [],
  allowedAccountEmails = [],
} = {}) {
  if (!mailboxIndexStore || typeof mailboxIndexStore.listMessagesReferencingMessageIdsForAccounts !== 'function') {
    return [];
  }
  const allowedAccounts = new Set(
    (Array.isArray(allowedAccountEmails) ? allowedAccountEmails : [])
      .map(normalizeEmail)
      .filter(Boolean)
  );
  const allDescendants = [];
  const seenMessageIdentities = new Set();
  const queriedReferences = new Set();
  let frontier = dedupeCampaignMessages(
    (Array.isArray(seedMessages) ? seedMessages : []).flatMap((message) => [
      message,
      ...getMessageReferenceIds(message).map((referenceId) => ({
        ...message,
        messageId: `<${referenceId}>`,
        inReplyTo: '',
        references: '',
      })),
    ])
  ).filter((message) => (
    allowedAccounts.has(normalizeEmail(message && message.accountEmail)) &&
    normalizeMessageId(message && message.messageId)
  ));

  const knownByReference = new Map();
  for (const message of dedupeCampaignMessages(knownSentMessages)) {
    const account = normalizeEmail(message && message.accountEmail);
    if (!allowedAccounts.has(account) || getMailboxMessageDirection(message) !== 'sent' || !normalizeMessageId(message.messageId)) continue;
    for (const reference of getMessageReferenceIds(message)) {
      const key = `${account}|${reference}`;
      if (!knownByReference.has(key)) knownByReference.set(key, []);
      knownByReference.get(key).push(message);
    }
  }
  function expandKnownFrontier(messages) {
    const expanded = messages.slice();
    const visited = new Set();
    for (let index = 0; index < expanded.length; index += 1) {
      const message = expanded[index];
      const key = `${normalizeEmail(message.accountEmail)}|${normalizeMessageId(message.messageId)}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const child of knownByReference.get(key) || []) {
        const identity = getMessageIdentity(child);
        if (!identity || seenMessageIdentities.has(identity)) continue;
        seenMessageIdentities.add(identity);
        allDescendants.push(child);
        expanded.push(child);
        if (allDescendants.length > CAMPAIGN_SENT_DESCENDANT_LOOKUP_LIMIT) {
          throw Object.assign(new Error('Gerichte Sent-threadcontrole overschreed de veilige limiet.'), { status: 503 });
        }
      }
    }
    return expanded;
  }

  for (let depth = 0; frontier.length && depth < CAMPAIGN_SENT_DESCENDANT_MAX_DEPTH; depth += 1) {
    frontier = expandKnownFrontier(frontier);
    const frontierByAccount = new Map();
    frontier.forEach((message) => {
      const accountEmail = normalizeEmail(message && message.accountEmail);
      const messageId = normalizeMessageId(message && message.messageId);
      const queryKey = `${accountEmail}|${messageId}`;
      if (!accountEmail || !messageId || queriedReferences.has(queryKey)) return;
      queriedReferences.add(queryKey);
      if (!frontierByAccount.has(accountEmail)) frontierByAccount.set(accountEmail, []);
      frontierByAccount.get(accountEmail).push(messageId);
    });
    if (!frontierByAccount.size) { frontier = []; break; }

    const nextFrontier = [];
    const requests = [...frontierByAccount].flatMap(([accountEmail, messageIds]) => Array.from(
      { length: Math.ceil(messageIds.length / 1000) }, (_, index) => [accountEmail, messageIds.slice(index * 1000, (index + 1) * 1000)]
    ));
    const accountResults = await mapMailboxReads(requests, async ([accountEmail, messageIds]) => ({
      accountEmail, messageIds,
      result: await mailboxIndexStore.listMessagesReferencingMessageIdsForAccounts({
        accountEmails: [accountEmail], folder: 'sent', messageIds, priorityRead: true,
      }),
    }));
    for (const { accountEmail, messageIds, result } of accountResults) {
      if (!Array.isArray(result)) {
        const error = new Error('Gerichte Sent-threadcontrole kon niet worden gelezen.');
        error.status = 503;
        throw error;
      }
      result.forEach((message) => {
        if (
          normalizeEmail(message && message.accountEmail) !== accountEmail ||
          getMailboxMessageDirection(message) !== 'sent'
        ) {
          return;
        }
        const referencedIds = getMessageReferenceIds(message);
        if (!referencedIds.some((messageId) => messageIds.includes(messageId))) return;
        const identity = getMessageIdentity(message);
        if (!identity || seenMessageIdentities.has(identity)) return;
        seenMessageIdentities.add(identity);
        allDescendants.push(message);
        nextFrontier.push(message);
      });
    }
    if (allDescendants.length > CAMPAIGN_SENT_DESCENDANT_LOOKUP_LIMIT) {
      const error = new Error('Gerichte Sent-threadcontrole overschreed de veilige limiet.');
      error.status = 503;
      throw error;
    }
    frontier = nextFrontier;
  }

  if (frontier.length) {
    const error = new Error('Gerichte Sent-threadcontrole bereikte de maximale ketendiepte.');
    error.status = 503;
    throw error;
  }
  return dedupeCampaignMessages(allDescendants);
}

  return listExactSentDescendants;
}
module.exports = { createExactSentDescendantReader };
