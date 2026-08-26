const crypto = require('crypto');
const MAX_MAILBOX_BODY_BATCH_SIZE = 20;
const MAX_PROVIDER_MESSAGE_ID_HYDRATIONS_PER_BATCH = 1;
const PROVIDER_MESSAGE_ID_HYDRATION_TIMEOUT_MS = 18_000;
const PROVIDER_MESSAGE_ID_FOLDERS = Object.freeze(['sent', 'allmail']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeMessageId(value) {
  return normalizeText(value).replace(/^[<\s]+|[>\s]+$/g, '');
}

function isValidMessageId(value) {
  return /^[^<>\s@]{1,240}@[^<>\s@]{1,240}$/.test(normalizeMessageId(value));
}

function createMailboxMessageBodiesService({
  mailboxIndexStore,
  assertReadableAccount,
  getProviderAccount,
  canUseMailboxIndex,
  assertMailboxMessageVisible,
  normalizeFolder,
  fetchMessagesFromImap,
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

  async function hydrateProviderMessageReference(reference) {
    const unresolved = {
      id: reference.id,
      uid: 0,
      folder: reference.folder,
      accountEmail: reference.accountEmail,
      messageId: reference.requestMessageId,
      requestMessageId: reference.requestMessageId,
      providerMessageIdLookup: true,
      providerLookupRetryable: true,
      bodyResolved: false,
    };
    if (typeof fetchMessagesFromImap !== 'function') return unresolved;
    for (const folder of PROVIDER_MESSAGE_ID_FOLDERS) {
      try {
        const messages = await fetchMessagesFromImap({
          account: reference.account,
          folder,
          limit: 1,
          targetedOnly: true,
          exactMessageIdOnly: true,
          threadReferenceIds: [reference.requestMessageId],
          threadRecipientTerms: [],
          imapOperationTimeoutMs: PROVIDER_MESSAGE_ID_HYDRATION_TIMEOUT_MS,
          logImapOperation: true,
        });
        const exact = (Array.isArray(messages) ? messages : []).filter((message) => (
          normalizeMessageId(message && message.messageId).toLowerCase() === reference.canonicalMessageId
        ));
        if (exact.length === 1) {
          return {
            ...exact[0],
            bodyResolved: true,
            requestMessageId: reference.requestMessageId,
            providerMessageIdLookup: true,
          };
        }
        if (exact.length > 1) {
          logger.warn?.('[MailboxDetail][MessageIdHydration] dubbel exact providerbericht geweigerd', {
            account: reference.accountEmail,
            folder,
          });
          return unresolved;
        }
      } catch (error) {
        logger.warn?.('[MailboxDetail][MessageIdHydration]', {
          account: reference.accountEmail,
          folder,
          code: normalizeText(error && (error.code || error.status)) || 'UNKNOWN',
        });
      }
    }
    return unresolved;
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
        const providerMessageId = normalizeMessageId(message && message.messageId);
        const canonicalMessageId = providerMessageId.toLowerCase();
        if (!['sent', 'allmail'].includes(folder) || !isValidMessageId(providerMessageId)) {
          const error = new Error('Ongeldige mailboxberichtreferentie.');
          error.status = 400;
          throw error;
        }
        return {
          id,
          uid: 0,
          folder,
          accountEmail: account.email,
          account,
          canonicalMessageId,
          requestMessageId: `<${providerMessageId}>`,
          providerMessageIdLookup: true,
        };
      }
      return {
        id: id || `${folder}:${uid}`,
        uid,
        folder,
        accountEmail: account.email,
      };
    });

    const indexedReferences = references.filter((reference) => reference.providerMessageIdLookup !== true);
    const indexedHydrated = indexedReferences.length
      ? await mailboxIndexStore.hydrateMessageBodies({ messages: indexedReferences })
      : [];
    if (!Array.isArray(indexedHydrated)) {
      const error = new Error('Mailboxberichtinhoud kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    let indexedOffset = 0;
    const providerTargets = references
      .filter((reference) => reference.providerMessageIdLookup === true)
      .slice(0, MAX_PROVIDER_MESSAGE_ID_HYDRATIONS_PER_BATCH);
    const providerHydrated = new Map();
    for (const reference of providerTargets) {
      providerHydrated.set(
        `${reference.accountEmail}|${reference.canonicalMessageId}`,
        await hydrateProviderMessageReference(reference)
      );
    }
    const hydrated = references.map((reference) => {
      if (reference.providerMessageIdLookup !== true) return indexedHydrated[indexedOffset++];
      return providerHydrated.get(`${reference.accountEmail}|${reference.canonicalMessageId}`) || {
        id: reference.id,
        uid: 0,
        folder: reference.folder,
        accountEmail: reference.accountEmail,
        messageId: reference.requestMessageId,
        requestMessageId: reference.requestMessageId,
        providerMessageIdLookup: true,
        providerLookupRetryable: true,
        bodyResolved: false,
      };
    });
    return hydrated.map((message) => ({
      id: normalizeText(message && message.id),
      uid: Number(message && message.uid) || 0,
      folder: normalizeMessageFolder(message && message.folder),
      accountEmail: normalizeText(message && message.accountEmail).toLowerCase(),
      resolved: message && message.bodyResolved === true,
      requestMessageId: normalizeText(message && message.requestMessageId),
      providerMessageIdLookup: message && message.providerMessageIdLookup === true,
      providerLookupRetryable: message && message.providerLookupRetryable === true,
      body: normalizeText(message && message.body),
      hasBody: Boolean(message && (message.hasBody || message.body)),
      bodyTruncated: Boolean(message && message.bodyTruncated),
      bodyImageEvidenceKnown: Boolean(message && message.bodyImageEvidenceKnown),
      bodyImages: Array.isArray(message && message.bodyImages) ? message.bodyImages.slice(0, 8) : [],
      embeddedImageCount: Math.max(
        0,
        Math.min(8, Number(message && message.embeddedImageCount) || 0)
      ),
      originalCampaignOutbound: Boolean(message && message.originalCampaignOutbound),
      webdesignLinkEvidenceKnown: Boolean(message && message.webdesignLinkEvidenceKnown),
      webdesignLinkUrl: normalizeText(message && message.webdesignLinkUrl),
      to: normalizeText(message && message.to),
      toDisplay: normalizeText(message && (message.toDisplay || message.to)),
      cc: normalizeText(message && message.cc),
      bcc: normalizeText(message && message.bcc),
      deliveredTo: normalizeText(message && message.deliveredTo),
      recipientRoutingEvidenceKnown: message && message.recipientRoutingEvidenceKnown === true,
      attachmentEvidenceKnown: message && message.attachmentEvidenceKnown === true,
      attachments: Array.isArray(message && message.attachments) ? message.attachments : [],
      optOutUrl: normalizeText(message && message.optOutUrl),
    }));
  }

  async function getMessageBodiesResponse(req, res) {
    const startedAt = Date.now();
    const suppliedRequestId = normalizeText(req.headers && req.headers['x-mailbox-request-id']);
    const requestId = /^[a-z0-9-]{8,80}$/i.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
    const targetHash = crypto.createHash('sha256').update(JSON.stringify(
      (Array.isArray(req.body && req.body.messages) ? req.body.messages : []).map((message) => ({
        account: normalizeText(message && message.account).toLowerCase(),
        folder: normalizeText(message && message.folder).toLowerCase(),
        id: normalizeText(message && message.id),
        messageId: normalizeText(message && message.messageId),
      }))
    )).digest('hex').slice(0, 16);
    res.setHeader('X-Mailbox-Request-Id', requestId);
    try {
      const messages = await getMessageBodies({
        messages: req.body && req.body.messages,
      });
      const durationMs = Date.now() - startedAt;
      res.setHeader('Server-Timing', `mailbox-detail;dur=${durationMs}`);
      logger.info?.(`[MailboxDetail] ${JSON.stringify({ requestId, targetHash, source: 'index-targeted', durationMs, count: messages.length, resolved: messages.filter((message) => message.resolved).length, truncated: messages.filter((message) => message.bodyTruncated).length })}`);
      return res.status(200).json({ ok: true, messages });
    } catch (error) {
      logger.error(`[MailboxDetail] ${JSON.stringify({ requestId, targetHash, source: 'index-targeted', durationMs: Date.now() - startedAt, errorCode: normalizeText(error && (error.code || error.status)) || 'UNKNOWN' })}`);
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
