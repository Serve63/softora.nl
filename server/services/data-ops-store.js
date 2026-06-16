const { createHash } = require('crypto');

const {
  buildCustomerIdentityKey,
  extensionForMimeType,
  normalizeString,
  parseImageDataUrl,
  resolveRecordId,
  sanitizeStorageSegment,
} = require('./data-ops-serialization');
const {
  chooseStrongerContactStatus,
  getContactStatusPriority,
  normalizeContactStatus,
} = require('./customer-lifecycle');
const { getIdentityKeyRows } = require('./outbound-recipient-guard-store');

const TABLES = Object.freeze({
  customers: 'softora_customers',
  activeOrders: 'softora_active_orders',
  orderRuntime: 'softora_order_runtime',
  designPhotos: 'softora_design_photos',
  webdesignJobs: 'softora_webdesign_jobs',
  mailboxMessages: 'softora_mailbox_messages',
  mailboxSyncState: 'softora_mailbox_sync_state',
  outboundRecipientGuards: 'softora_outbound_recipient_guards',
});
const OUTBOUND_RECIPIENT_GUARD_PREVIEW_COLUMNS =
  'guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,recipient_domain,recipient_company_key,recipient_id,recipient_company,status,source,actor,permanent,payload,created_at,updated_at';
const DESIGN_PHOTO_CACHE_CONTROL_SECONDS = '31536000';
const SIGNED_URL_CACHE_LIMIT = 1500;
const SIGNED_URL_CACHE_MIN_FRESH_MS = 60 * 1000;
const DESIGN_PHOTO_SIGNED_URL_PAGE_SIZE = 500;
const DESIGN_PHOTO_SIGNED_URL_DEFAULT_SCAN_LIMIT = 1500;
const DESIGN_PHOTO_SIGNED_URL_TARGETED_SCAN_LIMIT = 25000;
const OUTBOUND_GUARD_KEY_LOOKUP_CHUNK_SIZE = 100;
const DEFAULT_READ_QUERY_TIMEOUT_MS = 6000;
const DEFAULT_WRITE_QUERY_TIMEOUT_MS = 10000;
const DEFAULT_READ_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_READ_FAILURE_COOLDOWN_MS = 60 * 1000;
const SENT_CUSTOMER_GUARD_SOURCE = 'data-ops-customers-sent-guard';

function slugifyDesignPhotoMatchText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compactDesignPhotoSlug(value) {
  return slugifyDesignPhotoMatchText(value).replace(/-/g, '');
}

function stripKnownDomainSuffix(value) {
  let slug = slugifyDesignPhotoMatchText(value);
  let previous = '';
  while (slug && slug !== previous) {
    previous = slug;
    slug = slug
      .replace(/-(?:nl|eu|com|be|de|net|org|info|io|co)$/i, '')
      .replace(/-(?:b-v|n-v|v-o-f|c-v|bv|nv|vof|cv|ltd|llc|inc)$/i, '');
  }
  return slug;
}

function stripImageNameSuffix(value) {
  return normalizeString(value)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_\s]*(?:website|webdesign|preview|device|mockup|screenshot|foto|image|afbeelding)(?:[-_\s]*(?:v[0-9]+|[0-9]+))?$/i, '')
    .replace(/[-_\s]+$/g, '');
}

function domainNameCandidate(value) {
  const raw = normalizeString(value)
    .replace(/^<|>$/g, '')
    .replace(/[),.;!?]+$/g, '');
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return normalizeString(new URL(candidate).hostname)
      .replace(/^www\./i, '')
      .split('.')[0];
  } catch (_error) {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[/?#]/)[0]
      .split('.')[0];
  }
}

function domainSlugCandidate(value) {
  const raw = normalizeString(value)
    .replace(/^<|>$/g, '')
    .replace(/[),.;!?]+$/g, '');
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return slugifyDesignPhotoMatchText(new URL(candidate).hostname.replace(/^www\./i, ''));
  } catch (_error) {
    return slugifyDesignPhotoMatchText(
      raw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split(/[/?#]/)[0]
    );
  }
}

function designPhotoSlugMatchesIdentifier(candidate, identifier) {
  const candidateSlug = slugifyDesignPhotoMatchText(candidate);
  const identifierSlug = slugifyDesignPhotoMatchText(identifier);
  if (!candidateSlug || !identifierSlug) return false;
  if (candidateSlug === identifierSlug) return true;
  const candidateCompact = compactDesignPhotoSlug(candidateSlug);
  const identifierCompact = compactDesignPhotoSlug(identifierSlug);
  if (candidateCompact && candidateCompact === identifierCompact) return true;
  const candidateRootCompact = compactDesignPhotoSlug(stripKnownDomainSuffix(candidateSlug));
  const identifierRootCompact = compactDesignPhotoSlug(stripKnownDomainSuffix(identifierSlug));
  if (
    identifierCompact.length >= 4 &&
    candidateCompact.length >= 4 &&
    (candidateCompact.startsWith(identifierCompact) || candidateRootCompact.startsWith(identifierCompact))
  ) {
    return true;
  }
  if (
    identifierRootCompact.length >= 5 &&
    candidateCompact.length >= identifierRootCompact.length &&
    /^manual-import-/.test(candidateSlug) &&
    candidateCompact.includes(identifierRootCompact)
  ) {
    return true;
  }
  return Boolean(
    candidateRootCompact &&
      identifierRootCompact &&
      (candidateRootCompact === identifierCompact ||
        candidateCompact === identifierRootCompact ||
        candidateRootCompact === identifierRootCompact)
  );
}

function collectDesignPhotoRowMatchCandidates(row) {
  if (!row || typeof row !== 'object') return [];
  const legacyMeta = row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {};
  const mockupMeta = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : {};
  const identityCompany = normalizeString(row.identity_key).split('|')[0];
  const fileName = stripImageNameSuffix(row.file_name);
  const legacyPhotoName = stripImageNameSuffix(legacyMeta.websitePhotoName || legacyMeta.fileName);
  const mockupName = stripImageNameSuffix(mockupMeta.fileName || legacyMeta.websiteMockupName);
  return Array.from(new Set([
    normalizeString(row.customer_id),
    normalizeString(row.identity_key),
    identityCompany,
    fileName,
    legacyPhotoName,
    mockupName,
    domainNameCandidate(fileName),
    domainNameCandidate(legacyPhotoName),
    domainNameCandidate(mockupName),
  ].filter(Boolean)));
}

function designPhotoRowMatchesIdentifiers(row, identifiers = []) {
  const directIdentifiers = new Set(
    (Array.isArray(identifiers) ? identifiers : [])
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
  );
  if (!directIdentifiers.size) return true;

  const rowCustomerId = normalizeString(row && row.customer_id).toLowerCase();
  const rowIdentityKey = normalizeString(row && row.identity_key).toLowerCase();
  if ((rowCustomerId && directIdentifiers.has(rowCustomerId)) || (rowIdentityKey && directIdentifiers.has(rowIdentityKey))) {
    return true;
  }

  const candidates = collectDesignPhotoRowMatchCandidates(row);
  return Array.from(directIdentifiers).some((identifier) =>
    candidates.some((candidate) => designPhotoSlugMatchesIdentifier(candidate, identifier))
  );
}

function collectTargetedDesignPhotoSearchTerms(identifiers = []) {
  const terms = [];
  const addTerm = (value) => {
    const term = slugifyDesignPhotoMatchText(value);
    if (term.length >= 4 && term.length <= 90) terms.push(term);
  };
  const addLooseTerm = (value) => {
    const term = normalizeString(value).toLowerCase().replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length >= 4 && term.length <= 90) terms.push(term);
  };
  (Array.isArray(identifiers) ? identifiers : []).forEach((identifier) => {
    const slug = slugifyDesignPhotoMatchText(identifier);
    const root = stripKnownDomainSuffix(slug);
    addTerm(slug);
    addTerm(root);
    addLooseTerm(slug);
    addLooseTerm(root);
    addTerm(compactDesignPhotoSlug(slug));
    addTerm(compactDesignPhotoSlug(root));
  });
  return Array.from(new Set(terms)).slice(0, 12);
}

function collectOutboundRecipientGuardSearchTerms(identifiers = []) {
  const terms = [];
  const addTerm = (value) => {
    const term = normalizeString(value).toLowerCase();
    if (/^[a-z0-9@._-]{2,180}$/.test(term)) terms.push(term);
  };
  const addSlugTerm = (value) => {
    const slug = slugifyDesignPhotoMatchText(value);
    if (slug.length >= 2 && slug.length <= 180) terms.push(slug);
  };
  (Array.isArray(identifiers) ? identifiers : []).forEach((identifier) => {
    const raw = normalizeString(identifier);
    const slug = slugifyDesignPhotoMatchText(raw);
    const root = stripKnownDomainSuffix(slug);
    addTerm(raw);
    addSlugTerm(slug);
    addSlugTerm(root);
    addSlugTerm(compactDesignPhotoSlug(slug));
    addSlugTerm(compactDesignPhotoSlug(root));
    addSlugTerm(domainNameCandidate(raw));
    addSlugTerm(domainSlugCandidate(raw));
  });
  return Array.from(new Set(terms)).slice(0, 16);
}

function collectOutboundRecipientGuardExactRecipientIds(identifiers = []) {
  return Array.from(new Set(
    (Array.isArray(identifiers) ? identifiers : [])
      .map((value) => normalizeString(value).toLowerCase())
      .filter((term) => /^[a-z0-9._-]{2,180}$/.test(term) && !term.includes('@'))
  )).slice(0, 16);
}

function createSoftoraDataOpsStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    bucketName = 'softora-design-photos',
    dataOpsReadQueryTimeoutMs = DEFAULT_READ_QUERY_TIMEOUT_MS,
    dataOpsWriteQueryTimeoutMs = DEFAULT_WRITE_QUERY_TIMEOUT_MS,
    dataOpsReadCacheTtlMs = DEFAULT_READ_CACHE_TTL_MS,
    dataOpsReadFailureCooldownMs = DEFAULT_READ_FAILURE_COOLDOWN_MS,
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;
  const signedUrlCache = new Map();
  const readCache = new Map();
  let readFailureCooldownUntilMs = 0;
  let readFailureCooldownReason = '';

  function getClient(options = {}) {
    if (!isSupabaseConfigured()) return null;
    const clientOptions = {};
    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      clientOptions.timeoutMs = options.timeoutMs;
    }
    if (options.bypassReadFailureCooldown || options.ignoreSupabaseRestFailureCooldown) {
      clientOptions.ignoreFailureCooldown = true;
    }
    if (options.suppressReadFailureCooldown || options.suppressSupabaseRestFailureCooldown) {
      clientOptions.suppressFailureCooldown = true;
    }
    return Object.keys(clientOptions).length
      ? getSupabaseClient(clientOptions)
      : getSupabaseClient();
  }

  function getSafeWriteQueryTimeoutMs() {
    return Math.max(
      1000,
      Math.min(30000, Number(dataOpsWriteQueryTimeoutMs) || DEFAULT_WRITE_QUERY_TIMEOUT_MS)
    );
  }

  function getWriteOperationOptions(overrides = {}) {
    return {
      operationType: 'write',
      timeoutMs: getSafeWriteQueryTimeoutMs(),
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      ignoreSupabaseRestFailureCooldown: true,
      suppressSupabaseRestFailureCooldown: true,
      ...(overrides && typeof overrides === 'object' ? overrides : {}),
    };
  }

  function isRunReadOperation(options = {}) {
    if (options.operationType === 'write') return false;
    if (options.operationType === 'read') return true;
    return Number(options.timeoutMs) > 0;
  }

  function isUnavailableError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code));
    return (
      /relation .* does not exist/i.test(text) ||
      /could not find .* schema cache/i.test(text) ||
      /bucket not found/i.test(text) ||
      /not found/i.test(text) ||
      error?.code === '42P01' ||
      error?.statusCode === 404 ||
      error?.status === 404
    );
  }

  function createTimeoutError(label, timeoutMs) {
    const error = new Error(`${label} timeout na ${timeoutMs}ms`);
    error.code = 'DATA_OPS_TIMEOUT';
    return error;
  }

  function getSafeReadFailureCooldownMs() {
    return Math.max(0, Math.min(5 * 60_000, Number(dataOpsReadFailureCooldownMs) || 0));
  }

  function isReadFailureCooldownActive() {
    return currentTimeMs() < readFailureCooldownUntilMs;
  }

  function createReadCooldownError() {
    const secondsLeft = Math.max(1, Math.ceil((readFailureCooldownUntilMs - currentTimeMs()) / 1000));
    const error = new Error(
      `DataOps reads tijdelijk overgeslagen na Supabase timeout/504 (${secondsLeft}s cooldown${readFailureCooldownReason ? `, ${readFailureCooldownReason}` : ''})`
    );
    error.code = 'DATA_OPS_READ_COOLDOWN';
    return error;
  }

  function getReadFailureCooldownStatus() {
    return {
      active: isReadFailureCooldownActive(),
      reason: readFailureCooldownReason,
      untilMs: readFailureCooldownUntilMs,
    };
  }

  function isTransientReadError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code || error));
    return (
      error?.code === 'DATA_OPS_TIMEOUT' ||
      /abort|timeout|timed out|504|fetch failed|network|econnreset|etimedout|connection terminated/i.test(text)
    );
  }

  function openReadFailureCooldown(error) {
    const cooldownMs = getSafeReadFailureCooldownMs();
    if (!cooldownMs) return;
    readFailureCooldownUntilMs = currentTimeMs() + cooldownMs;
    readFailureCooldownReason = truncateText(normalizeString(error?.message || error?.code || error), 160);
    const log =
      typeof logger.warn === 'function'
        ? logger.warn.bind(logger)
        : typeof logger.log === 'function'
          ? logger.log.bind(logger)
          : null;
    if (log) log('[DataOps][read-circuit-open]', readFailureCooldownReason);
  }

  async function withTimeout(promise, timeoutMs, label) {
    const durationMs = Math.max(0, Number(timeoutMs) || 0);
    if (!durationMs) return promise;
    let timeoutId = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(createTimeoutError(label, durationMs)), durationMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function getFreshCachedRead(cacheKey) {
    const cached = readCache.get(cacheKey);
    if (!cached) return null;
    if (currentTimeMs() - Number(cached.cachedAtMs || 0) <= Math.max(0, Number(dataOpsReadCacheTtlMs) || 0)) {
      return cached.value;
    }
    return null;
  }

  function getAnyCachedRead(cacheKey) {
    const cached = readCache.get(cacheKey);
    return cached ? cached.value : null;
  }

  function rememberRead(cacheKey, value) {
    if (value === null || value === undefined) return;
    readCache.set(cacheKey, {
      cachedAtMs: currentTimeMs(),
      value,
    });
  }

  function forgetReads(...cacheKeys) {
    cacheKeys.forEach((cacheKey) => {
      const key = normalizeString(cacheKey);
      if (key.endsWith('*')) {
        const prefix = key.slice(0, -1);
        Array.from(readCache.keys()).forEach((cachedKey) => {
          if (normalizeString(cachedKey).startsWith(prefix)) readCache.delete(cachedKey);
        });
        return;
      }
      readCache.delete(key);
    });
  }

  async function cachedRead(cacheKey, loader, options = {}) {
    const bypassReadCache = Boolean(options.bypassReadCache);
    if (!bypassReadCache) {
      const fresh = getFreshCachedRead(cacheKey);
      if (fresh) return fresh;
    }
    const loaded = await loader();
    if (loaded !== null && loaded !== undefined) {
      if (!bypassReadCache) rememberRead(cacheKey, loaded);
      return loaded;
    }
    if (bypassReadCache) return loaded;
    const stale = getAnyCachedRead(cacheKey);
    if (stale) {
      if (!options.suppressStaleReadCacheLog && typeof logger.warn === 'function') {
        logger.warn(`[DataOps][cache-stale] ${cacheKey}`);
      }
      return stale;
    }
    return loaded;
  }

  async function run(label, operation, options = {}) {
    const client = getClient(options);
    if (!client) return { ok: false, unavailable: true, error: new Error('Supabase niet geconfigureerd') };
    const isReadOperation = isRunReadOperation(options);
    if (isReadOperation && isReadFailureCooldownActive() && !options.bypassReadFailureCooldown) {
      return { ok: false, unavailable: false, error: createReadCooldownError() };
    }
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => operation(client)),
        options.timeoutMs,
        label
      );
      if (result && result.error) throw result.error;
      if (isReadOperation) {
        readFailureCooldownUntilMs = 0;
        readFailureCooldownReason = '';
      }
      return { ok: true, data: result ? result.data : null, count: result ? result.count : null };
    } catch (error) {
      if (isReadOperation && isTransientReadError(error)) {
        if (!options.suppressReadFailureCooldown) openReadFailureCooldown(error);
      }
      if (!isUnavailableError(error)) {
        const shouldSuppressTransientLog =
          isReadOperation &&
          isTransientReadError(error) &&
          Boolean(options.suppressTransientReadFailureLog);
        let log = null;
        if (!shouldSuppressTransientLog) {
          log = isReadOperation && isTransientReadError(error) && typeof logger.warn === 'function'
            ? logger.warn.bind(logger)
            : typeof logger.error === 'function'
              ? logger.error.bind(logger)
              : null;
        }
        if (log) log(`[DataOps][${label}]`, error?.message || error);
      }
      return { ok: false, unavailable: isUnavailableError(error), error };
    }
  }

  function isoNow() {
    return now().toISOString();
  }

  function currentTimeMs() {
    const value = now();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function normalizeCustomerPayload(raw = {}, index = 0) {
    const payload = raw && typeof raw === 'object' ? { ...raw } : {};
    payload.id = resolveRecordId(payload, `customer_${index + 1}`);
    const phone = normalizeString(payload.telefoon || payload.tel || payload.phone || payload.contactPhone);
    if (phone && !payload.telefoon) payload.telefoon = phone;
    if (phone && !payload.tel) payload.tel = phone;
    return payload;
  }

  function buildCustomerRow(raw, index, source) {
    const payload = normalizeCustomerPayload(raw, index);
    const status = normalizeString(payload.databaseStatus || payload.status).toLowerCase();
    return {
      customer_id: payload.id,
      identity_key: buildCustomerIdentityKey(payload),
      company: normalizeString(payload.bedrijf || payload.company || payload.companyName).slice(0, 240),
      contact_name: normalizeString(payload.naam || payload.contact || payload.contactName).slice(0, 240),
      phone: normalizeString(payload.telefoon || payload.tel || payload.phone || payload.contactPhone).slice(0, 120),
      email: normalizeString(payload.email || payload.contactEmail).slice(0, 240),
      website: normalizeString(payload.website || payload.dom || payload.domain || payload.url).slice(0, 400),
      database_status: normalizeString(payload.databaseStatus || '').toLowerCase().slice(0, 80),
      lifecycle_status: status.slice(0, 80),
      responsible: normalizeString(payload.verantwoordelijk || payload.responsible || payload.claimedBy).slice(0, 120),
      payload,
      source: normalizeString(source || 'ui-state-compat').slice(0, 120),
      version: Date.now(),
      updated_at: isoNow(),
      deleted_at: null,
    };
  }

  function isOutboundSentStatus(value, payload) {
    const normalized = normalizeContactStatus(value, payload);
    if (normalized === 'gemaild') return true;
    const compact = normalizeString(value).toLowerCase();
    return ['gemaild', 'mailed', 'sent', 'email sent'].includes(compact);
  }

  function customerHistoryHasOutboundSentSignal(payload) {
    const history = Array.isArray(payload && payload.hist) ? payload.hist : [];
    return history.some((entry) => {
      const text = normalizeString([
        entry && entry.type,
        entry && entry.label,
        entry && entry.title,
        entry && entry.note,
        entry && entry.description,
        entry && entry.source,
      ].join(' ')).toLowerCase();
      return /\b(gemaild|mail verstuurd|mail geopend|coldmail|cold mailing|instantly|email sent|email opened|open tracking)\b/.test(text);
    });
  }

  function hasOutboundSentCustomerSignal(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const statuses = [
      row && row.database_status,
      row && row.lifecycle_status,
      payload.databaseStatus,
      payload.status,
      payload.outreachStatus,
      payload.contactStatus,
    ];
    if (statuses.some((status) => isOutboundSentStatus(status, payload))) return true;
    const timestampFields = [
      payload.lastColdmailSentAt,
      payload.lastMailSentAt,
      payload.outreachSentAt,
      payload.outreach_sent_at,
      payload.lastInstantlySentAt,
      payload.instantlySentAt,
      payload.sentAt,
    ];
    if (timestampFields.some((value) => normalizeString(value))) return true;
    const messageFields = [
      payload.coldmailSentMessageId,
      payload.outreachMessageId,
      payload.sentMessageId,
      payload.messageId,
      payload.instantlyLeadId,
    ];
    if (messageFields.some((value) => normalizeString(value))) return true;
    return customerHistoryHasOutboundSentSignal(payload);
  }

  function resolveSentCustomerGuardProvider(row, meta = {}) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const text = normalizeString([
      payload.lastColdmailProvider,
      payload.outreachProvider,
      payload.outboundProvider,
      payload.provider,
      payload.source,
      row && row.source,
      meta.source,
      ...(Array.isArray(payload.hist)
        ? payload.hist.map((entry) => [entry && entry.type, entry && entry.label, entry && entry.source].join(' '))
        : []),
    ].join(' ')).toLowerCase();
    if (/\binstantly\b/.test(text)) return { provider: 'instantly', channel: 'instantly' };
    return { provider: 'softora', channel: 'coldmail' };
  }

  function resolveSentCustomerGuardAt(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const candidates = [
      payload.lastColdmailSentAt,
      payload.lastMailSentAt,
      payload.outreachSentAt,
      payload.outreach_sent_at,
      payload.lastInstantlySentAt,
      payload.instantlySentAt,
      payload.sentAt,
      row && row.updated_at,
    ];
    const value = candidates.find((candidate) => Number.isFinite(Date.parse(normalizeString(candidate))));
    return normalizeString(value) || isoNow();
  }

  function buildSentCustomerReservationId(row, provider, sentAt) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const basis = [
      provider,
      payload.coldmailSentMessageId,
      payload.outreachMessageId,
      payload.sentMessageId,
      payload.messageId,
      row && row.email,
      row && row.website,
      row && row.company,
      row && row.customer_id,
      sentAt,
    ].map(normalizeString).filter(Boolean).join('|') || `${provider}|${normalizeString(row && row.customer_id)}`;
    return `data-ops-sent-${createHash('sha256').update(basis).digest('hex').slice(0, 24)}`;
  }

  function buildSentOutboundGuardRowsForCustomer(row, meta = {}) {
    if (!hasOutboundSentCustomerSignal(row)) return [];
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const at = resolveSentCustomerGuardAt(row);
    const { provider, channel } = resolveSentCustomerGuardProvider(row, meta);
    const reservationId = buildSentCustomerReservationId(row, provider, at);
    const recipientCompany = normalizeString(row && row.company) ||
      normalizeString(payload.bedrijf || payload.company || payload.companyName);
    const identity = {
      recipientEmail: normalizeString(row && row.email) || normalizeString(payload.email || payload.contactEmail),
      recipientDomain:
        normalizeString(row && row.website) ||
        normalizeString(payload.website || payload.dom || payload.domain || payload.url),
      recipientCompanyKey: recipientCompany,
      recipientId: normalizeString(row && row.customer_id) || normalizeString(payload.id || payload.customerId),
      recipientCompany,
    };
    const senderEmail = normalizeString(
      payload.lastColdmailSenderEmail ||
        payload.coldmailSenderEmail ||
        payload.outreachSenderEmail ||
        payload.senderEmail ||
        payload.mailSenderEmail
    );
    return getIdentityKeyRows(identity, normalizeString).map((keyRow) => ({
      guard_key: keyRow.guardKey,
      key_type: keyRow.keyType,
      key_value: keyRow.keyValue,
      reservation_id: reservationId,
      provider,
      channel,
      sender_email: senderEmail.slice(0, 240),
      recipient_email: keyRow.identity.recipientEmail,
      recipient_domain: keyRow.identity.recipientDomain,
      recipient_company_key: keyRow.identity.recipientCompanyKey,
      recipient_id: keyRow.identity.recipientId,
      recipient_company: truncateText(keyRow.identity.recipientCompany, 160),
      status: 'sent',
      source: SENT_CUSTOMER_GUARD_SOURCE,
      actor: truncateText(normalizeString(meta.actor || meta.source || 'data-ops'), 160),
      permanent: true,
      payload: {
        customerId: normalizeString(row && row.customer_id),
        bedrijf: recipientCompany,
        source: normalizeString(meta.source || row && row.source || 'data-ops'),
      },
      expires_at: null,
      last_seen_at: at,
      updated_at: at,
    }));
  }

  async function readExistingOutboundGuardKeys(guardKeys) {
    const keys = Array.from(new Set((Array.isArray(guardKeys) ? guardKeys : []).map(normalizeString).filter(Boolean)));
    const existing = new Set();
    for (let index = 0; index < keys.length; index += OUTBOUND_GUARD_KEY_LOOKUP_CHUNK_SIZE) {
      const keyChunk = keys.slice(index, index + OUTBOUND_GUARD_KEY_LOOKUP_CHUNK_SIZE);
      const result = await run(
        'list-existing-sent-outbound-recipient-guards',
        (client) => client.from(TABLES.outboundRecipientGuards).select('guard_key').in('guard_key', keyChunk),
        getWriteOperationOptions()
      );
      if (!result.ok) return result;
      (Array.isArray(result.data) ? result.data : []).forEach((row) => {
        const guardKey = normalizeString(row && row.guard_key);
        if (guardKey) existing.add(guardKey);
      });
    }
    return { ok: true, data: existing };
  }

  async function ensureSentOutboundRecipientGuards(rows, meta = {}) {
    const guardRowsByKey = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      buildSentOutboundGuardRowsForCustomer(row, meta).forEach((guardRow) => {
        if (!guardRowsByKey.has(guardRow.guard_key)) guardRowsByKey.set(guardRow.guard_key, guardRow);
      });
    });
    if (!guardRowsByKey.size) return { ok: true, inserted: 0, expected: 0 };

    const existing = await readExistingOutboundGuardKeys(Array.from(guardRowsByKey.keys()));
    if (!existing.ok) return existing;
    const existingKeys = existing.data instanceof Set ? existing.data : new Set();
    const missingRows = Array.from(guardRowsByKey.values()).filter((row) => !existingKeys.has(row.guard_key));
    if (!missingRows.length) return { ok: true, inserted: 0, expected: guardRowsByKey.size };

    let inserted = 0;
    for (let index = 0; index < missingRows.length; index += 500) {
      const chunk = missingRows.slice(index, index + 500);
      const result = await run(
        'insert-sent-outbound-recipient-guards',
        (client) => client.from(TABLES.outboundRecipientGuards).insert(chunk).select('guard_key'),
        getWriteOperationOptions()
      );
      if (!result.ok) return result;
      inserted += Array.isArray(result.data) ? result.data.length : chunk.length;
    }
    return { ok: true, inserted, expected: guardRowsByKey.size };
  }

  function hasUsableCustomerIdentityKey(identityKey) {
    const parts = normalizeString(identityKey).split('|');
    const company = normalizeString(parts[0]);
    const contact = normalizeString(parts[1]);
    const phone = normalizeString(parts[2]).replace(/[^\d]/g, '');
    return phone.length >= 7 || Boolean(company && contact);
  }

  function getCustomerRowStatus(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    return normalizeContactStatus(
      row?.database_status || row?.lifecycle_status || payload.databaseStatus || payload.status,
      payload
    );
  }

  function parseCustomerRowTimestampMs(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    const candidates = [
      row && row.updated_at,
      payload.updatedAt,
      payload.lastColdmailReplyAt,
      payload.lastColdmailSentAt,
      payload.datum,
    ];
    return candidates
      .map((value) => Date.parse(normalizeString(value)))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
  }

  function isCustomerRowPreferred(left, right) {
    const leftPriority = getContactStatusPriority(getCustomerRowStatus(left));
    const rightPriority = getContactStatusPriority(getCustomerRowStatus(right));
    if (rightPriority !== leftPriority) return rightPriority > leftPriority;
    const leftUpdatedAt = parseCustomerRowTimestampMs(left);
    const rightUpdatedAt = parseCustomerRowTimestampMs(right);
    if (rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt > leftUpdatedAt;
    return false;
  }

  function isMissingPayloadValue(value) {
    return value === null || value === undefined || normalizeString(value) === '';
  }

  function mergeCustomerHistories(primaryPayload, secondaryPayload) {
    const combined = [
      ...(Array.isArray(primaryPayload.hist) ? primaryPayload.hist : []),
      ...(Array.isArray(secondaryPayload.hist) ? secondaryPayload.hist : []),
    ].filter(Boolean);
    const seen = new Set();
    return combined
      .filter((entry) => {
        const key = normalizeString(entry && entry.messageKey)
          || [
            normalizeString(entry && entry.type),
            normalizeString(entry && entry.label),
            normalizeString(entry && entry.date),
            normalizeString(entry && entry.actor),
          ].join('|');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50);
  }

  function collectMergedCustomerIds(primaryPayload, secondaryPayload, primaryId, secondaryId) {
    return Array.from(
      new Set(
        [
          ...(Array.isArray(primaryPayload.mergedCustomerIds) ? primaryPayload.mergedCustomerIds : []),
          ...(Array.isArray(secondaryPayload.mergedCustomerIds) ? secondaryPayload.mergedCustomerIds : []),
          primaryId,
          secondaryId,
        ]
          .map(normalizeString)
          .filter(Boolean)
      )
    );
  }

  function mergeCustomerRowsByIdentity(existingRow, incomingRow, index, source) {
    const incomingPreferred = isCustomerRowPreferred(existingRow, incomingRow);
    const primary = incomingPreferred ? incomingRow : existingRow;
    const secondary = incomingPreferred ? existingRow : incomingRow;
    const primaryPayload = primary && primary.payload && typeof primary.payload === 'object' ? primary.payload : {};
    const secondaryPayload =
      secondary && secondary.payload && typeof secondary.payload === 'object' ? secondary.payload : {};
    const mergedPayload = {
      ...secondaryPayload,
      ...primaryPayload,
    };

    Object.keys(secondaryPayload).forEach((key) => {
      if (isMissingPayloadValue(mergedPayload[key]) && !isMissingPayloadValue(secondaryPayload[key])) {
        mergedPayload[key] = secondaryPayload[key];
      }
    });

    const mergedStatus = chooseStrongerContactStatus(getCustomerRowStatus(primary), getCustomerRowStatus(secondary));
    if (mergedStatus) {
      mergedPayload.status = mergedStatus;
      mergedPayload.databaseStatus = mergedStatus;
    }
    mergedPayload.id = primary.customer_id;
    mergedPayload.hist = mergeCustomerHistories(primaryPayload, secondaryPayload);
    mergedPayload.mergedCustomerIds = collectMergedCustomerIds(
      primaryPayload,
      secondaryPayload,
      primary.customer_id,
      secondary.customer_id
    );

    return buildCustomerRow(mergedPayload, index, source);
  }

  async function collectPagedRows(label, buildQuery, options = {}) {
    const pageSize = Math.max(1, Math.min(1000, Number(options.pageSize) || 1000));
    const maxRows = Math.max(pageSize, Math.min(25000, Number(options.maxRows) || 5000));
    const rows = [];

    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const from = offset;
      const to = Math.min(offset + pageSize, maxRows) - 1;
      const result = await run(`${label}-${from}-${to}`, (client) => {
        const query = buildQuery(client);
        if (query && typeof query.range === 'function') return query.range(from, to);
        if (query && typeof query.limit === 'function') return query.limit(to - from + 1);
        return query;
      }, {
        timeoutMs: options.timeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });
      if (!result.ok) return result;

      const pageRows = Array.isArray(result.data) ? result.data : [];
      rows.push(...pageRows);
      if (pageRows.length < to - from + 1) break;
    }

    return { ok: true, data: rows };
  }

  function dedupeCustomerRowsForReplace(rows, source) {
    const output = [];
    const indexByIdentityKey = new Map();
    rows.forEach((row) => {
      const identityKey = normalizeString(row && row.identity_key);
      if (!hasUsableCustomerIdentityKey(identityKey)) {
        output.push(row);
        return;
      }
      const existingIndex = indexByIdentityKey.get(identityKey);
      if (existingIndex === undefined) {
        indexByIdentityKey.set(identityKey, output.length);
        output.push(row);
        return;
      }
      output[existingIndex] = mergeCustomerRowsByIdentity(
        output[existingIndex],
        row,
        existingIndex,
        source
      );
    });
    return output;
  }

  async function markMissingDeleted(table, idColumn, incomingIds, source) {
    const current = await collectPagedRows(`list-${table}-ids`, (client) =>
      client.from(table).select(idColumn).is('deleted_at', null)
    );
    if (!current.ok) return current;
    const incoming = new Set(incomingIds.map(normalizeString).filter(Boolean));
    const missing = (current.data || [])
      .map((row) => normalizeString(row && row[idColumn]))
      .filter((id) => id && !incoming.has(id));
    if (!missing.length) return { ok: true, data: [] };
    return run(
      `delete-missing-${table}`,
      (client) =>
        client
          .from(table)
          .update({
            deleted_at: isoNow(),
            updated_at: isoNow(),
            source: normalizeString(source || 'ui-state-compat').slice(0, 120),
          })
          .in(idColumn, missing),
      getWriteOperationOptions()
    );
  }

  async function listCustomers(options = {}) {
    return cachedRead('customers', async () => {
      const result = await collectPagedRows('list-customers', (client) =>
        client
          .from(TABLES.customers)
          .select('customer_id,payload,updated_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
      {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });
      if (!result.ok) return null;
      return (result.data || []).map((row) => ({
        ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
        id: normalizeString(row.payload?.id || row.customer_id),
      }));
    }, {
      bypassReadCache: options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
  }

  async function listCustomerSnapshotRows(options = {}) {
    return cachedRead('customers-snapshot', async () => {
      const result = await collectPagedRows('list-customers-snapshot', (client) =>
        client
          .from(TABLES.customers)
          .select('customer_id,identity_key,company,contact_name,phone,email,website,database_status,lifecycle_status,responsible,updated_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
      {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });
      return result.ok ? result.data || [] : null;
    }, {
      bypassReadCache: options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
  }

  async function replaceCustomers(customers, meta = {}) {
    const rows = dedupeCustomerRowsForReplace(
      (Array.isArray(customers) ? customers : []).map((item, index) =>
        buildCustomerRow(item, index, meta.source)
      ),
      meta.source
    );
    if (rows.length) {
      const guardWrite = await ensureSentOutboundRecipientGuards(rows, meta);
      if (!guardWrite.ok) return guardWrite;
      const upsert = await run(
        'upsert-customers',
        (client) => client.from(TABLES.customers).upsert(rows, { onConflict: 'customer_id' }),
        getWriteOperationOptions()
      );
      if (!upsert.ok) return upsert;
    }
    forgetReads('customers');
    return markMissingDeleted(
      TABLES.customers,
      'customer_id',
      rows.map((row) => row.customer_id),
      meta.source
    );
  }

  async function deleteCustomers(customerIds, meta = {}) {
    const ids = Array.from(new Set((Array.isArray(customerIds) ? customerIds : []).map(normalizeString).filter(Boolean)));
    if (!ids.length) return { ok: true, data: [], deleted: 0 };
    const result = await run(
      'delete-customers-explicit',
      (client) =>
        client
          .from(TABLES.customers)
          .update({
            deleted_at: isoNow(),
            updated_at: isoNow(),
            source: normalizeString(meta.source || 'ui-state-compat').slice(0, 120),
          })
          .in('customer_id', ids),
      getWriteOperationOptions()
    );
    if (result.ok) forgetReads('customers');
    return result;
  }

  function buildOrderRow(raw, index, source) {
    const payload = raw && typeof raw === 'object' ? { ...raw } : {};
    const id = normalizeString(payload.id || payload.orderId) || `order_${index + 1}`;
    payload.id = payload.id || id;
    return {
      order_id: id,
      customer_id: normalizeString(payload.customerId || payload.customer_id).slice(0, 160),
      customer_name: normalizeString(payload.clientName || payload.naam || payload.contactName).slice(0, 240),
      company_name: normalizeString(payload.companyName || payload.bedrijf || payload.location).slice(0, 240),
      title: normalizeString(payload.title || payload.type).slice(0, 240),
      status: normalizeString(payload.status || payload.statusKey).slice(0, 120),
      payload,
      source: normalizeString(source || 'ui-state-compat').slice(0, 120),
      version: Date.now(),
      updated_at: isoNow(),
      deleted_at: null,
    };
  }

  async function listActiveOrders() {
    return cachedRead('active-orders', async () => {
      const result = await run('list-active-orders', (client) =>
        client
          .from(TABLES.activeOrders)
          .select('order_id,payload,updated_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(5000),
      { timeoutMs: dataOpsReadQueryTimeoutMs });
      if (!result.ok) return null;
      return (result.data || []).map((row) => ({ ...(row.payload || {}), id: row.payload?.id || row.order_id }));
    });
  }

  async function replaceActiveOrders(orders, meta = {}) {
    const rows = (Array.isArray(orders) ? orders : []).map((item, index) =>
      buildOrderRow(item, index, meta.source)
    );
    if (rows.length) {
      const upsert = await run(
        'upsert-active-orders',
        (client) => client.from(TABLES.activeOrders).upsert(rows, { onConflict: 'order_id' }),
        getWriteOperationOptions()
      );
      if (!upsert.ok) return upsert;
    }
    forgetReads('active-orders');
    return markMissingDeleted(
      TABLES.activeOrders,
      'order_id',
      rows.map((row) => row.order_id),
      meta.source
    );
  }

  async function listOrderRuntime() {
    return cachedRead('order-runtime', async () => {
      const result = await run('list-order-runtime', (client) =>
        client
          .from(TABLES.orderRuntime)
          .select('order_id,payload,updated_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(5000),
      { timeoutMs: dataOpsReadQueryTimeoutMs });
      if (!result.ok) return null;
      return (result.data || []).reduce((acc, row) => {
        const id = normalizeString(row.order_id);
        if (id) acc[id] = row.payload && typeof row.payload === 'object' ? row.payload : {};
        return acc;
      }, {});
    });
  }

  async function replaceOrderRuntime(runtimeMap, meta = {}) {
    const source = normalizeString(meta.source || 'ui-state-compat').slice(0, 120);
    const rows = Object.entries(runtimeMap && typeof runtimeMap === 'object' ? runtimeMap : {})
      .map(([id, payload]) => {
        const orderId = normalizeString(id);
        if (!orderId) return null;
        const rowPayload = payload && typeof payload === 'object' ? payload : {};
        return {
          order_id: orderId,
          status_key: normalizeString(rowPayload.statusKey || rowPayload.status).slice(0, 120),
          progress_pct: Number.isFinite(Number(rowPayload.progressPct)) ? Number(rowPayload.progressPct) : null,
          payload: rowPayload,
          source,
          version: Date.now(),
          updated_at: isoNow(),
          deleted_at: null,
        };
      })
      .filter(Boolean);
    if (rows.length) {
      const upsert = await run(
        'upsert-order-runtime',
        (client) => client.from(TABLES.orderRuntime).upsert(rows, { onConflict: 'order_id' }),
        getWriteOperationOptions()
      );
      if (!upsert.ok) return upsert;
    }
    forgetReads('order-runtime');
    return markMissingDeleted(
      TABLES.orderRuntime,
      'order_id',
      rows.map((row) => row.order_id),
      source
    );
  }

  async function ensurePhotoBucket(client) {
    const existing = await client.storage.getBucket(bucketName);
    if (!existing.error) return true;
    const created = await client.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error;
    return true;
  }

  async function uploadDesignPhoto(entry, meta = {}) {
    const parsed = parseImageDataUrl(entry && entry.dataUrl);
    if (!parsed) return { ok: false, unavailable: false, error: new Error('Ongeldige foto-data') };
    return run('upload-design-photo', async (client) => {
      await ensurePhotoBucket(client);
      const customerId = resolveRecordId({ id: entry.customerId }, 'customer');
      const ext = extensionForMimeType(parsed.mimeType);
      const path = [
        'customers',
        sanitizeStorageSegment(customerId, 'customer'),
        `${parsed.contentHash}.${ext}`,
      ].join('/');
      const uploaded = await client.storage.from(bucketName).upload(path, parsed.buffer, {
        cacheControl: DESIGN_PHOTO_CACHE_CONTROL_SECONDS,
        contentType: parsed.mimeType,
        upsert: true,
      });
      if (uploaded.error) throw uploaded.error;
      const legacyMeta = entry.legacyMeta && typeof entry.legacyMeta === 'object' ? { ...entry.legacyMeta } : {};
      const mockup = parseImageDataUrl(entry.websiteMockup || entry.mockup || entry.websiteMockupDataUrl || entry.mockupDataUrl);
      if (mockup) {
        const mockupExt = extensionForMimeType(mockup.mimeType);
        const mockupPath = [
          'customers',
          sanitizeStorageSegment(customerId, 'customer'),
          `${mockup.contentHash}-mockup.${mockupExt}`,
        ].join('/');
        const uploadedMockup = await client.storage.from(bucketName).upload(mockupPath, mockup.buffer, {
          cacheControl: DESIGN_PHOTO_CACHE_CONTROL_SECONDS,
          contentType: mockup.mimeType,
          upsert: true,
        });
        if (uploadedMockup.error) throw uploadedMockup.error;
        const existingMockupMeta = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : {};
        const mockupFileName = normalizeString(entry.websiteMockupName || entry.mockupFileName || `${customerId}-mockup.${mockupExt}`).slice(0, 240);
        const generatedByCurrentRenderer = /-device-mockup-v8\.jpe?g$/i.test(mockupFileName);
        const mockupUpdatedAt = isoNow();
        legacyMeta.mockup = {
          ...existingMockupMeta,
          storageBucket: bucketName,
          storagePath: mockupPath,
          mimeType: mockup.mimeType,
          fileName: mockupFileName,
          byteSize: mockup.buffer.length,
          contentHash: mockup.contentHash,
          renderer: normalizeString(entry.mockupRenderer || (generatedByCurrentRenderer ? 'softora-browser-device-v8' : existingMockupMeta.renderer || '')),
          orientation: normalizeString(entry.mockupOrientation || (generatedByCurrentRenderer ? 'upright' : existingMockupMeta.orientation || '')),
          qualityStatus: normalizeString(entry.mockupQualityStatus || (generatedByCurrentRenderer ? 'checked' : existingMockupMeta.qualityStatus || 'unverified')),
          qualityCheckedAt: normalizeString(entry.mockupQualityCheckedAt || (generatedByCurrentRenderer ? mockupUpdatedAt : existingMockupMeta.qualityCheckedAt || '')),
          updatedAt: mockupUpdatedAt,
        };
        legacyMeta.websiteMockupName = legacyMeta.mockup.fileName;
      }
      const row = {
        customer_id: customerId,
        identity_key: normalizeString(entry.identityKey || ''),
        storage_bucket: bucketName,
        storage_path: path,
        mime_type: parsed.mimeType,
        file_name: normalizeString(entry.fileName || entry.websitePhotoName || `${customerId}.${ext}`).slice(0, 240),
        byte_size: parsed.buffer.length,
        content_hash: parsed.contentHash,
        legacy_meta: legacyMeta,
        source: normalizeString(meta.source || 'ui-state-compat').slice(0, 120),
        version: Date.now(),
        updated_at: isoNow(),
        deleted_at: null,
      };
      return client.from(TABLES.designPhotos).upsert(row, { onConflict: 'customer_id' });
    });
  }

  async function replaceDesignPhotos(entries, meta = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const source = normalizeString(meta.source || 'ui-state-compat').slice(0, 120);
    const fullReplaceAllowed = Boolean(meta.fullReplace || /^migration:/i.test(source));
    if (!fullReplaceAllowed) {
      return upsertDesignPhotos(list, meta);
    }
    if (!list.length && !meta.allowEmptyReplace) {
      return { ok: true, data: [], skippedEmptyReplace: true };
    }
    for (const entry of list) {
      const saved = await uploadDesignPhoto(entry, meta);
      if (!saved.ok) return saved;
    }
    return markMissingDeleted(
      TABLES.designPhotos,
      'customer_id',
      list.map((entry) => entry.customerId),
      source
    );
  }

  async function upsertDesignPhotos(entries, meta = {}) {
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      const saved = await uploadDesignPhoto(entry, meta);
      if (!saved.ok) return saved;
    }
    return { ok: true, data: [], upserted: list.length };
  }

  async function deleteDesignPhotos(customerIds, meta = {}) {
    const ids = Array.from(new Set((Array.isArray(customerIds) ? customerIds : []).map(normalizeString).filter(Boolean)));
    if (!ids.length) return { ok: true, data: [], deleted: 0 };
    const result = await run(
      'delete-design-photos-explicit',
      (client) =>
        client
          .from(TABLES.designPhotos)
          .update({
            deleted_at: isoNow(),
            updated_at: isoNow(),
            source: normalizeString(meta.source || 'ui-state-compat').slice(0, 120),
          })
          .in('customer_id', ids),
      getWriteOperationOptions()
    );
    if (result.ok) forgetReads('design-photos', 'design-photos-signed:*');
    return result;
  }

  async function listDesignPhotosWithDataUrls() {
    const result = await run('list-design-photos', (client) =>
      client
        .from(TABLES.designPhotos)
        .select('customer_id,identity_key,storage_bucket,storage_path,mime_type,file_name,legacy_meta,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(500),
    { timeoutMs: dataOpsReadQueryTimeoutMs });
    if (!result.ok) return null;
    const client = getClient();
    const rows = result.data || [];
    const entries = [];
    let cursor = 0;
    const workerCount = Math.min(8, Math.max(1, rows.length));

    async function downloadNext() {
      while (cursor < rows.length) {
        const row = rows[cursor];
        cursor += 1;
        const bucket = normalizeString(row.storage_bucket || bucketName);
        const path = normalizeString(row.storage_path);
        if (!bucket || !path) continue;
        const downloaded = await client.storage.from(bucket).download(path);
        if (downloaded.error || !downloaded.data) continue;
        const buffer = Buffer.from(await downloaded.data.arrayBuffer());
        const entry = {
          customerId: normalizeString(row.customer_id),
          dataUrl: `data:${normalizeString(row.mime_type || 'image/jpeg')};base64,${buffer.toString('base64')}`,
          fileName: normalizeString(row.file_name),
          identityKey: normalizeString(row.identity_key),
          legacyMeta: row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {},
          updatedAt: normalizeString(row.updated_at),
        };
        const mockupMeta = row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta.mockup : null;
        const mockupBucket = normalizeString(mockupMeta && mockupMeta.storageBucket);
        const mockupPath = normalizeString(mockupMeta && mockupMeta.storagePath);
        if (mockupBucket && mockupPath) {
          const downloadedMockup = await client.storage.from(mockupBucket).download(mockupPath);
          if (!downloadedMockup.error && downloadedMockup.data) {
            const mockupBuffer = Buffer.from(await downloadedMockup.data.arrayBuffer());
            entry.websiteMockup = `data:${normalizeString(mockupMeta.mimeType || 'image/jpeg')};base64,${mockupBuffer.toString('base64')}`;
            entry.websiteMockupName = normalizeString(mockupMeta.fileName || entry.legacyMeta.websiteMockupName);
          }
        }
        entries.push(entry);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, downloadNext));
    Object.defineProperty(entries, 'hadStructuredRows', {
      value: rows.length > 0,
      enumerable: false,
    });
    return entries;
  }

  async function listDesignPhotosWithSignedUrls(options = {}) {
    const expiresInSeconds = Math.max(
      60,
      Math.min(24 * 60 * 60, Number(options.expiresInSeconds) || 60 * 60)
    );
    const identifiers = Array.from(new Set(
      (Array.isArray(options.identifiers) ? options.identifiers : [])
        .map(normalizeString)
        .filter(Boolean)
    ));
    const maxMatchLimit = identifiers.length ? 500 : DESIGN_PHOTO_SIGNED_URL_DEFAULT_SCAN_LIMIT;
    const defaultMaxMatches = identifiers.length ? 12 : DESIGN_PHOTO_SIGNED_URL_DEFAULT_SCAN_LIMIT;
    const maxMatches = Math.max(1, Math.min(maxMatchLimit, Number(options.maxMatches) || defaultMaxMatches));
    const cacheKey = identifiers.length
      ? `design-photos-signed:${identifiers.join('|')}:${maxMatches}`
      : `design-photos-signed:all:${maxMatches}`;
    const scanLimit = identifiers.length
      ? DESIGN_PHOTO_SIGNED_URL_TARGETED_SCAN_LIMIT
      : DESIGN_PHOTO_SIGNED_URL_DEFAULT_SCAN_LIMIT;
    const selectDesignPhotoRows = (client) =>
      client
        .from(TABLES.designPhotos)
        .select('customer_id,identity_key,storage_bucket,storage_path,mime_type,file_name,legacy_meta,updated_at')
        .is('deleted_at', null);
    async function readTargetedRows(buildQueryOptions) {
      const searchTerms = collectTargetedDesignPhotoSearchTerms(identifiers);
      if (!searchTerms.length) return [];
      const rowsById = new Map();
      for (const term of searchTerms) {
        const result = await run(`list-design-photos-targeted-${term}`, (client) => {
          let query = selectDesignPhotoRows(client);
          if (query && typeof query.or === 'function') {
            query = query.or([
              `customer_id.ilike.%${term}%`,
              `identity_key.ilike.%${term}%`,
              `file_name.ilike.%${term}%`,
            ].join(','));
          } else {
            return null;
          }
          if (query && typeof query.order === 'function') query = query.order('updated_at', { ascending: false });
          if (query && typeof query.limit === 'function') return query.limit(100);
          return query;
        }, buildQueryOptions);
        if (!result.ok) continue;
        (Array.isArray(result.data) ? result.data : []).forEach((row) => {
          const rowId = normalizeString(row && row.customer_id);
          if (rowId && !rowsById.has(rowId)) rowsById.set(rowId, row);
        });
      }
      return Array.from(rowsById.values());
    }
    const buildQueryOptions = {
      timeoutMs: dataOpsReadQueryTimeoutMs,
      bypassReadFailureCooldown: options.bypassReadFailureCooldown,
      suppressReadFailureCooldown: options.suppressReadFailureCooldown,
      suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
    };
    const structuredRows = await cachedRead(cacheKey, async () => {
      const buildQuery = (client) => selectDesignPhotoRows(client).order('updated_at', { ascending: false });
      let result = null;
      if (identifiers.length) {
        const targetedRows = await readTargetedRows(buildQueryOptions);
        const targetedMatches = targetedRows.filter((row) => designPhotoRowMatchesIdentifiers(row, identifiers));
        if (targetedMatches.length) return targetedMatches;
        result = await collectPagedRows('list-design-photos-signed-urls', buildQuery, {
          pageSize: DESIGN_PHOTO_SIGNED_URL_PAGE_SIZE,
          maxRows: scanLimit,
          ...buildQueryOptions,
        });
      } else {
        result = await collectPagedRows('list-design-photos-signed-urls', buildQuery, {
          pageSize: DESIGN_PHOTO_SIGNED_URL_PAGE_SIZE,
          maxRows: scanLimit,
          ...buildQueryOptions,
        });
      }
      return result.ok ? result.data || [] : null;
    }, {
      bypassReadCache: options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
    if (!structuredRows) return null;
    const client = getClient(buildQueryOptions);
    const rows = structuredRows
      .filter((row) => designPhotoRowMatchesIdentifiers(row, identifiers))
      .slice(0, maxMatches);
    const entries = [];

    function buildSignedUrlCacheKey(bucket, path, signOptions) {
      return JSON.stringify([
        normalizeString(bucket),
        normalizeString(path),
        Math.floor(expiresInSeconds),
        signOptions && typeof signOptions === 'object' ? signOptions : null,
      ]);
    }

    function readCachedSignedUrl(cacheKey) {
      const cached = signedUrlCache.get(cacheKey);
      if (!cached || !cached.signedUrl) return '';
      const minimumFreshMs = Math.min(
        SIGNED_URL_CACHE_MIN_FRESH_MS,
        Math.max(1000, expiresInSeconds * 1000 / 4)
      );
      if (Number(cached.expiresAtMs || 0) - currentTimeMs() > minimumFreshMs) {
        signedUrlCache.delete(cacheKey);
        signedUrlCache.set(cacheKey, cached);
        return cached.signedUrl;
      }
      signedUrlCache.delete(cacheKey);
      return '';
    }

    function rememberSignedUrl(cacheKey, signedUrl) {
      if (!signedUrl) return;
      signedUrlCache.set(cacheKey, {
        signedUrl,
        expiresAtMs: currentTimeMs() + expiresInSeconds * 1000,
      });
      while (signedUrlCache.size > SIGNED_URL_CACHE_LIMIT) {
        const oldestKey = signedUrlCache.keys().next().value;
        signedUrlCache.delete(oldestKey);
      }
    }

    async function createCachedSignedUrl(bucket, path, signOptions, signedUrlByCacheKey) {
      const cacheKey = buildSignedUrlCacheKey(bucket, path, signOptions);
      if (signedUrlByCacheKey && signedUrlByCacheKey.has(cacheKey)) {
        return { data: { signedUrl: signedUrlByCacheKey.get(cacheKey) }, error: null, cached: true };
      }
      const cached = readCachedSignedUrl(cacheKey);
      if (cached) {
        if (signedUrlByCacheKey) signedUrlByCacheKey.set(cacheKey, cached);
        return { data: { signedUrl: cached }, error: null, cached: true };
      }
      try {
        const signed = await withTimeout(
          client.storage.from(bucket).createSignedUrl(path, expiresInSeconds, signOptions),
          dataOpsReadQueryTimeoutMs,
          'create-signed-url'
        );
        if (!signed.error && signed.data?.signedUrl) {
          const signedUrl = normalizeString(signed.data.signedUrl);
          rememberSignedUrl(cacheKey, signedUrl);
          if (signedUrlByCacheKey) signedUrlByCacheKey.set(cacheKey, signedUrl);
        }
        return signed;
      } catch (error) {
        logger.warn('[DataOps][signed-url]', error?.message || error);
        return { data: null, error };
      }
    }

    function collectSignedUrlRequests() {
      const requestsByCacheKey = new Map();
      rows.forEach((row) => {
        const bucket = normalizeString(row.storage_bucket || bucketName);
        const path = normalizeString(row.storage_path);
        if (bucket && path) {
          requestsByCacheKey.set(buildSignedUrlCacheKey(bucket, path), {
            bucket,
            path,
            signOptions: undefined,
          });
        }
        const legacyMeta = row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {};
        const mockupMeta = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : null;
        if (mockupMeta) {
          const mockupBucket = normalizeString(mockupMeta.storageBucket || bucketName);
          const mockupPath = normalizeString(mockupMeta.storagePath);
          if (mockupBucket && mockupPath) {
            requestsByCacheKey.set(buildSignedUrlCacheKey(mockupBucket, mockupPath), {
              bucket: mockupBucket,
              path: mockupPath,
              signOptions: undefined,
            });
          }
        }
      });
      return Array.from(requestsByCacheKey.values());
    }

    async function signRequestsIndividually(requests, signedUrlByCacheKey) {
      let cursor = 0;
      const workerCount = Math.min(6, Math.max(1, requests.length));
      async function signNextRequest() {
        while (cursor < requests.length) {
          const request = requests[cursor];
          cursor += 1;
          await createCachedSignedUrl(request.bucket, request.path, request.signOptions, signedUrlByCacheKey);
        }
      }
      await Promise.all(Array.from({ length: workerCount }, signNextRequest));
    }

    async function signRequestsInBulk(requests) {
      const signedUrlByCacheKey = new Map();
      const missingByBucket = new Map();
      requests.forEach((request) => {
        const cacheKey = buildSignedUrlCacheKey(request.bucket, request.path, request.signOptions);
        const cached = readCachedSignedUrl(cacheKey);
        if (cached) {
          signedUrlByCacheKey.set(cacheKey, cached);
          return;
        }
        const bucketKey = normalizeString(request.bucket);
        if (!missingByBucket.has(bucketKey)) missingByBucket.set(bucketKey, []);
        missingByBucket.get(bucketKey).push(request);
      });

      for (const [bucket, bucketRequests] of missingByBucket.entries()) {
        const storage = client.storage.from(bucket);
        if (typeof storage.createSignedUrls !== 'function') {
          await signRequestsIndividually(bucketRequests, signedUrlByCacheKey);
          continue;
        }
        for (let index = 0; index < bucketRequests.length; index += 100) {
          const batch = bucketRequests.slice(index, index + 100);
          const paths = batch.map((request) => request.path);
          try {
            const signed = await withTimeout(
              storage.createSignedUrls(paths, expiresInSeconds),
              dataOpsReadQueryTimeoutMs,
              'create-signed-urls'
            );
            if (signed && signed.error) throw signed.error;
            const signedRows = Array.isArray(signed && signed.data) ? signed.data : [];
            signedRows.forEach((item, itemIndex) => {
              const path = normalizeString(item && (item.path || item.name)) || paths[itemIndex];
              const signedUrl = normalizeString(item && (item.signedUrl || item.signedURL || item.signed_url));
              if (!path || !signedUrl) return;
              const cacheKey = buildSignedUrlCacheKey(bucket, path);
              rememberSignedUrl(cacheKey, signedUrl);
              signedUrlByCacheKey.set(cacheKey, signedUrl);
            });
          } catch (error) {
            logger.warn('[DataOps][signed-urls-bulk]', error?.message || error);
            await signRequestsIndividually(batch, signedUrlByCacheKey);
          }
        }
      }
      return signedUrlByCacheKey;
    }

    const signedUrlByCacheKey = await signRequestsInBulk(collectSignedUrlRequests());

    rows.forEach((row) => {
      const bucket = normalizeString(row.storage_bucket || bucketName);
      const path = normalizeString(row.storage_path);
      const signedUrl = signedUrlByCacheKey.get(buildSignedUrlCacheKey(bucket, path));
      if (!bucket || !path || !signedUrl) return;
      const legacyMeta = row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {};
      const mockupMeta = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : null;
      const mockupBucket = normalizeString(mockupMeta && (mockupMeta.storageBucket || bucketName));
      const mockupPath = normalizeString(mockupMeta && mockupMeta.storagePath);
      const websiteMockupUrl = mockupBucket && mockupPath
        ? normalizeString(signedUrlByCacheKey.get(buildSignedUrlCacheKey(mockupBucket, mockupPath)))
        : '';
      entries.push({
        customerId: normalizeString(row.customer_id),
        websitePhotoUrl: signedUrl,
        websiteMockupUrl,
        storageBucket: bucket,
        storagePath: path,
        mimeType: normalizeString(row.mime_type || 'image/jpeg'),
        fileName: normalizeString(row.file_name),
        websiteMockupName: normalizeString(mockupMeta && mockupMeta.fileName || legacyMeta.websiteMockupName),
        identityKey: normalizeString(row.identity_key),
        legacyMeta,
        updatedAt: normalizeString(row.updated_at),
        signedUrlExpiresAt: new Date(currentTimeMs() + expiresInSeconds * 1000).toISOString(),
      });
    });

    Object.defineProperty(entries, 'hadStructuredRows', {
      value: structuredRows.length > 0,
      enumerable: false,
    });
    Object.defineProperty(entries, 'targetedIdentifiersApplied', {
      value: identifiers.length > 0,
      enumerable: false,
    });
    return entries;
  }

  async function listDesignPhotoAssetFlags(options = {}) {
    return cachedRead('design-photo-asset-flags', async () => {
      const result = await collectPagedRows('list-design-photo-asset-flags', (client) =>
        client
          .from(TABLES.designPhotos)
          .select('customer_id,identity_key,storage_path,legacy_meta,updated_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
      {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });
      if (!result.ok) return null;
      return (result.data || []).map((row) => {
        const legacyMeta = row && row.legacy_meta && typeof row.legacy_meta === 'object'
          ? row.legacy_meta
          : {};
        const mockupMeta = legacyMeta.mockup && typeof legacyMeta.mockup === 'object'
          ? legacyMeta.mockup
          : {};
        return {
          customerId: normalizeString(row && row.customer_id),
          identityKey: normalizeString(row && row.identity_key),
          hasPhoto: Boolean(normalizeString(row && row.storage_path)),
          hasMockup: Boolean(
            normalizeString(mockupMeta.storagePath) ||
              normalizeString(legacyMeta.websiteMockupStoragePath) ||
              normalizeString(legacyMeta.websiteMockupPath)
          ),
          updatedAt: normalizeString(row && row.updated_at),
        };
      });
    }, {
      bypassReadCache: options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
  }

  async function listOutboundRecipientGuardKeys(guardKeys, options = {}) {
    const keys = Array.from(new Set(
      (Array.isArray(guardKeys) ? guardKeys : [])
        .map(normalizeString)
        .filter(Boolean)
    ));
    if (!keys.length) return [];
    const found = new Set();
    for (let index = 0; index < keys.length; index += OUTBOUND_GUARD_KEY_LOOKUP_CHUNK_SIZE) {
      const keyChunk = keys.slice(index, index + OUTBOUND_GUARD_KEY_LOOKUP_CHUNK_SIZE);
      const result = await run('list-outbound-recipient-guard-keys', (client) =>
        client
          .from(TABLES.outboundRecipientGuards)
          .select('guard_key')
          .in('guard_key', keyChunk)
          .in('status', ['sent', 'reserved'])
          .limit(keyChunk.length),
      {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });
      if (!result.ok) return null;
      (result.data || []).forEach((row) => {
        const key = normalizeString(row && row.guard_key);
        if (key) found.add(key);
      });
    }
    return Array.from(found);
  }

  async function listOutboundRecipientGuardsForPreview(options = {}) {
    const identifiers = Array.from(new Set(
      (Array.isArray(options.identifiers) ? options.identifiers : [])
        .map(normalizeString)
        .filter(Boolean)
    ));
    const exactRecipientIds = collectOutboundRecipientGuardExactRecipientIds(identifiers);
    const searchTerms = collectOutboundRecipientGuardSearchTerms(identifiers);
    if (!exactRecipientIds.length && !searchTerms.length) return [];
    const maxMatches = Math.max(1, Math.min(200, Number(options.maxMatches) || 50));
    const cacheKey = `outbound-recipient-guards-preview:${exactRecipientIds.join('|')}:${searchTerms.join('|')}:${maxMatches}`;
    const rows = await cachedRead(cacheKey, async () => {
      const rowsByGuardKey = new Map();
      const buildQueryOptions = {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      };
      const rememberRows = (rows) => {
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const guardKey = normalizeString(row && row.guard_key);
          if (guardKey && !rowsByGuardKey.has(guardKey)) rowsByGuardKey.set(guardKey, row);
        });
      };
      const sortedRows = () =>
        Array.from(rowsByGuardKey.values())
          .filter((row) => normalizeString(row && row.sender_email))
          .sort((left, right) =>
            Math.max(Date.parse(normalizeString(right && right.updated_at)) || 0, Date.parse(normalizeString(right && right.created_at)) || 0) -
              Math.max(Date.parse(normalizeString(left && left.updated_at)) || 0, Date.parse(normalizeString(left && left.created_at)) || 0)
          );
      if (exactRecipientIds.length) {
        const exactResult = await run('list-outbound-recipient-guards-preview-exact-recipient-id', (client) => {
          let query = client
            .from(TABLES.outboundRecipientGuards)
            .select(OUTBOUND_RECIPIENT_GUARD_PREVIEW_COLUMNS)
            .in('recipient_id', exactRecipientIds);
          if (query && typeof query.in === 'function') query = query.in('status', ['sent', 'reserved']);
          if (query && typeof query.order === 'function') query = query.order('updated_at', { ascending: false });
          if (query && typeof query.limit === 'function') return query.limit(Math.max(50, maxMatches));
          return query;
        }, buildQueryOptions);
        if (exactResult.ok) {
          rememberRows(exactResult.data);
          const exactRows = sortedRows();
          if (exactRows.length) return exactRows.slice(0, maxMatches);
        }
      }
      for (const term of searchTerms) {
        const result = await run(`list-outbound-recipient-guards-preview-${term}`, (client) => {
          let query = client
            .from(TABLES.outboundRecipientGuards)
            .select(OUTBOUND_RECIPIENT_GUARD_PREVIEW_COLUMNS)
            .or([
              `guard_key.ilike.%${term}%`,
              `key_value.eq.${term}`,
              `recipient_id.eq.${term}`,
              `recipient_email.ilike.%${term}%`,
              `recipient_domain.eq.${term}`,
              `recipient_company_key.eq.${term}`,
            ].join(','));
          if (query && typeof query.in === 'function') query = query.in('status', ['sent', 'reserved']);
          if (query && typeof query.order === 'function') query = query.order('updated_at', { ascending: false });
          if (query && typeof query.limit === 'function') return query.limit(50);
          return query;
        }, buildQueryOptions);
        if (!result.ok) continue;
        rememberRows(result.data);
      }
      return sortedRows().slice(0, maxMatches);
    }, {
      bypassReadCache: options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
    return rows || [];
  }

  async function countActiveRows(table, deletedColumn = 'deleted_at') {
    const result = await run(`count-${table}`, (client) => {
      let query = client.from(table).select('*', { count: 'exact', head: true });
      if (deletedColumn) query = query.is(deletedColumn, null);
      return query;
    }, { timeoutMs: dataOpsReadQueryTimeoutMs });
    return result.ok ? Number(result.data?.count || result.count || 0) : null;
  }

  async function getDataOpsCounts() {
    const [customers, activeOrders, orderRuntime, designPhotos, webdesignJobs, mailboxMessages, mailboxSyncState] = await Promise.all([
      countActiveRows(TABLES.customers),
      countActiveRows(TABLES.activeOrders),
      countActiveRows(TABLES.orderRuntime),
      countActiveRows(TABLES.designPhotos),
      countActiveRows(TABLES.webdesignJobs, ''),
      countActiveRows(TABLES.mailboxMessages),
      countActiveRows(TABLES.mailboxSyncState, ''),
    ]);
    return {
      customers,
      activeOrders,
      orderRuntime,
      designPhotos,
      webdesignJobs,
      mailboxMessages,
      mailboxSyncState,
    };
  }

  function toIsoFromMaybeMs(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
    const normalized = normalizeString(value);
    return normalized || null;
  }

  function toMsFromIso(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeWebdesignJobRetryPayload(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      attempts: Math.max(0, Math.floor(Number(source.attempts || 0) || 0)),
      nextAttemptAt: Math.max(0, Number(source.nextAttemptAt || 0) || 0) || null,
      lastRetryAt: Math.max(0, Number(source.lastRetryAt || 0) || 0) || null,
      lastRetryReason: normalizeString(source.lastRetryReason || '').slice(0, 500),
    };
  }

  function buildWebdesignJobPayload(job = {}) {
    const retry = normalizeWebdesignJobRetryPayload(job.retry);
    const payload = {
      customer: job.customer && typeof job.customer === 'object' ? job.customer : {},
    };
    if (job.batchId) payload.batchId = normalizeString(job.batchId).slice(0, 120);
    if (Number.isFinite(Number(job.batchTargetIndex))) {
      payload.batchTargetIndex = Math.max(0, Math.floor(Number(job.batchTargetIndex)));
    }
    if (retry.attempts || retry.nextAttemptAt || retry.lastRetryAt || retry.lastRetryReason) {
      payload.retry = retry;
    }
    return payload;
  }

  function buildWebdesignJobRow(job = {}) {
    return {
      job_id: normalizeString(job.id),
      owner_key: normalizeString(job.ownerKey),
      customer_id: normalizeString(job.customer && job.customer.id).slice(0, 160),
      website_url: normalizeString(job.websiteUrl).slice(0, 500),
      status: normalizeString(job.status || 'queued').toLowerCase(),
      error: normalizeString(job.error || '').slice(0, 1000) || null,
      payload: buildWebdesignJobPayload(job),
      created_at: toIsoFromMaybeMs(job.createdAt) || isoNow(),
      started_at: toIsoFromMaybeMs(job.startedAt),
      finished_at: toIsoFromMaybeMs(job.finishedAt),
      updated_at: isoNow(),
    };
  }

  function normalizeWebdesignJobRow(row = {}) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      id: normalizeString(row.job_id),
      ownerKey: normalizeString(row.owner_key),
      customer: payload.customer && typeof payload.customer === 'object' ? payload.customer : {},
      websiteUrl: normalizeString(row.website_url),
      status: normalizeString(row.status || 'queued').toLowerCase(),
      error: normalizeString(row.error || ''),
      createdAt: toMsFromIso(row.created_at) || Date.now(),
      startedAt: toMsFromIso(row.started_at),
      finishedAt: toMsFromIso(row.finished_at),
      retry: normalizeWebdesignJobRetryPayload(payload.retry),
      batchId: normalizeString(payload.batchId || ''),
      batchTargetIndex: Number.isFinite(Number(payload.batchTargetIndex))
        ? Math.max(0, Math.floor(Number(payload.batchTargetIndex)))
        : null,
    };
  }

  const WEBDESIGN_BATCH_KIND = 'bulk_webdesign_batch';
  const WEBDESIGN_BATCH_CHUNK_KIND = 'bulk_webdesign_chunk';
  const WEBDESIGN_BATCH_CUSTOMER_ID = '__bulk_batch__';
  const WEBDESIGN_BATCH_CHUNK_CUSTOMER_PREFIX = '__bulk_chunk__:';

  function normalizeWebdesignTableStatus(value, fallback = 'queued') {
    const normalized = normalizeString(value || fallback).toLowerCase();
    return ['queued', 'running', 'done', 'error'].includes(normalized) ? normalized : fallback;
  }

  function buildWebdesignBatchRow(batch = {}) {
    const id = normalizeString(batch.id);
    return {
      job_id: id,
      owner_key: normalizeString(batch.ownerKey),
      customer_id: WEBDESIGN_BATCH_CUSTOMER_ID,
      website_url: `https://softora.local/webdesign-bulk/${encodeURIComponent(id || 'batch')}`,
      status: normalizeWebdesignTableStatus(batch.status, 'queued'),
      error: normalizeString(batch.error || '').slice(0, 1000) || null,
      payload: {
        kind: WEBDESIGN_BATCH_KIND,
        batch: {
          id,
          total: Math.max(0, Math.floor(Number(batch.total || 0) || 0)),
          expectedChunks: Math.max(0, Math.floor(Number(batch.expectedChunks || 0) || 0)),
          uploadedTargets: Math.max(0, Math.floor(Number(batch.uploadedTargets || 0) || 0)),
          summary: batch.summary && typeof batch.summary === 'object' ? batch.summary : {},
          lastError: normalizeString(batch.lastError || '').slice(0, 500),
        },
      },
      created_at: toIsoFromMaybeMs(batch.createdAt) || isoNow(),
      started_at: toIsoFromMaybeMs(batch.startedAt),
      finished_at: toIsoFromMaybeMs(batch.finishedAt),
      updated_at: isoNow(),
    };
  }

  function normalizeWebdesignBatchRow(row = {}) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const batch = payload.batch && typeof payload.batch === 'object' ? payload.batch : {};
    return {
      id: normalizeString(row.job_id || batch.id),
      ownerKey: normalizeString(row.owner_key),
      status: normalizeWebdesignTableStatus(row.status, 'queued'),
      error: normalizeString(row.error || ''),
      total: Math.max(0, Math.floor(Number(batch.total || 0) || 0)),
      expectedChunks: Math.max(0, Math.floor(Number(batch.expectedChunks || 0) || 0)),
      uploadedTargets: Math.max(0, Math.floor(Number(batch.uploadedTargets || 0) || 0)),
      summary: batch.summary && typeof batch.summary === 'object' ? batch.summary : {},
      lastError: normalizeString(batch.lastError || ''),
      createdAt: toMsFromIso(row.created_at) || Date.now(),
      startedAt: toMsFromIso(row.started_at),
      finishedAt: toMsFromIso(row.finished_at),
    };
  }

  function buildWebdesignBatchChunkCustomerId(batchId) {
    return `${WEBDESIGN_BATCH_CHUNK_CUSTOMER_PREFIX}${normalizeString(batchId).slice(0, 140)}`;
  }

  function normalizeWebdesignBatchTargets(targets) {
    return (Array.isArray(targets) ? targets : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        index: Math.max(0, Math.floor(Number(item.index || 0) || 0)),
        status: normalizeString(item.status || 'pending').toLowerCase() || 'pending',
        jobId: normalizeString(item.jobId || '').slice(0, 160),
        error: normalizeString(item.error || '').slice(0, 500),
        attempts: Math.max(0, Math.floor(Number(item.attempts || 0) || 0)),
        nextAttemptAt: Math.max(0, Number(item.nextAttemptAt || 0) || 0) || null,
        updatedAt: Math.max(0, Number(item.updatedAt || 0) || 0) || null,
        finishedAt: Math.max(0, Number(item.finishedAt || 0) || 0) || null,
        websiteUrl: normalizeString(item.websiteUrl || '').slice(0, 500),
        customer: item.customer && typeof item.customer === 'object' ? item.customer : {},
      }));
  }

  function buildWebdesignBatchChunkRow(chunk = {}) {
    const batchId = normalizeString(chunk.batchId);
    const index = Math.max(0, Math.floor(Number(chunk.index || 0) || 0));
    const id = normalizeString(chunk.id || `${batchId}_chunk_${String(index).padStart(5, '0')}`);
    return {
      job_id: id,
      owner_key: normalizeString(chunk.ownerKey),
      customer_id: buildWebdesignBatchChunkCustomerId(batchId),
      website_url: `https://softora.local/webdesign-bulk/${encodeURIComponent(batchId || 'batch')}/chunks/${index}`,
      status: normalizeWebdesignTableStatus(chunk.status, 'queued'),
      error: normalizeString(chunk.error || '').slice(0, 1000) || null,
      payload: {
        kind: WEBDESIGN_BATCH_CHUNK_KIND,
        batchId,
        index,
        targets: normalizeWebdesignBatchTargets(chunk.targets),
      },
      created_at: toIsoFromMaybeMs(chunk.createdAt) || isoNow(),
      started_at: null,
      finished_at: toIsoFromMaybeMs(chunk.finishedAt),
      updated_at: isoNow(),
    };
  }

  function normalizeWebdesignBatchChunkRow(row = {}) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      id: normalizeString(row.job_id),
      ownerKey: normalizeString(row.owner_key),
      batchId: normalizeString(payload.batchId || ''),
      index: Math.max(0, Math.floor(Number(payload.index || 0) || 0)),
      status: normalizeWebdesignTableStatus(row.status, 'queued'),
      error: normalizeString(row.error || ''),
      targets: normalizeWebdesignBatchTargets(payload.targets),
      createdAt: toMsFromIso(row.created_at) || Date.now(),
      finishedAt: toMsFromIso(row.finished_at),
    };
  }

  function isRegularWebdesignJobRow(row = {}) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return payload.kind !== WEBDESIGN_BATCH_KIND && payload.kind !== WEBDESIGN_BATCH_CHUNK_KIND;
  }

  async function upsertWebdesignJob(job) {
    const row = buildWebdesignJobRow(job);
    if (!row.job_id || !row.owner_key) {
      return { ok: false, unavailable: false, error: new Error('Ongeldige webdesign-job') };
    }
    return run(
      'upsert-webdesign-job',
      (client) => client.from(TABLES.webdesignJobs).upsert(row, { onConflict: 'job_id' }),
      getWriteOperationOptions()
    );
  }

  async function upsertWebdesignBatch(batch) {
    const row = buildWebdesignBatchRow(batch);
    if (!row.job_id || !row.owner_key) {
      return { ok: false, unavailable: false, error: new Error('Ongeldige webdesign-batch') };
    }
    return run(
      'upsert-webdesign-batch',
      (client) => client.from(TABLES.webdesignJobs).upsert(row, { onConflict: 'job_id' }),
      getWriteOperationOptions()
    );
  }

  async function upsertWebdesignBatchChunk(chunk) {
    const row = buildWebdesignBatchChunkRow(chunk);
    if (!row.job_id || !row.owner_key || !row.payload.batchId) {
      return { ok: false, unavailable: false, error: new Error('Ongeldige webdesign-batchchunk') };
    }
    return run(
      'upsert-webdesign-batch-chunk',
      (client) => client.from(TABLES.webdesignJobs).upsert(row, { onConflict: 'job_id' }),
      getWriteOperationOptions()
    );
  }

  function createWebdesignJobStatusReadError(result = {}) {
    const sourceError = result.error || {};
    const message =
      normalizeString(sourceError.message || sourceError.details || sourceError.hint) ||
      'Webdesign-jobstatus tijdelijk niet bereikbaar.';
    const error = new Error(message);
    error.code = normalizeString(sourceError.code) || 'WEBDESIGN_JOB_STATUS_UNAVAILABLE';
    error.statusCode = 503;
    error.webdesignJobStatusUnavailable = true;
    error.unavailable = Boolean(result.unavailable);
    if (sourceError && typeof sourceError === 'object') error.cause = sourceError;
    return error;
  }

  async function getWebdesignJob(jobId) {
    const result = await run('get-webdesign-job', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('job_id', normalizeString(jobId))
        .maybeSingle()
    );
    if (!result.ok) throw createWebdesignJobStatusReadError(result);
    if (!result.data || !isRegularWebdesignJobRow(result.data)) return null;
    return normalizeWebdesignJobRow(result.data);
  }

  async function getWebdesignBatch(ownerKey, batchId) {
    const result = await run('get-webdesign-batch', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('job_id', normalizeString(batchId))
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', WEBDESIGN_BATCH_CUSTOMER_ID)
        .maybeSingle()
    );
    if (!result.ok) throw createWebdesignJobStatusReadError(result);
    if (!result.data) return null;
    return normalizeWebdesignBatchRow(result.data);
  }

  async function listWebdesignBatchChunks(ownerKey, batchId) {
    const result = await run('list-webdesign-batch-chunks', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', buildWebdesignBatchChunkCustomerId(batchId))
        .order('created_at', { ascending: true })
        .limit(10000)
    );
    if (!result.ok) throw createWebdesignJobStatusReadError(result);
    return (result.data || []).map(normalizeWebdesignBatchChunkRow).sort((left, right) => left.index - right.index);
  }

  async function findRunningWebdesignJob(ownerKey, customerId) {
    const result = await run('find-running-webdesign-job', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', normalizeString(customerId))
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    if (!result.ok || !result.data || !isRegularWebdesignJobRow(result.data)) return null;
    return normalizeWebdesignJobRow(result.data);
  }

  async function listVisibleWebdesignBatches(ownerKey) {
    const result = await run('list-webdesign-batches', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', WEBDESIGN_BATCH_CUSTOMER_ID)
        .in('status', ['queued', 'running', 'done', 'error'])
        .order('created_at', { ascending: false })
        .limit(5)
    );
    if (!result.ok) return null;
    return (result.data || []).map(normalizeWebdesignBatchRow);
  }

  async function listRunnableWebdesignBatches(limit = 5) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
    const result = await run('list-runnable-webdesign-batches', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('customer_id', WEBDESIGN_BATCH_CUSTOMER_ID)
        .eq('status', 'running')
        .order('updated_at', { ascending: true })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (result.data || []).map(normalizeWebdesignBatchRow);
  }

  async function listVisibleWebdesignJobs(ownerKey) {
    const result = await run('list-webdesign-jobs', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: true })
        .limit(5000)
    );
    if (!result.ok) return null;
    return (result.data || []).filter(isRegularWebdesignJobRow).map(normalizeWebdesignJobRow);
  }

  return {
    findRunningWebdesignJob,
    getDataOpsCounts,
    getWebdesignBatch,
    getWebdesignJob,
    listRunnableWebdesignBatches,
    deleteDesignPhotos,
    listCustomerSnapshotRows,
    listDesignPhotoAssetFlags,
    listActiveOrders,
    listCustomers,
    listDesignPhotosWithDataUrls,
    listDesignPhotosWithSignedUrls,
    listOutboundRecipientGuardKeys,
    listOutboundRecipientGuardsForPreview,
    listVisibleWebdesignBatches,
    listVisibleWebdesignJobs,
    listWebdesignBatchChunks,
    listOrderRuntime,
    deleteCustomers,
    getReadFailureCooldownStatus,
    replaceActiveOrders,
    replaceCustomers,
    replaceDesignPhotos,
    replaceOrderRuntime,
    uploadDesignPhoto,
    upsertDesignPhotos,
    upsertWebdesignBatch,
    upsertWebdesignBatchChunk,
    upsertWebdesignJob,
  };
}

module.exports = {
  TABLES,
  createSoftoraDataOpsStore,
};
