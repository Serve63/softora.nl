function createMailboxReadMessageResponses(deps = {}) {
  const { markMessageRead, getMessageReadStatus, logger = console, normalizeString } = deps;

  function requestInput(req) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return {
      accountEmail: body.account,
      id: body.id || body.messageId,
      folder: body.folder,
      uid: body.uid,
      owner: body.owner,
      messageKey: body.messageKey,
      messageId: body.messageId,
      provider: body.provider,
      providerMessageId: body.providerMessageId,
      mutationId: body.mutationId || body.idempotencyKey,
      revision: body.revision,
      unread: body.unread === true,
      dismissReply: body.dismissReply === true,
    };
  }

  function safeError(error, fallbackCode, retryMessage, failureMessage) {
    const retryable = error?.retryable === true;
    return {
      ok: false,
      error: retryable ? retryMessage : normalizeString(error?.message) || failureMessage,
      code: normalizeString(error?.code) || fallbackCode,
      retryable,
    };
  }

  async function respond(action, req, res, settings) {
    try {
      return res.status(200).json({ ok: true, result: await action(requestInput(req)) });
    } catch (error) {
      logger.error(settings.logLabel, {
        code: normalizeString(error?.code) || settings.fallbackCode,
        status: Number(error?.status) || 500,
        retryable: error?.retryable === true,
      });
      return res.status(error.status || 500).json(safeError(
        error,
        settings.fallbackCode,
        settings.retryMessage,
        settings.failureMessage
      ));
    }
  }

  function markMessageReadResponse(req, res) {
    return respond(markMessageRead, req, res, {
      logLabel: '[Mailbox][Read]',
      fallbackCode: 'MAILBOX_READ_FAILED',
      retryMessage: 'Opslaan duurt langer dan verwacht; Softora probeert automatisch opnieuw.',
      failureMessage: 'Gelezen status opslaan mislukt.',
    });
  }

  function getMessageReadStatusResponse(req, res) {
    return respond(getMessageReadStatus, req, res, {
      logLabel: '[Mailbox][ReadStatus]',
      fallbackCode: 'MAILBOX_READ_STATUS_FAILED',
      retryMessage: 'Opslagstatus wordt automatisch opnieuw gecontroleerd.',
      failureMessage: 'Opslagstatus controleren mislukt.',
    });
  }

  return { getMessageReadStatusResponse, markMessageReadResponse };
}

module.exports = { createMailboxReadMessageResponses };
