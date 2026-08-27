const { createInstantlyMailboxService } = require('./instantly-mailbox');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');
const {
  createMailboxReconcileRequiredError,
  createMailboxRequestPayloadFingerprint,
  isAmbiguousMailboxProviderError,
  normalizeMailboxAttachmentsMetadata,
} = require('./mailbox-send-provenance-store');
const {
  assertOutboundRecipientsNotSuppressed,
} = require('../security/outbound-mail-suppression');

const INSTANTLY_INTERACTIVE_MIN_SYNC_INTERVAL_MS = 3 * 60 * 1000;

function createInstantlyReplayError(message, code, retryable) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  if (typeof retryable === 'boolean') error.retryable = retryable;
  return error;
}

function createInstantlyAttachmentEvidenceError() {
  const cause = new Error(
    'De eerdere Instantly-verzending bevat geen betrouwbaar duurzaam bijlagebewijs.'
  );
  cause.code = 'MAILBOX_SEND_ATTACHMENT_EVIDENCE_MISSING';
  return createMailboxReconcileRequiredError(cause);
}

function assertInstantlyReplayContext(intent, provenance, body, normalizeString) {
  const text = (value) => normalizeString(value);
  const email = (value) => text(value).toLowerCase();
  const matches = intent
    && text(intent.idempotencyKey) === text(provenance.idempotencyKey)
    && text(intent.owner).toLowerCase() === text(provenance.owner).toLowerCase()
    && email(intent.accountEmail) === email(body.account)
    && email(intent.recipientEmail) === email(body.to)
    && email(provenance.accountEmail) === email(body.account)
    && email(provenance.recipientEmail) === email(body.to)
    && text(intent.mode).toLowerCase() === text(provenance.mode).toLowerCase()
    && text(intent.conversationId) === text(provenance.conversationId)
    && text(intent.replyTargetMessageId) === text(provenance.replyTargetMessageId)
    && text(intent.references) === text(provenance.references)
    && text(intent.provider || 'instantly').toLowerCase() === 'instantly'
    && text(provenance.provider || 'instantly').toLowerCase() === 'instantly'
    && text(intent.providerThreadId) === text(provenance.providerThreadId);
  if (matches) return;
  throw createInstantlyReplayError(
    'De veilige verzend-ID hoort bij een andere mailbox- of threadcontext.',
    'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH',
    false
  );
}

function assertInstantlyReplayPayload(intent, body, normalizeString) {
  const durableMetadata = normalizeMailboxAttachmentsMetadata(intent?.attachmentsMetadata);
  if (durableMetadata === null) throw createInstantlyAttachmentEvidenceError();
  const requestedMetadata = body?.attachmentsMetadata === undefined
    ? []
    : normalizeMailboxAttachmentsMetadata(body.attachmentsMetadata);
  if (requestedMetadata === null || requestedMetadata.length || durableMetadata.length) {
    throw createInstantlyReplayError(
      'De veilige verzend-ID hoort bij andere mailinhoud of bijlagen; open de mail opnieuw voordat je opnieuw verzendt.',
      'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH',
      false
    );
  }

  const durableFingerprint = normalizeString(intent?.requestPayloadFingerprint).toLowerCase();
  if (durableFingerprint) {
    if (!/^[0-9a-f]{64}$/.test(durableFingerprint)) {
      throw createInstantlyAttachmentEvidenceError();
    }
    const requestedFingerprint = createMailboxRequestPayloadFingerprint({
      subject: body.subject,
      requestBody: body.body || body.text || '',
      cc: body.cc,
      bcc: body.bcc,
      attachmentsMetadata: requestedMetadata,
    }, normalizeString);
    if (requestedFingerprint === durableFingerprint) return durableMetadata;
  } else {
    const legacyFieldsMatch = normalizeString(intent.subject) === normalizeString(body.subject)
      && normalizeString(intent.body) === normalizeString(body.body || body.text || '')
      && normalizeString(intent.cc).toLowerCase() === normalizeString(body.cc).toLowerCase()
      && normalizeString(intent.bcc).toLowerCase() === normalizeString(body.bcc).toLowerCase();
    if (legacyFieldsMatch) return durableMetadata;
  }
  throw createInstantlyReplayError(
    'De veilige verzend-ID hoort bij andere mailinhoud of bijlagen; open de mail opnieuw voordat je opnieuw verzendt.',
    'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH',
    false
  );
}

function createInstantlyAcceptedReplayResult(intent, attachments) {
  const acceptedAt = intent.acceptedAt || intent.updatedAt || intent.createdAt || '';
  const messageId = intent.messageId || intent.providerMessageId || '';
  return {
    provider: 'instantly',
    providerMessageId: intent.providerMessageId,
    providerThreadId: intent.providerThreadId,
    accountEmail: intent.accountEmail,
    owner: intent.owner,
    intentId: intent.intentId,
    messageId,
    idempotentReplay: true,
    sentMessage: {
      id: `accepted-sent:${messageId || intent.intentId}`,
      mailboxId: `accepted-sent:${messageId || intent.intentId}`,
      folder: 'sent',
      storageFolder: 'instantly',
      direction: 'sent',
      accountEmail: intent.accountEmail,
      provider: 'instantly',
      providerOwner: intent.owner,
      providerMessageId: intent.providerMessageId,
      providerThreadId: intent.providerThreadId,
      messageId,
      from: intent.senderName || intent.accountEmail,
      email: intent.accountEmail,
      to: intent.recipientEmail,
      toDisplay: intent.recipientEmail,
      cc: intent.cc,
      bcc: intent.bcc,
      recipientRoutingEvidenceKnown: true,
      subject: intent.subject,
      body: intent.body,
      preview: intent.body,
      receivedAt: acceptedAt,
      activityAt: acceptedAt,
      hasBody: true,
      bodyLoaded: true,
      bodyTruncated: false,
      unread: false,
      attachments,
      attachmentEvidenceKnown: true,
      attachmentHydrationAttempted: true,
      conversationId: intent.conversationId,
      softoraConversationId: intent.conversationId,
      softoraSendIntentId: intent.intentId,
      softoraSendMode: intent.mode,
      softoraReplyTargetMessageId: intent.replyTargetMessageId,
    },
  };
}

function resolveInstantlyExistingIntent(intent, threadProvenance, body, normalizeString) {
  if (!intent) return null;
  assertInstantlyReplayContext(intent, threadProvenance, body, normalizeString);
  const durableAttachments = assertInstantlyReplayPayload(intent, body, normalizeString);
  if (intent.status === 'accepted') {
    return createInstantlyAcceptedReplayResult(intent, durableAttachments);
  }
  if (intent.status === 'failed') {
    throw createInstantlyReplayError(
      'De vorige verzendpoging is definitief gestopt; probeer opnieuw met een nieuwe veilige verzend-ID.',
      'MAILBOX_SEND_PREVIOUSLY_FAILED',
      false
    );
  }
  if (
    intent.status === 'unknown'
    || intent.reconcileRequired === true
    || (intent.status === 'prepared' && intent.dispatchState === 'started')
  ) {
    const cause = new Error(
      'Deze Instantly-verzend-ID heeft een providerdispatch zonder duurzaam bevestigde eindstatus.'
    );
    cause.code = 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN';
    cause.intentId = intent.intentId;
    throw createMailboxReconcileRequiredError(cause);
  }
  throw createInstantlyReplayError(
    'Dit Instantly-antwoord wordt al veilig verwerkt.',
    'MAILBOX_SEND_ALREADY_PROCESSING',
    true
  );
}

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
    messageKey: stored.messageKey,
    messageId: stored.messageId,
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
    const results = [];
    for (const owner of owners) {
      results.push(await instantlyMailboxService.syncOwner(owner, syncOptions));
    }
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
  outboundRecipientGuardStore,
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
      expectedAttachmentsMetadata: body.reconcileProof === undefined
        ? undefined
        : body.attachmentsMetadata,
      threadProvenance,
    });
  }
  if (threadProvenance?.mode !== 'reply') {
    const error = new Error('Instantly ondersteunt hier alleen een bewezen antwoord in de bestaande thread.');
    error.status = 409;
    error.code = 'INSTANTLY_NEW_MESSAGE_UNSUPPORTED';
    throw error;
  }
  const requiredProvenanceMethods = [
    'findByIdempotencyKey', 'reserve', 'startDispatch', 'accept', 'fail', 'markUnknown',
  ];
  if (!mailboxSendProvenanceStore || requiredProvenanceMethods.some(
    (method) => typeof mailboxSendProvenanceStore[method] !== 'function'
  )) {
    const error = new Error('De duurzame Instantly-threadregistratie ontbreekt.');
    error.status = 503;
    error.code = 'MAILBOX_SEND_PROVENANCE_REQUIRED';
    throw error;
  }
  const existing = await mailboxSendProvenanceStore.findByIdempotencyKey(
    threadProvenance.idempotencyKey
  );
  const earlyReplay = resolveInstantlyExistingIntent(
    existing,
    threadProvenance,
    body,
    normalizeString
  );
  if (earlyReplay) return earlyReplay;

  const recipientEmails = [body.to, body.cc, body.bcc]
    .flatMap((value) => Array.isArray(value) ? value : String(value || '').split(/[;,]/))
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean);
  await assertOutboundRecipientsNotSuppressed({
    outboundRecipientGuardStore,
    identities: recipientEmails.map((recipientEmail) => ({ recipientEmail })),
    channel: 'instantly-mailbox-reply',
  });
  const reservation = await mailboxSendProvenanceStore.reserve({
    ...threadProvenance,
    accountEmail: body.account,
    recipientEmail: body.to,
    senderName: threadProvenance.senderName,
    subject: body.subject,
    body: body.body || body.text || '',
    requestBody: body.body || body.text || '',
    cc: body.cc,
    bcc: body.bcc,
    attachmentsMetadata: [],
  });
  if (!reservation.created) {
    return resolveInstantlyExistingIntent(
      reservation.intent,
      threadProvenance,
      body,
      normalizeString
    );
  }
  await mailboxSendProvenanceStore.startDispatch(threadProvenance.intentId);
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
    });
  } catch (error) {
    if (isAmbiguousMailboxProviderError(error)) {
      await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, error, { sentReconcileRequired: true })
        .catch(() => null);
      throw createMailboxReconcileRequiredError(error);
    }
    try {
      const failedIntent = await mailboxSendProvenanceStore.fail(
        threadProvenance.intentId,
        error
      );
      if (!failedIntent || failedIntent.status !== 'failed') {
        const persistenceError = new Error(
          'De definitieve Instantly-providerfout kon niet duurzaam worden vastgelegd.'
        );
        persistenceError.code = 'MAILBOX_SEND_PROVENANCE_FAIL_UNCONFIRMED';
        throw persistenceError;
      }
    } catch (provenanceError) {
      await mailboxSendProvenanceStore.markUnknown(
        threadProvenance.intentId,
        provenanceError,
        { sentReconcileRequired: true }
      ).catch(() => null);
      const reconcileError = createMailboxReconcileRequiredError(provenanceError);
      reconcileError.providerError = error;
      throw reconcileError;
    }
    error.retryable = false;
    throw error;
  }
  const replyTargetProviderId = normalizeString(
    threadProvenance.replyTargetMessageId || body.providerMessageId
  );
  const returnedProviderMessageId = normalizeString(result?.providerMessageId);
  const returnedProviderMessageHeaderId = normalizeString(result?.sentMessage?.messageId);
  const providerMessageId = returnedProviderMessageId !== replyTargetProviderId
    ? returnedProviderMessageId
    : '';
  const providerMessageHeaderId = returnedProviderMessageHeaderId !== replyTargetProviderId
    ? returnedProviderMessageHeaderId
    : '';
  if (!providerMessageId && !providerMessageHeaderId) {
    const identityError = new Error(
      'Instantly accepteerde het antwoord zonder een duurzame berichtidentiteit.'
    );
    identityError.code = 'INSTANTLY_REPLY_ACCEPTED_IDENTITY_MISSING';
    await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, identityError, {
      sentReconcileRequired: true,
    }).catch(() => null);
    throw createMailboxReconcileRequiredError(identityError);
  }
  try {
    const acceptedMessageId = providerMessageHeaderId || providerMessageId;
    const accepted = await mailboxSendProvenanceStore.accept(threadProvenance.intentId, {
      messageId: acceptedMessageId,
      providerMessageId,
      providerThreadId: result.providerThreadId,
      acceptedAt: result.sentMessage?.receivedAt || new Date().toISOString(),
    });
    return {
      ...result,
      intentId: accepted.intentId,
      sentMessage: {
        ...(result.sentMessage || {}),
        messageId: acceptedMessageId,
        conversationId: threadProvenance.conversationId,
        softoraSendIntentId: threadProvenance.intentId,
        softoraSendMode: 'reply',
        softoraReplyTargetMessageId: threadProvenance.replyTargetMessageId,
      },
    };
  } catch (error) {
    await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, error, {
      messageId: providerMessageHeaderId || providerMessageId,
      providerMessageId: result?.providerMessageId,
      sentReconcileRequired: true,
    }).catch(() => null);
    throw createMailboxReconcileRequiredError(error);
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
  sendMailboxMessage,
  syncInstantlyMailboxResponse,
};
