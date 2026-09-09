function buildRecentSyncResult({
  state,
  owner,
  accounts,
  minIntervalMs,
  nowMs,
}) {
  const failedAt = Date.parse(String(state?.updated_at || '').trim());
  if (state?.status === 'error' && state?.last_error && Number.isFinite(failedAt) && nowMs - failedAt < 60_000) {
    const nextAllowedAt = failedAt + 60_000;
    throw Object.assign(new Error('Instantly-controle herstelt na een recente fout.'), {
      code: 'INSTANTLY_SYNC_RECENT_FAILURE', status: 503, retryAfterMs: Math.max(1000, nextAllowedAt - nowMs),
      nextAllowedAt: new Date(nextAllowedAt).toISOString(),
    });
  }
  const boundedIntervalMs = Math.max(0, Math.min(5 * 60 * 1000, Number(minIntervalMs) || 0));
  const lastSyncedAt = Date.parse(String(state?.last_synced_at || '').trim());
  if (
    boundedIntervalMs <= 0 ||
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
