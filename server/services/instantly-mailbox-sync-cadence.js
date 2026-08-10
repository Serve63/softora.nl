function buildRecentSyncResult({
  state,
  owner,
  accounts,
  minIntervalMs,
  nowMs,
}) {
  const boundedIntervalMs = Math.max(0, Math.min(5 * 60 * 1000, Number(minIntervalMs) || 0));
  const lastSyncedAt = Date.parse(String(state?.last_synced_at || '').trim());
  if (
    boundedIntervalMs <= 0 ||
    String(state?.last_error || '').trim() ||
    !Number.isFinite(lastSyncedAt) ||
    Number(nowMs) - lastSyncedAt >= boundedIntervalMs
  ) return null;
  return {
    ok: true,
    owner,
    accounts: (Array.isArray(accounts) ? accounts : []).map((account) => account.email),
    seen: 0,
    stored: 0,
    pages: 0,
    skipped: true,
    reason: 'recent-sync',
    syncedAt: new Date(lastSyncedAt).toISOString(),
    nextAllowedAt: new Date(lastSyncedAt + boundedIntervalMs).toISOString(),
  };
}

module.exports = { buildRecentSyncResult };
