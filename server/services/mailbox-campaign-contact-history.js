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
        })
      : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ? mailboxIndexStore.listAllMessagesForAccounts({
            accountEmails: campaignMailboxAccounts,
            folder: 'sent',
            limit: sentLimit,
        })
        : mailboxIndexStore.listMessagesForAccounts({
            accountEmails: campaignMailboxAccounts,
            folder: 'sent',
            limit: sentLimit,
          })
  );
  if (!Array.isArray(seedSentMessagesResult)) {
    const error = new Error('Mailbox-index voor campagne-uitgaande berichten kon niet worden gelezen.');
    error.status = 503;
    throw error;
  }
  const seedSentMessages = dedupeCampaignMessages(seedSentMessagesResult);
  // The incoming folders are fetched in batches (coldmail first, inbox
  // second). Do not let that transport order decide which participants fit the
  // bounded targeted-history lookup: an older inbox reply must not disappear
  // simply because the coldmail batch filled the cap first.
  const campaignParticipantEmails = collectCampaignThreadParticipantEmails([
    ...sortMessagesNewestFirst(messages),
    ...sortMessagesNewestFirst(seedSentMessages),
  ]);
  let targetedIncomingMessages = [];
  if (campaignParticipantEmails.length &&
      typeof mailboxIndexStore.listMessagesBySenderEmailsForAccounts === 'function') {
    const batches = await Promise.all(incomingFolders.map((folder) =>
      mailboxIndexStore.listMessagesBySenderEmailsForAccounts({
        accountEmails: campaignMailboxAccounts,
        folder,
        senderEmails: campaignParticipantEmails,
        limit: incomingLimit,
      })
    ));
    if (batches.some((batch) => !Array.isArray(batch))) {
      const error = new Error('Mailbox-index voor campagne-incoming kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    targetedIncomingMessages = batches.flat();
  }
  let targetedSentMessages = [];
  if (campaignParticipantEmails.length &&
      typeof mailboxIndexStore.listMessagesByRecipientEmailsForAccounts === 'function') {
    targetedSentMessages = await mailboxIndexStore.listMessagesByRecipientEmailsForAccounts({
      accountEmails: campaignMailboxAccounts,
      folder: 'sent',
      recipientEmails: campaignParticipantEmails,
      limit: sentLimit,
    });
    if (!Array.isArray(targetedSentMessages)) {
      const error = new Error('Mailbox-index voor campagne-uitgaande contactberichten kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
  }
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
