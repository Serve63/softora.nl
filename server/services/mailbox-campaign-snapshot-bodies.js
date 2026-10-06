// Fills the Mailbox page snapshot with the exact bodies (and AI presentation)
// that the browser would otherwise fetch per conversation after opening it.
// It uses the same /messages/bodies service, so a bootstrap conversation is
// identical to a hydrated one and can render completely without loading.
const MAX_SNAPSHOT_BODY_BATCH_SIZE = 20;
const SNAPSHOT_BODY_CONCURRENCY = 4;

function normalizeText(value) {
  return String(value || '').trim();
}

// A message needs the bodies service when its text is missing or cut off, or
// when its AI presentation is unknown (Instantly rows arrive with a body but
// without one). The service reads the stored presentation; nothing new is
// classified for a message the browser would have fetched on open anyway.
function needsBody(message) {
  if (!message || typeof message !== 'object') return false;
  const body = normalizeText(message.body);
  if (!(message.hasBody === true || body)) return false;
  return !body || message.bodyTruncated === true || !message.aiPresentation;
}

function buildReference(message, fallbackAccountEmail, defaultFolder) {
  const account = normalizeText(message.accountEmail || fallbackAccountEmail).toLowerCase();
  const folder = normalizeText(message.storageFolder || message.folder || defaultFolder).toLowerCase();
  const id = normalizeText(message.mailboxId || message.id);
  const uid = Number(message.uid) || 0;
  // Uid-less references need a live provider lookup; those stay on demand.
  if (!account || !folder || folder === 'outreach' || !id) return null;
  if (folder !== 'instantly' && !(uid > 0) && !/:\d+$/.test(id)) return null;
  return { account, folder, id, ...(folder !== 'instantly' && uid > 0 ? { uid } : {}) };
}

function applyBody(target, source, { root }) {
  const body = normalizeText(source.body);
  if (source.resolved !== true || (source.hasBody && !body)) return false;
  Object.assign(target, {
    body,
    hasBody: Boolean(source.hasBody || body),
    bodyTruncated: Boolean(source.bodyTruncated),
    bodyImageEvidenceKnown: Boolean(source.bodyImageEvidenceKnown),
    embeddedImageCount: source.embeddedImageCount,
    originalCampaignOutbound: Boolean(source.originalCampaignOutbound),
    webdesignLinkEvidenceKnown: Boolean(source.webdesignLinkEvidenceKnown),
    webdesignLinkUrl: source.webdesignLinkUrl,
    to: source.to || target.to,
    toDisplay: source.toDisplay || source.to || target.toDisplay,
    cc: source.cc,
    bcc: source.bcc,
    deliveredTo: source.deliveredTo,
    recipientRoutingEvidenceKnown: source.recipientRoutingEvidenceKnown === true,
    ...(source.attachmentEvidenceKnown === true
      ? { attachments: source.attachments, attachmentEvidenceKnown: true }
      : {}),
    ...(source.aiPresentation ? { aiPresentation: source.aiPresentation } : {}),
    ...(source.optOutUrl ? { optOutUrl: source.optOutUrl } : {}),
  });
  if (root) target.bodyLoaded = !target.bodyTruncated;
  return true;
}

function createMailboxCampaignSnapshotBodies({
  getMessageBodies,
  logger = console,
  batchSize = MAX_SNAPSHOT_BODY_BATCH_SIZE,
  concurrency = SNAPSHOT_BODY_CONCURRENCY,
} = {}) {
  async function readBatch(entries) {
    const references = entries.map((entry) => entry.reference);
    try {
      return await getMessageBodies({ messages: references });
    } catch (_error) {
      // One unreadable reference rejects a whole batch; keep the others.
      if (entries.length === 1) return [];
      const results = [];
      for (const entry of entries) results.push(...await readBatch([entry]));
      return results;
    }
  }

  return async function hydrateSnapshotBodies(messages) {
    const source = Array.isArray(messages) ? messages : [];
    if (typeof getMessageBodies !== 'function' || !source.length) return source;
    const startedAt = Date.now();
    const copies = source.map((message) => (message && typeof message === 'object'
      ? {
          ...message,
          threadMessages: Array.isArray(message.threadMessages)
            ? message.threadMessages.map((child) => (child && typeof child === 'object' ? { ...child } : child))
            : message.threadMessages,
        }
      : message));
    const entries = [];
    copies.forEach((message) => {
      if (!message || typeof message !== 'object') return;
      if (needsBody(message)) {
        const reference = buildReference(message, '', 'inbox');
        if (reference) entries.push({ target: message, reference, root: true });
      }
      (Array.isArray(message.threadMessages) ? message.threadMessages : []).forEach((child) => {
        if (!needsBody(child)) return;
        const reference = buildReference(child, message.accountEmail, 'sent');
        if (reference) entries.push({ target: child, reference, root: false });
      });
    });
    const batches = [];
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      batches.push(entries.slice(offset, offset + batchSize));
    }
    let cursor = 0;
    let applied = 0;
    async function worker() {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        const results = await readBatch(batch);
        const byIdentity = new Map((Array.isArray(results) ? results : []).map((result) => [
          `${normalizeText(result?.accountEmail).toLowerCase()}|${normalizeText(result?.id)}`,
          result,
        ]));
        batch.forEach((entry) => {
          const result = byIdentity.get(`${entry.reference.account}|${entry.reference.id}`);
          if (result && applyBody(entry.target, result, entry)) applied += 1;
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    logger.info?.('[Mailbox][CampaignSnapshotBodies]', {
      requested: entries.length, applied, batches: batches.length, durationMs: Date.now() - startedAt,
    });
    return copies;
  };
}

module.exports = {
  MAX_SNAPSHOT_BODY_BATCH_SIZE,
  createMailboxCampaignSnapshotBodies,
};
