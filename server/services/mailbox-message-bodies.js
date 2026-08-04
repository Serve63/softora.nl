const MAX_MAILBOX_BODY_BATCH_SIZE = 20;

function normalizeText(value) {
  return String(value || '').trim();
}

function createMailboxMessageBodiesService({
  mailboxIndexStore,
  assertReadableAccount,
  getProviderAccount,
  canUseMailboxIndex,
  assertMailboxMessageVisible,
  normalizeFolder,
  logger = console,
} = {}) {
  function normalizeMessageFolder(value) {
    const folder = normalizeText(value).toLowerCase();
    return folder === 'instantly' ? 'instantly' : normalizeFolder(folder);
  }

  async function getInstantlyMessage({ accountEmail, id = '' } = {}) {
    const account = typeof getProviderAccount === 'function'
      ? getProviderAccount(accountEmail)
      : null;
    if (!account || !normalizeText(account.email)) {
      const error = new Error('Instantly-mailboxaccount niet gevonden.');
      error.status = 404;
      throw error;
    }
    const providerId = normalizeText(id);
    if (!/^instantly:[a-z0-9-]+$/i.test(providerId)) {
      const error = new Error('Ongeldige Instantly-berichtreferentie.');
      error.status = 400;
      throw error;
    }
    if (
      typeof canUseMailboxIndex !== 'function' ||
      !canUseMailboxIndex() ||
      !mailboxIndexStore ||
      typeof mailboxIndexStore.getMessage !== 'function'
    ) {
      const error = new Error('Mailbox-index voor Instantly is niet beschikbaar.');
      error.status = 503;
      throw error;
    }
    const indexed = await mailboxIndexStore.getMessage({
      accountEmail: normalizeText(account.email).toLowerCase(),
      folder: 'instantly',
      id: providerId,
    });
    if (!indexed) {
      const error = new Error('Instantly-mailboxbericht niet gevonden.');
      error.status = 404;
      throw error;
    }
    return typeof assertMailboxMessageVisible === 'function'
      ? assertMailboxMessageVisible(indexed)
      : indexed;
  }

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
      const folder = normalizeMessageFolder(message && message.folder);
      const id = normalizeText(message && message.id);
      if (folder === 'instantly') {
        const account = typeof getProviderAccount === 'function'
          ? getProviderAccount(message && message.account)
          : null;
        if (!account || !normalizeText(account.email)) {
          const error = new Error('Instantly-mailboxaccount niet gevonden.');
          error.status = 404;
          throw error;
        }
        if (!/^instantly:[a-z0-9-]+$/i.test(id)) {
          const error = new Error('Ongeldige Instantly-berichtreferentie.');
          error.status = 400;
          throw error;
        }
        return {
          id,
          uid: 0,
          folder,
          accountEmail: normalizeText(account.email).toLowerCase(),
        };
      }

      const account = assertReadableAccount(message && message.account);
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
      folder: normalizeMessageFolder(message && message.folder),
      accountEmail: normalizeText(message && message.accountEmail).toLowerCase(),
      resolved: message && message.bodyResolved === true,
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

  return { getInstantlyMessage, getMessageBodies, getMessageBodiesResponse };
}

module.exports = {
  MAX_MAILBOX_BODY_BATCH_SIZE,
  createMailboxMessageBodiesService,
};
