const DEFAULT_LEASE_QUERY_TIMEOUT_MS = 10000;

function createBackgroundWorkerLeaseStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    queryTimeoutMs = DEFAULT_LEASE_QUERY_TIMEOUT_MS,
  } = deps;

  function normalize(value) {
    return String(value || '').trim();
  }

  function createUnavailableError(message) {
    const error = new Error(message);
    error.code = 'BACKGROUND_WORKER_LEASE_UNAVAILABLE';
    return error;
  }

  async function runRpc(label, name, args) {
    if (!isSupabaseConfigured()) {
      return { ok: false, unavailable: true, error: createUnavailableError('Supabase niet geconfigureerd') };
    }
    const timeoutMs = Math.max(1000, Math.min(30000, Number(queryTimeoutMs) || DEFAULT_LEASE_QUERY_TIMEOUT_MS));
    const client = getSupabaseClient({
      timeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!client || typeof client.rpc !== 'function') {
      return { ok: false, unavailable: true, error: createUnavailableError('Supabase RPC-client ontbreekt') };
    }
    let timeoutId = null;
    try {
      const result = await Promise.race([
        client.rpc(name, args),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error = createUnavailableError(`${label} timeout na ${timeoutMs}ms`);
            error.code = 'BACKGROUND_WORKER_LEASE_TIMEOUT';
            reject(error);
          }, timeoutMs);
        }),
      ]);
      if (result && result.error) throw result.error;
      return { ok: true, data: result ? result.data : null };
    } catch (error) {
      if (typeof logger.error === 'function') logger.error(`[BackgroundWorkerLease][${label}]`, error?.message || error);
      return { ok: false, unavailable: false, error };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function claimBackgroundWorkerLease({ lockKey, lockToken, ttlSeconds = 900 } = {}) {
    const normalizedKey = normalize(lockKey).toLowerCase();
    const normalizedToken = normalize(lockToken);
    if (!/^[a-z0-9][a-z0-9:_-]{2,119}$/.test(normalizedKey) || !normalizedToken || normalizedToken.length > 200) {
      return { ok: false, unavailable: false, error: createUnavailableError('Ongeldige background-workerlease') };
    }
    const result = await runRpc('claim', 'softora_claim_background_worker_lock', {
      p_lock_key: normalizedKey,
      p_lock_token: normalizedToken,
      p_lock_ttl_seconds: Math.max(30, Math.min(1800, Math.floor(Number(ttlSeconds) || 900))),
    });
    if (!result.ok) return result;
    const claim = Array.isArray(result.data) ? result.data[0] : result.data;
    return {
      ok: true,
      acquired: claim?.acquired === true,
      lockToken: normalize(claim?.claimed_lock_token),
      lockExpiresAt: normalize(claim?.lock_expires_at),
    };
  }

  async function releaseBackgroundWorkerLease({ lockKey, lockToken } = {}) {
    const result = await runRpc('release', 'softora_release_background_worker_lock', {
      p_lock_key: normalize(lockKey).toLowerCase(),
      p_lock_token: normalize(lockToken),
    });
    if (!result.ok) return result;
    return { ok: true, released: result.data === true };
  }

  return {
    claimBackgroundWorkerLease,
    releaseBackgroundWorkerLease,
  };
}

module.exports = {
  createBackgroundWorkerLeaseStore,
};
