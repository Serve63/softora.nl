const { normalizeContactStatus } = require('./customer-lifecycle');
const {
  getIdentityKeyRows,
} = require('./outbound-recipient-guard-store');

const SNAPSHOT_SOURCE = 'structured-mail-ready-snapshot';
const COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;
const SNAPSHOT_CACHE_TTL_MS = 60 * 1000;
const SNAPSHOT_STALE_TTL_MS = 5 * 60 * 1000;
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
  const status = getRowStatus(row);
  if (EXCLUDED_STATUSES.has(status)) return false;
  if (isColdmailTestCompany(row)) return false;
  if (!isLikelyColdmailAddress(getRowEmail(row))) return false;
  if (hasExplicitMailBlock(row)) return false;
  if (rowHasInstantlySignal(row)) return false;
  if (rowHasColdmailSentSignal(row)) return false;
  return Boolean(photoFlag.hasPhoto && photoFlag.hasMockup);
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

function createUnavailableError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function createPremiumDatabaseMailReadySnapshotService(deps = {}) {
  const {
    dataOpsStore = null,
    getUiStateValues = null,
    now = () => new Date(),
    nowMs = () => Date.now(),
    logger = console,
  } = deps;
  let snapshotDataCache = null;
  let snapshotDataPromise = null;

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
    const customerRows = customerResult.rows;
    const customersMs = customerResult.ms;
    if (!Array.isArray(customerRows)) {
      throw createUnavailableError('Mailklare snapshot kon klantdata niet laden.');
    }
    const photoRows = photoResult.rows;
    const photosMs = photoResult.ms;
    if (!Array.isArray(photoRows)) {
      throw createUnavailableError('Mailklare snapshot kon foto- en mockupdata niet laden.');
    }
    const photoMaps = buildPhotoFlagMaps(photoRows);

    const computeStartMs = Date.now();
    const basicCandidates = customerRows
      .map((row) => ({ row, photoFlag: getPhotoFlagForCustomer(row, photoMaps) }))
      .filter((item) => isBasicMailReadyCandidate(item.row, item.photoFlag));
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
    const mailReadyRows = basicCandidates
      .filter((item) => !buildGuardKeysForRow(item.row).some((key) => blockedGuardKeys.has(key)))
      .map((item) => buildSnapshotCustomer(item.row, item.photoFlag));
    const computeMs = computeBeforeGuardsMs + (Date.now() - finalComputeStartMs);
    return {
      generatedAt: now().toISOString(),
      customers: mailReadyRows,
      timings: {
        customersMs,
        photosMs,
        guardsMs,
        computeMs,
        totalMs: Date.now() - startedAtMs,
      },
    };
  }

  async function getMailReadySnapshotData() {
    const cachedAtMs = Number(snapshotDataCache && snapshotDataCache.cachedAtMs) || 0;
    const cacheAgeMs = snapshotDataCache ? nowMs() - cachedAtMs : Number.POSITIVE_INFINITY;
    if (snapshotDataCache && cacheAgeMs < SNAPSHOT_CACHE_TTL_MS) return snapshotDataCache.data;
    if (!snapshotDataPromise) {
      snapshotDataPromise = loadMailReadySnapshotData()
        .then((data) => {
          snapshotDataCache = { cachedAtMs: nowMs(), data };
          return data;
        })
        .finally(() => {
          snapshotDataPromise = null;
        });
    }
    if (snapshotDataCache && cacheAgeMs < SNAPSHOT_STALE_TTL_MS) {
      snapshotDataPromise.catch((error) => {
        if (logger && typeof logger.warn === 'function') logger.warn('[PremiumDatabaseMailReadySnapshot][refresh]', error?.message || error);
      });
      return snapshotDataCache.data;
    }
    return snapshotDataPromise;
  }

  async function buildMailReadySnapshot(options = {}) {
    const limit = parsePositiveInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parsePositiveInt(options.offset, 0, 0, MAX_OFFSET);
    const snapshotData = await getMailReadySnapshotData();
    const allCustomers = Array.isArray(snapshotData.customers) ? snapshotData.customers : [];
    return {
      ok: true,
      source: SNAPSHOT_SOURCE,
      generatedAt: snapshotData.generatedAt,
      total: allCustomers.length,
      limit,
      offset,
      customers: allCustomers.slice(offset, offset + limit),
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
    sendMailReadySnapshotResponse,
  };
}

module.exports = {
  COLDMAIL_SEND_GUARD_KEY,
  COLDMAIL_SEND_GUARD_SCOPE,
  SNAPSHOT_SOURCE,
  buildGuardKeysForRow,
  createPremiumDatabaseMailReadySnapshotService,
  isBasicMailReadyCandidate,
  legacyGuardEntriesToKeySet,
};
