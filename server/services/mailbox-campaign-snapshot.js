const MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE = 'premium_mailbox_campaign_snapshot';
const {
  buildMailboxMessageImageUrl,
  isMailboxMessageImageUrl,
} = require('./mailbox-message-image');

const MAILBOX_CAMPAIGN_SNAPSHOT_KEY = 'softora_mailbox_campaign_snapshot_v2';
const MAILBOX_CAMPAIGN_SNAPSHOT_VERSION = 5;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES = 100;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS = 850_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_BODY_CHARS = 45_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_THREAD_BODY_CHARS = 25_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_IMAGE_CHARS = 80_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_BODY_MESSAGE_COUNT = MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES;
const MAILBOX_CAMPAIGN_SNAPSHOT_IMAGE_MESSAGE_COUNT = MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES;

function text(value, maxLength = 1000) {
  return String(value || '').slice(0, Math.max(0, Number(maxLength) || 0));
}

function selectSnapshotMessages(value) {
  const source = Array.isArray(value) ? value : [];
  if (source.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES) return source;
  const selected = new Set();
  source.forEach((message, index) => {
    if (
      selected.size < MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES &&
      text(message && message.provider, 50).toLowerCase() === 'instantly'
    ) {
      selected.add(index);
    }
  });
  for (let index = 0; index < source.length && selected.size < MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES; index += 1) {
    selected.add(index);
  }
  return source.filter((_message, index) => selected.has(index));
}

function sanitizeCampaign(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const campaign = {
    company: text(value.company, 500),
    account: text(value.account, 320).toLowerCase(),
    customerId: text(value.customerId, 320),
    status: text(value.status, 80),
    actionRequired: Boolean(value.actionRequired),
  };
  const provider = text(value.provider, 50).toLowerCase();
  const campaignId = text(value.campaignId, 500);
  if (provider) campaign.provider = provider;
  if (campaignId) campaign.campaignId = campaignId;
  return campaign;
}

function sanitizeOutreach(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const outreach = {
    customerId: text(value.customerId, 320),
    company: text(value.company, 500),
    email: text(value.email, 320).toLowerCase(),
    status: text(value.status, 80),
  };
  const provider = text(value.provider, 50).toLowerCase();
  const threadId = text(value.threadId, 500);
  const owner = text(value.owner, 50).toLowerCase();
  if (provider) outreach.provider = provider;
  if (threadId) outreach.threadId = threadId;
  if (owner) outreach.owner = owner;
  return outreach;
}

function sanitizeProviderProvenance(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const provider = text(source.provider, 50).toLowerCase();
  const provenance = {};
  const storageFolder = text(source.storageFolder, 50).toLowerCase();
  const direction = text(source.direction, 50).toLowerCase();
  const sourceFolders = Array.from(new Set(
      (Array.isArray(source.sourceFolders) ? source.sourceFolders : [])
        .map((folder) => text(folder, 50).toLowerCase())
        .filter(Boolean)
    )).slice(0, 10);
  if (storageFolder) provenance.storageFolder = storageFolder;
  if (direction) provenance.direction = direction;
  if (sourceFolders.length) provenance.sourceFolders = sourceFolders;
  if (!provider) return provenance;
  return {
    ...provenance,
    provider,
    providerMessageId: text(source.providerMessageId, 500),
    providerThreadId: text(source.providerThreadId, 500),
    providerCampaignId: text(source.providerCampaignId, 500),
    providerAccountEmail: text(source.providerAccountEmail || source.accountEmail, 320).toLowerCase(),
    providerOwner: text(source.providerOwner, 50).toLowerCase(),
    storageUid: Number.isFinite(Number(source.storageUid)) ? Number(source.storageUid) : 0,
    bodyLoaded: source.bodyLoaded === true,
    providerBodyHtmlEvidenceKnown: source.providerBodyHtmlEvidenceKnown === true,
    providerRichBodyAvailable: source.providerRichBodyAvailable === true,
    providerOriginalBodyEvidenceKnown: source.providerOriginalBodyEvidenceKnown === true,
    providerOriginalBodyAvailable: source.providerOriginalBodyAvailable === true,
  };
}

function sanitizeBodyImage(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dataUrl = String(value.dataUrl || value.src || '').trim();
  if (!dataUrl || !/^(?:data:image\/|https?:\/\/|\/)/i.test(dataUrl)) return null;
  const owner = String(value.owner || '').trim().toLowerCase() === 'sent-campaign'
    ? 'sent-campaign'
    : '';
  const createImage = (resolvedDataUrl) => {
    const image = {
      alt: text(value.alt || value.name || 'Afbeelding', 300),
      dataUrl: resolvedDataUrl,
    };
    if (owner) image.owner = owner;
    return image;
  };
  const proxyUrl = buildMailboxMessageImageUrl(options.message, options.imageIndex);
  if (/^data:image\//i.test(dataUrl) && proxyUrl) {
    return createImage(proxyUrl);
  }
  if (isMailboxMessageImageUrl(dataUrl)) {
    return createImage(dataUrl);
  }
  if (dataUrl.length > MAILBOX_CAMPAIGN_SNAPSHOT_MAX_IMAGE_CHARS) return null;
  return createImage(dataUrl);
}

function sanitizeAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map((attachment) => ({
    filename: text(attachment && attachment.filename || 'Bijlage', 180),
    contentType: text(attachment && attachment.contentType, 120).toLowerCase(),
    size: Math.max(0, Number(attachment && attachment.size) || 0),
  }));
}

function sanitizeThreadMessage(value, options = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawBody = String(source.body || '');
  const sourceBodyImages = Array.isArray(source.bodyImages) ? source.bodyImages : [];
  const bodyImages = (options.includeImages === false ? [] : sourceBodyImages)
    .map((image, imageIndex) => sanitizeBodyImage(image, { message: source, imageIndex }))
    .filter(Boolean)
    .slice(0, 2);
  const body = options.includeBody === false
    ? ''
    : text(rawBody, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_THREAD_BODY_CHARS);
  const bodyImageEvidenceKnown =
    source.bodyImageEvidenceKnown === true ||
    (
      source.bodyImageEvidenceKnown !== false &&
      Object.prototype.hasOwnProperty.call(source, 'embeddedImageCount')
    );
  return {
    ...sanitizeProviderProvenance(source),
    id: text(source.id, 500),
    uid: Number.isFinite(Number(source.uid)) ? Number(source.uid) : 0,
    folder: text(source.folder || 'sent', 50).toLowerCase() || 'sent',
    accountEmail: text(source.accountEmail, 320).toLowerCase(),
    from: text(source.from, 500),
    email: text(source.email, 320).toLowerCase(),
    to: text(source.to, 2000),
    toDisplay: text(source.toDisplay, 2000),
    cc: text(source.cc, 2000),
    bcc: text(source.bcc, 2000),
    deliveredTo: text(source.deliveredTo, 1000),
    recipientRoutingEvidenceKnown: source.recipientRoutingEvidenceKnown === true,
    attachments: sanitizeAttachments(source.attachments),
    subject: text(source.subject || '(Geen onderwerp)', 1000),
    preview: text(source.preview, 1000),
    body,
    optOutUrl: text(source.optOutUrl, 4000),
    date: text(source.date, 100),
    messageId: text(source.messageId, 1000),
    inReplyTo: text(source.inReplyTo, 1000),
    references: text(source.references, 4000),
    hasBody: Boolean(source.hasBody || rawBody),
    bodyImageEvidenceKnown,
    embeddedImageCount: bodyImageEvidenceKnown
      ? Math.max(0, Math.min(8, Number(source.embeddedImageCount) || 0))
      : 0,
    originalCampaignOutbound: source.originalCampaignOutbound === true,
    webdesignLinkEvidenceKnown: source.webdesignLinkEvidenceKnown === true,
    webdesignLinkUrl: text(source.webdesignLinkUrl, 4000),
    bodyTruncated: Boolean(source.bodyTruncated || rawBody.length > body.length),
    bodyImagesTruncated: Boolean(source.bodyImagesTruncated || sourceBodyImages.length > bodyImages.length),
    bodyImages,
  };
}

function resolveMessageActivityAt(source) {
  const candidates = [
    source.activityAt,
    source.receivedAt,
    source.internalDate,
    source.date,
    ...(Array.isArray(source.threadMessages)
      ? source.threadMessages.flatMap((message) => [
          message && message.activityAt,
          message && message.receivedAt,
          message && message.internalDate,
          message && message.date,
        ])
      : []),
  ];
  const latestTimestamp = candidates.reduce((latest, value) => {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);
  if (latestTimestamp > 0) return new Date(latestTimestamp).toISOString();
  return text(source.activityAt || source.receivedAt || source.internalDate || source.date, 100);
}

function sanitizeMessage(value, options = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawBody = String(source.body || '');
  const sourceBodyImages = Array.isArray(source.bodyImages) ? source.bodyImages : [];
  const bodyImages = (options.includeImages === false ? [] : sourceBodyImages)
    .map((image, imageIndex) => sanitizeBodyImage(image, { message: source, imageIndex }))
    .filter(Boolean)
    .slice(0, 2);
  const body = options.includeBody === false
    ? ''
    : text(rawBody, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_BODY_CHARS);
  const bodyImageEvidenceKnown =
    source.bodyImageEvidenceKnown === true ||
    (
      source.bodyImageEvidenceKnown !== false &&
      Object.prototype.hasOwnProperty.call(source, 'embeddedImageCount')
    );
  return {
    ...sanitizeProviderProvenance(source),
    id: text(source.id, 500),
    mailboxId: text(source.mailboxId || source.id, 500),
    uid: Number.isFinite(Number(source.uid)) ? Number(source.uid) : 0,
    folder: text(source.folder || 'inbox', 50).toLowerCase() || 'inbox',
    accountEmail: text(source.accountEmail, 320).toLowerCase(),
    from: text(source.from, 500),
    email: text(source.email, 320).toLowerCase(),
    to: text(source.to, 2000),
    toDisplay: text(source.toDisplay, 2000),
    cc: text(source.cc, 2000),
    bcc: text(source.bcc, 2000),
    deliveredTo: text(source.deliveredTo, 1000),
    recipientRoutingEvidenceKnown: source.recipientRoutingEvidenceKnown === true,
    attachments: sanitizeAttachments(source.attachments),
    subject: text(source.subject || '(Geen onderwerp)', 1000),
    preview: text(source.preview, 1000),
    body,
    optOutUrl: text(source.optOutUrl, 4000),
    date: text(source.date, 100),
    receivedAt: text(source.receivedAt || source.date, 100),
    activityAt: resolveMessageActivityAt(source),
    messageId: text(source.messageId, 1000),
    inReplyTo: text(source.inReplyTo, 1000),
    references: text(source.references, 4000),
    conversationId: text(source.conversationId, 2000),
    unread: Boolean(source.unread),
    starred: Boolean(source.starred),
    hasBody: Boolean(source.hasBody || rawBody),
    bodyImageEvidenceKnown,
    embeddedImageCount: bodyImageEvidenceKnown
      ? Math.max(0, Math.min(8, Number(source.embeddedImageCount) || 0))
      : 0,
    originalCampaignOutbound: source.originalCampaignOutbound === true,
    webdesignLinkEvidenceKnown: source.webdesignLinkEvidenceKnown === true,
    webdesignLinkUrl: text(source.webdesignLinkUrl, 4000),
    bodyTruncated: Boolean(source.bodyTruncated || rawBody.length > body.length),
    bodyImagesTruncated: Boolean(source.bodyImagesTruncated || sourceBodyImages.length > bodyImages.length),
    indexed: source.indexed !== false,
    copyContext: source.copyContext && source.copyContext.evidenceKnown === true
      ? {
          evidenceKnown: true,
          kind: ['bcc', 'cc'].includes(text(source.copyContext.kind, 10).toLowerCase())
            ? text(source.copyContext.kind, 10).toLowerCase()
            : '',
          sourceAccountEmail: text(source.copyContext.sourceAccountEmail, 320).toLowerCase(),
          sourceName: text(source.copyContext.sourceName, 500),
          sourceEmail: text(source.copyContext.sourceEmail, 320).toLowerCase(),
          recipientName: text(source.copyContext.recipientName, 500),
          recipientEmail: text(source.copyContext.recipientEmail, 320).toLowerCase(),
          copyAccountEmail: text(source.copyContext.copyAccountEmail, 320).toLowerCase(),
          evidence: text(source.copyContext.evidence, 200),
        }
      : null,
    campaign: sanitizeCampaign(source.campaign),
    outreach: sanitizeOutreach(source.outreach),
    bodyImages,
    threadMessages: (Array.isArray(source.threadMessages) ? source.threadMessages : [])
      .map((message) => sanitizeThreadMessage(message, {
        includeBody: options.includeBody !== false,
        includeImages: options.includeImages !== false,
      })),
  };
}

function serialize(value) {
  return JSON.stringify(value);
}

function fitSnapshotToBudget(snapshot) {
  let serialized = serialize(snapshot);
  if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;

  // Proxy image URLs are tiny and let the browser render images immediately.
  // Drop the much larger bodies from the oldest messages first, so the newest
  // complete messages and image references survive within the fixed budget.
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (index > 0 && snapshot.messages[index].body) {
      snapshot.messages[index].body = '';
      snapshot.messages[index].bodyTruncated = true;
    }
    if (index > 0 && snapshot.messages[index].threadMessages.length) {
      snapshot.messages[index].threadMessages.forEach((message) => {
        if (message.body) message.bodyTruncated = true;
        message.body = '';
      });
    }
    serialized = serialize(snapshot);
    if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;
  }

  // A single active conversation can contain years of correspondence. Keep
  // every message and its preview, but drop hydrated thread bodies when that
  // one conversation alone would exceed the snapshot budget. Opening it still
  // fetches the complete hydrated conversation from the mailbox index.
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    snapshot.messages[index].threadMessages.forEach((message) => {
      if (message.body) message.bodyTruncated = true;
      message.body = '';
    });
    serialized = serialize(snapshot);
    if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;
  }

  // Only sacrifice image references if metadata plus all proxy URLs still do
  // not fit. In normal mailbox snapshots this fallback should not be needed.
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index].bodyImages.length) snapshot.messages[index].bodyImagesTruncated = true;
    snapshot.messages[index].bodyImages = [];
    snapshot.messages[index].threadMessages.forEach((message) => {
      if (message.bodyImages.length) message.bodyImagesTruncated = true;
      message.bodyImages = [];
    });
    serialized = serialize(snapshot);
    if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;
  }

  if (snapshot.messages[0]) {
    snapshot.messages[0].body = text(snapshot.messages[0].body, 20_000);
    snapshot.messages[0].bodyTruncated = true;
  }
  serialized = serialize(snapshot);
  while (
    serialized.length > MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS &&
    snapshot.messages.length > 1
  ) {
    snapshot.messages.pop();
    serialized = serialize(snapshot);
  }
  return serialized;
}

function serializeMailboxCampaignSnapshot(result, options = {}) {
  const messages = selectSnapshotMessages(result && result.messages)
    .map((message, index) => sanitizeMessage(message, {
      includeBody: index < MAILBOX_CAMPAIGN_SNAPSHOT_BODY_MESSAGE_COUNT,
      includeImages: index < MAILBOX_CAMPAIGN_SNAPSHOT_IMAGE_MESSAGE_COUNT,
    }));
  if (!messages.length) return '';
  const savedAtValue = options.savedAt || new Date().toISOString();
  const savedAt = Number.isFinite(Date.parse(savedAtValue))
    ? new Date(savedAtValue).toISOString()
    : new Date().toISOString();
  return fitSnapshotToBudget({
    version: MAILBOX_CAMPAIGN_SNAPSHOT_VERSION,
    savedAt,
    ok: result && result.ok !== false,
    messages,
    sync: result && result.sync && typeof result.sync === 'object'
      ? {
          ...result.sync,
          source: 'campaign-replies-snapshot',
        }
      : {
          indexed: true,
          stale: true,
          source: 'campaign-replies-snapshot',
          refreshRecommended: true,
          warming: false,
        },
  });
}

function parseMailboxCampaignSnapshot(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || ''));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Number(parsed.version) !== MAILBOX_CAMPAIGN_SNAPSHOT_VERSION ||
      !Array.isArray(parsed.messages) ||
      !parsed.messages.length
    ) {
      return null;
    }
    return {
      ok: parsed.ok !== false,
      savedAt: Number.isFinite(Date.parse(parsed.savedAt || ''))
        ? new Date(parsed.savedAt).toISOString()
        : null,
      messages: parsed.messages
        .slice(0, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES)
        .map((message, index) => sanitizeMessage(message, {
          includeBody: index < MAILBOX_CAMPAIGN_SNAPSHOT_BODY_MESSAGE_COUNT,
          includeImages: index < MAILBOX_CAMPAIGN_SNAPSHOT_IMAGE_MESSAGE_COUNT,
        })),
      sync: parsed.sync && typeof parsed.sync === 'object'
        ? { ...parsed.sync, source: 'campaign-replies-snapshot' }
        : null,
    };
  } catch (_error) {
    return null;
  }
}

function removeMailboxCampaignSnapshotMessage(rawValue, identity = {}, options = {}) {
  const snapshot = parseMailboxCampaignSnapshot(rawValue);
  if (!snapshot) return { changed: false, serialized: String(rawValue || '') };
  const accountEmail = text(identity.accountEmail, 320).toLowerCase();
  const folder = text(identity.folder || 'inbox', 50).toLowerCase() || 'inbox';
  const uid = Number(identity.uid) || 0;
  const id = text(identity.id, 500);
  const messages = snapshot.messages.filter((message) => {
    if (message.accountEmail !== accountEmail || message.folder !== folder) return true;
    if (uid > 0 && Number(message.uid) > 0) return Number(message.uid) !== uid;
    return message.mailboxId !== id && message.id !== id;
  });
  if (messages.length === snapshot.messages.length) {
    return { changed: false, serialized: String(rawValue || '') };
  }
  return {
    changed: true,
    serialized: messages.length
      ? serializeMailboxCampaignSnapshot(
          { ok: snapshot.ok, messages, sync: snapshot.sync },
          { savedAt: options.savedAt || new Date().toISOString() }
        )
      : '',
  };
}

module.exports = {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  removeMailboxCampaignSnapshotMessage,
  serializeMailboxCampaignSnapshot,
};
