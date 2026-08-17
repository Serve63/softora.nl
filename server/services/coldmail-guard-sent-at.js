const COLDMAIL_SENT_TIMESTAMP_MODEL = 'delivery-evidence-v1';

function normalizeTimestamp(value) {
  const normalized = String(value || '').trim();
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
}

function getLatestPayloadEventTimestamp(payload) {
  const events = Array.isArray(payload && payload.events) ? payload.events : [];
  let latest = '';
  let latestMs = 0;
  events.forEach((event) => {
    const candidate = normalizeTimestamp(
      event && (event.sentAt || event.sent_at || event.at || event.date)
    );
    const candidateMs = candidate ? Date.parse(candidate) : 0;
    if (candidateMs > latestMs) {
      latest = candidate;
      latestMs = candidateMs;
    }
  });
  return latest;
}

function resolveColdmailGuardSentAt(group = {}) {
  const payload = group.payload && typeof group.payload === 'object' && !Array.isArray(group.payload)
    ? group.payload
    : {};
  const candidates = [
    payload.sentAt,
    payload.sent_at,
    payload.smtpAcceptedAt,
    payload.acceptedAt,
    group.last_seen_at,
    group.lastSeenAt,
    getLatestPayloadEventTimestamp(payload),
    group.created_at,
    group.createdAt,
    group.updated_at,
    group.updatedAt,
  ];
  for (const candidate of candidates) {
    const timestamp = normalizeTimestamp(candidate);
    if (timestamp) return timestamp;
  }
  return '';
}

module.exports = {
  COLDMAIL_SENT_TIMESTAMP_MODEL,
  getLatestPayloadEventTimestamp,
  resolveColdmailGuardSentAt,
};
