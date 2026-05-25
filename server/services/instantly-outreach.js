const dns = require('node:dns').promises;
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_API_BASE_URL = 'https://api.instantly.ai/api/v2';
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const DEFAULT_SYNC_BATCH_SIZE = 10;
const DEFAULT_DAILY_CAP = 25;
const STARTUP_SYNC_DELAY_MS = 10_000;
const EXCLUDED_DATABASE_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);
const ACTIVE_INSTANTLY_STATUSES = new Set([
  'queued',
  'synced',
  'sent',
  'opened',
  'reply_received',
  'replied',
  'interested',
  'completed',
]);
const BLOCKING_INSTANTLY_STATUSES = new Set(['bounced', 'unsubscribed', 'blocked']);
const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);
const INSTANTLY_STATUS_PRIORITY = Object.freeze({
  queued: 10,
  synced: 20,
  sent: 30,
  opened: 40,
  completed: 45,
  reply_received: 50,
  replied: 50,
  interested: 60,
  bounced: 70,
  unsubscribed: 80,
  blocked: 80,
});

function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function normalizeMailboxAccountEmail(value) {
  return defaultNormalizeString(value).toLowerCase();
}

function defaultTruncateText(value, maxLength = 500) {
  const text = defaultNormalizeString(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function readBool(value, fallback = false) {
  const normalized = defaultNormalizeString(value);
  if (!normalized) return Boolean(fallback);
  return /^(1|true|yes)$/i.test(normalized);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(safe)));
}

function normalizeEmailAddress(value, normalizeString = defaultNormalizeString) {
  const raw = normalizeString(value)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
  const cleaned = (match ? match[0] : raw)
    .replace(/[<>()"[\]]/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  return normalizeMailboxAccountEmail(cleaned);
}

function isLikelyValidEmail(value, normalizeString = defaultNormalizeString) {
  const email = normalizeEmailAddress(value, normalizeString);
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const index = normalized.lastIndexOf('@');
  return index >= 0 ? normalized.slice(index + 1).replace(/\.+$/g, '') : '';
}

async function resolveEmailDomainWithDns(domain) {
  const value = defaultNormalizeString(domain).toLowerCase();
  if (!value) return false;
  try {
    const mxRecords = await dns.resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) return true;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
  }
  try {
    const addresses = await dns.resolve4(value);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
    return false;
  }
}

function getRowId(row, index, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.id || row.customerId || row.databaseId || '')) || `row-${index}`;
}

function getRowCompany(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.bedrijf || row.company || row.companyName || row.naam || row.name));
}

function getRowContact(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.contact || row.contactName || row.clientName || row.naam));
}

function getRowEmail(row, normalizeString = defaultNormalizeString) {
  return normalizeEmailAddress(row && (row.email || row.contactEmail || row.mail || ''), normalizeString);
}

function getRowPhone(row, normalizeString = defaultNormalizeString) {
  return normalizeString(
    row &&
      (row.phoneE164 ||
        row.phone ||
        row.tel ||
        row.telefoon ||
        row.telefoonnummer ||
        row.mobile ||
        row.contactPhone ||
        '')
  );
}

function getRowWebsite(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.website || row.domain || row.dom || ''));
}

function normalizeInstantlyEventType(value, normalizeString = defaultNormalizeString) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized === 'email_replied' || normalized === 'lead_replied') return 'reply_received';
  if (normalized === 'reply' || normalized === 'replied') return 'reply_received';
  return normalized;
}

function normalizeInstantlyStatus(value, normalizeString = defaultNormalizeString) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized === 'email_sent') return 'sent';
  if (normalized === 'email_opened') return 'opened';
  if (normalized === 'email_bounced') return 'bounced';
  if (normalized === 'lead_unsubscribed') return 'unsubscribed';
  if (normalized === 'lead_interested') return 'interested';
  if (normalized === 'email_replied' || normalized === 'reply_received') return 'reply_received';
  if (normalized === 'campaign_completed') return 'completed';
  return normalized;
}

function chooseInstantlyStatus(currentStatus, nextStatus) {
  const current = normalizeInstantlyStatus(currentStatus);
  const next = normalizeInstantlyStatus(nextStatus);
  if (!current) return next;
  if (!next) return current;
  return (INSTANTLY_STATUS_PRIORITY[next] || 0) >= (INSTANTLY_STATUS_PRIORITY[current] || 0)
    ? next
    : current;
}

function parseDatabaseRows(values = {}, customerDbKey = DEFAULT_CUSTOMER_DB_KEY, normalizeString = defaultNormalizeString) {
  const raw = normalizeString(values && values[customerDbKey]);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
  } catch (_) {
    return [];
  }
}

function buildHistoryEntry({ type, label, actor, source, messageKey, subject, preview }, deps = {}) {
  const normalizeString = deps.normalizeString || defaultNormalizeString;
  const truncateText = deps.truncateText || defaultTruncateText;
  const now = deps.now || (() => new Date());
  return {
    type: normalizeString(type),
    label: normalizeString(label),
    date: now().toISOString(),
    actor: normalizeString(actor) || 'Instantly',
    source: normalizeString(source) || 'instantly-webhook',
    messageKey: normalizeString(messageKey),
    subject: truncateText(subject, 240),
    preview: truncateText(preview, 500),
  };
}

function mergeHistory(row, entry, normalizeString = defaultNormalizeString) {
  const existingHistory = Array.isArray(row && row.hist) ? row.hist.filter(Boolean) : [];
  const messageKey = normalizeString(entry && entry.messageKey);
  const alreadyTracked = messageKey
    ? existingHistory.some((item) => normalizeString(item && item.messageKey) === messageKey)
    : false;
  return (alreadyTracked ? existingHistory : [entry, ...existingHistory]).slice(0, 50);
}

function normalizeInstantlyConfig(config = {}) {
  return {
    enabled: readBool(config.enabled, false),
    schedulerEnabled: readBool(config.schedulerEnabled, false),
    apiKey: defaultNormalizeString(config.apiKey),
    apiBaseUrl: defaultNormalizeString(config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/g, ''),
    defaultCampaignId: defaultNormalizeString(config.defaultCampaignId),
    webhookSecret: defaultNormalizeString(config.webhookSecret),
    intervalMinutes: clampNumber(
      config.intervalMinutes,
      DEFAULT_SYNC_INTERVAL_MINUTES,
      1,
      24 * 60
    ),
    batchSize: clampNumber(config.batchSize, DEFAULT_SYNC_BATCH_SIZE, 1, 1000),
    dailyCap: clampNumber(config.dailyCap, DEFAULT_DAILY_CAP, 1, 1000),
    verifyLeadsOnImport: readBool(config.verifyLeadsOnImport, false),
    blockPersonalMailboxDomains: readBool(config.blockPersonalMailboxDomains, true),
  };
}

function createInstantlyError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function createInstantlyOutreachService(deps = {}) {
  const {
    instantlyConfig = {},
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    resolveEmailDomain = resolveEmailDomainWithDns,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    logger = console,
    now = () => new Date(),
    scheduleTask = (fn, delayMs) => setTimeout(fn, delayMs),
    clearScheduledTask = (timer) => clearTimeout(timer),
  } = deps;

  const config = normalizeInstantlyConfig(instantlyConfig);
  let syncPromise = null;
  let syncTimer = null;
  let nextSyncAt = '';
  let lastSyncResult = null;

  function getMissingConfig() {
    return [
      !config.apiKey ? 'INSTANTLY_API_KEY' : null,
      !config.defaultCampaignId ? 'INSTANTLY_DEFAULT_CAMPAIGN_ID' : null,
    ].filter(Boolean);
  }

  function isConfigured() {
    return getMissingConfig().length === 0;
  }

  function assertConfigured() {
    if (!config.enabled) {
      throw createInstantlyError('Instantly is niet ingeschakeld.', 'INSTANTLY_DISABLED', 503);
    }
    const missing = getMissingConfig();
    if (missing.length) {
      throw createInstantlyError(
        'Instantly is nog niet volledig geconfigureerd.',
        'INSTANTLY_NOT_CONFIGURED',
        503,
        { missing }
      );
    }
  }

  function getDailySyncCount(rows) {
    const today = now().toISOString().slice(0, 10);
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const syncedAt = normalizeString(row && row.instantlySyncedAt);
      return syncedAt.slice(0, 10) === today;
    }).length;
  }

  function isPersonalMailboxDomain(email) {
    const domain = getEmailDomain(email);
    return Boolean(domain && PERSONAL_MAILBOX_DOMAINS.has(domain));
  }

  function hasActiveInstantlyOutreach(row) {
    const status = normalizeInstantlyStatus(row && row.instantlyStatus, normalizeString);
    if (BLOCKING_INSTANTLY_STATUSES.has(status)) return false;
    if (ACTIVE_INSTANTLY_STATUSES.has(status)) return true;
    return Boolean(
      row &&
        (row.instantlySyncedAt ||
          row.instantlyCampaignId ||
          normalizeString(row.lastColdmailProvider).toLowerCase() === 'instantly')
    );
  }

  async function isDeliverableEmail(email) {
    const domain = getEmailDomain(email);
    if (!domain) return false;
    return Boolean(await resolveEmailDomain(domain));
  }

  async function collectEligibleRows(rows, limit) {
    const selectedRows = [];
    const failed = [];

    for (let index = 0; index < rows.length && selectedRows.length < limit; index += 1) {
      const row = rows[index];
      const id = getRowId(row, index, normalizeString);
      const email = getRowEmail(row, normalizeString);
      const company = getRowCompany(row, normalizeString);
      const status = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';

      if (!isLikelyValidEmail(email, normalizeString)) continue;
      if (row.mail === false || row.canMail === false || row.doNotMail === true) continue;
      if (EXCLUDED_DATABASE_STATUSES.has(status)) continue;
      if (hasActiveInstantlyOutreach(row)) continue;
      if (config.blockPersonalMailboxDomains && isPersonalMailboxDomain(email)) {
        failed.push({
          id,
          bedrijf: company,
          email,
          error: `Persoonlijke mailbox overgeslagen voor Instantly: ${getEmailDomain(email)}.`,
        });
        continue;
      }
      if (!(await isDeliverableEmail(email))) {
        failed.push({
          id,
          bedrijf: company,
          email,
          error: `E-maildomein bestaat niet of ontvangt geen mail: ${getEmailDomain(email) || email}.`,
        });
        continue;
      }

      selectedRows.push({ id, index, row });
    }

    return { selectedRows, failed };
  }

  function buildInstantlyLead(item) {
    const row = item.row;
    const email = getRowEmail(row, normalizeString);
    const company = getRowCompany(row, normalizeString);
    const contact = getRowContact(row, normalizeString);
    const nameParts = contact.split(/\s+/).filter(Boolean);
    const firstName = normalizeString(row.firstName || row.voornaam || nameParts[0] || '');
    const lastName = normalizeString(
      row.lastName || row.achternaam || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '')
    );
    const customVariables = {
      softora_customer_id: item.id,
      softora_source: 'softora',
      softora_company: company,
      softora_status: normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect',
    };

    return {
      email,
      first_name: firstName,
      last_name: lastName,
      company_name: company,
      phone: getRowPhone(row, normalizeString),
      website: getRowWebsite(row, normalizeString),
      custom_variables: customVariables,
    };
  }

  function extractInstantlyLeadItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data && data.leads)) return data.leads;
    if (Array.isArray(data && data.created_leads)) return data.created_leads;
    if (Array.isArray(data && data.items)) return data.items;
    if (Array.isArray(data && data.data)) return data.data;
    return [];
  }

  function buildLeadIdByEmail(data) {
    const entries = extractInstantlyLeadItems(data);
    const byEmail = new Map();
    entries.forEach((entry) => {
      const email = normalizeEmailAddress(entry && (entry.email || entry.lead_email), normalizeString);
      const id = normalizeString(entry && (entry.id || entry.lead_id || entry.instantly_lead_id));
      if (email && id) byEmail.set(email, id);
    });
    return byEmail;
  }

  async function addLeadsToInstantly(leads) {
    const { response, data } = await fetchJsonWithTimeout(
      `${config.apiBaseUrl}/leads/add`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          campaign_id: config.defaultCampaignId,
          leads,
          skip_if_in_workspace: true,
          skip_if_in_campaign: true,
          verify_leads_on_import: config.verifyLeadsOnImport,
        }),
      },
      30_000
    );

    if (!response || !response.ok) {
      throw createInstantlyError(
        `Instantly lead-sync mislukt (${response ? response.status : 'geen response'}).`,
        'INSTANTLY_API_FAILED',
        response && response.status ? response.status : 502,
        { data }
      );
    }

    return data;
  }

  function markRowsAsSynced(rows, selectedRows, data, actor) {
    const syncedAt = now().toISOString();
    const leadIdByEmail = buildLeadIdByEmail(data);
    const selectedByIndex = new Map(selectedRows.map((item) => [item.index, item]));
    return rows.map((row, index) => {
      const item = selectedByIndex.get(index);
      if (!item) return row;
      const email = getRowEmail(row, normalizeString);
      const instantlyLeadId = leadIdByEmail.get(email) || normalizeString(row.instantlyLeadId);
      const historyEntry = buildHistoryEntry(
        {
          type: 'instantly_synced',
          label: 'Lead naar Instantly gesynchroniseerd',
          actor,
          source: 'instantly-sync',
          messageKey: `instantly-sync:${config.defaultCampaignId}:${item.id}`,
          subject: 'Instantly sync',
          preview: 'Lead is aan de Instantly-campaign toegevoegd of bestond daar al.',
        },
        { normalizeString, truncateText, now }
      );
      return {
        ...row,
        instantlyLeadId,
        instantlyCampaignId: config.defaultCampaignId,
        instantlyStatus: chooseInstantlyStatus(row.instantlyStatus, 'synced'),
        instantlySyncedAt: normalizeString(row.instantlySyncedAt) || syncedAt,
        instantlyLastEventAt: syncedAt,
        lastColdmailProvider: 'instantly',
        lastColdmailProviderStatus: 'synced',
        updatedAt: syncedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });
  }

  async function syncInstantlyLeads(input = {}) {
    if (syncPromise) return syncPromise;
    syncPromise = syncInstantlyLeadsUnlocked(input);
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function syncInstantlyLeadsUnlocked(input = {}) {
    assertConfigured();

    const actor = normalizeString(input.actor) || 'Instantly sync';
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    const syncedToday = getDailySyncCount(rows);
    const dailyRemaining = Math.max(0, config.dailyCap - syncedToday);
    const requestedLimit = clampNumber(input.limit, config.batchSize, 1, config.batchSize);
    const limit = Math.min(config.batchSize, requestedLimit, dailyRemaining);

    if (limit <= 0) {
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'daily_cap_reached',
        synced: 0,
        syncedToday,
        dailyCap: config.dailyCap,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    const { selectedRows, failed } = await collectEligibleRows(rows, limit);
    if (!selectedRows.length) {
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'no_eligible_leads',
        synced: 0,
        failed,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    const leads = selectedRows.map(buildInstantlyLead);
    const data = await addLeadsToInstantly(leads);
    const nextRows = markRowsAsSynced(rows, selectedRows, data, actor);
    await setUiStateValues(
      customerDbScope,
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
      {
        source: 'instantly-sync',
        actor,
      }
    );

    lastSyncResult = {
      ok: true,
      synced: selectedRows.length,
      failed,
      campaignId: config.defaultCampaignId,
      dailyCap: config.dailyCap,
      syncedToday: syncedToday + selectedRows.length,
      finishedAt: now().toISOString(),
    };
    return lastSyncResult;
  }

  function extractWebhookSecret(req) {
    const getHeader =
      req && typeof req.get === 'function'
        ? (name) => normalizeString(req.get(name))
        : (name) => normalizeString(req && req.headers && req.headers[String(name).toLowerCase()]);
    const bearer = getHeader('authorization').match(/^Bearer\s+(.+)$/i);
    return (
      getHeader('x-instantly-webhook-secret') ||
      getHeader('x-softora-webhook-secret') ||
      getHeader('x-webhook-secret') ||
      (bearer ? normalizeString(bearer[1]) : '')
    );
  }

  function verifyWebhookSecret(req) {
    if (!config.webhookSecret) {
      throw createInstantlyError(
        'Instantly webhook secret ontbreekt op de server.',
        'INSTANTLY_WEBHOOK_SECRET_MISSING',
        503
      );
    }
    if (extractWebhookSecret(req) !== config.webhookSecret) {
      throw createInstantlyError('Instantly webhook secret is ongeldig.', 'INVALID_INSTANTLY_WEBHOOK_SECRET', 403);
    }
  }

  function getWebhookData(body) {
    return body && typeof body === 'object' ? body.data || body.payload || body : {};
  }

  function getWebhookLead(body) {
    const data = getWebhookData(body);
    return data.lead || data.lead_data || body.lead || body.lead_data || data;
  }

  function getCustomVariables(body) {
    const data = getWebhookData(body);
    const lead = getWebhookLead(body);
    const custom =
      lead.custom_variables ||
      lead.customVariables ||
      data.custom_variables ||
      data.customVariables ||
      body.custom_variables ||
      body.customVariables ||
      {};
    return custom && typeof custom === 'object' ? custom : {};
  }

  function normalizeWebhookPayload(body = {}) {
    const data = getWebhookData(body);
    const lead = getWebhookLead(body);
    const customVariables = getCustomVariables(body);
    const eventType = normalizeInstantlyEventType(
      body.event_type || body.eventType || body.type || body.event || data.event_type || data.eventType,
      normalizeString
    );
    const email = normalizeEmailAddress(
      lead.email || data.email || body.email || lead.lead_email || data.lead_email,
      normalizeString
    );
    const leadId = normalizeString(
      lead.id ||
        lead.lead_id ||
        lead.instantly_lead_id ||
        data.lead_id ||
        data.instantly_lead_id ||
        body.lead_id
    );
    const campaignId = normalizeString(
      lead.campaign_id ||
        lead.campaign ||
        data.campaign_id ||
        data.campaign ||
        body.campaign_id ||
        body.campaign
    );
    const customerId = normalizeString(
      customVariables.softora_customer_id ||
        customVariables.customerId ||
        customVariables.customer_id ||
        lead.softora_customer_id ||
        data.softora_customer_id ||
        body.softora_customer_id
    );
    const eventId = normalizeString(body.id || body.event_id || data.id || data.event_id);
    const timestamp = normalizeString(
      body.timestamp || body.created_at || body.createdAt || data.timestamp || data.created_at || data.createdAt
    );

    return {
      eventType,
      eventStatus: normalizeInstantlyStatus(eventType, normalizeString),
      email,
      leadId,
      campaignId,
      customerId,
      eventId,
      timestamp,
      customVariables,
      data,
    };
  }

  function findWebhookRowIndex(rows, event) {
    if (event.customerId) {
      const index = rows.findIndex((row, rowIndex) => getRowId(row, rowIndex, normalizeString) === event.customerId);
      if (index >= 0) return index;
    }
    if (event.leadId) {
      const index = rows.findIndex((row) => normalizeString(row.instantlyLeadId) === event.leadId);
      if (index >= 0) return index;
    }
    if (event.email) {
      const index = rows.findIndex((row) => {
        if (getRowEmail(row, normalizeString) !== event.email) return false;
        const rowCampaignId = normalizeString(row.instantlyCampaignId);
        return !event.campaignId || !rowCampaignId || rowCampaignId === event.campaignId;
      });
      if (index >= 0) return index;
    }
    return -1;
  }

  function buildWebhookMessageKey(event) {
    return [
      'instantly',
      event.eventType || 'event',
      event.eventId || '',
      event.leadId || event.email || event.customerId || '',
      event.timestamp || '',
    ]
      .filter(Boolean)
      .join(':');
  }

  function hasWebhookEvent(row, messageKey) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    return Boolean(
      messageKey &&
        history.some((item) => normalizeString(item && item.messageKey) === normalizeString(messageKey))
    );
  }

  function updateRowFromWebhook(row, event, actor) {
    const date = event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : now().toISOString();
    const messageKey = buildWebhookMessageKey(event);
    const baseFields = {
      instantlyLeadId: event.leadId || normalizeString(row.instantlyLeadId),
      instantlyCampaignId: event.campaignId || normalizeString(row.instantlyCampaignId) || config.defaultCampaignId,
      instantlyStatus: chooseInstantlyStatus(row.instantlyStatus, event.eventStatus),
      instantlyLastEventAt: date,
      lastColdmailProvider: 'instantly',
      lastColdmailProviderStatus: event.eventStatus || event.eventType,
      updatedAt: date,
    };
    const history = (type, label, preview) =>
      mergeHistory(
        row,
        buildHistoryEntry(
          {
            type,
            label,
            actor,
            source: 'instantly-webhook',
            messageKey,
            subject: event.eventType,
            preview,
          },
          { normalizeString, truncateText, now: () => new Date(date) }
        ),
        normalizeString
      );
    const currentStatus = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';

    if (event.eventStatus === 'sent') {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'gemaild') ? 'gemaild' : currentStatus;
      return {
        ...row,
        ...baseFields,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        mail: true,
        lastMailSentAt: date,
        lastColdmailSentAt: date,
        instantlyEmailSentAt: date,
        coldmailCampaignStartedAt: date,
        campaignType: 'webdesign',
        campaign_type: 'webdesign',
        outreachCampaignType: 'webdesign',
        outreach_campaign_type: 'webdesign',
        coldmailSpecialAction: 'webdesign',
        outreachStatus: 'benaderd',
        actionRequired: false,
        outreachActionRequired: false,
        hist: history('gemaild', 'Mail verstuurd via Instantly', 'Instantly bevestigde dat de mail is verzonden.'),
      };
    }

    if (event.eventStatus === 'opened') {
      const openCount = Math.max(0, Number(row.coldmailOpenCount || row.outreachOpenCount || 0) || 0) + 1;
      const firstOpenedAt = normalizeString(row.coldmailFirstOpenedAt || row.coldmailOpenedAt || row.outreachOpenedAt) || date;
      return {
        ...row,
        ...baseFields,
        coldmailOpened: true,
        coldmailOpenedAt: firstOpenedAt,
        coldmailFirstOpenedAt: firstOpenedAt,
        coldmailLastOpenedAt: date,
        coldmailOpenCount: openCount,
        outreachOpenedAt: firstOpenedAt,
        outreachOpenCount: openCount,
        hist: history('mail_geopend', 'Instantly open geregistreerd', 'Instantly registreerde een open.'),
      };
    }

    if (event.eventStatus === 'reply_received') {
      return {
        ...row,
        ...baseFields,
        lastColdmailReplyAt: date,
        lastColdmailReplySubject: normalizeString(event.eventType),
        lastColdmailReplyPreview: truncateText('Reactie ontvangen via Instantly.', 1000),
        lastColdmailReplyMessageKey: messageKey,
        outreachStatus: 'reactie_ontvangen',
        actionRequired: true,
        outreachActionRequired: true,
        hist: history('reactie_ontvangen', 'Reactie ontvangen via Instantly', 'Instantly meldde een reply.'),
      };
    }

    if (event.eventStatus === 'interested') {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'interesse') ? 'interesse' : currentStatus;
      return {
        ...row,
        ...baseFields,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        lastColdmailReplyAt: date,
        outreachStatus: 'interesse',
        actionRequired: false,
        outreachActionRequired: false,
        activeColdmailCampaignUntil: '',
        coldmailCampaignEndsAt: '',
        hist: history('interesse', 'Interesse gemeld via Instantly', 'Instantly markeerde deze lead als interested.'),
      };
    }

    if (event.eventStatus === 'bounced' || event.eventStatus === 'unsubscribed') {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'geblokkeerd') ? 'geblokkeerd' : currentStatus;
      const isUnsubscribed = event.eventStatus === 'unsubscribed';
      return {
        ...row,
        ...baseFields,
        mail: false,
        canMail: false,
        doNotMail: true,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        coldmailBounceAt: isUnsubscribed ? row.coldmailBounceAt : date,
        coldmailBounceType: isUnsubscribed ? row.coldmailBounceType : 'instantly',
        coldmailUnsubscribedAt: isUnsubscribed ? date : row.coldmailUnsubscribedAt,
        outreachStatus: 'geen_interesse',
        actionRequired: false,
        outreachActionRequired: false,
        activeColdmailCampaignUntil: '',
        coldmailCampaignEndsAt: '',
        hist: history(
          'geblokkeerd',
          isUnsubscribed ? 'Afmelding via Instantly' : 'Bounce via Instantly',
          isUnsubscribed ? 'Instantly meldde een unsubscribe.' : 'Instantly meldde een bounce.'
        ),
      };
    }

    return {
      ...row,
      ...baseFields,
      hist: history('instantly_event', 'Instantly event ontvangen', `Event verwerkt: ${event.eventType}.`),
    };
  }

  async function handleInstantlyWebhook(req) {
    verifyWebhookSecret(req);
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const event = normalizeWebhookPayload(body);
    if (!event.eventType) {
      throw createInstantlyError('Instantly webhook mist event_type.', 'INVALID_INSTANTLY_WEBHOOK_EVENT', 400);
    }

    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    const index = findWebhookRowIndex(rows, event);
    if (index < 0 || !rows[index]) {
      return {
        ok: true,
        processed: false,
        reason: 'lead_not_found',
        eventType: event.eventType,
        email: event.email,
        leadId: event.leadId,
      };
    }

    const messageKey = buildWebhookMessageKey(event);
    if (hasWebhookEvent(rows[index], messageKey)) {
      return {
        ok: true,
        processed: false,
        duplicate: true,
        reason: 'event_already_processed',
        eventType: event.eventType,
      };
    }

    const nextRows = rows.slice();
    nextRows[index] = updateRowFromWebhook(
      rows[index],
      event,
      normalizeString(body.actor) || 'Instantly webhook'
    );
    await setUiStateValues(
      customerDbScope,
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
      {
        source: 'instantly-webhook',
        actor: 'Instantly webhook',
      }
    );

    return {
      ok: true,
      processed: true,
      eventType: event.eventType,
      status: nextRows[index].instantlyStatus,
      customerId: getRowId(nextRows[index], index, normalizeString),
      email: getRowEmail(nextRows[index], normalizeString),
    };
  }

  function scheduleNextSync(delayMs = config.intervalMinutes * 60 * 1000) {
    if (syncTimer) {
      clearScheduledTask(syncTimer);
      syncTimer = null;
    }
    nextSyncAt = '';
    if (!config.enabled || !config.schedulerEnabled || !isConfigured()) return;
    const safeDelay = Math.max(1000, Math.min(delayMs, 24 * 60 * 60 * 1000));
    nextSyncAt = new Date(now().getTime() + safeDelay).toISOString();
    syncTimer = scheduleTask(() => {
      syncTimer = null;
      nextSyncAt = '';
      void syncInstantlyLeads({ actor: 'Instantly autopilot' })
        .catch((error) => {
          lastSyncResult = {
            ok: false,
            code: normalizeString(error && error.code) || 'INSTANTLY_AUTOPILOT_FAILED',
            message: truncateText(error && error.message ? error.message : String(error), 500),
            finishedAt: now().toISOString(),
          };
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[Instantly] autopilot sync mislukt', lastSyncResult);
          }
        })
        .finally(() => scheduleNextSync());
    }, safeDelay);
  }

  function startAutopilot() {
    scheduleNextSync(STARTUP_SYNC_DELAY_MS);
  }

  function stopAutopilot() {
    if (syncTimer) {
      clearScheduledTask(syncTimer);
      syncTimer = null;
    }
    nextSyncAt = '';
  }

  async function getStatus() {
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    return {
      ok: true,
      enabled: config.enabled,
      configured: isConfigured(),
      missing: getMissingConfig(),
      campaignId: config.defaultCampaignId,
      apiBaseUrl: config.apiBaseUrl,
      schedulerEnabled: config.schedulerEnabled,
      intervalMinutes: config.intervalMinutes,
      batchSize: config.batchSize,
      dailyCap: config.dailyCap,
      verifyLeadsOnImport: config.verifyLeadsOnImport,
      blockPersonalMailboxDomains: config.blockPersonalMailboxDomains,
      syncedToday: getDailySyncCount(rows),
      nextSyncAt,
      running: Boolean(syncPromise),
      lastSync: lastSyncResult,
    };
  }

  if (config.enabled && config.schedulerEnabled) {
    startAutopilot();
  }

  return {
    getMissingConfig,
    getStatus,
    handleInstantlyWebhook,
    isConfigured,
    startAutopilot,
    stopAutopilot,
    syncInstantlyLeads,
  };
}

module.exports = {
  ACTIVE_INSTANTLY_STATUSES,
  BLOCKING_INSTANTLY_STATUSES,
  createInstantlyOutreachService,
  normalizeInstantlyEventType,
  normalizeInstantlyStatus,
};
