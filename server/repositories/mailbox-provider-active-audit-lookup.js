function createMailboxProviderActiveAuditLookup(options = {}) {
  const {
    run, tableName, metadataColumns, pageSize, maxCount, lookupBatchSize,
    normalizeString, normalizeEmail, normalizeMessageRow,
  } = options;

  return async function listProviderActiveConversationAuditMessages({
    provider,
    accountEmails = [],
  } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedProvider || !normalizedAccounts.length) return [];

    const activeThreadKeys = new Set();
    const latestIncomingByThread = new Map();
    for (let offset = 0; offset < maxCount; offset += pageSize) {
      const result = await run(
        `list-provider-active-thread-ids:${normalizedProvider}:${offset}`,
        (client) => client
          .from(tableName)
          .select('account_email,provider_thread_id:payload->>providerThreadId,provider_message_id:payload->>providerMessageId,date')
          .eq('folder', normalizedProvider)
          .in('account_email', normalizedAccounts)
          .eq('payload->>direction', 'received')
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .range(offset, offset + pageSize - 1)
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      page.forEach((row) => {
        const accountEmail = normalizeEmail(row?.account_email);
        const threadId = normalizeString(row?.provider_thread_id);
        if (!accountEmail || !threadId) return;
        const key = `${accountEmail}|${threadId}`;
        activeThreadKeys.add(key);
        if (!latestIncomingByThread.has(key) && normalizeString(row.provider_message_id)) {
          latestIncomingByThread.set(key, {
            providerMessageId: normalizeString(row.provider_message_id),
            date: normalizeString(row.date),
          });
        }
      });
      if (page.length < pageSize) break;
    }
    if (!activeThreadKeys.size) return [];

    const threadIds = Array.from(
      new Set(Array.from(activeThreadKeys, (key) => key.slice(key.indexOf('|') + 1)))
    );
    const rowsByKey = new Map();
    for (let offset = 0; offset < threadIds.length; offset += lookupBatchSize) {
      const batch = threadIds.slice(offset, offset + lookupBatchSize);
      const result = await run(
        `list-provider-active-audit-messages:${normalizedProvider}:${offset}`,
        (client) => client
          .from(tableName)
          .select(metadataColumns)
          .eq('folder', normalizedProvider)
          .in('account_email', normalizedAccounts)
          .in('payload->>providerThreadId', batch)
          .contains('payload', { originalCampaignOutbound: true })
          .is('deleted_at', null)
          .order('date', { ascending: false })
      );
      if (!result.ok) return null;
      (Array.isArray(result.data) ? result.data : []).forEach((row) => {
        const messageKey = normalizeString(row?.message_key);
        if (messageKey && !rowsByKey.has(messageKey)) rowsByKey.set(messageKey, row);
      });
    }

    const sentMessages = Array.from(rowsByKey.values())
      .map((row) => normalizeMessageRow(row))
      .filter((message) => activeThreadKeys.has(
        `${normalizeEmail(message.providerAccountEmail || message.accountEmail)}|${normalizeString(message.providerThreadId)}`
      ));
    const incomingSummaries = new Map();
    sentMessages.forEach((sent) => {
      const key = `${normalizeEmail(sent.providerAccountEmail || sent.accountEmail)}|${normalizeString(sent.providerThreadId)}`;
      const latest = latestIncomingByThread.get(key);
      if (!latest || incomingSummaries.has(key)) return;
      incomingSummaries.set(key, {
        accountEmail: sent.accountEmail,
        providerAccountEmail: sent.providerAccountEmail,
        providerOwner: sent.providerOwner,
        providerThreadId: sent.providerThreadId,
        providerMessageId: latest.providerMessageId,
        folder: 'inbox',
        direction: 'received',
        date: latest.date,
      });
    });
    return [...sentMessages, ...incomingSummaries.values()];
  };
}

module.exports = { createMailboxProviderActiveAuditLookup };
