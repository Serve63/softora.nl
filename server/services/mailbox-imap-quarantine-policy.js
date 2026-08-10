const MAILBOX_IMAP_QUARANTINE_STATUS = 'quarantined';
const MAILBOX_IMAP_QUARANTINE_RETRY_DELAY_MS = 15 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function buildMailboxImapQuarantineRetryAt(nowMs = Date.now()) {
  const parsedNowMs = Number(nowMs);
  const safeNowMs = Number.isFinite(parsedNowMs) ? parsedNowMs : Date.now();
  return new Date(safeNowMs + MAILBOX_IMAP_QUARANTINE_RETRY_DELAY_MS).toISOString();
}

function classifyMailboxImapQuarantineRow(row = {}, nowMs = Date.now()) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const parseStatus = normalizeText(row?.parse_status || payload.parseStatus).toLowerCase();
  if (parseStatus !== MAILBOX_IMAP_QUARANTINE_STATUS) {
    return 'indexed';
  }
  const retryAtMs = Date.parse(normalizeText(row?.parse_retry_at || payload.parseRetryAt));
  return Number.isFinite(retryAtMs) && retryAtMs > Number(nowMs)
    ? 'retry_deferred'
    : 'retry_due';
}

module.exports = {
  MAILBOX_IMAP_QUARANTINE_RETRY_DELAY_MS,
  MAILBOX_IMAP_QUARANTINE_STATUS,
  buildMailboxImapQuarantineRetryAt,
  classifyMailboxImapQuarantineRow,
};
