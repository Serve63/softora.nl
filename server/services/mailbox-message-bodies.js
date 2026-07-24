const MAX_MAILBOX_BODY_BATCH_SIZE = 20;

function normalizeText(value) {
  return String(value || '').trim();
}

function createMailboxMessageBodiesService({
  mailboxIndexStore,
  assertReadableAccount,
  normalizeFolder,
  logger = console,
} = {}) {
  async function getMessageBodies({ messages = [] } = {}) {
    const source = Array.isArray(messages) ? messages : [];
    if (!source.length || source.length > MAX_MAILBOX_BODY_BATCH_SIZE) {
      const error = new Error(
        `Geef 1 tot ${MAX_MAILBOX_BODY_BATCH_SIZE} mailboxberichten op.`
      );
      error.status = 400;
      throw error;
    }
    if (!mailboxIndexStore || typeof mailboxIndexStore.hydrateMessageBodies !== 'function') {
      const error = new Error('Mailbox-index voor berichtinhoud is niet beschikbaar.');
      error.status = 503;
      throw error;
    }

    const references = source.map((message) => {
      const account = assertReadableAccount(message && message.account);
      const folder = normalizeFolder(message && message.folder);
      const id = normalizeText(message && message.id);
      const uid = Number(message && message.uid) ||
        Number(id.match(/:(\d+)$/)?.[1] || id);
      if (!Number.isSafeInteger(uid) || uid <= 0) {
        const error = new Error('Ongeldige mailboxberichtreferentie.');
        error.status = 400;
        throw error;
      }
      return {
        id: id || `${folder}:${uid}`,
        uid,
        folder,
        accountEmail: account.email,
      };
    });

    const hydrated = await mailboxIndexStore.hydrateMessageBodies({ messages: references });
    if (!Array.isArray(hydrated)) {
      const error = new Error('Mailboxberichtinhoud kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    return hydrated.map((message) => ({
      id: normalizeText(message && message.id),
      uid: Number(message && message.uid) || 0,
      folder: normalizeFolder(message && message.folder),
      accountEmail: normalizeText(message && message.accountEmail).toLowerCase(),
      body: normalizeText(message && message.body),
      hasBody: Boolean(message && (message.hasBody || message.body)),
      bodyTruncated: Boolean(message && message.bodyTruncated),
      bodyImageEvidenceKnown: Boolean(message && message.bodyImageEvidenceKnown),
      embeddedImageCount: Math.max(
        0,
        Math.min(8, Number(message && message.embeddedImageCount) || 0)
      ),
      originalCampaignOutbound: Boolean(message && message.originalCampaignOutbound),
      webdesignLinkEvidenceKnown: Boolean(message && message.webdesignLinkEvidenceKnown),
      webdesignLinkUrl: normalizeText(message && message.webdesignLinkUrl),
    }));
  }

  async function getMessageBodiesResponse(req, res) {
    try {
      const messages = await getMessageBodies({
        messages: req.body && req.body.messages,
      });
      return res.status(200).json({ ok: true, messages });
    } catch (error) {
      logger.error('[Mailbox][MessageBodies]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailboxberichtinhoud laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return { getMessageBodies, getMessageBodiesResponse };
}

module.exports = {
  MAX_MAILBOX_BODY_BATCH_SIZE,
  createMailboxMessageBodiesService,
};
