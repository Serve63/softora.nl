'use strict';

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CAMPAIGN_SEED_QUERY_CONCURRENCY = 2;

function selectCampaignSeedMessages({ batches = [], limit = 500, normalizeString = String } = {}) {
  const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 500)));
  const sources = (Array.isArray(batches) ? batches : [])
    .filter(Array.isArray)
    .map((batch) => batch.slice().sort((left, right) => {
      const dateDelta = Date.parse(right && right.date || 0) - Date.parse(left && left.date || 0);
      if (dateDelta) return dateDelta;
      return normalizeString(left && (left.message_key || left.messageId || left.id))
        .localeCompare(normalizeString(right && (right.message_key || right.messageId || right.id)));
    }));
  const cursors = sources.map(() => 0);
  const selected = [];
  const seen = new Set();

  while (selected.length < safeLimit) {
    let advanced = false;
    for (let sourceIndex = 0; sourceIndex < sources.length && selected.length < safeLimit; sourceIndex += 1) {
      const source = sources[sourceIndex];
      while (cursors[sourceIndex] < source.length) {
        const message = source[cursors[sourceIndex]];
        cursors[sourceIndex] += 1;
        advanced = true;
        const identity = normalizeString(message && (message.messageId || message.id));
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        selected.push(message);
        break;
      }
    }
    if (!advanced) break;
  }
  return selected;
}

function rowContainsRecipientEmail(row, recipientEmails, normalizeString) {
  const addresses = normalizeString(row && row.recipients_text).toLowerCase().match(EMAIL_PATTERN) || [];
  return addresses.some((address) => recipientEmails.has(address));
}

function createMailboxIndexTargetedLookups({
  run,
  runPriorityRead,
  tableName,
  metadataColumns,
  normalizeEmail,
  normalizeFolder,
  normalizeString,
  normalizeMessageRow,
  listMatchingMessagesForAccounts,
} = {}) {
  async function listMessagesBySenderEmailsForAccounts({
    accountEmails = [],
    folder = 'inbox',
    senderEmails = [],
    limit = 1000,
    priorityRead = false,
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedSenders = Array.from(
      new Set((Array.isArray(senderEmails) ? senderEmails : []).map(normalizeEmail).filter(Boolean))
    ).slice(0, 400);
    if (!normalizedAccounts.length || !normalizedSenders.length) return [];
    const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 1000)));
    const read = priorityRead && typeof runPriorityRead === 'function' ? runPriorityRead : run;
    const result = await read('list-messages-by-sender-emails', (client) =>
      client
        .from(tableName)
        .select(metadataColumns)
        .in('account_email', normalizedAccounts)
        .eq('folder', normalizeFolder(folder))
        .in('sender_email', normalizedSenders)
        .is('deleted_at', null)
        .is('generation_superseded_at', null)
        .order('date', { ascending: false })
        .order('message_key', { ascending: false })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (Array.isArray(result.data) ? result.data : []).map((row) => normalizeMessageRow(row));
  }

  async function listMessagesByRecipientEmailsForAccounts({
    accountEmails = [],
    folder = 'sent',
    recipientEmails = [],
    limit = 1000,
    priorityRead = false,
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedRecipients = Array.from(
      new Set((Array.isArray(recipientEmails) ? recipientEmails : []).map(normalizeEmail).filter(Boolean))
    ).slice(0, 400);
    if (!normalizedAccounts.length || !normalizedRecipients.length) return [];
    const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 1000)));
    const read = priorityRead && typeof runPriorityRead === 'function' ? runPriorityRead : run;
    // Query every recipient in one indexed database call. Keep the local
    // parser as the final exact verifier so an RPC candidate can never turn a
    // partial/sub-string address match into a campaign-history match.
    const result = await read('list-messages-by-recipient-emails', (client) =>
      client.rpc('softora_list_mailbox_messages_by_recipients', {
        p_account_emails: normalizedAccounts,
        p_folder: normalizeFolder(folder),
        p_recipient_emails: normalizedRecipients,
        p_limit: safeLimit,
      })
    );
    if (!result.ok) return null;
    const rowsByKey = new Map();
    const recipientNeedles = new Set(normalizedRecipients.map((email) => email.toLowerCase()));
    (Array.isArray(result.data) ? result.data : [])
      .filter((row) => rowContainsRecipientEmail(row, recipientNeedles, normalizeString))
      .forEach((row) => {
        const key = normalizeString(row && row.message_key);
        if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
      });
    return Array.from(rowsByKey.values())
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .slice(0, safeLimit)
      .map((row) => normalizeMessageRow(row));
  }

  async function listCampaignSeedMessagesForAccount({
    accountEmail,
    folders = ['inbox', 'sent'],
    subjectTerms = [],
    limit = 500,
    priorityRead = false,
  } = {}) {
    const normalizedFolders = Array.from(
      new Set((Array.isArray(folders) ? folders : []).map(normalizeFolder).filter(Boolean))
    );
    if (!normalizeEmail(accountEmail) || !normalizedFolders.length || !subjectTerms.length) return [];
    const queries = normalizedFolders.flatMap((folder) =>
      subjectTerms.map((subjectTerm) => () => listMatchingMessagesForAccounts({
        accountEmails: [accountEmail],
        folder,
        subjectTerms: [subjectTerm],
        limit,
        priorityRead,
      }))
    );
    const batches = [];
    for (let offset = 0; offset < queries.length; offset += CAMPAIGN_SEED_QUERY_CONCURRENCY) {
      const batchGroup = await Promise.all(
        queries.slice(offset, offset + CAMPAIGN_SEED_QUERY_CONCURRENCY).map((query) => query())
      );
      if (batchGroup.some((batch) => !Array.isArray(batch))) return null;
      batches.push(...batchGroup);
    }
    return selectCampaignSeedMessages({ batches, limit, normalizeString });
  }

  async function getOldestMatchingMessageUid({
    accountEmail,
    folder = 'inbox',
    subjectTerms = [],
    priorityRead = false,
  } = {}) {
    const terms = Array.from(
      new Set((Array.isArray(subjectTerms) ? subjectTerms : []).map(normalizeString).filter(Boolean))
    );
    if (!terms.length) return 0;

    let oldestUid = 0;
    const read = priorityRead && typeof runPriorityRead === 'function' ? runPriorityRead : run;
    for (const term of terms) {
      const normalizedFolder = normalizeFolder(folder);
      const result = await read(`get-oldest-matching-message-uid:${normalizedFolder}`, (client) =>
        client
          .from(tableName)
          .select('uid')
          .eq('account_email', normalizeEmail(accountEmail))
          .eq('folder', normalizedFolder)
          .ilike('subject', `%${term}%`)
          .is('generation_superseded_at', null)
          .order('uid', { ascending: true })
          .limit(1)
      );
      if (!result.ok) return 0;
      const uid = Number(result.data?.[0]?.uid) || 0;
      if (uid > 0 && (!oldestUid || uid < oldestUid)) oldestUid = uid;
    }
    return oldestUid;
  }

  return {
    getOldestMatchingMessageUid,
    listCampaignSeedMessagesForAccount,
    listMessagesByRecipientEmailsForAccounts,
    listMessagesBySenderEmailsForAccounts,
  };
}

module.exports = {
  createMailboxIndexTargetedLookups,
  selectCampaignSeedMessages,
};
