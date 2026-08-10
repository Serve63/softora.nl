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

  async function sendMessageResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const threadProvenance = await mailboxComposeThreadContext.resolve({
        body,
        accountEmail: body.account,
        recipientEmail: body.to,
        provider: body.provider,
      });
      const result = await sendMailboxMessage({
        body,
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

  return { sendMessage, sendMessageResponse };
}

module.exports = { createMailboxComposeRuntime };
