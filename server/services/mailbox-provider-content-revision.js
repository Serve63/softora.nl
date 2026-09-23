'use strict';

const { createHash } = require('node:crypto');

// The provider sync upserts its overlap on every run. Its "stored" count is
// therefore not a change signal. Hash only presentation-relevant, stable
// fields from the bounded index already read by that sync. Older rows outside
// the window are reconciled by the periodic full snapshot rebuild.
function getMailboxProviderContentRevision({ indexed, activeAudit } = {}) {
  if (!Array.isArray(indexed) || !Array.isArray(activeAudit)) return '';
  const entries = new Map();
  for (const message of [...indexed, ...activeAudit]) {
    const key = String(message?.messageKey || '').trim();
    if (!key) return '';
    entries.set(key, [
      key,
      message.providerThreadId || '',
      message.providerCampaignId || '',
      message.providerOwner || '',
      message.folder || '',
      message.messageId || '',
      message.inReplyTo || '',
      message.references || '',
      message.email || '',
      message.to || '',
      message.subject || '',
      message.preview || '',
      message.date || '',
      Boolean(message.hasBody),
      Boolean(message.bodyTruncated),
      Boolean(message.providerBodyHtmlEvidenceKnown),
      Boolean(message.providerOriginalBodyEvidenceKnown),
      Boolean(message.providerRichBodyAvailable),
      Boolean(message.providerOriginalBodyAvailable),
      Number(message.embeddedImageCount) || 0,
    ]);
  }
  const digest = createHash('sha256');
  for (const key of [...entries.keys()].sort()) {
    digest.update(JSON.stringify(entries.get(key)));
    digest.update('\n');
  }
  return digest.digest('hex');
}

module.exports = { getMailboxProviderContentRevision };
