'use strict';

const {
  createMailboxReconcileRequiredError,
  isDefinitiveMailboxProviderRejection,
} = require('./mailbox-send-provenance-store');
const { createColdmailPostSmtpReconciliation } = require('./coldmail-post-smtp-reconciliation');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');
const COLDMAIL_GENERIC_SERVE_SENDERS = new Set([
  'info@softora.nl', 'zakelijk@softora.nl', 'ruben@softora.nl',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getColdmailOwner(email) {
  return getOutboundSenderIdentity(email)?.profileKey
    || (COLDMAIL_GENERIC_SERVE_SENDERS.has(normalizeEmail(email)) ? 'serve' : '');
}

function createMismatchError(message) {
  const error = new Error(message);
  error.code = 'COLDMAIL_SEND_PROVENANCE_MISMATCH';
  return error;
}

function createColdmailSendProvenance(deps = {}) {
  const {
    store = null,
    getOwner = getColdmailOwner,
    getSenderName = (email) => getOutboundSenderIdentity(email)?.name || email,
    logger = console,
  } = deps;

  async function reserve(input = {}) {
    if (!store) throw createMismatchError('Duurzame coldmail-sendprovenance is niet beschikbaar.');
    const reservationId = normalizeText(input.reservationId);
    const accountEmail = normalizeEmail(input.accountEmail);
    const recipientEmail = normalizeEmail(input.recipientEmail);
    const owner = normalizeText(getOwner(accountEmail)).toLowerCase();
    if (!reservationId || !accountEmail || !recipientEmail || !['serve', 'martijn'].includes(owner)) {
      throw createMismatchError('Coldmail-send mist een exacte reservering, eigenaar of mailboxidentiteit.');
    }
    const intentId = `coldmail:${reservationId}`;
    const provenanceInput = {
      intentId,
      idempotencyKey: intentId,
      owner,
      accountEmail,
      recipientEmail,
      mode: 'new-message',
      conversationId: intentId,
      provider: 'smtp',
      senderName: normalizeText(getSenderName(accountEmail)) || accountEmail,
      subject: normalizeText(input.subject),
      body: normalizeText(input.body),
      cc: normalizeText(input.cc),
      bcc: normalizeText(input.bcc),
      attachments: Array.isArray(input.attachments) ? input.attachments : [],
    };
    if (typeof store.claimPreDispatch !== 'function'
      || typeof store.finalizeClaim !== 'function'
      || typeof store.failPreDispatch !== 'function') {
      throw createMismatchError('Coldmail-send mist de duurzame pre-dispatchclaim.');
    }
    const claim = await store.claimPreDispatch(provenanceInput);
    if (!claim.created) {
      throw createMismatchError('Coldmail-sendprovenance bestond al vóór deze providerdispatch.');
    }
    let finalClaim;
    try {
      finalClaim = await store.finalizeClaim(claim, provenanceInput);
    } catch (error) {
      await store.failPreDispatch(claim, error).catch((claimError) => {
        logger.error('[ColdmailSendProvenance][FailPreDispatch]', claimError?.message || claimError);
      });
      throw error;
    }
    return { intentId, accountEmail, recipientEmail, preDispatchHandle: finalClaim };
  }

  async function startDispatch(intent) {
    const handle = intent && intent.preDispatchHandle;
    if (handle && store && typeof store.startDispatch === 'function') {
      await store.startDispatch(handle);
    } else if (intent) {
      throw createMismatchError('Coldmail-providerdispatch mist het definitieve claimtoken.');
    }
    return intent;
  }

  async function fail(intent, errorValue, options = {}) {
    const intentId = normalizeText(intent && intent.intentId);
    const ambiguous = options.providerDispatchStarted === true
      && !isDefinitiveMailboxProviderRejection(errorValue);
    if (ambiguous) {
      if (intentId && store && typeof store.markUnknown === 'function') {
        try {
          await store.markUnknown(intentId, errorValue, { sentReconcileRequired: true });
        } catch (error) {
          logger.error('[ColdmailSendProvenance][Unknown]', error?.message || error);
        }
      }
      return { ambiguous: true, error: createMailboxReconcileRequiredError(errorValue) };
    }
    if (!intentId || !store || typeof store.fail !== 'function') {
      return { ambiguous: false, error: errorValue };
    }
    try {
      if (options.providerDispatchStarted !== true && intent?.preDispatchHandle
        && typeof store.failPreDispatch === 'function') {
        const committedStartIntent = errorValue?.code === 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED'
          && normalizeText(errorValue?.intent?.intentId) === intentId
          && normalizeText(errorValue?.intent?.dispatchState).toLowerCase() === 'started'
          ? errorValue.intent
          : null;
        const abortHandle = committedStartIntent
          ? { intent: committedStartIntent, finalToken: committedStartIntent.transitionToken }
          : intent.preDispatchHandle;
        const failed = await store.failPreDispatch(abortHandle, errorValue);
        if (failed?.status !== 'failed' || failed?.dispatchState !== 'finished') {
          throw createMismatchError('Coldmail-stop vóór providerdispatch kon niet duurzaam worden bevestigd.');
        }
      } else {
        const failed = await store.fail(intentId, errorValue);
        if (failed?.status !== 'failed' || failed?.dispatchState !== 'finished') {
          throw createMismatchError('Coldmail-providerfout kon niet duurzaam worden afgesloten.');
        }
      }
    } catch (error) {
      logger.error('[ColdmailSendProvenance][Fail]', error?.message || error);
      if (options.providerDispatchStarted === true) {
        return { ambiguous: true, error: createMailboxReconcileRequiredError(error) };
      }
      if (options.providerDispatchStarted !== true && intent?.preDispatchHandle) {
        const existing = typeof store.findByIdempotencyKey === 'function'
          ? await store.findByIdempotencyKey(intentId).catch(() => null)
          : null;
        const safelyFailed = existing?.intentId === intentId
          && existing?.status === 'failed'
          && existing?.dispatchState === 'finished';
        if (!safelyFailed) {
          return { ambiguous: true, error: createMailboxReconcileRequiredError(error) };
        }
      }
    }
    return { ambiguous: false, error: errorValue };
  }

  async function markAcceptedUnknown(intent, evidence = {}, errorValue) {
    const intentId = normalizeText(intent && intent.intentId);
    if (!intentId || !store || typeof store.markUnknown !== 'function') {
      throw createMismatchError('Coldmail-sendprovenance kan niet voor veilig herstel worden gemarkeerd.');
    }
    try {
      return await store.markUnknown(intentId, errorValue, {
        sentReconcileRequired: true,
        messageId: normalizeText(evidence.messageId),
        providerMessageId: normalizeText(evidence.providerId),
      });
    } catch (error) {
      const existing = typeof store.findByIdempotencyKey === 'function'
        ? await store.findByIdempotencyKey(intentId).catch(() => null)
        : null;
      if (existing && existing.status === 'accepted' && normalizeText(existing.messageId) === normalizeText(evidence.messageId)) {
        return existing;
      }
      throw error;
    }
  }

  async function acceptEvidence(evidence = {}) {
    const intentId = normalizeText(evidence.sendIntentId);
    if (!intentId) return true;
    if (!store || typeof store.findByIdempotencyKey !== 'function' || typeof store.accept !== 'function') {
      throw createMismatchError('Duurzame coldmail-sendprovenance is niet beschikbaar.');
    }
    const existing = await store.findByIdempotencyKey(intentId);
    if (!existing || normalizeText(existing.intentId) !== intentId) {
      throw createMismatchError('Coldmail-sendprovenance ontbreekt na SMTP-acceptatie.');
    }
    if (
      normalizeEmail(existing.accountEmail) !== normalizeEmail(evidence.senderEmail) ||
      normalizeEmail(existing.recipientEmail) !== normalizeEmail(evidence.recipientEmail)
    ) {
      throw createMismatchError('Coldmail-sendprovenance wijkt af van het SMTP-bewijs.');
    }
    const messageId = normalizeText(evidence.messageId);
    if (existing.status === 'accepted') {
      if (normalizeText(existing.messageId) && messageId && normalizeText(existing.messageId) !== messageId) {
        throw createMismatchError('Coldmail-sendprovenance bevat een ander geaccepteerd Message-ID.');
      }
      return existing;
    }
    return store.accept(intentId, {
      messageId,
      acceptedAt: normalizeText(evidence.sentAt),
    });
  }

  async function getAcceptedEvidence(input = {}) {
    const reservationId = normalizeText(input.reservationId);
    if (!reservationId || !store || typeof store.findByIdempotencyKey !== 'function') return null;
    const intentId = `coldmail:${reservationId}`;
    const existing = await store.findByIdempotencyKey(intentId);
    const accepted = existing && existing.status === 'accepted';
    const acceptedPendingReconcile = existing && existing.status === 'unknown' && existing.sentReconcileRequired === true;
    if (
      !existing || normalizeText(existing.intentId) !== intentId || (!accepted && !acceptedPendingReconcile) ||
      !normalizeText(existing.messageId) ||
      (normalizeEmail(input.senderEmail) && normalizeEmail(existing.accountEmail) !== normalizeEmail(input.senderEmail)) ||
      (normalizeEmail(input.recipientEmail) && normalizeEmail(existing.recipientEmail) !== normalizeEmail(input.recipientEmail))
    ) return null;
    return {
      reservationId,
      sendIntentId: intentId,
      senderEmail: normalizeEmail(existing.accountEmail),
      recipientEmail: normalizeEmail(existing.recipientEmail),
      subject: normalizeText(existing.subject),
      messageId: normalizeText(existing.messageId),
      sentAt: normalizeText(existing.acceptedAt || existing.updatedAt),
      postSmtpEvidence: accepted ? 'send-provenance-accepted' : 'send-provenance-smtp-accepted-pending',
    };
  }

  return { acceptEvidence, fail, getAcceptedEvidence, markAcceptedUnknown, reserve, startDispatch };
}

function createColdmailSendDurability(deps = {}) {
  const {
    store = null,
    outboundRecipientGuardStore = null,
    dataOpsStore = null,
    getOwner = getColdmailOwner,
    getSenderName = (email) => getOutboundSenderIdentity(email)?.name || email,
    getSenderEmails = () => [],
    runPersistenceStep = async (_label, action) => action(),
    finalizeEvidence = async () => true,
    now = () => new Date(),
    logger = console,
  } = deps;
  const provenance = createColdmailSendProvenance({ store, getOwner, getSenderName, logger });
  const reconciliation = createColdmailPostSmtpReconciliation({
    outboundRecipientGuardStore,
    dataOpsStore,
    getSenderEmails,
    now,
    logger,
    finalizeProvenance: (evidence) => runPersistenceStep(
      'sendprovenance',
      () => provenance.acceptEvidence(evidence)
    ),
    loadAcceptedProvenance: (input) => provenance.getAcceptedEvidence(input),
    finalizeEvidence,
  });

  async function dispatch(options = {}) {
    const normalizeAddress = typeof options.normalizeEmailAddress === 'function'
      ? options.normalizeEmailAddress
      : normalizeEmail;
    let intent = null;
    let providerDispatchStarted = false;
    try {
      intent = options.provenanceInput
        ? await provenance.reserve(options.provenanceInput)
        : null;
      if (typeof options.beforeStartDispatch === 'function') {
        await options.beforeStartDispatch({ intent });
      }
      await provenance.startDispatch(intent);
      providerDispatchStarted = true;
      const info = await options.sendProvider();
      const accepted = Array.isArray(info && info.accepted)
        ? info.accepted.map(normalizeAddress).filter(Boolean)
        : [];
      const rejected = Array.isArray(info && info.rejected)
        ? info.rejected.map(normalizeAddress).filter(Boolean)
        : [];
      const recipientEmail = normalizeAddress(options.recipientEmail);
      if (rejected.includes(recipientEmail) || (Array.isArray(info && info.accepted) && !accepted.length)) {
        const rejection = new Error('SMTP accepteerde de ontvanger niet.');
        rejection.code = 'SMTP_RECIPIENT_REJECTED';
        rejection.mailboxProviderResponseReceived = true;
        rejection.mailboxDefinitiveProviderRejection = true;
        throw rejection;
      }
      return { accepted, info, intent, rejected };
    } catch (error) {
      const failure = await provenance.fail(intent, error, { providerDispatchStarted });
      if (!failure.ambiguous && typeof options.onSafeFailure === 'function') {
        await options.onSafeFailure(error);
      }
      throw failure && failure.ambiguous ? failure.error : error;
    }
  }

  async function persistAccepted(intent, evidence = {}, sentCopyPromise = null) {
    const acceptedEvidence = {
      ...evidence,
      sendIntentId: intent && intent.intentId,
    };
    try {
      return await reconciliation.persistAcceptedSend(acceptedEvidence);
    } catch (error) {
      if (error && error.step === 'sendprovenance') {
        try {
          await runPersistenceStep(
            'sendprovenance-herstelmarkering',
            () => provenance.markAcceptedUnknown(intent, acceptedEvidence, error)
          );
        } catch (markError) {
          logger.error(
            '[Coldmail][sendprovenance-reconcile-mark]',
            markError && markError.message ? markError.message : markError
          );
        }
      }
      if (sentCopyPromise) await sentCopyPromise;
      throw error;
    }
  }

  return {
    dispatch,
    persistAccepted,
    reconcilePending: (options) => reconciliation.reconcilePending(options),
  };
}

module.exports = { createColdmailSendDurability, createColdmailSendProvenance };
