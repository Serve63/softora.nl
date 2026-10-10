const COLDMAIL_SENT_TIMESTAMP_MODEL = 'delivery-evidence-v2';

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

// Een uitsluiting (bijv. sector-suppressie) raakt last_seen_at/updated_at aan, maar is geen verzending.
function getSuppressionTimestampsMs(group, payload) {
  const sectorSuppression = payload.sectorSuppression && typeof payload.sectorSuppression === 'object'
    ? payload.sectorSuppression
    : {};
  return [group.suppressed_at, group.suppressedAt, sectorSuppression.at]
    .map((value) => normalizeTimestamp(value))
    .filter(Boolean)
    .map((value) => Date.parse(value));
}

function resolveColdmailGuardSentAt(group = {}) {
  const payload = group.payload && typeof group.payload === 'object' && !Array.isArray(group.payload)
    ? group.payload
    : {};
  const suppressionMs = getSuppressionTimestampsMs(group, payload);
  const mutationTimestamp = (value) => {
    const timestamp = normalizeTimestamp(value);
    return timestamp && suppressionMs.includes(Date.parse(timestamp)) ? '' : timestamp;
  };
  const candidates = [
    payload.sentAt,
    payload.sent_at,
    payload.smtpAcceptedAt,
    payload.acceptedAt,
    mutationTimestamp(group.last_seen_at),
    mutationTimestamp(group.lastSeenAt),
    getLatestPayloadEventTimestamp(payload),
    group.created_at,
    group.createdAt,
    mutationTimestamp(group.updated_at),
    mutationTimestamp(group.updatedAt),
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
