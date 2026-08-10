'use strict';

function createMailboxProviderMessageRowBuilder({
  normalizeString,
  normalizeEmail,
  truncateText,
  stableProviderUid,
  trimBodyForStorage,
  parseDateIso,
  buildProviderMessageKey,
  normalizeAttachments,
  isoNow,
} = {}) {
  return function buildProviderMessageRow(message = {}) {
    const provider = normalizeString(message.provider).toLowerCase();
    const providerId = normalizeString(message.providerMessageId || message.id);
    const accountEmail = normalizeEmail(message.accountEmail || message.providerAccountEmail);
    const owner = normalizeString(message.providerOwner).toLowerCase();
    if (!provider || !providerId || !accountEmail || !owner) return null;
    const uid = stableProviderUid(provider, providerId);
    const body = trimBodyForStorage(message, 0);
    const dateIso = parseDateIso(message.date || message.receivedAt);
    return {
      message_key: buildProviderMessageKey(provider, providerId),
      account_email: accountEmail,
      folder: provider,
      uid,
      provider_id: `${provider}:${providerId}`,
      message_id: normalizeString(message.messageId),
      in_reply_to: normalizeString(message.inReplyTo),
      references_text: normalizeString(message.references),
      sender_name: truncateText(normalizeString(message.from), 240),
      sender_email: truncateText(normalizeEmail(message.email), 320),
      recipients_text: truncateText(normalizeString(message.to), 1000),
      subject: truncateText(normalizeString(message.subject) || '(Geen onderwerp)', 500),
      preview: truncateText(normalizeString(message.preview), 500),
      body_text: body.text,
      body_truncated: body.truncated,
      has_body: body.hasBody,
      date: dateIso,
      internal_date: dateIso,
      unread: Boolean(message.unread),
      starred: Boolean(message.starred),
      payload: {
        source: provider,
        provider,
        providerMessageId: providerId,
        providerThreadId: truncateText(normalizeString(message.providerThreadId), 500),
        providerCampaignId: truncateText(normalizeString(message.providerCampaignId), 500),
        providerAccountEmail: accountEmail,
        providerOwner: owner,
        direction: normalizeString(message.folder || message.direction).toLowerCase() === 'sent'
          ? 'sent'
          : 'received',
        recipientRoutingEvidenceKnown: message.recipientRoutingEvidenceKnown === true,
        toDisplay: truncateText(normalizeString(message.toDisplay || message.to), 2000),
        cc: truncateText(normalizeString(message.cc), 2000),
        bcc: truncateText(normalizeString(message.bcc), 2000),
        deliveredTo: truncateText(normalizeString(message.deliveredTo), 1000),
        attachments: normalizeAttachments(message.attachments),
        autoSubmitted: truncateText(normalizeString(message.autoSubmitted), 200),
        precedence: truncateText(normalizeString(message.precedence), 120),
        autoResponseSuppress: truncateText(normalizeString(message.autoResponseSuppress), 200),
        automatedReplyEvidenceKnown: message.automatedReplyEvidenceKnown === true,
        automatedReplyEvidence: message.automatedReplyEvidence === true,
        automatedReplyEvidenceSource: truncateText(
          normalizeString(message.automatedReplyEvidenceSource),
          240
        ),
        attachmentSource: provider,
        originalCampaignOutbound: message.originalCampaignOutbound === true,
        providerBodyHtmlEvidenceKnown: message.providerBodyHtmlEvidenceKnown === true,
        providerRichBodyAvailable: message.providerRichBodyAvailable === true,
        providerOriginalBodyEvidenceKnown: message.providerOriginalBodyEvidenceKnown === true,
        providerOriginalBodyAvailable: message.providerOriginalBodyAvailable === true,
        webdesignLinkEvidenceKnown: message.webdesignLinkEvidenceKnown === true,
        webdesignLinkUrl: truncateText(normalizeString(message.webdesignLinkUrl), 4000),
      },
      updated_at: isoNow(),
    };
  };
}

module.exports = {
  createMailboxProviderMessageRowBuilder,
};
