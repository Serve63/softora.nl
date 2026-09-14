const PENDING_INSTANTLY_QUEUE_STATUSES = new Set(['registered']);

function normalizeInstantlyQueueStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getInstantlyQueueStatus(row = {}) {
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  return normalizeInstantlyQueueStatus(row.instantlyQueueStatus || payload.instantlyQueueStatus);
}

function hasPendingInstantlyQueue(row = {}) {
  return PENDING_INSTANTLY_QUEUE_STATUSES.has(getInstantlyQueueStatus(row));
}

module.exports = {
  PENDING_INSTANTLY_QUEUE_STATUSES,
  getInstantlyQueueStatus,
  hasPendingInstantlyQueue,
  normalizeInstantlyQueueStatus,
};
