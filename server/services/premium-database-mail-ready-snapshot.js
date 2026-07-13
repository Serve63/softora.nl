const { normalizeContactStatus } = require('./customer-lifecycle');
const {
  getIdentityKeyRows,
} = require('./outbound-recipient-guard-store');

const SNAPSHOT_SOURCE = 'structured-mail-ready-snapshot';
const MAIL_READY_SNAPSHOT_CACHE_SCOPE = 'premium_database_mail_ready_snapshot_cache';
const MAIL_READY_SNAPSHOT_CACHE_KEY = 'softora_premium_database_mail_ready_snapshot_v1';
const MAIL_READY_BOOTSTRAP_CACHE_SCOPE = 'premium_database_mail_ready_bootstrap_cache';
const MAIL_READY_BOOTSTRAP_CACHE_KEY = 'softora_premium_database_mail_ready_bootstrap_v1';
const MAIL_READY_BOOTSTRAP_ROW_LIMIT = 100;
const COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 3000;
const MAX_OFFSET = 10000;
const SNAPSHOT_CACHE_TTL_MS = 60 * 1000;
const SNAPSHOT_CACHE_VALUE_MAX_LENGTH = 950000;
const SNAPSHOT_FORMAT_VERSION = 2;
const EXCLUDED_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);
const COLDMAIL_TEST_COMPANIES = new Set(['mcv e-commerce', 'softora testmodus']);

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeEmailAddress(value) {
  const raw = normalizeString(value)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
  return (match ? match[0] : raw)
    .replace(/[<>()"[\]]/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

function isLikelyColdmailAddress(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmailAddress(value));
}

function normalizeCompanyKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getRowPayload(row = {}) {
  return row && row.payload && typeof row.payload === 'object' ? row.payload : {};
}

function pickRowValue(row = {}, keys = []) {
  const payload = getRowPayload(row);
  for (const key of keys) {
    const direct = normalizeString(row && row[key]);
    if (direct) return direct;
    const fromPayload = normalizeString(payload && payload[key]);
    if (fromPayload) return fromPayload;
  }
  return '';
}

function getRowId(row = {}) {
  return pickRowValue(row, ['id', 'customerId', 'customer_id', 'databaseId']);
}

function getRowCompany(row = {}) {
  return pickRowValue(row, ['bedrijf', 'company', 'companyName', 'company_name']) || 'Onbekend bedrijf';
}

function getRowContactName(row = {}) {
  return pickRowValue(row, ['naam', 'contact', 'contactName', 'contact_name', 'clientName']) || getRowCompany(row);
}

function getRowEmail(row = {}) {
  return normalizeEmailAddress(pickRowValue(row, ['email', 'contactEmail']));
}

function getRowPhone(row = {}) {
  return pickRowValue(row, ['telefoon', 'tel', 'phone', 'contactPhone']);
}

function getRowWebsite(row = {}) {
  return pickRowValue(row, ['website', 'dom', 'domain', 'url', 'site']);
}

function getRowAddress(row = {}) {
  return pickRowValue(row, ['adres', 'address', 'location', 'plaats', 'stad', 'city']);
}

function getRowStatus(row = {}) {
  return normalizeContactStatus(
    pickRowValue(row, ['databaseStatus', 'database_status', 'status', 'lifecycle_status']),
    row
  ) || 'prospect';
}

function getRowUpdatedAt(row = {}) {
  return pickRowValue(row, ['updatedAt', 'updated', 'updated_at', 'datum', 'paidAt']);
}

function dedupeCustomerRows(rows = []) {
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = getRowId(row);
    if (!id) return;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, row);
      return;
    }
    const currentUpdatedAt = Date.parse(getRowUpdatedAt(current)) || 0;
    const nextUpdatedAt = Date.parse(getRowUpdatedAt(row)) || 0;
    if (nextUpdatedAt > currentUpdatedAt) byId.set(id, row);
  });
  return Array.from(byId.values());
}

function isColdmailTestCompany(row = {}) {
  return COLDMAIL_TEST_COMPANIES.has(normalizeCompanyKey(getRowCompany(row)));
}

function rowHasInstantlySignal(row = {}) {
  const payload = getRowPayload(row);
  const text = normalizeString([
    row.lastColdmailProvider,
    row.outreachProvider,
    row.provider,
    row.instantlyLeadId,
    row.instantlyStatus,
    payload.lastColdmailProvider,
    payload.outreachProvider,
    payload.provider,
    payload.instantlyLeadId,
    payload.instantlyStatus,
    ...(Array.isArray(payload.hist)
      ? payload.hist.map((entry) => [entry && entry.type, entry && entry.label, entry && entry.source].join(' '))
      : []),
  ].join(' ')).toLowerCase();
  return /\binstantly\b/.test(text);
}

function rowHasColdmailSentSignal(row = {}) {
  const payload = getRowPayload(row);
  const status = getRowStatus(row);
  if (status === 'gemaild') return true;
  const timestampFields = [
    row.lastColdmailSentAt,
    row.lastMailSentAt,
    row.outreachSentAt,
    row.lastInstantlySentAt,
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
    row.coldmailSentMessageId,
    row.outreachMessageId,
    row.sentMessageId,
    payload.coldmailSentMessageId,
    payload.outreachMessageId,
    payload.sentMessageId,
    payload.messageId,
  ];
  if (messageFields.some((value) => normalizeString(value))) return true;
  const history = Array.isArray(payload.hist) ? payload.hist : [];
  return history.some((entry) => {
    const text = normalizeString([
      entry && entry.type,
      entry && entry.label,
      entry && entry.title,
      entry && entry.note,
      entry && entry.description,
      entry && entry.source,
    ].join(' ')).toLowerCase();
    return /\b(gemaild|mail verstuurd|coldmail|cold mailing|email sent|instantly)\b/.test(text);
  });
}

function rowHasColdcallingSignal(row = {}) {
  const payload = getRowPayload(row);
  const status = getRowStatus(row);
  if (status === 'gebeld') return true;
  const directText = normalizeString([
    row.coldcallingStatus,
    row.callOutcome,
    row.lastColdcallAt,
    payload.coldcallingStatus,
    payload.coldCallingStatus,
    payload.callOutcome,
    payload.lastCallOutcome,
    payload.lastColdcallAt,
    payload.lastColdCallAt,
    payload.lastCallAt,
  ].join(' ')).toLowerCase();
  if (directText) return true;
  const history = Array.isArray(payload.hist) ? payload.hist : [];
  return history.some((entry) => /\b(gebeld|belpoging|coldcall|cold calling|coldcalling|call|retell|vapi|twilio|telefonisch)\b/.test(normalizeString([
    entry && entry.type,
    entry && entry.status,
    entry && entry.label,
    entry && entry.message,
    entry && entry.title,
    entry && entry.source,
  ].join(' ')).toLowerCase()));
}

function hasExplicitMailBlock(row = {}) {
  const payload = getRowPayload(row);
  return (
    row.mail === false ||
    row.canMail === false ||
    row.doNotMail === true ||
    payload.mail === false ||
    payload.canMail === false ||
    payload.doNotMail === true
  );
}

function normalizePhotoFlag(row = {}) {
  return {
    customerId: normalizeString(row.customerId || row.customer_id || row.id),
    identityKey: normalizeString(row.identityKey || row.identity_key),
    hasPhoto: row.hasPhoto === true || normalizeString(row.storage_path || row.websitePhoto || row.photo) !== '',
    hasMockup:
      row.hasMockup === true ||
      normalizeString(row.websiteMockup || row.mockup || row.websiteMockupImage) !== '',
    updatedAt: normalizeString(row.updatedAt || row.updated_at),
  };
}

function buildPhotoFlagMaps(photoRows = []) {
  const byCustomerId = new Map();
  const byIdentityKey = new Map();
  (Array.isArray(photoRows) ? photoRows : []).map(normalizePhotoFlag).forEach((flag) => {
    if (!flag.customerId && !flag.identityKey) return;
    if (flag.customerId && !byCustomerId.has(flag.customerId)) byCustomerId.set(flag.customerId, flag);
    if (flag.identityKey && !byIdentityKey.has(flag.identityKey)) byIdentityKey.set(flag.identityKey, flag);
  });
  return { byCustomerId, byIdentityKey };
}

function getPhotoFlagForCustomer(row = {}, photoMaps) {
  const id = getRowId(row);
  const identityKey = normalizeString(row.identityKey || row.identity_key);
  return (
    (id && photoMaps.byCustomerId.get(id)) ||
    (identityKey && photoMaps.byIdentityKey.get(identityKey)) ||
    normalizePhotoFlag(row)
  );
}

function buildGuardIdentity(row = {}) {
  return {
    recipientEmail: getRowEmail(row),
    recipientDomain: getRowWebsite(row),
    recipientCompanyKey: getRowCompany(row),
    recipientId: getRowId(row),
    recipientCompany: getRowCompany(row),
  };
}

function buildGuardKeysForRow(row = {}) {
  return getIdentityKeyRows(buildGuardIdentity(row), normalizeString).map((item) => item.guardKey);
}

function parseColdmailGuardPayload(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function parseMailReadySnapshotCacheValue(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.customers)) return null;
    const customers = parsed.customers
      .filter((customer) => customer && typeof customer === 'object' && normalizeString(customer.id))
      .slice(0, MAX_LIMIT);
    const availableCustomers = (Array.isArray(parsed.availableCustomers) ? parsed.availableCustomers : [])
      .filter((customer) => customer && typeof customer === 'object' && normalizeString(customer.id))
      .slice(0, MAX_LIMIT);
    if (!customers.length && !availableCustomers.length) return null;
    return {
      version: Math.max(1, Number(parsed.version) || 1),
      generatedAt: normalizeString(parsed.generatedAt),
      total: Math.max(customers.length, Number(parsed.total) || 0),
      customers,
      availableTotal: Math.max(availableCustomers.length, Number(parsed.availableTotal) || 0),
      availableCustomers,
      timings: parsed.timings && typeof parsed.timings === 'object' ? parsed.timings : {},
    };
  } catch (_error) {
    return null;
  }
}

function serializeMailReadySnapshotCache(data = {}, rowLimit = MAX_LIMIT) {
  const customers = (Array.isArray(data.customers) ? data.customers : [])
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Number(rowLimit) || MAX_LIMIT)));
  const availableCustomers = (Array.isArray(data.availableCustomers) ? data.availableCustomers : [])
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Number(rowLimit) || MAX_LIMIT)));
  if (!customers.length && !availableCustomers.length) return '';
  return JSON.stringify({
    version: SNAPSHOT_FORMAT_VERSION,
    generatedAt: normalizeString(data.generatedAt),
    total: Math.max(customers.length, Number(data.total) || (Array.isArray(data.customers) ? data.customers.length : 0)),
    customers,
    availableTotal: Math.max(availableCustomers.length, Number(data.availableTotal) || (Array.isArray(data.availableCustomers) ? data.availableCustomers.length : 0)),
    availableCustomers,
    timings: data.timings && typeof data.timings === 'object' ? data.timings : {},
  });
}

function normalizeLegacyGuardEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const recipientEmail = normalizeEmailAddress(entry.recipientEmail);
  const recipientDomain = normalizeString(entry.recipientDomain)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const recipientId = normalizeString(entry.recipientId)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const recipientKey = normalizeString(entry.recipientKey);
  if (!recipientKey && !recipientEmail && !recipientDomain && !recipientId) return null;
  return { recipientKey, recipientEmail, recipientDomain, recipientId };
}

function legacyGuardEntriesToKeySet(entries = []) {
  const keys = new Set();
  (Array.isArray(entries) ? entries : []).map(normalizeLegacyGuardEntry).filter(Boolean).forEach((entry) => {
    if (entry.recipientKey) keys.add(entry.recipientKey);
    if (entry.recipientEmail) keys.add(`email:${entry.recipientEmail}`);
    if (entry.recipientDomain) keys.add(`domain:${entry.recipientDomain}`);
    if (entry.recipientId) keys.add(`id:${entry.recipientId}`);
  });
  return keys;
}

async function readLegacyColdmailGuardKeys(getUiStateValues, logger) {
  if (typeof getUiStateValues !== 'function') return new Set();
  try {
    const state = await getUiStateValues(COLDMAIL_SEND_GUARD_SCOPE);
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const payload = parseColdmailGuardPayload(values[COLDMAIL_SEND_GUARD_KEY]);
    const entries = []
      .concat(Array.isArray(payload.recipientEntries) ? payload.recipientEntries : [])
      .concat(Array.isArray(payload.entries) ? payload.entries : []);
    return legacyGuardEntriesToKeySet(entries);
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[PremiumDatabaseMailReadySnapshot][legacy-guard]', error?.message || error);
    }
    return null;
  }
}

function isBasicMailReadyCandidate(row = {}, photoFlag = {}) {
  return isBasicMailLeadEligible(row) && Boolean(photoFlag.hasPhoto && photoFlag.hasMockup);
}

function isBasicMailLeadEligible(row = {}) {
  const status = getRowStatus(row);
  if (EXCLUDED_STATUSES.has(status)) return false;
  if (isColdmailTestCompany(row)) return false;
  if (!isLikelyColdmailAddress(getRowEmail(row))) return false;
  if (hasExplicitMailBlock(row)) return false;
  if (rowHasInstantlySignal(row)) return false;
  if (rowHasColdmailSentSignal(row)) return false;
  return true;
}

function buildSnapshotCustomer(row = {}, photoFlag = {}) {
  const id = getRowId(row);
  const company = getRowCompany(row);
  const status = getRowStatus(row);
  return {
    id,
    bedrijf: company,
    naam: getRowContactName(row),
    email: getRowEmail(row),
    telefoon: getRowPhone(row),
    tel: getRowPhone(row),
    website: getRowWebsite(row),
    dom: getRowWebsite(row),
    adres: getRowAddress(row),
    stad: getRowAddress(row),
    status,
    databaseStatus: status,
    verantwoordelijk: pickRowValue(row, ['verantwoordelijk', 'responsible']),
    updatedAt: getRowUpdatedAt(row) || normalizeString(photoFlag.updatedAt),
    hasPhoto: true,
    hasMockup: true,
    websitePhotoAssetReady: true,
    websiteMockupAssetReady: true,
    mailReady: true,
    mailReadySnapshot: true,
  };
}

function buildAvailableSnapshotCustomer(row = {}, photoFlag = {}) {
  const customer = buildSnapshotCustomer(row, photoFlag);
  const hasPhoto = photoFlag && photoFlag.hasPhoto === true;
  const hasMockup = photoFlag && photoFlag.hasMockup === true;
  return {
    ...customer,
    hasPhoto,
    hasMockup,
    websitePhotoAssetReady: hasPhoto,
    websiteMockupAssetReady: hasMockup,
    mailReady: false,
    mailReadySnapshot: false,
    availableSnapshot: true,
  };
}

function enrichSnapshotCustomersWithSignedMedia(customers = [], signedRows = []) {
  const signedByCustomerId = new Map();
  (Array.isArray(signedRows) ? signedRows : []).forEach((row) => {
    const customerId = normalizeString(row && row.customerId);
    if (customerId && !signedByCustomerId.has(customerId)) signedByCustomerId.set(customerId, row);
  });
  return (Array.isArray(customers) ? customers : []).map((customer) => {
    const signed = signedByCustomerId.get(normalizeString(customer && customer.id));
    if (!signed) return customer;
    const websitePhoto = normalizeString(signed.websitePhotoUrl || signed.websitePhoto || signed.photo);
    const websiteMockup = normalizeString(signed.websiteMockupUrl || signed.websiteMockup || signed.mockup);
    return {
      ...customer,
      websitePhoto,
      websitePhotoName: normalizeString(signed.fileName),
      websiteMockup,
      websiteMockupName: normalizeString(signed.websiteMockupName),
      signedUrlExpiresAt: normalizeString(signed.signedUrlExpiresAt),
    };
  });
}

function createUnavailableError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function createPremiumDatabaseMailReadySnapshotService(deps = {}) {
  const {
    dataOpsStore = null,
    getUiStateValues = null,
    setUiStateValues = null,
    now = () => new Date(),
    nowMs = () => Date.now(),
    logger = console,
  } = deps;
  let snapshotDataCache = null;
  let snapshotDataPromise = null;
  let snapshotMediaRefreshPromise = null;
  let durableSnapshotReadPromise = null;
  let snapshotInvalidated = false;

  async function readCustomerRows() {
    if (dataOpsStore && typeof dataOpsStore.listCustomerSnapshotRows === 'function') {
      return dataOpsStore.listCustomerSnapshotRows({
        suppressTransientReadFailureLog: true,
      });
    }
    if (dataOpsStore && typeof dataOpsStore.listCustomers === 'function') {
      return dataOpsStore.listCustomers({
        suppressTransientReadFailureLog: true,
      });
    }
    return null;
  }

  async function readPhotoFlags() {
    if (dataOpsStore && typeof dataOpsStore.listDesignPhotoAssetFlags === 'function') {
      return dataOpsStore.listDesignPhotoAssetFlags({
        suppressTransientReadFailureLog: true,
      });
    }
    return [];
  }

  async function readBootstrapSignedMedia(customerIds) {
    if (!dataOpsStore || typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function') return [];
    try {
      const rows = await dataOpsStore.listDesignPhotosWithSignedUrls({
        customerIds,
        maxMatches: customerIds.length,
        expiresInSeconds: 24 * 60 * 60,
        bypassReadCache: true,
        bypassReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
        suppressReadFailureCooldown: true,
      });
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][signed-media]', error?.message || error);
      }
      return [];
    }
  }

  async function readCentralGuardKeys(keys) {
    if (!dataOpsStore || typeof dataOpsStore.listOutboundRecipientGuardKeys !== 'function') return new Set();
    try {
      const rows = await dataOpsStore.listOutboundRecipientGuardKeys(keys, {
        suppressTransientReadFailureLog: true,
      });
      if (!Array.isArray(rows)) return null;
      return new Set(rows);
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][central-guard]', error?.message || error);
      }
      return null;
    }
  }

  async function loadMailReadySnapshotData() {
    const startedAtMs = Date.now();
    const customerStartMs = Date.now();
    const customerRowsPromise = readCustomerRows().then((rows) => ({ rows, ms: Date.now() - customerStartMs }));
    const photosStartMs = Date.now();
    const photoRowsPromise = readPhotoFlags().then((rows) => ({ rows, ms: Date.now() - photosStartMs }));
    const [customerResult, photoResult] = await Promise.all([customerRowsPromise, photoRowsPromise]);
    const rawCustomerRows = customerResult.rows;
    const customersMs = customerResult.ms;
    if (!Array.isArray(rawCustomerRows)) {
      throw createUnavailableError('Mailklare snapshot kon klantdata niet laden.');
    }
    const customerRows = dedupeCustomerRows(rawCustomerRows);
    const photoRows = photoResult.rows;
    const photosMs = photoResult.ms;
    if (!Array.isArray(photoRows)) {
      throw createUnavailableError('Mailklare snapshot kon foto- en mockupdata niet laden.');
    }
    const photoMaps = buildPhotoFlagMaps(photoRows);

    const computeStartMs = Date.now();
    const basicCandidates = customerRows
      .map((row) => ({ row, photoFlag: getPhotoFlagForCustomer(row, photoMaps) }))
      .filter((item) => isBasicMailLeadEligible(item.row));
    const guardKeys = Array.from(new Set(basicCandidates.flatMap((item) => buildGuardKeysForRow(item.row))));
    const computeBeforeGuardsMs = Date.now() - computeStartMs;

    const guardsStartMs = Date.now();
    const [centralGuardKeys, legacyGuardKeys] = await Promise.all([
      readCentralGuardKeys(guardKeys),
      readLegacyColdmailGuardKeys(getUiStateValues, logger),
    ]);
    const guardsMs = Date.now() - guardsStartMs;
    if (centralGuardKeys === null || legacyGuardKeys === null) {
      throw createUnavailableError('Mailklare snapshot kon verzendbeveiliging niet laden.');
    }

    const blockedGuardKeys = new Set([...centralGuardKeys, ...legacyGuardKeys]);
    const finalComputeStartMs = Date.now();
    const unguardedCandidates = basicCandidates
      .filter((item) => !buildGuardKeysForRow(item.row).some((key) => blockedGuardKeys.has(key)));
    let mailReadyRows = unguardedCandidates
      .filter((item) => isBasicMailReadyCandidate(item.row, item.photoFlag))
      .map((item) => buildSnapshotCustomer(item.row, item.photoFlag));
    let availableRows = unguardedCandidates
      .filter((item) => !rowHasColdcallingSignal(item.row))
      .filter((item) => !isBasicMailReadyCandidate(item.row, item.photoFlag))
      .map((item) => buildAvailableSnapshotCustomer(item.row, item.photoFlag));
    const computeMs = computeBeforeGuardsMs + (Date.now() - finalComputeStartMs);
    const mediaStartMs = Date.now();
    const bootstrapCustomerIds = Array.from(new Set(
      mailReadyRows.slice(0, MAIL_READY_BOOTSTRAP_ROW_LIMIT)
        .concat(availableRows.slice(0, MAIL_READY_BOOTSTRAP_ROW_LIMIT))
        .map((customer) => normalizeString(customer && customer.id))
        .filter(Boolean)
    ));
    const signedMediaRows = await readBootstrapSignedMedia(bootstrapCustomerIds);
    mailReadyRows = enrichSnapshotCustomersWithSignedMedia(mailReadyRows, signedMediaRows);
    availableRows = enrichSnapshotCustomersWithSignedMedia(availableRows, signedMediaRows);
    const mediaMs = Date.now() - mediaStartMs;
    return {
      generatedAt: now().toISOString(),
      customers: mailReadyRows,
      availableCustomers: availableRows,
      timings: {
        customersMs,
        photosMs,
        guardsMs,
        mediaMs,
        computeMs,
        totalMs: Date.now() - startedAtMs,
      },
    };
  }

  async function readDurableSnapshotData() {
    if (typeof getUiStateValues !== 'function') return null;
    try {
      const state = await getUiStateValues(MAIL_READY_SNAPSHOT_CACHE_SCOPE, {
        uiStateReadTimeoutMs: 1200,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
        readFailureCooldownScope: MAIL_READY_SNAPSHOT_CACHE_SCOPE,
      });
      const values = state && state.values && typeof state.values === 'object' ? state.values : {};
      return parseMailReadySnapshotCacheValue(values[MAIL_READY_SNAPSHOT_CACHE_KEY]);
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][durable-read]', error?.message || error);
      }
      return null;
    }
  }

  async function persistDurableSnapshotData(data) {
    if (typeof setUiStateValues !== 'function') return false;
    const snapshotData = {
      ...data,
      total: Array.isArray(data && data.customers) ? data.customers.length : 0,
      availableTotal: Array.isArray(data && data.availableCustomers) ? data.availableCustomers.length : 0,
    };
    const fullValue = serializeMailReadySnapshotCache(snapshotData, MAX_LIMIT);
    const bootstrapValue = serializeMailReadySnapshotCache(snapshotData, MAIL_READY_BOOTSTRAP_ROW_LIMIT);
    if (!fullValue || !bootstrapValue || fullValue.length > SNAPSHOT_CACHE_VALUE_MAX_LENGTH) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][durable-write]', `Snapshotcache ongeldig of te groot (${fullValue.length} tekens).`);
      }
      return false;
    }
    try {
      const [fullSaved, bootstrapSaved] = await Promise.all([
        setUiStateValues(
          MAIL_READY_SNAPSHOT_CACHE_SCOPE,
          { [MAIL_READY_SNAPSHOT_CACHE_KEY]: fullValue },
          { source: 'premium-database-mail-ready-snapshot', replaceMissing: true }
        ),
        setUiStateValues(
          MAIL_READY_BOOTSTRAP_CACHE_SCOPE,
          { [MAIL_READY_BOOTSTRAP_CACHE_KEY]: bootstrapValue },
          { source: 'premium-database-mail-ready-snapshot', replaceMissing: true }
        ),
      ]);
      return Boolean(fullSaved && bootstrapSaved);
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][durable-write]', error?.message || error);
      }
      return false;
    }
  }

  function getBootstrapSnapshotCustomers(data = {}) {
    return (Array.isArray(data.customers) ? data.customers : [])
      .slice(0, MAIL_READY_BOOTSTRAP_ROW_LIMIT)
      .concat((Array.isArray(data.availableCustomers) ? data.availableCustomers : []).slice(0, MAIL_READY_BOOTSTRAP_ROW_LIMIT));
  }

  function snapshotNeedsBootstrapSignedMedia(data = {}) {
    return getBootstrapSnapshotCustomers(data).some((customer) => {
      const needsPhoto = customer && (customer.hasPhoto === true || customer.websitePhotoAssetReady === true);
      const needsMockup = customer && (customer.hasMockup === true || customer.websiteMockupAssetReady === true);
      return (needsPhoto && !normalizeString(customer.websitePhoto)) ||
        (needsMockup && !normalizeString(customer.websiteMockup));
    });
  }

  function countBootstrapSignedMedia(data = {}) {
    return getBootstrapSnapshotCustomers(data).reduce((count, customer) => (
      count + (normalizeString(customer && customer.websitePhoto) ? 1 : 0) +
      (normalizeString(customer && customer.websiteMockup) ? 1 : 0)
    ), 0);
  }

  function startSnapshotMediaRefresh(data) {
    if (snapshotMediaRefreshPromise) return snapshotMediaRefreshPromise;
    const startedAtMs = Date.now();
    const customerIds = Array.from(new Set(
      getBootstrapSnapshotCustomers(data)
        .map((customer) => normalizeString(customer && customer.id))
        .filter(Boolean)
    ));
    snapshotMediaRefreshPromise = readBootstrapSignedMedia(customerIds)
      .then(async (signedRows) => {
        if (!signedRows.length) return data;
        const enriched = {
          ...data,
          version: SNAPSHOT_FORMAT_VERSION,
          customers: enrichSnapshotCustomersWithSignedMedia(data.customers, signedRows),
          availableCustomers: enrichSnapshotCustomersWithSignedMedia(data.availableCustomers, signedRows),
          timings: {
            ...(data.timings && typeof data.timings === 'object' ? data.timings : {}),
            mediaRefreshMs: Date.now() - startedAtMs,
          },
        };
        if (countBootstrapSignedMedia(enriched) <= countBootstrapSignedMedia(data)) return data;
        await persistDurableSnapshotData(enriched);
        snapshotDataCache = { cachedAtMs: nowMs(), data: enriched };
        return enriched;
      })
      .finally(() => {
        snapshotMediaRefreshPromise = null;
      });
    return snapshotMediaRefreshPromise;
  }

  function startSnapshotRefresh() {
    if (!snapshotDataPromise) {
      snapshotDataPromise = loadMailReadySnapshotData()
        .then(async (data) => {
          await persistDurableSnapshotData(data);
          snapshotDataCache = { cachedAtMs: nowMs(), data };
          snapshotInvalidated = false;
          return data;
        })
        .finally(() => {
          snapshotDataPromise = null;
        });
    }
    return snapshotDataPromise;
  }

  async function hydrateDurableSnapshotData() {
    if (snapshotDataCache) return snapshotDataCache.data;
    if (!durableSnapshotReadPromise) {
      durableSnapshotReadPromise = readDurableSnapshotData().finally(() => {
        durableSnapshotReadPromise = null;
      });
    }
    const data = await durableSnapshotReadPromise;
    if (!data) return null;
    const generatedAtMs = Date.parse(normalizeString(data.generatedAt));
    snapshotDataCache = {
      cachedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : nowMs(),
      data,
    };
    return data;
  }

  async function getMailReadySnapshotData() {
    if (snapshotInvalidated) return startSnapshotRefresh();
    if (!snapshotDataCache) await hydrateDurableSnapshotData();
    if (snapshotDataCache && snapshotNeedsBootstrapSignedMedia(snapshotDataCache.data)) {
      startSnapshotMediaRefresh(snapshotDataCache.data).catch((error) => {
        if (logger && typeof logger.warn === 'function') logger.warn('[PremiumDatabaseMailReadySnapshot][media-refresh]', error?.message || error);
      });
    }
    const cachedAtMs = Number(snapshotDataCache && snapshotDataCache.cachedAtMs) || 0;
    const cacheAgeMs = snapshotDataCache ? nowMs() - cachedAtMs : Number.POSITIVE_INFINITY;
    if (snapshotDataCache && cacheAgeMs < SNAPSHOT_CACHE_TTL_MS) return snapshotDataCache.data;
    const refreshPromise = startSnapshotRefresh();
    if (snapshotDataCache) {
      refreshPromise.catch((error) => {
        if (logger && typeof logger.warn === 'function') logger.warn('[PremiumDatabaseMailReadySnapshot][refresh]', error?.message || error);
      });
      return snapshotDataCache.data;
    }
    return refreshPromise;
  }

  function invalidate() {
    snapshotInvalidated = true;
    snapshotDataCache = null;
    durableSnapshotReadPromise = null;
  }

  async function buildMailReadySnapshot(options = {}) {
    const limit = parsePositiveInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parsePositiveInt(options.offset, 0, 0, MAX_OFFSET);
    const snapshotData = await getMailReadySnapshotData();
    const allCustomers = Array.isArray(snapshotData.customers) ? snapshotData.customers : [];
    const allAvailableCustomers = Array.isArray(snapshotData.availableCustomers) ? snapshotData.availableCustomers : [];
    return {
      ok: true,
      source: SNAPSHOT_SOURCE,
      generatedAt: snapshotData.generatedAt,
      total: allCustomers.length,
      limit,
      offset,
      customers: allCustomers.slice(offset, offset + limit),
      availableTotal: allAvailableCustomers.length,
      availableCustomers: allAvailableCustomers.slice(offset, offset + limit),
      timings: snapshotData.timings,
    };
  }

  async function sendMailReadySnapshotResponse(req, res) {
    try {
      const payload = await buildMailReadySnapshot({
        limit: req && req.query ? req.query.limit : undefined,
        offset: req && req.query ? req.query.offset : undefined,
      });
      res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
      return res.status(200).json(payload);
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500;
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[PremiumDatabaseMailReadySnapshot][response]', error?.message || error);
      }
      return res.status(statusCode).json({
        ok: false,
        source: SNAPSHOT_SOURCE,
        error: truncateText(error && error.message ? error.message : 'Mailklare snapshot kon niet laden.', 240),
        detail: truncateText(error && error.message ? error.message : 'Mailklare snapshot kon niet laden.', 240),
      });
    }
  }

  return {
    buildMailReadySnapshot,
    invalidate,
    sendMailReadySnapshotResponse,
  };
}

module.exports = {
  COLDMAIL_SEND_GUARD_KEY,
  COLDMAIL_SEND_GUARD_SCOPE,
  MAIL_READY_BOOTSTRAP_CACHE_KEY,
  MAIL_READY_BOOTSTRAP_CACHE_SCOPE,
  MAIL_READY_BOOTSTRAP_ROW_LIMIT,
  MAIL_READY_SNAPSHOT_CACHE_KEY,
  MAIL_READY_SNAPSHOT_CACHE_SCOPE,
  SNAPSHOT_SOURCE,
  buildGuardKeysForRow,
  createPremiumDatabaseMailReadySnapshotService,
  isBasicMailReadyCandidate,
  isBasicMailLeadEligible,
  legacyGuardEntriesToKeySet,
  parseMailReadySnapshotCacheValue,
};
