const COLDMAIL_DELIVERY_FAILURE_PATTERN =
  /\b(delivery status notification|undeliverable|undelivered mail|mail delivery failed|delivery has failed|failure notice|returned mail|unzustellbar|unzustellbarkeitsmail|niet bezorgd|onbestelbaar|bezorging mislukt|final-recipient|diagnostic-code)\b/i;
const COLDMAIL_HARD_BOUNCE_PATTERN =
  /\b(user unknown|unknown user|no such user|mailbox unknown|mailbox not found|recipient unknown|unknown address|invalid recipient|invalid address|no such mailbox|unknown local part|not known to us|recipient address rejected|5\.1\.1|5\.1\.10|5\.0\.0)\b/i;
const COLDMAIL_SOFT_BOUNCE_PATTERN =
  /\b(mailbox full|quota exceeded|overquota|temporary failure|try again later|temporarily unavailable|deferred|delayed|warning: could not send message|could not send message for past|will keep trying|greylist|greylisted|4\.[0-9]\.[0-9]|resources temporarily unavailable|user has exhausted allowed storage space)\b/i;

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const BOUNCE_TYPE_PRIORITY = Object.freeze({
  soft: 1,
  unknown: 2,
  instantly: 3,
  hard: 4,
});

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBounceType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(BOUNCE_TYPE_PRIORITY, normalized)
    ? normalized
    : 'unknown';
}

function extractEmailAddresses(value) {
  const matches = normalizeString(value).match(EMAIL_PATTERN) || [];
  return Array.from(new Set(matches.map(normalizeEmailAddress).filter(Boolean)));
}

function buildMailboxBounceText(message = {}) {
  const payload = message && typeof message.payload === 'object' ? message.payload : {};
  return [
    message.subject,
    message.sender_email || message.senderEmail,
    message.sender_name || message.senderName,
    message.preview,
    message.body_text || message.bodyText || message.body,
    payload.subject,
    payload.preview,
    payload.body_text || payload.bodyText || payload.body,
  ].map(normalizeString).join('\n');
}

function isMailboxBounceMessage(message = {}) {
  const subject = normalizeString(message.subject);
  const text = buildMailboxBounceText(message);
  const fromText = normalizeString(
    `${message.sender_email || message.senderEmail || ''} ${message.sender_name || message.senderName || ''}`
  );
  const providerLike = /\b(mailer-daemon|postmaster|mail delivery|delivery subsystem)\b/i.test(fromText);
  const deliveryFailure =
    COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) ||
    COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text) ||
    COLDMAIL_HARD_BOUNCE_PATTERN.test(text) ||
    COLDMAIL_SOFT_BOUNCE_PATTERN.test(text);
  return Boolean(
    deliveryFailure &&
    (providerLike || COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) || COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text))
  );
}

function getMailboxBounceType(message = {}) {
  const text = buildMailboxBounceText(message);
  if (COLDMAIL_HARD_BOUNCE_PATTERN.test(text)) return 'hard';
  if (COLDMAIL_SOFT_BOUNCE_PATTERN.test(text)) return 'soft';
  return 'unknown';
}

function getMailboxMessageDate(message = {}) {
  const payload = message && typeof message.payload === 'object' ? message.payload : {};
  return normalizeString(
    message.date ||
      message.internal_date ||
      message.internalDate ||
      message.created_at ||
      message.updated_at ||
      payload.date ||
      payload.internal_date ||
      payload.internalDate
  );
}

function extractContextualBounceRecipients(text) {
  const recipients = [];
  const recipientPattern = /(?:final-recipient|original-recipient)\s*:\s*(?:rfc822\s*;\s*)?<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi;
  let match = recipientPattern.exec(text);
  while (match) {
    recipients.push(normalizeEmailAddress(match[1]));
    match = recipientPattern.exec(text);
  }

  const failedRecipientsPattern = /x-failed-recipients\s*:\s*([^\r\n]+)/gi;
  match = failedRecipientsPattern.exec(text);
  while (match) {
    recipients.push(...extractEmailAddresses(match[1]));
    match = failedRecipientsPattern.exec(text);
  }

  const contextualPatterns = [
    /mail delivery to the following recipient has finally failed:\s*<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi,
    /the following recipient is affected:\s*<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi,
    /the following address(?:\(es\)|es)? failed:\s*<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi,
    /the address to which the message has not yet been delivered is:\s*<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi,
    /delivery has failed to these recipients or groups:\s*<?\s*([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?/gi,
  ];
  contextualPatterns.forEach((pattern) => {
    let contextualMatch = pattern.exec(text);
    while (contextualMatch) {
      recipients.push(normalizeEmailAddress(contextualMatch[1]));
      contextualMatch = pattern.exec(text);
    }
  });
  return Array.from(new Set(recipients.filter(Boolean)));
}

function getMailboxBounceRecipients(message, options = {}) {
  const text = buildMailboxBounceText(message);
  const candidates = extractContextualBounceRecipients(text);
  const ownMailboxEmails = new Set(
    (Array.isArray(options.ownMailboxEmails) ? options.ownMailboxEmails : [])
      .map(normalizeEmailAddress)
      .filter(Boolean)
  );
  const senderEmail = normalizeEmailAddress(message && (message.sender_email || message.senderEmail));
  const sentRecipientCounts = options.sentRecipientCounts && typeof options.sentRecipientCounts === 'object'
    ? options.sentRecipientCounts
    : {};
  const requireSentRecipientMatch = options.requireSentRecipientMatch === true;

  return Array.from(new Set(candidates))
    .filter((email) => email && email !== senderEmail && !ownMailboxEmails.has(email) && !email.endsWith('@softora.nl'))
    .filter((email) => {
      if (!requireSentRecipientMatch) return true;
      return Object.prototype.hasOwnProperty.call(sentRecipientCounts, `email:${email}`);
    });
}

function shouldReplaceBounceRecord(current, candidate) {
  if (!current) return true;
  const currentPriority = BOUNCE_TYPE_PRIORITY[normalizeBounceType(current.type)];
  const candidatePriority = BOUNCE_TYPE_PRIORITY[normalizeBounceType(candidate.type)];
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
  const currentTime = Date.parse(normalizeString(current.at)) || 0;
  const candidateTime = Date.parse(normalizeString(candidate.at)) || 0;
  return candidateTime > currentTime;
}

function upsertBounceRecord(recordsByRecipient, record) {
  const email = normalizeEmailAddress(record && record.email);
  if (!email) return false;
  const candidate = {
    ...record,
    email,
    type: normalizeBounceType(record.type),
  };
  const current = recordsByRecipient.get(email);
  if (shouldReplaceBounceRecord(current, candidate)) recordsByRecipient.set(email, candidate);
  return Boolean(current);
}

function buildBounceTypeCounts(records) {
  const counts = { hard: 0, soft: 0, instantly: 0, unknown: 0 };
  (Array.isArray(records) ? records : []).forEach((record) => {
    const type = normalizeBounceType(record && record.type);
    counts[type] += 1;
  });
  return counts;
}

function sortBounceRecords(records) {
  return (Array.isArray(records) ? records : [])
    .slice()
    .sort((left, right) => (Date.parse(normalizeString(right && right.at)) || 0) - (Date.parse(normalizeString(left && left.at)) || 0));
}

function summarizeMailboxBounceStats(messages, options = {}) {
  const totalRecordsByRecipient = new Map();
  const todayRecordsByRecipient = new Map();
  const currentDayKey = normalizeString(options.currentDayKey);
  const getDayKey = typeof options.getDayKey === 'function' ? options.getDayKey : () => '';
  let bounceMessages = 0;
  let matchedMessages = 0;
  let unresolvedMessages = 0;
  let duplicateNotices = 0;

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    if (!message || typeof message !== 'object') return;
    if (normalizeString(message.deleted_at || message.deletedAt)) return;
    const folder = normalizeString(message.folder).toLowerCase();
    if (folder && folder !== 'inbox') return;
    if (!isMailboxBounceMessage(message)) return;
    bounceMessages += 1;

    const recipients = getMailboxBounceRecipients(message, options);
    if (!recipients.length) {
      unresolvedMessages += 1;
      return;
    }
    matchedMessages += 1;
    const at = getMailboxMessageDate(message);
    const type = getMailboxBounceType(message);
    const accountEmail = normalizeEmailAddress(message.account_email || message.accountEmail);
    const subject = normalizeString(message.subject).slice(0, 120);
    const atMs = Date.parse(at);
    const isToday = Boolean(Number.isFinite(atMs) && currentDayKey && getDayKey(new Date(atMs)) === currentDayKey);

    recipients.forEach((email) => {
      const record = { company: '', email, accountEmail, subject, type, at };
      if (upsertBounceRecord(totalRecordsByRecipient, record)) duplicateNotices += 1;
      if (isToday) upsertBounceRecord(todayRecordsByRecipient, record);
    });
  });

  const bounceRecords = sortBounceRecords(Array.from(totalRecordsByRecipient.values()));
  const bounceRecordsToday = sortBounceRecords(Array.from(todayRecordsByRecipient.values()));
  return {
    available: true,
    reliable: options.requireSentRecipientMatch === true,
    bounces: bounceRecords.length,
    totalBounces: bounceRecords.length,
    bounceTypes: buildBounceTypeCounts(bounceRecords),
    bounceItems: bounceRecords.slice(0, 12),
    bounceRecords,
    bouncesToday: bounceRecordsToday.length,
    bounceTypesToday: buildBounceTypeCounts(bounceRecordsToday),
    bounceItemsToday: bounceRecordsToday.slice(0, 12),
    bounceRecordsToday,
    bounceMessages,
    matchedMessages,
    unresolvedMessages,
    duplicateNotices,
  };
}

function mergeBounceRecords(...recordLists) {
  const recordsByRecipient = new Map();
  recordLists.flat().forEach((record) => upsertBounceRecord(recordsByRecipient, record));
  return sortBounceRecords(Array.from(recordsByRecipient.values()));
}

module.exports = {
  COLDMAIL_DELIVERY_FAILURE_PATTERN,
  COLDMAIL_HARD_BOUNCE_PATTERN,
  COLDMAIL_SOFT_BOUNCE_PATTERN,
  buildBounceTypeCounts,
  mergeBounceRecords,
  summarizeMailboxBounceStats,
};
