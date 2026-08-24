const crypto = require('crypto');
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
const { expandCampaignSyncSeeds } = require('./mailbox-campaign-sync-seeds');
const {
  getMailboxSyncLeaseDeadlineAtMs,
} = require('./mailbox-sync-finalizer');
const {
  MAILBOX_UID_PROTOCOL_DRAINING,
  MAILBOX_UID_PROTOCOL_LEGACY,
  MAILBOX_UID_PROTOCOL_V2,
} = require('./mailbox-sync-protocol-lock');
const {
  MAILBOX_UID_SELECTION_POLICY,
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
  MAILBOX_UID_TARGET_REFERENCE_LIMIT,
  normalizeMailboxGenerationId,
  normalizeMailboxTargetReferences,
  normalizeMailboxUidValidity,
} = require('./mailbox-uid-validity');

const CAMPAIGN_SYNC_INDEX_SCAN_LIMIT = 500;
const CAMPAIGN_SYNC_UID_SCAN_LIMIT = 5000;
const CAMPAIGN_SYNC_FETCH_LIMIT = 4;
const CAMPAIGN_GMAIL_LABEL_FOLDER = 'coldmail';
const CAMPAIGN_GMAIL_ALL_MAIL_FOLDER = 'allmail';
const CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT = 8;
const MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS = 45;
const CAMPAIGN_HISTORY_SEED_FOLDERS = Object.freeze([
  'inbox',
  'sent',
  CAMPAIGN_GMAIL_LABEL_FOLDER,
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
]);
const INCREMENTAL_LOCK_RETRY_ATTEMPTS = 12;
const INCREMENTAL_LOCK_RETRY_DELAY_MS = 500;
const REGULAR_CRON_LOCK_RETRY_ATTEMPTS = 150;
const REGULAR_SYNC_CURSOR_OVERLAP = 3;
const CAMPAIGN_TARGET_ANCHOR_FOLDERS = new Set([
  'inbox',
  'sent',
  CAMPAIGN_GMAIL_LABEL_FOLDER,
]);

function createMailboxSyncMutationId() {
  return crypto.randomUUID();
}

function createMailboxSyncV2UnavailableError() {
  const error = new Error('Mailbox UID-generatieprotocol v2 is niet beschikbaar.');
  error.code = 'MAILBOX_SYNC_V2_UNAVAILABLE';
  return error;
}

function createMailboxSyncV2ProtocolError(message = 'Mailbox UID-generatieprotocol v2 gaf een ongeldig antwoord.') {
  const error = new Error(message);
  error.code = 'MAILBOX_SYNC_V2_PROTOCOL_INVALID';
  return error;
}

function assertMailboxSyncV2Store(mailboxIndexStore) {
  const requiredMethods = [
    'prepareUidGeneration',
    'confirmUidBaseline',
    'listLegacyUidIdentities',
    'commitSyncPass',
    'commitTargetedSyncPass',
    'skipSync',
    'failSync',
  ];
  if (requiredMethods.every((method) => typeof mailboxIndexStore?.[method] === 'function')) return;
  throw createMailboxSyncV2UnavailableError();
}

function normalizeMailboxSyncPass(fetched) {
  if (!fetched || !Array.isArray(fetched.messages) || !fetched.syncPass || typeof fetched.syncPass !== 'object') {
    throw createMailboxSyncV2ProtocolError('IMAP-fetch gaf geen atomische mailbox-syncpass terug.');
  }
  const pass = fetched.syncPass;
  const mode = String(pass.mode || '').trim().toLowerCase();
  const targetGenerationId = normalizeMailboxGenerationId(pass.targetGenerationId);
  const uidValidity = normalizeMailboxUidValidity(pass.uidValidity);
  const scanUpperUid = Number(pass.scanUpperUid);
  const scannedFromUid = Number(pass.scannedFromUid);
  const scannedThroughUid = Number(pass.scannedThroughUid);
  const selectionPolicy = String(pass.selectionPolicy || '').trim().toLowerCase();
  const targetReferenceIds = normalizeMailboxTargetReferences(pass.targetReferenceIds);
  const targetUidManifest = Array.isArray(pass.targetUidManifest)
    ? pass.targetUidManifest.map(Number)
    : [];
  const targetedSparse = selectionPolicy === MAILBOX_UID_TARGETED_SELECTION_POLICY;
  if (
    !['steady', 'rebuild'].includes(mode) || !targetGenerationId || !uidValidity ||
    ![MAILBOX_UID_SELECTION_POLICY, MAILBOX_UID_TARGETED_SELECTION_POLICY].includes(selectionPolicy) ||
    !Number.isSafeInteger(scanUpperUid) || scanUpperUid < 0 ||
    !Number.isSafeInteger(scannedFromUid) || scannedFromUid < 0 ||
    !Number.isSafeInteger(scannedThroughUid) || scannedThroughUid < 0 ||
    scannedThroughUid > scanUpperUid || typeof pass.scanComplete !== 'boolean'
  ) {
    throw createMailboxSyncV2ProtocolError();
  }
  if (targetedSparse) {
    if (
      !targetReferenceIds.length || targetReferenceIds.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT ||
      targetUidManifest.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT ||
      targetUidManifest.some((uid, index) => (
        !Number.isSafeInteger(uid) || uid <= 0 || uid > scanUpperUid ||
        (index > 0 && uid <= targetUidManifest[index - 1])
      ))
    ) {
      throw createMailboxSyncV2ProtocolError('Gerichte All Mail-pass bevat ongeldig referentie- of UID-bewijs.');
    }
    const messageUids = fetched.messages.map((message) => Number(message && message.uid));
    if (mode === 'steady') {
      if (
        scannedFromUid !== 0 || scannedThroughUid !== 0 || pass.scanComplete !== true ||
        messageUids.length !== targetUidManifest.length ||
        messageUids.some((uid, index) => uid !== targetUidManifest[index])
      ) {
        throw createMailboxSyncV2ProtocolError('Gerichte steady-pass mag geen algemene UID-cursor claimen.');
      }
    } else {
      const expectedBatch = targetUidManifest.slice(scannedFromUid - 1, scannedThroughUid);
      if (
        scannedFromUid < 1 || scannedThroughUid < scannedFromUid - 1 ||
        messageUids.length !== expectedBatch.length ||
        messageUids.some((uid, index) => uid !== expectedBatch[index]) ||
        pass.scanComplete !== (scannedThroughUid === targetUidManifest.length)
      ) {
        throw createMailboxSyncV2ProtocolError('Gerichte rebuild-pass wijkt af van het bevroren UID-manifest.');
      }
    }
  } else if (mode === 'rebuild') {
    let previousUid = 0;
    for (const message of fetched.messages) {
      const uid = Number(message && message.uid);
      if (
        !Number.isSafeInteger(uid) || uid <= 0 || uid <= previousUid ||
        uid < scannedFromUid || uid > scannedThroughUid
      ) {
        throw createMailboxSyncV2ProtocolError('Rebuild-pass bevat geen strikt oplopend UID-window.');
      }
      previousUid = uid;
    }
  }
  return {
    messages: fetched.messages,
    syncPass: {
      ...pass,
      mode,
      targetGenerationId,
      uidValidity,
      scanUpperUid,
      scannedFromUid,
      scannedThroughUid,
      selectionPolicy,
      targetReferenceIds,
      targetUidManifest,
    },
  };
}

function collectAnchoredCampaignThreadReferenceIds(messages = []) {
  const references = collectCampaignThreadReferenceIds(
    (Array.isArray(messages) ? messages : []).filter((message) => (
      CAMPAIGN_TARGET_ANCHOR_FOLDERS.has(String(message?.folder || '').trim().toLowerCase())
    ))
  );
  const byNormalizedReference = new Map();
  references.forEach((reference) => {
    const normalized = normalizeMailboxTargetReferences([reference])[0];
    if (normalized && !byNormalizedReference.has(normalized)) {
      byNormalizedReference.set(normalized, reference);
    }
  });
  return Array.from(byNormalizedReference.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAILBOX_UID_TARGET_REFERENCE_LIMIT)
    .map(([, reference]) => reference);
}

function collectAnchoredMissingCampaignThreadReferenceIds(messages = []) {
  const anchoredReferences = collectAnchoredCampaignThreadReferenceIds(messages);
  const anchoredSet = new Set(normalizeMailboxTargetReferences(anchoredReferences));
  return collectMissingCampaignThreadReferenceIds(messages).filter((reference) => {
    const normalized = normalizeMailboxTargetReferences([reference])[0];
    return normalized && anchoredSet.has(normalized);
  });
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
        folder !== CAMPAIGN_GMAIL_ALL_MAIL_FOLDER
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
  let result;
  if (defaultCronRequest) {
    const sentResult = await syncMailbox({
      folders: ['sent'],
      limit: Number(requestedLimit) || fallbackLimit,
      force,
      campaignOnly: false,
      incrementalOnly: false,
      retryContention: true,
      maxConcurrentAccounts: 2,
    });
    const inboxResult = await syncMailbox({
      folders: ['inbox'],
      limit: Number(requestedLimit) || fallbackLimit,
      force,
      campaignOnly: false,
      incrementalOnly: false,
      maxConcurrentAccounts: 2,
    });
    result = {
      ok: sentResult.ok && inboxResult.ok,
      results: [
        ...(Array.isArray(sentResult.results) ? sentResult.results : []),
        ...(Array.isArray(inboxResult.results) ? inboxResult.results : []),
      ],
    };
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
  } else {
    result = await syncMailbox({
      accountEmail,
      owner,
      folders,
      limit: Number(requestedLimit) || fallbackLimit,
      force,
      campaignOnly,
      incrementalOnly,
      maxConcurrentAccounts: fastRefresh ? 2 : 1,
    });
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
    retryContention = false,
    campaignSeedCache = null,
  } = {}) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (!canUseMailboxIndex()) {
      return { ok: false, skipped: true, reason: 'mailbox_index_unavailable' };
    }
    if (
      typeof mailboxIndexStore?.acquireSyncLockForProtocol !== 'function' ||
      typeof mailboxIndexStore?.getUidGenerationProtocol !== 'function' ||
      typeof mailboxIndexStore?.failSync !== 'function'
    ) {
      throw createMailboxSyncV2UnavailableError();
    }
    const recoverGmailAllMail = campaignOnly && normalizedFolder === CAMPAIGN_GMAIL_ALL_MAIL_FOLDER;
    const effectiveCampaignSeedCache = campaignSeedCache instanceof Map ? campaignSeedCache : new Map();
    if (recoverGmailAllMail) {
      const protocolPreflight = await mailboxIndexStore.getUidGenerationProtocol();
      if (!protocolPreflight?.ok) {
        throw protocolPreflight?.error || createMailboxSyncV2ProtocolError();
      }
      if (protocolPreflight.protocol === MAILBOX_UID_PROTOCOL_DRAINING) {
        return { ok: true, skipped: true, reason: 'uid_protocol_draining' };
      }
      // Legacy All Mail keeps its existing selection, fallback and finalizer
      // behavior byte-for-byte. Only v2 uses the anchored sparse preflight.
      if (protocolPreflight.protocol === MAILBOX_UID_PROTOCOL_V2) {
        let indexedCampaignMessages = [];
        if (typeof mailboxIndexStore.listCampaignSeedMessagesForAccount === 'function') {
          const cacheKey = normalizeEmail(account.email);
          indexedCampaignMessages = effectiveCampaignSeedCache.get(cacheKey);
          if (!indexedCampaignMessages) {
            indexedCampaignMessages = await mailboxIndexStore.listCampaignSeedMessagesForAccount({
              accountEmail: account.email,
              folders: CAMPAIGN_HISTORY_SEED_FOLDERS,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
              priorityRead: true,
            });
            if (!Array.isArray(indexedCampaignMessages)) {
              const error = new Error('Mailbox-index voor campagnecontacten kon niet worden gelezen.');
              error.status = 503;
              throw error;
            }
            if (incrementalOnly) {
              indexedCampaignMessages = await expandCampaignSyncSeeds({
                mailboxIndexStore,
                accountEmail: account.email,
                seedMessages: indexedCampaignMessages,
                incomingFolders: CAMPAIGN_HISTORY_SEED_FOLDERS.filter((seedFolder) => seedFolder !== 'sent'),
                collectCampaignThreadReferenceIds,
                collectMissingCampaignThreadReferenceIds,
                priorityRead: true,
              });
            }
            effectiveCampaignSeedCache.set(cacheKey, indexedCampaignMessages);
          }
        }
        const preflightThreadReferenceIds = incrementalOnly
          ? collectAnchoredMissingCampaignThreadReferenceIds(indexedCampaignMessages)
          : collectAnchoredCampaignThreadReferenceIds(indexedCampaignMessages);
        if (!preflightThreadReferenceIds.length) {
          return {
            ok: true,
            account: account.email,
            folder: normalizedFolder,
            synced: 0,
            upserted: 0,
            historyBackfill: Boolean(campaignOnly && !incrementalOnly),
            historyBeforeUid: 0,
            targetedThreadReferences: 0,
            targetedThreadRecipients: collectCampaignThreadRecipientTerms(indexedCampaignMessages).length,
            incrementalOnly: Boolean(incrementalOnly),
            uidProtocol: MAILBOX_UID_PROTOCOL_V2,
          };
        }
      }
    }
    let lock = await mailboxIndexStore.acquireSyncLockForProtocol({
      accountEmail: account.email,
      folder: normalizedFolder,
      force,
    });
    if (lock.protocolMode === MAILBOX_UID_PROTOCOL_DRAINING) {
      return { ok: true, skipped: true, reason: 'uid_protocol_draining' };
    }
    if (!lock.ok && !lock.protocolMode) {
      throw lock.error || createMailboxSyncV2ProtocolError(
        'Mailbox UID-generatieprotocol kon niet veilig worden gelezen.'
      );
    }
    const requiredLock = incrementalOnly || retryContention;
    if (requiredLock && !lock.ok && lock.locked && lock.contention === 'active_lock') {
      return { ok: true, skipped: true, reason: 'coalesced' };
    }
    if (requiredLock) {
      const retryAttempts = retryContention
        ? REGULAR_CRON_LOCK_RETRY_ATTEMPTS
        : INCREMENTAL_LOCK_RETRY_ATTEMPTS;
      for (let attempt = 1; attempt < retryAttempts && !lock.ok; attempt += 1) {
        const retryableContention = lock.locked || isMailboxSyncCapacityError(lock.error);
        if (!retryableContention) break;
        await waitForIncrementalLockRetry(INCREMENTAL_LOCK_RETRY_DELAY_MS);
        lock = await mailboxIndexStore.acquireSyncLockForProtocol({
          accountEmail: account.email,
          folder: normalizedFolder,
          force,
        });
        if (lock.protocolMode === MAILBOX_UID_PROTOCOL_DRAINING) {
          return { ok: true, skipped: true, reason: 'uid_protocol_draining' };
        }
        if (!lock.ok && lock.locked && lock.contention === 'active_lock') {
          return { ok: true, skipped: true, reason: 'coalesced' };
        }
      }
    }
    if (!lock.ok) {
      const retryableContention = lock.locked || isMailboxSyncCapacityError(lock.error);
      const failed = Boolean(lock.error) || (requiredLock && retryableContention);
      return {
        ok: !failed,
        skipped: true,
        reason: lock.locked ? 'locked' : 'lock_failed',
        ...(failed && retryableContention ? { retryable: true } : {}),
      };
    }
    if (![MAILBOX_UID_PROTOCOL_LEGACY, MAILBOX_UID_PROTOCOL_V2].includes(lock.protocolMode)) {
      throw createMailboxSyncV2ProtocolError('Mailbox-synclock mist een expliciete protocolmodus.');
    }
    const useUidGenerationV2 = lock.protocolMode === MAILBOX_UID_PROTOCOL_V2;

    const failureCommitId = createMailboxSyncMutationId();
    let syncDeadlineAtMs = 0;
    try {
      if (useUidGenerationV2) assertMailboxSyncV2Store(mailboxIndexStore);
      if (useUidGenerationV2) {
        syncDeadlineAtMs = getMailboxSyncLeaseDeadlineAtMs({
          leaseExpiresAt: lock.lockExpiresAt,
        });
        if (!syncDeadlineAtMs) {
          throw createMailboxSyncV2ProtocolError('Mailbox-synclock bevat geen bruikbare lease-expiry.');
        }
      }
      const hydrateCampaignHistory = campaignOnly && !incrementalOnly;
      const oldestIndexedCampaignUid =
        hydrateCampaignHistory &&
        normalizedFolder !== CAMPAIGN_GMAIL_LABEL_FOLDER &&
        typeof mailboxIndexStore.getOldestMatchingMessageUid === 'function'
          ? await mailboxIndexStore.getOldestMatchingMessageUid({
              accountEmail: account.email,
              folder: normalizedFolder,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              priorityRead: true,
            })
          : 0;
      let threadReferenceIds = [];
      let selectionTargetReferenceIds = [];
      let threadRecipientTerms = [];
      let indexedUids = [];
      let lastSyncedUid = 0;
      if (!campaignOnly && typeof mailboxIndexStore.getSyncState === 'function') {
        const syncState = await mailboxIndexStore.getSyncState({
          accountEmail: account.email,
          folder: normalizedFolder,
        });
        lastSyncedUid = Math.max(0, Number(syncState && syncState.last_uid) || 0);
      }
      if (
        !campaignOnly &&
        lastSyncedUid <= 0 &&
        typeof mailboxIndexStore.listMessageUidsForAccount === 'function'
      ) {
        const latestIndexedUids = await mailboxIndexStore.listMessageUidsForAccount({
          accountEmail: account.email,
          folder: normalizedFolder,
          limit: 1,
        });
        lastSyncedUid = Math.max(
          0,
          ...(Array.isArray(latestIndexedUids)
            ? latestIndexedUids.map(Number).filter(Number.isSafeInteger)
            : [])
        );
      }
      if (campaignOnly) {
        if (typeof mailboxIndexStore.listMessageUidsForAccount === 'function') {
          indexedUids = (await mailboxIndexStore.listMessageUidsForAccount({
            accountEmail: account.email,
            folder: normalizedFolder,
            since: CAMPAIGN_HISTORY_SINCE.toISOString(),
            limit: CAMPAIGN_SYNC_UID_SCAN_LIMIT,
            priorityRead: true,
          })) || [];
        }
        if (typeof mailboxIndexStore.listCampaignSeedMessagesForAccount === 'function') {
          const cache = effectiveCampaignSeedCache;
          const cacheKey = normalizeEmail(account.email);
          let indexedCampaignMessages = cache.get(cacheKey);
          if (!indexedCampaignMessages) {
            indexedCampaignMessages = await mailboxIndexStore.listCampaignSeedMessagesForAccount({
              accountEmail: account.email,
              folders: CAMPAIGN_HISTORY_SEED_FOLDERS,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
              priorityRead: true,
            });
            if (!Array.isArray(indexedCampaignMessages)) {
              const error = new Error('Mailbox-index voor campagnecontacten kon niet worden gelezen.');
              error.status = 503;
              throw error;
            }
            if (incrementalOnly) {
              indexedCampaignMessages = await expandCampaignSyncSeeds({
                mailboxIndexStore,
                accountEmail: account.email,
                seedMessages: indexedCampaignMessages,
                incomingFolders: CAMPAIGN_HISTORY_SEED_FOLDERS.filter((folder) => folder !== 'sent'),
                collectCampaignThreadReferenceIds,
                collectMissingCampaignThreadReferenceIds,
                priorityRead: true,
              });
            }
            cache.set(cacheKey, indexedCampaignMessages);
          }
          selectionTargetReferenceIds = useUidGenerationV2 && recoverGmailAllMail
            ? collectAnchoredCampaignThreadReferenceIds(indexedCampaignMessages)
            : [];
          threadReferenceIds = incrementalOnly
            ? (useUidGenerationV2 && recoverGmailAllMail
                ? collectAnchoredMissingCampaignThreadReferenceIds(indexedCampaignMessages)
                : collectMissingCampaignThreadReferenceIds(indexedCampaignMessages))
            : (useUidGenerationV2 && recoverGmailAllMail
                ? collectAnchoredCampaignThreadReferenceIds(indexedCampaignMessages)
                : collectCampaignThreadReferenceIds(indexedCampaignMessages));
          threadRecipientTerms = collectCampaignThreadRecipientTerms(indexedCampaignMessages);
          if (incrementalOnly) {
            threadRecipientTerms = threadRecipientTerms.slice(0, MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS);
          }
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
              priorityRead: true,
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
              priorityRead: true,
            })) || [];
          const indexedSentMessages =
            (await mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: [account.email],
              folder: 'sent',
              limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
              priorityRead: true,
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
              priorityRead: true,
            })) || [];
          indexedUids = indexedMessages.map((message) => Number(message?.uid) || 0).filter(Boolean);
        }
      }
      const fetchOptions = {
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
        ...(useUidGenerationV2 && recoverGmailAllMail ? { targetedOnly: true } : {}),
        logImapOperation: true,
        indexedUids,
        lastSyncedUid,
        syncCursorOverlap: campaignOnly ? 0 : REGULAR_SYNC_CURSOR_OVERLAP,
        ...(useUidGenerationV2 ? { deadlineAtMs: syncDeadlineAtMs } : {}),
      };

      if (!useUidGenerationV2) {
        const messages = recoverGmailAllMail && !threadReferenceIds.length
          ? []
          : await fetchMessagesFromImap(fetchOptions);
        const saved = await mailboxIndexStore.upsertMessages({
          accountEmail: account.email,
          folder: normalizedFolder,
          messages,
        });
        if (!saved || saved.ok === false) {
          throw saved?.error || new Error('Mailbox-index opslaan mislukt');
        }
        const fetchedLastUid = messages.reduce(
          (max, message) => Math.max(max, Number(message?.uid) || 0),
          0
        );
        const lastUid = lastSyncedUid > 0 && fetchedLastUid > 0 && fetchedLastUid < lastSyncedUid
          ? fetchedLastUid
          : Math.max(lastSyncedUid, fetchedLastUid);
        const finalized = await mailboxIndexStore.finishSync({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          messageCount: messages.length,
          lastUid,
        });
        if (!finalized?.ok) {
          throw finalized?.error || new Error('Mailbox-syncstatus afronden mislukt');
        }
        return {
          ok: true,
          account: account.email,
          folder: normalizedFolder,
          synced: messages.length,
          upserted: Number(saved.upserted) || messages.length,
          historyBackfill: Boolean(campaignOnly && !incrementalOnly),
          historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
          targetedThreadReferences: threadReferenceIds.length,
          targetedThreadRecipients: threadRecipientTerms.length,
          incrementalOnly: Boolean(incrementalOnly),
          uidProtocol: MAILBOX_UID_PROTOCOL_LEGACY,
        };
      }

      const fetched = await fetchMessagesFromImap({
        ...fetchOptions,
        prepareUidGeneration: ({ uidValidity, uidNext }) => mailboxIndexStore.prepareUidGeneration({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          uidValidity,
          uidNext,
          selectionPolicy: recoverGmailAllMail
            ? MAILBOX_UID_TARGETED_SELECTION_POLICY
            : MAILBOX_UID_SELECTION_POLICY,
          selectionTargets: recoverGmailAllMail ? selectionTargetReferenceIds : [],
          deadlineAtMs: syncDeadlineAtMs,
        }),
        listLegacyUidIdentities: () => mailboxIndexStore.listLegacyUidIdentities({
          accountEmail: account.email,
          folder: normalizedFolder,
          deadlineAtMs: syncDeadlineAtMs,
        }),
        confirmUidBaseline: ({ generationId, uidValidity, evidence }) =>
          mailboxIndexStore.confirmUidBaseline({
            accountEmail: account.email,
            folder: normalizedFolder,
            lockToken: lock.lockToken,
            generationId,
            uidValidity,
            evidence,
            deadlineAtMs: syncDeadlineAtMs,
          }),
        returnSyncPass: true,
      });
      if (fetched?.folderMissing === true) {
        const skipped = await mailboxIndexStore.skipSync({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          commitId: createMailboxSyncMutationId(),
          reason: 'folder_missing',
          deadlineAtMs: syncDeadlineAtMs,
        });
        if (!skipped?.ok || skipped.skipped !== true) {
          throw skipped?.error || new Error('Ontbrekende mailboxmap kon niet atomisch worden overgeslagen.');
        }
        return {
          ok: true,
          account: account.email,
          folder: normalizedFolder,
          synced: 0,
          upserted: 0,
          historyBackfill: Boolean(campaignOnly && !incrementalOnly),
          historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
          targetedThreadReferences: threadReferenceIds.length,
          targetedThreadRecipients: threadRecipientTerms.length,
          incrementalOnly: Boolean(incrementalOnly),
          skipped: true,
          reason: 'folder_missing',
          uidProtocol: MAILBOX_UID_PROTOCOL_V2,
        };
      }
      const { messages, syncPass } = normalizeMailboxSyncPass(fetched);
      const preparedLeaseDeadlineAtMs = getMailboxSyncLeaseDeadlineAtMs({
        requestDeadlineAtMs: syncDeadlineAtMs,
        leaseExpiresAt: syncPass.leaseExpiresAt,
      });
      if (!preparedLeaseDeadlineAtMs) {
        throw createMailboxSyncV2ProtocolError('Voorbereide mailbox-syncpass bevat geen bruikbare lease-expiry.');
      }
      syncDeadlineAtMs = Math.min(syncDeadlineAtMs, preparedLeaseDeadlineAtMs);
      const commitId = createMailboxSyncMutationId();
      const commitSyncPass = recoverGmailAllMail
        ? mailboxIndexStore.commitTargetedSyncPass
        : mailboxIndexStore.commitSyncPass;
      const committed = await commitSyncPass({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        commitId,
        generationId: syncPass.targetGenerationId,
        uidValidity: syncPass.uidValidity,
        targetReferenceIds: syncPass.targetReferenceIds,
        targetUidManifest: syncPass.targetUidManifest,
        messages,
        scannedFromUid: syncPass.scannedFromUid,
        scannedThroughUid: syncPass.scannedThroughUid,
        scanComplete: syncPass.scanComplete,
        messageCount: messages.length,
        lastUid: recoverGmailAllMail ? 0 : syncPass.scannedThroughUid,
        deadlineAtMs: syncDeadlineAtMs,
      });
      if (!committed?.ok || committed.committed !== true) {
        throw committed?.error || new Error('Atomische mailbox-synccommit mislukt.');
      }
      return {
        ok: true,
        account: account.email,
        folder: normalizedFolder,
        synced: messages.length,
        upserted: Number(committed.upserted) || 0,
        historyBackfill: Boolean(campaignOnly && !incrementalOnly),
        historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
        targetedThreadReferences: threadReferenceIds.length,
        targetedThreadRecipients: threadRecipientTerms.length,
        incrementalOnly: Boolean(incrementalOnly),
        uidGeneration: syncPass.targetGenerationId,
        uidValidity: syncPass.uidValidity,
        rebuildPending: committed.rebuildPending === true,
        activated: committed.activated === true,
        resetDetected: syncPass.resetDetected === true,
        uidProtocol: MAILBOX_UID_PROTOCOL_V2,
      };
    } catch (error) {
      if (useUidGenerationV2) {
        const failureDeadlineAtMs = getMailboxSyncLeaseDeadlineAtMs({
          leaseExpiresAt: lock.lockExpiresAt,
          reserveMs: 1_000,
        });
        await mailboxIndexStore.failSync({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          commitId: failureCommitId,
          error: error?.message || error,
          ...(failureDeadlineAtMs ? { deadlineAtMs: failureDeadlineAtMs } : {}),
        }).catch(() => null);
      } else {
        await mailboxIndexStore.finishSync({
          accountEmail: account.email,
          folder: normalizedFolder,
          lockToken: lock.lockToken,
          error: error?.message || error,
        }).catch(() => null);
      }
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
    retryContention = false,
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
              retryContention,
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
  REGULAR_CRON_LOCK_RETRY_ATTEMPTS,
  MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS,
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  collectMissingCampaignThreadReferenceIds,
  createMailboxSyncV2ProtocolError,
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
