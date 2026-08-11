'use strict';

const RECIPIENT_LOOKUP_BATCH_SIZE = 25;

function buildRecipientCandidateFilter(recipientEmails) {
  return (Array.isArray(recipientEmails) ? recipientEmails : [])
    // PostgREST's ilike wildcard is `%`. Keep this in the same form as the
    // other targeted OR lookups; the exact lower-case match below remains the
    // ownership-safe verifier for the candidate rows.
    .map((email) => `recipients_text.ilike.%${email}%`)
    .join(',');
}

function createMailboxIndexTargetedLookups({
  run,
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
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedSenders = Array.from(
      new Set((Array.isArray(senderEmails) ? senderEmails : []).map(normalizeEmail).filter(Boolean))
    ).slice(0, 400);
    if (!normalizedAccounts.length || !normalizedSenders.length) return [];
    const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 1000)));
    const result = await run('list-messages-by-sender-emails', (client) =>
      client
        .from(tableName)
        .select(metadataColumns)
        .in('account_email', normalizedAccounts)
        .eq('folder', normalizeFolder(folder))
        .in('sender_email', normalizedSenders)
        .is('deleted_at', null)
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
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedRecipients = Array.from(
      new Set((Array.isArray(recipientEmails) ? recipientEmails : []).map(normalizeEmail).filter(Boolean))
    ).slice(0, 400);
    if (!normalizedAccounts.length || !normalizedRecipients.length) return [];
    const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 1000)));
    const rowsByKey = new Map();
    // Query the recipient predicate in bounded PostgREST OR batches. A local
    // top-N mailbox slice is not sufficient: older valid Sent messages can be
    // just beyond that slice (the Karoena history was such a case). Batching
    // keeps the old targeted-search semantics without one request per contact
    // and quotes every email before it enters the PostgREST filter grammar.
    const recipientBatches = [];
    for (let offset = 0; offset < normalizedRecipients.length; offset += RECIPIENT_LOOKUP_BATCH_SIZE) {
      recipientBatches.push(normalizedRecipients.slice(offset, offset + RECIPIENT_LOOKUP_BATCH_SIZE));
    }
    const batches = await Promise.all(recipientBatches.map((recipientBatch, index) => {
      const candidateFilter = buildRecipientCandidateFilter(recipientBatch);
      return run(`list-messages-by-recipient-emails:${index}`, (client) => {
        const query = client
          .from(tableName)
          .select(metadataColumns)
          .in('account_email', normalizedAccounts)
          .eq('folder', normalizeFolder(folder))
          .or(candidateFilter)
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .order('message_key', { ascending: false });
        return query.limit(safeLimit);
      });
    }));
    if (batches.some((result) => !result.ok)) return null;
    const recipientNeedles = normalizedRecipients.map((email) => email.toLowerCase());
    batches.flatMap((result) => Array.isArray(result.data) ? result.data : [])
      .filter((row) => {
        const recipientsText = normalizeString(row && row.recipients_text).toLowerCase();
        return recipientsText && recipientNeedles.some((email) => recipientsText.includes(email));
      })
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
  } = {}) {
    const normalizedFolders = Array.from(
      new Set((Array.isArray(folders) ? folders : []).map(normalizeFolder).filter(Boolean))
    );
    if (!normalizeEmail(accountEmail) || !normalizedFolders.length || !subjectTerms.length) return [];
    const batches = await Promise.all(normalizedFolders.map((folder) => listMatchingMessagesForAccounts({
      accountEmails: [accountEmail],
      folder,
      subjectTerms,
      limit,
    })));
    if (batches.some((batch) => !Array.isArray(batch))) return null;
    const rowsByIdentity = new Map();
    batches.flat().forEach((message) => {
      const identity = normalizeString(message && (message.messageId || message.id));
      if (identity && !rowsByIdentity.has(identity)) rowsByIdentity.set(identity, message);
    });
    return Array.from(rowsByIdentity.values())
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .slice(0, Math.max(1, Math.min(4000, Math.floor(Number(limit) || 500))));
  }

  async function getOldestMatchingMessageUid({
    accountEmail,
    folder = 'inbox',
    subjectTerms = [],
  } = {}) {
    const terms = Array.from(
      new Set((Array.isArray(subjectTerms) ? subjectTerms : []).map(normalizeString).filter(Boolean))
    );
    if (!terms.length) return 0;

    let oldestUid = 0;
    for (const term of terms) {
      const normalizedFolder = normalizeFolder(folder);
      const result = await run(`get-oldest-matching-message-uid:${normalizedFolder}`, (client) =>
        client
          .from(tableName)
          .select('uid')
          .eq('account_email', normalizeEmail(accountEmail))
          .eq('folder', normalizedFolder)
          .ilike('subject', `%${term}%`)
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

module.exports = { createMailboxIndexTargetedLookups };
