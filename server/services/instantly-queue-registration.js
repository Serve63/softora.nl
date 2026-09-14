const { createHash } = require('node:crypto');
const { normalizeContactStatus } = require('./customer-lifecycle');

const MAX_INSTANTLY_QUEUE_BATCH_SIZE = 200;
const INSTANTLY_QUEUE_STATUS_REGISTERED = 'registered';
const INSTANTLY_QUEUE_STATUS_DESIGN_PENDING = 'design_pending';
const INSTANTLY_QUEUE_SOURCE = 'instantly-sheet-registration';
const FINAL_OUTREACH_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function createRegistrationError(message, code, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
}

function normalizeEmail(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[.,;:!?]+$/g, '');
}

function isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(value));
}

function normalizeWebsite(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function getWebsiteDomain(value) {
  const website = normalizeWebsite(value);
  if (!website) return '';
  return new URL(website).hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeRegistrationRow(raw = {}, index = 0) {
  const bedrijf = normalizeString(raw.bedrijf || raw.company || raw.companyName);
  const adres = normalizeString(raw.adres || raw.address);
  const website = normalizeWebsite(raw.website || raw.url || raw.domain);
  const email = normalizeEmail(raw.email || raw.mail);
  const telefoon = normalizeString(raw.telefoon || raw.tel || raw.phone);
  const sheetRow = Math.max(2, Number.parseInt(String(raw.sheetRow || index + 2), 10) || index + 2);
  const missing = [];
  if (!bedrijf) missing.push('Bedrijf');
  if (!adres) missing.push('Adres');
  if (!website) missing.push('Website');
  if (!isValidEmail(email)) missing.push('E-mail');
  if (!telefoon) missing.push('Telefoon');
  if (missing.length) {
    throw createRegistrationError(
      `Sheetregel ${sheetRow} mist geldige verplichte gegevens: ${missing.join(', ')}.`,
      'INSTANTLY_QUEUE_ROW_INVALID',
      400,
      { sheetRow, missing }
    );
  }
  return { bedrijf, adres, website, email, telefoon, sheetRow };
}

function hasActualInstantlyOutreach(row = {}) {
  if (normalizeString(row.lastColdmailProvider).toLowerCase() === 'instantly') return true;
  return Boolean(normalizeString(
    row.instantlyLeadId ||
      row.instantlyCampaignId ||
      row.instantlyStatus ||
      row.instantlySyncedAt ||
      row.instantlyLastEventAt ||
      row.instantlyEmailSentAt
  ));
}

function historyHasPriorOutbound(row = {}) {
  return (Array.isArray(row.hist) ? row.hist : []).some((entry) => {
    const text = normalizeString([
      entry && entry.type,
      entry && entry.status,
      entry && entry.label,
      entry && entry.source,
      entry && entry.actor,
    ].join(' ')).toLowerCase();
    return /\b(gemaild|mail verstuurd|email sent|coldmail|cold mailing|instantly)\b/.test(text);
  });
}

function hasPriorNonInstantlyOutbound(row = {}) {
  if (!row || typeof row !== 'object' || hasActualInstantlyOutreach(row)) return false;
  const status = normalizeContactStatus(row.databaseStatus || row.status, row);
  if (FINAL_OUTREACH_STATUSES.has(status)) return true;
  const provider = normalizeString(row.lastColdmailProvider).toLowerCase();
  if (provider && provider !== 'instantly') return true;
  if (normalizeString(
    row.lastColdmailSentAt ||
      row.lastMailSentAt ||
      row.outreachSentAt ||
      row.outreach_sent_at ||
      row.coldmailSentMessageId ||
      row.outreachMessageId ||
      row.sentMessageId ||
      row.messageId
  )) return true;
  return historyHasPriorOutbound(row);
}

function buildStableCustomerId(email) {
  const digest = createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 24);
  return `instantly_queue_${digest}`;
}

function buildQueueCustomer(lead, existing, metadata) {
  const current = existing && typeof existing === 'object' ? existing : {};
  const nowIso = metadata.nowIso;
  const currentStatus = normalizeContactStatus(current.databaseStatus || current.status, current) || 'prospect';
  const id = normalizeString(current.id) || buildStableCustomerId(lead.email);
  return {
    ...current,
    id,
    bedrijf: lead.bedrijf,
    naam: normalizeString(current.naam || current.contactName) || lead.bedrijf,
    adres: lead.adres,
    stad: lead.adres,
    website: lead.website,
    dom: getWebsiteDomain(lead.website),
    email: lead.email,
    telefoon: lead.telefoon,
    tel: lead.telefoon,
    status: currentStatus,
    databaseStatus: currentStatus,
    verantwoordelijk: normalizeString(current.verantwoordelijk || current.responsible) || 'Team',
    service: normalizeString(current.service) || 'website',
    instantlyQueueStatus: INSTANTLY_QUEUE_STATUS_REGISTERED,
    instantlyQueueRegisteredAt: normalizeString(current.instantlyQueueRegisteredAt) || nowIso,
    instantlyQueueUpdatedAt: nowIso,
    instantlyQueueSource: metadata.sourceId,
    instantlyQueueFileDigest: metadata.fileDigest,
    instantlyQueueTotalRows: metadata.totalRows,
    instantlyQueueSheetRow: lead.sheetRow,
    updatedAt: nowIso,
  };
}

function validateBatchMetadata(input, rowCount) {
  const sourceId = normalizeString(input.sourceId).slice(0, 120);
  const fileDigest = normalizeString(input.fileDigest).toLowerCase();
  const totalRows = Number.parseInt(String(input.totalRows || ''), 10);
  const batchIndex = Number.parseInt(String(input.batchIndex ?? ''), 10);
  const batchCount = Number.parseInt(String(input.batchCount || ''), 10);
  if (!sourceId || !/^[a-z0-9][a-z0-9._:-]{2,119}$/i.test(sourceId)) {
    throw createRegistrationError('Een geldige bron-ID ontbreekt.', 'INSTANTLY_QUEUE_SOURCE_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(fileDigest)) {
    throw createRegistrationError('De SHA-256 vingerafdruk van het bronbestand ontbreekt.', 'INSTANTLY_QUEUE_DIGEST_INVALID');
  }
  if (!Number.isInteger(totalRows) || totalRows < rowCount || totalRows > 25000) {
    throw createRegistrationError('Het totale aantal sheetregels is ongeldig.', 'INSTANTLY_QUEUE_TOTAL_INVALID');
  }
  if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > Math.ceil(25000 / MAX_INSTANTLY_QUEUE_BATCH_SIZE)) {
    throw createRegistrationError('Het aantal batches is ongeldig.', 'INSTANTLY_QUEUE_BATCH_COUNT_INVALID');
  }
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= batchCount) {
    throw createRegistrationError('De batchpositie is ongeldig.', 'INSTANTLY_QUEUE_BATCH_INDEX_INVALID');
  }
  return { sourceId, fileDigest, totalRows, batchIndex, batchCount };
}

function validateDesignStageMetadata(input, rowCount) {
  const sourceId = normalizeString(input.sourceId).slice(0, 120);
  const fileDigest = normalizeString(input.fileDigest).toLowerCase();
  if (!sourceId || !/^[a-z0-9][a-z0-9._:-]{2,119}$/i.test(sourceId)) {
    throw createRegistrationError('Een geldige bron-ID ontbreekt.', 'INSTANTLY_QUEUE_SOURCE_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(fileDigest)) {
    throw createRegistrationError('De SHA-256 vingerafdruk van het bronbestand ontbreekt.', 'INSTANTLY_QUEUE_DIGEST_INVALID');
  }
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_INSTANTLY_QUEUE_BATCH_SIZE) {
    throw createRegistrationError(
      `Gebruik per ontwerpbatch 1 tot ${MAX_INSTANTLY_QUEUE_BATCH_SIZE} e-mailadressen.`,
      'INSTANTLY_QUEUE_BATCH_SIZE_INVALID'
    );
  }
  return { sourceId, fileDigest };
}

function createInstantlyQueueRegistrationService(deps = {}) {
  const {
    dataOpsStore = null,
    mailReadySnapshotService = null,
    now = () => new Date(),
  } = deps;

  async function refreshMailReadyInventory() {
    if (
      !mailReadySnapshotService ||
      typeof mailReadySnapshotService.invalidate !== 'function' ||
      typeof mailReadySnapshotService.buildMailReadySnapshot !== 'function'
    ) {
      throw createRegistrationError(
        'De Mailklaar-voorraad kan tijdelijk niet veilig worden ververst.',
        'INSTANTLY_QUEUE_INVENTORY_REFRESH_UNAVAILABLE',
        503
      );
    }
    mailReadySnapshotService.invalidate();
    try {
      const snapshot = await mailReadySnapshotService.buildMailReadySnapshot({
        limit: 1,
        offset: 0,
        includeFoundSnapshot: true,
        allowStaleWhileRefreshing: false,
      });
      return {
        generatedAt: normalizeString(snapshot && snapshot.generatedAt),
        snapshotVersion: normalizeString(snapshot && snapshot.snapshotVersion),
        mailReadyTotal: Math.max(0, Number(snapshot && snapshot.total) || 0),
        availableTotal: Math.max(0, Number(snapshot && snapshot.availableTotal) || 0),
      };
    } catch (error) {
      throw createRegistrationError(
        'De ontwerpvoorraad is opgeslagen, maar de Mailklaar-weergave kon niet worden ververst.',
        'INSTANTLY_QUEUE_INVENTORY_REFRESH_FAILED',
        503
      );
    }
  }

  async function registerBatch(input = {}) {
    const rawRows = Array.isArray(input.rows) ? input.rows : [];
    if (!rawRows.length || rawRows.length > MAX_INSTANTLY_QUEUE_BATCH_SIZE) {
      throw createRegistrationError(
        `Gebruik per registratiebatch 1 tot ${MAX_INSTANTLY_QUEUE_BATCH_SIZE} bedrijven.`,
        'INSTANTLY_QUEUE_BATCH_SIZE_INVALID'
      );
    }
    if (!dataOpsStore || typeof dataOpsStore.listUniqueCustomersByEmails !== 'function' || typeof dataOpsStore.upsertCustomers !== 'function') {
      throw createRegistrationError('De centrale klantopslag is tijdelijk niet beschikbaar.', 'INSTANTLY_QUEUE_STORE_UNAVAILABLE', 503);
    }
    const metadata = validateBatchMetadata(input, rawRows.length);
    const rows = rawRows.map(normalizeRegistrationRow);
    const uniqueEmails = new Set(rows.map((row) => row.email));
    if (uniqueEmails.size !== rows.length) {
      throw createRegistrationError('Deze batch bevat dubbele e-mailadressen.', 'INSTANTLY_QUEUE_DUPLICATE_EMAIL', 409);
    }
    const existingRows = await dataOpsStore.listUniqueCustomersByEmails({
      emails: rows.map((row) => row.email),
      bypassReadCache: true,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(existingRows)) {
      throw createRegistrationError(
        'Bestaande klanten konden niet uniek op e-mailadres worden gecontroleerd.',
        'INSTANTLY_QUEUE_EXACT_LOOKUP_FAILED',
        503
      );
    }
    const existingByEmail = new Map(existingRows.map((row) => [normalizeEmail(row.email), row]));
    const conflicts = rows.flatMap((lead) => {
      const existing = existingByEmail.get(lead.email);
      if (!existing || !hasPriorNonInstantlyOutbound(existing)) return [];
      return [{
        sheetRow: lead.sheetRow,
        email: lead.email,
        bedrijf: lead.bedrijf,
        customerId: normalizeString(existing.id),
        status: normalizeContactStatus(existing.databaseStatus || existing.status, existing),
        provider: normalizeString(existing.lastColdmailProvider),
      }];
    });
    if (conflicts.length) {
      throw createRegistrationError(
        `${conflicts.length} bedrijven in deze batch hebben al ander outbound-verleden.`,
        'INSTANTLY_QUEUE_OUTREACH_CONFLICT',
        409,
        { conflicts: conflicts.slice(0, 25), conflictCount: conflicts.length }
      );
    }
    const nowIso = now().toISOString();
    const queueRows = [];
    const identityRows = [];
    let alreadyTransferred = 0;
    let inserted = 0;
    let updated = 0;
    rows.forEach((lead) => {
      const existing = existingByEmail.get(lead.email);
      if (existing && hasActualInstantlyOutreach(existing)) {
        alreadyTransferred += 1;
        return;
      }
      const customer = buildQueueCustomer(lead, existing, { ...metadata, nowIso });
      queueRows.push(customer);
      identityRows.push({
        key_type: 'email',
        key_value: lead.email,
        customer_id: customer.id,
        source: INSTANTLY_QUEUE_SOURCE,
      });
      if (existing) updated += 1;
      else inserted += 1;
    });
    if (queueRows.length) {
      const saved = await dataOpsStore.upsertCustomers(queueRows, { source: INSTANTLY_QUEUE_SOURCE });
      if (!saved || saved.ok === false) {
        throw createRegistrationError('Instantly-wachtrij kon niet worden opgeslagen.', 'INSTANTLY_QUEUE_WRITE_FAILED', 502);
      }
      if (typeof dataOpsStore.upsertCustomerIdentityKeys === 'function') {
        const identityWrite = await dataOpsStore.upsertCustomerIdentityKeys(identityRows, { source: INSTANTLY_QUEUE_SOURCE });
        if (!identityWrite || identityWrite.ok === false) {
          throw createRegistrationError('Instantly-wachtrij is opgeslagen, maar de identiteitspoort niet.', 'INSTANTLY_QUEUE_IDENTITY_WRITE_FAILED', 502);
        }
      }
    }
    return {
      ok: true,
      status: INSTANTLY_QUEUE_STATUS_REGISTERED,
      processed: rows.length,
      registered: queueRows.length,
      inserted,
      updated,
      alreadyTransferred,
      sourceId: metadata.sourceId,
      fileDigest: metadata.fileDigest,
      totalRows: metadata.totalRows,
      batchIndex: metadata.batchIndex,
      batchCount: metadata.batchCount,
    };
  }

  async function stageDesignBatch(input = {}) {
    const emails = Array.from(new Set((Array.isArray(input.emails) ? input.emails : []).map(normalizeEmail).filter(isValidEmail)));
    const metadata = validateDesignStageMetadata(input, emails.length);
    if (!dataOpsStore || typeof dataOpsStore.listUniqueCustomersByEmails !== 'function' || typeof dataOpsStore.upsertCustomers !== 'function') {
      throw createRegistrationError('De centrale klantopslag is tijdelijk niet beschikbaar.', 'INSTANTLY_QUEUE_STORE_UNAVAILABLE', 503);
    }
    const existingRows = await dataOpsStore.listUniqueCustomersByEmails({
      emails,
      bypassReadCache: true,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(existingRows) || existingRows.length !== emails.length) {
      throw createRegistrationError(
        'De volledige geregistreerde ontwerpbatch kon niet uniek worden gecontroleerd.',
        'INSTANTLY_QUEUE_EXACT_LOOKUP_FAILED',
        503
      );
    }
    const byEmail = new Map(existingRows.map((row) => [normalizeEmail(row.email), row]));
    const mismatches = emails.filter((email) => {
      const row = byEmail.get(email) || {};
      const status = normalizeString(row.instantlyQueueStatus).toLowerCase();
      return (
        !row.id ||
        normalizeString(row.instantlyQueueSource) !== metadata.sourceId ||
        normalizeString(row.instantlyQueueFileDigest).toLowerCase() !== metadata.fileDigest ||
        ![INSTANTLY_QUEUE_STATUS_REGISTERED, INSTANTLY_QUEUE_STATUS_DESIGN_PENDING].includes(status) ||
        hasActualInstantlyOutreach(row)
      );
    });
    if (mismatches.length) {
      throw createRegistrationError(
        `${mismatches.length} bedrijven horen niet bij de exacte geregistreerde ontwerpbron.`,
        'INSTANTLY_QUEUE_DESIGN_STAGE_CONFLICT',
        409,
        { conflictCount: mismatches.length }
      );
    }
    const nowIso = now().toISOString();
    const updates = existingRows
      .filter((row) => normalizeString(row.instantlyQueueStatus).toLowerCase() !== INSTANTLY_QUEUE_STATUS_DESIGN_PENDING)
      .map((row) => ({
        ...row,
        instantlyQueueStatus: INSTANTLY_QUEUE_STATUS_DESIGN_PENDING,
        instantlyDesignStagedAt: normalizeString(row.instantlyDesignStagedAt) || nowIso,
        instantlyQueueUpdatedAt: nowIso,
        updatedAt: nowIso,
      }));
    if (updates.length) {
      const saved = await dataOpsStore.upsertCustomers(updates, { source: 'instantly-design-staging' });
      if (!saved || saved.ok === false) {
        throw createRegistrationError('Ontwerpbatch kon niet worden opgeslagen.', 'INSTANTLY_QUEUE_WRITE_FAILED', 502);
      }
    }
    const inventory = input.refreshInventory === true
      ? await refreshMailReadyInventory()
      : null;
    return {
      ok: true,
      status: INSTANTLY_QUEUE_STATUS_DESIGN_PENDING,
      processed: emails.length,
      staged: updates.length,
      alreadyStaged: emails.length - updates.length,
      sourceId: metadata.sourceId,
      fileDigest: metadata.fileDigest,
      ...(inventory ? { inventory } : {}),
    };
  }

  return { registerBatch, stageDesignBatch };
}

module.exports = {
  INSTANTLY_QUEUE_SOURCE,
  INSTANTLY_QUEUE_STATUS_DESIGN_PENDING,
  INSTANTLY_QUEUE_STATUS_REGISTERED,
  MAX_INSTANTLY_QUEUE_BATCH_SIZE,
  createInstantlyQueueRegistrationService,
  hasActualInstantlyOutreach,
  hasPriorNonInstantlyOutbound,
  normalizeRegistrationRow,
};
