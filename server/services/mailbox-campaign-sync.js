const {
  CAMPAIGN_MAILBOX_ACCOUNTS,
  getCampaignMailboxAccounts,
} = require('./mailbox-campaign-replies');
const {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
} = require('./mailbox-campaign-history-sync');
const {
  MAILBOX_SYNC_CRON_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_CRON_RUN_TIMEOUT_MS,
  MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS,
  MAILBOX_SYNC_FAST_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_FAST_RUN_TIMEOUT_MS,
  createDeadlineController,
  createMailboxSyncRunId,
  getAbortReason,
  summarizeMailboxSyncResults,
} = require('./mailbox-sync-runtime');

const CAMPAIGN_SYNC_INDEX_SCAN_LIMIT = 500;
const CAMPAIGN_SYNC_UID_SCAN_LIMIT = 5000;
const CAMPAIGN_SYNC_FETCH_LIMIT = 4;
const CAMPAIGN_SYNC_FAST_FETCH_LIMIT = 20;
const CAMPAIGN_GMAIL_LABEL_FOLDER = 'coldmail';

const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);

function isCampaignSubject(message = {}) {
  const subject = String(message?.subject || '').toLowerCase();
  return CAMPAIGN_HISTORY_SUBJECT_TERMS.some((term) => subject.includes(term.toLowerCase()));
}

function collectCampaignThreadReferenceIds(messages = []) {
  return Array.from(
    new Set(
      (Array.isArray(messages) ? messages : [])
        .filter(isCampaignSubject)
        .map((message) => String(message?.messageId || '').trim())
        .filter(Boolean)
    )
  );
}

function collectCampaignThreadRecipientTerms(messages = []) {
  const terms = new Set();
  (Array.isArray(messages) ? messages : []).filter(isCampaignSubject).forEach((message) => {
    const emailMatch = String(message?.email || message?.senderEmail || '')
      .trim()
      .toLowerCase()
      .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    const email = emailMatch ? emailMatch[0] : '';
    if (!email) return;
    terms.add(email);
    const domain = email.split('@')[1] || '';
    if (domain && !PERSONAL_MAILBOX_DOMAINS.has(domain)) terms.add(domain);
  });
  return Array.from(terms);
}

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

function isGmailImapAccount(account = {}) {
  const host = String(account?.imapHost || '').trim().toLowerCase();
  return host === 'imap.gmail.com' || host === 'imap.googlemail.com';
}

function getMailboxSyncFoldersForAccount({
  account,
  folders = [],
  campaignOnly = false,
  normalizeFolder = (value) => String(value || '').trim().toLowerCase(),
} = {}) {
  const normalizedFolders = (Array.isArray(folders) ? folders : [])
    .map(normalizeFolder)
    .filter(Boolean);
  if (campaignOnly && !isGmailImapAccount(account)) {
    return Array.from(new Set(
      normalizedFolders.filter((folder) => folder !== CAMPAIGN_GMAIL_LABEL_FOLDER)
    ));
  }
  if (campaignOnly) {
    normalizedFolders.push(CAMPAIGN_GMAIL_LABEL_FOLDER);
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
  const requestStartedAt = Date.now();
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
  const cronRun = String(method || '').toUpperCase() === 'GET';
  const runTimeoutMs = fastRefresh
    ? MAILBOX_SYNC_FAST_RUN_TIMEOUT_MS
    : cronRun
      ? MAILBOX_SYNC_CRON_RUN_TIMEOUT_MS
      : MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS;
  const folderTimeoutMs = fastRefresh
    ? MAILBOX_SYNC_FAST_FOLDER_TIMEOUT_MS
    : cronRun
      ? MAILBOX_SYNC_CRON_FOLDER_TIMEOUT_MS
      : MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS;
  const runId = createMailboxSyncRunId();
  const deadlineAt = requestStartedAt + runTimeoutMs;
  const result = await syncMailbox({
    accountEmail,
    owner,
    folders,
    limit: Number(requestedLimit) || fallbackLimit,
    force,
    campaignOnly,
    incrementalOnly,
    fastRefresh,
    maxConcurrentAccounts: 3,
    folderTimeoutMs,
    runTimeoutMs,
    deadlineAt,
    runId,
  });
  if (
    String(method || '').toUpperCase() === 'GET' &&
    !accountEmail &&
    !folderParam &&
    !campaignOnly
  ) {
    const coldmailResult = await syncMailbox({
      folders: [CAMPAIGN_GMAIL_LABEL_FOLDER],
      limit: Number(requestedLimit) || fallbackLimit,
      force,
      campaignOnly: true,
      maxConcurrentAccounts: 3,
      folderTimeoutMs,
      runTimeoutMs,
      deadlineAt,
      runId,
    });
    result.results = [
      ...(Array.isArray(result.results) ? result.results : []),
      ...(Array.isArray(coldmailResult.results) ? coldmailResult.results : []),
    ];
    Object.assign(result, summarizeMailboxSyncResults(result.results));
  }
  result.durationMs = Date.now() - requestStartedAt;
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
  invalidateCampaignSnapshot = async () => ({ ok: true }),
  campaignMutationRunner = null,
  requireCampaignMutationJournal = false,
  campaignMutationLeaseSeconds,
  campaignMutationDeadlineMs,
  logger = console,
  defaultFolders = ['inbox', 'sent'],
  defaultLimit = 50,
} = {}) {
  function throwIfSyncAborted(signal, fallbackCode = 'MAILBOX_SYNC_FOLDER_TIMEOUT') {
    if (signal?.aborted) throw getAbortReason(signal, fallbackCode);
  }

  async function syncMailboxFolder({
    accountEmail,
    folder = 'inbox',
    limit = defaultLimit,
    force = false,
    campaignOnly = false,
    incrementalOnly = false,
    fastRefresh = false,
    runId = '',
    runSignal,
    runDeadlineAt = 0,
    folderTimeoutMs = MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS,
  } = {}) {
    const startedAt = Date.now();
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    const runLimitAt = Number(runDeadlineAt) || Number.POSITIVE_INFINITY;
    const folderLimitAt = startedAt + Math.max(1_000, Number(folderTimeoutMs) || MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS);
    const folderDeadlineAt = Math.min(runLimitAt, folderLimitAt);
    const folderDeadline = createDeadlineController({
      deadlineAt: folderDeadlineAt,
      parentSignal: runSignal,
      timeoutCode: runLimitAt <= folderLimitAt
        ? 'MAILBOX_SYNC_RUN_TIMEOUT'
        : 'MAILBOX_SYNC_FOLDER_TIMEOUT',
    });
    let lock = null;
    let upserted = 0;
    try {
      throwIfSyncAborted(folderDeadline.signal);
      if (!canUseMailboxIndex()) {
        return {
          ok: false,
          complete: false,
          freshnessConfirmed: false,
          skipped: true,
          reason: 'mailbox_index_unavailable',
          statusCode: 503,
          account: account.email,
          folder: normalizedFolder,
          runId,
        };
      }
      lock = await mailboxIndexStore.acquireSyncLock({
        accountEmail: account.email,
        folder: normalizedFolder,
        force,
        lockTtlMs: Math.max(10_000, folderDeadlineAt - Date.now() + 5_000),
        signal: folderDeadline.signal,
      });
      if (!lock.ok) {
        if (lock.locked) {
          return {
            ok: true,
            complete: false,
            freshnessConfirmed: false,
            accepted: true,
            skipped: true,
            reason: 'locked',
            statusCode: 202,
            account: account.email,
            folder: normalizedFolder,
            runId,
          };
        }
        return {
          ok: false,
          complete: false,
          freshnessConfirmed: false,
          skipped: true,
          reason: 'lock_failed',
          statusCode: 503,
          account: account.email,
          folder: normalizedFolder,
          runId,
          error: String(lock.error?.message || 'Mailbox-lock claim mislukt'),
        };
      }
      throwIfSyncAborted(folderDeadline.signal);
      const hydrateCampaignHistory = campaignOnly && !incrementalOnly;
      const oldestIndexedCampaignUid =
        hydrateCampaignHistory &&
        normalizedFolder !== CAMPAIGN_GMAIL_LABEL_FOLDER &&
        typeof mailboxIndexStore.getOldestMatchingMessageUid === 'function'
          ? await mailboxIndexStore.getOldestMatchingMessageUid({
              accountEmail: account.email,
              folder: normalizedFolder,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              signal: folderDeadline.signal,
            })
          : 0;
      throwIfSyncAborted(folderDeadline.signal);
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
              signal: folderDeadline.signal,
            })) || [];
          throwIfSyncAborted(folderDeadline.signal);
        }
        if (
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
              signal: folderDeadline.signal,
            })) || [];
          throwIfSyncAborted(folderDeadline.signal);
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
              signal: folderDeadline.signal,
            })) || [];
          throwIfSyncAborted(folderDeadline.signal);
          const indexedSentMessages =
            (await mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: [account.email],
              folder: 'sent',
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
              signal: folderDeadline.signal,
            })) || [];
          throwIfSyncAborted(folderDeadline.signal);
          if (!indexedUids.length) {
            indexedUids = indexedSentMessages
              .map((message) => Number(message?.uid) || 0)
              .filter(Boolean);
          }
          threadReferenceIds = collectCampaignThreadReferenceIds(indexedInboxMessages);
          threadRecipientTerms = collectCampaignThreadRecipientTerms(indexedInboxMessages);
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
              signal: folderDeadline.signal,
            })) || [];
          throwIfSyncAborted(folderDeadline.signal);
          indexedUids = indexedMessages.map((message) => Number(message?.uid) || 0).filter(Boolean);
        }
      }
      const fetchAndPersistMessages = async (mutationContext = null) => {
        const mutationSignal = mutationContext?.signal || folderDeadline.signal;
        const messages = await fetchMessagesFromImap({
          account,
          folder: normalizedFolder,
          limit: campaignOnly
            ? fastRefresh
              ? getSafeLimit(Math.max(Number(limit) || 0, CAMPAIGN_SYNC_FAST_FETCH_LIMIT))
              : Math.min(getSafeLimit(limit), CAMPAIGN_SYNC_FETCH_LIMIT)
            : getSafeLimit(limit),
          campaignHistory:
            hydrateCampaignHistory && normalizedFolder !== CAMPAIGN_GMAIL_LABEL_FOLDER,
          oldestIndexedCampaignUid,
          threadReferenceIds,
          threadRecipientTerms,
          indexedUids,
          signal: mutationSignal,
          deadlineAt: folderDeadlineAt,
          runId,
        });
        // IMAP clients cannot all be interrupted while a command is in flight.
        // This checkpoint guarantees that a response arriving after our hard
        // deadline can never start a late Supabase write.
        mutationContext?.assertActive();
        const saved = await mailboxIndexStore.upsertMessages({
          accountEmail: account.email,
          folder: normalizedFolder,
          messages,
          signal: mutationSignal,
          mutationId: mutationContext?.mutationId,
          requestKey: mutationContext?.requestKey,
        });
        mutationContext?.assertActive();
        if (!saved || saved.ok === false) {
          throw saved?.error || new Error('Mailbox-index opslaan mislukt');
        }
        return { messages, saved };
      };
      const touchesCampaignContent =
        CAMPAIGN_MAILBOX_ACCOUNTS.map(normalizeEmail).includes(normalizeEmail(account.email)) &&
        ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER].includes(normalizedFolder);
      const canJournalMutation = Boolean(
        touchesCampaignContent &&
        campaignMutationRunner?.isAvailable?.() &&
        typeof campaignMutationRunner.run === 'function'
      );
      if (touchesCampaignContent && requireCampaignMutationJournal && !canJournalMutation) {
        const error = new Error('Duurzame mailboxmutatiejournal is niet beschikbaar.');
        error.code = 'MAILBOX_CAMPAIGN_MUTATION_UNAVAILABLE';
        throw error;
      }
      const { messages, saved } = canJournalMutation
        ? await campaignMutationRunner.run({
            requestKey: `imap-sync:${lock.lockToken}:${normalizeEmail(account.email)}:${normalizedFolder}`,
            kind: 'imap-sync',
            accountEmail: account.email,
            folder: normalizedFolder,
            leaseSeconds: campaignMutationLeaseSeconds,
            deadlineMs: campaignMutationDeadlineMs,
            signal: folderDeadline.signal,
          }, fetchAndPersistMessages)
        : await fetchAndPersistMessages();
      upserted = Math.max(0, Number(saved.upserted) || 0);
      if ((saved.upserted || 0) > 0 && ['inbox', CAMPAIGN_GMAIL_LABEL_FOLDER].includes(normalizedFolder)) {
        const invalidation = await invalidateCampaignSnapshot({
          source: 'mailbox-index-upsert',
          accountEmail: account.email,
          folder: normalizedFolder,
          signal: folderDeadline.signal,
        });
        if (!invalidation || invalidation.ok === false) {
          const error = new Error('Mailbox-snapshot invalidatie mislukt');
          error.code = 'MAILBOX_SNAPSHOT_INVALIDATION_FAILED';
          throw error;
        }
      }
      throwIfSyncAborted(folderDeadline.signal);
      const lastUid = messages.reduce((max, message) => Math.max(max, Number(message.uid) || 0), 0);
      const finish = await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        messageCount: messages.length,
        lastUid,
        signal: folderDeadline.signal,
      });
      if (!finish || finish.ok === false) {
        throw finish?.error || new Error('Mailbox-sync lock bij afronding verloren');
      }
      return {
        ok: true,
        complete: true,
        freshnessConfirmed: true,
        account: account.email,
        folder: normalizedFolder,
        synced: messages.length,
        upserted: saved.upserted || messages.length,
        historyBackfill: Boolean(campaignOnly && !incrementalOnly),
        historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
        targetedThreadReferences: threadReferenceIds.length,
        targetedThreadRecipients: threadRecipientTerms.length,
        incrementalOnly: Boolean(incrementalOnly),
        durationMs: Date.now() - startedAt,
        runId,
      };
    } catch (error) {
      if (lock?.ok && lock.lockToken) {
        const failedFinish = await mailboxIndexStore.finishSync({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          error: error?.message || error,
        }).catch((finishError) => ({ ok: false, error: finishError }));
        if (failedFinish?.lockLost && error?.code !== 'MAILBOX_SYNC_LOCK_LOST') {
          error.lockLost = true;
        }
      }
      error.upserted = upserted;
      throw error;
    } finally {
      folderDeadline.cleanup();
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
    fastRefresh = false,
    maxConcurrentAccounts = 3,
    folderTimeoutMs = MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS,
    runTimeoutMs = MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS,
    deadlineAt = 0,
    runId = createMailboxSyncRunId(),
  } = {}) {
    const startedAt = Date.now();
    const runDeadlineAt = Number(deadlineAt) || startedAt + Math.max(1_000, Number(runTimeoutMs) || MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS);
    const runDeadline = createDeadlineController({
      deadlineAt: runDeadlineAt,
      timeoutCode: 'MAILBOX_SYNC_RUN_TIMEOUT',
    });
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
    logger.info?.('[Mailbox][Sync]', {
      event: 'run_started',
      runId,
      accountCount: accounts.length,
      folderCount: requestedFolders.length,
      campaignOnly: Boolean(campaignOnly),
      incrementalOnly: Boolean(incrementalOnly),
    });
    let accountResults;
    try {
      accountResults = await mapWithConcurrency(
        accounts,
        Math.max(1, Math.min(3, Number(maxConcurrentAccounts) || 3)),
        async (account, accountIndex) => {
          const results = [];
          const folderList = getMailboxSyncFoldersForAccount({
            account,
            folders: requestedFolders,
            campaignOnly,
            normalizeFolder,
          });
          for (const folder of folderList) {
            if (runDeadline.signal.aborted) {
              const deadlineError = getAbortReason(runDeadline.signal, 'MAILBOX_SYNC_RUN_TIMEOUT');
              results.push({
                ok: false,
                complete: false,
                freshnessConfirmed: false,
                timedOut: true,
                code: deadlineError.code,
                statusCode: 504,
                account: account.email,
                folder,
                error: deadlineError.message,
                runId,
              });
              continue;
            }
            try {
              results.push(await syncMailboxFolder({
                accountEmail: account.email,
                folder,
                limit,
                force,
                campaignOnly,
                incrementalOnly,
                fastRefresh,
                runId,
                runSignal: runDeadline.signal,
                runDeadlineAt,
                folderTimeoutMs,
              }));
            } catch (error) {
              const timedOut = error?.timedOut === true || /_TIMEOUT$/.test(String(error?.code || ''));
              logger.error?.('[Mailbox][Sync]', {
                event: 'folder_failed',
                runId,
                accountIndex,
                folder,
                code: String(error?.code || 'MAILBOX_SYNC_FAILED'),
                timedOut,
                lockLost: error?.lockLost === true || error?.code === 'MAILBOX_SYNC_LOCK_LOST',
                durationMs: Date.now() - startedAt,
              });
              results.push({
                ok: false,
                complete: false,
                freshnessConfirmed: false,
                account: account.email,
                folder,
                code: String(error?.code || 'MAILBOX_SYNC_FAILED'),
                timedOut,
                lockLost: error?.lockLost === true || error?.code === 'MAILBOX_SYNC_LOCK_LOST',
                statusCode: timedOut ? 504 : 503,
                error: String(error?.message || error || 'Mailbox sync mislukt'),
                durationMs: Date.now() - startedAt,
                runId,
              });
            }
          }
          return results;
        }
      );
    } finally {
      runDeadline.cleanup();
    }
    const results = accountResults.flat();
    const outcome = summarizeMailboxSyncResults(results);
    if (!results.length) {
      outcome.ok = false;
      outcome.degraded = true;
      outcome.reason = 'no_sync_targets';
    }
    logger.info?.('[Mailbox][Sync]', {
      event: 'run_finished',
      runId,
      ...outcome.summary,
      complete: outcome.complete,
      freshnessConfirmed: outcome.freshnessConfirmed,
      statusCode: outcome.statusCode,
      durationMs: Date.now() - startedAt,
    });
    return {
      ...outcome,
      runId,
      durationMs: Date.now() - startedAt,
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
  CAMPAIGN_SYNC_FETCH_LIMIT,
  CAMPAIGN_SYNC_FAST_FETCH_LIMIT,
  CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
  CAMPAIGN_SYNC_UID_SCAN_LIMIT,
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  createMailboxSyncService,
  getMailboxSyncFoldersForAccount,
  isRequestFlagEnabled,
  isGmailImapAccount,
  mapWithConcurrency,
  normalizeMailboxSyncOwner,
  selectMailboxSyncAccounts,
  syncMailboxRequest,
};
