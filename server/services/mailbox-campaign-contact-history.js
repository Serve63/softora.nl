'use strict';

function sortMessagesNewestFirst(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .slice()
    .sort((left, right) => {
      const dateDelta = Date.parse(right?.date || 0) - Date.parse(left?.date || 0);
      if (dateDelta) return dateDelta;
      return String(left?.id || left?.messageId || '').localeCompare(String(right?.id || right?.messageId || ''));
    });
}

async function loadMailboxCampaignContactHistory({
  mailboxIndexStore,
  campaignMailboxAccounts = [],
  messages = [],
  campaignSubjectTerms = [],
  incomingFolders = ['coldmail', 'inbox'],
  incomingLimit = 250,
  sentLimit = 2000,
  participantPriorityMessages = [],
  dedupeCampaignMessages,
  collectCampaignThreadParticipantEmails,
} = {}) {
  const seedSentMessagesResult = await (
    typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
      ? mailboxIndexStore.listMatchingMessagesForAccounts({
          accountEmails: campaignMailboxAccounts,
          folder: 'sent',
          subjectTerms: campaignSubjectTerms,
          limit: sentLimit,
          priorityRead: true,
        })
      : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ? mailboxIndexStore.listAllMessagesForAccounts({
            accountEmails: campaignMailboxAccounts,
            folder: 'sent',
            limit: sentLimit,
            priorityRead: true,
          })
        : mailboxIndexStore.listMessagesForAccounts({
            accountEmails: campaignMailboxAccounts,
            folder: 'sent',
            limit: sentLimit,
            priorityRead: true,
          })
  );
  if (!Array.isArray(seedSentMessagesResult)) {
    const error = new Error('Mailbox-index voor campagne-uitgaande berichten kon niet worden gelezen.');
    error.status = 503;
    throw error;
  }
  const seedSentMessages = dedupeCampaignMessages(seedSentMessagesResult);
  // The incoming folders are fetched in batches (coldmail first, inbox
  // second), and the unfiltered recent scan can contain unrelated mail. Keep
  // subject-matched campaign messages first so a real historical reply is not
  // evicted by recent noise before the bounded targeted-history lookup runs.
  const campaignParticipantEmails = collectCampaignThreadParticipantEmails([
    ...sortMessagesNewestFirst(participantPriorityMessages),
    ...sortMessagesNewestFirst(messages),
    ...sortMessagesNewestFirst(seedSentMessages),
  ]);
  const [incomingBatches, targetedSentMessages] = await Promise.all([
    campaignParticipantEmails.length && typeof mailboxIndexStore.listMessagesBySenderEmailsForAccounts === 'function'
      ? Promise.all(incomingFolders.map((folder) => mailboxIndexStore.listMessagesBySenderEmailsForAccounts({
          accountEmails: campaignMailboxAccounts, folder, senderEmails: campaignParticipantEmails,
          limit: incomingLimit, priorityRead: true,
        })))
      : [],
    campaignParticipantEmails.length && typeof mailboxIndexStore.listMessagesByRecipientEmailsForAccounts === 'function'
      ? mailboxIndexStore.listMessagesByRecipientEmailsForAccounts({
          accountEmails: campaignMailboxAccounts, folder: 'sent', recipientEmails: campaignParticipantEmails,
          limit: sentLimit, priorityRead: true,
        })
      : [],
  ]);
  if (incomingBatches.some((batch) => !Array.isArray(batch)) || !Array.isArray(targetedSentMessages)) {
    const label = incomingBatches.some((batch) => !Array.isArray(batch)) ? 'incoming' : 'uitgaande contactberichten';
    const error = new Error(`Mailbox-index voor campagne-${label} kon niet worden gelezen.`);
    error.status = 503;
    throw error;
  }
  const targetedIncomingMessages = incomingBatches.flat();

  return {
    messages: dedupeCampaignMessages([
      ...messages,
      ...targetedIncomingMessages,
    ]),
    sentMessages: dedupeCampaignMessages([
      ...seedSentMessages,
      ...targetedSentMessages,
    ]),
  };
}

module.exports = { loadMailboxCampaignContactHistory };
