const DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS = 70_000;
const {
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
  MAILBOX_UID_TARGET_REFERENCE_LIMIT,
  normalizeMailboxTargetReference,
  normalizeMailboxUidNext,
  normalizeMailboxUidValidity,
} = require('./mailbox-uid-validity');

const MAILBOX_UID_ENVELOPE_BATCH_SIZE = 500;

function getMailboxImapOperationTimeoutMs({
  timeoutMs = DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS,
  deadlineAtMs = null,
  nowMs = Date.now(),
} = {}) {
  const requestedTimeoutMs = timeoutMs === null || timeoutMs === undefined
    ? DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS
    : Math.max(0, Number(timeoutMs) || 0);
  const boundedTimeoutMs = Math.min(DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS, requestedTimeoutMs);
  const absoluteDeadlineAtMs = Number(deadlineAtMs);
  if (!Number.isFinite(absoluteDeadlineAtMs) || absoluteDeadlineAtMs <= 0) {
    return Math.floor(boundedTimeoutMs);
  }
  return Math.floor(Math.max(0, Math.min(boundedTimeoutMs, absoluteDeadlineAtMs - Number(nowMs))));
}

function createMailboxImapOperationTimeoutError({ accountEmail = '', folder = 'inbox', timeoutMs = 0 } = {}) {
  const error = new Error(
    `IMAP-operatie timeout na ${timeoutMs}ms voor ${accountEmail} (${folder}).`
  );
  error.code = 'MAILBOX_IMAP_OPERATION_TIMEOUT';
  error.status = 504;
  return error;
}

async function closeMailboxClientQuietly(client) {
  try {
    await client?.close?.();
  } catch (_) {}
}

function normalizeMailboxUidList(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(Number)
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
  )).sort((left, right) => left - right);
}

function normalizeMailboxMessageId(value) {
  return normalizeMailboxTargetReference(value);
}

async function collectMailboxUidBaselineEvidence({ client, legacyIdentities = [] } = {}) {
  if (!Array.isArray(legacyIdentities)) return { exact: false, evidence: [] };
  const normalizedLegacy = legacyIdentities.map((entry) => ({
    uid: Number(entry && entry.uid) || 0,
    messageId: normalizeMailboxMessageId(entry && entry.messageId),
  }));
  const legacyUidSet = new Set();
  for (const entry of normalizedLegacy) {
    if (
      !Number.isSafeInteger(entry.uid) || entry.uid <= 0 || !entry.messageId ||
      legacyUidSet.has(entry.uid)
    ) {
      return { exact: false, evidence: [] };
    }
    legacyUidSet.add(entry.uid);
  }
  normalizedLegacy.sort((left, right) => left.uid - right.uid);
  if (!normalizedLegacy.length) return { exact: true, evidence: [] };

  const fetchedByUid = new Map();
  for (let offset = 0; offset < normalizedLegacy.length; offset += MAILBOX_UID_ENVELOPE_BATCH_SIZE) {
    const batch = normalizedLegacy
      .slice(offset, offset + MAILBOX_UID_ENVELOPE_BATCH_SIZE)
      .map((entry) => entry.uid);
    for await (const message of client.fetch(
      batch,
      { uid: true, envelope: true },
      { uid: true }
    )) {
      const uid = Number(message && message.uid) || 0;
      const messageId = normalizeMailboxMessageId(message && message.envelope && message.envelope.messageId);
      if (!uid || !messageId || fetchedByUid.has(uid)) return { exact: false, evidence: [] };
      fetchedByUid.set(uid, messageId);
    }
  }
  const exact = normalizedLegacy.every((entry) => fetchedByUid.get(entry.uid) === entry.messageId) &&
    fetchedByUid.size === normalizedLegacy.length;
  return {
    exact,
    evidence: exact ? normalizedLegacy : [],
  };
}

async function selectMailboxUidWindow({ client, fromUid, throughUid, limit } = {}) {
  const safeFromUid = Math.max(1, Number(fromUid) || 1);
  const safeThroughUid = Math.max(0, Number(throughUid) || 0);
  const safeLimit = Math.max(1, Number(limit) || 1);
  if (safeFromUid > safeThroughUid) {
    return { selectedUids: [], scannedThroughUid: safeThroughUid };
  }
  const availableUids = normalizeMailboxUidList(await client.search(
    { uid: `${safeFromUid}:${safeThroughUid}` },
    { uid: true }
  )).filter((uid) => uid >= safeFromUid && uid <= safeThroughUid);
  const selectedUids = availableUids.slice(0, safeLimit);
  return {
    selectedUids,
    scannedThroughUid: availableUids.length > safeLimit
      ? selectedUids[selectedUids.length - 1]
      : safeThroughUid,
  };
}

async function runMailboxImapOperationWithDeadline({
  client,
  operation,
  accountEmail = '',
  folder = 'inbox',
  timeoutMs = DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS,
  deadlineAtMs = null,
} = {}) {
  const effectiveTimeoutMs = getMailboxImapOperationTimeoutMs({ timeoutMs, deadlineAtMs });
  if (effectiveTimeoutMs <= 0) {
    void closeMailboxClientQuietly(client);
    throw createMailboxImapOperationTimeoutError({ accountEmail, folder, timeoutMs: effectiveTimeoutMs });
  }
  let timeoutId = null;
  const operationPromise = Promise.resolve().then(operation);
  const deadlinePromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = createMailboxImapOperationTimeoutError({
        accountEmail,
        folder,
        timeoutMs: effectiveTimeoutMs,
      });
      reject(error);
      void closeMailboxClientQuietly(client);
    }, effectiveTimeoutMs);
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
    deadlineAtMs = null,
    imapOperationTimeoutMs = DEFAULT_MAILBOX_IMAP_OPERATION_TIMEOUT_MS,
    prepareUidGeneration = null,
    listLegacyUidIdentities = null,
    confirmUidBaseline = null,
    returnSyncPass = false,
    ...historySyncOptions
  }) {
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = getSafeLimit(limit);
    const client = createClient(account);
    const startedAt = Date.now();
    const logImapOperation = historySyncOptions.logImapOperation === true;
    const effectiveTimeoutMs = getMailboxImapOperationTimeoutMs({
      timeoutMs: imapOperationTimeoutMs,
      deadlineAtMs,
      nowMs: startedAt,
    });
    let operationTimedOut = false;
    if (logImapOperation) {
      logger.info?.('[Mailbox][ImapOperation]', {
        phase: 'start',
        account: account.email,
        folder: normalizedFolder,
        campaignHistory: Boolean(campaignHistory),
        timeoutMs: effectiveTimeoutMs,
        ...(deadlineAtMs ? { deadlineAtMs } : {}),
      });
    }
    try {
      const fetched = await runWithDeadline({
        client,
        accountEmail: account.email,
        folder: normalizedFolder,
        timeoutMs: imapOperationTimeoutMs,
        deadlineAtMs,
        operation: async () => {
          await client.connect();
          const mailboxName = await resolveMailboxName(client, normalizedFolder);
          if (!mailboxName) return { messages: [], syncPass: null, folderMissing: true };
          const lock = await client.getMailboxLock(mailboxName);
          try {
            const observedUidValidity = normalizeMailboxUidValidity(client?.mailbox?.uidValidity);
            const observedUidNext = normalizeMailboxUidNext(client?.mailbox?.uidNext);
            const targetedOnly = historySyncOptions.targetedOnly === true;
            let prepared = null;
            let baselineConfirmed = false;
            if (typeof prepareUidGeneration === 'function') {
              if (!observedUidValidity || !observedUidNext) {
                const error = new Error('IMAP-server gaf geen geldige UIDVALIDITY en UIDNEXT terug.');
                error.code = 'MAILBOX_UID_GENERATION_INVALID';
                throw error;
              }
              prepared = await prepareUidGeneration({
                uidValidity: observedUidValidity,
                uidNext: observedUidNext,
              });
              if (!prepared?.ok || prepared.prepared !== true) {
                throw prepared?.error || new Error('Mailbox UID-generatie voorbereiden mislukt.');
              }
              if (
                prepared.mode === 'rebuild' &&
                !prepared.currentUidValidity &&
                !targetedOnly &&
                typeof listLegacyUidIdentities === 'function' &&
                typeof confirmUidBaseline === 'function'
              ) {
                const legacyIdentities = await listLegacyUidIdentities();
                if (Array.isArray(legacyIdentities)) {
                  const baseline = await collectMailboxUidBaselineEvidence({ client, legacyIdentities });
                  if (baseline.exact) {
                    const confirmation = await confirmUidBaseline({
                      generationId: prepared.targetGenerationId,
                      uidValidity: observedUidValidity,
                      evidence: baseline.evidence,
                    });
                    if (confirmation?.confirmed === true) {
                      baselineConfirmed = true;
                      prepared = {
                        ...prepared,
                        mode: 'steady',
                        resetDetected: false,
                        activeGenerationId: confirmation.activeGenerationId,
                        targetGenerationId: confirmation.activeGenerationId,
                        currentUidValidity: confirmation.currentUidValidity,
                        scannedThroughUid: confirmation.resumeAfterUid,
                      };
                    } else {
                      throw confirmation?.error || new Error('Mailbox UID-baseline kon niet atomisch worden bevestigd.');
                    }
                  }
                }
              }
            }
            let selectedUids = Array.isArray(uids) && uids.length
              ? uids.map(Number).filter((uid) => Number.isFinite(uid) && uid > 0)
              : null;
            let scannedFromUid = 0;
            let scannedThroughUid = 0;
            let scanComplete = true;
            let targetReferenceIds = [];
            let targetUidManifest = [];
            if (prepared && targetedOnly) {
              if (prepared.selectionPolicy !== MAILBOX_UID_TARGETED_SELECTION_POLICY) {
                const error = new Error('Gerichte All Mail-selectie mist het vereiste selectiebeleid.');
                error.code = 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID';
                throw error;
              }
              targetReferenceIds = prepared.mode === 'rebuild'
                ? prepared.selectionTargets
                : historySyncOptions.threadReferenceIds;
              const targetedUids = await resolveMailboxSyncUids({
                client,
                limit: MAILBOX_UID_TARGET_REFERENCE_LIMIT + 1,
                campaignHistory: false,
                oldestIndexedCampaignUid: 0,
                ...historySyncOptions,
                threadReferenceIds: targetReferenceIds,
                threadRecipientTerms: [],
                targetedOnly: true,
                targetedAfterUid: 0,
                targetedThroughUid: prepared.scanUpperUid,
                indexedUids: prepared.mode === 'steady' ? historySyncOptions.indexedUids : [],
                logger,
                accountEmail: account.email,
                folder: normalizedFolder,
              });
              if (targetedUids.length > MAILBOX_UID_TARGET_REFERENCE_LIMIT) {
                const error = new Error('Gerichte All Mail-selectie overschrijdt de veilige manifestlimiet.');
                error.code = 'MAILBOX_UID_TARGET_MANIFEST_LIMIT';
                throw error;
              }
              targetUidManifest = targetedUids;
              if (prepared.mode === 'rebuild') {
                const stagedCount = Math.max(0, Number(prepared.scannedThroughUid) || 0);
                if (stagedCount > targetUidManifest.length) {
                  const error = new Error('Gerichte All Mail-selectie hervat buiten het bevroren UID-manifest.');
                  error.code = 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID';
                  throw error;
                }
                selectedUids = targetUidManifest.slice(stagedCount, stagedCount + safeLimit);
                scannedFromUid = stagedCount + 1;
                scannedThroughUid = stagedCount + selectedUids.length;
                scanComplete = scannedThroughUid === targetUidManifest.length;
              } else {
                selectedUids = targetUidManifest.slice(0, safeLimit);
                targetUidManifest = selectedUids;
                scannedFromUid = 0;
                scannedThroughUid = 0;
                scanComplete = true;
              }
            } else if (prepared) {
              scannedFromUid = Math.max(1, prepared.scannedThroughUid + 1);
              const uidWindow = await selectMailboxUidWindow({
                client,
                fromUid: scannedFromUid,
                throughUid: prepared.scanUpperUid,
                limit: safeLimit,
              });
              selectedUids = uidWindow.selectedUids;
              scannedThroughUid = uidWindow.scannedThroughUid;
              if (prepared.mode === 'steady' && selectedUids.length < safeLimit) {
                const targetedUids = await resolveMailboxSyncUids({
                  client,
                  limit: safeLimit - selectedUids.length,
                  campaignHistory,
                  oldestIndexedCampaignUid,
                  ...historySyncOptions,
                  logger,
                  accountEmail: account.email,
                  folder: normalizedFolder,
                });
                const selectedUidSet = new Set(selectedUids);
                for (const uid of targetedUids) {
                  if (
                    selectedUids.length >= safeLimit || selectedUidSet.has(uid) ||
                    uid > prepared.scanUpperUid
                  ) continue;
                  selectedUidSet.add(uid);
                  selectedUids.push(uid);
                }
              }
              scanComplete = prepared.mode === 'steady' || scannedThroughUid >= prepared.scanUpperUid;
            } else if (!selectedUids) {
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
            let messages = [];
            if (selectedUids.length) {
              messages = await fetchSelectedMessages({
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
            }
            if (prepared?.mode === 'rebuild') {
              messages.sort((left, right) => (Number(left?.uid) || 0) - (Number(right?.uid) || 0));
            }
            return {
              messages,
              syncPass: prepared ? {
                mode: prepared.mode,
                resetDetected: prepared.resetDetected === true,
                resumed: prepared.resumed === true,
                baselineConfirmed,
                activeGenerationId: prepared.activeGenerationId,
                targetGenerationId: prepared.targetGenerationId,
                uidValidity: observedUidValidity,
                uidNext: observedUidNext,
                scanUpperUid: prepared.scanUpperUid,
                scannedFromUid,
                scannedThroughUid,
                scanComplete,
                leaseExpiresAt: prepared.leaseExpiresAt,
                selectionPolicy: prepared.selectionPolicy,
                targetReferenceIds,
                targetUidManifest,
              } : null,
            };
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
          messageCount: fetched.messages.length,
        });
      }
      return returnSyncPass ? fetched : fetched.messages;
    } catch (error) {
      operationTimedOut = error?.code === 'MAILBOX_IMAP_OPERATION_TIMEOUT';
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
      if (deadlineAtMs) {
        if (!operationTimedOut) void closeMailboxClientQuietly(client);
      } else {
        try {
          if (client.usable) await client.logout();
        } catch (_) {}
      }
    }
  };
}

module.exports = {
  collectMailboxUidBaselineEvidence,
  closeMailboxClientQuietly,
  createMailboxImapFetcher,
  createMailboxImapOperationTimeoutError,
  fetchSelectedMailboxMessages,
  getMailboxImapOperationTimeoutMs,
  normalizeMailboxMessageId,
  runMailboxImapOperationWithDeadline,
  selectMailboxUidWindow,
};
