const {
  CAMPAIGN_MAILBOX_ACCOUNTS,
  getCampaignMailboxAccounts,
} = require('./mailbox-campaign-replies');
const {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
} = require('./mailbox-campaign-history-sync');
const {
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  collectMissingCampaignThreadReferenceIds,
} = require('./mailbox-campaign-participants');

const CAMPAIGN_SYNC_INDEX_SCAN_LIMIT = 500;
const CAMPAIGN_SYNC_UID_SCAN_LIMIT = 5000;
const CAMPAIGN_SYNC_FETCH_LIMIT = 4;
const CAMPAIGN_GMAIL_LABEL_FOLDER = 'coldmail';
const CAMPAIGN_GMAIL_ALL_MAIL_FOLDER = 'allmail';
const CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT = 8;
const CAMPAIGN_HISTORY_SEED_FOLDERS = Object.freeze([
  'inbox',
  'sent',
  CAMPAIGN_GMAIL_LABEL_FOLDER,
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
]);
const INCREMENTAL_LOCK_RETRY_ATTEMPTS = 12;
const INCREMENTAL_LOCK_RETRY_DELAY_MS = 500;

function selectMailboxSyncAccounts({
  accountEmail = '',
  owner = '',
  accounts = [],
  assertReadableAccount,
  normalizeEmail,
  campaignOnly = false,
} = {}) {
  const campaignAccounts = new Set(CAMPAIGN_MAILBOX_ACCOUNTS.map(normalizeEmail));
  if (accountEmail) {
    const account = assertReadableAccount(accountEmail);
    if (!campaignOnly || campaignAccounts.has(normalizeEmail(account.email))) return [account];
    return [];
  }
  const readableAccounts = (Array.isArray(accounts) ? accounts : [])
    .filter((account) => account && account.imapConfigured);
  if (!campaignOnly) return readableAccounts;
  const ownerAccounts = new Set(
    getCampaignMailboxAccounts(owner === 'both' ? '' : owner).map(normalizeEmail)
  );
  return readableAccounts.filter((account) => {
    const email = normalizeEmail(account.email);
    return campaignAccounts.has(email) && ownerAccounts.has(email);
  });
}

function normalizeMailboxSyncOwner(value) {
  const owner = String(value || '').trim().toLowerCase().replace('servé', 'serve');
  if (!owner) return '';
  if (owner === 'all') return 'both';
  if (owner === 'serve' || owner === 'martijn' || owner === 'both') return owner;
  const error = new Error('Onbekende mailbox-eigenaar.');
  error.status = 400;
  throw error;
}

function isRequestFlagEnabled(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(source.length || 1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
}

function isMailboxSyncCapacityError(error) {
  return String(error?.message || error || '').includes('MAILBOX_SYNC_GLOBAL_CAP_REACHED');
}

function isGmailImapAccount(account = {}) {
  const host = String(account?.imapHost || '').trim().toLowerCase();
  return host === 'imap.gmail.com' || host === 'imap.googlemail.com';
}

function getMailboxSyncFoldersForAccount({
  account,
  folders = [],
  campaignOnly = false,
  incrementalOnly = false,
  normalizeFolder = (value) => String(value || '').trim().toLowerCase(),
} = {}) {
  const normalizedFolders = (Array.isArray(folders) ? folders : [])
    .map(normalizeFolder)
    .filter(Boolean);
  if (campaignOnly && !isGmailImapAccount(account)) {
    return Array.from(new Set(
      normalizedFolders.filter((folder) =>
        ![CAMPAIGN_GMAIL_LABEL_FOLDER, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER].includes(folder)
      )
    ));
  }
  if (campaignOnly) {
    normalizedFolders.push(CAMPAIGN_GMAIL_LABEL_FOLDER);
    if (incrementalOnly) normalizedFolders.push(CAMPAIGN_GMAIL_ALL_MAIL_FOLDER);
  }
  return Array.from(new Set(normalizedFolders));
}

async function syncMailboxRequest({
  syncMailbox,
  method = '',
  body = {},
  query = {},
  normalizeFolder,
  defaultFolders = ['inbox', 'sent'],
  defaultLimit = 50,
  cronLimit = 30,
} = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const params = query && typeof query === 'object' ? query : {};
  const folderParam = payload.folder || params.folder || '';
  const accountEmail = payload.account || params.account || '';
  const owner = normalizeMailboxSyncOwner(payload.owner || params.owner || '');
  const fallbackLimit = String(method || '').toUpperCase() === 'GET' ? cronLimit : defaultLimit;
  const requestedLimit = payload.limit || params.limit || fallbackLimit;
  const folders = folderParam
    ? String(folderParam).split(',').map(normalizeFolder).filter(Boolean)
    : defaultFolders;
  const force = isRequestFlagEnabled(payload.force) || isRequestFlagEnabled(params.force);
  const campaignOnly = isRequestFlagEnabled(payload.campaignOnly) || isRequestFlagEnabled(params.campaignOnly);
  if (owner && !campaignOnly) {
    const error = new Error('Een owner-scope is alleen toegestaan voor campagnemail.');
    error.status = 400;
    throw error;
  }
  if (owner && accountEmail) {
    const error = new Error('Kies een owner-scope of één account, niet beide.');
    error.status = 400;
    throw error;
  }
  const incrementalOnly = Boolean(
    campaignOnly && (
      isRequestFlagEnabled(payload.incrementalOnly) ||
      isRequestFlagEnabled(params.incrementalOnly)
    )
  );
  const fastRefresh = Boolean(
    incrementalOnly && (
      isRequestFlagEnabled(payload.fastRefresh) ||
      isRequestFlagEnabled(params.fastRefresh)
    )
  );
  const defaultCronRequest = Boolean(
    String(method || '').toUpperCase() === 'GET' &&
    !accountEmail &&
    !folderParam &&
    !campaignOnly
  );
  const result = await syncMailbox({
    accountEmail,
    owner,
    folders,
    limit: Number(requestedLimit) || fallbackLimit,
    force,
    campaignOnly,
    incrementalOnly,
    maxConcurrentAccounts: fastRefresh || defaultCronRequest ? 2 : 1,
  });
  if (defaultCronRequest) {
    const campaignHistoryResult = await syncMailbox({
      folders: ['inbox', CAMPAIGN_GMAIL_LABEL_FOLDER],
      limit: Number(requestedLimit) || fallbackLimit,
      force,
      campaignOnly: true,
      incrementalOnly: true,
      maxConcurrentAccounts: 2,
    });
    result.ok = result.ok && campaignHistoryResult.ok;
    result.results = [
      ...(Array.isArray(result.results) ? result.results : []),
      ...(Array.isArray(campaignHistoryResult.results) ? campaignHistoryResult.results : []),
    ];
  }
  return result;
}

function createMailboxSyncService({
  mailboxIndexStore,
  assertReadableAccount,
  canUseMailboxIndex,
  fetchMessagesFromImap,
  getSafeLimit,
  getAccounts,
  normalizeEmail,
  normalizeFolder,
  waitForIncrementalLockRetry = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
  defaultFolders = ['inbox', 'sent'],
  defaultLimit = 50,
} = {}) {
  async function syncMailboxFolder({
    accountEmail,
    folder = 'inbox',
    limit = defaultLimit,
    force = false,
    campaignOnly = false,
    incrementalOnly = false,
    campaignSeedCache = null,
  } = {}) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (!canUseMailboxIndex()) {
      return { ok: false, skipped: true, reason: 'mailbox_index_unavailable' };
    }
    let lock = await mailboxIndexStore.acquireSyncLock({
      accountEmail: account.email,
      folder: normalizedFolder,
      force,
    });
    if (incrementalOnly && !lock.ok && lock.locked && lock.contention === 'active_lock') {
      return { ok: true, skipped: true, reason: 'coalesced' };
    }
    if (incrementalOnly) {
      for (let attempt = 1; attempt < INCREMENTAL_LOCK_RETRY_ATTEMPTS && !lock.ok; attempt += 1) {
        const retryableContention = lock.locked || isMailboxSyncCapacityError(lock.error);
        if (!retryableContention) break;
        await waitForIncrementalLockRetry(INCREMENTAL_LOCK_RETRY_DELAY_MS);
        lock = await mailboxIndexStore.acquireSyncLock({
          accountEmail: account.email,
          folder: normalizedFolder,
          force,
        });
        if (!lock.ok && lock.locked && lock.contention === 'active_lock') {
          return { ok: true, skipped: true, reason: 'coalesced' };
        }
      }
    }
    if (!lock.ok) {
      const retryableContention = lock.locked || isMailboxSyncCapacityError(lock.error);
      return {
        ok: incrementalOnly && retryableContention ? false : true,
        skipped: true,
        reason: lock.locked ? 'locked' : 'lock_failed',
        ...(incrementalOnly && retryableContention ? { retryable: true } : {}),
      };
    }

    try {
      const hydrateCampaignHistory = campaignOnly && !incrementalOnly;
      const oldestIndexedCampaignUid =
        hydrateCampaignHistory &&
        normalizedFolder !== CAMPAIGN_GMAIL_LABEL_FOLDER &&
        typeof mailboxIndexStore.getOldestMatchingMessageUid === 'function'
          ? await mailboxIndexStore.getOldestMatchingMessageUid({
              accountEmail: account.email,
              folder: normalizedFolder,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
            })
          : 0;
      let threadReferenceIds = [];
      let threadRecipientTerms = [];
      let indexedUids = [];
      if (campaignOnly) {
        if (typeof mailboxIndexStore.listMessageUidsForAccount === 'function') {
          indexedUids =
            (await mailboxIndexStore.listMessageUidsForAccount({
              accountEmail: account.email,
              folder: normalizedFolder,
              since: CAMPAIGN_HISTORY_SINCE.toISOString(),
              limit: CAMPAIGN_SYNC_UID_SCAN_LIMIT,
            })) || [];
        }
        if (typeof mailboxIndexStore.listCampaignSeedMessagesForAccount === 'function') {
          const cache = campaignSeedCache instanceof Map ? campaignSeedCache : new Map();
          const cacheKey = normalizeEmail(account.email);
          let indexedCampaignMessages = cache.get(cacheKey);
          if (!indexedCampaignMessages) {
            indexedCampaignMessages = await mailboxIndexStore.listCampaignSeedMessagesForAccount({
              accountEmail: account.email,
              folders: CAMPAIGN_HISTORY_SEED_FOLDERS,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
            });
            if (!Array.isArray(indexedCampaignMessages)) {
              const error = new Error('Mailbox-index voor campagnecontacten kon niet worden gelezen.');
              error.status = 503;
              throw error;
            }
            cache.set(cacheKey, indexedCampaignMessages);
          }
          threadReferenceIds = incrementalOnly
            ? collectMissingCampaignThreadReferenceIds(indexedCampaignMessages)
            : collectCampaignThreadReferenceIds(indexedCampaignMessages);
          threadRecipientTerms = collectCampaignThreadRecipientTerms(indexedCampaignMessages);
        } else if (
          hydrateCampaignHistory &&
          normalizedFolder === 'sent' &&
          typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
        ) {
          const indexedInboxMessages =
            (await mailboxIndexStore.listMatchingMessagesForAccounts({
              accountEmails: [account.email],
              folder: 'inbox',
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
            })) || [];
          threadReferenceIds = collectCampaignThreadReferenceIds(indexedInboxMessages);
          threadRecipientTerms = collectCampaignThreadRecipientTerms(indexedInboxMessages);
        } else if (
          hydrateCampaignHistory &&
          normalizedFolder === 'sent' &&
          typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ) {
          const indexedInboxMessages =
            (await mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: [account.email],
              folder: 'inbox',
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
            })) || [];
          const indexedSentMessages =
            (await mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: [account.email],
              folder: 'sent',
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
            })) || [];
          if (!indexedUids.length) {
            indexedUids = indexedSentMessages
              .map((message) => Number(message?.uid) || 0)
              .filter(Boolean);
          }
          threadReferenceIds = collectCampaignThreadReferenceIds([
            ...indexedInboxMessages,
            ...indexedSentMessages,
          ]);
          threadRecipientTerms = collectCampaignThreadRecipientTerms([
            ...indexedInboxMessages,
            ...indexedSentMessages,
          ]);
        }
        if (
          hydrateCampaignHistory &&
          !indexedUids.length &&
          normalizedFolder !== 'sent' &&
          typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ) {
          const indexedMessages =
            (await mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: [account.email],
              folder: normalizedFolder,
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
            })) || [];
          indexedUids = indexedMessages.map((message) => Number(message?.uid) || 0).filter(Boolean);
        }
      }
      const recoverGmailAllMail = campaignOnly && normalizedFolder === CAMPAIGN_GMAIL_ALL_MAIL_FOLDER;
      const messages = recoverGmailAllMail && !threadReferenceIds.length ? [] : await fetchMessagesFromImap({
        account,
        folder: normalizedFolder,
        limit: campaignOnly
          ? Math.min(
              getSafeLimit(limit),
              recoverGmailAllMail ? CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT : CAMPAIGN_SYNC_FETCH_LIMIT
            )
          : getSafeLimit(limit),
        campaignHistory:
          hydrateCampaignHistory && normalizedFolder !== CAMPAIGN_GMAIL_LABEL_FOLDER,
        oldestIndexedCampaignUid,
        threadReferenceIds,
        threadRecipientTerms: recoverGmailAllMail ? [] : threadRecipientTerms,
        // Incremental recovery receives only referenced Message-ID values that
        // are absent from the index. This keeps the exact header fallback while
        // bounding it to at most three IMAP batches per pass.
        includeThreadReferenceSearch: threadReferenceIds.length > 0,
        prioritizeTargetedUids: recoverGmailAllMail,
        logImapOperation: true,
        indexedUids,
      });
      const saved = await mailboxIndexStore.upsertMessages({
        accountEmail: account.email,
        folder: normalizedFolder,
        messages,
      });
      if (!saved || saved.ok === false) {
        throw saved?.error || new Error('Mailbox-index opslaan mislukt');
      }
      const lastUid = messages.reduce((max, message) => Math.max(max, Number(message.uid) || 0), 0);
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        messageCount: messages.length,
        lastUid,
      });
      return {
        ok: true,
        account: account.email,
        folder: normalizedFolder,
        synced: messages.length,
        upserted: saved.upserted || messages.length,
        historyBackfill: Boolean(campaignOnly && !incrementalOnly),
        historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
        targetedThreadReferences: threadReferenceIds.length,
        targetedThreadRecipients: threadRecipientTerms.length,
        incrementalOnly: Boolean(incrementalOnly),
      };
    } catch (error) {
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        error: error?.message || error,
      }).catch(() => null);
      throw error;
    }
  }

  async function syncMailbox({
    accountEmail = '',
    owner = '',
    folders = defaultFolders,
    limit = defaultLimit,
    force = false,
    campaignOnly = false,
    incrementalOnly = false,
    maxConcurrentAccounts = 1,
  } = {}) {
    const accounts = selectMailboxSyncAccounts({
      accountEmail,
      owner,
      accounts: getAccounts(),
      assertReadableAccount,
      normalizeEmail,
      campaignOnly,
    });
    const requestedFolders = Array.from(
      new Set((Array.isArray(folders) && folders.length ? folders : defaultFolders).map(normalizeFolder))
    );
    const campaignSeedCache = new Map();
    const accountResults = await mapWithConcurrency(
      accounts,
      Math.max(1, Math.min(3, Number(maxConcurrentAccounts) || 1)),
      async (account) => {
        const results = [];
        const folderList = getMailboxSyncFoldersForAccount({
          account,
          folders: requestedFolders,
          campaignOnly,
          incrementalOnly,
          normalizeFolder,
        });
        for (const folder of folderList) {
          try {
            results.push(await syncMailboxFolder({
              accountEmail: account.email,
              folder,
              limit,
              force,
              campaignOnly,
              incrementalOnly,
              campaignSeedCache,
            }));
          } catch (error) {
            logger.error('[Mailbox][Sync]', account.email, folder, error?.message || error);
            results.push({
              ok: false,
              account: account.email,
              folder,
              error: String(error?.message || error || 'Mailbox sync mislukt'),
            });
          }
        }
        return results;
      }
    );
    const results = accountResults.flat();
    return {
      ok: results.every((result) => result.ok !== false),
      results,
    };
  }

  return {
    syncMailbox,
    syncMailboxFolder,
  };
}

module.exports = {
  CAMPAIGN_GMAIL_LABEL_FOLDER,
  CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT,
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  CAMPAIGN_SYNC_FETCH_LIMIT,
  CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
  CAMPAIGN_SYNC_UID_SCAN_LIMIT,
  INCREMENTAL_LOCK_RETRY_ATTEMPTS,
  INCREMENTAL_LOCK_RETRY_DELAY_MS,
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  collectMissingCampaignThreadReferenceIds,
  createMailboxSyncService,
  getMailboxSyncFoldersForAccount,
  isRequestFlagEnabled,
  isGmailImapAccount,
  isMailboxSyncCapacityError,
  mapWithConcurrency,
  normalizeMailboxSyncOwner,
  selectMailboxSyncAccounts,
  syncMailboxRequest,
};
