const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { buildChunkedStatePatch, readChunkedStateValue } = require('./data-ops-serialization');
const { createMailboxService } = require('./mailbox');
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');
const { appendSentMessage } = require('./mailbox-sent-copy');
const { buildOpenAiContextHeaders } = require('./openai-request-context');

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_LEAD_DB_SCOPE = 'coldcalling';
const DEFAULT_LEAD_DB_KEY = 'softora_coldcalling_lead_rows_json';
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_COLDMAIL_REPLY_SCOPE = 'premium_coldmail_auto_replies';
const DEFAULT_COLDMAIL_REPLY_KEY = 'softora_coldmail_auto_replies_v1';
const DEFAULT_COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const DEFAULT_COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const DEFAULT_COLDMAILING_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const DEFAULT_COLDMAILING_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
const DEFAULT_COLDMAIL_AUTOPILOT_SCOPE = 'premium_coldmail_autopilot';
const DEFAULT_COLDMAIL_AUTOPILOT_KEY = 'softora_coldmail_autopilot_v1';
const DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT = 30;
const DEFAULT_COLDMAIL_DAILY_SEND_LIMIT = 30;
const DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT = 60;
const DEFAULT_COLDMAIL_SEND_DELAY_MS = 90_000;
const DEFAULT_COLDMAIL_SAFETY_PAUSE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT = 10;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS = 180_000;
const DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE = 3;
const DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS = 12 * 60 * 1000;
const DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE = 'Europe/Amsterdam';
const DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR = 9;
const DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR = 17;
const DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES = 12;
const MAX_COLDMAIL_RADIUS_KM = 500;
const COLDMAIL_SEND_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLDMAIL_AUTOPILOT_KNOWN_SKIP_CODES = new Set([
  'COLDMAIL_DAILY_LIMIT_REACHED',
  'COLDMAIL_SAFETY_PAUSED',
  'COLDMAIL_SEND_IN_PROGRESS',
  'EMPTY_MAIL_CONTENT',
  'NO_RECIPIENTS',
  'NO_SENDER_CAPACITY',
  'NO_VALID_RECIPIENT_DOMAINS',
  'NO_WEBDESIGN_PHOTOS',
  'SENDER_SMTP_NOT_CONFIGURED',
  'SMTP_NOT_CONFIGURED',
  'SMTP_TRANSPORT_UNAVAILABLE',
]);
const COLDMAIL_SMTP_SAFETY_STOP_PATTERN =
  /\b(transmit rate limit|rate limited|too many recipients|too many messages|too many concurrent|no spam please|b-url|b-text|b-score|b-ex|suspected phishing|spam detected|spamverdacht|spam complaint|mailbox is blocked|mailbox is disabled|mailbox restricted|account restricted|account suspended|not allowed to send|sender not authorized|no authorization to send|mailversand gesperrt|versand gesperrt|versandlimit|sperrung|verzendlimiet|verzendblokkade|geblokkeerd|blokkade|dmarc|spf failed|spf|insufficient privacy|tls required)\b/i;
const COLDMAIL_PROVIDER_WARNING_SENDER_PATTERN =
  /\b(strato|mailer-daemon|postmaster|mail delivery|delivery subsystem|abuse|security|noreply|no-reply|support|kundenservice|customer service)\b/i;
const COLDMAIL_PROVIDER_WARNING_SUBJECT_PATTERN =
  /\b(strato|smtp|mailbox|mailserver|mail server|e-mail|email|account|delivery|bezorging|mail delivery|sending|verzenden|blocked|geblokkeerd|warning|waarschuwing|spam|phishing|dmarc|spf|rate limit|limiet|sperrung|versandlimit)\b/i;
const COLDMAIL_DELIVERY_FAILURE_PATTERN =
  /\b(delivery status notification|undeliverable|undelivered mail|mail delivery failed|delivery has failed|failure notice|returned mail|unzustellbar|unzustellbarkeitsmail|niet bezorgd|onbestelbaar|bezorging mislukt|final-recipient|diagnostic-code)\b/i;
const COLDMAIL_HARD_BOUNCE_PATTERN =
  /\b(user unknown|unknown user|no such user|mailbox unknown|mailbox not found|recipient unknown|unknown address|invalid recipient|invalid address|no such mailbox|unknown local part|not known to us|recipient address rejected|5\.1\.1|5\.1\.10|5\.0\.0)\b/i;
const COLDMAIL_SOFT_BOUNCE_PATTERN =
  /\b(mailbox full|quota exceeded|overquota|temporary failure|try again later|temporarily unavailable|deferred|greylist|greylisted|4\.[0-9]\.[0-9]|resources temporarily unavailable|user has exhausted allowed storage space)\b/i;
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
const COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_OPT_OUT_TEXT_PREFIX = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_UNSUBSCRIBE_PATH = '/afmelden';
const COLDMAIL_PREVIEW_IMAGE_PATH = '/coldmailing/webdesign-foto';
const COLDMAIL_MOCKUP_CAPTION = 'Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇';
const COLDMAIL_DESKTOP_IMAGE_MAX_WIDTH = 760;
const COLDMAIL_TEST_RECIPIENT_EMAIL = 'servec321@gmail.com';
const COLDMAIL_TEST_RECIPIENT_ID = 'softora-test-mode-recipient';
const TEST_RECIPIENT_EMAILS = new Set([COLDMAIL_TEST_RECIPIENT_EMAIL]);
const TEST_RECIPIENT_LOOKUP_EMAILS = new Set([COLDMAIL_TEST_RECIPIENT_EMAIL, 'servec321@gail.com']);
const TEST_RECIPIENT_COMPANIES = new Set(['mcv e-commerce', 'softora testmodus']);
const MARTIJN_LINKEDIN_CTA_TEXT = '💼 Mijn LinkedIn 👈';
const MARTIJN_LINKEDIN_URL =
  'https://www.linkedin.com/in/martijn-van-de-ven-51a5b61ba?utm_source=share_via&utm_content=profile&utm_medium=member_ios';
const COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS = new Set([
  'serve@softora.nl',
  'martijn@softora.nl',
]);
const SENDER_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
  'ruben@softora.nl': 'Ruben',
};
const COLDMAIL_LINKEDIN_CTA_BY_SENDER = Object.freeze({
  'martijn@softora.nl': {
    text: MARTIJN_LINKEDIN_CTA_TEXT,
    url: MARTIJN_LINKEDIN_URL,
  },
});
const DEFAULT_COLDMAIL_SENDER_PROFILES = {
  'serve@softora.nl': {
    subject: 'Korte vraag over uw website - Softora.nl',
    body: "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nServé Creusen\nSoftora.nl | +31 6 43 26 27 92",
    aiInstructions: "Pas de mail aan op basis van het bedrijf. Noem de naam van het bedrijf in de aanhef. Als het bedrijf een restaurant is, noem dan iets over hun online menu of reserveringen. Als het een bouwbedrijf is, noem dan portfolio of projectfoto's. Houd de mail kort - maximaal 5 zinnen. Vermijd verkooptaal.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'martijn@softora.nl': {
    subject: 'Korte vraag over uw website - Softora.nl',
    body: "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nMartijn van de Ven\nSoftora.nl",
    aiInstructions: "Pas de mail aan op basis van het bedrijf. Noem de naam van het bedrijf in de aanhef. Als het bedrijf een restaurant is, noem dan iets over hun online menu of reserveringen. Als het een bouwbedrijf is, noem dan portfolio of projectfoto's. Houd de mail kort - maximaal 5 zinnen. Vermijd verkooptaal.",
    toneStyle: 'Vriendelijk & professioneel',
  },
};
const COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS = new Set([
  'serve@softora.nl',
  'martijn@softora.nl',
]);
const EXCLUDED_DATABASE_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

function isExpectedDnsMiss(error) {
  return Boolean(
    error &&
      ['EBADNAME', 'ENODATA', 'ENODOMAIN', 'ENONAME', 'ENOTFOUND'].includes(String(error.code || '').toUpperCase())
  );
}

async function resolveEmailDomainWithDoh(domain) {
  const value = String(domain || '').trim().toLowerCase().replace(/\.+$/g, '');
  if (!value || typeof fetch !== 'function') return false;
  const queryTypes = ['MX', 'A', 'AAAA'];
  for (const type of queryTypes) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(value)}&type=${encodeURIComponent(type)}`;
      const response = await fetch(url, {
        headers: { accept: 'application/dns-json' },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => null);
      const answers = Array.isArray(payload && payload.Answer) ? payload.Answer : [];
      if (answers.some((answer) => String(answer && answer.data || '').replace(/\.+$/g, ''))) return true;
    } catch (_) {
      // DNS-over-HTTPS is a best-effort fallback for server resolver misses.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return false;
}

async function resolveEmailDomainWithDns(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!value) return false;
  try {
    const mxRecords = await dns.resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) return true;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
  }
  try {
    const addresses = await dns.resolve4(value);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
  }
  try {
    const addresses = await dns.resolve6(value);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
    return resolveEmailDomainWithDoh(value);
  }
}

function createColdmailCampaignService(deps = {}) {
  const {
    env = process.env,
    mailConfig = {},
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    leadDbScope = DEFAULT_LEAD_DB_SCOPE,
    leadDbKey = DEFAULT_LEAD_DB_KEY,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
    coldmailReplyScope = DEFAULT_COLDMAIL_REPLY_SCOPE,
    coldmailReplyKey = DEFAULT_COLDMAIL_REPLY_KEY,
    coldmailSendGuardScope = DEFAULT_COLDMAIL_SEND_GUARD_SCOPE,
    coldmailSendGuardKey = DEFAULT_COLDMAIL_SEND_GUARD_KEY,
    coldmailingSettingsScope = DEFAULT_COLDMAILING_SETTINGS_SCOPE,
    coldmailingSettingsKey = DEFAULT_COLDMAILING_SETTINGS_KEY,
    coldmailAutopilotScope = DEFAULT_COLDMAIL_AUTOPILOT_SCOPE,
    coldmailAutopilotKey = DEFAULT_COLDMAIL_AUTOPILOT_KEY,
    mailboxAccountsRaw = '',
    createTransport = (config) => nodemailer.createTransport(config),
    createImapClient = (config) => new ImapFlow(config),
    parseMailSource = (source) => simpleParser(source),
    resolveEmailDomain = resolveEmailDomainWithDns,
    getOpenAiApiKey = () => '',
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    extractOpenAiTextContent = null,
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    coldmailAutoReplyModel = 'gpt-5.5-pro',
    coldmailAutoReplyEnabled = false,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = deps;

  const {
    smtpHost = '',
    smtpPort = 587,
    smtpSecure = false,
    smtpUser = '',
    smtpPass = '',
    mailFromAddress = '',
    mailFromName = 'Softora',
    mailReplyTo = '',
    publicBaseUrl: mailPublicBaseUrl = '',
    coldmailUnsubscribeSecret = '',
    coldmailTrackingSecret = '',
    coldmailAuditBcc = '',
    imapHost = '',
    imapPort = 993,
    imapSecure = false,
    imapUser = '',
    imapPass = '',
    imapMailbox = 'INBOX',
    imapExtraMailboxes = [],
    imapPollCooldownMs = 20_000,
    coldmailBounceProcessingEnabled = true,
    coldmailCampaignSendLimit = DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
    coldmailDailySendLimit = DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
    coldmailPackageDailySendLimit = DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
    coldmailSendDelayMs = DEFAULT_COLDMAIL_SEND_DELAY_MS,
    coldmailSafetyPauseMs = DEFAULT_COLDMAIL_SAFETY_PAUSE_MS,
    coldmailPersonalMailboxDailyLimit = DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
    coldmailPersonalMailboxSendDelayMs = DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
    coldmailBlockPersonalMailboxDomains = false,
  } = mailConfig;

  let smtpTransporter = null;
  const senderSmtpTransporters = new Map();
  let coldmailCampaignSendPromise = null;
  const mailboxAccountService = createMailboxService({
    mailConfig: {
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      mailFromAddress,
      mailFromName,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPass,
    },
    mailboxAccountsRaw,
    normalizeString,
    truncateText,
  });

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

  function isLikelyValidEmail(value) {
    const email = normalizeEmailAddress(value);
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  function getMissingSmtpMailEnv() {
    return [
      !smtpHost ? 'MAIL_SMTP_HOST' : null,
      !smtpUser ? 'MAIL_SMTP_USER' : null,
      !smtpPass ? 'MAIL_SMTP_PASS' : null,
      !mailFromAddress ? 'MAIL_FROM_ADDRESS' : null,
    ].filter(Boolean);
  }

  function getMissingSenderSmtpEnv(senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    const localKey = envKeyForEmail(email);
    const fullKey = email.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    return [
      fullKey ? `MAILBOX_${fullKey}_PASS` : null,
      localKey ? `MAILBOX_${localKey}_PASS` : null,
      'MAIL_SMTP_PASS',
    ].filter(Boolean);
  }

  function isSenderSmtpAccountConfigured(account) {
    return Boolean(
      account &&
        account.smtpHost &&
        Number.isFinite(Number(account.smtpPort)) &&
        Number(account.smtpPort) > 0 &&
        account.smtpUser &&
        account.smtpPass
    );
  }

  function isSmtpMailConfigured() {
    if (isSenderSmtpAccountConfigured(buildBaseSmtpAccount())) return true;
    return getConfiguredMailboxSmtpAccounts().some(isSenderSmtpAccountConfigured);
  }

  function getMissingImapMailEnv() {
    return [
      !imapHost ? 'MAIL_IMAP_HOST' : null,
      !imapUser ? 'MAIL_IMAP_USER' : null,
      !imapPass ? 'MAIL_IMAP_PASS' : null,
    ].filter(Boolean);
  }

  function isImapMailConfigured() {
    return Boolean(
      imapHost &&
        Number.isFinite(Number(imapPort)) &&
        Number(imapPort) > 0 &&
        imapUser &&
        imapPass
    );
  }

  function getSmtpTransporter() {
    if (!isSmtpMailConfigured()) return null;
    if (smtpTransporter) return smtpTransporter;
    smtpTransporter = createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Boolean(smtpSecure),
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    return smtpTransporter;
  }

  function getConfiguredMailboxSmtpAccounts() {
    return mailboxAccountService
      .getAccounts()
      .filter((account) => account && account.smtpConfigured && isLikelyValidEmail(account.email));
  }

  function buildBaseSmtpAccount(senderEmail = '') {
    const selected = normalizeEmailAddress(senderEmail);
    const fallbackEmail = normalizeEmailAddress(mailFromAddress || smtpUser);
    const email = selected || fallbackEmail;
    const account = {
      email,
      name: normalizeString(SENDER_DISPLAY_NAMES[email] || mailFromName || 'Softora'),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure: Boolean(smtpSecure),
      smtpUser,
      smtpPass,
      imapHost,
      imapPort: Number(imapPort),
      imapSecure: Boolean(imapSecure),
      imapUser,
      imapPass,
    };
    account.smtpConfigured = isSenderSmtpAccountConfigured(account);
    account.imapConfigured = Boolean(account.imapHost && account.imapUser && account.imapPass);
    return account;
  }

  function resolveSenderSmtpAccount(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress || smtpUser);
    const account = getConfiguredMailboxSmtpAccounts().find((item) => normalizeEmailAddress(item.email) === selected);
    if (account) {
      const email = normalizeEmailAddress(account.email);
      const resolved = {
        ...account,
        email,
        name: normalizeString(SENDER_DISPLAY_NAMES[email] || account.name),
        smtpHost: account.smtpHost,
        smtpPort: Number(account.smtpPort) || 587,
        smtpSecure: Boolean(account.smtpSecure),
        smtpUser: account.smtpUser,
        smtpPass: account.smtpPass,
      };
      resolved.smtpConfigured = isSenderSmtpAccountConfigured(resolved);
      return resolved;
    }
    const base = buildBaseSmtpAccount(selected);
    const baseEmails = new Set([
      normalizeEmailAddress(mailFromAddress),
      normalizeEmailAddress(smtpUser),
    ].filter(Boolean));
    if (!selected || baseEmails.has(selected)) return base;
    return {
      ...base,
      smtpPass: '',
      smtpConfigured: false,
    };
  }

  function getSenderSmtpTransport(senderEmail) {
    const account = resolveSenderSmtpAccount(senderEmail);
    if (!account.smtpHost || !account.smtpUser || !account.smtpPass) return null;
    const key = [
      account.smtpHost,
      account.smtpPort,
      account.smtpSecure ? 'secure' : 'plain',
      account.smtpUser,
    ].join('|');
    if (!senderSmtpTransporters.has(key)) {
      senderSmtpTransporters.set(
        key,
        createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Boolean(account.smtpSecure),
          auth: {
            user: account.smtpUser,
            pass: account.smtpPass,
          },
        })
      );
    }
    return {
      account,
      transporter: senderSmtpTransporters.get(key),
    };
  }

  function normalizeDatabaseStatus(value, row = {}) {
    return normalizeContactStatus(value, row) || 'prospect';
  }

  function parseDatabaseRows(values = {}) {
    const raw = normalizeString(readChunkedStateValue(values, customerDbKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function buildCustomerRowsStateValues(values, rows) {
    return {
      ...(values && typeof values === 'object' ? values : {}),
      ...buildChunkedStatePatch(customerDbKey, JSON.stringify(Array.isArray(rows) ? rows : [])),
    };
  }

  function parseLeadDatabaseRows(values = {}, rowsKey = leadDbKey) {
    const raw = normalizeString(readChunkedStateValue(values, rowsKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((row) => row && typeof row === 'object')
        .map((row, index) => {
          const city = getRowCity(row);
          const address = normalizeString(row.address || row.adres || row.location || '');
          const region = normalizeString(row.region || row.regio || row.province || row.provincie || '');
          return {
            id: normalizeString(row.id || row.leadId || '') || `lead-${index}`,
            bedrijf: normalizeString(row.company || row.companyName || row.name || row.bedrijf || row.naam || '') || `Lead ${index + 1}`,
            naam: normalizeString(row.contactPerson || row.contact || row.contactName || row.clientName || row.naam || ''),
            phone: getRowPhone(row),
            branche: normalizeString(row.branche || row.branch || ''),
            region,
            stad: city,
            plaats: city,
            city,
            gemeente: normalizeString(row.gemeente || '') || city,
            adres: address,
            address,
            location: normalizeString(row.location || address || city || region),
            lat: row.lat ?? row.latitude ?? row.latitudeNumber,
            lng: row.lng ?? row.lon ?? row.longitude ?? row.longitudeNumber,
            distanceKm: row.distanceKm,
            afstandKm: row.afstandKm,
            website: normalizeString(row.website || ''),
            call: row.call,
            canCall: row.canCall,
            doNotCall: row.doNotCall,
            status: normalizeString(row.status || row.databaseStatus || ''),
          };
        });
    } catch (_) {
      return [];
    }
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(normalizeString(value));
    } catch (_) {
      return fallback;
    }
  }

  function isWebdesignSpecialAction(value) {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === 'webdesign' || normalized === 'website-design' || normalized === 'website_design';
  }

  function normalizeCampaignService(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function campaignContentPromisesWebdesignAssets(input = {}) {
    const subject = normalizeCampaignService(input.subject || '');
    const body = normalizeCampaignService(input.body || input.text || input.content || '');
    const combined = `${subject} ${body}`.replace(/\bwebsite design\b/g, 'webdesign');
    if (!/\bwebdesign\b/.test(combined)) return false;
    return /\bnieuw(?:e)? webdesign\b/.test(combined) && /\bgemaakt\b/.test(combined);
  }

  function shouldUseWebdesignAssets(input = {}, mode = 'mail') {
    if (isWebdesignSpecialAction(input.specialAction)) return true;
    return mode === 'mail' && campaignContentPromisesWebdesignAssets(input);
  }

  function requiresReadyWebdesign(input = {}, mode = 'mail') {
    if (shouldUseWebdesignAssets(input, mode)) return true;
    if (isCampaignTestModeEnabled(input.testMode)) return false;
    const service = normalizeCampaignService(input.service);
    return mode === 'call' && !service;
  }

  function isCampaignTestModeEnabled(value) {
    const normalized = normalizeString(value).toLowerCase();
    return value === true || normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'aan';
  }

  function findColdmailTestRecipientRow(customerRows = []) {
    const rows = (Array.isArray(customerRows) ? customerRows : []).filter((row) => row && typeof row === 'object');
    const isLookupEmailRow = (row) => TEST_RECIPIENT_LOOKUP_EMAILS.has(getRowEmail(row));
    const dedicatedRow = rows.find((row) => {
      if (!row || typeof row !== 'object') return false;
      const id = normalizeString(row.id || row.customerId || row.databaseId).toLowerCase();
      return id === COLDMAIL_TEST_RECIPIENT_ID;
    });
    if (dedicatedRow) return dedicatedRow;
    return (
      rows.find(
        (row) =>
          isLookupEmailRow(row) &&
          isResolvableWebsitePhotoValue(getWebdesignPhotoSource(row))
      ) ||
      rows.find(isLookupEmailRow) ||
      rows.find(
        (row) =>
          TEST_RECIPIENT_COMPANIES.has(getRowCompany(row).toLowerCase()) &&
          isResolvableWebsitePhotoValue(getWebdesignPhotoSource(row))
      ) ||
      rows.find((row) => TEST_RECIPIENT_COMPANIES.has(getRowCompany(row).toLowerCase())) ||
      null
    );
  }

  function buildColdmailTestRecipientRow(mode = 'mail', databaseRow = null) {
    const row = databaseRow && typeof databaseRow === 'object' ? { ...databaseRow } : {};
    return {
      ...row,
      id: normalizeString(row.id || row.customerId || row.databaseId) || COLDMAIL_TEST_RECIPIENT_ID,
      bedrijf: normalizeString(row.bedrijf || row.company || row.companyName) || 'Softora Testmodus',
      naam: normalizeString(row.naam || row.contact || row.contactName) || 'Servé',
      email: COLDMAIL_TEST_RECIPIENT_EMAIL,
      phone: normalizeString(row.phone || row.telefoon || row.tel) || '+31000000000',
      telefoon: normalizeString(row.telefoon || row.phone || row.tel) || '+31000000000',
      website: normalizeString(row.website || row.websiteUrl || row.dom || row.domain) || 'softora.nl',
      dom: normalizeString(row.dom || row.domain || row.website || row.websiteUrl) || 'softora.nl',
      stad: normalizeString(row.stad || row.plaats || row.city) || 'Oisterwijk',
      plaats: normalizeString(row.plaats || row.stad || row.city) || 'Oisterwijk',
      branche: normalizeString(row.branche || row.branch) || 'Test',
      status: normalizeString(row.status || row.databaseStatus) || 'benaderbaar',
      databaseStatus: normalizeString(row.databaseStatus || row.status) || 'benaderbaar',
      mail: true,
      call: mode === 'call',
      canCall: mode === 'call',
      distanceKm: 0,
      testMode: true,
    };
  }

  function buildResolvedColdmailTestRecipients(input = {}, mode = 'mail', count = 1, customerRows = [], customerPhotoMap = {}) {
    const row = buildColdmailTestRecipientRow(mode, findColdmailTestRecipientRow(customerRows));
    const item = { row, index: 0, id: getRowId(row, 0) };
    const failed = [];
    const selectedRows = [];
    const shouldRequireWebdesign = shouldUseWebdesignAssets(input, mode);
    if (shouldRequireWebdesign) {
      const readyWebdesignMatcher = createReadyWebdesignMatcher([row], customerPhotoMap);
      if (readyWebdesignMatcher.hasRow(row, 0)) {
        selectedRows.push(item);
      } else {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: getRowEmail(row),
          phone: getRowPhone(row),
          error: `Nog geen website-design klaar voor ${getRowCompany(row) || 'Softora Testmodus'}.`,
        });
      }
    } else {
      selectedRows.push(item);
    }
    return {
      count,
      mode,
      radiusKm: parseRadiusKm(input.radiusKm),
      values: {},
      customerValues: {},
      customerRows: [row],
      rows: [row],
      candidateRows: [item],
      selectedRows,
      failed,
      customerPhotoMap: customerPhotoMap && typeof customerPhotoMap === 'object' ? customerPhotoMap : {},
      testMode: true,
    };
  }

  function normalizeOutreachStatus(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (['benaderd', 'gemaild', 'mailed', 'sent'].includes(normalized)) return 'benaderd';
    if (['reactie_ontvangen', 'reply_received', 'actie_nodig', 'action_required'].includes(normalized)) {
      return 'reactie_ontvangen';
    }
    if (['interesse', 'interested', 'geinteresseerd'].includes(normalized)) return 'interesse';
    if (['geen_interesse', 'geblokkeerd', 'opt_out', 'unsubscribe', 'geenbehoefte'].includes(normalized)) {
      return 'geen_interesse';
    }
    if (['afgehaakt', 'lost', 'no_deal', 'geendeal'].includes(normalized)) return 'afgehaakt';
    if (['geen_gehoor', 'geengehoor', 'no_answer'].includes(normalized)) return 'geen_gehoor';
    if (['klant_geworden', 'klant', 'customer', 'paid'].includes(normalized)) return 'klant_geworden';
    return '';
  }

  function isWebdesignOutreachRow(row) {
    if (!row || typeof row !== 'object') return false;
    return [
      row.campaignType,
      row.campaign_type,
      row.outreachCampaignType,
      row.outreach_campaign_type,
      row.coldmailSpecialAction,
      row.specialAction,
    ].some(isWebdesignSpecialAction);
  }

  function mapOutreachStatusToDatabaseStatus(status, fallbackStatus = 'gemaild') {
    const normalized = normalizeOutreachStatus(status);
    if (normalized === 'interesse') return 'interesse';
    if (normalized === 'geen_interesse') return 'geblokkeerd';
    if (normalized === 'afgehaakt') return 'afgehaakt';
    if (normalized === 'geen_gehoor') return 'geengehoor';
    if (normalized === 'klant_geworden') return 'klant';
    return normalizeDatabaseStatus(fallbackStatus) || 'gemaild';
  }

  function isOutreachDefinitiveStatus(status) {
    return ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'].includes(
      normalizeOutreachStatus(status)
    );
  }

  function getOutreachStatusLabel(status) {
    const labels = {
      benaderd: 'Benaderd',
      reactie_ontvangen: 'Reactie ontvangen',
      interesse: 'Interesse',
      geen_interesse: 'Geen interesse',
      afgehaakt: 'Afgehaakt',
      geen_gehoor: 'Geen gehoor',
      klant_geworden: 'Klant geworden',
    };
    return labels[normalizeOutreachStatus(status)] || 'Benaderd';
  }

  function normalizeMailboxMessageKey(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw) return '';
    if (/^[a-z]+:\d+$/i.test(raw)) return raw;
    return normalizeMessageIdToken(raw.replace(/^message:/i, ''));
  }

  function collectOutreachMessageKeys(row) {
    const values = [
      row && row.outreachMessageId,
      row && row.coldmailSentMessageId,
      row && row.replyMessageId,
      row && row.replyThreadId,
      row && row.replyMailboxId,
      row && row.lastColdmailReplyMessageKey,
    ];
    return new Set(values.map(normalizeMailboxMessageKey).filter(Boolean));
  }

  function matchesOutreachMessage(row, value) {
    const key = normalizeMailboxMessageKey(value);
    if (!key) return false;
    return collectOutreachMessageKeys(row).has(key);
  }

  function buildMailboxMessageId(folder, uid) {
    const safeUid = normalizeString(uid);
    if (!safeUid) return '';
    const normalizedFolder = normalizeString(folder).toLowerCase();
    const folderKey = normalizedFolder.includes('sent')
      ? 'sent'
      : normalizedFolder.includes('spam') || normalizedFolder.includes('junk')
        ? 'spam'
        : normalizedFolder.includes('trash') || normalizedFolder.includes('prullenbak')
          ? 'trash'
          : 'inbox';
    return `${folderKey}:${safeUid}`;
  }

  function getRowId(row, index) {
    return normalizeString(row.id || row.customerId || row.databaseId || '') || `row-${index}`;
  }

  function getExplicitRowId(row) {
    return normalizeString((row && (row.id || row.customerId || row.databaseId)) || '');
  }

  function getRowCompany(row) {
    return normalizeString(row.bedrijf || row.company || row.companyName || row.naam || row.name);
  }

  function getRowContact(row) {
    return normalizeString(row.naam || row.contact || row.contactName || row.clientName) || getRowCompany(row);
  }

  function cleanPlaceLabel(value) {
    return normalizeString(value)
      .replace(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g, '')
      .replace(/\s*\([A-Z]{2,3}\)\s*$/i, '')
      .replace(/\b(Nederland|The Netherlands)\b/gi, '')
      .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeStreetAddress(value) {
    const text = normalizeString(value).toLowerCase();
    return /\d/.test(text) && /(straat|weg|laan|plein|pad|dijk|hof|kade|markt|singel|steeg|gracht|boulevard|baan|akker|plantsoen|park)\b/.test(text);
  }

  function formatKnownPlaceKey(value) {
    return normalizeString(value)
      .split(/\s+/)
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .replace(/^S Hertogenbosch$/, "'s-Hertogenbosch");
  }

  function findKnownPlaceLabel(value) {
    const haystack = normalizePlaceKey(value);
    if (!haystack) return '';
    const placeKey = Object.keys(campaignPlaceCoords)
      .sort((left, right) => right.length - left.length)
      .find((key) => haystack.includes(normalizePlaceKey(key)));
    return placeKey ? formatKnownPlaceKey(placeKey) : '';
  }

  function extractPlaceFromAddress(value) {
    const text = normalizeString(value)
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();
    if (!text) return '';

    const postalMatch = text.match(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b\s+([A-Za-zÀ-ÿ'’.\- ]{2,})$/);
    if (postalMatch) return cleanPlaceLabel(postalMatch[1]);

    const parts = text.split(/[,\n;|]/).map(cleanPlaceLabel).filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const candidate = parts[index];
      if (!candidate || looksLikeStreetAddress(candidate)) continue;
      if (/^\d+$/.test(candidate)) continue;
      return candidate;
    }

    return looksLikeStreetAddress(text) ? findKnownPlaceLabel(text) : cleanPlaceLabel(text);
  }

  function getRowCity(row) {
    const explicit = [
      row && row.plaats,
      row && row.city,
      row && row.gemeente,
      row && row.locality,
      row && row.town,
      row && row.village,
    ]
      .map((value) => {
        const cleaned = cleanPlaceLabel(value);
        if (!cleaned) return '';
        return looksLikeStreetAddress(cleaned) ? extractPlaceFromAddress(cleaned) : cleaned;
      })
      .find(Boolean);
    if (explicit) return explicit;

    const addressLikeValue = [
      row && row.stad,
      row && row.adres,
      row && row.address,
      row && row.location,
    ]
      .map(extractPlaceFromAddress)
      .find(Boolean);
    return addressLikeValue || '';
  }

  function normalizeWebsiteVariableValue(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      return normalizeString(parsed.hostname).replace(/^www\./i, '') || raw;
    } catch (_) {
      return raw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/.*$/g, '')
        .replace(/\/+$/g, '');
    }
  }

  function getRowDomain(row) {
    return normalizeWebsiteVariableValue(
      row.dom ||
        row.domain ||
        row.website ||
        row.websiteUrl ||
        row.website_url ||
        row.url ||
        row.site ||
        row.domein ||
        ''
    );
  }

  function getRowEmail(row) {
    return normalizeEmailAddress(row.email || row.contactEmail || row.mail || '');
  }

  function getRowPhone(row) {
    const value = normalizeString(
      row.phoneE164 ||
        row.phone ||
        row.tel ||
        row.telefoon ||
        row.telefoonnummer ||
        row.telefoonNummer ||
        row.telefoon_nummer ||
        row.mobile ||
        row.mobilePhone ||
        row.mobiel ||
        row.phoneNumber ||
        row.contactPhone ||
        row.contact_phone ||
        ''
    );
    return value === '—' || value === '-' ? '' : value;
  }

  function normalizePhoneDigits(value) {
    return normalizeString(value).replace(/[^\d]/g, '');
  }

  function getComparablePhoneKeys(value) {
    const digits = normalizePhoneDigits(value);
    const keys = new Set();
    if (!digits) return keys;
    keys.add(digits);
    const withoutInternationalPrefix = digits.startsWith('00') ? digits.slice(2) : digits;
    if (withoutInternationalPrefix) keys.add(withoutInternationalPrefix);
    if (withoutInternationalPrefix.startsWith('31') && withoutInternationalPrefix.length > 2) {
      keys.add(`0${withoutInternationalPrefix.slice(2)}`);
    }
    if (withoutInternationalPrefix.startsWith('0') && withoutInternationalPrefix.length > 1) {
      keys.add(`31${withoutInternationalPrefix.slice(1)}`);
    }
    if (withoutInternationalPrefix.length === 9 && withoutInternationalPrefix.startsWith('6')) {
      keys.add(`0${withoutInternationalPrefix}`);
      keys.add(`31${withoutInternationalPrefix}`);
    }
    return keys;
  }

  function parseBlockedPhoneList(value) {
    const entries = Array.isArray(value)
      ? value
      : normalizeString(value).split(/[\n,;|]+/);
    const keys = new Set();
    entries.forEach((entry) => {
      getComparablePhoneKeys(entry).forEach((key) => keys.add(key));
    });
    return keys;
  }

  function isPhoneBlocked(phone, blockedPhoneKeys) {
    if (!blockedPhoneKeys || !blockedPhoneKeys.size) return false;
    for (const key of getComparablePhoneKeys(phone)) {
      if (blockedPhoneKeys.has(key)) return true;
    }
    return false;
  }

  function parseBlockedEmailList(value) {
    const entries = (Array.isArray(value) ? value.join('\n') : normalizeString(value)).split(/[\s,;|]+/);
    return new Set(entries.map(normalizeEmailAddress).filter(isLikelyValidEmail));
  }

  function isEmailBlocked(email, blockedEmailKeys) {
    if (!blockedEmailKeys || !blockedEmailKeys.size) return false;
    return blockedEmailKeys.has(normalizeEmailAddress(email));
  }

  function isLikelyCallablePhone(value) {
    const phone = getRowPhone({ phone: value });
    return phone.replace(/\D/g, '').length >= 8;
  }

  function normalizeIdentityTextPart(value) {
    if (value === undefined || value === null) return '';
    const text = normalizeString(value);
    if (!text || text === 'undefined' || text === 'null') return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeIdentityPhonePart(value) {
    return normalizePhoneDigits(value) || normalizeIdentityTextPart(value);
  }

  function buildNormalizedIdentityKey(company, contact, phone) {
    const normalizedCompany = normalizeIdentityTextPart(company);
    const normalizedContact = normalizeIdentityTextPart(contact);
    const normalizedPhone = normalizeIdentityPhonePart(phone);
    if (!normalizedCompany && !normalizedContact && !normalizedPhone) return '';
    return [normalizedCompany, normalizedContact, normalizedPhone].join('|');
  }

  function buildNormalizedIdentityKeys(company, contact, phone) {
    const phoneKeys = Array.from(getComparablePhoneKeys(phone));
    const normalizedFallbackPhone = normalizeIdentityPhonePart(phone);
    if (!phoneKeys.length && normalizedFallbackPhone) phoneKeys.push(normalizedFallbackPhone);
    const keys = phoneKeys.length
      ? phoneKeys.map((phoneKey) => buildNormalizedIdentityKey(company, contact, phoneKey))
      : [buildNormalizedIdentityKey(company, contact, '')];
    return new Set(keys.filter(Boolean));
  }

  function normalizeStoredIdentityKeys(value) {
    if (value === undefined || value === null) return new Set();
    const raw = normalizeString(value);
    if (!raw || raw === 'undefined' || raw === 'null') return new Set();
    const parts = raw.split('|');
    if (parts.length >= 3) {
      return buildNormalizedIdentityKeys(parts[0], parts[1], parts.slice(2).join('|'));
    }
    return new Set([normalizeIdentityTextPart(raw)].filter(Boolean));
  }

  function getExplicitRowContact(row) {
    return normalizeString(row && (row.naam || row.contact || row.contactName || row.clientName));
  }

  function buildRowIdentityKeys(row) {
    const company = getRowCompany(row);
    const explicitContact = getExplicitRowContact(row);
    const fallbackContact = getRowContact(row);
    const phone = getRowPhone(row);
    const keys = new Set();
    [
      [company, fallbackContact, phone],
      [company, explicitContact, phone],
      [company, company, phone],
    ].forEach(([companyPart, contactPart, phonePart]) => {
      buildNormalizedIdentityKeys(companyPart, contactPart, phonePart).forEach((key) => keys.add(key));
    });
    return keys;
  }

  function buildRowIdentityKey(row) {
    return Array.from(buildRowIdentityKeys(row))[0] || '';
  }

  function getPhotoIdentityKeys(photo) {
    const keys = new Set();
    normalizeStoredIdentityKeys(photo && photo.identityKey).forEach((key) => keys.add(key));
    normalizeStoredIdentityKeys(photo && photo.legacyMeta && photo.legacyMeta.identityKey).forEach((key) => keys.add(key));
    return keys;
  }

  function photoRecordMatchesRowIdentity(photo, row) {
    const photoIdentityKeys = getPhotoIdentityKeys(photo);
    if (!photoIdentityKeys.size) return true;
    const rowIdentityKeys = buildRowIdentityKeys(row);
    return Array.from(rowIdentityKeys).some((key) => photoIdentityKeys.has(key));
  }

  function mergeColdcallingRowsWithCustomerRows(leadRows = [], customerRows = []) {
    const mergedRows = [];
    const seenKeys = new Set();
    const addRow = (row) => {
      if (!row || typeof row !== 'object') return;
      const phoneKeys = Array.from(getComparablePhoneKeys(getRowPhone(row)));
      const keys = phoneKeys.length ? phoneKeys : [buildRowIdentityKey(row)];
      if (keys.some((key) => key && seenKeys.has(key))) return;
      mergedRows.push(row);
      keys.filter(Boolean).forEach((key) => seenKeys.add(key));
    };
    (Array.isArray(leadRows) ? leadRows : []).forEach(addRow);
    (Array.isArray(customerRows) ? customerRows : []).forEach(addRow);
    return mergedRows;
  }

  function isResolvableWebsitePhotoValue(value) {
    const text = normalizeString(value);
    if (!text) return false;
    if (parseDataUrlImage(text)) return true;
    return /^https:\/\//i.test(text);
  }

  function findStoredPhotoRecordForRow(row, index, photoMap, photosByIdentity) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const byIdentity = photosByIdentity instanceof Map ? photosByIdentity : new Map();
    const id = getExplicitRowId(row);
    const directPhoto = id ? photos[id] : null;
    if (directPhoto && (photoRecordMatchesRowIdentity(directPhoto, row) || isDedicatedTestModeRow(row))) {
      return directPhoto;
    }
    for (const identityKey of buildRowIdentityKeys(row)) {
      const photo = byIdentity.get(identityKey);
      if (photo) return photo;
    }
    return null;
  }

  function preferFreshRowPhotoFields(row, storedPhoto) {
    const base = storedPhoto && typeof storedPhoto === 'object' ? { ...storedPhoto } : {};
    const next = { ...base };
    const rowPhotoSource = getWebdesignPhotoSource(row);
    const rowMockupSource = getWebdesignMockupSource(row);
    if (isResolvableWebsitePhotoValue(rowPhotoSource)) {
      next.websitePhoto = row.websitePhoto || row.websitePhotoUrl || row.signedUrl || (row.storage && row.storage.signedUrl) || rowPhotoSource;
      const rowPhotoName = normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName);
      if (rowPhotoName) next.websitePhotoName = rowPhotoName;
    }
    if (isResolvableWebsitePhotoValue(rowMockupSource)) {
      next.websiteMockup =
        row.websiteMockup ||
        row.websiteMockupUrl ||
        row.mockupUrl ||
        row.signedMockupUrl ||
        (row.mockupStorage && row.mockupStorage.signedUrl) ||
        rowMockupSource;
      const rowMockupName = normalizeString(row.websiteMockupName || row.mockupName);
      if (rowMockupName) next.websiteMockupName = rowMockupName;
    }
    if (!normalizeString(next.id)) next.id = getRowId(row, 0);
    if (!normalizeString(next.identityKey)) next.identityKey = buildRowIdentityKey(row);
    return next;
  }

  function hasReadyWebsitePhotoRecord(photo) {
    if (!photo || typeof photo !== 'object') return false;
    return Boolean(
      isResolvableWebsitePhotoValue(photo.websitePhoto) ||
        isResolvableWebsitePhotoValue(photo.websitePhotoUrl) ||
        isResolvableWebsitePhotoValue(photo.signedUrl) ||
        isResolvableWebsitePhotoValue(photo.storage && photo.storage.signedUrl)
    );
  }

  function hasReadyWebdesignAssetRecord(photo) {
    if (!hasReadyWebsitePhotoRecord(photo)) return false;
    return isResolvableWebsitePhotoValue(getWebdesignMockupSource(photo));
  }

  function createReadyWebdesignMatcher(customerRows = [], photoMap = {}) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      if (!hasReadyWebdesignAssetRecord(item)) return;
      getPhotoIdentityKeys(item).forEach((identityKey) => {
        if (identityKey) photosByIdentity.set(identityKey, item);
      });
    });

    const readyIds = new Set();
    const readyIdentityKeys = new Set();
    const readyPhoneKeys = new Set();

    (Array.isArray(customerRows) ? customerRows : []).forEach((row, index) => {
      const photo = preferFreshRowPhotoFields(row, findStoredPhotoRecordForRow(row, index, photos, photosByIdentity));
      if (!hasReadyWebdesignAssetRecord(photo)) return;

      const rowId = getExplicitRowId(row);
      if (rowId) readyIds.add(rowId);
      buildRowIdentityKeys(row).forEach((identityKey) => readyIdentityKeys.add(identityKey));
      getComparablePhoneKeys(getRowPhone(row)).forEach((key) => readyPhoneKeys.add(key));
    });

    return {
      hasRow(row, index = 0) {
        const rowId = getExplicitRowId(row);
        if (rowId && readyIds.has(rowId)) return true;
        for (const identityKey of buildRowIdentityKeys(row)) {
          if (readyIdentityKeys.has(identityKey)) return true;
        }
        for (const key of getComparablePhoneKeys(getRowPhone(row))) {
          if (readyPhoneKeys.has(key)) return true;
        }
        return false;
      },
    };
  }

  function getEmailDomain(email) {
    const normalized = normalizeEmailAddress(email);
    const parts = normalized.split('@');
    return parts.length === 2 ? parts[1] : '';
  }

  function envKeyForEmail(email) {
    return normalizeEmailAddress(email)
      .split('@')[0]
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function envKeyForDomain(email) {
    return normalizeEmailAddress(email)
      .split('@')
      .slice(1)
      .join('@')
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function readBooleanEnv(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    if (/^(1|true|yes)$/i.test(normalized)) return true;
    if (/^(0|false|no)$/i.test(normalized)) return false;
    return null;
  }

  function readPortEnv(value) {
    const port = Number(value || 0);
    return Number.isFinite(port) && port > 0 ? port : 0;
  }

  function readMailboxEnvForKey(key) {
    const env = process.env || {};
    const sharedUser = normalizeString(env[`MAILBOX_${key}_USER`] || '');
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function resolveSentCopyAccount(senderEmail, senderAccount = null) {
    const email = normalizeEmailAddress(
      senderEmail ||
        (senderAccount && senderAccount.email) ||
        mailFromAddress ||
        smtpUser ||
        imapUser
    );
    const envAccount = readMailboxEnvForKey(envKeyForEmail(email));
    const envDomain = readMailboxEnvForKey(envKeyForDomain(email));
    const configuredAccount =
      senderAccount && normalizeEmailAddress(senderAccount.email) === email
        ? senderAccount
        : getConfiguredMailboxSmtpAccounts().find((item) => normalizeEmailAddress(item.email) === email);
    const useBaseCredentials =
      email === normalizeEmailAddress(mailFromAddress) ||
      email === normalizeEmailAddress(smtpUser) ||
      email === normalizeEmailAddress(imapUser) ||
      envAccount.useBaseCredentials ||
      envDomain.useBaseCredentials;
    const port =
      Number(
        (configuredAccount && configuredAccount.imapPort) ||
          envAccount.imapPort ||
          envDomain.imapPort ||
          imapPort ||
          993
      ) || 993;
    const secure =
      configuredAccount && typeof configuredAccount.imapSecure === 'boolean'
        ? Boolean(configuredAccount.imapSecure)
        : typeof envAccount.imapSecure === 'boolean'
        ? envAccount.imapSecure
        : typeof envDomain.imapSecure === 'boolean'
          ? envDomain.imapSecure
          : Boolean(imapSecure || port === 993);
    const account = {
      email,
      imapHost: normalizeString(
        (configuredAccount && configuredAccount.imapHost) ||
          envAccount.imapHost ||
          envDomain.imapHost ||
          imapHost
      ),
      imapPort: port,
      imapSecure: secure,
      imapUser: normalizeString(
        (configuredAccount && configuredAccount.imapUser) ||
          envAccount.imapUser ||
          envDomain.imapUser ||
          (useBaseCredentials ? imapUser : '') ||
          (configuredAccount && configuredAccount.smtpUser) ||
          email
      ),
      imapPass: normalizeString(
        (configuredAccount && configuredAccount.imapPass) ||
          envAccount.imapPass ||
          envDomain.imapPass ||
          (useBaseCredentials ? imapPass : '') ||
          (configuredAccount && configuredAccount.smtpPass)
      ),
    };
    return account;
  }

  async function saveSentCopy(senderEmail, mail, info, senderAccount = null) {
    return appendSentMessage({
      account: resolveSentCopyAccount(senderEmail, senderAccount),
      createImapClient,
      nodemailer,
      mail,
      messageId: normalizeString(info && info.messageId),
      sentAt: now(),
    });
  }

  function isTestRecipientEmail(email) {
    return TEST_RECIPIENT_EMAILS.has(normalizeEmailAddress(email));
  }

  function isTestRecipientRow(row, email) {
    const company = getRowCompany(row).toLowerCase();
    return isTestRecipientEmail(email || getRowEmail(row)) || TEST_RECIPIENT_COMPANIES.has(company);
  }

  function isDedicatedTestModeRow(row) {
    return normalizeString(row && (row.id || row.customerId || row.databaseId)).toLowerCase() === COLDMAIL_TEST_RECIPIENT_ID;
  }

  function getImapMailboxesForSync() {
    const defaults = ['INBOX', 'Spam', 'Junk', 'INBOX.Spam', 'INBOX.Junk', 'Reclame'];
    const combined = [imapMailbox, ...imapExtraMailboxes, ...defaults].filter(Boolean);
    const seen = new Set();
    return combined.filter((mailbox) => {
      const key = normalizeString(mailbox).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeMessageIdToken(value) {
    return normalizeString(value).replace(/[<>]/g, '').toLowerCase();
  }

  function collectMessageReferenceHeader(parsedMail) {
    const refs = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      normalizeString(value)
        .split(/\s+/)
        .map(normalizeMessageIdToken)
        .filter(Boolean)
        .forEach((token) => refs.push(`<${token}>`));
    };
    add(parsedMail && parsedMail.references);
    add(parsedMail && parsedMail.inReplyTo);
    add(parsedMail && parsedMail.messageId);
    return Array.from(new Set(refs)).join(' ');
  }

  function getParsedMailAddressList(parsedMail, key) {
    const list = parsedMail && parsedMail[key] && Array.isArray(parsedMail[key].value) ? parsedMail[key].value : [];
    return list
      .map((entry) => ({
        address: normalizeEmailAddress(entry && entry.address),
        name: normalizeString(entry && entry.name),
      }))
      .filter((entry) => entry.address);
  }

  function getParsedMailFromEmail(parsedMail) {
    return getParsedMailAddressList(parsedMail, 'from')[0] || { address: '', name: '' };
  }

  function getInboundReplyText(parsedMail) {
    let text = String((parsedMail && (parsedMail.text || parsedMail.html)) || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    const splitPatterns = [
      /\n[-_]{2,}\s*oorspronkelijk bericht\s*[-_]{2,}/i,
      /\non .+ wrote:/i,
      /\nop .+ schreef .+:/i,
      /\nvan:\s.+/i,
    ];
    for (const pattern of splitPatterns) {
      const match = text.match(pattern);
      if (match && Number.isFinite(match.index)) text = text.slice(0, match.index);
    }
    return text
      .split('\n')
      .map((line) => normalizeString(line))
      .filter((line) => line && !line.startsWith('>'))
      .filter((line) => !/^(from|to|subject|onderwerp|sent|verzonden|cc):/i.test(line))
      .join('\n')
      .trim();
  }

  function normalizeInboundIntentText(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyInboundColdmailReplyLifecycle(inboundText) {
    const text = normalizeInboundIntentText(inboundText);
    if (!text) return { status: '', intent: 'unknown', label: 'Geen duidelijke mailreactie' };

    const optOutPattern =
      /\b(stop|afmelden|uitschrijven|unsubscribe|verwijder|remove me|mail mij niet|niet meer mailen|geen interesse|geen behoefte|niet geinteresseerd|niet interessant|laat maar)\b/i;
    if (optOutPattern.test(text)) {
      return {
        status: 'geblokkeerd',
        intent: 'opt_out',
        label: 'Afmelding of geen interesse via mail',
        disableMail: true,
      };
    }

    const positivePattern =
      /\b(interessant|interesse|klinkt goed|klinkt interessant|vertel|meer info|meer informatie|informatie ontvangen|bel mij|bel me|bellen|afspraak|kennismaking|inplannen|plannen|offerte|prijs|kosten|hoe werkt|wanneer kunnen|neem contact|contact opnemen|tell me more|sounds good|interested)\b/i;
    if (positivePattern.test(text)) {
      return {
        status: 'interesse',
        intent: 'interested',
        label: 'Interesse via mail',
        disableMail: false,
      };
    }

    return { status: '', intent: 'unclear', label: 'Mailreactie zonder duidelijke lifecycle-status' };
  }

  function buildColdmailDeliveryFailureText(parsedMail, inboundText) {
    const from = getParsedMailFromEmail(parsedMail);
    return [
      normalizeString(parsedMail && parsedMail.subject),
      normalizeString(from.address),
      normalizeString(from.name),
      normalizeString(inboundText),
      normalizeString(parsedMail && parsedMail.text),
      normalizeString(parsedMail && parsedMail.textAsHtml),
      normalizeString(parsedMail && parsedMail.html),
    ].join('\n');
  }

  function isColdmailDeliveryFailureMessage(parsedMail, inboundText) {
    const from = getParsedMailFromEmail(parsedMail);
    const fromText = normalizeString(`${from.address} ${from.name}`).toLowerCase();
    const subject = normalizeString(parsedMail && parsedMail.subject);
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    return Boolean(
      /mailer-daemon|postmaster|mail delivery|no-reply|noreply/i.test(fromText) ||
        COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) ||
        COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text)
    );
  }

  function classifyColdmailDeliveryFailure(parsedMail, inboundText) {
    if (!isColdmailDeliveryFailureMessage(parsedMail, inboundText)) return null;
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    if (COLDMAIL_HARD_BOUNCE_PATTERN.test(text)) {
      return {
        status: 'geblokkeerd',
        intent: 'hard_bounce',
        label: 'Hard bounce via mailserver',
        bounceType: 'hard',
        disableMail: true,
      };
    }
    if (COLDMAIL_SOFT_BOUNCE_PATTERN.test(text)) {
      return {
        status: '',
        intent: 'soft_bounce',
        label: 'Zachte bounce via mailserver',
        bounceType: 'soft',
        disableMail: false,
      };
    }
    return {
      status: '',
      intent: 'unknown_bounce',
      label: 'Mailservermelding ontvangen',
      bounceType: 'unknown',
      disableMail: false,
    };
  }

  function getColdmailProviderWarningSafetyReason(parsedMail, inboundText) {
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    const safetyReason = getSmtpSafetyStopReason({ message: text });
    if (!safetyReason) return '';
    const from = getParsedMailFromEmail(parsedMail);
    const fromText = normalizeString(`${from.address} ${from.name}`);
    const subject = normalizeString(parsedMail && parsedMail.subject);
    const providerLike =
      COLDMAIL_PROVIDER_WARNING_SENDER_PATTERN.test(fromText) ||
      COLDMAIL_PROVIDER_WARNING_SUBJECT_PATTERN.test(subject) ||
      isColdmailDeliveryFailureMessage(parsedMail, inboundText);
    return providerLike ? safetyReason : '';
  }

  function extractEmailAddressesFromText(value) {
    const matches = normalizeString(value).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi);
    return Array.from(new Set((matches || []).map(normalizeEmailAddress).filter(Boolean)));
  }

  function isOwnMailboxAddress(email) {
    const address = normalizeEmailAddress(email);
    if (!address) return false;
    if (getAllowedSenderEmails().includes(address)) return true;
    return address.endsWith('@softora.nl');
  }

  function hasActiveColdmailContext(row) {
    if (!row || typeof row !== 'object') return false;
    if (isTestRecipientRow(row)) return true;
    return Boolean(
      normalizeString(row.lastColdmailSentAt || row.coldmailCampaignStartedAt || row.activeColdmailCampaignUntil || row.coldmailCampaignEndsAt)
    );
  }

  function resolveInboundSenderEmail(parsedMail) {
    const allowed = new Set(getAllowedSenderEmails());
    const recipients = [
      ...getParsedMailAddressList(parsedMail, 'to'),
      ...getParsedMailAddressList(parsedMail, 'cc'),
    ];
    const matched = recipients.find((entry) => allowed.has(entry.address));
    return matched ? matched.address : assertSenderAllowed(mailFromAddress);
  }

  function resolveInboundMailboxAccount(parsedMail) {
    try {
      return resolveInboundSenderEmail(parsedMail);
    } catch (_) {
      return normalizeEmailAddress(mailFromAddress || smtpUser || imapUser);
    }
  }

  function findColdmailRowForInboundReply(parsedMail, rows) {
    const from = getParsedMailFromEmail(parsedMail);
    if (!from.address || isOwnMailboxAddress(from.address)) return null;
    const normalizedFrom = from.address;
    const candidates = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) => getRowEmail(row) === normalizedFrom)
      .filter(({ row }) => hasActiveColdmailContext(row));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function findColdmailRowForDeliveryFailure(parsedMail, inboundText, rows) {
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    const bouncedEmails = extractEmailAddressesFromText(text).filter((email) => !isOwnMailboxAddress(email));
    if (!bouncedEmails.length) return null;
    const bouncedSet = new Set(bouncedEmails);
    const candidates = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) => bouncedSet.has(getRowEmail(row)))
      .filter(({ row }) => hasActiveColdmailContext(row));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function extractOpenAiReplyText(content) {
    if (typeof extractOpenAiTextContent === 'function') {
      return normalizeString(extractOpenAiTextContent(content));
    }
    if (typeof content === 'string') return normalizeString(content);
    if (!Array.isArray(content)) return '';
    return normalizeString(
      content
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          return typeof item.text === 'string' ? item.text : '';
        })
        .join('\n')
    );
  }

  function getAllowedSenderEmails() {
    return Array.from(
      new Set(
        [
          mailFromAddress,
          smtpUser,
          ...getConfiguredMailboxSmtpAccounts().map((account) => account.email),
          'info@softora.nl',
          'zakelijk@softora.nl',
          'ruben@softora.nl',
          'serve@softora.nl',
          'martijn@softora.nl',
        ]
          .map(normalizeEmailAddress)
          .filter(isLikelyValidEmail)
      )
    );
  }

  function getConfiguredSenderEmails() {
    return getAllowedSenderEmails().filter((email) => isSenderSmtpAccountConfigured(resolveSenderSmtpAccount(email)));
  }

  function assertSenderAllowed(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress);
    const allowed = getAllowedSenderEmails();
    if (!selected || !allowed.length || allowed.includes(selected)) return selected || allowed[0] || '';
    const error = new Error('Dit afzenderadres is nog niet gekoppeld aan de server.');
    error.code = 'SENDER_NOT_ALLOWED';
    error.allowedSenderEmails = allowed;
    throw error;
  }

  function formatMailFromHeader(senderEmail, smtpAccount = null) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const name = getSenderDisplayName(address, smtpAccount);
    return name ? `${name} <${address}>` : address;
  }

  function getSenderDisplayName(senderEmail, smtpAccount = null) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const accountName = smtpAccount && normalizeEmailAddress(smtpAccount.email) === address
      ? normalizeString(smtpAccount.name)
      : '';
    return normalizeString(accountName || SENDER_DISPLAY_NAMES[address] || mailFromName || 'Softora');
  }

  function isColdmailPrivateCopyBlockedSender(senderEmail) {
    return COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS.has(normalizeEmailAddress(senderEmail));
  }

  function getColdmailReplyToAddress(senderEmail) {
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    if (isColdmailPrivateCopyBlockedSender(selectedSenderEmail)) {
      return selectedSenderEmail || mailFromAddress || undefined;
    }
    return mailReplyTo || selectedSenderEmail || mailFromAddress || undefined;
  }

  function getColdmailAuditBccAddress(senderEmail) {
    if (isColdmailPrivateCopyBlockedSender(senderEmail)) return '';
    const email = normalizeEmailAddress(coldmailAuditBcc);
    return isLikelyValidEmail(email) ? email : '';
  }

  function parsePositiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value || ''), 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, safe));
  }

  function getColdmailCampaignSendLimit() {
    return parsePositiveInt(
      coldmailCampaignSendLimit,
      DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT
    );
  }

  function getColdmailDailySendLimit() {
    return parsePositiveInt(
      coldmailDailySendLimit,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT
    );
  }

  function getColdmailPackageDailySendLimit() {
    return parsePositiveInt(
      coldmailPackageDailySendLimit,
      DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT
    );
  }

  function getColdmailSendDelayMs() {
    return parsePositiveInt(coldmailSendDelayMs, DEFAULT_COLDMAIL_SEND_DELAY_MS, 0, 5 * 60 * 1000);
  }

  function getColdmailSafetyPauseMs() {
    return parsePositiveInt(
      coldmailSafetyPauseMs,
      DEFAULT_COLDMAIL_SAFETY_PAUSE_MS,
      60 * 1000,
      24 * 60 * 60 * 1000
    );
  }

  function getColdmailPersonalMailboxDailyLimit() {
    return parsePositiveInt(
      coldmailPersonalMailboxDailyLimit,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
      1,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT
    );
  }

  function getColdmailPersonalMailboxSendDelayMs() {
    return parsePositiveInt(
      coldmailPersonalMailboxSendDelayMs,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
      0,
      5 * 60 * 1000
    );
  }

  function shouldBlockPersonalMailboxDomains() {
    return coldmailBlockPersonalMailboxDomains !== false;
  }

  function getColdmailSafetyLimits() {
    return {
      campaignSendLimit: getColdmailCampaignSendLimit(),
      dailySendLimit: getColdmailDailySendLimit(),
      packageDailySendLimit: getColdmailPackageDailySendLimit(),
      sendDelayMs: getColdmailSendDelayMs(),
      safetyPauseMs: getColdmailSafetyPauseMs(),
      personalMailboxDailyLimit: getColdmailPersonalMailboxDailyLimit(),
      personalMailboxSendDelayMs: getColdmailPersonalMailboxSendDelayMs(),
      blocksPersonalMailboxDomains: shouldBlockPersonalMailboxDomains(),
      bounceProcessingEnabled: coldmailBounceProcessingEnabled !== false,
      openTrackingConfigured: isColdmailOpenTrackingConfigured(),
      configuredSenderEmails: getConfiguredSenderEmails(),
      auditBccConfigured: Boolean(getColdmailAuditBccAddress()),
    };
  }

  function parseTimestampMs(value) {
    const timestamp = Date.parse(normalizeString(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const oisterwijkCoords = { lat: 51.5792, lng: 5.1889 };
  const campaignPlaceCoords = {
    oisterwijk: { lat: 51.5792, lng: 5.1889 },
    tilburg: { lat: 51.5555, lng: 5.0913 },
    breda: { lat: 51.5719, lng: 4.7683 },
    eindhoven: { lat: 51.4416, lng: 5.4697 },
    'den bosch': { lat: 51.6978, lng: 5.3037 },
    's hertogenbosch': { lat: 51.6978, lng: 5.3037 },
    waalwijk: { lat: 51.6828, lng: 5.0707 },
    boxtel: { lat: 51.5908, lng: 5.3293 },
    udenhout: { lat: 51.6098, lng: 5.1436 },
    haaren: { lat: 51.6027, lng: 5.2222 },
    goirle: { lat: 51.5206, lng: 5.0667 },
    hilvarenbeek: { lat: 51.4858, lng: 5.1397 },
    chaam: { lat: 51.5069, lng: 4.8616 },
    alphen: { lat: 51.4817, lng: 4.9583 },
    ulvenhout: { lat: 51.5486, lng: 4.7967 },
    galder: { lat: 51.515, lng: 4.775 },
    strijbeek: { lat: 51.5006, lng: 4.7839 },
    bavel: { lat: 51.5653, lng: 4.8307 },
    gilze: { lat: 51.5442, lng: 4.9403 },
    'baarle-nassau': { lat: 51.4475, lng: 4.9292 },
    vught: { lat: 51.6533, lng: 5.2875 },
    best: { lat: 51.5075, lng: 5.3903 },
    oirschot: { lat: 51.505, lng: 5.3139 },
    helmond: { lat: 51.4793, lng: 5.657 },
    dongen: { lat: 51.6265, lng: 4.9383 },
    'etten-leur': { lat: 51.5706, lng: 4.6373 },
    roosendaal: { lat: 51.5308, lng: 4.4653 },
    'bergen op zoom': { lat: 51.4946, lng: 4.2872 },
    almkerk: { lat: 51.7714, lng: 4.9597 },
    werkendam: { lat: 51.8101, lng: 4.8944 },
    sleeuwijk: { lat: 51.815, lng: 4.952 },
    waalre: { lat: 51.3867, lng: 5.4447 },
    valkenswaard: { lat: 51.3513, lng: 5.4595 },
    veldhoven: { lat: 51.418, lng: 5.4024 },
    oss: { lat: 51.765, lng: 5.5181 },
    uden: { lat: 51.6608, lng: 5.6194 },
    veghel: { lat: 51.6167, lng: 5.5486 },
    schijndel: { lat: 51.6225, lng: 5.4319 },
    'sint-oedenrode': { lat: 51.5675, lng: 5.4597 },
  };

  function normalizePlaceKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function haversineKm(left, right) {
    const toRad = (value) => (Number(value) * Math.PI) / 180;
    const dLat = toRad(right.lat - left.lat);
    const dLng = toRad(right.lng - left.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function resolveRowCoords(row) {
    const explicitLat = Number(row && (row.lat || row.latitude || row.latitudeNumber));
    const explicitLng = Number(row && (row.lng || row.lon || row.longitude || row.longitudeNumber));
    if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng)) return { lat: explicitLat, lng: explicitLng };
    const haystack = normalizePlaceKey(
      [
        row && row.stad,
        row && row.plaats,
        row && row.city,
        row && row.gemeente,
        row && row.adres,
        row && row.address,
        row && row.location,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const placeKey = Object.keys(campaignPlaceCoords)
      .sort((left, right) => right.length - left.length)
      .find((key) => haystack.includes(normalizePlaceKey(key)));
    return placeKey ? campaignPlaceCoords[placeKey] : null;
  }

  function getRowDistanceKm(row) {
    const existing = Number(row && (row.distanceKm || row.afstandKm || row.radiusKm));
    if (Number.isFinite(existing) && existing >= 0) return existing;
    const coords = resolveRowCoords(row);
    return coords ? haversineKm(oisterwijkCoords, coords) : NaN;
  }

  function parseRadiusKm(value) {
    const parsed = Number.parseFloat(normalizeString(value).replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return 250;
    return Math.max(1, Math.min(MAX_COLDMAIL_RADIUS_KM, parsed));
  }

  function hasExplicitRadiusKm(value) {
    return normalizeString(value) !== '';
  }

  function pruneColdmailSendGuardEntries(entries) {
    const cutoffMs = now().getTime() - COLDMAIL_SEND_GUARD_WINDOW_MS;
    const currentMs = now().getTime();
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        count: Math.max(0, Number(entry.count || 0) || 0),
        personalCount: Math.max(0, Number(entry.personalCount || 0) || 0),
        safetyPauseUntil: normalizeString(entry.safetyPauseUntil || entry.until),
        safetyPauseReason: truncateText(normalizeString(entry.safetyPauseReason || entry.reason), 240),
      }))
      .filter((entry) => {
        const sentRecently = entry.count > 0 && parseTimestampMs(entry.at) >= cutoffMs;
        const activePause = parseTimestampMs(entry.safetyPauseUntil) > currentMs;
        return sentRecently || activePause;
      });
  }

  async function loadColdmailSendGuardState() {
    const state = await getUiStateValues(coldmailSendGuardScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailSendGuardKey] || '{}', {});
    return {
      entries: pruneColdmailSendGuardEntries(parsed && parsed.entries),
    };
  }

  async function saveColdmailSendGuardState(sendGuardState, actor = 'coldmail-send-guard') {
    const entries = pruneColdmailSendGuardEntries(sendGuardState && sendGuardState.entries).slice(-1000);
    await setUiStateValues(
      coldmailSendGuardScope,
      {
        [coldmailSendGuardKey]: JSON.stringify({ entries }),
      },
      {
        source: 'coldmail-send-guard',
        actor,
      }
    );
  }

  async function getColdmailSendQuota(senderEmail) {
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    const state = await loadColdmailSendGuardState();
    const entries = state.entries;
    const nowMs = now().getTime();
    const senderSent = entries
      .filter((entry) => entry.senderEmail === selectedSenderEmail)
      .reduce((sum, entry) => sum + entry.count, 0);
    const packageSent = entries.reduce((sum, entry) => sum + entry.count, 0);
    const personalMailboxSent = entries.reduce((sum, entry) => sum + entry.personalCount, 0);
    const safetyPause = entries
      .map((entry) => ({
        until: normalizeString(entry.safetyPauseUntil),
        reason: normalizeString(entry.safetyPauseReason),
        untilMs: parseTimestampMs(entry.safetyPauseUntil),
      }))
      .filter((entry) => entry.untilMs > nowMs)
      .sort((left, right) => right.untilMs - left.untilMs)[0] || null;
    const dailySendLimit = getColdmailDailySendLimit();
    const packageDailySendLimit = getColdmailPackageDailySendLimit();
    const personalMailboxDailyLimit = getColdmailPersonalMailboxDailyLimit();
    return {
      entries,
      senderSent,
      packageSent,
      personalMailboxSent,
      dailySendLimit,
      packageDailySendLimit,
      personalMailboxDailyLimit,
      senderRemaining: Math.max(0, dailySendLimit - senderSent),
      packageRemaining: Math.max(0, packageDailySendLimit - packageSent),
      personalMailboxRemaining: Math.max(0, personalMailboxDailyLimit - personalMailboxSent),
      safetyPause,
    };
  }

  function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const text = normalizeString(value).toLowerCase();
    if (['1', 'true', 'yes', 'ja', 'aan', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'nee', 'uit', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }

  function normalizeColdmailAutopilotSenderEmails(value) {
    const raw = Array.isArray(value)
      ? value
      : normalizeString(value)
        ? normalizeString(value).split(/[\s,;]+/g)
        : [];
    const seen = new Set();
    return raw
      .map(normalizeEmailAddress)
      .filter((email) => {
        if (!isLikelyValidEmail(email) || seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .slice(0, 5);
  }

  function isColdmailAutopilotAllowedSenderEmail(value) {
    return COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS.has(normalizeEmailAddress(value));
  }

  function normalizeColdmailAutopilotSenderProfiles(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const profiles = {};
    Object.keys(raw).forEach((email) => {
      const normalizedEmail = normalizeEmailAddress(email);
      if (!isColdmailAutopilotAllowedSenderEmail(normalizedEmail)) return;
      const profile = normalizeColdmailingSenderProfile(raw[email]);
      if (!profile.subject || !profile.body) return;
      profiles[normalizedEmail] = profile;
    });
    return profiles;
  }

  function normalizeColdmailAutopilotRadiusKm(value) {
    if (normalizeString(value) === '') return 50;
    return parseRadiusKm(value);
  }

  function normalizeColdmailAutopilotConfig(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const senderEmails = normalizeColdmailAutopilotSenderEmails(
      Object.prototype.hasOwnProperty.call(raw, 'senderEmails')
        ? raw.senderEmails
        : raw.senderEmail
    ).filter(isColdmailAutopilotAllowedSenderEmail);
    const rawSenderEmail = normalizeEmailAddress(raw.senderEmail);
    const senderEmail = isColdmailAutopilotAllowedSenderEmail(rawSenderEmail)
      ? rawSenderEmail
      : senderEmails[0] || '';
    if (senderEmail && !senderEmails.includes(senderEmail)) senderEmails.unshift(senderEmail);
    return {
      count: parsePositiveInt(
        raw.count || raw.batchSize || raw.batch,
        DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE,
        1,
        Math.min(10, getColdmailCampaignSendLimit())
      ),
      senderEmail: senderEmail || senderEmails[0] || '',
      senderEmails,
      senderProfiles: normalizeColdmailAutopilotSenderProfiles(raw.senderProfiles || raw.senders),
      subject: truncateText(normalizeString(raw.subject), 200),
      body: normalizeString(raw.body),
      aiInstructions: normalizeString(raw.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle) || 'Vriendelijk & professioneel',
      branch: normalizeString(raw.branch || raw.branche),
      service: normalizeString(raw.service),
      database: normalizeString(raw.database),
      specialAction: normalizeString(raw.specialAction),
      durationDays: parsePositiveInt(raw.durationDays, 14, 1, 90),
      radiusKm: normalizeColdmailAutopilotRadiusKm(raw.radiusKm),
    };
  }

  function normalizeColdmailAutopilotSchedule(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const startHour = parsePositiveInt(
      raw.startHour ?? raw.safeStartHour,
      DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR,
      0,
      23
    );
    const endHour = parsePositiveInt(
      raw.endHour ?? raw.safeEndHour,
      DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR,
      1,
      24
    );
    return {
      timezone: normalizeString(raw.timezone || raw.timeZone) || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
      weekdaysOnly: normalizeBooleanFlag(
        Object.prototype.hasOwnProperty.call(raw, 'weekdaysOnly') ? raw.weekdaysOnly : true,
        true
      ),
      startHour,
      endHour: Math.max(startHour + 1, endHour),
      minIntervalMinutes: parsePositiveInt(
        raw.minIntervalMinutes,
        DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES,
        5,
        240
      ),
    };
  }

  function getEnvColdmailAutopilotConfig() {
    return normalizeColdmailAutopilotConfig({
      count: env.COLDMAIL_AUTOPILOT_BATCH_SIZE || env.COLDMAIL_AUTOPILOT_COUNT,
      senderEmails: env.COLDMAIL_AUTOPILOT_SENDER_EMAILS || env.COLDMAIL_AUTOPILOT_SENDER_EMAIL,
      senderEmail: env.COLDMAIL_AUTOPILOT_SENDER_EMAIL,
      subject: env.COLDMAIL_AUTOPILOT_SUBJECT,
      body: env.COLDMAIL_AUTOPILOT_BODY,
      aiInstructions: env.COLDMAIL_AUTOPILOT_AI_INSTRUCTIONS,
      toneStyle: env.COLDMAIL_AUTOPILOT_TONE_STYLE,
      branch: env.COLDMAIL_AUTOPILOT_BRANCH,
      service: env.COLDMAIL_AUTOPILOT_SERVICE,
      database: env.COLDMAIL_AUTOPILOT_DATABASE,
      specialAction: env.COLDMAIL_AUTOPILOT_SPECIAL_ACTION,
      durationDays: env.COLDMAIL_AUTOPILOT_DURATION_DAYS,
      radiusKm: env.COLDMAIL_AUTOPILOT_RADIUS_KM,
    });
  }

  function getDefaultColdmailAutopilotState() {
    return {
      version: 1,
      enabled: normalizeBooleanFlag(env.COLDMAIL_AUTOPILOT_ENABLED, false),
      config: getEnvColdmailAutopilotConfig(),
      schedule: normalizeColdmailAutopilotSchedule({
        timezone: env.COLDMAIL_AUTOPILOT_TIMEZONE,
        weekdaysOnly: env.COLDMAIL_AUTOPILOT_WEEKDAYS_ONLY,
        startHour: env.COLDMAIL_AUTOPILOT_START_HOUR,
        endHour: env.COLDMAIL_AUTOPILOT_END_HOUR,
        minIntervalMinutes: env.COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES,
      }),
      lastRunAt: '',
      lastStartedAt: '',
      lastResult: null,
      lock: null,
      log: [],
      updatedAt: '',
      updatedBy: '',
      emergencyStoppedAt: '',
      emergencyStopReason: '',
    };
  }

  function normalizeColdmailAutopilotLog(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        ok: entry.ok !== false,
        skipped: Boolean(entry.skipped),
        reason: truncateText(normalizeString(entry.reason), 120),
        message: truncateText(normalizeString(entry.message), 240),
        sent: Math.max(0, Number(entry.sent || 0) || 0),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
      }))
      .filter((entry) => entry.at)
      .slice(-30);
  }

  function normalizeColdmailAutopilotState(value) {
    const defaults = getDefaultColdmailAutopilotState();
    const raw = value && typeof value === 'object' ? value : {};
    const rawConfig = raw.config && typeof raw.config === 'object' ? raw.config : {};
    const rawSchedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
    return {
      version: 1,
      enabled: normalizeBooleanFlag(
        Object.prototype.hasOwnProperty.call(raw, 'enabled') ? raw.enabled : defaults.enabled,
        defaults.enabled
      ),
      config: normalizeColdmailAutopilotConfig({ ...defaults.config, ...rawConfig }),
      schedule: normalizeColdmailAutopilotSchedule({ ...defaults.schedule, ...rawSchedule }),
      lastRunAt: normalizeString(raw.lastRunAt),
      lastStartedAt: normalizeString(raw.lastStartedAt),
      lastResult: raw.lastResult && typeof raw.lastResult === 'object' ? raw.lastResult : null,
      lock: raw.lock && typeof raw.lock === 'object'
        ? {
            startedAt: normalizeString(raw.lock.startedAt),
            expiresAt: normalizeString(raw.lock.expiresAt),
            actor: truncateText(normalizeString(raw.lock.actor), 120),
          }
        : null,
      log: normalizeColdmailAutopilotLog(raw.log),
      updatedAt: normalizeString(raw.updatedAt),
      updatedBy: truncateText(normalizeString(raw.updatedBy), 120),
      emergencyStoppedAt: normalizeString(raw.emergencyStoppedAt),
      emergencyStopReason: truncateText(normalizeString(raw.emergencyStopReason), 240),
    };
  }

  async function loadColdmailAutopilotState() {
    const state = await getUiStateValues(coldmailAutopilotScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return normalizeColdmailAutopilotState(
      safeJsonParse(values[coldmailAutopilotKey] || '{}', {})
    );
  }

  async function saveColdmailAutopilotState(state, actor = 'coldmail-autopilot') {
    const normalized = normalizeColdmailAutopilotState(state);
    await setUiStateValues(
      coldmailAutopilotScope,
      {
        [coldmailAutopilotKey]: JSON.stringify(normalized),
      },
      {
        source: 'coldmail-autopilot',
        actor,
      }
    );
    return normalized;
  }

  function summarizeColdmailAutopilotConfig(config) {
    const normalized = normalizeColdmailAutopilotConfig(config);
    return {
      count: normalized.count,
      senderEmail: normalized.senderEmail,
      senderEmails: normalized.senderEmails,
      senderProfilesConfigured: Object.keys(normalized.senderProfiles || {}),
      branch: normalized.branch,
      service: normalized.service,
      database: normalized.database,
      specialAction: normalized.specialAction,
      durationDays: normalized.durationDays,
      radiusKm: normalized.radiusKm,
      subjectConfigured: Boolean(normalized.subject),
      bodyConfigured: Boolean(normalized.body),
    };
  }

  function summarizeColdmailAutopilotState(state) {
    const normalized = normalizeColdmailAutopilotState(state);
    return {
      version: normalized.version,
      enabled: normalized.enabled,
      config: summarizeColdmailAutopilotConfig(normalized.config),
      schedule: normalized.schedule,
      lastRunAt: normalized.lastRunAt,
      lastStartedAt: normalized.lastStartedAt,
      lastResult: normalized.lastResult,
      lock: normalized.lock,
      log: normalized.log,
      updatedAt: normalized.updatedAt,
      updatedBy: normalized.updatedBy,
      safetyLimits: getColdmailSafetyLimits(),
    };
  }

  async function getColdmailAutopilotStatus() {
    const state = await loadColdmailAutopilotState();
    return {
      ok: true,
      autopilot: summarizeColdmailAutopilotState(state),
    };
  }

  async function updateColdmailAutopilotSettings(input = {}, actor = 'Coldmail Autopilot') {
    const state = await loadColdmailAutopilotState();
    const rawConfig = input && input.config && typeof input.config === 'object' ? input.config : {};
    const nextSenderEmails = Object.prototype.hasOwnProperty.call(rawConfig, 'senderEmails')
      ? rawConfig.senderEmails
      : Object.prototype.hasOwnProperty.call(rawConfig, 'senderEmail')
        ? rawConfig.senderEmail
        : state.config.senderEmails;
    const nextState = {
      ...state,
      enabled: Object.prototype.hasOwnProperty.call(input, 'enabled')
        ? normalizeBooleanFlag(input.enabled, state.enabled)
        : state.enabled,
      config: normalizeColdmailAutopilotConfig({
        ...state.config,
        ...rawConfig,
        senderEmails: nextSenderEmails,
      }),
      schedule: normalizeColdmailAutopilotSchedule({
        ...state.schedule,
        ...(input && input.schedule && typeof input.schedule === 'object' ? input.schedule : {}),
      }),
      updatedAt: now().toISOString(),
      updatedBy: truncateText(normalizeString(actor), 120),
    };
    if (!nextState.enabled) {
      nextState.lock = null;
      nextState.lastResult = {
        ok: true,
        skipped: true,
        reason: 'disabled',
        message: 'Coldmail autopilot staat uit.',
        at: now().toISOString(),
      };
    }
    const saved = await saveColdmailAutopilotState(nextState, actor);
    return {
      ok: true,
      autopilot: summarizeColdmailAutopilotState(saved),
    };
  }

  function normalizeColdmailingSenderProfile(value, fallback = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    return {
      subject: truncateText(normalizeString(raw.subject || base.subject), 200),
      body: normalizeString(raw.body || base.body),
      aiInstructions: normalizeString(raw.aiInstructions || base.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle || base.toneStyle || 'Vriendelijk & professioneel'),
    };
  }

  async function loadColdmailingSenderSettings() {
    const state = await getUiStateValues(coldmailingSettingsScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailingSettingsKey] || '{}', {});
    const raw = parsed && typeof parsed === 'object' ? parsed : {};
    const senders = {};
    Object.keys(raw.senders && typeof raw.senders === 'object' ? raw.senders : {}).forEach((email) => {
      const normalizedEmail = normalizeEmailAddress(email);
      if (!normalizedEmail) return;
      senders[normalizedEmail] = normalizeColdmailingSenderProfile(raw.senders[email]);
    });
    const senderEmail = normalizeEmailAddress(raw.senderEmail);
    if (!Object.keys(senders).length && senderEmail && (raw.subject || raw.body)) {
      senders[senderEmail] = normalizeColdmailingSenderProfile(raw);
    }
    return {
      senderEmail,
      subject: truncateText(normalizeString(raw.subject), 200),
      body: normalizeString(raw.body),
      aiInstructions: normalizeString(raw.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle) || 'Vriendelijk & professioneel',
      senders,
    };
  }

  function resolveColdmailAutopilotSenderProfile(settings, config, senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    const fallback = DEFAULT_COLDMAIL_SENDER_PROFILES[email] || DEFAULT_COLDMAIL_SENDER_PROFILES['serve@softora.nl'];
    const snapshots = config && config.senderProfiles && typeof config.senderProfiles === 'object'
      ? config.senderProfiles
      : {};
    const snapshot = snapshots[email] && typeof snapshots[email] === 'object'
      ? snapshots[email]
      : null;
    if (snapshot && snapshot.subject && snapshot.body) {
      return normalizeColdmailingSenderProfile(snapshot, fallback);
    }
    return {
      subject: '',
      body: '',
      aiInstructions: '',
      toneStyle: normalizeString(config && config.toneStyle) || fallback.toneStyle || 'Vriendelijk & professioneel',
    };
  }

  function getColdmailAutopilotSenderCandidates(state, settings) {
    const explicit = normalizeColdmailAutopilotSenderEmails([
      ...(state.config.senderEmails || []),
      state.config.senderEmail,
    ]).filter(isColdmailAutopilotAllowedSenderEmail);
    if (explicit.length) return explicit;
    return [];
  }

  async function chooseColdmailAutopilotSender(candidates) {
    const options = [];
    const skipped = [];
    for (const [index, candidate] of candidates.entries()) {
      try {
        const senderEmail = assertSenderAllowed(candidate);
        const senderAccount = resolveSenderSmtpAccount(senderEmail);
        if (!isSenderSmtpAccountConfigured(senderAccount)) {
          skipped.push({ senderEmail, reason: 'sender_smtp_not_configured' });
          continue;
        }
        const quota = await getColdmailSendQuota(senderEmail);
        const remaining = Math.min(quota.senderRemaining, quota.packageRemaining);
        if (quota.safetyPause) {
          skipped.push({ senderEmail, reason: 'coldmail_safety_paused', safetyPause: quota.safetyPause });
          continue;
        }
        if (remaining <= 0) {
          skipped.push({ senderEmail, reason: 'coldmail_daily_limit_reached', quota });
          continue;
        }
        options.push({ senderEmail, quota, remaining, index });
      } catch (error) {
        skipped.push({
          senderEmail: normalizeEmailAddress(candidate),
          reason: normalizeString(error && error.code) || 'sender_not_allowed',
        });
      }
    }
    options.sort((left, right) => {
      const sentDiff = (left.quota.senderSent || 0) - (right.quota.senderSent || 0);
      if (sentDiff !== 0) return sentDiff;
      return left.index - right.index;
    });
    return {
      selected: options[0] || null,
      skipped,
    };
  }

  function getZonedColdmailAutopilotParts(date, timezone) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
    } catch (_) {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
    }
    const getPart = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? part.value : '';
    };
    const rawHour = Number(getPart('hour'));
    return {
      weekday: getPart('weekday'),
      hour: rawHour === 24 ? 0 : rawHour,
      minute: Number(getPart('minute')) || 0,
    };
  }

  function isColdmailAutopilotInSchedule(schedule, date = now()) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    const parts = getZonedColdmailAutopilotParts(date, normalized.timezone);
    if (normalized.weekdaysOnly && ['Sat', 'Sun'].includes(parts.weekday)) {
      return {
        ok: false,
        reason: 'outside_weekday_window',
        message: 'Autopilot wacht tot de volgende werkdag.',
      };
    }
    if (parts.hour < normalized.startHour || parts.hour >= normalized.endHour) {
      return {
        ok: false,
        reason: 'outside_safe_hours',
        message: `Autopilot mailt alleen tussen ${String(normalized.startHour).padStart(2, '0')}:00 en ${String(normalized.endHour).padStart(2, '0')}:00.`,
      };
    }
    return { ok: true };
  }

  function isColdmailAutopilotLockActive(state) {
    const expiresAtMs = parseTimestampMs(state && state.lock && state.lock.expiresAt);
    return expiresAtMs > now().getTime();
  }

  function isColdmailAutopilotIntervalReady(state) {
    const schedule = normalizeColdmailAutopilotSchedule(state.schedule);
    const lastStartedAtMs = parseTimestampMs(state.lastStartedAt);
    if (!lastStartedAtMs) return { ok: true };
    const minIntervalMs = schedule.minIntervalMinutes * 60 * 1000;
    const readyAtMs = lastStartedAtMs + minIntervalMs;
    if (readyAtMs <= now().getTime()) return { ok: true };
    return {
      ok: false,
      reason: 'cooldown',
      message: `Autopilot wacht nog tot ${new Date(readyAtMs).toISOString()}.`,
    };
  }

  function compactColdmailAutopilotResult(result = {}) {
    return {
      ok: result.ok !== false,
      skipped: Boolean(result.skipped),
      reason: truncateText(normalizeString(result.reason || result.code), 120),
      message: truncateText(normalizeString(result.message), 500),
      at: normalizeString(result.at) || now().toISOString(),
      sent: Math.max(0, Number(result.sent || 0) || 0),
      failed: Math.max(0, Number(result.failed || 0) || 0),
      senderEmail: normalizeEmailAddress(result.senderEmail),
      selected: Math.max(0, Number(result.selected || 0) || 0),
      requested: Math.max(0, Number(result.requested || 0) || 0),
      dailyQuota: result.dailyQuota && typeof result.dailyQuota === 'object' ? result.dailyQuota : undefined,
      agendaBlocked: Boolean(result.agendaBlocked),
    };
  }

  async function finishColdmailAutopilotRun(state, result, actor, options = {}) {
    const compactResult = compactColdmailAutopilotResult(result);
    const latestState = await loadColdmailAutopilotState().catch(() => null);
    const preserveDisabledState =
      latestState &&
      latestState.enabled === false &&
      state &&
      state.enabled !== false;
    const baseState = preserveDisabledState
      ? {
          ...state,
          enabled: false,
          config: latestState.config || state.config,
          schedule: latestState.schedule || state.schedule,
          updatedAt: latestState.updatedAt || state.updatedAt,
          updatedBy: latestState.updatedBy || state.updatedBy,
          emergencyStoppedAt: latestState.emergencyStoppedAt || state.emergencyStoppedAt,
          emergencyStopReason: latestState.emergencyStopReason || state.emergencyStopReason,
        }
      : state;
    const logSource = preserveDisabledState && Array.isArray(latestState.log)
      ? latestState.log
      : baseState.log;
    const nextState = {
      ...baseState,
      lock: options.preserveLock && !preserveDisabledState ? baseState.lock : null,
      lastRunAt: compactResult.at,
      lastResult: compactResult,
      log: normalizeColdmailAutopilotLog([
        ...(logSource || []),
        compactResult,
      ]),
    };
    const saved = await saveColdmailAutopilotState(nextState, actor || 'Coldmail Autopilot');
    return {
      ...compactResult,
      autopilot: summarizeColdmailAutopilotState(saved),
    };
  }

  function buildColdmailAutopilotSkipResult(reason, message, extra = {}) {
    return {
      ok: true,
      skipped: true,
      reason,
      message,
      at: now().toISOString(),
      ...extra,
    };
  }

  async function runColdmailAutopilot(input = {}) {
    const actor = truncateText(normalizeString(input.actor), 120) || 'Coldmail Autopilot';
    let state = await loadColdmailAutopilotState();

    if (!state.enabled) {
      return finishColdmailAutopilotRun(
        state,
        buildColdmailAutopilotSkipResult('disabled', 'Coldmail autopilot staat uit.'),
        actor
      );
    }
    if (isColdmailAutopilotLockActive(state)) {
      return finishColdmailAutopilotRun(
        state,
        buildColdmailAutopilotSkipResult('already_running', 'Er draait al een autopilot-run.'),
        actor,
        { preserveLock: true }
      );
    }
    if (!input.force) {
      const scheduleCheck = isColdmailAutopilotInSchedule(state.schedule, now());
      if (!scheduleCheck.ok) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(scheduleCheck.reason, scheduleCheck.message),
          actor
        );
      }
      const intervalCheck = isColdmailAutopilotIntervalReady(state);
      if (!intervalCheck.ok) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(intervalCheck.reason, intervalCheck.message),
          actor
        );
      }
    }

    const startedAt = now().toISOString();
    state = await saveColdmailAutopilotState(
      {
        ...state,
        lastStartedAt: startedAt,
        lock: {
          startedAt,
          expiresAt: new Date(now().getTime() + DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS).toISOString(),
          actor,
        },
      },
      actor
    );

    try {
      let replySync = null;
      try {
        replySync = await syncInboundColdmailRepliesFromImap({ force: false, maxMessages: 30 });
      } catch (error) {
        replySync = {
          ok: false,
          skipped: true,
          reason: 'reply_sync_failed',
          message: truncateText(normalizeString(error && error.message), 240),
        };
      }

      const settings = await loadColdmailingSenderSettings();
      const candidates = getColdmailAutopilotSenderCandidates(state, settings);
      const senderChoice = await chooseColdmailAutopilotSender(candidates);
      if (!senderChoice.selected) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'no_sender_capacity',
            'Geen afzender heeft nu veilige verzendruimte of geldige SMTP-configuratie.',
            { senderSkips: senderChoice.skipped }
          ),
          actor
        );
      }

      const senderEmail = senderChoice.selected.senderEmail;
      const profile = resolveColdmailAutopilotSenderProfile(settings, state.config, senderEmail);
      if (!profile.subject || !profile.body) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'empty_mail_content',
            'Autopilot mist een onderwerp of mailtekst en heeft niets verzonden.',
            { senderEmail }
          ),
          actor
        );
      }

      const sendCount = Math.max(
        0,
        Math.min(
          state.config.count,
          senderChoice.selected.remaining,
          getColdmailCampaignSendLimit()
        )
      );
      if (sendCount <= 0) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'coldmail_daily_limit_reached',
            'Daglimiet bereikt. Autopilot heeft niets verzonden.',
            { senderEmail, dailyQuota: senderChoice.selected.quota }
          ),
          actor
        );
      }

      const sendResult = await sendColdmailCampaign({
        count: sendCount,
        subject: profile.subject,
        body: profile.body,
        aiInstructions: profile.aiInstructions,
        toneStyle: profile.toneStyle,
        branch: state.config.branch,
        service: state.config.service,
        database: state.config.database,
        senderEmail,
        specialAction: state.config.specialAction,
        durationDays: state.config.durationDays,
        radiusKm: state.config.radiusKm,
        mode: 'mail',
        testMode: false,
        publicBaseUrl: input.publicBaseUrl,
        actor,
      });
      return finishColdmailAutopilotRun(
        state,
        {
          ok: true,
          skipped: false,
          reason: 'sent',
          message: `${sendResult.sent || 0} coldmail(s) veilig verzonden.`,
          at: now().toISOString(),
          requested: sendResult.requested,
          selected: sendResult.selected,
          sent: sendResult.sent,
          failed: sendResult.failed,
          senderEmail,
          dailyQuota: sendResult.dailyQuota,
          replySync: replySync ? {
            ok: replySync.ok !== false,
            skipped: Boolean(replySync.skipped),
            reason: normalizeString(replySync.reason),
          } : undefined,
        },
        actor
      );
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_AUTOPILOT_FAILED';
      const knownSkip = COLDMAIL_AUTOPILOT_KNOWN_SKIP_CODES.has(code);
      return finishColdmailAutopilotRun(
        state,
        {
          ok: knownSkip,
          skipped: knownSkip,
          reason: code.toLowerCase(),
          message: truncateText(
            normalizeString(error && error.message) || 'Coldmail autopilot kon niet veilig draaien.',
            500
          ),
          at: now().toISOString(),
          failedItems: Array.isArray(error && error.failedItems) ? error.failedItems : undefined,
          dailyQuota: error && error.quota && typeof error.quota === 'object' ? error.quota : undefined,
        },
        actor
      );
    }
  }

  async function recordColdmailSendGuardEntry({ senderEmail, count, personalCount = 0, actor }) {
    const safeCount = Math.max(0, Number(count || 0) || 0);
    if (!safeCount) return false;
    const state = await loadColdmailSendGuardState();
    state.entries.push({
      at: now().toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      count: safeCount,
      personalCount: Math.max(0, Number(personalCount || 0) || 0),
    });
    await saveColdmailSendGuardState(state, actor);
    return true;
  }

  async function recordColdmailSafetyPause({ senderEmail, reason, error, actor }) {
    const state = await loadColdmailSendGuardState();
    const at = now();
    const until = new Date(at.getTime() + getColdmailSafetyPauseMs()).toISOString();
    const safetyReason = truncateText(
      normalizeString(reason || (error && error.message) || error || 'mail_provider_safety_signal'),
      240
    );
    state.entries.push({
      at: at.toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      count: 0,
      personalCount: 0,
      safetyPauseUntil: until,
      safetyPauseReason: safetyReason,
    });
    await saveColdmailSendGuardState(state, actor || 'coldmail-safety-pause');
    return { until, reason: safetyReason };
  }

  function getSmtpSafetyStopReason(error) {
    const text = [
      error && error.code,
      error && error.command,
      error && error.responseCode,
      error && error.response,
      error && error.message,
    ]
      .filter(Boolean)
      .join(' ');
    if (!COLDMAIL_SMTP_SAFETY_STOP_PATTERN.test(text)) return '';
    return truncateText(normalizeString(text), 240) || 'Mailprovider gaf een beschermingssignaal terug.';
  }

  function buildColdmailSafetyPauseMessage(pause) {
    const until = normalizeString(pause && pause.until);
    return until
      ? `Coldmailing staat tijdelijk op pauze tot ${until}, omdat de mailprovider een veiligheidsmelding gaf.`
      : 'Coldmailing staat tijdelijk op pauze omdat de mailprovider een veiligheidsmelding gaf.';
  }

  function matchesBranch(row, branchFilter) {
    const filter = normalizeString(branchFilter).toLowerCase();
    if (!filter) return true;
    return normalizeString(row.branche || row.branch || '').toLowerCase() === filter;
  }

  function matchesRadius(row, radiusKm) {
    const radius = parseRadiusKm(radiusKm);
    const distanceKm = getRowDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return !hasExplicitRadiusKm(radiusKm);
    return distanceKm <= radius;
  }

  function isEligibleColdmailRow(row, branchFilter, radiusKm, blockedEmailKeys) {
    if (isDedicatedTestModeRow(row)) return false;
    const email = getRowEmail(row);
    if (!isLikelyValidEmail(email)) return false;
    if (isEmailBlocked(email, blockedEmailKeys)) return false;
    if (row.mail === false || row.canMail === false || row.doNotMail === true) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    if (!matchesRadius(row, radiusKm)) return false;
    if (isTestRecipientRow(row, email)) return true;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !EXCLUDED_DATABASE_STATUSES.has(status);
  }

  function isEligibleColdcallingRow(row, branchFilter, radiusKm, blockedPhoneKeys) {
    if (isDedicatedTestModeRow(row)) return false;
    const phone = getRowPhone(row);
    if (!isLikelyCallablePhone(phone)) return false;
    if (isPhoneBlocked(phone, blockedPhoneKeys)) return false;
    if (row.call === false || row.canCall === false || row.doNotCall === true) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    if (!matchesRadius(row, radiusKm)) return false;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !new Set(['interesse', 'afspraak', 'klant', 'afgehaakt', 'geblokkeerd', 'buiten']).has(status);
  }

  async function isDeliverableEmailDomain(email) {
    const domain = getEmailDomain(email);
    if (!domain) return false;
    return Boolean(await resolveEmailDomain(domain));
  }

  function isPersonalMailboxDomain(email) {
    const domain = getEmailDomain(email);
    return Boolean(domain && PERSONAL_MAILBOX_DOMAINS.has(domain));
  }

  async function resolveColdmailRecipients(input = {}) {
    const mode = normalizeString(input.mode || '').toLowerCase() === 'call' ? 'call' : 'mail';
    const count = parsePositiveInt(input.count, 10, 1, mode === 'call' ? 500 : getColdmailCampaignSendLimit());
    if (isCampaignTestModeEnabled(input.testMode)) {
      const customerState = await getUiStateValues(customerDbScope);
      const customerValues =
        customerState && typeof customerState.values === 'object' ? customerState.values : {};
      const customerRows = parseDatabaseRows(customerValues);
      const customerPhotoMap = shouldUseWebdesignAssets(input, mode) ? await loadCustomerPhotoMap(customerRows) : {};
      return buildResolvedColdmailTestRecipients(input, mode, count, customerRows, customerPhotoMap);
    }
    const blockedPhoneKeys = mode === 'call'
      ? parseBlockedPhoneList(input.blockedPhones || input.callBlocklist || input.blockedPhoneNumbers)
      : new Set();
    const blockedEmailKeys = mode === 'mail'
      ? parseBlockedEmailList(
          input.blockedEmails || input.emailBlocklist || input.mailBlocklist || input.blockedMailAddresses
        )
      : new Set();
    const state = await getUiStateValues(mode === 'call' ? leadDbScope : customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const customerState =
      mode === 'call' ? await getUiStateValues(customerDbScope) : state;
    const customerValues =
      customerState && typeof customerState.values === 'object' ? customerState.values : {};
    const customerRows = parseDatabaseRows(customerValues);
    let rows = [];
    if (mode === 'call') {
      rows = mergeColdcallingRowsWithCustomerRows(
        parseLeadDatabaseRows(values),
        parseLeadDatabaseRows(customerValues, customerDbKey)
      );
    } else {
      rows = customerRows;
    }
    const shouldRequireWebdesign = requiresReadyWebdesign(input, mode);
    const customerPhotoMap = shouldRequireWebdesign ? await loadCustomerPhotoMap(customerRows) : {};
    const readyWebdesignMatcher = shouldRequireWebdesign
      ? createReadyWebdesignMatcher(customerRows, customerPhotoMap)
      : null;

    const failed = [];
    const eligibleRows = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) =>
        mode === 'call'
          ? isEligibleColdcallingRow(row, input.branch, input.radiusKm, blockedPhoneKeys)
          : isEligibleColdmailRow(row, input.branch, input.radiusKm, blockedEmailKeys)
      );
    const candidateRows = [];
    const selectedRows = [];

    for (const item of eligibleRows) {
      if (readyWebdesignMatcher && !readyWebdesignMatcher.hasRow(item.row, item.index)) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          phone: getRowPhone(item.row),
          error: `Nog geen website-design klaar voor ${getRowCompany(item.row) || 'dit bedrijf'}.`,
        });
        continue;
      }
      candidateRows.push(item);
      if (mode === 'call') {
        selectedRows.push(item);
        if (selectedRows.length >= count) break;
        continue;
      }
      const email = getRowEmail(item.row);
      if (!isTestRecipientRow(item.row, email) && shouldBlockPersonalMailboxDomains() && isPersonalMailboxDomain(email)) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `Persoonlijke mailbox overgeslagen voor coldmail: ${getEmailDomain(email)}.`,
        });
        continue;
      }
      if (await isDeliverableEmailDomain(email)) {
        selectedRows.push(item);
        if (selectedRows.length >= count) break;
      } else {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `E-maildomein bestaat niet of ontvangt geen mail: ${getEmailDomain(email) || email}`,
        });
      }
    }

    return {
      count,
      mode,
      radiusKm: parseRadiusKm(input.radiusKm),
      values,
      customerValues,
      customerRows,
      rows,
      candidateRows,
      selectedRows,
      failed,
      customerPhotoMap,
    };
  }

  async function getColdmailCampaignRecipients(input = {}) {
    const resolved = await resolveColdmailRecipients(input);
    return {
      ok: true,
      mode: resolved.mode,
      testMode: Boolean(resolved.testMode),
      requested: resolved.count,
      radiusKm: resolved.radiusKm,
      candidates: resolved.candidateRows.length,
      selected: resolved.selectedRows.length,
      safetyLimits: getColdmailSafetyLimits(),
      recipients: resolved.selectedRows.map((item) => {
        const website = getRowDomain(item.row);
        const recipient = {
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          phone: getRowPhone(item.row),
          distanceKm: Number.isFinite(getRowDistanceKm(item.row)) ? Math.round(getRowDistanceKm(item.row) * 10) / 10 : null,
        };
        if (website) recipient.website = website;
        return recipient;
      }),
      failedItems: resolved.failed,
    };
  }

  function getColdmailReplyHistoryEntry(row) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    return history.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const source = normalizeString(item.source).toLowerCase();
      const type = normalizeDatabaseStatus(item.type || item.status, item);
      return type === 'interesse' && source === 'coldmail-inbound-reply';
    }) || null;
  }

  function hasColdmailReplyInterestSignal(row) {
    if (!row || typeof row !== 'object') return false;
    if (normalizeString(row.coldmailReplyIntent).toLowerCase() === 'interested') return true;
    if (normalizeString(row.lastColdmailReplyAt || row.lastColdmailReplyMessageKey)) return true;
    return Boolean(getColdmailReplyHistoryEntry(row));
  }

  function isColdmailReplyFollowUpRow(row) {
    if (!row || typeof row !== 'object') return false;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return status === 'interesse' && hasColdmailReplyInterestSignal(row);
  }

  function getColdmailReplyFollowUpTimestampMs(row) {
    const historyEntry = getColdmailReplyHistoryEntry(row);
    return Math.max(
      parseTimestampMs(row && row.lastColdmailReplyAt),
      parseTimestampMs(historyEntry && historyEntry.date),
      parseTimestampMs(row && row.updatedAt)
    );
  }

  function buildColdmailReplyFollowUpItem(row, index) {
    const historyEntry = getColdmailReplyHistoryEntry(row);
    const replyAt = normalizeString(row.lastColdmailReplyAt || (historyEntry && historyEntry.date) || row.updatedAt);
    return {
      id: getRowId(row, index),
      bedrijf: getRowCompany(row),
      naam: getRowContact(row),
      email: getRowEmail(row),
      telefoon: getRowPhone(row),
      branche: normalizeString(row.branche || row.branch || ''),
      plaats: getRowCity(row),
      status: 'interesse',
      replyAt,
      subject: truncateText(normalizeString(row.lastColdmailReplySubject || (historyEntry && historyEntry.subject)), 240),
      preview: truncateText(normalizeString(row.lastColdmailReplyPreview || (historyEntry && historyEntry.preview)), 500),
      messageKey: normalizeString(row.lastColdmailReplyMessageKey || (historyEntry && historyEntry.messageKey)),
    };
  }

  async function listColdmailReplyFollowUps(input = {}) {
    const limit = parsePositiveInt(input.limit, 20, 1, 100);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const items = rows
      .map((row, index) => ({ row, index, timestampMs: getColdmailReplyFollowUpTimestampMs(row) }))
      .filter(({ row }) => isColdmailReplyFollowUpRow(row))
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .map(({ row, index }) => buildColdmailReplyFollowUpItem(row, index));

    return {
      ok: true,
      total: items.length,
      limit,
      items: items.slice(0, limit),
    };
  }

  function personalizeTemplate(template, row) {
    const company = getRowCompany(row) || 'uw bedrijf';
    const contact = getRowContact(row) || company;
    const domain = getRowDomain(row);
    const city = getRowCity(row) || 'uw regio';
    return normalizeString(template)
      .replace(/\{\{\s*bedrijf\s*\}\}/gi, company)
      .replace(/\{\{\s*naam\s*\}\}/gi, contact)
      .replace(/\{\{\s*(stad|plaats|locatie)\s*\}\}/gi, city)
      .replace(/\{\{\s*domein\s*\}\}/gi, domain || company)
      .replace(/\{\{\s*website\s*\}\}/gi, domain || company);
  }

  function buildMailText(body, row) {
    return personalizeTemplate(body, row)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function appendColdmailOptOutText(text, unsubscribeUrl = '') {
    const cleanText = normalizeString(text);
    const cleanUrl = normalizeString(unsubscribeUrl);
    const optOutText = cleanUrl
      ? `${COLDMAIL_OPT_OUT_TEXT_PREFIX}: ${cleanUrl}`
      : COLDMAIL_OPT_OUT_LABEL;
    if (!cleanText) return optOutText;
    if (!shouldAppendColdmailOptOutText(cleanText)) return cleanText;
    return `${cleanText}\n\n${optOutText}`;
  }

  function shouldAppendColdmailOptOutText(text) {
    return !/(?:geen webdesign willen ontvangen\?\s*laat het me weten!?|had je liever geen webdesign willen ontvangen\?\s*laat het me hier weten!?|past dit niet\?\s*laat het me hier weten|liever geen e-mails meer ontvangen|geen e-mails meer ontvangen.*https?:\/\/|afmelden:\s*https?:\/\/|\/afmelden\?t=|\/coldmailing\/afmelden\?t=|unsubscribe:\s*https?:\/\/)/i.test(
      normalizeString(text)
    );
  }

  function buildColdmailReference(row, id) {
    const seed = sanitizeFilename(id || getRowCompany(row) || getRowEmail(row) || 'mail', 'mail')
      .replace(/-/g, '')
      .slice(0, 8)
      .toUpperCase();
    const stamp = now().toISOString().slice(0, 10).replace(/-/g, '');
    return `SF-${stamp}-${seed || 'MAIL'}`;
  }

  function encodeBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function decodeBase64Url(value) {
    const normalized = normalizeString(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  function getColdmailUnsubscribeSecret() {
    return normalizeString(coldmailUnsubscribeSecret || smtpPass || imapPass || mailFromAddress || 'softora-coldmail');
  }

  function getColdmailTrackingSecret() {
    return normalizeString(coldmailTrackingSecret || coldmailUnsubscribeSecret || smtpPass || imapPass || mailFromAddress || 'softora-coldmail-open');
  }

  function signColdmailUnsubscribePayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailUnsubscribeSecret())
      .update(normalizeString(encodedPayload))
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function signColdmailOpenTrackingPayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailTrackingSecret())
      .update(normalizeString(encodedPayload))
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function buildColdmailUnsubscribeToken(row, id, reference) {
    const payload = {
      v: 1,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailUnsubscribePayload(encodedPayload)}`;
  }

  function createColdmailTrackingId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
  }

  function buildColdmailOpenTrackingToken(row, id, reference, trackingId) {
    const payload = {
      v: 1,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      tid: normalizeString(trackingId),
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailOpenTrackingPayload(encodedPayload)}`;
  }

  function verifyColdmailUnsubscribeToken(token) {
    const cleanToken = normalizeString(token);
    const parts = cleanToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const expected = signColdmailUnsubscribePayload(parts[0]);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parts[1]);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const payload = safeJsonParse(decodeBase64Url(parts[0]), {});
    const email = normalizeEmailAddress(payload && payload.email);
    if (!payload || typeof payload !== 'object' || !email) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    return {
      v: Number(payload.v || 1),
      id: normalizeString(payload.id),
      email,
      ref: normalizeString(payload.ref),
      ts: normalizeString(payload.ts),
    };
  }

  function verifyColdmailOpenTrackingToken(token) {
    const cleanToken = normalizeString(token);
    const parts = cleanToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    const expected = signColdmailOpenTrackingPayload(parts[0]);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parts[1]);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    const payload = safeJsonParse(decodeBase64Url(parts[0]), {});
    const email = normalizeEmailAddress(payload && payload.email);
    const trackingId = normalizeString(payload && payload.tid);
    if (!payload || typeof payload !== 'object' || !email || !trackingId) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    return {
      v: Number(payload.v || 1),
      id: normalizeString(payload.id),
      email,
      ref: normalizeString(payload.ref),
      trackingId,
      ts: normalizeString(payload.ts),
    };
  }

  function normalizePublicBaseUrl(value) {
    const raw = normalizeString(value).replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      return parsed.origin;
    } catch (_) {
      return '';
    }
  }

  function buildColdmailUnsubscribeUrl(row, id, reference, input = {}) {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailUnsubscribeToken(row, id, reference);
    return `${baseUrl}${COLDMAIL_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
  }

  function buildColdmailOneClickUnsubscribeUrl(row, id, reference, input = {}) {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailUnsubscribeToken(row, id, reference);
    return `${baseUrl}/api/coldmailing/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  function buildColdmailOpenTrackingUrl(row, id, reference, trackingId, input = {}) {
    const cleanTrackingId = normalizeString(trackingId);
    if (!cleanTrackingId) return '';
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailOpenTrackingToken(row, id, reference, cleanTrackingId);
    const params = new URLSearchParams();
    params.set('tid', cleanTrackingId);
    params.set('token', token);
    return `${baseUrl}/api/coldmailing/open.gif?${params.toString()}`;
  }

  function isColdmailOpenTrackingConfigured() {
    return Boolean(getColdmailTrackingSecret());
  }

  function getColdmailListUnsubscribeHeader(senderEmail, row, id, reference, input = {}) {
    const replyTo = normalizeEmailAddress(getColdmailReplyToAddress(senderEmail));
    const parts = [];
    if (isLikelyValidEmail(replyTo)) {
      parts.push(`<mailto:${replyTo}?subject=${encodeURIComponent('Afmelden')}>`);
    }
    const oneClickUrl = buildColdmailOneClickUnsubscribeUrl(row, id, reference, input);
    if (oneClickUrl) parts.push(`<${oneClickUrl}>`);
    return parts.join(', ');
  }

  function getColdmailListUnsubscribePostHeader(row, id, reference, input = {}) {
    return buildColdmailOneClickUnsubscribeUrl(row, id, reference, input)
      ? 'List-Unsubscribe=One-Click'
      : '';
  }

  function buildColdmailPreviewImageToken(row, id, reference, type = 'webdesign') {
    const payload = {
      v: 1,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      type: normalizeString(type || 'webdesign').toLowerCase() === 'mockup' ? 'mockup' : 'webdesign',
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailUnsubscribePayload(encodedPayload)}`;
  }

  function verifyColdmailPreviewImageToken(token) {
    const payload = verifyColdmailUnsubscribeToken(token);
    const decoded = safeJsonParse(decodeBase64Url(normalizeString(token).split('.')[0]), {});
    const type = normalizeString(decoded && decoded.type).toLowerCase();
    return {
      ...payload,
      type: type === 'mockup' ? 'mockup' : 'webdesign',
    };
  }

  function buildColdmailPreviewImageUrl(row, id, reference, input = {}, type = 'webdesign') {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailPreviewImageToken(row, id, reference, type);
    return `${baseUrl}${COLDMAIL_PREVIEW_IMAGE_PATH}?t=${encodeURIComponent(token)}`;
  }

  function appendColdmailReference(text, reference) {
    const cleanText = normalizeString(text);
    const cleanReference = normalizeString(reference);
    if (!cleanReference) return cleanText;
    return `${cleanText}\n\nReferentie: ${cleanReference}`;
  }

  function appendHiddenColdmailReferenceHtml(html, reference) {
    const cleanReference = normalizeString(reference);
    if (!cleanReference) return html;
    return `${html}\n<!-- Softora referentie ${escapeHtml(cleanReference)} -->`;
  }

  function appendColdmailOptOutHtml(html, unsubscribeUrl = '') {
    const cleanUrl = normalizeString(unsubscribeUrl);
    if (!cleanUrl) return html;
    return `${html}\n<p style="margin:18px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;"><a href="${escapeHtml(
      cleanUrl
    )}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(COLDMAIL_OPT_OUT_LABEL)}</a></p>`;
  }

  function appendColdmailOpenTrackingPixelHtml(html, trackingUrl = '') {
    const cleanUrl = normalizeString(trackingUrl);
    if (!cleanUrl) return html;
    return `${html}\n<img src="${escapeHtml(cleanUrl)}" alt="" width="1" height="1" style="display:none!important;width:1px!important;height:1px!important;opacity:0!important;overflow:hidden!important;border:0!important;" />`;
  }

  function escapeHtml(value) {
    return normalizeString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function parseDataUrlImage(value) {
    const match = normalizeString(value).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    return {
      contentType: match[1].toLowerCase(),
      content: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    };
  }

  async function resolveImageAttachment(value) {
    const parsed = parseDataUrlImage(value);
    if (parsed) return parsed;
    const url = normalizeString(value);
    if (!/^https:\/\//i.test(url) || typeof fetch !== 'function') return null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) return null;
      const contentType = normalizeString(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].toLowerCase();
      if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) return null;
      const arrayBuffer = await response.arrayBuffer();
      const content = Buffer.from(arrayBuffer);
      if (!content.length || content.length > 10 * 1024 * 1024) return null;
      return { contentType, content };
    } catch (error) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function getImageExtension(contentType) {
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'image/gif') return 'gif';
    return 'png';
  }

  function sanitizeFilename(value, fallback = 'webdesign') {
    const normalized = normalizeString(value)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return normalized || fallback;
  }

  function renderColdmailHtmlLine(line, options = {}) {
    const cleanLine = normalizeString(line);
    const senderEmail = normalizeEmailAddress(options.senderEmail || '');
    const cta = COLDMAIL_LINKEDIN_CTA_BY_SENDER[senderEmail];
    if (!cta || !cleanLine.includes(cta.text)) return escapeHtml(cleanLine);
    const link = `<a href="${escapeHtmlAttribute(
      cta.url
    )}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;font-weight:600;">${escapeHtml(
      cta.text
    )}</a>`;
    return cleanLine
      .split(cta.text)
      .map((part) => escapeHtml(part))
      .join(link);
  }

  function toHtml(text, options = {}) {
    const body = normalizeString(text)
      .split(/\n{2,}/)
      .map((paragraph) =>
        `<p>${paragraph
          .split('\n')
          .map((line) => renderColdmailHtmlLine(line, options))
          .join('<br>')}</p>`
      )
      .join('\n');
    return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;">${body}</div>`;
  }

  function getWebdesignPhotoSource(photo) {
    if (!photo || typeof photo !== 'object') return '';
    return normalizeString(
      photo.websitePhoto ||
        photo.websitePhotoUrl ||
        photo.signedUrl ||
        (photo.storage && photo.storage.signedUrl)
    );
  }

  function getWebdesignMockupSource(photo) {
    if (!photo || typeof photo !== 'object') return '';
    return normalizeString(
      photo.websiteMockup ||
        photo.websiteMockupUrl ||
        photo.mockupUrl ||
        photo.signedMockupUrl ||
        (photo.mockupStorage && photo.mockupStorage.signedUrl)
    );
  }

  function appendWebdesignImageHtml(html, attachment, options = {}) {
    if (!attachment || !attachment.cid) return html;
    const optOutText = normalizeString(options.optOutText || '');
    const optOutUrl = normalizeString(options.optOutUrl || '');
    const mockupCaption = normalizeString(options.mockupCaption || COLDMAIL_MOCKUP_CAPTION);
    const optOutHtml = optOutText
      ? `\n<p style="margin:7px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;">${
          optOutUrl
            ? `<a href="${escapeHtml(optOutUrl)}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(optOutText)}</a>`
            : escapeHtml(optOutText)
        }</p>`
      : '';
    const emailImageMaxWidth = Math.min(COLDMAIL_DESKTOP_IMAGE_MAX_WIDTH, 640);
    const renderEmailImageTable = (cid, alt, margin) =>
      `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:${margin};"><tr><td style="padding:0;margin:0;width:100%;font-size:0;line-height:0;overflow:visible;"><img src="cid:${escapeHtml(
        cid
      )}" alt="${escapeHtml(
        alt
      )}" width="${emailImageMaxWidth}" style="display:block;width:100%;max-width:${emailImageMaxWidth}px;height:auto;max-height:none;border:0;outline:none;text-decoration:none;border-radius:12px;object-fit:contain;" /></td></tr></table>`;
    const previewBlockHtml = renderEmailImageTable(attachment.cid, attachment.alt || 'Webdesign', '24px 0 0 0');
    const mockupHtml = attachment.mockup && attachment.mockup.cid
      ? `\n<p style="margin:20px 0 7px 0;font-size:16px;line-height:1.45;color:#1a1a2e;font-weight:700;">${escapeHtml(mockupCaption)}</p>${renderEmailImageTable(
          attachment.mockup.cid,
          attachment.mockup.alt || 'Device mockup',
          '0'
        )}`
      : '';
    const imageBlockHtml = `${previewBlockHtml}${mockupHtml}`;
    return `${html}${imageBlockHtml}${optOutHtml}`;
  }

  async function loadColdmailReplyState() {
    const state = await getUiStateValues(coldmailReplyScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailReplyKey] || '{}', {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? {
          processed: parsed.processed && typeof parsed.processed === 'object' ? parsed.processed : {},
        }
      : { processed: {} };
  }

  async function saveColdmailReplyState(replyState, actor = 'coldmail-auto-reply') {
    const processed = replyState && replyState.processed && typeof replyState.processed === 'object'
      ? replyState.processed
      : {};
    const entries = Object.entries(processed).slice(-500);
    await setUiStateValues(
      coldmailReplyScope,
      {
        [coldmailReplyKey]: JSON.stringify({ processed: Object.fromEntries(entries) }),
      },
      {
        source: 'coldmail-auto-reply',
        actor,
      }
    );
  }

  function getInboundMessageProcessedKey(parsedMail, message) {
    const messageId = normalizeMessageIdToken(parsedMail && parsedMail.messageId);
    if (messageId) return `message:${messageId}`;
    const from = getParsedMailFromEmail(parsedMail);
    return [
      'fallback',
      from.address,
      normalizeString(parsedMail && parsedMail.subject).toLowerCase(),
      message && message.uid ? `uid:${message.uid}` : '',
    ]
      .filter(Boolean)
      .join('|');
  }

  async function generateColdmailAutoReplyWithOpenAi({ row, inboundText, inboundSubject, fromName, senderEmail }) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const error = new Error('OPENAI_API_KEY ontbreekt');
      error.code = 'OPENAI_NOT_CONFIGURED';
      error.status = 503;
      throw error;
    }
    const model = normalizeString(coldmailAutoReplyModel) || 'gpt-5.5-pro';
    const company = getRowCompany(row);
    const contact = getRowContact(row);
    const website = getRowDomain(row);
    const selectedSenderEmail = normalizeEmailAddress(senderEmail || mailFromAddress || smtpUser || imapUser);
    const senderName = getSenderDisplayName(selectedSenderEmail);
    const system = [
      `Je bent ${senderName || 'Softora'} van Softora.`,
      'Je reageert automatisch op replies op coldmailcampagnes.',
      'Schrijf in natuurlijk Nederlands, kort, menselijk en professioneel.',
      'Klink niet als een chatbot en gebruik geen markdown.',
      'Doel: help de prospect verder en stuur rustig richting een korte kennismaking of concrete vervolgstap.',
      'Verzin geen prijzen, garanties, afspraken of technische details die niet in de context staan.',
      'Als iemand geen interesse heeft, reageer beleefd en rond af zonder door te pushen.',
      'Geef alleen de mailtekst terug, zonder onderwerpregel.',
    ].join('\n');
    const payload = {
      prospect: {
        company,
        contact,
        email: getRowEmail(row),
        website,
        branche: normalizeString(row.branche || row.branch || ''),
      },
      inbound: {
        fromName: normalizeString(fromName),
        subject: truncateText(inboundSubject, 240),
        text: truncateText(inboundText, 4000),
      },
      sender: {
        name: senderName || 'Softora',
        email: selectedSenderEmail,
        company: 'Softora',
      },
    };
    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...buildOpenAiContextHeaders({ env, openAiApiBaseUrl }),
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      65000
    );
    if (!response.ok) {
      const error = new Error(`OpenAI coldmail auto-reply mislukt (${response.status})`);
      error.code = 'OPENAI_AUTO_REPLY_FAILED';
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const reply = truncateText(extractOpenAiReplyText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content), 6000);
    if (!reply) {
      const error = new Error('OpenAI gaf een lege auto-reply terug.');
      error.code = 'EMPTY_AI_REPLY';
      error.status = 502;
      throw error;
    }
    return { text: reply, model: normalizeString(data && data.model) || model, usage: data && data.usage ? data.usage : null };
  }

  function buildReplySubject(subject) {
    const value = normalizeString(subject || 'Uw reactie');
    return /^re\s*:/i.test(value) ? value : `Re: ${value}`;
  }

  async function sendColdmailAutoReply({ parsedMail, row, senderEmail, replyText }) {
    const delivery = getSenderSmtpTransport(senderEmail);
    const transporter = delivery && delivery.transporter;
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const from = getParsedMailFromEmail(parsedMail);
    const messageId = normalizeString(parsedMail && parsedMail.messageId);
    const references = collectMessageReferenceHeader(parsedMail);
    const mail = {
      from: formatMailFromHeader(senderEmail, delivery.account),
      to: from.address,
      replyTo: getColdmailReplyToAddress(senderEmail),
      subject: buildReplySubject(parsedMail && parsedMail.subject),
      text: replyText,
      inReplyTo: messageId || undefined,
      references: references || undefined,
    };
    const info = await transporter.sendMail(mail);
    await saveSentCopy(senderEmail, mail, info, delivery.account);
    return info;
  }

  function buildCustomerPhotoDataKey(row) {
    const id = getExplicitRowId(row);
    if (!id) return '';
    return `softora_database_photo_data_v1_${id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)}`;
  }

  function readChunkedCustomerPhoto(values, photoKey, chunkCount = 0) {
    const key = normalizeString(photoKey);
    if (!key) return null;
    const count = Math.max(0, Math.min(80, Number(chunkCount || 0) || 0));
    const chunks = [];
    if (count) {
      for (let index = 0; index < count; index += 1) {
        chunks.push(normalizeString(values[`${key}_${index}`]));
      }
    } else {
      for (let index = 0; index < 80; index += 1) {
        const value = values[`${key}_${index}`];
        if (typeof value !== 'string') break;
        chunks.push(normalizeString(value));
      }
    }
    const dataUrl = chunks.join('');
    const parsed = parseDataUrlImage(dataUrl);
    return parsed ? { dataUrl, chunkCount: chunks.length } : null;
  }

  function parseCustomerPhotoMap(raw, values = {}, rows = []) {
    const parsed = safeJsonParse(raw || '{}', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stateValues = values && typeof values === 'object' ? values : {};
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key];
      if (!item || typeof item !== 'object') return;
      const photoKey = normalizeString(item.photoKey);
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, item.chunkCount);
      if (chunked) {
        item.websitePhoto = chunked.dataUrl;
        item.chunkCount = chunked.chunkCount;
      }
      const mockupPhotoKey = normalizeString(item.mockupPhotoKey || item.websiteMockupKey);
      const mockupChunked = readChunkedCustomerPhoto(
        stateValues,
        mockupPhotoKey,
        item.mockupChunkCount || item.websiteMockupChunkCount
      );
      if (mockupChunked) {
        item.websiteMockup = mockupChunked.dataUrl;
        item.mockupChunkCount = mockupChunked.chunkCount;
      }
    });
    (Array.isArray(rows) ? rows : []).forEach((entry, index) => {
      const row = entry && entry.row && typeof entry.row === 'object' ? entry.row : entry;
      const id = getExplicitRowId(row);
      if (!id) return;
      const photoKey = buildCustomerPhotoDataKey(row);
      if (!photoKey) return;
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, 0);
      if (!chunked) return;
      const existing = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : null;
      if (existing && normalizeString(existing.photoKey) && parseDataUrlImage(existing.websitePhoto)) return;
      parsed[id] = {
        ...(existing || {}),
        id,
        identityKey: normalizeString(existing && existing.identityKey) || buildRowIdentityKey(row),
        photoKey,
        chunkCount: chunked.chunkCount,
        websitePhoto: chunked.dataUrl,
        websitePhotoName: normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName) || 'Websitefoto',
      };
    });
    return parsed;
  }

  async function loadCustomerPhotoMap(rows = []) {
    const state = await getUiStateValues(customerPhotoScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values, rows);
  }

  async function resolveRowWebdesignPhoto(row, photoMap) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });
    const photo = preferFreshRowPhotoFields(row, findStoredPhotoRecordForRow(row, 0, photos, photosByIdentity));
    const parsed = await resolveImageAttachment(getWebdesignPhotoSource(photo));
    if (!parsed) return null;
    const baseName = sanitizeFilename(photo.websitePhotoName || `${getRowCompany(row)} webdesign`, 'webdesign');
    const extension = getImageExtension(parsed.contentType);
    const filename = `${baseName}.${extension}`;
    const cid = `webdesign-${sanitizeFilename(getRowId(row, 0), 'image')}@softora`;
    const mockupParsed = await resolveImageAttachment(getWebdesignMockupSource(photo));
    const mockupBaseName = sanitizeFilename(photo && (photo.websiteMockupName || `${getRowCompany(row)} device mockup`), 'device-mockup');
    const mockup = mockupParsed
      ? {
          ...mockupParsed,
          filename: `${mockupBaseName}.${getImageExtension(mockupParsed.contentType)}`,
          cid: `webdesign-mockup-${sanitizeFilename(getRowId(row, 0), 'image')}@softora`,
          alt: `${getRowCompany(row) || 'Bedrijf'} device mockup`,
        }
      : null;
    return {
      ...parsed,
      filename,
      cid,
      alt: `${getRowCompany(row) || 'Bedrijf'} webdesign`,
      mockup,
    };
  }

  function addDaysIso(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString();
  }

  function normalizeCampaignDurationDays(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'disabled' || normalized === 'uitgeschakeld' || normalized === '0') return 0;
    return parsePositiveInt(value, 14, 1, 90);
  }

  function markRowAsMailed(row, actor, durationDays, context = {}) {
    const date = now().toISOString();
    const safeDurationDays = normalizeCampaignDurationDays(durationDays);
    const campaignEndsAt = safeDurationDays > 0 ? addDaysIso(new Date(date), safeDurationDays) : '';
    const existingHistory = Array.isArray(row.hist) ? row.hist : [];
    const senderEmail = normalizeEmailAddress(context.senderEmail);
    const messageId = normalizeString(context.messageId);
    const trackingId = normalizeString(context.trackingId);
    const isWebdesignOutreach = isWebdesignSpecialAction(context.specialAction);
    const trackingFields = trackingId
      ? {
          coldmailTrackingId: trackingId,
          coldmailOpenTrackingId: trackingId,
          coldmailOpened: false,
          coldmailOpenedAt: '',
          coldmailFirstOpenedAt: '',
          coldmailLastOpenedAt: '',
          coldmailOpenCount: 0,
          outreachOpenedAt: '',
          outreachOpenCount: 0,
        }
      : {};
    const outreachFields = isWebdesignOutreach
      ? {
          campaignType: 'webdesign',
          campaign_type: 'webdesign',
          outreachCampaignType: 'webdesign',
          outreach_campaign_type: 'webdesign',
          coldmailSpecialAction: 'webdesign',
          outreachStatus: 'benaderd',
          actionRequired: false,
          outreachActionRequired: false,
          sentFromEmail: senderEmail,
          sent_from_email: senderEmail,
          outreachSentFromEmail: senderEmail,
          outreachSentAt: date,
          outreach_sent_at: date,
          coldmailSentMessageId: messageId,
          outreachMessageId: messageId,
          lastReplyAt: '',
          last_reply_at: '',
          replyThreadId: '',
          reply_thread_id: '',
          replyMessageId: '',
          replyMailboxId: '',
          replyMailboxAccount: '',
          statusUpdatedAt: date,
        }
      : {};
    return {
      ...row,
      ...outreachFields,
      ...trackingFields,
      status: 'gemaild',
      databaseStatus: 'gemaild',
      mail: true,
      lastColdmailSenderEmail: senderEmail || normalizeString(row.lastColdmailSenderEmail),
      lastMailSentAt: date,
      lastColdmailSentAt: date,
      coldmailCampaignStartedAt: date,
      coldmailCampaignDurationDays: safeDurationDays,
      coldmailCampaignEndsAt: campaignEndsAt,
      activeColdmailCampaignUntil: campaignEndsAt,
      updatedAt: date.slice(0, 10),
      hist: [
        {
          type: 'gemaild',
          label: 'Mail verstuurd',
          date: date.slice(0, 10),
          actor: normalizeString(actor) || 'Coldmailing',
        },
        ...existingHistory,
      ],
    };
  }

  function buildColdmailReplyHistoryEntry({
    classification,
    parsedMail,
    inboundText,
    processedKey,
    actor,
  }) {
    const date = now().toISOString();
    return {
      type: classification.status,
      label: classification.label,
      date,
      actor: normalizeString(actor) || 'Coldmailing',
      source: 'coldmail-inbound-reply',
      messageKey: normalizeString(processedKey),
      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      preview: truncateText(inboundText, 500),
    };
  }

  function mergeColdmailReplyHistory(row, entry) {
    const existingHistory = Array.isArray(row && row.hist) ? row.hist.filter(Boolean) : [];
    const messageKey = normalizeString(entry && entry.messageKey);
    const alreadyTracked = messageKey
      ? existingHistory.some((item) => normalizeString(item && item.messageKey) === messageKey)
      : false;
    return (alreadyTracked ? existingHistory : [entry, ...existingHistory]).slice(0, 50);
  }

  function findColdmailOpenTrackingRow(payload, rows = []) {
    const targetId = normalizeString(payload && payload.id);
    const targetEmail = normalizeEmailAddress(payload && payload.email);
    const targetTrackingId = normalizeString(payload && payload.trackingId);
    const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({
      row,
      index,
      id: getRowId(row, index),
      email: getRowEmail(row),
      trackingId: normalizeString(
        row && (row.coldmailTrackingId || row.coldmailOpenTrackingId || row.openTrackingId)
      ),
    }));
    return (
      items.find((item) => targetTrackingId && item.trackingId === targetTrackingId) ||
      items.find((item) => targetId && item.id === targetId && (!targetEmail || item.email === targetEmail)) ||
      items.find((item) => targetEmail && item.email === targetEmail) ||
      null
    );
  }

  function parseColdmailOpenTimestampMs(value) {
    const timestamp = Date.parse(normalizeString(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isColdmailOpenTokenBeforeReset(row, payload) {
    const resetAtMs = parseColdmailOpenTimestampMs(row && row.coldmailOpenTrackingResetAt);
    if (!resetAtMs) return false;
    const tokenAtMs = parseColdmailOpenTimestampMs(payload && payload.ts);
    return !tokenAtMs || tokenAtMs <= resetAtMs;
  }

  function buildColdmailOpenHistoryEntry(payload, actor) {
    const date = now().toISOString();
    return {
      type: 'mail_geopend',
      label: 'Mail geopend',
      date,
      actor: normalizeString(actor) || 'Coldmail open tracking',
      source: 'coldmail-open-tracking',
      messageKey: `open-${normalizeString(payload && payload.trackingId)}`,
      preview: 'Ontvanger heeft de coldmail geopend.',
    };
  }

  function markRowAsOpened(row, payload, actor) {
    const date = now().toISOString();
    const openCount = Math.max(0, Number(row && row.coldmailOpenCount) || 0) + 1;
    const historyEntry = buildColdmailOpenHistoryEntry(payload, actor);
    return {
      ...row,
      coldmailOpened: true,
      coldmailOpenedAt: row && row.coldmailOpenedAt ? row.coldmailOpenedAt : date,
      coldmailFirstOpenedAt: row && row.coldmailFirstOpenedAt ? row.coldmailFirstOpenedAt : date,
      coldmailLastOpenedAt: date,
      coldmailOpenCount: openCount,
      outreachOpenedAt: row && row.outreachOpenedAt ? row.outreachOpenedAt : date,
      outreachOpenCount: Math.max(0, Number(row && row.outreachOpenCount) || 0) + 1,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  async function recordColdmailOpen(input = {}) {
    let payload;
    try {
      payload = verifyColdmailOpenTrackingToken(input.token || input.t);
    } catch (error) {
      return {
        ok: false,
        updated: 0,
        code: normalizeString(error && error.code) || 'INVALID_OPEN_TRACKING_TOKEN',
      };
    }
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailOpenTrackingRow(payload, rows);
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        ok: true,
        updated: 0,
        reason: 'target_not_found',
      };
    }
    if (isColdmailOpenTokenBeforeReset(rows[match.index], payload)) {
      return {
        ok: true,
        updated: 0,
        reason: 'tracking_token_before_reset',
        id: match.id,
        email: match.email,
        trackingId: payload.trackingId,
      };
    }

    const nextRows = rows.slice();
    const actor = normalizeString(input.actor || 'Coldmail open tracking');
    nextRows[match.index] = markRowAsOpened(rows[match.index], payload, actor);
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows),
      {
        source: 'coldmail-open-tracking',
        actor,
      }
    );

    return {
      ok: true,
      updated: 1,
      id: match.id,
      email: match.email,
      trackingId: payload.trackingId,
    };
  }

  function findColdmailUnsubscribeRow(payload, rows = []) {
    const targetId = normalizeString(payload && payload.id);
    const targetEmail = normalizeEmailAddress(payload && payload.email);
    const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({
      row,
      index,
      id: getRowId(row, index),
      email: getRowEmail(row),
    }));
    const exact = items.find((item) => item.id === targetId && item.email === targetEmail);
    if (exact) return exact;
    const emailMatches = items.filter((item) => item.email === targetEmail);
    return emailMatches.length === 1 ? emailMatches[0] : null;
  }

  function markRowFromColdmailUnsubscribe(row, payload, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const nextStatus = canAdvanceContactStatus(currentStatus, 'geblokkeerd')
      ? 'geblokkeerd'
      : currentStatus || 'geblokkeerd';
    const historyEntry = {
      type: 'geblokkeerd',
      label: 'Afgemeld via afmeldlink',
      date,
      actor: normalizeString(actor) || 'coldmail-unsubscribe-link',
      source: 'coldmail-unsubscribe-link',
      messageKey: normalizeString(payload && payload.ref) || `unsubscribe-${normalizeEmailAddress(payload && payload.email)}`,
      preview: 'Ontvanger heeft op afmelden geklikt.',
    };
    return {
      ...row,
      mail: false,
      canMail: false,
      doNotMail: true,
      status: nextStatus,
      databaseStatus: nextStatus,
      coldmailReplyIntent: 'opt_out',
      lastColdmailReplyAt: date,
      lastColdmailUnsubscribedAt: date,
      activeColdmailCampaignUntil: '',
      coldmailCampaignEndsAt: '',
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  function markRowFromColdmailReply(row, classification, parsedMail, inboundText, processedKey, actor, context = {}) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const isWebdesignOutreach = isWebdesignOutreachRow(row);
    const hasDefinitiveOutreachStatus =
      isOutreachDefinitiveStatus(row.outreachStatus) || isOutreachDefinitiveStatus(currentStatus);
    const shouldHoldForManualAction =
      isWebdesignOutreach && classification.status !== 'geblokkeerd' && !hasDefinitiveOutreachStatus;
    const canAdvance = canAdvanceContactStatus(currentStatus, classification.status);
    const nextStatus = shouldHoldForManualAction ? currentStatus : canAdvance ? classification.status : currentStatus;
    const nextOutreachStatus =
      shouldHoldForManualAction
        ? 'reactie_ontvangen'
        : classification.status === 'geblokkeerd'
          ? 'geen_interesse'
          : normalizeOutreachStatus(nextStatus) || normalizeOutreachStatus(row.outreachStatus) || 'reactie_ontvangen';
    const historyClassification = shouldHoldForManualAction
      ? {
          ...classification,
          status: 'reactie_ontvangen',
          label: 'Reactie ontvangen op webdesign-mail',
        }
      : classification;
    const historyEntry = buildColdmailReplyHistoryEntry({
      classification: historyClassification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
    });
    const shouldClearCampaignWindow =
      !shouldHoldForManualAction &&
      (['interesse', 'geblokkeerd'].includes(nextStatus) ||
        ['interesse', 'geblokkeerd'].includes(classification.status));
    const mailFields = classification.disableMail
      ? {
          mail: false,
          canMail: false,
          doNotMail: true,
        }
      : {};
    const inboundRecipientEmail = normalizeEmailAddress(context.mailboxAccount);
    const replyMessageId = normalizeString(parsedMail && parsedMail.messageId);
    const replyMailboxId = normalizeString(context.mailboxId);
    const outreachFields = isWebdesignOutreach
      ? {
          lastReplyAt: date,
          last_reply_at: date,
          replyThreadId: replyMailboxId || normalizeString(processedKey),
          reply_thread_id: replyMailboxId || normalizeString(processedKey),
          replyMessageId,
          replyMailboxId,
          replyMailboxFolder: normalizeString(context.mailboxFolder),
          replyMailboxAccount: inboundRecipientEmail,
          outreachStatus: nextOutreachStatus,
          actionRequired: shouldHoldForManualAction,
          outreachActionRequired: shouldHoldForManualAction,
          statusUpdatedAt: date,
        }
      : {};

    return {
      ...row,
      ...mailFields,
      ...outreachFields,
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      coldmailReplyIntent: classification.intent,
      lastColdmailReplyAt: date,
      lastColdmailReplySubject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      lastColdmailReplyPreview: truncateText(inboundText, 1000),
      lastColdmailReplyMessageKey: normalizeString(processedKey),
      activeColdmailCampaignUntil: shouldClearCampaignWindow ? '' : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: shouldClearCampaignWindow ? '' : row.coldmailCampaignEndsAt,
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  function buildColdmailBounceHistoryEntry({
    classification,
    parsedMail,
    inboundText,
    processedKey,
    actor,
  }) {
    const date = now().toISOString();
    const hardBounce = classification && classification.bounceType === 'hard';
    return {
      type: hardBounce ? 'geblokkeerd' : 'mail_bounce',
      label: normalizeString(classification && classification.label) || 'Mailservermelding ontvangen',
      date,
      actor: normalizeString(actor) || 'Coldmailing',
      source: 'coldmail-bounce',
      messageKey: normalizeString(processedKey),
      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      preview: truncateText(inboundText, 500),
    };
  }

  function markRowFromColdmailBounce(row, classification, parsedMail, inboundText, processedKey, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const hardBounce = classification && classification.bounceType === 'hard';
    const nextStatus =
      hardBounce && canAdvanceContactStatus(currentStatus, 'geblokkeerd')
        ? 'geblokkeerd'
        : currentStatus;
    const historyEntry = buildColdmailBounceHistoryEntry({
      classification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
    });
    const mailFields = hardBounce
      ? {
          mail: false,
          canMail: false,
          doNotMail: true,
        }
      : {};
    return {
      ...row,
      ...mailFields,
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      coldmailReplyIntent: normalizeString(classification && classification.intent),
      coldmailBounceType: normalizeString(classification && classification.bounceType) || 'unknown',
      coldmailBounceAt: date,
      coldmailBounceReason: truncateText(inboundText, 1000),
      lastColdmailReplyAt: date,
      lastColdmailReplySubject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      lastColdmailReplyPreview: truncateText(inboundText, 1000),
      lastColdmailReplyMessageKey: normalizeString(processedKey),
      activeColdmailCampaignUntil: hardBounce ? '' : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: hardBounce ? '' : row.coldmailCampaignEndsAt,
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  async function persistColdmailBounceLifecycle({
    values,
    rows,
    match,
    parsedMail,
    inboundText,
    processedKey,
    actor,
    classification,
  }) {
    if (!classification || !match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'missing_bounce_match',
      };
    }
    const nextRows = rows.slice();
    nextRows[match.index] = markRowFromColdmailBounce(
      rows[match.index],
      classification,
      parsedMail,
      inboundText,
      processedKey,
      actor
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows),
      {
        source: 'coldmail-bounce',
        actor: normalizeString(actor) || 'coldmail-bounce',
      }
    );
    return {
      persisted: true,
      rows: nextRows,
      classification,
      reason: 'updated',
    };
  }

  async function persistColdmailReplyLifecycle({
    values,
    rows,
    match,
    parsedMail,
    inboundText,
    processedKey,
    actor,
    mailboxId,
    mailboxFolder,
    mailboxAccount,
  }) {
    const classification = classifyInboundColdmailReplyLifecycle(inboundText);
    const matchedRow = match && Number.isInteger(match.index) ? rows[match.index] : null;
    const shouldPersistWebdesignReply = Boolean(matchedRow && isWebdesignOutreachRow(matchedRow));
    if (!classification.status && !shouldPersistWebdesignReply) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'unclear_intent',
      };
    }
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'missing_match',
      };
    }

    const effectiveClassification = classification.status
      ? classification
      : {
          status: 'reactie_ontvangen',
          intent: 'unclear',
          label: 'Reactie ontvangen op webdesign-mail',
          disableMail: false,
        };
    const nextRows = rows.slice();
    nextRows[match.index] = markRowFromColdmailReply(
      rows[match.index],
      effectiveClassification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
      { mailboxId, mailboxFolder, mailboxAccount }
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows),
      {
        source: 'coldmail-inbound-reply',
        actor: normalizeString(actor) || 'coldmail-auto-reply',
      }
    );
    return {
      persisted: true,
      rows: nextRows,
      classification,
      reason: 'updated',
    };
  }

  async function unsubscribeColdmailRecipient(input = {}) {
    const payload = verifyColdmailUnsubscribeToken(input.token || input.t);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      const error = new Error('Deze afmeldlink hoort niet meer bij een bekende ontvanger.');
      error.code = 'UNSUBSCRIBE_TARGET_NOT_FOUND';
      throw error;
    }

    const nextRows = rows.slice();
    const actor = normalizeString(input.actor || 'coldmail-unsubscribe-link');
    nextRows[match.index] = markRowFromColdmailUnsubscribe(rows[match.index], payload, actor);
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows),
      {
        source: 'coldmail-unsubscribe-link',
        actor,
      }
    );

    return {
      ok: true,
      unsubscribed: true,
      id: match.id,
      email: match.email,
      bedrijf: getRowCompany(nextRows[match.index]),
      status: normalizeDatabaseStatus(nextRows[match.index].databaseStatus || nextRows[match.index].status),
    };
  }

  async function getColdmailUnsubscribePreview(input = {}) {
    const payload = verifyColdmailUnsubscribeToken(input.token || input.t);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    if (!match) {
      const error = new Error('Deze link hoort niet meer bij een bekende ontvanger.');
      error.code = 'UNSUBSCRIBE_TARGET_NOT_FOUND';
      throw error;
    }
    return {
      ok: true,
      id: match.id,
      email: match.email,
      bedrijf: getRowCompany(rows[match.index]),
    };
  }

  function findWebdesignOutreachRowIndex(rows, input = {}) {
    const customerId = normalizeString(input.customerId || input.id);
    const email = normalizeEmailAddress(input.email);
    const messageKeys = [
      input.messageId,
      input.mailboxId,
      input.replyThreadId,
      input.replyMessageId,
    ].map(normalizeMailboxMessageKey).filter(Boolean);
    if (customerId) {
      const index = rows.findIndex((row, rowIndex) => getRowId(row, rowIndex) === customerId);
      if (index >= 0) return index;
    }
    if (messageKeys.length) {
      const index = rows.findIndex((row) => messageKeys.some((key) => matchesOutreachMessage(row, key)));
      if (index >= 0) return index;
    }
    if (email) {
      const index = rows.findIndex((row) => getRowEmail(row) === email && isWebdesignOutreachRow(row));
      if (index >= 0) return index;
    }
    return -1;
  }

  function buildOutreachManualHistoryEntry(status, actor) {
    const databaseStatus = mapOutreachStatusToDatabaseStatus(status);
    return {
      type: databaseStatus,
      label: getOutreachStatusLabel(status),
      date: now().toISOString(),
      actor: normalizeString(actor) || 'Mailbox',
      source: 'webdesign-outreach-action',
    };
  }

  function applyWebdesignOutreachStatus(row, status, actor) {
    const date = now().toISOString();
    const outreachStatus = normalizeOutreachStatus(status);
    const databaseStatus = mapOutreachStatusToDatabaseStatus(outreachStatus, row.databaseStatus || row.status);
    const historyEntry = buildOutreachManualHistoryEntry(outreachStatus, actor);
    const existingHistory = Array.isArray(row.hist) ? row.hist.filter(Boolean) : [];
    const noMailFields =
      outreachStatus === 'geen_interesse'
        ? {
            mail: false,
            canMail: false,
            doNotMail: true,
          }
        : {};
    return {
      ...row,
      ...noMailFields,
      status: databaseStatus,
      databaseStatus,
      outreachStatus,
      actionRequired: false,
      outreachActionRequired: false,
      statusUpdatedAt: date,
      updatedAt: date,
      activeColdmailCampaignUntil: isOutreachDefinitiveStatus(outreachStatus)
        ? ''
        : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: isOutreachDefinitiveStatus(outreachStatus)
        ? ''
        : row.coldmailCampaignEndsAt,
      hist: [historyEntry, ...existingHistory].slice(0, 50),
    };
  }

  async function updateWebdesignOutreachStatus(input = {}) {
    const status = normalizeOutreachStatus(input.status);
    if (!status || status === 'benaderd') {
      const error = new Error('Kies een geldige outreach-status.');
      error.code = 'INVALID_OUTREACH_STATUS';
      error.status = 400;
      throw error;
    }

    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const index = findWebdesignOutreachRowIndex(rows, input);
    if (index < 0 || !rows[index]) {
      const error = new Error('Webdesign-outreach lead niet gevonden.');
      error.code = 'OUTREACH_LEAD_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (!isWebdesignOutreachRow(rows[index])) {
      const error = new Error('Deze lead hoort niet bij een webdesign-outreachmail.');
      error.code = 'NOT_WEBDESIGN_OUTREACH';
      error.status = 422;
      throw error;
    }

    const nextRows = rows.slice();
    nextRows[index] = applyWebdesignOutreachStatus(
      rows[index],
      status,
      normalizeString(input.actor) || 'Webdesign outreach'
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows),
      {
        source: 'webdesign-outreach-action',
        actor: normalizeString(input.actor) || 'Webdesign outreach',
      }
    );

    return {
      ok: true,
      status,
      databaseStatus: nextRows[index].databaseStatus,
      customer: nextRows[index],
    };
  }

  async function getColdmailPreviewImage(input = {}) {
    const payload = verifyColdmailPreviewImageToken(input.token || input.t);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    if (!match || !rows[match.index]) {
      const error = new Error('Deze foto hoort niet meer bij een bekende ontvanger.');
      error.code = 'PREVIEW_IMAGE_TARGET_NOT_FOUND';
      throw error;
    }

    const photoMap = await loadCustomerPhotoMap();
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });
    const photo = preferFreshRowPhotoFields(
      rows[match.index],
      findStoredPhotoRecordForRow(rows[match.index], match.index, photos, photosByIdentity)
    );
    const source = payload.type === 'mockup'
      ? getWebdesignMockupSource(photo)
      : getWebdesignPhotoSource(photo);
    const image = await resolveImageAttachment(source);
    if (!image) {
      const error = new Error('Deze foto is niet meer beschikbaar.');
      error.code = 'PREVIEW_IMAGE_NOT_FOUND';
      throw error;
    }

    const company = getRowCompany(rows[match.index]) || 'Softora webdesign';
    const baseName = payload.type === 'mockup'
      ? normalizeString(photo && photo.websiteMockupName) || `${company} device mockup`
      : normalizeString(photo && photo.websitePhotoName) || `${company} webdesign`;
    return {
      ok: true,
      type: payload.type,
      content: image.content,
      contentType: image.contentType,
      filename: `${sanitizeFilename(baseName, payload.type === 'mockup' ? 'device-mockup' : 'webdesign')}.${getImageExtension(image.contentType)}`,
    };
  }

  async function sendColdmailCampaign(input = {}) {
    if (coldmailCampaignSendPromise) {
      const error = new Error('Er draait al een coldmailcampagne. Wacht tot die klaar is.');
      error.code = 'COLDMAIL_SEND_IN_PROGRESS';
      throw error;
    }
    const promise = sendColdmailCampaignUnlocked(input).finally(() => {
      coldmailCampaignSendPromise = null;
    });
    coldmailCampaignSendPromise = promise;
    return promise;
  }

  async function sendColdmailCampaignUnlocked(input = {}) {
    if (!isSmtpMailConfigured()) {
      const error = new Error('Mail is nog niet gekoppeld. Vul eerst de SMTP-gegevens op de server in.');
      error.code = 'SMTP_NOT_CONFIGURED';
      error.missing = getMissingSmtpMailEnv();
      throw error;
    }

    const senderEmail = assertSenderAllowed(input.senderEmail);
    const senderAccount = resolveSenderSmtpAccount(senderEmail);
    if (!isSenderSmtpAccountConfigured(senderAccount)) {
      const error = new Error(
        `Deze afzender (${senderEmail}) heeft nog geen eigen SMTP-wachtwoord op de server.`
      );
      error.code = 'SENDER_SMTP_NOT_CONFIGURED';
      error.missing = getMissingSenderSmtpEnv(senderEmail);
      throw error;
    }
    const subjectTemplate = truncateText(normalizeString(input.subject), 200);
    const bodyTemplate = normalizeString(input.body);
    if (!subjectTemplate || !bodyTemplate) {
      const error = new Error('Vul eerst een onderwerp en mailtekst in.');
      error.code = 'EMPTY_MAIL_CONTENT';
      throw error;
    }

    const resolvedRecipients = await resolveColdmailRecipients(input);
    const testMode = Boolean(resolvedRecipients.testMode);
    const count = resolvedRecipients.count;
    const values = resolvedRecipients.values;
    let rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;
    const failed = resolvedRecipients.failed;

    const shouldIncludeWebdesignPhoto = shouldUseWebdesignAssets(input, 'mail');

    if (!candidateRows.length) {
      const firstFailure = resolvedRecipients.failed[0] && resolvedRecipients.failed[0].error ? resolvedRecipients.failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geschikte e-mailadressen gevonden in de database.');
      error.code = shouldIncludeWebdesignPhoto && firstFailure ? 'NO_WEBDESIGN_PHOTOS' : 'NO_RECIPIENTS';
      error.failedItems = resolvedRecipients.failed;
      throw error;
    }

    let selectedRows = resolvedRecipients.selectedRows;
    const quota = await getColdmailSendQuota(senderEmail);
    if (!testMode && quota.safetyPause) {
      const error = new Error(buildColdmailSafetyPauseMessage(quota.safetyPause));
      error.code = 'COLDMAIL_SAFETY_PAUSED';
      error.quota = quota;
      throw error;
    }
    const quotaRemaining = testMode ? selectedRows.length : Math.min(quota.senderRemaining, quota.packageRemaining);
    if (!testMode && quotaRemaining <= 0) {
      const error = new Error(
        'Daglimiet bereikt: om je STRATO-mailbox en domeinreputatie te beschermen worden vandaag geen extra coldmails verzonden.'
      );
      error.code = 'COLDMAIL_DAILY_LIMIT_REACHED';
      error.quota = quota;
      throw error;
    }
    if (!testMode && selectedRows.length > quotaRemaining) {
      selectedRows.slice(quotaRemaining).forEach((item) => {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          error: `Daglimiet beschermt deze ontvanger: nog ${quotaRemaining} verzending(en) beschikbaar vandaag.`,
        });
      });
      selectedRows = selectedRows.slice(0, quotaRemaining);
    }
    if (!testMode) {
      let selectedPersonalMailboxCount = 0;
      selectedRows = selectedRows.filter((item) => {
        const email = getRowEmail(item.row);
        if (!isPersonalMailboxDomain(email)) return true;
        selectedPersonalMailboxCount += 1;
        if (selectedPersonalMailboxCount <= quota.personalMailboxRemaining) return true;
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `Persoonlijke mailbox-daglimiet beschermt deze ontvanger: nog ${quota.personalMailboxRemaining} Gmail/Outlook/Hotmail verzending(en) beschikbaar vandaag.`,
        });
        return false;
      });
    }
    const customerPhotoMap = shouldIncludeWebdesignPhoto
      ? (resolvedRecipients.customerPhotoMap || await loadCustomerPhotoMap(candidateRows))
      : {};

    if (!selectedRows.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geldige e-maildomeinen gevonden in de database.');
      error.code = 'NO_VALID_RECIPIENT_DOMAINS';
      error.failedItems = failed;
      throw error;
    }

    const delivery = getSenderSmtpTransport(senderEmail);
    const transporter = delivery && delivery.transporter;
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd voor deze afzender.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const smtpAccount = delivery.account;
    const sent = [];
    const auditBcc = getColdmailAuditBccAddress(senderEmail);
    const persistedSentRowIds = new Set();
    let safetyPause = null;
    const actor = normalizeString(input.actor || 'Coldmailing');

    for (const [index, item] of selectedRows.entries()) {
      const row = item.row;
      const to = getRowEmail(row);
      if (!testMode && index > 0) {
        const delayMs = isPersonalMailboxDomain(to)
          ? Math.max(getColdmailSendDelayMs(), getColdmailPersonalMailboxSendDelayMs())
          : getColdmailSendDelayMs();
        if (delayMs > 0) await sleep(delayMs);
      }
      if (!testMode) {
        const liveQuota = await getColdmailSendQuota(senderEmail);
        if (liveQuota.safetyPause) {
          safetyPause = {
            until: liveQuota.safetyPause.until,
            reason: liveQuota.safetyPause.reason,
          };
          failed.push({
            id: 'coldmail-safety-pause',
            bedrijf: 'Softora',
            email: senderEmail,
            error: buildColdmailSafetyPauseMessage(safetyPause),
          });
          break;
        }
      }
      const reference = buildColdmailReference(row, item.id);
      const trackingId = createColdmailTrackingId();
      const trackingUrl = buildColdmailOpenTrackingUrl(row, item.id, reference, trackingId, input);
      const baseText = buildMailText(bodyTemplate, row);
      const shouldAppendOptOut = shouldAppendColdmailOptOutText(baseText);
      const unsubscribeUrl = shouldAppendOptOut
        ? buildColdmailUnsubscribeUrl(row, item.id, reference, input)
        : '';
      const text = shouldAppendOptOut ? appendColdmailOptOutText(baseText, unsubscribeUrl) : baseText;
      const subject = personalizeTemplate(subjectTemplate, row);
      const webdesignPhoto = shouldIncludeWebdesignPhoto ? await resolveRowWebdesignPhoto(row, customerPhotoMap) : null;
      if (shouldIncludeWebdesignPhoto && !webdesignPhoto) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: `Geen webdesign-foto gevonden voor ${getRowCompany(row) || to}.`,
        });
        continue;
      }
      if (shouldIncludeWebdesignPhoto && !webdesignPhoto.mockup) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: `Geen device-mockup gevonden voor ${getRowCompany(row) || to}.`,
        });
        continue;
      }
      const htmlBase = appendHiddenColdmailReferenceHtml(toHtml(baseText, { senderEmail }), reference);
      const htmlWithContent = webdesignPhoto
        ? appendWebdesignImageHtml(htmlBase, webdesignPhoto, {
            optOutText: shouldAppendOptOut ? COLDMAIL_OPT_OUT_LABEL : '',
            optOutUrl: unsubscribeUrl,
          })
        : appendColdmailOptOutHtml(htmlBase, unsubscribeUrl);
      const html = appendColdmailOpenTrackingPixelHtml(htmlWithContent, trackingUrl);
      const attachments = webdesignPhoto
        ? [
            {
              filename: webdesignPhoto.filename,
              content: webdesignPhoto.content,
              contentType: webdesignPhoto.contentType,
              cid: webdesignPhoto.cid,
              contentDisposition: 'inline',
            },
            ...(webdesignPhoto.mockup
              ? [{
                  filename: webdesignPhoto.mockup.filename,
                  content: webdesignPhoto.mockup.content,
                  contentType: webdesignPhoto.mockup.contentType,
                  cid: webdesignPhoto.mockup.cid,
                  contentDisposition: 'inline',
                }]
              : []),
          ]
        : undefined;
      try {
        const mail = {
          from: formatMailFromHeader(senderEmail, smtpAccount),
          to,
          replyTo: getColdmailReplyToAddress(senderEmail),
          subject,
          text,
          html,
          attachments,
        };
        const listUnsubscribe = getColdmailListUnsubscribeHeader(senderEmail, row, item.id, reference, input);
        if (listUnsubscribe) {
          mail.headers = {
            'List-Unsubscribe': listUnsubscribe,
          };
          const listUnsubscribePost = getColdmailListUnsubscribePostHeader(row, item.id, reference, input);
          if (listUnsubscribePost) mail.headers['List-Unsubscribe-Post'] = listUnsubscribePost;
        }
        if (auditBcc && auditBcc !== normalizeEmailAddress(to)) {
          mail.bcc = auditBcc;
        }
        const info = await transporter.sendMail(mail);
        const accepted = Array.isArray(info && info.accepted)
          ? info.accepted.map(normalizeEmailAddress).filter(Boolean)
          : [];
        const rejected = Array.isArray(info && info.rejected)
          ? info.rejected.map(normalizeEmailAddress).filter(Boolean)
          : [];
        if (rejected.includes(normalizeEmailAddress(to)) || (Array.isArray(info && info.accepted) && !accepted.length)) {
          throw new Error('SMTP accepteerde de ontvanger niet.');
        }
        const sentCopyMail = trackingUrl
          ? {
              ...mail,
              html: htmlWithContent,
            }
          : mail;
        const sentCopySaved = await saveSentCopy(senderEmail, sentCopyMail, info, smtpAccount);
        const sentItem = {
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          trackingId: trackingUrl ? trackingId : '',
          response: truncateText(normalizeString(info && info.response), 500),
          accepted,
          rejected,
          sentCopySaved,
        };
        sent.push(sentItem);
        if (!isTestRecipientRow(row, to)) {
          await recordColdmailSendGuardEntry({
            senderEmail,
            count: 1,
            personalCount: isPersonalMailboxDomain(to) ? 1 : 0,
            actor,
          });
          const updatedRows = rows.map((currentRow, rowIndex) => {
            const rowId = getRowId(currentRow, rowIndex);
            if (rowId !== item.id) return currentRow;
            return markRowAsMailed(currentRow, actor, input.durationDays, {
              senderEmail,
              specialAction: input.specialAction,
              messageId: sentItem.messageId,
              trackingId: sentItem.trackingId,
            });
          });
          await setUiStateValues(
            customerDbScope,
            buildCustomerRowsStateValues(values, updatedRows),
            {
              source: 'coldmail-campaign',
              actor,
            }
          );
          rows = updatedRows;
          persistedSentRowIds.add(item.id);
        }
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: truncateText(normalizeString(error && error.message), 500),
        });
        const safetyReason = getSmtpSafetyStopReason(error);
        if (safetyReason) {
          safetyPause = await recordColdmailSafetyPause({
            senderEmail,
            reason: safetyReason,
            error,
            actor,
          });
          failed.push({
            id: 'coldmail-safety-pause',
            bedrijf: 'Softora',
            email: senderEmail,
            error: buildColdmailSafetyPauseMessage(safetyPause),
          });
          break;
        }
      }
    }

    if (!sent.length && failed.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const webdesignAssetFailure = shouldIncludeWebdesignPhoto && failed.every((item) =>
        /^Geen (?:webdesign-foto|device-mockup) gevonden voor /i.test(normalizeString(item && item.error))
      );
      const error = new Error(firstFailure ? `Geen mails verzonden: ${firstFailure}` : 'Geen mails verzonden.');
      error.code = safetyPause
        ? 'COLDMAIL_SAFETY_PAUSED'
        : webdesignAssetFailure
          ? 'NO_WEBDESIGN_PHOTOS'
          : 'SMTP_SEND_FAILED';
      error.failedItems = failed;
      if (safetyPause) error.quota = { ...(quota || {}), safetyPause };
      throw error;
    }

    return {
      ok: true,
      requested: count,
      selected: selectedRows.length,
      sent: sent.length,
      failed: failed.length,
      persisted: persistedSentRowIds.size,
      safetyLimits: getColdmailSafetyLimits(),
      dailyQuota: {
        senderSentBefore: quota.senderSent,
        packageSentBefore: quota.packageSent,
        personalMailboxSentBefore: quota.personalMailboxSent,
        senderRemainingBefore: quota.senderRemaining,
        packageRemainingBefore: quota.packageRemaining,
        personalMailboxRemainingBefore: quota.personalMailboxRemaining,
        safetyPausedUntil: safetyPause ? safetyPause.until : undefined,
      },
      safetyPaused: Boolean(safetyPause),
      senderEmail,
      testMode,
      testRecipientEmail: testMode ? COLDMAIL_TEST_RECIPIENT_EMAIL : undefined,
      specialAction: normalizeString(input.specialAction || ''),
      sentItems: sent,
      failedItems: failed,
    };
  }

  async function syncInboundColdmailRepliesFromImap(options = {}) {
    const force = Boolean(options.force);
    const maxMessages = Math.max(5, Math.min(100, Number(options.maxMessages || 30) || 30));
    const bounceProcessingEnabled = coldmailBounceProcessingEnabled !== false;
    if (!coldmailAutoReplyEnabled && !bounceProcessingEnabled) {
      return {
        ok: true,
        skipped: true,
        reason: 'coldmail_reply_sync_disabled',
      };
    }
    if (!isImapMailConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: 'imap_not_configured',
        missingEnv: getMissingImapMailEnv(),
      };
    }
    if (coldmailAutoReplyEnabled && !isSmtpMailConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: 'smtp_not_configured',
        missingEnv: getMissingSmtpMailEnv(),
      };
    }
    if (!force && syncInboundColdmailRepliesFromImap.notBeforeMs && Date.now() < syncInboundColdmailRepliesFromImap.notBeforeMs) {
      return syncInboundColdmailRepliesFromImap.lastResult || { ok: true, skipped: true, reason: 'cooldown' };
    }
    if (syncInboundColdmailRepliesFromImap.promise) return syncInboundColdmailRepliesFromImap.promise;

    syncInboundColdmailRepliesFromImap.promise = (async () => {
      const stats = {
        ok: true,
        startedAt: now().toISOString(),
        model: normalizeString(coldmailAutoReplyModel) || 'gpt-5.5-pro',
        mailboxes: getImapMailboxesForSync(),
        scanned: 0,
        matched: 0,
        replied: 0,
        skippedProcessed: 0,
        ignored: 0,
        markedSeen: 0,
        lifecycleUpdated: 0,
        lifecycleSkipped: 0,
        hardBounced: 0,
        softBounced: 0,
        bounceUpdated: 0,
        bounceSkipped: 0,
        providerWarnings: 0,
        errors: [],
      };
      const dbState = await getUiStateValues(customerDbScope);
      const values = dbState && typeof dbState.values === 'object' ? dbState.values : {};
      let rows = parseDatabaseRows(values);
      const replyState = await loadColdmailReplyState();
      const client = createImapClient({
        host: imapHost,
        port: Number(imapPort),
        secure: Boolean(imapSecure),
        auth: {
          user: imapUser,
          pass: imapPass,
        },
        logger: false,
      });

      try {
        await client.connect();
        for (const mailboxName of getImapMailboxesForSync()) {
          let lock = null;
          try {
            lock = await client.getMailboxLock(mailboxName);
            const unseenUids = await client.search(['UNSEEN']);
            const allUids = await client.search(['ALL']);
            const selectedUidSet = new Set();
            if (Array.isArray(allUids)) allUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            if (Array.isArray(unseenUids)) unseenUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            const selectedUids = Array.from(selectedUidSet).sort((a, b) => a - b);
            const uidsToMarkSeen = [];
            if (!selectedUids.length) continue;

            for await (const message of client.fetch(
              selectedUids,
              {
                uid: true,
                source: true,
                flags: true,
              },
              { uid: true }
            )) {
              stats.scanned += 1;
              let parsedMail = null;
              try {
                parsedMail = await parseMailSource(message.source);
              } catch (error) {
                stats.errors.push(`Parse error ${mailboxName}/${message.uid}: ${truncateText(error && error.message, 140)}`);
                continue;
              }

              const processedKey = getInboundMessageProcessedKey(parsedMail, message);
              if (replyState.processed[processedKey]) {
                stats.skippedProcessed += 1;
                continue;
              }

              const inboundText = getInboundReplyText(parsedMail);
              const deliveryFailure = classifyColdmailDeliveryFailure(parsedMail, inboundText);
              const providerWarningSafetyReason = getColdmailProviderWarningSafetyReason(parsedMail, inboundText);
              let providerWarningPause = null;
              const from = getParsedMailFromEmail(parsedMail);
              if (providerWarningSafetyReason) {
                providerWarningPause = await recordColdmailSafetyPause({
                  senderEmail: resolveInboundMailboxAccount(parsedMail),
                  reason: providerWarningSafetyReason,
                  error: providerWarningSafetyReason,
                  actor: 'coldmail-provider-warning',
                });
                stats.providerWarnings += 1;
                stats.safetyPausedUntil = providerWarningPause.until;
                replyState.processed[processedKey] = {
                  at: now().toISOString(),
                  from: from.address,
                  subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                  lifecycleIntent: 'provider_warning',
                  safetyPauseUntil: providerWarningPause.until,
                  safetyPauseReason: providerWarningPause.reason,
                };
                await saveColdmailReplyState(replyState, 'coldmail-provider-warning');
              }
              const match = deliveryFailure
                ? findColdmailRowForDeliveryFailure(parsedMail, inboundText, rows)
                : findColdmailRowForInboundReply(parsedMail, rows);
              if (!match || (!inboundText && !deliveryFailure)) {
                if (providerWarningPause) {
                  const flagsSet =
                    message.flags instanceof Set
                      ? message.flags
                      : new Set(Array.isArray(message.flags) ? message.flags : []);
                  if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
                  continue;
                }
                stats.ignored += 1;
                continue;
              }
              if (deliveryFailure && !bounceProcessingEnabled) {
                stats.ignored += 1;
                continue;
              }

              stats.matched += 1;
              try {
                if (deliveryFailure && bounceProcessingEnabled) {
                  try {
                    const lifecycle = await persistColdmailBounceLifecycle({
                      values,
                      rows,
                      match,
                      parsedMail,
                      inboundText: inboundText || truncateText(normalizeString(parsedMail && parsedMail.subject), 500),
                      processedKey,
                      actor: 'Coldmailing',
                      classification: deliveryFailure,
                    });
                    rows = lifecycle.rows;
                    if (lifecycle.persisted) {
                      stats.bounceUpdated += 1;
                      if (deliveryFailure.bounceType === 'hard') stats.hardBounced += 1;
                      else if (deliveryFailure.bounceType === 'soft') stats.softBounced += 1;
                    } else {
                      stats.bounceSkipped += 1;
                    }
                    replyState.processed[processedKey] = {
                      at: now().toISOString(),
                      from: from.address,
                      company: getRowCompany(match.row),
                      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                      lifecycleStatus: normalizeString(deliveryFailure.status),
                      lifecycleIntent: normalizeString(deliveryFailure.intent),
                      bounceType: normalizeString(deliveryFailure.bounceType),
                    };
                    await saveColdmailReplyState(replyState, 'coldmail-bounce');
                    const flagsSet =
                      message.flags instanceof Set
                        ? message.flags
                        : new Set(Array.isArray(message.flags) ? message.flags : []);
                    if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
                    continue;
                  } catch (error) {
                    stats.errors.push(
                      `${from.address || 'mailserver'} bounce: ${truncateText(
                        error && error.message ? error.message : String(error),
                        220
                      )}`
                    );
                  }
                }

                if (!coldmailAutoReplyEnabled) {
                  stats.lifecycleSkipped += 1;
                  continue;
                }

                try {
                  const lifecycle = await persistColdmailReplyLifecycle({
                    values,
                    rows,
                    match,
                    parsedMail,
                    inboundText,
                    processedKey,
                    actor: 'Coldmailing',
                    mailboxId: buildMailboxMessageId(mailboxName, message.uid),
                    mailboxFolder: mailboxName,
                    mailboxAccount: resolveInboundMailboxAccount(parsedMail),
                  });
                  rows = lifecycle.rows;
                  if (lifecycle.persisted) {
                    stats.lifecycleUpdated += 1;
                  } else {
                    stats.lifecycleSkipped += 1;
                  }
                } catch (error) {
                  stats.errors.push(
                    `${from.address || 'onbekende afzender'} lifecycle: ${truncateText(
                      error && error.message ? error.message : String(error),
                      220
                    )}`
                  );
                }

                const senderEmail = resolveInboundSenderEmail(parsedMail);
                const aiReply = await generateColdmailAutoReplyWithOpenAi({
                  row: match.row,
                  inboundText,
                  inboundSubject: normalizeString(parsedMail && parsedMail.subject),
                  fromName: from.name,
                  senderEmail,
                });
                const info = await sendColdmailAutoReply({
                  parsedMail,
                  row: match.row,
                  senderEmail,
                  replyText: aiReply.text,
                });
                replyState.processed[processedKey] = {
                  at: now().toISOString(),
                  from: from.address,
                  company: getRowCompany(match.row),
                  subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                  model: aiReply.model,
                  messageId: normalizeString(info && info.messageId),
                  lifecycleStatus: normalizeString(
                    classifyInboundColdmailReplyLifecycle(inboundText).status
                  ),
                  lifecycleIntent: normalizeString(
                    classifyInboundColdmailReplyLifecycle(inboundText).intent
                  ),
                };
                await saveColdmailReplyState(replyState, 'coldmail-auto-reply');
                stats.replied += 1;

                const flagsSet =
                  message.flags instanceof Set
                    ? message.flags
                    : new Set(Array.isArray(message.flags) ? message.flags : []);
                if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
              } catch (error) {
                stats.errors.push(
                  `${from.address || 'onbekende afzender'}: ${truncateText(error && error.message ? error.message : String(error), 220)}`
                );
              }
            }

            if (uidsToMarkSeen.length) {
              await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], { uid: true });
              stats.markedSeen += uidsToMarkSeen.length;
            }
          } catch (error) {
            stats.errors.push(`Mailbox ${mailboxName}: ${truncateText(error && error.message ? error.message : String(error), 180)}`);
          } finally {
            try {
              if (lock) lock.release();
            } catch (_) {}
          }
        }
      } catch (error) {
        stats.ok = false;
        stats.error = truncateText(error && error.message ? error.message : String(error), 500);
      } finally {
        try {
          if (client.usable) await client.logout();
        } catch (_) {}
        stats.finishedAt = now().toISOString();
        syncInboundColdmailRepliesFromImap.notBeforeMs = Date.now() + Number(imapPollCooldownMs || 20_000);
        syncInboundColdmailRepliesFromImap.lastResult = stats;
        syncInboundColdmailRepliesFromImap.promise = null;
      }

      return stats;
    })();

    return syncInboundColdmailRepliesFromImap.promise;
  }

  return {
    getAllowedSenderEmails,
    getConfiguredSenderEmails,
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    getColdmailSafetyLimits,
    isImapMailConfigured,
    isSmtpMailConfigured,
    isLikelyValidEmail,
    getColdmailCampaignRecipients,
    getColdmailPreviewImage,
    getColdmailAutopilotStatus,
    getColdmailUnsubscribePreview,
    listColdmailReplyFollowUps,
    recordColdmailOpen,
    runColdmailAutopilot,
    sendColdmailCampaign,
    syncInboundColdmailRepliesFromImap,
    unsubscribeColdmailRecipient,
    updateColdmailAutopilotSettings,
    updateWebdesignOutreachStatus,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
