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

function getEmailDomain(email) {
  return normalizeDomain(String(email || '').split('@')[1] || '');
}

function isSharedMailboxDomain(domain) {
  return SHARED_MAILBOX_DOMAINS.has(normalizeDomain(domain));
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

function buildGuardSet(guards = []) {
  return new Set(
    guards
      .map((guard) => normalizeString(guard && guard.guard_key))
      .filter(Boolean)
  );
}

function findMissingGuardKeys(events = [], guards = []) {
  const guardSet = buildGuardSet(guards);
  const missing = [];
  events.forEach((event) => {
    event.keyRows.forEach((keyRow) => {
      if (!guardSet.has(keyRow.guardKey)) {
        missing.push({
          guardKey: keyRow.guardKey,
          keyType: keyRow.keyType,
          keyValue: keyRow.keyValue,
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
  events.forEach((event) => {
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
    ? events.filter((event) => parseDate(event.date) > postPauseAfter)
    : [];
  const missingByType = missing.reduce((acc, item) => {
    acc[item.keyType] = (acc[item.keyType] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: missing.length === 0 && postPauseEvents.length === 0,
    mode: options.apply ? 'apply' : 'check',
    generatedAt: new Date().toISOString(),
    summary: {
      mailboxSentInitialWebdesignEvents: events.length,
      uniqueMailboxRecipients: new Set(events.map((event) => event.recipientEmail)).size,
      centralGuardRows: guards.length,
      missingGuardKeys: missing.length,
      missingRecipients: missingEmails.length,
      missingByType,
      insertedGuardRows: insertedRows.length,
      postPauseInitialSends: postPauseEvents.length,
      mailboxDuplicateRecipients: summarizeMailboxDuplicates(events).length,
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
      email: event.recipientEmail,
      company: event.company,
      sentAt: event.date,
      senderEmail: event.accountEmail,
      subject: event.subject,
    })),
    mailboxDuplicateRecipients: summarizeMailboxDuplicates(events),
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
  console.log(`- Mailbox-sent webdesign events: ${report.summary.mailboxSentInitialWebdesignEvents}`);
  console.log(`- Unieke ontvangers: ${report.summary.uniqueMailboxRecipients}`);
  console.log(`- Centrale guard-rijen gelezen: ${report.summary.centralGuardRows}`);
  console.log(`- Ontbrekende guard-keys: ${report.summary.missingGuardKeys}`);
  console.log(`- Ontbrekende ontvangers: ${report.summary.missingRecipients}`);
  console.log(`- Ingevoegde guard-rijen: ${report.summary.insertedGuardRows}`);
  console.log(`- Sends na pauzemoment: ${report.summary.postPauseInitialSends}`);
  console.log(`- Mailbox-dubbel ontvangers: ${report.summary.mailboxDuplicateRecipients}`);
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

async function insertMissingRows(client, missing = []) {
  const rows = groupMissingRowsForInsert(missing);
  if (!rows.length) return [];
  const { data, error } = await client
    .from('softora_outbound_recipient_guards')
    .insert(rows)
    .select('guard_key');
  if (error) throw new Error(`Backfill insert mislukt: ${error.message || error}`);
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

async function loadLiveData(client, options = {}) {
  const [messages, customers, guards] = await Promise.all([
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
  ]);
  const customerIndexes = buildCustomerIndexes(customers);
  const events = buildMailboxSentEvents(messages, customerIndexes, options);
  const missing = findMissingGuardKeys(events, guards);
  return { events, customers, guards, missing };
}

async function run(options) {
  loadEnv(options);
  const { client, stateTable } = createSupabaseClientFromEnv();
  const live = await loadLiveData(client, options);
  let insertedRows = [];
  if (options.apply && live.missing.length) {
    insertedRows = await insertMissingRows(client, live.missing);
    const reloaded = await loadLiveData(client, options);
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
  buildMailboxSentEvents,
  buildReport,
  extractRecipientEmails,
  findMissingGuardKeys,
  groupMissingRowsForInsert,
  isInitialWebdesignMail,
  parseArgs,
};
