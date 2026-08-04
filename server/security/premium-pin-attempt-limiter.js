function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function createPremiumPinAttemptLimiter(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const windowMs = Math.max(60_000, Math.min(60 * 60_000, Number(options.windowMs) || 10 * 60_000));
  const maxFailures = Math.max(1, Math.min(20, Number(options.maxFailures) || 5));
  const maxTrackedKeys = Math.max(100, Math.min(20_000, Number(options.maxTrackedKeys) || 5_000));
  const failuresByKey = new Map();

  function getRequestKey(req) {
    const identity = normalizeString(
      req?.premiumAuth?.userId || req?.premiumAuth?.email || 'authenticated-admin'
    );
    const ip = normalizeString(req?.ip || req?.headers?.['x-forwarded-for'] || 'unknown-ip')
      .split(',')[0]
      .trim();
    const scope = normalizeString(req?.body?.actionConfirmScope || 'premium-admin-mutation')
      .replace(/[^a-z0-9:_-]+/g, '-')
      .slice(0, 80) || 'premium-admin-mutation';
    return `${identity}|${ip}|${scope}`;
  }

  function pruneExpired(currentMs) {
    for (const [key, record] of failuresByKey.entries()) {
      if (!record || currentMs - record.startedAtMs >= windowMs) failuresByKey.delete(key);
    }
    while (failuresByKey.size > maxTrackedKeys) {
      failuresByKey.delete(failuresByKey.keys().next().value);
    }
  }

  function getActiveRecord(req) {
    const currentMs = now();
    pruneExpired(currentMs);
    const key = getRequestKey(req);
    const record = failuresByKey.get(key);
    if (!record || currentMs - record.startedAtMs >= windowMs) {
      failuresByKey.delete(key);
      return { key, currentMs, record: null };
    }
    return { key, currentMs, record };
  }

  function check(req) {
    const { currentMs, record } = getActiveRecord(req);
    if (!record || record.failures < maxFailures) return { ok: true };
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((record.startedAtMs + windowMs - currentMs) / 1000)),
    };
  }

  function recordFailure(req) {
    const { key, currentMs, record } = getActiveRecord(req);
    const nextRecord = record || { failures: 0, startedAtMs: currentMs };
    nextRecord.failures += 1;
    failuresByKey.set(key, nextRecord);
    return check(req);
  }

  function reset(req) {
    failuresByKey.delete(getRequestKey(req));
  }

  return {
    check,
    recordFailure,
    reset,
  };
}

module.exports = {
  createPremiumPinAttemptLimiter,
};
