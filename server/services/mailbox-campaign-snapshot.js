const MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE = 'premium_mailbox_campaign_snapshot';
const MAILBOX_CAMPAIGN_SNAPSHOT_KEY = 'softora_mailbox_campaign_snapshot_v1';
const MAILBOX_CAMPAIGN_SNAPSHOT_VERSION = 1;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES = 100;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS = 850_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_BODY_CHARS = 45_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_MAX_IMAGE_CHARS = 80_000;
const MAILBOX_CAMPAIGN_SNAPSHOT_BODY_MESSAGE_COUNT = 10;
const MAILBOX_CAMPAIGN_SNAPSHOT_IMAGE_MESSAGE_COUNT = 1;

function text(value, maxLength = 1000) {
  return String(value || '').slice(0, Math.max(0, Number(maxLength) || 0));
}

function sanitizeCampaign(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    company: text(value.company, 500),
    account: text(value.account, 320).toLowerCase(),
    customerId: text(value.customerId, 320),
    status: text(value.status, 80),
    actionRequired: Boolean(value.actionRequired),
  };
}

function sanitizeOutreach(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    customerId: text(value.customerId, 320),
    company: text(value.company, 500),
    email: text(value.email, 320).toLowerCase(),
    status: text(value.status, 80),
  };
}

function sanitizeBodyImage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dataUrl = text(value.dataUrl || value.src, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_IMAGE_CHARS);
  if (!dataUrl || !/^(?:data:image\/|https?:\/\/|\/)/i.test(dataUrl)) return null;
  return {
    alt: text(value.alt || value.name || 'Afbeelding', 300),
    dataUrl,
  };
}

function sanitizeMessage(value, options = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawBody = String(source.body || '');
  const body = options.includeBody === false
    ? ''
    : text(rawBody, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_BODY_CHARS);
  return {
    id: text(source.id, 500),
    mailboxId: text(source.mailboxId || source.id, 500),
    uid: Number.isFinite(Number(source.uid)) ? Number(source.uid) : 0,
    folder: text(source.folder || 'inbox', 50).toLowerCase() || 'inbox',
    accountEmail: text(source.accountEmail, 320).toLowerCase(),
    from: text(source.from, 500),
    email: text(source.email, 320).toLowerCase(),
    to: text(source.to, 2000),
    subject: text(source.subject || '(Geen onderwerp)', 1000),
    preview: text(source.preview, 1000),
    body,
    optOutUrl: text(source.optOutUrl, 4000),
    date: text(source.date, 100),
    receivedAt: text(source.receivedAt || source.date, 100),
    messageId: text(source.messageId, 1000),
    inReplyTo: text(source.inReplyTo, 1000),
    references: text(source.references, 4000),
    unread: Boolean(source.unread),
    starred: Boolean(source.starred),
    hasBody: Boolean(source.hasBody || rawBody),
    bodyTruncated: Boolean(source.bodyTruncated || rawBody.length > body.length),
    indexed: source.indexed !== false,
    campaign: sanitizeCampaign(source.campaign),
    outreach: sanitizeOutreach(source.outreach),
    bodyImages: (options.includeImages === false ? [] : (Array.isArray(source.bodyImages) ? source.bodyImages : []))
      .map(sanitizeBodyImage)
      .filter(Boolean)
      .slice(0, 2),
  };
}

function serialize(value) {
  return JSON.stringify(value);
}

function fitSnapshotToBudget(snapshot) {
  let serialized = serialize(snapshot);
  if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;

  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    snapshot.messages[index].bodyImages = [];
    if (index > 0 && snapshot.messages[index].body) {
      snapshot.messages[index].body = '';
      snapshot.messages[index].bodyTruncated = true;
    }
    serialized = serialize(snapshot);
    if (serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS) return serialized;
  }

  if (snapshot.messages[0]) {
    snapshot.messages[0].bodyImages = [];
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
  const messages = (Array.isArray(result && result.messages) ? result.messages : [])
    .slice(0, MAILBOX_CAMPAIGN_SNAPSHOT_MAX_MESSAGES)
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

module.exports = {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
};
