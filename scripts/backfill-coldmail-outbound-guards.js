#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const { createHash } = require('crypto');

const { loadRuntimeEnv } = require('../server/config/runtime-env');
const { createSupabaseStateStore } = require('../server/services/supabase-state');
const {
  readChunkedStateValue,
  safeParseJsonArray,
} = require('../server/services/data-ops-serialization');
const {
  getIdentityKeyRows,
  normalizeIdentity,
} = require('../server/services/outbound-recipient-guard-store');

const SENDERS = [
  'serve@softora.nl',
  'martijn@softora.nl',
  'servecreusen@softora.nl',
  'martijnvandeven@softora.nl',
  'servec321@gmail.com',
  'martijnven123@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'contact.venvisuals@gmail.com',
];

const INTERNAL_RECIPIENTS = new Set(SENDERS.map((email) => email.toLowerCase()));
const BACKFILL_SOURCE = 'mailbox-sent-webdesign-backfill-2026-06-08';
const MONITOR_PAUSE_REASON = 'central_outbound_guard_missing_monitor_2026_06_08';
const POST_PAUSE_AFTER = '2026-06-08T08:27:00.000Z';
const SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const AUTOPILOT_SCOPE = 'premium_coldmail_autopilot';
const AUTOPILOT_KEY = 'softora_coldmail_autopilot_v1';
const LEGACY_CUSTOMER_SCOPE = 'premium_customers_database';
const LEGACY_CUSTOMER_KEY = 'softora_customers_premium_v1';
const MAILBOX_SYNC_LIMIT_HINT = 100;
const SHARED_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'planet.nl',
  'ziggo.nl',
  'kpnmail.nl',
  'hetnet.nl',
  'xs4all.nl',
  'upcmail.nl',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeIdentity({ recipientEmail: value }, normalizeString).recipientEmail;
}

function normalizeDomain(value) {
  return normalizeIdentity({ recipientDomain: value }, normalizeString).recipientDomain;
}

function normalizeGuardKeyPart(value) {
  return normalizeIdentity({ recipientCompanyKey: value }, normalizeString).recipientCompanyKey;
}

function normalizeRiskKey(value) {
  return normalizeGuardKeyPart(value);
}

function stableHash(value, length = 20) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const envFileArg = argv.find((item) => item.startsWith('--env-file='));
  const sinceArg = argv.find((item) => item.startsWith('--since='));
  const postPauseArg = argv.find((item) => item.startsWith('--post-pause-after='));
  const sampleArg = argv.find((item) => item.startsWith('--sample='));
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
    pauseOnMissing: args.has('--pause-on-missing'),
    envFile: normalizeString(process.env.SOFTORA_ENV_FILE || (envFileArg ? envFileArg.split('=').slice(1).join('=') : '')),
    since: normalizeString(sinceArg ? sinceArg.split('=').slice(1).join('=') : ''),
    postPauseAfter: normalizeString(postPauseArg ? postPauseArg.split('=').slice(1).join('=') : POST_PAUSE_AFTER),
    sample: Math.max(1, Math.min(50, Number(sampleArg ? sampleArg.split('=')[1] : 15) || 15)),
  };
}

function loadEnv(options = {}) {
  const candidates = [
    options.envFile,
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '.env'),
  ].filter(Boolean);
  const loaded = [];
  candidates.forEach((candidate) => {
    dotenv.config({ path: candidate, override: false, quiet: true });
    loaded.push(candidate);
  });
  return loaded;
}

function createSupabaseClientFromEnv() {
  const runtimeEnv = loadRuntimeEnv(process.env);
  const supabase = runtimeEnv.supabase;
  const stateStore = createSupabaseStateStore({
    supabaseUrl: supabase.url,
    supabaseServiceRoleKey: supabase.serviceRoleKey,
    supabaseStateTable: supabase.stateTable,
    supabaseStateKey: supabase.stateKey,
    supabaseCallUpdateStateKeyPrefix: supabase.callUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit: supabase.callUpdateRowsFetchLimit,
    supabaseRestTimeoutMs: Number(process.env.SUPABASE_REST_TIMEOUT_MS || 30000) || 30000,
    normalizeString,
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });
  if (!stateStore.isSupabaseConfigured()) {
    throw new Error('Supabase is niet geconfigureerd; zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.');
  }
  return {
    client: stateStore.getSupabaseClient(),
    stateStore,
    stateTable: supabase.stateTable || 'softora_runtime_state',
  };
}

async function fetchAll(client, table, select, configureQuery = (query) => query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const query = configureQuery(client.from(table).select(select).range(from, to));
    const { data, error } = await query;
    if (error) throw new Error(`${table} lezen mislukt: ${error.message || error}`);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function collectEmails(value, output = new Set()) {
  if (!value) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectEmails(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectEmails(item, output));
    return output;
  }
  const raw = String(value);
  const regex = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/gi;
  let match = null;
  while ((match = regex.exec(raw))) {
    const email = normalizeEmail(match[0]);
    if (email) output.add(email);
  }
  return output;
}

function extractRecipientEmails(message = {}) {
  const emails = new Set();
  collectEmails(message.recipients_text, emails);
  collectEmails(message.payload && message.payload.to, emails);
  collectEmails(message.payload && message.payload.cc, emails);
  collectEmails(message.payload && message.payload.recipients, emails);
  return [...emails].filter((email) => email && !INTERNAL_RECIPIENTS.has(email));
}

function isSentFolder(folder) {
  const normalized = normalizeString(folder).toLowerCase();
  return (
    normalized === 'sent' ||
    normalized.includes('sent') ||
    normalized.includes('verzonden') ||
    normalized.includes('verstuurd')
  );
}

function isInitialWebdesignMail(message = {}) {
  if (!isSentFolder(message.folder)) return false;
  if (message.deleted_at) return false;
  const subject = normalizeString(message.subject);
  if (/^(?:re|fw|fwd)\s*:/i.test(subject)) return false;
  const haystack = [
    subject,
    message.preview,
    message.body_text,
  ].map(normalizeString).join('\n').toLowerCase();
  return (
    haystack.includes('kleine vraag over jullie website') ||
    haystack.includes('mocht je er niks mee willen doen') ||
    haystack.includes('fris webdesign') ||
    haystack.includes('nieuw webdesign') ||
    /webdesign[\s\S]{0,80}gemaakt/i.test(haystack) ||
    /website[\s\S]{0,80}gemaakt/i.test(haystack)
  );
}

function isWebdesignRelatedMail(message = {}) {
  if (message.deleted_at) return false;
  const haystack = [
    message.subject,
    message.preview,
    message.body_text,
  ].map(normalizeString).join('\n').toLowerCase();
  return (
    haystack.includes('kleine vraag over jullie website') ||
    haystack.includes('nieuw webdesign') ||
    haystack.includes('fris webdesign') ||
    haystack.includes('mocht je er niks mee willen doen') ||
    /webdesign[\s\S]{0,120}(gemaakt|website|ontwerp|preview)/i.test(haystack) ||
    /website[\s\S]{0,120}(gemaakt|ontwerp|preview)/i.test(haystack)
  );
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getCustomerPayload(customer = {}) {
  return customer.payload && typeof customer.payload === 'object' ? customer.payload : {};
}

function getCustomerCompany(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeString(
    customer.company ||
      payload.bedrijf ||
      payload.company ||
      payload.companyName ||
      payload.naam ||
      payload.name
  );
}

function getCustomerEmail(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeEmail(customer.email || payload.email || payload.mail || payload.mailadres);
}

function getCustomerWebsite(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeString(customer.website || payload.website || payload.url || payload.site);
}

function getCustomerId(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeString(customer.customer_id || payload.id || payload.customerId || payload.databaseId);
}

function getCustomerProvider(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeString(
    payload.lastColdmailProvider ||
      payload.coldmailProvider ||
      payload.outreachProvider ||
      payload.provider
  ).toLowerCase();
}

function getCustomerSenderEmail(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeEmail(
    payload.lastColdmailSenderEmail ||
      payload.sentFromEmail ||
      payload.sent_from_email ||
      payload.outreachSentFromEmail ||
      payload.senderEmail
  );
}

function getCustomerMessageId(customer = {}) {
  const payload = getCustomerPayload(customer);
  return normalizeString(
    payload.coldmailSentMessageId ||
      payload.outreachMessageId ||
      payload.sentMessageId ||
      payload.messageId
  );
}

function isInstantlyProviderValue(value) {
  return normalizeString(value).toLowerCase() === 'instantly';
}

function getTimestampPrecision(value) {
  return /[tT]\d{2}:|\d{1,2}:\d{2}/.test(normalizeString(value)) ? 'exact' : 'day';
}

function isSoftoraSentHistoryEntry(entry = {}) {
  const text = normalizeString([
    entry.type,
    entry.status,
    entry.label,
    entry.source,
    entry.actor,
  ].join(' ')).toLowerCase();
  if (/instantly|opened|geopend|open tracking|tracking/.test(text)) return false;
  return /(mail verstuurd|gemaild|coldmail|webdesign-outreach|outreach sent|sent)/.test(text);
}

function getCustomerSentAtInfo(customer = {}) {
  const payload = getCustomerPayload(customer);
  const candidates = [
    payload.lastColdmailSentAt,
    payload.lastMailSentAt,
    payload.outreachSentAt,
    payload.outreach_sent_at,
    payload.coldmailCampaignStartedAt,
  ].map((value) => ({
    value,
    precision: getTimestampPrecision(value),
  }));
  const history = Array.isArray(payload.hist) ? payload.hist : [];
  history.forEach((entry) => {
    if (!isSoftoraSentHistoryEntry(entry)) return;
    const value = entry && (entry.at || entry.date || entry.createdAt || entry.updatedAt);
    candidates.push({
      value,
      precision: getTimestampPrecision(value),
    });
  });
  return candidates
    .map((candidate) => ({
      date: parseDate(candidate.value),
      precision: candidate.precision === 'day' ? 'day' : 'exact',
    }))
    .filter((candidate) => candidate.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0] || { date: null, precision: '' };
}

function getCustomerSentAt(customer = {}) {
  return getCustomerSentAtInfo(customer).date;
}

function isSoftoraCustomerSentSignal(customer = {}) {
  const payload = getCustomerPayload(customer);
  if (isInstantlyProviderValue(getCustomerProvider(customer))) return false;
  const senderEmail = getCustomerSenderEmail(customer);
  if (senderEmail && !SENDERS.includes(senderEmail)) return false;
  if (normalizeString(payload.lastColdmailSentAt || payload.lastMailSentAt || payload.outreachSentAt || payload.outreach_sent_at)) {
    return true;
  }
  if (getCustomerMessageId(customer)) return true;
  const statusText = normalizeString([
    customer.database_status,
    customer.lifecycle_status,
    payload.databaseStatus,
    payload.status,
    payload.outreachStatus,
    payload.coldmailSpecialAction,
    payload.outreachCampaignType,
  ].join(' ')).toLowerCase();
  if (/\bgemaild\b/.test(statusText) && /webdesign|coldmail|benaderd|outreach|gemaild/.test(statusText)) return true;
  return (Array.isArray(payload.hist) ? payload.hist : []).some((entry) => isSoftoraSentHistoryEntry(entry));
}

function getEmailDomain(email) {
  return normalizeDomain(String(email || '').split('@')[1] || '');
}

function isSharedMailboxDomain(domain) {
  const raw = normalizeString(domain).toLowerCase();
  const normalized = normalizeDomain(domain);
  return (
    SHARED_MAILBOX_DOMAINS.has(raw) ||
    SHARED_MAILBOX_DOMAINS.has(normalized) ||
    SHARED_MAILBOX_DOMAINS.has(normalized.replace(/-/g, '.'))
  );
}

function buildCustomerIndexes(customers = []) {
  const byEmail = new Map();
  const byDomain = new Map();
  customers.forEach((customer) => {
    if (customer && customer.deleted_at) return;
    const email = getCustomerEmail(customer);
    const websiteDomain = normalizeDomain(getCustomerWebsite(customer));
    const emailDomain = getEmailDomain(email);
    const enriched = {
      customer,
      customerId: getCustomerId(customer),
      company: getCustomerCompany(customer),
      email,
      domain: websiteDomain || emailDomain,
      website: getCustomerWebsite(customer),
    };
    if (email && !byEmail.has(email)) byEmail.set(email, enriched);
    if (websiteDomain && !byDomain.has(websiteDomain)) byDomain.set(websiteDomain, enriched);
    if (emailDomain && !isSharedMailboxDomain(emailDomain) && !byDomain.has(emailDomain)) {
      byDomain.set(emailDomain, enriched);
    }
  });
  return { byEmail, byDomain };
}

function mapLegacyCustomerRow(row = {}) {
  const payload = row && typeof row === 'object' ? row : {};
  const email = normalizeEmail(payload.email || payload.mail || payload.mailadres || payload.e_mail || payload['e-mail']);
  const company = normalizeString(payload.company || payload.bedrijf || payload.naam || payload.name);
  const website = normalizeString(payload.website || payload.url || payload.dom || payload.domein);
  const customerId = normalizeString(payload.id || payload.customerId || payload.databaseId);
  const status = normalizeString(payload.database_status || payload.databaseStatus || payload.status);
  return {
    customer_id: customerId,
    identity_key: normalizeString(payload.identity_key || payload.identityKey),
    company,
    email,
    website,
    database_status: status,
    lifecycle_status: normalizeString(payload.lifecycle_status || payload.lifecycleStatus || status),
    deleted_at: payload.deleted_at || payload.deletedAt || null,
    payload: {
      ...payload,
      bedrijf: normalizeString(payload.bedrijf || company),
      company,
      email,
      mail: email,
      mailadres: email,
      website,
      id: customerId,
      customerId,
      databaseId: customerId,
    },
  };
}

function buildLegacyCustomerRowsFromUiState(row = {}) {
  const values = row && row.payload && typeof row.payload.values === 'object' ? row.payload.values : {};
  return safeParseJsonArray(readChunkedStateValue(values, LEGACY_CUSTOMER_KEY))
    .map((item) => mapLegacyCustomerRow(item))
    .filter((item) => item && !item.deleted_at);
}

function buildMailboxSentEvents(messages = [], customerIndexes = {}, options = {}) {
  const since = parseDate(options.since);
  const events = [];
  messages.forEach((message) => {
    const date = parseDate(message.date || message.internal_date);
    if (!date || (since && date < since)) return;
    const accountEmail = normalizeEmail(message.account_email);
    if (!SENDERS.includes(accountEmail)) return;
    if (!isInitialWebdesignMail(message)) return;
    extractRecipientEmails(message).forEach((recipientEmail) => {
      const recipientDomain = getEmailDomain(recipientEmail);
      const customer =
        (customerIndexes.byEmail && customerIndexes.byEmail.get(recipientEmail)) ||
        (customerIndexes.byDomain && customerIndexes.byDomain.get(recipientDomain)) ||
        null;
      const company = normalizeString(customer && customer.company);
      const customerId = normalizeString(customer && customer.customerId);
      const identityDomain =
        normalizeString(customer && customer.domain) ||
        (isSharedMailboxDomain(recipientDomain) ? '' : recipientDomain);
      const identity = {
        recipientEmail,
        recipientDomain: identityDomain,
        recipientCompanyKey: normalizeGuardKeyPart(company),
        recipientId: normalizeGuardKeyPart(customerId),
        recipientCompany: company,
      };
      events.push({
        source: 'mailbox_sent',
        eventKey: [
          normalizeString(message.message_key) || `${accountEmail}:${message.folder}:${message.uid || message.date}`,
          recipientEmail,
        ].join('|'),
        accountEmail,
        recipientEmail,
        date: date.toISOString(),
        subject: normalizeString(message.subject),
        folder: normalizeString(message.folder),
        uid: message.uid,
        messageKey: normalizeString(message.message_key),
        messageId: normalizeString(message.message_id),
        providerId: normalizeString(message.provider_id),
        company,
        customerId,
        identity,
        keyRows: getIdentityKeyRows(identity, normalizeString)
          .filter((keyRow) => identityDomain || keyRow.keyType !== 'domain'),
      });
    });
  });

  const byEventKey = new Map();
  events.forEach((event) => {
    if (!byEventKey.has(event.eventKey)) byEventKey.set(event.eventKey, event);
  });
  return [...byEventKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildMailboxWebdesignContactEvents(messages = [], customerIndexes = {}, options = {}) {
  const since = parseDate(options.since);
  const events = [];
  messages.forEach((message) => {
    const date = parseDate(message.date || message.internal_date);
    if (!date || (since && date < since)) return;
    const senderEmail = normalizeEmail(message.sender_email || message.account_email);
    if (!SENDERS.includes(senderEmail)) return;
    if (!isWebdesignRelatedMail(message)) return;
    extractRecipientEmails(message).forEach((recipientEmail) => {
      const recipientDomain = getEmailDomain(recipientEmail);
      const customer =
        (customerIndexes.byEmail && customerIndexes.byEmail.get(recipientEmail)) ||
        (customerIndexes.byDomain && customerIndexes.byDomain.get(recipientDomain)) ||
        null;
      const company = normalizeString(customer && customer.company);
      const customerId = normalizeString(customer && customer.customerId);
      const identityDomain =
        normalizeString(customer && customer.domain) ||
        (isSharedMailboxDomain(recipientDomain) ? '' : recipientDomain);
      const identity = {
        recipientEmail,
        recipientDomain: identityDomain,
        recipientCompanyKey: normalizeGuardKeyPart(company),
        recipientId: normalizeGuardKeyPart(customerId),
        recipientCompany: company,
      };
      const keyRows = getIdentityKeyRows(identity, normalizeString)
        .filter((keyRow) => identityDomain || keyRow.keyType !== 'domain');
      events.push({
        source: 'mailbox_webdesign_contact',
        eventKey: [
          normalizeString(message.message_key) || `${senderEmail}:${message.folder}:${message.uid || message.date}`,
          recipientEmail,
        ].join('|'),
        accountEmail: senderEmail,
        recipientEmail,
        date: date.toISOString(),
        subject: normalizeString(message.subject),
        folder: normalizeString(message.folder),
        uid: message.uid,
        messageKey: normalizeString(message.message_key),
        messageId: normalizeString(message.message_id),
        providerId: normalizeString(message.provider_id),
        company,
        customerId,
        identity,
        keyRows,
        replySubject: /^(?:re|fw|fwd)\s*:/i.test(normalizeString(message.subject)),
      });
    });
  });
  return dedupeOutboundEvents(events);
}

function buildCustomerSentEvents(customers = [], options = {}) {
  const since = parseDate(options.since);
  const events = [];
  customers.forEach((customer) => {
    if (!customer || customer.deleted_at) return;
    if (!isSoftoraCustomerSentSignal(customer)) return;
    const sentAtInfo = getCustomerSentAtInfo(customer);
    const sentAt = sentAtInfo.date;
    if (!sentAt || (since && sentAt < since)) return;
    const recipientEmail = getCustomerEmail(customer);
    if (!recipientEmail || INTERNAL_RECIPIENTS.has(recipientEmail)) return;
    const recipientDomain = getEmailDomain(recipientEmail);
    const company = getCustomerCompany(customer);
    const customerId = getCustomerId(customer);
    const websiteDomain = normalizeDomain(getCustomerWebsite(customer));
    const identityDomain = websiteDomain || (isSharedMailboxDomain(recipientDomain) ? '' : recipientDomain);
    const accountEmail = getCustomerSenderEmail(customer);
    const messageId = getCustomerMessageId(customer);
    const identity = {
      recipientEmail,
      recipientDomain: identityDomain,
      recipientCompanyKey: normalizeGuardKeyPart(company),
      recipientId: normalizeGuardKeyPart(customerId),
      recipientCompany: company,
    };
    events.push({
      source: 'customer_sent',
      eventKey: [
        'customer',
        customerId || recipientEmail,
        messageId || sentAt.toISOString(),
      ].join('|'),
      accountEmail,
      recipientEmail,
      date: sentAt.toISOString(),
      datePrecision: sentAtInfo.precision,
      subject: 'Klantstatus: Mail verstuurd',
      folder: '',
      uid: '',
      messageKey: '',
      messageId,
      providerId: '',
      company,
      customerId,
      identity,
      keyRows: getIdentityKeyRows(identity, normalizeString)
        .filter((keyRow) => identityDomain || keyRow.keyType !== 'domain'),
    });
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function buildSendGuardEvents(sendGuardState = {}, customerIndexes = {}, options = {}) {
  const since = parseDate(options.since);
  const candidates = [
    ...(Array.isArray(sendGuardState.entries) ? sendGuardState.entries : []),
    ...(Array.isArray(sendGuardState.recipientEntries) ? sendGuardState.recipientEntries : []),
  ];
  const events = [];
  candidates.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const provider = normalizeString(entry.provider || entry.lastColdmailProvider).toLowerCase();
    if (isInstantlyProviderValue(provider)) return;
    const at = parseDate(entry.at || entry.lastSeenAt || entry.updatedAt);
    if (!at || (since && at < since)) return;
    const count = Number(entry.count || 0) || 0;
    if (Object.prototype.hasOwnProperty.call(entry, 'count') && count <= 0) return;
    const accountEmail = normalizeEmail(entry.senderEmail);
    if (accountEmail && !SENDERS.includes(accountEmail)) return;
    const recipientEmail = normalizeEmail(entry.recipientEmail);
    const recipientDomain = normalizeDomain(entry.recipientDomain || getEmailDomain(recipientEmail));
    const customer =
      (customerIndexes.byEmail && recipientEmail && customerIndexes.byEmail.get(recipientEmail)) ||
      (customerIndexes.byDomain && recipientDomain && customerIndexes.byDomain.get(recipientDomain)) ||
      null;
    const company = normalizeString(entry.recipientCompany || (customer && customer.company));
    const customerId = normalizeString(entry.recipientId || (customer && customer.customerId));
    const identityDomain =
      normalizeDomain(entry.recipientDomain || (customer && customer.domain)) ||
      (isSharedMailboxDomain(getEmailDomain(recipientEmail)) ? '' : getEmailDomain(recipientEmail));
    const identity = {
      recipientEmail,
      recipientDomain: identityDomain,
      recipientCompanyKey: normalizeGuardKeyPart(entry.recipientCompanyKey || company),
      recipientId: normalizeGuardKeyPart(customerId),
      recipientCompany: company,
    };
    const keyRows = getIdentityKeyRows(identity, normalizeString)
      .filter((keyRow) => identityDomain || keyRow.keyType !== 'domain');
    if (!keyRows.length) return;
    events.push({
      source: 'send_guard',
      eventKey: [
        'send-guard',
        entry.recipientKey || recipientEmail || identityDomain || customerId,
        at.toISOString(),
        accountEmail,
        index,
      ].join('|'),
      accountEmail,
      recipientEmail,
      date: at.toISOString(),
      subject: 'Oude send_guard: Mail verstuurd',
      folder: '',
      uid: '',
      messageKey: '',
      messageId: '',
      providerId: '',
      company,
      customerId,
      identity,
      keyRows,
    });
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function dedupeOutboundEvents(events = []) {
  const byEventKey = new Map();
  events.forEach((event) => {
    const key = normalizeString(event && event.eventKey);
    if (!key) return;
    if (!byEventKey.has(key)) byEventKey.set(key, event);
  });
  return [...byEventKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isPermanentSentGuard(guard) {
  if (!guard || typeof guard !== 'object') return false;
  return guard.permanent === true && normalizeString(guard.guard_key);
}

function buildPermanentGuardMap(guards = []) {
  const map = new Map();
  (Array.isArray(guards) ? guards : []).forEach((guard) => {
    const key = normalizeString(guard && guard.guard_key);
    if (!key) return;
    const current = map.get(key);
    if (!current || (isPermanentSentGuard(guard) && !isPermanentSentGuard(current))) {
      map.set(key, guard);
    }
  });
  return map;
}

function findMissingGuardKeys(events = [], guards = []) {
  const guardMap = buildPermanentGuardMap(guards);
  const missing = [];
  events.forEach((event) => {
    (Array.isArray(event && event.keyRows) ? event.keyRows : []).forEach((keyRow) => {
      const guard = guardMap.get(keyRow.guardKey);
      if (!isPermanentSentGuard(guard)) {
        missing.push({
          guardKey: keyRow.guardKey,
          keyType: keyRow.keyType,
          keyValue: keyRow.keyValue,
          existingGuard: guard || null,
          event,
        });
      }
    });
  });
  return missing;
}

function groupMissingRowsForInsert(missing = []) {
  const byKey = new Map();
  missing.forEach((item) => {
    const current = byKey.get(item.guardKey);
    const event = item.event;
    if (!current) {
      byKey.set(item.guardKey, {
        guard_key: item.guardKey,
        key_type: item.keyType,
        key_value: item.keyValue,
        reservation_id: `${BACKFILL_SOURCE}-${stableHash(item.guardKey)}`,
        provider: 'softora',
        channel: 'coldmail',
        sender_email: event.accountEmail,
        recipient_email: event.identity.recipientEmail,
        recipient_domain: event.identity.recipientDomain,
        recipient_company_key: event.identity.recipientCompanyKey,
        recipient_id: event.identity.recipientId,
        recipient_company: event.identity.recipientCompany,
        status: 'sent',
        source: BACKFILL_SOURCE,
        actor: 'codex:coldmail-guard-backfill',
        permanent: true,
        payload: {
          backfillSource: BACKFILL_SOURCE,
          events: [],
        },
        expires_at: null,
        last_seen_at: event.date,
        updated_at: new Date().toISOString(),
      });
    }
    const row = byKey.get(item.guardKey);
    if (event.date > row.last_seen_at) {
      row.last_seen_at = event.date;
      row.sender_email = event.accountEmail;
    }
    row.payload.events.push({
      at: event.date,
      senderEmail: event.accountEmail,
      recipientEmail: event.recipientEmail,
      subject: event.subject,
      folder: event.folder,
      uid: event.uid,
      messageKey: event.messageKey,
      messageId: event.messageId,
      providerId: event.providerId,
      company: event.company,
      customerId: event.customerId,
    });
  });
  return [...byKey.values()];
}

function summarizeMailboxDuplicates(events = []) {
  const byEmail = new Map();
  events.filter((event) => !event.source || event.source === 'mailbox_sent').forEach((event) => {
    const rows = byEmail.get(event.recipientEmail) || [];
    rows.push(event);
    byEmail.set(event.recipientEmail, rows);
  });
  return [...byEmail.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({
      email,
      count: rows.length,
      sends: rows.map((event) => ({
        at: event.date,
        senderEmail: event.accountEmail,
        subject: event.subject,
      })),
    }));
}

function summarizeSoftoraDuplicateRecipients(events = []) {
  const byEmail = new Map();
  filterHardSoftoraEvidenceEvents(events).forEach((event) => {
    const email = normalizeEmail(event && event.recipientEmail);
    if (!email) return;
    const rows = byEmail.get(email) || [];
    rows.push(event);
    byEmail.set(email, rows);
  });
  return summarizeGroupedDuplicateEvents(byEmail, 'email');
}

function filterHardSoftoraEvidenceEvents(events = []) {
  return events.filter((event) => {
    if (!event.source || event.source === 'mailbox_sent') return true;
    return event.source === 'customer_sent' && event.datePrecision !== 'day';
  });
}

function buildSendBuckets(rows = []) {
  const sendBuckets = [];
  rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((event) => {
      const eventAt = parseDate(event.date);
      const messageId = normalizeString(event.messageId);
      const sender = normalizeEmail(event.accountEmail);
      const bucket = sendBuckets.find((item) => {
        if (messageId && item.messageIds.has(messageId)) return true;
        const itemAt = parseDate(item.sentAt);
        return (
          sender &&
          item.senderEmail === sender &&
          eventAt &&
          itemAt &&
          Math.abs(eventAt.getTime() - itemAt.getTime()) <= 120000
        );
      });
      const target = bucket || {
        sentAt: event.date,
        senderEmail: sender,
        messageIds: new Set(),
        sources: new Set(),
        events: [],
      };
      if (!bucket) sendBuckets.push(target);
      if (messageId) target.messageIds.add(messageId);
      target.sources.add(normalizeString(event.source) || 'unknown');
      target.events.push(event);
    });
  return sendBuckets;
}

function summarizeSendBucket(bucket) {
  return {
    at: bucket.sentAt,
    senderEmail: bucket.senderEmail,
    sources: [...bucket.sources].sort(),
    subjects: [...new Set(bucket.events.map((event) => normalizeString(event.subject)).filter(Boolean))],
    recipients: [...new Set(bucket.events.map((event) => normalizeEmail(event.recipientEmail)).filter(Boolean))].sort(),
    companies: [...new Set(bucket.events.map((event) => normalizeString(event.company)).filter(Boolean))].sort(),
  };
}

function summarizeGroupedDuplicateEvents(groupedEvents, keyName) {
  const duplicates = [];
  groupedEvents.forEach((rows, key) => {
    const sendBuckets = buildSendBuckets(rows);
    if (sendBuckets.length <= 1) return;
    const duplicate = {
      [keyName]: key,
      count: sendBuckets.length,
      sends: sendBuckets.map((bucket) => summarizeSendBucket(bucket)),
    };
    duplicates.push(duplicate);
  });
  return duplicates.sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function summarizeSoftoraDuplicateDomains(events = []) {
  const byDomain = new Map();
  filterHardSoftoraEvidenceEvents(events).forEach((event) => {
    const domain = normalizeDomain(event && event.identity && event.identity.recipientDomain);
    if (!domain || isSharedMailboxDomain(domain)) return;
    const rows = byDomain.get(domain) || [];
    rows.push(event);
    byDomain.set(domain, rows);
  });
  return summarizeGroupedDuplicateEvents(byDomain, 'domain');
}

function summarizeSoftoraDuplicateCompanies(events = []) {
  const byCompany = new Map();
  filterHardSoftoraEvidenceEvents(events).forEach((event) => {
    const companyKey = normalizeRiskKey(
      (event && event.identity && event.identity.recipientCompanyKey) || (event && event.company)
    );
    if (!companyKey) return;
    const rows = byCompany.get(companyKey) || [];
    rows.push(event);
    byCompany.set(companyKey, rows);
  });
  return summarizeGroupedDuplicateEvents(byCompany, 'companyKey');
}

function summarizeWebdesignContactDuplicateDomains(events = []) {
  const byDomain = new Map();
  events.forEach((event) => {
    if (!event || event.source !== 'mailbox_webdesign_contact') return;
    const domain = normalizeDomain(event.identity && event.identity.recipientDomain);
    if (!domain || isSharedMailboxDomain(domain)) return;
    const rows = byDomain.get(domain) || [];
    rows.push(event);
    byDomain.set(domain, rows);
  });
  return summarizeGroupedDuplicateEvents(byDomain, 'domain').map((item) => ({
    ...item,
    hasReplyOrFollowup: item.sends.some((send) =>
      send.subjects.some((subject) => /^(?:re|fw|fwd)\s*:/i.test(subject))
    ),
  }));
}

function summarizeMultiProviderGuards(guards = []) {
  const byEmail = new Map();
  guards.forEach((guard) => {
    const email = normalizeEmail(guard.recipient_email);
    const provider = normalizeString(guard.provider).toLowerCase();
    if (!email || !provider) return;
    const entry = byEmail.get(email) || { email, providers: new Set(), rows: [] };
    entry.providers.add(provider);
    entry.rows.push({
      provider,
      source: normalizeString(guard.source),
      status: normalizeString(guard.status),
      permanent: Boolean(guard.permanent),
      lastSeenAt: normalizeString(guard.last_seen_at),
    });
    byEmail.set(email, entry);
  });
  return [...byEmail.values()]
    .filter((entry) => entry.providers.size > 1)
    .map((entry) => ({
      email: entry.email,
      providers: [...entry.providers].sort(),
      rows: entry.rows,
    }));
}

function summarizeMultiProviderGuardGroups(guards = [], keyName, resolveKey) {
  const byKey = new Map();
  guards.forEach((guard) => {
    if (!guard || guard.permanent !== true) return;
    const provider = normalizeString(guard.provider).toLowerCase();
    if (!provider) return;
    const key = normalizeRiskKey(resolveKey(guard));
    if (!key) return;
    const entry = byKey.get(key) || {
      [keyName]: key,
      providers: new Set(),
      emails: new Set(),
      rows: [],
    };
    entry.providers.add(provider);
    const email = normalizeEmail(guard.recipient_email);
    if (email) entry.emails.add(email);
    entry.rows.push({
      provider,
      source: normalizeString(guard.source),
      status: normalizeString(guard.status),
      permanent: Boolean(guard.permanent),
      lastSeenAt: normalizeString(guard.last_seen_at),
      email,
    });
    byKey.set(key, entry);
  });
  return [...byKey.values()]
    .filter((entry) => entry.providers.size > 1)
    .map((entry) => ({
      [keyName]: entry[keyName],
      providers: [...entry.providers].sort(),
      emails: [...entry.emails].sort(),
      rows: entry.rows,
    }))
    .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function summarizeMultiProviderGuardDomains(guards = []) {
  return summarizeMultiProviderGuardGroups(guards, 'domain', (guard) => {
    const domain = normalizeDomain(guard.recipient_domain || getEmailDomain(guard.recipient_email));
    return domain && !isSharedMailboxDomain(domain) ? domain : '';
  });
}

function summarizeMultiProviderGuardCompanies(guards = []) {
  return summarizeMultiProviderGuardGroups(
    guards,
    'companyKey',
    (guard) => guard.recipient_company_key || guard.recipient_company
  );
}

function addConsolidatedRisk(risksByEmail, email, riskType, evidence = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || INTERNAL_RECIPIENTS.has(normalizedEmail)) return;
  const entry = risksByEmail.get(normalizedEmail) || {
    email: normalizedEmail,
    riskTypes: new Set(),
    providers: new Set(),
    sources: new Set(),
    companies: new Set(),
    evidence: [],
  };
  entry.riskTypes.add(riskType);
  (Array.isArray(evidence.providers) ? evidence.providers : []).forEach((provider) => {
    const value = normalizeString(provider).toLowerCase();
    if (value) entry.providers.add(value);
  });
  (Array.isArray(evidence.sources) ? evidence.sources : []).forEach((source) => {
    const value = normalizeString(source);
    if (value) entry.sources.add(value);
  });
  (Array.isArray(evidence.companies) ? evidence.companies : []).forEach((company) => {
    const value = normalizeString(company);
    if (value) entry.companies.add(value);
  });
  const evidenceRow = {
    riskTypes: [riskType],
    at: normalizeString(evidence.at),
    senderEmail: normalizeEmail(evidence.senderEmail),
    sources: (Array.isArray(evidence.sources) ? evidence.sources : []).map(normalizeString).filter(Boolean).sort(),
    providers: (Array.isArray(evidence.providers) ? evidence.providers : []).map((provider) =>
      normalizeString(provider).toLowerCase()
    ).filter(Boolean).sort(),
    subjects: (Array.isArray(evidence.subjects) ? evidence.subjects : []).map(normalizeString).filter(Boolean),
    companies: (Array.isArray(evidence.companies) ? evidence.companies : []).map(normalizeString).filter(Boolean),
  };
  const evidenceKey = JSON.stringify({ ...evidenceRow, riskTypes: [] });
  const existingEvidence = entry.evidence.find((item) => item.evidenceKey === evidenceKey);
  if (existingEvidence) {
    existingEvidence.riskTypes = [...new Set([...existingEvidence.riskTypes, riskType])].sort();
  } else {
    entry.evidence.push({ ...evidenceRow, evidenceKey });
  }
  risksByEmail.set(normalizedEmail, entry);
}

function addSendRiskRows(risksByEmail, duplicate, riskType) {
  (Array.isArray(duplicate && duplicate.sends) ? duplicate.sends : []).forEach((send) => {
    const recipients = Array.isArray(send.recipients) ? send.recipients : [];
    recipients.forEach((recipient) =>
      addConsolidatedRisk(risksByEmail, recipient, riskType, {
        at: send.at,
        senderEmail: send.senderEmail,
        sources: send.sources,
        subjects: send.subjects,
        companies: send.companies,
      })
    );
  });
}

function addProviderRiskRows(risksByEmail, overlap, riskType) {
  const providers = Array.isArray(overlap && overlap.providers) ? overlap.providers : [];
  const emails = [
    normalizeEmail(overlap && overlap.email),
    ...(Array.isArray(overlap && overlap.emails) ? overlap.emails : []),
  ].filter(Boolean);
  emails.forEach((email) =>
    addConsolidatedRisk(risksByEmail, email, riskType, {
      providers,
      sources: (Array.isArray(overlap && overlap.rows) ? overlap.rows : []).map((row) => row && row.source),
    })
  );
  (Array.isArray(overlap && overlap.rows) ? overlap.rows : []).forEach((row) => {
    const email = normalizeEmail(row && row.email);
    if (!email) return;
    addConsolidatedRisk(risksByEmail, email, riskType, {
      at: row.lastSeenAt,
      providers: [row.provider],
      sources: [row.source],
    });
  });
}

function summarizeConsolidatedDuplicateRiskEmails({
  softoraDuplicateRecipients = [],
  softoraDuplicateDomains = [],
  softoraDuplicateCompanies = [],
  webdesignContactDuplicateDomains = [],
  multiProviderGuardRecipients = [],
  multiProviderGuardDomains = [],
  multiProviderGuardCompanies = [],
  legacyCombinedSoftoraDuplicateRecipients = [],
  legacyCombinedSoftoraDuplicateDomains = [],
  legacyCombinedSoftoraDuplicateCompanies = [],
} = {}) {
  const risksByEmail = new Map();
  [
    ...softoraDuplicateRecipients,
    ...softoraDuplicateDomains,
    ...softoraDuplicateCompanies,
  ].forEach((duplicate) => addSendRiskRows(risksByEmail, duplicate, 'hard_softora_duplicate'));
  [
    ...legacyCombinedSoftoraDuplicateRecipients,
    ...legacyCombinedSoftoraDuplicateDomains,
    ...legacyCombinedSoftoraDuplicateCompanies,
  ].forEach((duplicate) => addSendRiskRows(risksByEmail, duplicate, 'legacy_softora_duplicate'));
  webdesignContactDuplicateDomains.forEach((duplicate) =>
    addSendRiskRows(risksByEmail, duplicate, 'webdesign_contact_repeat')
  );
  [
    ...multiProviderGuardRecipients,
    ...multiProviderGuardDomains,
    ...multiProviderGuardCompanies,
  ].forEach((overlap) => addProviderRiskRows(risksByEmail, overlap, 'cross_provider_overlap'));

  return [...risksByEmail.values()]
    .map((entry) => {
      const datedEvidence = entry.evidence
        .filter((item) => item.at)
        .sort((a, b) => a.at.localeCompare(b.at));
      return {
        email: entry.email,
        riskTypes: [...entry.riskTypes].sort(),
        providers: [...entry.providers].sort(),
        sources: [...entry.sources].sort(),
        companies: [...entry.companies].sort(),
        evidenceCount: entry.evidence.length,
        firstAt: datedEvidence[0]?.at || '',
        lastAt: datedEvidence[datedEvidence.length - 1]?.at || '',
        evidence: entry.evidence
          .slice()
          .map(({ evidenceKey, ...item }) => item)
          .sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.riskTypes.join(',').localeCompare(b.riskTypes.join(','))),
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

function summarizeMailboxCoverage(messages = [], syncStates = []) {
  const syncByAccountFolder = new Map();
  syncStates.forEach((state) => {
    const account = normalizeEmail(state && state.account_email);
    const folder = normalizeString(state && state.folder).toLowerCase();
    if (!account || !folder) return;
    syncByAccountFolder.set(`${account}|${folder}`, state);
  });

  return SENDERS.map((account) => {
    const rows = messages.filter((message) => normalizeEmail(message.account_email) === account);
    const sentRows = rows.filter((message) => isSentFolder(message.folder));
    const inboxRows = rows.filter((message) => normalizeString(message.folder).toLowerCase() === 'inbox');
    const sentDates = sentRows
      .map((message) => parseDate(message.date || message.internal_date))
      .filter(Boolean)
      .map((date) => date.toISOString())
      .sort();
    const sentSync = syncByAccountFolder.get(`${account}|sent`) || null;
    const sentSyncCount = Number(sentSync && sentSync.message_count) || 0;
    const sentSyncStatus = normalizeString(sentSync && sentSync.status);
    const sentSyncLockExpiresAt = normalizeString(sentSync && sentSync.lock_expires_at);
    const sentSyncLockExpiresMs = Date.parse(sentSyncLockExpiresAt);
    const sentSyncLockExpired =
      Number.isFinite(sentSyncLockExpiresMs) && sentSyncLockExpiresMs <= Date.now();
    const warnings = [];
    const notes = [];
    if (!sentRows.length) notes.push('sent_index_empty_monitoring_only');
    if (!sentSync) warnings.push('sent_sync_state_missing');
    if (sentSyncStatus === 'error') warnings.push('sent_sync_error');
    if (sentSyncStatus === 'syncing' && sentSyncLockExpiresAt && !sentSyncLockExpired) {
      notes.push('sent_sync_active_lock_monitoring_only');
    }
    if (sentSyncStatus === 'syncing' && sentSyncLockExpired) {
      notes.push('sent_sync_stale_lock_monitoring_only');
    }
    if (sentSyncCount >= MAILBOX_SYNC_LIMIT_HINT) notes.push('sent_sync_limit_reached_monitoring_only');
    return {
      accountEmail: account,
      totalIndexedRows: rows.length,
      sentIndexedRows: sentRows.length,
      inboxIndexedRows: inboxRows.length,
      sentFirstAt: sentDates[0] || '',
      sentLastAt: sentDates[sentDates.length - 1] || '',
      sentSyncStatus,
      sentSyncLastSyncedAt: normalizeString(sentSync && sentSync.last_synced_at),
      sentSyncMessageCount: sentSyncCount,
      sentSyncLastUid: Number(sentSync && sentSync.last_uid) || 0,
      sentSyncLockExpiresAt,
      warnings,
      notes,
    };
  });
}

function summarizeCoverageWarnings(mailboxCoverage = []) {
  return mailboxCoverage.filter((item) => Array.isArray(item.warnings) && item.warnings.length);
}

function summarizeCoverageNotes(mailboxCoverage = []) {
  return mailboxCoverage.filter((item) => Array.isArray(item.notes) && item.notes.length);
}

function buildReport({
  events,
  contactEvents = [],
  guards,
  missing,
  insertedRows = [],
  options = {},
  mailboxCoverage = [],
  legacyEvents = [],
}) {
  const postPauseAfter = parseDate(options.postPauseAfter);
  const missingEmails = [...new Set(missing.map((item) => item.event.recipientEmail))].sort();
  const postPauseEvents = postPauseAfter
    ? events.filter((event) => {
        if (event.source === 'send_guard') return false;
        if (event.source === 'customer_sent' && event.datePrecision === 'day') return false;
        return parseDate(event.date) > postPauseAfter;
      })
    : [];
  const eventSourceCounts = events.reduce((acc, event) => {
    const source = normalizeString(event && event.source) || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  const missingByType = missing.reduce((acc, item) => {
    acc[item.keyType] = (acc[item.keyType] || 0) + 1;
    return acc;
  }, {});
  const mailboxEvents = events.filter((event) => !event.source || event.source === 'mailbox_sent');
  const softoraDuplicateRecipients = summarizeSoftoraDuplicateRecipients(events);
  const softoraDuplicateDomains = summarizeSoftoraDuplicateDomains(events);
  const softoraDuplicateCompanies = summarizeSoftoraDuplicateCompanies(events);
  const webdesignContactDuplicateDomains = summarizeWebdesignContactDuplicateDomains(contactEvents);
  const multiProviderGuardDomains = summarizeMultiProviderGuardDomains(guards);
  const multiProviderGuardCompanies = summarizeMultiProviderGuardCompanies(guards);
  const multiProviderGuardRecipients = summarizeMultiProviderGuards(guards);
  const legacyCombinedEvents = dedupeOutboundEvents([...events, ...legacyEvents]);
  const legacyCombinedDuplicateRecipients = summarizeSoftoraDuplicateRecipients(legacyCombinedEvents);
  const legacyCombinedDuplicateDomains = summarizeSoftoraDuplicateDomains(legacyCombinedEvents);
  const legacyCombinedDuplicateCompanies = summarizeSoftoraDuplicateCompanies(legacyCombinedEvents);
  const consolidatedDuplicateRiskEmails = summarizeConsolidatedDuplicateRiskEmails({
    softoraDuplicateRecipients,
    softoraDuplicateDomains,
    softoraDuplicateCompanies,
    webdesignContactDuplicateDomains,
    multiProviderGuardRecipients,
    multiProviderGuardDomains,
    multiProviderGuardCompanies,
    legacyCombinedSoftoraDuplicateRecipients: legacyEvents.length ? legacyCombinedDuplicateRecipients : [],
    legacyCombinedSoftoraDuplicateDomains: legacyEvents.length ? legacyCombinedDuplicateDomains : [],
    legacyCombinedSoftoraDuplicateCompanies: legacyEvents.length ? legacyCombinedDuplicateCompanies : [],
  });
  const mailboxCoverageWarnings = summarizeCoverageWarnings(mailboxCoverage);
  const mailboxCoverageNotes = summarizeCoverageNotes(mailboxCoverage);
  const blockingProblems = [];
  if (missing.length) {
    blockingProblems.push({
      code: 'missing_central_outbound_guard',
      count: missing.length,
    });
  }
  const historicalWarnings = [];
  if (postPauseEvents.length) {
    historicalWarnings.push({
      code: 'historical_post_pause_initial_sends',
      count: postPauseEvents.length,
    });
  }
  if (consolidatedDuplicateRiskEmails.length) {
    historicalWarnings.push({
      code: 'historical_duplicate_contact_risks',
      count: consolidatedDuplicateRiskEmails.length,
    });
  }
  return {
    ok: blockingProblems.length === 0,
    mode: options.apply ? 'apply' : 'check',
    generatedAt: new Date().toISOString(),
    blockingProblems,
    historicalWarnings,
    summary: {
      outboundEvidenceEvents: events.length,
      eventSourceCounts,
      mailboxSentInitialWebdesignEvents: mailboxEvents.length,
      customerSentWebdesignEvents: eventSourceCounts.customer_sent || 0,
      sendGuardOutboundEvents: eventSourceCounts.send_guard || 0,
      uniqueMailboxRecipients: new Set(mailboxEvents.map((event) => event.recipientEmail)).size,
      uniqueOutboundRecipients: new Set(events.map((event) => event.recipientEmail).filter(Boolean)).size,
      centralGuardRows: guards.length,
      missingGuardKeys: missing.length,
      missingRecipients: missingEmails.length,
      missingByType,
      insertedGuardRows: insertedRows.length,
      postPauseInitialSends: postPauseEvents.length,
      mailboxDuplicateRecipients: summarizeMailboxDuplicates(events).length,
      softoraDuplicateRecipients: softoraDuplicateRecipients.length,
      softoraDuplicateDomains: softoraDuplicateDomains.length,
      softoraDuplicateCompanies: softoraDuplicateCompanies.length,
      webdesignContactDuplicateDomains: webdesignContactDuplicateDomains.length,
      multiProviderGuardRecipients: multiProviderGuardRecipients.length,
      multiProviderGuardDomains: multiProviderGuardDomains.length,
      multiProviderGuardCompanies: multiProviderGuardCompanies.length,
      consolidatedDuplicateRiskEmails: consolidatedDuplicateRiskEmails.length,
      legacyCustomerSentEvents: legacyEvents.length,
      legacyCombinedSoftoraDuplicateRecipients: legacyCombinedDuplicateRecipients.length,
      legacyCombinedSoftoraDuplicateDomains: legacyCombinedDuplicateDomains.length,
      legacyCombinedSoftoraDuplicateCompanies: legacyCombinedDuplicateCompanies.length,
      mailboxCoverageWarnings: mailboxCoverageWarnings.length,
      mailboxCoverageNotes: mailboxCoverageNotes.length,
      mailboxSentIndexEmpty: mailboxCoverage.filter(
        (item) =>
          (Array.isArray(item.warnings) && item.warnings.includes('sent_index_empty')) ||
          (Array.isArray(item.notes) && item.notes.includes('sent_index_empty_monitoring_only'))
      ).length,
      mailboxSentIndexEmptyMonitoringOnly: mailboxCoverage.filter((item) => Array.isArray(item.notes) && item.notes.includes('sent_index_empty_monitoring_only')).length,
      mailboxSentSyncLimitReached: mailboxCoverage.filter(
        (item) =>
          (Array.isArray(item.warnings) && item.warnings.includes('sent_sync_limit_reached')) ||
          (Array.isArray(item.notes) && item.notes.includes('sent_sync_limit_reached_monitoring_only'))
      ).length,
      mailboxSentSyncLimitReachedMonitoringOnly: mailboxCoverage.filter((item) => Array.isArray(item.notes) && item.notes.includes('sent_sync_limit_reached_monitoring_only')).length,
      mailboxSentSyncStaleLockMonitoringOnly: mailboxCoverage.filter((item) => Array.isArray(item.notes) && item.notes.includes('sent_sync_stale_lock_monitoring_only')).length,
    },
    missingRecipients: missingEmails,
    missingSamples: missing.slice(0, options.sample || 15).map((item) => ({
      guardKey: item.guardKey,
      keyType: item.keyType,
      email: item.event.recipientEmail,
      company: item.event.company,
      customerId: item.event.customerId,
      sentAt: item.event.date,
      senderEmail: item.event.accountEmail,
      subject: item.event.subject,
    })),
    postPauseEvents: postPauseEvents.map((event) => ({
      source: event.source,
      email: event.recipientEmail,
      company: event.company,
      sentAt: event.date,
      senderEmail: event.accountEmail,
      subject: event.subject,
    })),
    mailboxDuplicateRecipients: summarizeMailboxDuplicates(events),
    softoraDuplicateRecipients,
    softoraDuplicateDomains,
    softoraDuplicateCompanies,
    webdesignContactDuplicateDomains,
    multiProviderGuardRecipients,
    multiProviderGuardDomains,
    multiProviderGuardCompanies,
    consolidatedDuplicateRiskEmails,
    legacyCombinedSoftoraDuplicateRecipients: legacyCombinedDuplicateRecipients,
    legacyCombinedSoftoraDuplicateDomains: legacyCombinedDuplicateDomains,
    legacyCombinedSoftoraDuplicateCompanies: legacyCombinedDuplicateCompanies,
    mailboxCoverage,
    mailboxCoverageWarnings,
    mailboxCoverageNotes,
  };
}

function formatAmsterdam(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function printHuman(report) {
  console.log('Coldmail centrale guard audit');
  console.log(`- Outbound bewijs-events: ${report.summary.outboundEvidenceEvents}`);
  console.log(`- Mailbox-sent webdesign events: ${report.summary.mailboxSentInitialWebdesignEvents}`);
  console.log(`- Customer-send webdesign events: ${report.summary.customerSentWebdesignEvents}`);
  console.log(`- Oude send_guard events: ${report.summary.sendGuardOutboundEvents}`);
  console.log(`- Unieke ontvangers: ${report.summary.uniqueMailboxRecipients}`);
  console.log(`- Centrale guard-rijen gelezen: ${report.summary.centralGuardRows}`);
  console.log(`- Ontbrekende guard-keys: ${report.summary.missingGuardKeys}`);
  console.log(`- Ontbrekende ontvangers: ${report.summary.missingRecipients}`);
  console.log(`- Ingevoegde guard-rijen: ${report.summary.insertedGuardRows}`);
  console.log(`- Sends na pauzemoment: ${report.summary.postPauseInitialSends}`);
  console.log(`- Mailbox-dubbel ontvangers: ${report.summary.mailboxDuplicateRecipients}`);
  console.log(`- Softora-dubbel ontvangers uit alle bewijsbronnen: ${report.summary.softoraDuplicateRecipients}`);
  console.log(`- Softora-dubbel domeinen uit alle bewijsbronnen: ${report.summary.softoraDuplicateDomains}`);
  console.log(`- Softora-dubbel bedrijven uit alle bewijsbronnen: ${report.summary.softoraDuplicateCompanies}`);
  console.log(`- Webdesign-contact domeinen met meerdere outbound berichten: ${report.summary.webdesignContactDuplicateDomains}`);
  console.log(`- Multi-provider guard ontvangers: ${report.summary.multiProviderGuardRecipients}`);
  console.log(`- Multi-provider guard domeinen: ${report.summary.multiProviderGuardDomains}`);
  console.log(`- Multi-provider guard bedrijven: ${report.summary.multiProviderGuardCompanies}`);
  console.log(`- Geconsolideerde dubbelcontact-risico e-mails: ${report.summary.consolidatedDuplicateRiskEmails}`);
  console.log(`- Legacy customer-send events: ${report.summary.legacyCustomerSentEvents}`);
  console.log(`- Legacy-gecombineerde Softora-dubbel ontvangers: ${report.summary.legacyCombinedSoftoraDuplicateRecipients}`);
  console.log(`- Audit-blockers: ${report.blockingProblems.length}`);
  console.log(`- Historische audit-waarschuwingen: ${report.historicalWarnings.length}`);
  console.log(`- Mailbox coverage waarschuwingen: ${report.summary.mailboxCoverageWarnings}`);
  console.log(`- Mailbox coverage monitor-notes: ${report.summary.mailboxCoverageNotes}`);
  console.log(`- Mailbox sent-index leeg (monitoring-only): ${report.summary.mailboxSentIndexEmptyMonitoringOnly}`);
  console.log(`- Mailbox sent-sync limiet geraakt (monitoring-only): ${report.summary.mailboxSentSyncLimitReachedMonitoringOnly}`);
  if (report.mailboxCoverageWarnings.length) {
    console.log('\nMailbox coverage waarschuwingen:');
    console.table(
      report.mailboxCoverageWarnings.map((item) => ({
        mailbox: item.accountEmail,
        sentRows: item.sentIndexedRows,
        syncStatus: item.sentSyncStatus,
        syncCount: item.sentSyncMessageCount,
        waarschuwingen: item.warnings.join(', '),
      }))
    );
  }
  if (report.mailboxCoverageNotes.length) {
    console.log('\nMailbox coverage monitor-notes:');
    console.table(
      report.mailboxCoverageNotes.map((item) => ({
        mailbox: item.accountEmail,
        sentRows: item.sentIndexedRows,
        syncStatus: item.sentSyncStatus,
        syncCount: item.sentSyncMessageCount,
        notes: item.notes.join(', '),
      }))
    );
  }
  if (report.missingSamples.length) {
    console.log('\nOntbrekende voorbeelden:');
    console.table(
      report.missingSamples.map((item) => ({
        type: item.keyType,
        email: item.email,
        bedrijf: item.company,
        verzonden: formatAmsterdam(item.sentAt),
        afzender: item.senderEmail,
      }))
    );
  }
  if (report.consolidatedDuplicateRiskEmails.length) {
    console.log('\nGeconsolideerde dubbelcontact-risico e-mails:');
    console.table(
      report.consolidatedDuplicateRiskEmails.map((item) => ({
        email: item.email,
        types: item.riskTypes.join(', '),
        eerste: formatAmsterdam(item.firstAt),
        laatste: formatAmsterdam(item.lastAt),
        bewijsregels: item.evidenceCount,
      }))
    );
  }
  if (report.postPauseEvents.length) {
    console.log('\nSends na pauzemoment:');
    console.table(
      report.postPauseEvents.map((item) => ({
        email: item.email,
        bedrijf: item.company,
        verzonden: formatAmsterdam(item.sentAt),
        afzender: item.senderEmail,
      }))
    );
  }
}

async function upsertMissingRows(client, missing = []) {
  const rows = groupMissingRowsForInsert(missing);
  if (!rows.length) return [];
  const { data, error } = await client
    .from('softora_outbound_recipient_guards')
    .upsert(rows, { onConflict: 'guard_key' })
    .select('guard_key');
  if (error) throw new Error(`Backfill upsert mislukt: ${error.message || error}`);
  return Array.isArray(data) ? data : rows.map((row) => ({ guard_key: row.guard_key }));
}

async function readUiState(client, stateTable, scope) {
  const stateKey = `ui_state:${scope}`;
  const { data, error } = await client
    .from(stateTable)
    .select('state_key,payload,meta,updated_at')
    .eq('state_key', stateKey)
    .maybeSingle();
  if (error) throw new Error(`${stateKey} lezen mislukt: ${error.message || error}`);
  return data || { state_key: stateKey, payload: { scope, values: {} }, meta: { type: 'ui_state', scope } };
}

async function writeUiState(client, stateTable, scope, values, meta = {}) {
  const stateKey = `ui_state:${scope}`;
  const row = {
    state_key: stateKey,
    payload: { scope, values },
    meta: {
      type: 'ui_state',
      scope,
      source: normalizeString(meta.source || 'coldmail-guard-monitor'),
      actor: normalizeString(meta.actor || 'codex:coldmail-guard-monitor'),
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from(stateTable).upsert(row, { onConflict: 'state_key' });
  if (error) throw new Error(`${stateKey} schrijven mislukt: ${error.message || error}`);
}

function parseStateJson(values, key, fallback) {
  try {
    const parsed = JSON.parse(normalizeString(values && values[key]) || JSON.stringify(fallback));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

async function pauseAutopilotForMissingGuard(client, stateTable, report) {
  if (!report.summary.missingGuardKeys) return false;
  const now = new Date();
  const until = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const sendGuardRow = await readUiState(client, stateTable, SEND_GUARD_SCOPE);
  const sendGuardValues = sendGuardRow.payload?.values || {};
  const sendGuardState = parseStateJson(sendGuardValues, SEND_GUARD_KEY, { entries: [] });
  sendGuardState.entries = Array.isArray(sendGuardState.entries) ? sendGuardState.entries : [];
  sendGuardState.entries.push({
    at: now.toISOString(),
    senderEmail: '',
    count: 0,
    personalCount: 0,
    safetyPauseUntil: until,
    safetyPauseReason: MONITOR_PAUSE_REASON,
    missingGuardKeys: report.summary.missingGuardKeys,
  });
  await writeUiState(
    client,
    stateTable,
    SEND_GUARD_SCOPE,
    {
      ...sendGuardValues,
      [SEND_GUARD_KEY]: JSON.stringify(sendGuardState),
    },
    { source: 'coldmail-guard-monitor', actor: 'codex:coldmail-guard-monitor' }
  );

  const autopilotRow = await readUiState(client, stateTable, AUTOPILOT_SCOPE);
  const autopilotValues = autopilotRow.payload?.values || {};
  const autopilotState = parseStateJson(autopilotValues, AUTOPILOT_KEY, {});
  autopilotState.enabled = false;
  autopilotState.emergencyStoppedAt = now.toISOString();
  autopilotState.emergencyStopReason = MONITOR_PAUSE_REASON;
  autopilotState.safetyPauseUntil = until;
  await writeUiState(
    client,
    stateTable,
    AUTOPILOT_SCOPE,
    {
      ...autopilotValues,
      [AUTOPILOT_KEY]: JSON.stringify(autopilotState),
    },
    { source: 'coldmail-guard-monitor', actor: 'codex:coldmail-guard-monitor' }
  );
  return true;
}

async function loadLiveData(client, stateTable, options = {}) {
  const [messages, customers, guards, sendGuardRow, legacyCustomerRow, mailboxSyncStates] = await Promise.all([
    fetchAll(
      client,
      'softora_mailbox_messages',
      'message_key,account_email,folder,uid,provider_id,message_id,recipients_text,subject,preview,body_text,date,internal_date,payload,deleted_at',
      (query) => query.in('account_email', SENDERS).order('date', { ascending: true })
    ),
    fetchAll(
      client,
      'softora_customers',
      'customer_id,identity_key,company,email,website,database_status,lifecycle_status,payload,deleted_at',
      (query) => query.is('deleted_at', null)
    ),
    fetchAll(
      client,
      'softora_outbound_recipient_guards',
      'guard_key,key_type,key_value,provider,channel,recipient_email,recipient_domain,recipient_company_key,recipient_id,recipient_company,status,source,permanent,last_seen_at',
      (query) => query.order('updated_at', { ascending: false })
    ),
    readUiState(client, stateTable, SEND_GUARD_SCOPE),
    readUiState(client, stateTable, LEGACY_CUSTOMER_SCOPE),
    fetchAll(
      client,
      'softora_mailbox_sync_state',
      'account_email,folder,status,last_synced_at,last_uid,message_count,last_error,lock_expires_at',
      (query) => query.in('account_email', SENDERS).order('account_email', { ascending: true })
    ),
  ]);
  const customerIndexes = buildCustomerIndexes(customers);
  const sendGuardValues = sendGuardRow.payload?.values || {};
  const sendGuardState = parseStateJson(sendGuardValues, SEND_GUARD_KEY, { entries: [], recipientEntries: [] });
  const legacyCustomers = buildLegacyCustomerRowsFromUiState(legacyCustomerRow);
  const legacyEvents = buildCustomerSentEvents(legacyCustomers, options);
  const events = dedupeOutboundEvents([
    ...buildMailboxSentEvents(messages, customerIndexes, options),
    ...buildCustomerSentEvents(customers, options),
    ...buildSendGuardEvents(sendGuardState, customerIndexes, options),
  ]);
  const contactEvents = buildMailboxWebdesignContactEvents(messages, customerIndexes, options);
  const guardEvidenceEvents = dedupeOutboundEvents([...events, ...contactEvents]);
  const missing = findMissingGuardKeys(guardEvidenceEvents, guards);
  const mailboxCoverage = summarizeMailboxCoverage(messages, mailboxSyncStates);
  return { events, contactEvents, customers, guards, sendGuardState, missing, mailboxCoverage, legacyEvents };
}

async function run(options) {
  loadEnv(options);
  const { client, stateTable } = createSupabaseClientFromEnv();
  const live = await loadLiveData(client, stateTable, options);
  let insertedRows = [];
  if (options.apply && live.missing.length) {
    insertedRows = await upsertMissingRows(client, live.missing);
    const reloaded = await loadLiveData(client, stateTable, options);
    const report = buildReport({ ...reloaded, insertedRows, options });
    return { report, paused: options.pauseOnMissing ? await pauseAutopilotForMissingGuard(client, stateTable, report) : false };
  }
  const report = buildReport({ ...live, insertedRows, options });
  const paused = options.pauseOnMissing ? await pauseAutopilotForMissingGuard(client, stateTable, report) : false;
  return { report, paused };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { report, paused } = await run(options);
  if (options.json) {
    console.log(JSON.stringify({ ...report, paused }, null, 2));
  } else {
    printHuman(report);
    if (paused) console.log('\nAutopilot is gepauzeerd door de centrale guard-monitor.');
  }
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[coldmail-guard-backfill] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  BACKFILL_SOURCE,
  MONITOR_PAUSE_REASON,
  buildCustomerIndexes,
  buildCustomerSentEvents,
  buildLegacyCustomerRowsFromUiState,
  buildMailboxSentEvents,
  buildMailboxWebdesignContactEvents,
  buildReport,
  buildSendGuardEvents,
  extractRecipientEmails,
  findMissingGuardKeys,
  groupMissingRowsForInsert,
  isInitialWebdesignMail,
  parseArgs,
  summarizeMailboxCoverage,
  summarizeConsolidatedDuplicateRiskEmails,
  summarizeMultiProviderGuards,
  summarizeMultiProviderGuardCompanies,
  summarizeMultiProviderGuardDomains,
  summarizeSoftoraDuplicateRecipients,
  summarizeSoftoraDuplicateCompanies,
  summarizeSoftoraDuplicateDomains,
  summarizeWebdesignContactDuplicateDomains,
};
