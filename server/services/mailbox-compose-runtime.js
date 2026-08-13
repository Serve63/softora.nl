const crypto = require('crypto');
const { createMailboxComposeSend } = require('./mailbox-compose-send');
const { sendMailboxMessage } = require('./mailbox-instantly-integration');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

function createMailboxComposeRuntime(dependencies = {}) {
  const {
    composeSendDependencies,
    getAccount,
    instantlyMailboxService,
    mailboxComposeThreadContext,
    mailboxSendProvenanceStore,
    normalizeEmail,
    normalizeString,
    logger = console,
  } = dependencies;
  const sendMessageWithProvenance = createMailboxComposeSend({
    ...composeSendDependencies,
    mailboxSendProvenanceStore,
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
      });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error('[Mailbox][Send]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        code: normalizeString(error?.code) || 'MAILBOX_SEND_FAILED',
        error: 'Mail verzenden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
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

  return { prepareMessage, preflightMessageResponse, resolveRewriteIdentity, sendMessage, sendMessageResponse };
}

module.exports = { createMailboxComposeRuntime };
