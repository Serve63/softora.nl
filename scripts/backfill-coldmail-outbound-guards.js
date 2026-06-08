#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const { createHash } = require('crypto');

const { loadRuntimeEnv } = require('../server/config/runtime-env');
const { createSupabaseStateStore } = require('../server/services/supabase-state');
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
    event.keyRows.forEach((keyRow) => {
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
  events
    .filter((event) => {
      if (!event.source || event.source === 'mailbox_sent') return true;
      return event.source === 'customer_sent' && event.datePrecision !== 'day';
    })
    .forEach((event) => {
    const email = normalizeEmail(event && event.recipientEmail);
    if (!email) return;
    const rows = byEmail.get(email) || [];
    rows.push(event);
    byEmail.set(email, rows);
  });
  const duplicates = [];
  byEmail.forEach((rows, email) => {
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
    if (sendBuckets.length <= 1) return;
    duplicates.push({
      email,
      count: sendBuckets.length,
      sends: sendBuckets.map((bucket) => ({
        at: bucket.sentAt,
        senderEmail: bucket.senderEmail,
        sources: [...bucket.sources].sort(),
        subjects: [...new Set(bucket.events.map((event) => normalizeString(event.subject)).filter(Boolean))],
      })),
    });
  });
  return duplicates.sort((a, b) => a.email.localeCompare(b.email));
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

function buildReport({ events, guards, missing, insertedRows = [], options = {} }) {
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
  return {
    ok: missing.length === 0 && postPauseEvents.length === 0,
    mode: options.apply ? 'apply' : 'check',
    generatedAt: new Date().toISOString(),
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
      softoraDuplicateRecipients: summarizeSoftoraDuplicateRecipients(events).length,
      multiProviderGuardRecipients: summarizeMultiProviderGuards(guards).length,
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
    softoraDuplicateRecipients: summarizeSoftoraDuplicateRecipients(events),
    multiProviderGuardRecipients: summarizeMultiProviderGuards(guards),
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
  console.log(`- Multi-provider guard ontvangers: ${report.summary.multiProviderGuardRecipients}`);
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
  if (!report.summary.missingGuardKeys && !report.summary.postPauseInitialSends) return false;
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
    postPauseInitialSends: report.summary.postPauseInitialSends,
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
  const [messages, customers, guards, sendGuardRow] = await Promise.all([
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
  ]);
  const customerIndexes = buildCustomerIndexes(customers);
  const sendGuardValues = sendGuardRow.payload?.values || {};
  const sendGuardState = parseStateJson(sendGuardValues, SEND_GUARD_KEY, { entries: [], recipientEntries: [] });
  const events = dedupeOutboundEvents([
    ...buildMailboxSentEvents(messages, customerIndexes, options),
    ...buildCustomerSentEvents(customers, options),
    ...buildSendGuardEvents(sendGuardState, customerIndexes, options),
  ]);
  const missing = findMissingGuardKeys(events, guards);
  return { events, customers, guards, sendGuardState, missing };
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
  buildMailboxSentEvents,
  buildReport,
  buildSendGuardEvents,
  extractRecipientEmails,
  findMissingGuardKeys,
  groupMissingRowsForInsert,
  isInitialWebdesignMail,
  parseArgs,
  summarizeSoftoraDuplicateRecipients,
};
