const crypto = require('node:crypto');

const QUARANTINE_RETRY_BASE_MS = 15 * 60 * 1000;
const QUARANTINE_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function buildRejectedItem(rawMessage, at) {
  const providerMessageId = normalizeText(rawMessage?.id || rawMessage?.email_id || rawMessage?.uuid);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(rawMessage)))
    .digest('hex');
  return {
    identity: providerMessageId ? `id:${providerMessageId}` : `sha256:${hash}`,
    providerMessageId,
    reason: 'normalization-rejected',
    firstSeenAt: at,
    lastSeenAt: at,
    nextRetryAt: new Date(Date.parse(at) + QUARANTINE_RETRY_BASE_MS).toISOString(),
    attempts: 1,
  };
}

function mergeQuarantine(existing = [], rejected = [], at) {
  const byIdentity = new Map(
    (Array.isArray(existing) ? existing : []).map((item) => [item.identity, { ...item }])
  );
  for (const item of rejected) {
    const current = byIdentity.get(item.identity);
    const attempts = Math.max(1, Number(current?.attempts) || 0) + (current ? 1 : 0);
    const retryDelay = Math.min(
      QUARANTINE_RETRY_MAX_MS,
      QUARANTINE_RETRY_BASE_MS * (2 ** Math.min(6, attempts - 1))
    );
    byIdentity.set(item.identity, {
      ...item,
      firstSeenAt: current?.firstSeenAt || item.firstSeenAt || at,
      lastSeenAt: at,
      nextRetryAt: new Date(Date.parse(at) + retryDelay).toISOString(),
      attempts,
    });
  }
  return Array.from(byIdentity.values());
}

module.exports = {
  QUARANTINE_RETRY_BASE_MS,
  QUARANTINE_RETRY_MAX_MS,
  buildRejectedItem,
  mergeQuarantine,
};
