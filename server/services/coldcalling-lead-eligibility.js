const { normalizeLeadLikePhoneKey } = require('./lead-identity');

const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const BLOCKED_DATABASE_STATUSES = new Set([
  'mailcampagne',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeSearchText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCompactStatus(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function normalizeDatabaseContactStatus(value) {
  const compact = normalizeCompactStatus(value);
  if (!compact) return '';

  if (['interesse', 'interested', 'geinteresseerd'].includes(compact)) return 'interesse';
  if (['afspraak', 'appointment', 'meeting', 'ingepland'].includes(compact)) return 'afspraak';
  if (['klant', 'customer', 'betaald'].includes(compact)) return 'klant';
  if (['afgehaakt', 'geendeal', 'nodeal', 'lost'].includes(compact)) return 'afgehaakt';
  if (
    [
      'geblokkeerd',
      'geeninteresse',
      'geenbehoefte',
      'uitbellijst',
      'donotcall',
      'dnc',
      'blocked',
    ].includes(compact)
  ) {
    return 'geblokkeerd';
  }
  if (
    [
      'buiten',
      'buitengebruik',
      'buitendienst',
      'invalid',
      'invalidnumber',
      'notconnected',
      'disconnected',
    ].includes(compact)
  ) {
    return 'buiten';
  }
  if (['benaderbaar', 'prospect', 'open', 'gebeld', 'geengehoor', 'gemaild'].includes(compact)) {
    return compact;
  }
  return compact;
}

function getStatusLabel(status) {
  const labels = {
    mailcampagne: 'Actieve mailcampagne',
    interesse: 'Interesse',
    afspraak: 'Afspraak',
    klant: 'Klant',
    afgehaakt: 'Afgehaakt',
    geblokkeerd: 'Geen interesse',
    buiten: 'Buiten gebruik',
  };
  return labels[status] || status || 'Onbekend';
}

function parseTimestampMs(value) {
  const raw = normalizeString(value);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRowInActiveColdmailCampaign(row) {
  if (!row || typeof row !== 'object') return false;
  const explicitUntilMs = Math.max(
    parseTimestampMs(row.activeColdmailCampaignUntil),
    parseTimestampMs(row.coldmailCampaignEndsAt),
    parseTimestampMs(row.mailCampaignEndsAt),
    parseTimestampMs(row.mailCampaignUntil)
  );
  if (explicitUntilMs > Date.now()) return true;

  const startedAtMs = Math.max(parseTimestampMs(row.coldmailCampaignStartedAt), parseTimestampMs(row.lastColdmailSentAt));
  if (!startedAtMs) return false;
  const durationDays = Number(row.coldmailCampaignDurationDays || row.mailCampaignDurationDays || 0);
  if (!Number.isFinite(durationDays) || durationDays <= 0) return false;
  return startedAtMs + durationDays * 24 * 60 * 60 * 1000 > Date.now();
}

function isPremiumCustomerListRecord(row) {
  if (!row || typeof row !== 'object') return false;
  const databaseStatus = normalizeDatabaseContactStatus(row?.databaseStatus || '');
  if (databaseStatus === 'klant') return true;
  if (databaseStatus) return false;

  const status = normalizeCompactStatus(row?.status || '');
  if (!['open', 'betaald'].includes(status)) return false;

  return Boolean(
    normalizeString(row?.type || '') ||
      Object.prototype.hasOwnProperty.call(row, 'websiteBedrag') ||
      Object.prototype.hasOwnProperty.call(row, 'onderhoudPerMaand') ||
      Object.prototype.hasOwnProperty.call(row, 'bedrag') ||
      Object.prototype.hasOwnProperty.call(row, 'review') ||
      normalizeString(row?.id || '').startsWith('klant-')
  );
}

function isPremiumActiveOrderRecord(row) {
  if (!row || typeof row !== 'object') return false;
  const hasIdentity = Boolean(
    normalizeString(row?.companyName || row?.clientName || row?.contactName || '') ||
      normalizeString(row?.contactPhone || row?.phone || '')
  );
  if (!hasIdentity) return false;
  return Boolean(
    normalizeString(row?.title || '') ||
      normalizeString(row?.description || '') ||
      Object.prototype.hasOwnProperty.call(row, 'sourceAppointmentId') ||
      Object.prototype.hasOwnProperty.call(row, 'sourceCallId')
  );
}

function getLeadPhoneKey(lead) {
  return (
    normalizeLeadLikePhoneKey(lead?.phoneE164 || '') ||
    normalizeLeadLikePhoneKey(lead?.phone || '') ||
    normalizeLeadLikePhoneKey(lead?.tel || '') ||
    normalizeLeadLikePhoneKey(lead?.telefoon || '') ||
    normalizeLeadLikePhoneKey(lead?.contactPhone || '')
  );
}

function getDatabasePhoneKey(row) {
  return (
    normalizeLeadLikePhoneKey(row?.phoneE164 || '') ||
    normalizeLeadLikePhoneKey(row?.phone || '') ||
    normalizeLeadLikePhoneKey(row?.tel || '') ||
    normalizeLeadLikePhoneKey(row?.telefoon || '') ||
    normalizeLeadLikePhoneKey(row?.contactPhone || '')
  );
}

function getLeadCompanyKey(lead) {
  return normalizeSearchText(lead?.company || lead?.bedrijf || lead?.name || lead?.naam || '');
}

function getDatabaseCompanyKey(row) {
  return normalizeSearchText(
    row?.bedrijf || row?.company || row?.companyName || row?.clientName || row?.naam || row?.name || ''
  );
}

function parseCustomerDatabaseRowsFromUiState(values = {}, key = DEFAULT_CUSTOMER_DB_KEY) {
  const raw = values && typeof values === 'object' ? values[key] : null;
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function createBlockedContact(record, matchedBy) {
  let status = isPremiumActiveOrderRecord(record)
    ? 'klant'
    : isPremiumCustomerListRecord(record)
      ? 'klant'
      : normalizeDatabaseContactStatus(record?.databaseStatus || record?.status || record?.type || '');
  if (isRowInActiveColdmailCampaign(record)) {
    status = 'mailcampagne';
  }
  const activeValue = normalizeCompactStatus(record?.actief ?? record?.active ?? record?.isActive ?? '');
  if (['nee', 'no', 'false', '0', 'inactive'].includes(activeValue)) {
    status = 'buiten';
  }
  if (!BLOCKED_DATABASE_STATUSES.has(status)) return null;

  return {
    status,
    statusLabel: getStatusLabel(status),
    matchedBy,
    company: normalizeString(
      record?.bedrijf || record?.company || record?.companyName || record?.clientName || record?.naam || record?.name
    ),
    phone: normalizeString(record?.phone || record?.tel || record?.telefoon || record?.contactPhone),
  };
}

function buildColdcallingDatabaseEligibilityIndex(customerRows = []) {
  const byPhone = new Map();
  const byCompany = new Map();

  (Array.isArray(customerRows) ? customerRows : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;

    const phoneKey = getDatabasePhoneKey(row);
    const companyKey = getDatabaseCompanyKey(row);
    const phoneBlock = createBlockedContact(row, 'phone');
    const companyBlock = createBlockedContact(row, 'company');

    if (phoneKey && phoneBlock && !byPhone.has(phoneKey)) byPhone.set(phoneKey, phoneBlock);
    if (companyKey && companyBlock && !byCompany.has(companyKey)) byCompany.set(companyKey, companyBlock);
  });

  return { byPhone, byCompany };
}

function findColdcallingBlockForLead(lead, eligibilityIndex) {
  if (!lead || !eligibilityIndex) return null;

  const phoneKey = getLeadPhoneKey(lead);
  if (phoneKey && eligibilityIndex.byPhone instanceof Map) {
    const phoneBlock = eligibilityIndex.byPhone.get(phoneKey);
    if (phoneBlock) return phoneBlock;
  }

  const companyKey = getLeadCompanyKey(lead);
  if (companyKey && eligibilityIndex.byCompany instanceof Map) {
    const companyBlock = eligibilityIndex.byCompany.get(companyKey);
    if (companyBlock) return companyBlock;
  }

  return null;
}

function buildSkippedColdcallingResult(lead, index, block) {
  const company = normalizeString(lead?.company || lead?.bedrijf || lead?.name || lead?.naam);
  const statusLabel = normalizeString(block?.statusLabel || getStatusLabel(block?.status));

  return {
    index,
    success: false,
    skipped: true,
    cause: 'database_blocked',
    causeExplanation: `Deze lead staat in de database met status "${statusLabel}" en wordt daarom niet opnieuw benaderd.`,
    error: `Lead overgeslagen: database-status ${statusLabel}.`,
    lead: {
      name: normalizeString(lead?.name || lead?.naam),
      company,
      phone: normalizeString(lead?.phone || lead?.tel || lead?.telefoon || lead?.contactPhone),
      region: normalizeString(lead?.region || lead?.regio),
      phoneE164: normalizeString(lead?.phoneE164 || ''),
    },
    details: {
      databaseStatus: normalizeString(block?.status),
      databaseStatusLabel: statusLabel,
      matchedBy: normalizeString(block?.matchedBy),
      databaseCompany: normalizeString(block?.company),
      databasePhone: normalizeString(block?.phone),
    },
  };
}

function filterColdcallingLeadsByDatabaseStatus(leads = [], customerRows = []) {
  const eligibilityIndex = buildColdcallingDatabaseEligibilityIndex(customerRows);
  const allowed = [];
  const skippedResults = [];

  (Array.isArray(leads) ? leads : []).forEach((lead, index) => {
    const block = findColdcallingBlockForLead(lead, eligibilityIndex);
    if (block) {
      skippedResults.push(buildSkippedColdcallingResult(lead, index, block));
      return;
    }
    allowed.push({ lead, index });
  });

  return {
    allowed,
    skippedResults,
    skipped: skippedResults.length,
  };
}

function countSkippedColdcallingResults(results = []) {
  return (Array.isArray(results) ? results : []).filter((item) => item && item.skipped === true).length;
}

function countStartedColdcallingResults(results = []) {
  return (Array.isArray(results) ? results : []).filter((item) => item && item.success === true).length;
}

function countFailedColdcallingResults(results = []) {
  return (Array.isArray(results) ? results : []).filter(
    (item) => item && item.success !== true && item.skipped !== true
  ).length;
}

module.exports = {
  BLOCKED_DATABASE_STATUSES,
  buildColdcallingDatabaseEligibilityIndex,
  countFailedColdcallingResults,
  countSkippedColdcallingResults,
  countStartedColdcallingResults,
  filterColdcallingLeadsByDatabaseStatus,
  findColdcallingBlockForLead,
  normalizeDatabaseContactStatus,
  parseCustomerDatabaseRowsFromUiState,
};
