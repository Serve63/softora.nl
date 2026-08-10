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
  let instantlySync = null;
  if (refreshInstantly && instantlyMailboxService?.isConfigured?.()) {
    try {
      const ownersToSync = selectedOwner && knownOwners.includes(selectedOwner)
        ? [selectedOwner]
        : configuredOwners;
      const syncResults = await Promise.all(
        ownersToSync.map((candidate) => instantlyMailboxService.syncOwner(candidate))
      );
      instantlySync = syncResults.length === 1
        ? syncResults[0]
        : {
            ok: syncResults.every((result) => result?.ok !== false),
            owners: syncResults,
          };
    } catch (error) {
      instantlySync = {
        ok: false,
        code: normalizeString(error?.code) || 'INSTANTLY_MAILBOX_SYNC_FAILED',
        error: truncateText(normalizeString(error?.message || error), 500),
      };
    }
  }
  const allInstantlyReplies = instantlyMailboxService?.isConfigured?.()
    ? (await Promise.all(configuredOwners.map((candidate) => (
        instantlyMailboxService.listOwnerConversations(candidate, {
          limit: Number(limit || 100) || 100,
        })
      )))).flat()
    : [];
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
    };
  }
  const replies = await mailboxCampaignRepliesService.listReplies({
    limit: normalizedLimit,
    owner,
  });
  return {
    replies: Array.isArray(replies) ? replies : [],
    snapshotBaseReplies: Array.isArray(replies) ? replies : [],
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
    const results = await Promise.all(owners.map((owner) => (
      instantlyMailboxService.syncOwner(owner, syncOptions)
    )));
    return res.status(200).json({
      ok: results.every((result) => result?.ok !== false),
      owners,
      startedAt,
      completedAt: new Date().toISOString(),
      results,
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
}) {
  if (normalizeString(body.provider).toLowerCase() !== 'instantly') {
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
        idempotentReplay: true,
      };
    }
    const error = new Error('Dit Instantly-antwoord wordt al veilig verwerkt.');
    error.status = 409;
    error.code = 'MAILBOX_SEND_ALREADY_PROCESSING';
    throw error;
  }
  try {
    const result = await instantlyMailboxService.reply({
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
    });
    const accepted = await mailboxSendProvenanceStore.accept(threadProvenance.intentId, {
      messageId: result.sentMessage?.messageId,
      providerMessageId: result.providerMessageId,
      providerThreadId: result.providerThreadId,
      acceptedAt: result.sentMessage?.receivedAt || new Date().toISOString(),
    });
    return {
      ...result,
      intentId: accepted.intentId,
      sentMessage: {
        ...(result.sentMessage || {}),
        conversationId: threadProvenance.conversationId,
        softoraSendIntentId: threadProvenance.intentId,
        softoraSendMode: 'reply',
        softoraReplyTargetMessageId: threadProvenance.replyTargetMessageId,
      },
    };
  } catch (error) {
    await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
    throw error;
  }
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
