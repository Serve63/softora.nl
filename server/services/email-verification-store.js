const DEFAULT_TABLE = 'softora_email_verifications';
const DEFAULT_VALIDITY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PENDING_STALE_MS = 30 * 60 * 1000;

function normalizeEmailAddress(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[<>()"[\]]/g, '')
    .replace(/[.,;:!?]+$/g, '');
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)
    ? email
    : '';
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  return normalized ? normalized.split('@')[1] : '';
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getVerificationDecision(row, options = {}) {
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : Number.isFinite(Number(options.nowMs))
      ? Number(options.nowMs)
      : Date.now();
  const validityMs = Math.max(60 * 1000, Number(options.validityMs) || DEFAULT_VALIDITY_MS);
  const pendingStaleMs = Math.max(60 * 1000, Number(options.pendingStaleMs) || DEFAULT_PENDING_STALE_MS);
  if (!row || typeof row !== 'object') {
    return { allowed: false, status: 'pending', reason: 'verification_missing', shouldQueue: true };
  }
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'invalid') {
    return { allowed: false, status, reason: String(row.reason || 'mailbox_invalid'), shouldQueue: false };
  }
  if (status === 'valid') {
    const validUntilMs = parseDateMs(row.valid_until);
    const checkedAtMs = parseDateMs(row.checked_at);
    const freshUntilMs = validUntilMs || (checkedAtMs ? checkedAtMs + validityMs : 0);
    if (freshUntilMs > nowMs) {
      return { allowed: true, status, reason: 'mailbox_verified', shouldQueue: false, validUntil: new Date(freshUntilMs).toISOString() };
    }
    return { allowed: false, status: 'pending', reason: 'verification_expired', shouldQueue: true };
  }
  if (status === 'unknown') {
    const retryAfterMs = parseDateMs(row.retry_after);
    return {
      allowed: false,
      status,
      reason: String(row.reason || 'verification_unknown'),
      shouldQueue: !retryAfterMs || retryAfterMs <= nowMs,
    };
  }
  if (status === 'processing') {
    const updatedAtMs = parseDateMs(row.updated_at);
    const stale = !updatedAtMs || updatedAtMs + pendingStaleMs <= nowMs;
    return {
      allowed: false,
      status: stale ? 'pending' : 'processing',
      reason: stale ? 'verification_processing_stale' : 'verification_processing',
      shouldQueue: stale,
    };
  }
  return {
    allowed: false,
    status: 'pending',
    reason: 'verification_pending',
    shouldQueue: false,
  };
}

function createEmailVerificationStore(deps = {}) {
  const {
    table = DEFAULT_TABLE,
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    now = () => new Date(),
    validityMs = DEFAULT_VALIDITY_MS,
    pendingStaleMs = DEFAULT_PENDING_STALE_MS,
    logger = console,
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient();
  }

  async function queueVerification(client, email, metadata = {}, currentRow = null) {
    const at = now().toISOString();
    const payload = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
    if (!currentRow) {
      const { error } = await client.from(table).upsert(
        {
          email,
          domain: getEmailDomain(email),
          status: 'pending',
          reason: 'verification_requested',
          requested_at: at,
          source: 'softora-self-hosted-smtp-v1',
          payload,
          updated_at: at,
        },
        { onConflict: 'email', ignoreDuplicates: true }
      );
      if (error) throw error;
      return true;
    }
    const { data, error } = await client
      .from(table)
      .update({
        status: 'pending',
        reason: 'verification_recheck_requested',
        requested_at: at,
        payload: { ...(currentRow.payload || {}), ...payload },
        updated_at: at,
      })
      .eq('email', email)
      .eq('updated_at', currentRow.updated_at)
      .select('email')
      .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async function getDecision(emailValue, metadata = {}) {
    const email = normalizeEmailAddress(emailValue);
    if (!email) {
      return { ok: true, allowed: false, status: 'invalid', reason: 'invalid_email_syntax', queued: false };
    }
    const client = getClient();
    if (!client) {
      return {
        ok: false,
        allowed: false,
        status: 'unavailable',
        reason: 'verification_store_unavailable',
        queued: false,
      };
    }
    try {
      const { data, error } = await client
        .from(table)
        .select('email,domain,status,reason,checked_at,valid_until,retry_after,updated_at,payload')
        .eq('email', email)
        .maybeSingle();
      if (error) throw error;
      const decision = getVerificationDecision(data, {
        now: now(),
        validityMs,
        pendingStaleMs,
      });
      let queued = false;
      if (decision.shouldQueue) {
        queued = await queueVerification(client, email, metadata, data || null);
      }
      return {
        ok: true,
        email,
        ...decision,
        queued,
      };
    } catch (error) {
      logger.error('[EmailVerification][DecisionError]', error?.message || error);
      return {
        ok: false,
        email,
        allowed: false,
        status: 'unavailable',
        reason: 'verification_store_error',
        queued: false,
      };
    }
  }

  return {
    getDecision,
  };
}

module.exports = {
  DEFAULT_PENDING_STALE_MS,
  DEFAULT_VALIDITY_MS,
  createEmailVerificationStore,
  getVerificationDecision,
  normalizeEmailAddress,
};
