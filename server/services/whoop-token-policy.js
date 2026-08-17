const TOKEN_REQUEST_TIMEOUT_MS = 35000;
const TOKEN_REFRESH_LOCK_MS = 75000;
const TOKEN_REFRESH_AHEAD_MS = 18 * 60 * 1000;
const DATA_SYNC_MIN_TOKEN_VALIDITY_MS = 2 * 60 * 1000;
const TOKEN_WORKER_RETRY_DELAY_MS = 5 * 60 * 1000;
const AUTH_REQUIRED_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

const AUTH_BLOCKED_REASONS = new Set([
  'whoop_not_connected',
  'whoop_reauthorization_required',
  'whoop_refresh_outcome_unknown',
]);

function isAuthBlockedReason(reason) {
  return AUTH_BLOCKED_REASONS.has(String(reason || ''));
}

function hasActiveLease(lockId, lockUntil, nowMs) {
  const until = new Date(lockUntil || 0).getTime();
  return Boolean(lockId && Number.isFinite(until) && until > nowMs);
}

function isOperationFenceConflict(error, code) {
  return String(error?.message || error || '').includes(code);
}

module.exports = {
  AUTH_REQUIRED_RETRY_DELAY_MS,
  DATA_SYNC_MIN_TOKEN_VALIDITY_MS,
  TOKEN_REFRESH_AHEAD_MS,
  TOKEN_REFRESH_LOCK_MS,
  TOKEN_REQUEST_TIMEOUT_MS,
  TOKEN_WORKER_RETRY_DELAY_MS,
  hasActiveLease,
  isAuthBlockedReason,
  isOperationFenceConflict,
};
