const MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_ACCOUNTS = 20;
const MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_IDS = 200;

function createMailboxStoredMessageEvidenceLookup(deps = {}) {
  const {
    run,
    runPriorityRead,
    normalizeEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder = (value) => String(value || 'sent').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
  } = deps;

  function normalizeMessageId(value) {
    return normalizeString(value).toLowerCase().replace(/^[<>,\s]+|[<>,\s]+$/g, '');
  }

  return async function listStoredMessageIdsByMessageIdsForAccounts({
    accountEmails = [],
    folder = 'sent',
    messageIds = [],
    priorityRead = false,
  } = {}) {
    const normalizedAccounts = Array.from(new Set(
      (Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean)
    ));
    const normalizedMessageIds = Array.from(new Set(
      (Array.isArray(messageIds) ? messageIds : []).map(normalizeMessageId).filter(Boolean)
    ));
    if (normalizedAccounts.length > MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_ACCOUNTS
      || normalizedMessageIds.length > MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_IDS) {
      const error = new Error('Te veel mailboxaccounts of Message-ID\'s voor de bewijslookup.');
      error.status = 400;
      error.code = 'MAILBOX_STORED_MESSAGE_EVIDENCE_INPUT_TOO_LARGE';
      throw error;
    }
    if (!normalizedAccounts.length || !normalizedMessageIds.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const read = priorityRead ? runPriorityRead : run;
    const result = await read(`list-stored-message-ids:${normalizedFolder}`, (client) => client.rpc(
      'softora_list_stored_mailbox_message_ids', {
        p_account_emails: normalizedAccounts,
        p_folder: normalizedFolder,
        p_message_ids: normalizedMessageIds,
      }
    ));
    if (!result.ok) return null;
    const requestedIds = new Set(normalizedMessageIds);
    return Array.from(new Set((Array.isArray(result.data) ? result.data : [])
      .map((row) => normalizeMessageId(row && row.message_id))
      .filter((messageId) => messageId && requestedIds.has(messageId))));
  };
}

module.exports = {
  MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_ACCOUNTS,
  MAILBOX_STORED_MESSAGE_EVIDENCE_MAX_IDS,
  createMailboxStoredMessageEvidenceLookup,
};
