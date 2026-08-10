function normalizeText(value) {
  return String(value || '').trim();
}

function getEnvelopeAddresses(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      name: normalizeText(entry?.name),
      email: normalizeText(entry?.address).toLowerCase(),
    }))
    .filter((entry) => entry.email);
}

function formatAddress(entry = {}) {
  return entry.name ? `${entry.name} <${entry.email}>` : entry.email;
}

function safeDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function buildMailboxImapQuarantineMessage({ message, account, folder, failure } = {}) {
  const uid = Math.max(0, Number(message?.uid) || Number(failure?.uid) || 0);
  const envelope = message?.envelope && typeof message.envelope === 'object'
    ? message.envelope
    : {};
  const from = getEnvelopeAddresses(envelope.from);
  const to = getEnvelopeAddresses(envelope.to);
  const cc = getEnvelopeAddresses(envelope.cc);
  const bcc = getEnvelopeAddresses(envelope.bcc);
  const errorCode = normalizeText(failure?.code || 'MAILBOX_MESSAGE_PARSE_FAILED').slice(0, 120);
  const errorReason = normalizeText(failure?.reason || 'Berichtinhoud kon niet veilig worden gelezen.').slice(0, 240);
  const internalDate = safeDate(message?.internalDate || envelope.date);
  return {
    id: `${normalizeText(folder).toLowerCase()}:${uid}`,
    uid,
    folder: normalizeText(folder).toLowerCase(),
    from: from.length ? formatAddress(from[0]) : 'Onleesbaar mailboxbericht',
    email: from[0]?.email || '',
    to: to.map(formatAddress).join(', '),
    toDisplay: to.map(formatAddress).join(', '),
    cc: cc.map(formatAddress).join(', '),
    bcc: bcc.map(formatAddress).join(', '),
    recipientRoutingEvidenceKnown: to.length > 0,
    subject: normalizeText(envelope.subject) || `(Onleesbaar bericht UID ${uid})`,
    preview: `Berichtinhoud niet beschikbaar (${errorCode}).`,
    body: '',
    date: internalDate,
    internalDate,
    messageId: normalizeText(envelope.messageId),
    inReplyTo: normalizeText(envelope.inReplyTo),
    references: '',
    unread: !Array.from(message?.flags || []).includes('\\Seen'),
    starred: Array.from(message?.flags || []).includes('\\Flagged'),
    attachments: [],
    hasBody: false,
    bodyLoaded: false,
    bodyUnavailable: true,
    parseStatus: 'quarantined',
    parseErrorCode: errorCode,
    parseErrorReason: errorReason,
    providerMetadataEvidenceKnown: Boolean(
      internalDate || from.length || to.length || normalizeText(envelope.subject) || normalizeText(envelope.messageId)
    ),
    accountEmail: normalizeText(account?.email).toLowerCase(),
  };
}

module.exports = { buildMailboxImapQuarantineMessage };
