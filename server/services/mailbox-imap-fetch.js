const DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS = 70_000;

async function closeMailboxClientQuietly(client) {
  try {
    await client?.close?.();
  } catch (_) {}
}

async function runMailboxImapOperationWithDeadline({
  client,
  operation,
  accountEmail = '',
  folder = 'inbox',
} = {}) {
  let timeoutId = null;
  const operationPromise = Promise.resolve().then(operation);
  const deadlinePromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(
        `IMAP-operatie timeout na ${DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS}ms voor ${accountEmail} (${folder}).`
      );
      error.code = 'MAILBOX_IMAP_OPERATION_TIMEOUT';
      error.status = 504;
      reject(error);
      void closeMailboxClientQuietly(client);
    }, 70_000);
  });
  try {
    return await Promise.race([operationPromise, deadlinePromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchSelectedMailboxMessages({
  account,
  buildMailboxBodyImages,
  client,
  folder,
  normalizeString,
  parseMailSource,
  sanitizeMailboxDisplayText,
  selectedUids = [],
  toClientMessage,
} = {}) {
  const records = [];
  for await (const message of client.fetch(
    selectedUids,
    { uid: true, flags: true, internalDate: true, source: true },
    { uid: true }
  )) {
    const parsed = await parseMailSource(message.source);
    const text = sanitizeMailboxDisplayText(normalizeString(parsed.text || parsed.html || ''));
    const primaryBodyImages = buildMailboxBodyImages(parsed);
    records.push({
      message,
      parsed,
      text,
      primaryBodyImages,
    });
  }
  const messages = records.map((record) => toClientMessage(
    record.parsed,
    record.message,
    folder,
    account,
    { text: record.text, primaryBodyImages: record.primaryBodyImages }
  ));
  return messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

function createMailboxImapFetcher({
  buildMailboxBodyImages,
  createClient,
  defaultLimit = 50,
  fetchSelectedMessages = fetchSelectedMailboxMessages,
  getSafeLimit,
  logger = console,
  normalizeFolder,
  normalizeString,
  parseMailSource,
  resolveMailboxName,
  resolveMailboxSyncUids,
  runWithDeadline = runMailboxImapOperationWithDeadline,
  sanitizeMailboxDisplayText,
  toClientMessage,
} = {}) {
  return async function fetchMessagesFromImap({
    account,
    folder = 'inbox',
    limit = defaultLimit,
    uids = null,
    campaignHistory = false,
    oldestIndexedCampaignUid = 0,
    ...historySyncOptions
  }) {
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = getSafeLimit(limit);
    const client = createClient(account);
    const startedAt = Date.now();
    const logImapOperation = historySyncOptions.logImapOperation === true;
    if (logImapOperation) {
      logger.info?.('[Mailbox][ImapOperation]', {
        phase: 'start',
        account: account.email,
        folder: normalizedFolder,
        campaignHistory: Boolean(campaignHistory),
        timeoutMs: DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS,
      });
    }
    try {
      const messages = await runWithDeadline({
        client,
        accountEmail: account.email,
        folder: normalizedFolder,
        operation: async () => {
          await client.connect();
          const mailboxName = await resolveMailboxName(client, normalizedFolder);
          if (!mailboxName) return [];
          const lock = await client.getMailboxLock(mailboxName);
          try {
            let selectedUids = Array.isArray(uids) && uids.length
              ? uids.map(Number).filter((uid) => Number.isFinite(uid) && uid > 0)
              : null;
            if (!selectedUids) {
              selectedUids = await resolveMailboxSyncUids({
                client,
                limit: safeLimit,
                campaignHistory,
                oldestIndexedCampaignUid,
                ...historySyncOptions,
                logger,
                accountEmail: account.email,
                folder: normalizedFolder,
              });
            }
            if (!selectedUids.length) return [];
            return await fetchSelectedMessages({
              account,
              buildMailboxBodyImages,
              client,
              folder: normalizedFolder,
              normalizeString,
              parseMailSource,
              sanitizeMailboxDisplayText,
              selectedUids,
              toClientMessage,
            });
          } finally {
            lock.release();
          }
        },
      });
      if (logImapOperation) {
        logger.info?.('[Mailbox][ImapOperation]', {
          phase: 'done',
          account: account.email,
          folder: normalizedFolder,
          campaignHistory: Boolean(campaignHistory),
          durationMs: Date.now() - startedAt,
          messageCount: messages.length,
        });
      }
      return messages;
    } catch (error) {
      if (logImapOperation) {
        logger.warn?.('[Mailbox][ImapOperation]', {
          phase: 'failed',
          account: account.email,
          folder: normalizedFolder,
          campaignHistory: Boolean(campaignHistory),
          durationMs: Date.now() - startedAt,
          code: error?.code || '',
          error: error?.message || String(error),
        });
      }
      throw error;
    } finally {
      try {
        if (client.usable) await client.logout();
      } catch (_) {}
    }
  };
}

module.exports = {
  closeMailboxClientQuietly,
  createMailboxImapFetcher,
  fetchSelectedMailboxMessages,
  runMailboxImapOperationWithDeadline,
};
