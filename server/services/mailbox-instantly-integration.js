const { createInstantlyMailboxService } = require('./instantly-mailbox');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

const INSTANTLY_INTERACTIVE_MIN_SYNC_INTERVAL_MS = 3 * 60 * 1000;

function getMailboxMessageOwner(message) {
  const provider = String(message?.provider || '').trim().toLowerCase();
  if (provider === 'instantly') {
    const providerOwner = String(message?.providerOwner || '').trim().toLowerCase();
    return ['serve', 'martijn'].includes(providerOwner) ? providerOwner : '';
  }
  const copyContext = message?.copyContext;
  const provenSourceAccount = copyContext?.evidenceKnown === true
    ? String(copyContext.sourceAccountEmail || '').trim().toLowerCase()
    : '';
  const accountEmail = String(
    provenSourceAccount || message?.accountEmail || message?.campaign?.account || ''
  ).trim().toLowerCase();
  const accountOwner = getOutboundSenderIdentity(accountEmail)?.profileKey || '';
  const senderOwner = getOutboundSenderIdentity(
    String(message?.email || message?.senderEmail || '').trim().toLowerCase()
  )?.profileKey || '';
  if (!provenSourceAccount && accountOwner && senderOwner && accountOwner !== senderOwner) return '';
  return accountOwner;
}

function createDefaultInstantlyMailboxService({
  env,
  mailboxIndexStore,
  fetchJsonWithTimeout,
  getCustomerSourcesByEmails,
  getUiStateValues,
  setUiStateValues,
  onMessagesUpserted,
  getCampaignMutationRunner,
  mailboxSendProvenanceStore,
  logger,
}) {
  return createInstantlyMailboxService({
    config: {
      enabled: env.INSTANTLY_MAILBOX_ENABLED,
      apiKey: env.INSTANTLY_API_KEY,
      apiBaseUrl: env.INSTANTLY_API_BASE_URL,
      webhookSecret: env.INSTANTLY_WEBHOOK_SECRET,
      accountOwners: env.INSTANTLY_ACCOUNT_OWNERS_JSON,
      campaignOwners: env.INSTANTLY_CAMPAIGN_OWNERS_JSON,
      initialLookbackDays: env.INSTANTLY_MAILBOX_INITIAL_LOOKBACK_DAYS,
      syncOverlapMinutes: env.INSTANTLY_MAILBOX_SYNC_OVERLAP_MINUTES,
      pageLimit: env.INSTANTLY_MAILBOX_PAGE_LIMIT,
      maxPages: env.INSTANTLY_MAILBOX_MAX_PAGES,
      richBodyAuditLimit: env.INSTANTLY_MAILBOX_RICH_BODY_AUDIT_LIMIT,
    },
    mailboxIndexStore,
    fetchJsonWithTimeout,
    getCustomerSourcesByEmails,
    getUiStateValues,
    setUiStateValues,
    onMessagesUpserted,
    mailboxSendProvenanceStore,
    getCampaignMutationRunner,
    requireMutationJournal: true,
    logger,
  });
}

function getInstantlyStatus(instantlyMailboxService) {
  return instantlyMailboxService?.getStatus?.() || {
    enabled: false,
    configured: false,
    missing: [],
    owners: { serve: [], martijn: [] },
  };
}

function getInstantlyProviderAccount(instantlyMailboxService, accountEmail) {
  const email = String(accountEmail || '').trim().toLowerCase();
  if (!email) return null;
  for (const owner of ['serve', 'martijn']) {
    const record = (instantlyMailboxService?.getConfiguredAccounts?.(owner) || [])
      .find((candidate) => String(candidate?.email || '').trim().toLowerCase() === email);
    if (record) return { email, provider: 'instantly', providerOwner: owner };
  }
  return null;
}

function getInstantlyVisibilityDeps(instantlyMailboxService) {
  return {
    getProviderAccount: (email) => getInstantlyProviderAccount(instantlyMailboxService, email),
    assertTargetAuthorized: (target) => assertInstantlyVisibilityTarget(instantlyMailboxService, target),
  };
}

async function assertInstantlyVisibilityTarget(instantlyMailboxService, target) {
  if (target?.messageRef?.folder !== 'instantly') return null;
  return instantlyMailboxService.assertStoredMessageOwnership({
    owner: target.owner,
    accountEmail: target.account?.email,
    providerMessageId: target.id,
    providerThreadId: target.providerThreadId,
  });
}

async function markInstantlyMessageRead({
  input,
  instantlyMailboxService,
  mailboxIndexStore,
}) {
  if (String(input?.folder || '').trim().toLowerCase() !== 'instantly') return null;
  const stored = await instantlyMailboxService.assertStoredMessageOwnership({
    owner: input.owner,
    accountEmail: input.accountEmail,
    providerMessageId: input.id,
  });
  const result = await mailboxIndexStore.markMessageRead({
    accountEmail: stored.providerAccountEmail,
    id: `instantly:${stored.providerMessageId}`,
    folder: 'instantly',
    uid: 0,
  });
  if (result?.ok !== true) {
    const error = new Error('Gelezen status kon niet in Softora worden opgeslagen.');
    error.status = result?.unavailable ? 503 : 404;
    error.code = result?.error?.code || 'INSTANTLY_READ_STATE_FAILED';
    throw error;
  }
  return {
    account: stored.providerAccountEmail,
    folder: 'instantly',
    uid: 0,
    id: `instantly:${stored.providerMessageId}`,
    unread: false,
    readAt: result.readAt,
    sourceMailboxMutated: false,
  };
}

function resolveReplyIdentity({
  context,
  accountEmail,
  getAccount,
  instantlyMailboxService,
  normalizeEmail,
  normalizeString,
  cleanPromptText,
}) {
  const contextAccountEmail = normalizeEmail(context && context.accountEmail);
  const contextProvider = normalizeString(context && context.provider).toLowerCase();
  const contextProviderOwner = normalizeString(context && context.providerOwner).toLowerCase();
  let resolvedAccountEmail = getAccount(contextAccountEmail)
    ? contextAccountEmail
    : normalizeEmail(accountEmail);
  let accountSenderName = cleanPromptText(getAccount(resolvedAccountEmail)?.name, 120) || resolvedAccountEmail;
  if (contextProvider !== 'instantly') return { resolvedAccountEmail, accountSenderName };
  if (!['serve', 'martijn'].includes(contextProviderOwner)) {
    const error = new Error('De Instantly-afzenderidentiteit ontbreekt.');
    error.status = 403;
    error.code = 'INSTANTLY_REPLY_IDENTITY_MISMATCH';
    throw error;
  }
  const providerAccounts = instantlyMailboxService?.getConfiguredAccounts?.(contextProviderOwner) || [];
  if (!providerAccounts.some(
    (providerAccount) => normalizeEmail(providerAccount?.email) === contextAccountEmail
  )) {
    const error = new Error('Het Instantly-afzenderaccount hoort niet bij de geselecteerde mailbox.');
    error.status = 403;
    error.code = 'INSTANTLY_REPLY_IDENTITY_MISMATCH';
    throw error;
  }
  resolvedAccountEmail = contextAccountEmail;
  accountSenderName = contextProviderOwner === 'martijn'
    ? 'Martijn van de Ven'
    : 'Servé Creusen';
  return { resolvedAccountEmail, accountSenderName };
}

async function mergeCampaignReplies({
  baseReplies,
  snapshotBaseReplies = baseReplies,
  instantlyMailboxService,
  limit,
  owner,
  refreshInstantly,
  filterVisibleMailboxMessages = (messages) => messages,
  normalizeString,
  truncateText,
}) {
  const selectedOwner = normalizeString(owner).toLowerCase();
  const knownOwners = ['serve', 'martijn'];
  if (selectedOwner && !knownOwners.includes(selectedOwner)) {
    const error = new Error('Kies eerst de mailbox van Servé of Martijn.');
    error.status = 400;
    error.code = 'INSTANTLY_OWNER_REQUIRED';
    throw error;
  }
  const configuredOwners = typeof instantlyMailboxService?.getConfiguredAccounts === 'function'
    ? knownOwners.filter((candidate) => {
        const accounts = instantlyMailboxService.getConfiguredAccounts(candidate);
        return Array.isArray(accounts) && accounts.length > 0;
      })
    : selectedOwner && knownOwners.includes(selectedOwner)
      ? [selectedOwner]
      : knownOwners;
  const warnings = [];
  const toOwnerFailure = (candidate, error, fallbackCode) => ({
    ok: false,
    owner: candidate,
    code: normalizeString(error?.code) || fallbackCode,
    error: truncateText(normalizeString(error?.message || error), 500),
  });
  let instantlySync = null;
  if (refreshInstantly && instantlyMailboxService?.isConfigured?.()) {
    const ownersToSync = selectedOwner && knownOwners.includes(selectedOwner)
      ? [selectedOwner]
      : configuredOwners;
    const settledSyncs = await Promise.allSettled(
      ownersToSync.map((candidate) => instantlyMailboxService.syncOwner(candidate))
    );
    const syncResults = settledSyncs.map((settled, index) => settled.status === 'fulfilled'
      ? settled.value
      : toOwnerFailure(ownersToSync[index], settled.reason, 'INSTANTLY_MAILBOX_SYNC_FAILED'));
    instantlySync = syncResults.length === 1
      ? syncResults[0]
      : {
          ok: syncResults.every((result) => result?.ok !== false),
          owners: syncResults,
        };
  }
  const ownersToRead = selectedOwner
    ? configuredOwners.filter((candidate) => candidate === selectedOwner)
    : configuredOwners;
  const settledReads = instantlyMailboxService?.isConfigured?.()
    ? await Promise.allSettled(ownersToRead.map((candidate) => (
        instantlyMailboxService.listOwnerConversations(candidate, {
          limit: Number(limit || 100) || 100,
        })
      )))
    : [];
  const allInstantlyReplies = [];
  settledReads.forEach((settled, index) => {
    const candidate = ownersToRead[index];
    if (settled.status === 'fulfilled' && Array.isArray(settled.value)) {
      allInstantlyReplies.push(...settled.value);
      return;
    }
    const failure = settled.status === 'rejected'
      ? toOwnerFailure(candidate, settled.reason, 'INSTANTLY_MAILBOX_READ_FAILED')
      : toOwnerFailure(candidate, new Error('Instantly-mailbox gaf geen geldige berichtenlijst.'), 'INSTANTLY_MAILBOX_READ_INVALID');
    warnings.push(`${failure.code}:${candidate}`);
  });
  const snapshotComplete = (
    !selectedOwner || configuredOwners.every((candidate) => ownersToRead.includes(candidate))
  ) && warnings.length === 0;
  const instantlyReplies = selectedOwner && knownOwners.includes(selectedOwner)
    ? allInstantlyReplies.filter((message) => message?.providerOwner === selectedOwner)
    : allInstantlyReplies;
  const getConversationMessages = (message) => [
    message,
    ...(Array.isArray(message?.threadMessages) ? message.threadMessages : []),
  ];
  const selectedBaseReplies = selectedOwner
    ? (Array.isArray(baseReplies) ? baseReplies : []).filter(
        (message) => getMailboxMessageOwner(message) === selectedOwner
      )
    : (Array.isArray(baseReplies) ? baseReplies : []);
  function mergeWithBase(providerReplies, sourceBaseReplies) {
    const providerMessageIds = new Set(
      providerReplies.flatMap(getConversationMessages)
        .map((message) => normalizeString(message?.messageId).toLowerCase())
        .filter(Boolean)
    );
    const uniqueBaseReplies = (Array.isArray(sourceBaseReplies) ? sourceBaseReplies : []).filter((message) => {
      const messageIds = getConversationMessages(message)
        .map((entry) => normalizeString(entry?.messageId).toLowerCase())
        .filter(Boolean);
      return !messageIds.some((messageId) => providerMessageIds.has(messageId));
    });
    return filterVisibleMailboxMessages([...uniqueBaseReplies, ...providerReplies]
      .sort((left, right) => (
        Date.parse(right.latestInboundAt || right.activityAt || right.receivedAt || right.date || 0) -
        Date.parse(left.latestInboundAt || left.activityAt || left.receivedAt || left.date || 0)
      )));
  }
  return {
    messages: mergeWithBase(instantlyReplies, selectedBaseReplies),
    snapshotMessages: mergeWithBase(allInstantlyReplies, snapshotBaseReplies),
    instantlyReplies: filterVisibleMailboxMessages(instantlyReplies),
    snapshotInstantlyReplies: filterVisibleMailboxMessages(allInstantlyReplies),
    instantlySync,
    snapshotComplete,
    warnings,
  };
}

async function listMailboxCampaignReplySets({
  mailboxCampaignRepliesService,
  limit,
  owner,
  hydrateBodies = true,
}) {
  const normalizedLimit = Number(limit || 100) || 100;
  if (typeof mailboxCampaignRepliesService?.listRepliesWithSnapshot === 'function') {
    const result = await mailboxCampaignRepliesService.listRepliesWithSnapshot({
      limit: normalizedLimit,
      owner,
      snapshotLimit: 200,
      hydrateBodies,
    });
    return {
      replies: Array.isArray(result?.messages) ? result.messages : [],
      snapshotBaseReplies: Array.isArray(result?.snapshotMessages)
        ? result.snapshotMessages
        : [],
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    };
  }
  const replies = await mailboxCampaignRepliesService.listReplies({
    limit: normalizedLimit,
    owner,
  });
  return {
    replies: Array.isArray(replies) ? replies : [],
    snapshotBaseReplies: Array.isArray(replies) ? replies : [],
    warnings: [],
  };
}

async function syncInstantlyMailboxResponse({
  instantlyMailboxService,
  req,
  res,
  logger,
  normalizeString,
}) {
  try {
    const startedAt = new Date().toISOString();
    const status = getInstantlyStatus(instantlyMailboxService);
    if (!status.configured) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'not-configured',
        missing: Array.isArray(status.missing) ? status.missing : [],
      });
    }
    const requestedOwner = normalizeString(req.body?.owner || req.query?.owner)
      .toLowerCase()
      .replace('servé', 'serve');
    if (requestedOwner && !['serve', 'martijn', 'both', 'all'].includes(requestedOwner)) {
      return res.status(400).json({
        ok: false,
        code: 'INSTANTLY_MAILBOX_OWNER_INVALID',
        error: 'Onbekende mailbox-eigenaar.',
      });
    }
    const owners = !requestedOwner || requestedOwner === 'both' || requestedOwner === 'all'
      ? ['serve', 'martijn']
      : [requestedOwner];
    const fastRefresh = /^(1|true|yes)$/i.test(normalizeString(
      req.body?.fastRefresh || req.query?.fastRefresh
    ));
    const syncOptions = fastRefresh
      ? { minIntervalMs: INSTANTLY_INTERACTIVE_MIN_SYNC_INTERVAL_MS }
      : {};
    const settled = await Promise.allSettled(owners.map((owner) => (
      instantlyMailboxService.syncOwner(owner, syncOptions)
    )));
    const failures = [];
    const results = settled.map((result, index) => {
      const error = result.status === 'rejected' ? result.reason : null;
      if (result.status === 'fulfilled' && result.value?.ok !== false) return result.value;
      const failure = result.status === 'fulfilled'
        ? {
            ...result.value,
            ok: false,
            owner: normalizeString(result.value?.owner) || owners[index],
            code: normalizeString(result.value?.code) || 'INSTANTLY_MAILBOX_SYNC_FAILED',
            error: String(result.value?.error || result.value?.detail || 'Onbekende fout'),
            status: Number(result.value?.status || result.value?.statusCode) || 503,
          }
        : {
            ok: false,
            owner: owners[index],
            code: normalizeString(error?.code) || 'INSTANTLY_MAILBOX_SYNC_FAILED',
            error: String(error?.message || 'Onbekende fout'),
            status: Number(error?.status) || 503,
          };
      failures.push(failure);
      logger.error(
        `[Mailbox][InstantlySync][${owners[index]}]`,
        error?.message || failure.error
      );
      return failure;
    });
    const failedCount = results.filter((result) => result?.ok === false).length;
    const succeededCount = results.length - failedCount;
    const statusCode = failedCount === 0
      ? 200
      : succeededCount > 0
        ? 207
        : owners.length === 1
          ? Number(failures[0]?.status) || 503
          : 503;
    const singleFailure = owners.length === 1 && failures[0];
    return res.status(statusCode).json({
      ok: failedCount === 0,
      owners,
      startedAt,
      completedAt: new Date().toISOString(),
      results,
      ...(singleFailure ? {
        code: singleFailure.code,
        error: 'Instantly-mailbox sync mislukt',
        detail: singleFailure.error,
      } : {}),
    });
  } catch (error) {
    logger.error('[Mailbox][InstantlySync]', error?.message || error);
    return res.status(error.status || 500).json({
      ok: false,
      code: normalizeString(error?.code) || 'INSTANTLY_MAILBOX_SYNC_FAILED',
      error: 'Instantly-mailbox sync mislukt',
      detail: String(error?.message || 'Onbekende fout'),
    });
  }
}

async function sendMailboxMessage({
  body,
  instantlyMailboxService,
  sendMessage,
  normalizeString,
  threadProvenance,
  mailboxSendProvenanceStore,
  logger = console,
}) {
  if (normalizeString(threadProvenance?.provider).toLowerCase() !== 'instantly') {
    return sendMessage({
      accountEmail: body.account,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      text: body.body || body.text || '',
      attachments: body.attachments,
      threadProvenance,
    });
  }
  if (threadProvenance?.mode !== 'reply') {
    const error = new Error('Instantly ondersteunt hier alleen een bewezen antwoord in de bestaande thread.');
    error.status = 409;
    error.code = 'INSTANTLY_NEW_MESSAGE_UNSUPPORTED';
    throw error;
  }
  if (!mailboxSendProvenanceStore) {
    const error = new Error('De duurzame Instantly-threadregistratie ontbreekt.');
    error.status = 503;
    error.code = 'MAILBOX_SEND_PROVENANCE_REQUIRED';
    throw error;
  }
  const reservation = await mailboxSendProvenanceStore.reserve({
    ...threadProvenance,
    accountEmail: body.account,
    recipientEmail: body.to,
    senderName: threadProvenance.senderName,
    subject: body.subject,
    body: body.body || body.text || '',
    cc: body.cc,
    bcc: body.bcc,
  });
  if (!reservation.created) {
    if (reservation.intent.status === 'accepted') {
      return {
        provider: 'instantly',
        providerMessageId: reservation.intent.providerMessageId,
        providerThreadId: reservation.intent.providerThreadId,
        accountEmail: reservation.intent.accountEmail,
        owner: reservation.intent.owner,
        intentId: reservation.intent.intentId,
        storageDegraded: reservation.intent.storageDegraded === true,
        reconcileRequired: reservation.intent.reconcileRequired === true,
        providerOutcomeUnknown: false,
        idempotentReplay: true,
      };
    }
    if (['prepared', 'unknown'].includes(reservation.intent.status)) {
      return {
        provider: 'instantly', providerMessageId: '',
        providerThreadId: reservation.intent.providerThreadId,
        accountEmail: reservation.intent.accountEmail, owner: reservation.intent.owner,
        intentId: reservation.intent.intentId, processing: true, providerOutcomeUnknown: true,
        storageDegraded: true, reconcileRequired: true, idempotentReplay: true,
      };
    }
    const error = new Error('Dit Instantly-antwoord wordt al veilig verwerkt.');
    error.status = 409;
    error.code = 'MAILBOX_SEND_PREVIOUSLY_FAILED';
    throw error;
  }
  let result;
  try {
    result = await instantlyMailboxService.reply({
      owner: body.owner,
      accountEmail: body.account,
      providerMessageId: body.providerMessageId,
      providerThreadId: body.providerThreadId,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      text: body.body || body.text || '',
      attachments: body.attachments,
      mutationRequestKey: `instantly-reply:${threadProvenance.intentId}`,
      onProviderRequestStarting: async () => {
        if (typeof mailboxSendProvenanceStore.markDispatchStarted !== 'function') {
          const error = new Error('De duurzame providerstartregistratie ontbreekt.');
          error.status = 503;
          error.code = 'MAILBOX_SEND_DISPATCH_START_UNAVAILABLE';
          throw error;
        }
        await mailboxSendProvenanceStore.markDispatchStarted(threadProvenance.intentId);
      },
    });
  } catch (error) {
    if (error?.noExternalEffect === true || error?.providerRejected === true) {
      await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
      throw error;
    }
    result = {
      provider: 'instantly', providerMessageId: '',
      providerThreadId: body.providerThreadId, accountEmail: body.account, owner: body.owner,
      processing: true, providerOutcomeUnknown: true,
      storageDegraded: true, reconcileRequired: true,
    };
  }
  if (result?.providerOutcomeUnknown === true) {
    try {
      await mailboxSendProvenanceStore.markUnknown?.(
        threadProvenance.intentId,
        'Instantly-provideruitkomst onbekend; niet opnieuw verzenden'
      );
    } catch (error) {
      logger.error('[Mailbox][InstantlySendUnknown]', error?.message || error);
    }
    return { ...result, intentId: threadProvenance.intentId };
  }
  let accepted;
  try {
    accepted = await mailboxSendProvenanceStore.accept(threadProvenance.intentId, {
      messageId: result.sentMessage?.messageId,
      providerMessageId: result.providerMessageId,
      providerThreadId: result.providerThreadId,
      acceptedAt: result.sentMessage?.receivedAt || new Date().toISOString(),
      storageDegraded: result.storageDegraded === true,
      reconcileRequired: result.reconcileRequired === true,
    });
  } catch (error) {
    logger.error('[Mailbox][InstantlyAcceptProvenance]', error?.message || error);
    try {
      const preserved = await mailboxSendProvenanceStore.markUnknown?.(
        threadProvenance.intentId,
        'Instantly accepteerde de send, maar lokale acceptatieopslag moet worden gereconcilieerd'
      );
      if (preserved?.status === 'accepted') accepted = preserved;
    } catch (markError) {
      logger.error('[Mailbox][InstantlyAcceptUnknown]', markError?.message || markError);
    }
  }
  return {
    ...result, intentId: accepted?.intentId || threadProvenance.intentId,
    provenanceDegraded: !accepted,
    storageDegraded: result.storageDegraded === true || !accepted,
    reconcileRequired: result.reconcileRequired === true || !accepted,
    sentMessage: {
      ...(result.sentMessage || {}), conversationId: threadProvenance.conversationId,
      softoraSendIntentId: threadProvenance.intentId, softoraSendMode: 'reply',
      softoraReplyTargetMessageId: threadProvenance.replyTargetMessageId,
    },
  };
}

module.exports = {
  assertInstantlyVisibilityTarget,
  createDefaultInstantlyMailboxService,
  getInstantlyProviderAccount,
  getInstantlyStatus,
  getInstantlyVisibilityDeps,
  getMailboxMessageOwner,
  markInstantlyMessageRead,
  mergeCampaignReplies,
  listMailboxCampaignReplySets,
  resolveReplyIdentity,
  sendMailboxMessage,
  syncInstantlyMailboxResponse,
};
