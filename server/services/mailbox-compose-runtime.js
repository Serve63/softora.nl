const crypto = require('crypto');
const { createMailboxComposeSend } = require('./mailbox-compose-send');
const { createMailboxAttachmentService } = require('./mailbox-attachment-service');
const { sendMailboxMessage } = require('./mailbox-instantly-integration');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

const TEMPORARY_MAILBOX_SEND_MESSAGE =
  'De veilige verzendcontrole heeft tijdelijk geen verbinding. Je mail is niet verzonden en je concept blijft staan; probeer het opnieuw.';

function isTemporaryMailboxSendInfrastructureError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const text = String(
    error?.message || error?.details || error?.hint || error?.name || error || ''
  ).trim();
  if ([
    'MAILBOX_REPLY_TARGET_UNAVAILABLE',
    'MAILBOX_SEND_PROVENANCE_UNAVAILABLE',
    'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED',
    'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED',
    'SUPABASE_REST_COOLDOWN',
    '57014',
  ].includes(code)) return true;
  return /(?:supabase|postgrest|mailbox index).*(?:abort|timeout|timed out|cooldown|504|503|fetch|network|temporar)/i.test(text)
    || /(?:abort|timeout|timed out|cooldown|504|503|fetch failed|network|temporar).*(?:supabase|postgrest|mailbox index)/i.test(text);
}

function setAcceptedSendIdentityHeaders(res, result = {}) {
  if (!res || typeof res.setHeader !== 'function') return;
  const sentMessage = result.sentMessage && typeof result.sentMessage === 'object'
    ? result.sentMessage
    : {};
  [
    ['X-Softora-Send-Intent-Id', result.intentId || sentMessage.softoraSendIntentId],
    ['X-Softora-Message-Id', result.messageId || sentMessage.messageId],
    ['X-Softora-Provider-Message-Id', result.providerMessageId || sentMessage.providerMessageId],
  ].forEach(([name, rawValue]) => {
    const value = String(rawValue || '').replace(/[\r\n]/g, '').trim().slice(0, 1000);
    if (value) res.setHeader(name, value);
  });
}

function createMailboxComposeRuntime(dependencies = {}) {
  const {
    composeSendDependencies,
    getAccount,
    instantlyMailboxService,
    mailboxComposeThreadContext,
    mailboxSendProvenanceStore,
    mailboxAttachmentService,
    getSupabaseClient,
    attachmentSigningSecret = '',
    normalizeEmail,
    normalizeString,
    logger = console,
  } = dependencies;
  const resolvedMailboxAttachmentService = mailboxAttachmentService || createMailboxAttachmentService({
    getSupabaseClient,
    secret: attachmentSigningSecret || process.env.PREMIUM_SESSION_SECRET || '',
    logger,
  });
  const sendMessageWithProvenance = createMailboxComposeSend({
    ...composeSendDependencies,
    mailboxSendProvenanceStore,
    mailboxAttachmentService: resolvedMailboxAttachmentService,
    logger,
  });

  async function sendMessage(input = {}) {
    if (input.threadProvenance) return sendMessageWithProvenance(input);
    const accountEmail = normalizeEmail(input.accountEmail);
    const identity = getOutboundSenderIdentity(accountEmail);
    const threadProvenance = await mailboxComposeThreadContext.resolve({
      accountEmail,
      recipientEmail: input.to,
      body: {
        owner: identity?.profileKey || '',
        mode: 'new-message',
        idempotencyKey: `server-direct:${crypto.randomUUID()}`,
        context: {},
      },
    });
    return sendMessageWithProvenance({ ...input, threadProvenance });
  }

  async function resolveRewriteIdentity({ context = {}, accountEmail, recipientEmail, isReply }) {
    const identity = context?.replyIdentity && typeof context.replyIdentity === 'object'
      ? context.replyIdentity
      : {};
    const resolved = await mailboxComposeThreadContext.resolveReplyIdentity({
      body: {
        account: accountEmail,
        owner: identity.owner || context.providerOwner,
        provider: identity.provider || context.provider,
        providerMessageId: identity.providerMessageId || context.providerMessageId,
        providerThreadId: identity.providerThreadId || context.providerThreadId,
        replyIdentity: context.replyIdentity,
        context,
      },
      accountEmail,
      recipientEmail,
      provider: identity.provider || context.provider,
      mode: isReply ? 'reply' : 'new-message',
    });
    return { resolvedAccountEmail: resolved.accountEmail, accountSenderName: resolved.senderName };
  }

  async function sendMessageResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { canonicalBody, threadProvenance } = await prepareMessage(body);
      const result = await sendMailboxMessage({
        body: canonicalBody,
        instantlyMailboxService,
        sendMessage,
        normalizeString,
        threadProvenance,
        mailboxSendProvenanceStore,
        outboundRecipientGuardStore: composeSendDependencies?.outboundRecipientGuardStore,
      });
      setAcceptedSendIdentityHeaders(res, result);
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error('[Mailbox][Send]', error?.message || error);
      if (isTemporaryMailboxSendInfrastructureError(error)) {
        return res.status(503).json({
          ok: false,
          code: 'MAILBOX_SEND_TEMPORARY',
          error: 'Mail niet verzonden',
          detail: TEMPORARY_MAILBOX_SEND_MESSAGE,
          retryable: true,
        });
      }
      return res.status(error.status || 500).json({
        ok: false,
        code: normalizeString(error?.code) || 'MAILBOX_SEND_FAILED',
        error: 'Mail verzenden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  function safeAttachmentErrorMessage(error) {
    const code = normalizeString(error?.code).toUpperCase();
    if (code === 'MAILBOX_ATTACHMENT_REFERENCE_EXPIRED') return 'De bijlage-upload is verlopen; kies de bijlage opnieuw.';
    if (code === 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH') return 'De bijlage hoort niet bij deze veilige verzendcontext.';
    if (code.startsWith('MAILBOX_ATTACHMENT_STORAGE') || code === 'MAILBOX_ATTACHMENT_SIGNING_UNAVAILABLE') {
      return 'Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.';
    }
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    return message && message !== '[object Object]'
      ? message
      : 'Bijlagen konden niet veilig worden verwerkt; de mail is niet verzonden.';
  }

  async function attachmentUploadResponse(req, res) {
    try {
      if (!resolvedMailboxAttachmentService || typeof resolvedMailboxAttachmentService.createUploadPlan !== 'function') {
        const error = new Error('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.');
        error.status = 503;
        error.code = 'MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE';
        throw error;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { threadProvenance } = await prepareMessage(body);
      const uploads = await resolvedMailboxAttachmentService.createUploadPlan({
        attachments: body.attachments,
        binding: threadProvenance,
      });
      return res.status(200).json({ ok: true, uploads });
    } catch (error) {
      logger.error('[Mailbox][AttachmentUploadPlan]', error?.message || error);
      return res.status(error.status || 503).json({
        ok: false,
        code: normalizeString(error?.code) || 'MAILBOX_ATTACHMENT_UPLOAD_FAILED',
        error: 'Bijlagen voorbereiden mislukt',
        detail: safeAttachmentErrorMessage(error),
      });
    }
  }

  async function attachmentCleanupResponse(req, res) {
    try {
      if (!resolvedMailboxAttachmentService || typeof resolvedMailboxAttachmentService.cleanupAttachments !== 'function') {
        return res.status(200).json({ ok: true, removed: 0 });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { threadProvenance } = await prepareMessage({ ...body, attachments: [] });
      const result = await resolvedMailboxAttachmentService.cleanupAttachments(body.attachments, threadProvenance);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logger.warn('[Mailbox][AttachmentCleanup]', error?.message || error);
      return res.status(error.status || 503).json({
        ok: false,
        code: normalizeString(error?.code) || 'MAILBOX_ATTACHMENT_CLEANUP_FAILED',
        error: 'Tijdelijke bijlagen konden niet direct worden opgeruimd',
        detail: safeAttachmentErrorMessage(error),
      });
    }
  }

  async function prepareMessage(body = {}, { checkReservation = false } = {}) {
    const threadProvenance = await mailboxComposeThreadContext.resolve({
      body,
      accountEmail: body.account,
      recipientEmail: body.to,
      provider: body.provider,
    });
    if (threadProvenance.provider === 'instantly' && Array.isArray(body.attachments) && body.attachments.length) {
      const error = new Error('Instantly ondersteunt geen bijlagen bij antwoorden; verwijder de bijlage of verstuur via de gewone mailbox.');
      error.status = 400;
      error.code = 'INSTANTLY_ATTACHMENTS_UNSUPPORTED';
      throw error;
    }
    const canonicalBody = {
      ...body,
      account: threadProvenance.accountEmail,
      owner: threadProvenance.owner,
      provider: threadProvenance.provider === 'instantly' ? 'instantly' : '',
      providerMessageId: threadProvenance.provider === 'instantly' ? threadProvenance.replyTargetMessageId : '',
      providerThreadId: threadProvenance.provider === 'instantly' ? threadProvenance.providerThreadId : '',
    };
    const reservationInput = {
      ...threadProvenance,
      accountEmail: canonicalBody.account,
      recipientEmail: canonicalBody.to,
      senderName: threadProvenance.senderName,
      subject: canonicalBody.subject,
      body: canonicalBody.body || canonicalBody.text || '',
      cc: canonicalBody.cc,
      bcc: canonicalBody.bcc,
      attachments: canonicalBody.attachments,
    };
    const reservationCheck = checkReservation && typeof mailboxSendProvenanceStore?.preflight === 'function'
      ? await mailboxSendProvenanceStore.preflight(reservationInput)
      : {
          intent: typeof mailboxSendProvenanceStore?.preview === 'function'
            ? mailboxSendProvenanceStore.preview(reservationInput)
            : null,
          conflict: null,
        };
    return {
      threadProvenance,
      canonicalBody,
      reservationCheck,
    };
  }

  async function preflightMessageResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { canonicalBody, reservationCheck, threadProvenance } = await prepareMessage(body, { checkReservation: true });
      return res.status(200).json({
        ok: true,
        result: {
          preflight: true,
          externalEffect: false,
          provider: canonicalBody.provider || 'smtp',
          owner: threadProvenance.owner,
          accountEmail: threadProvenance.accountEmail,
          mode: threadProvenance.mode,
          conversationId: threadProvenance.conversationId,
          replyTargetMessageId: threadProvenance.replyTargetMessageId,
          providerThreadId: threadProvenance.providerThreadId,
          reservationReady: Boolean(
            reservationCheck?.intent?.sendIdentityKey
            && reservationCheck?.intent?.sendScopeKey
            && !reservationCheck?.conflict
          ),
          reservationConflictStatus: normalizeString(reservationCheck?.conflict?.status),
        },
      });
    } catch (error) {
      logger.error('[Mailbox][SendPreflight]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        code: normalizeString(error?.code) || 'MAILBOX_SEND_FAILED',
        error: 'Mailcontrole mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return {
    attachmentCleanupResponse,
    attachmentUploadResponse,
    prepareMessage,
    preflightMessageResponse,
    resolveRewriteIdentity,
    sendMessage,
    sendMessageResponse,
  };
}

module.exports = {
  TEMPORARY_MAILBOX_SEND_MESSAGE,
  createMailboxComposeRuntime,
  isTemporaryMailboxSendInfrastructureError,
};
