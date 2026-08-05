function buildAcceptedSentMessage(message, values = {}) {
  if (!message || typeof message !== 'object') return null;
  const body = String(values.body || '');
  const to = String(values.to || '');
  return {
    ...message,
    body,
    preview: body,
    subject: String(values.subject || ''),
    to,
    toDisplay: to,
    cc: String(values.cc || ''),
    bcc: String(values.bcc || ''),
    recipientRoutingEvidenceKnown: true,
    hasBody: true,
    bodyTruncated: false,
    unread: false,
  };
}

function normalizeProviderAttachmentList(value) {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch (_) {
      source = [];
    }
  }
  const files = Array.isArray(source) ? source : Array.isArray(source?.files) ? source.files : [];
  return files.slice(0, 20).map((attachment) => ({
    filename: String(attachment?.filename || attachment?.name || 'Bijlage').trim().slice(0, 180),
    contentType: String(attachment?.content_type || attachment?.type || '').trim().slice(0, 120),
    size: Math.max(0, Number(attachment?.size) || 0),
  }));
}

module.exports = { buildAcceptedSentMessage, normalizeProviderAttachmentList };
