const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');
const { appendSentMessage } = require('./mailbox-sent-copy');
const {
  normalizeMailboxAccountEmail,
  replaceLegacyMailboxEmail,
} = require('../config/mail-identity');

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
const DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT = 30;
const DEFAULT_COLDMAIL_DAILY_SEND_LIMIT = 50;
const DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT = 100;
const DEFAULT_COLDMAIL_SEND_DELAY_MS = 90_000;
const DEFAULT_COLDMAIL_SAFETY_PAUSE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT = 10;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS = 180_000;
const COLDMAIL_SEND_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLDMAIL_SMTP_SAFETY_STOP_PATTERN =
  /\b(transmit rate limit|rate limited|b-trial|too many recipients|too many concurrent|no spam please|b-url|b-text|b-score|b-ex|suspected phishing|mailbox is blocked|mailbox is disabled|not allowed to send|sender not authorized|no authorization to send|dmarc|spf failed|insufficient privacy|tls required)\b/i;
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
const COLDMAIL_OPT_OUT_TEXT =
  'Geen interesse? Reageer met "stop" of "afmelden", dan mailen we u niet meer.';
const TEST_RECIPIENT_EMAILS = new Set(['servec321@gmail.com']);
const TEST_RECIPIENT_COMPANIES = new Set(['mcv e-commerce']);
const SENDER_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
  'ruben@softora.nl': 'Ruben',
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

async function resolveEmailDomainWithDns(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!value) return false;
  try {
    const mxRecords = await dns.resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) return true;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
  }
  try {
    const addresses = await dns.resolve4(value);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
  }
  try {
    const addresses = await dns.resolve6(value);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
    return false;
  }
}

function createColdmailCampaignService(deps = {}) {
  const {
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
    smtpUser: rawSmtpUser = '',
    smtpPass = '',
    mailFromAddress: rawMailFromAddress = '',
    mailFromName = 'Softora',
    mailReplyTo: rawMailReplyTo = '',
    publicBaseUrl = '',
    coldmailUnsubscribeSecret = '',
    coldmailAuditBcc: rawColdmailAuditBcc = '',
    coldmailReplySyncEmail: rawColdmailReplySyncEmail = '',
    coldmailReplyForwardEnabled = false,
    coldmailReplyForwardFrom: rawColdmailReplyForwardFrom = '',
    coldmailReplyForwardTo: rawColdmailReplyForwardTo = '',
    imapHost = '',
    imapPort = 993,
    imapSecure = false,
    imapUser: rawImapUser = '',
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
    coldmailBlockPersonalMailboxDomains = true,
  } = mailConfig;
  const smtpUser = replaceLegacyMailboxEmail(rawSmtpUser);
  const mailFromAddress = replaceLegacyMailboxEmail(rawMailFromAddress);
  const mailReplyTo = replaceLegacyMailboxEmail(rawMailReplyTo);
  const coldmailAuditBcc = replaceLegacyMailboxEmail(rawColdmailAuditBcc);
  const coldmailReplySyncEmail = replaceLegacyMailboxEmail(rawColdmailReplySyncEmail);
  const coldmailReplyForwardFrom = replaceLegacyMailboxEmail(rawColdmailReplyForwardFrom);
  const coldmailReplyForwardTo = replaceLegacyMailboxEmail(rawColdmailReplyForwardTo);
  const imapUser = replaceLegacyMailboxEmail(rawImapUser);

  const smtpTransportersByAccount = new Map();
  let coldmailCampaignSendPromise = null;

  function normalizeEmailAddress(value) {
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

  function normalizePublicHttpUrl(value) {
    const raw = normalizeString(value).replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(raw)) return '';
    return raw;
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
    const key = envKeyForEmail(email);
    const fullKey = envKeyForMailboxEmail(email);
    return [
      `MAILBOX_${fullKey || key}_PASS`,
      `MAILBOX_${key}_PASS`,
      'MAIL_SMTP_PASS',
    ].filter(Boolean);
  }

  function isSmtpMailConfigured() {
    if (resolveMailboxSmtpAccount(mailFromAddress || smtpUser).smtpConfigured) return true;
    return getAllowedSenderEmails().some((email) => resolveMailboxSmtpAccount(email).smtpConfigured);
  }

  function getMissingImapMailEnv() {
    const account = resolveColdmailReplySyncAccount();
    return [
      !account.imapHost ? 'MAIL_IMAP_HOST' : null,
      !account.imapUser ? 'MAIL_IMAP_USER' : null,
      !account.imapPass ? 'MAIL_IMAP_PASS' : null,
    ].filter(Boolean);
  }

  function isImapMailConfigured() {
    const account = resolveColdmailReplySyncAccount();
    return Boolean(account.imapConfigured);
  }

  function getSmtpTransporter(senderEmail) {
    const account = resolveMailboxSmtpAccount(senderEmail || mailFromAddress || smtpUser);
    if (!account.smtpConfigured) return null;
    const cacheKey = [
      account.smtpHost,
      account.smtpPort,
      account.smtpSecure ? 'secure' : 'plain',
      account.smtpUser,
    ].join('|');
    if (smtpTransportersByAccount.has(cacheKey)) return smtpTransportersByAccount.get(cacheKey);
    const transporter = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: account.smtpUser,
        pass: account.smtpPass,
      },
    });
    smtpTransportersByAccount.set(cacheKey, transporter);
    return transporter;
  }

  function normalizeDatabaseStatus(value, row = {}) {
    return normalizeContactStatus(value, row) || 'prospect';
  }

  function parseDatabaseRows(values = {}) {
    const raw = normalizeString(values && values[customerDbKey]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function parseLeadDatabaseRows(values = {}) {
    const raw = normalizeString(values && values[leadDbKey]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((row) => row && typeof row === 'object')
        .map((row, index) => ({
          id: normalizeString(row.id || row.leadId || '') || `lead-${index}`,
          bedrijf: normalizeString(row.company || row.name || row.bedrijf || row.naam || '') || `Lead ${index + 1}`,
          naam: normalizeString(row.contactPerson || row.contact || row.naam || ''),
          phone: normalizeString(row.phone || row.phoneE164 || row.tel || row.telefoon || ''),
          branche: normalizeString(row.branche || row.branch || ''),
          region: normalizeString(row.region || row.regio || row.province || ''),
          address: normalizeString(row.address || row.adres || ''),
          website: normalizeString(row.website || ''),
          call: row.call,
          canCall: row.canCall,
          doNotCall: row.doNotCall,
          status: normalizeString(row.status || row.databaseStatus || ''),
        }));
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

  function getRowCompany(row) {
    return normalizeString(row.bedrijf || row.company || row.companyName || row.naam || row.name);
  }

  function getRowContact(row) {
    return normalizeString(row.naam || row.contact || row.contactName || row.clientName) || getRowCompany(row);
  }

  function cleanPlaceLabel(value) {
    return normalizeString(value)
      .replace(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g, '')
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
      .map(cleanPlaceLabel)
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

  function getRowDomain(row) {
    return normalizeString(row.dom || row.domain || row.website || '');
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

  function isLikelyCallablePhone(value) {
    const phone = getRowPhone({ phone: value });
    return phone.replace(/\D/g, '').length >= 8;
  }

  function buildRowIdentityKey(row) {
    return [getRowCompany(row), getRowContact(row), getRowPhone(row)]
      .map((value) => normalizeString(value).toLowerCase())
      .join('|');
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

  function envKeyForMailboxEmail(email) {
    return normalizeEmailAddress(email)
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
    if (!key) return {};
    const env = process.env || {};
    const sharedUser = replaceLegacyMailboxEmail(
      normalizeString(env[`MAILBOX_${key}_USER`] || '')
    );
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      smtpHost: normalizeString(env[`MAILBOX_${key}_SMTP_HOST`] || ''),
      smtpPort: readPortEnv(env[`MAILBOX_${key}_SMTP_PORT`]),
      smtpSecure: readBooleanEnv(env[`MAILBOX_${key}_SMTP_SECURE`]),
      smtpUser: replaceLegacyMailboxEmail(
        normalizeString(env[`MAILBOX_${key}_SMTP_USER`] || sharedUser)
      ),
      smtpPass: normalizeString(env[`MAILBOX_${key}_SMTP_PASS`] || sharedPass),
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: replaceLegacyMailboxEmail(
        normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser)
      ),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function resolveMailboxSmtpAccount(emailInput) {
    const email = normalizeEmailAddress(emailInput || mailFromAddress || smtpUser);
    const envAccount = readMailboxEnvForKey(envKeyForEmail(email));
    const envAddress = readMailboxEnvForKey(envKeyForMailboxEmail(email));
    const envDomain = readMailboxEnvForKey(envKeyForDomain(email));
    const useBaseCredentials =
      email === normalizeEmailAddress(mailFromAddress) ||
      email === normalizeEmailAddress(smtpUser) ||
      envAccount.useBaseCredentials ||
      envAddress.useBaseCredentials ||
      envDomain.useBaseCredentials;
    const port = Number(envAddress.smtpPort || envAccount.smtpPort || envDomain.smtpPort || smtpPort || 587) || 587;
    const secure =
      typeof envAddress.smtpSecure === 'boolean'
        ? envAddress.smtpSecure
        : typeof envAccount.smtpSecure === 'boolean'
          ? envAccount.smtpSecure
          : typeof envDomain.smtpSecure === 'boolean'
            ? envDomain.smtpSecure
            : Boolean(smtpSecure || port === 465);
    const account = {
      email,
      smtpHost: normalizeString(envAddress.smtpHost || envAccount.smtpHost || envDomain.smtpHost || smtpHost),
      smtpPort: port,
      smtpSecure: secure,
      smtpUser: replaceLegacyMailboxEmail(
        normalizeString(
          envAddress.smtpUser ||
            envAccount.smtpUser ||
            envDomain.smtpUser ||
            (useBaseCredentials ? smtpUser : '') ||
            email
        )
      ),
      smtpPass: normalizeString(
        envAddress.smtpPass ||
          envAccount.smtpPass ||
          envDomain.smtpPass ||
          (useBaseCredentials ? smtpPass : '')
      ),
    };
    account.smtpConfigured = Boolean(account.smtpHost && account.smtpUser && account.smtpPass);
    return account;
  }

  function resolveMailboxImapAccount(emailInput) {
    const email = normalizeEmailAddress(emailInput || mailFromAddress || smtpUser || imapUser);
    const envAccount = readMailboxEnvForKey(envKeyForEmail(email));
    const envAddress = readMailboxEnvForKey(envKeyForMailboxEmail(email));
    const envDomain = readMailboxEnvForKey(envKeyForDomain(email));
    const useBaseCredentials =
      email === normalizeEmailAddress(mailFromAddress) ||
      email === normalizeEmailAddress(smtpUser) ||
      email === normalizeEmailAddress(imapUser) ||
      envAccount.useBaseCredentials ||
      envAddress.useBaseCredentials ||
      envDomain.useBaseCredentials;
    const port = Number(envAddress.imapPort || envAccount.imapPort || envDomain.imapPort || imapPort || 993) || 993;
    const secure =
      typeof envAddress.imapSecure === 'boolean'
        ? envAddress.imapSecure
        : typeof envAccount.imapSecure === 'boolean'
        ? envAccount.imapSecure
        : typeof envDomain.imapSecure === 'boolean'
          ? envDomain.imapSecure
          : Boolean(imapSecure || port === 993);
    const account = {
      email,
      imapHost: normalizeString(envAddress.imapHost || envAccount.imapHost || envDomain.imapHost || imapHost),
      imapPort: port,
      imapSecure: secure,
      imapUser: normalizeString(
        envAddress.imapUser ||
          envAccount.imapUser ||
          envDomain.imapUser ||
          (useBaseCredentials ? imapUser : '') ||
          email
      ),
      imapPass: normalizeString(
        envAddress.imapPass ||
          envAccount.imapPass ||
          envDomain.imapPass ||
          (useBaseCredentials ? imapPass : '')
      ),
    };
    account.imapConfigured = Boolean(account.imapHost && account.imapUser && account.imapPass);
    return account;
  }

  function resolveSentCopyAccount(senderEmail) {
    return resolveMailboxImapAccount(senderEmail || mailFromAddress || smtpUser || imapUser);
  }

  function resolveColdmailReplySyncAccount() {
    return resolveMailboxImapAccount(
      coldmailReplySyncEmail || coldmailReplyForwardFrom || imapUser || mailFromAddress || smtpUser
    );
  }

  async function saveSentCopy(senderEmail, mail, info) {
    return appendSentMessage({
      account: resolveSentCopyAccount(senderEmail),
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
      from.address,
      from.name,
      parsedMail && parsedMail.subject,
      inboundText,
      parsedMail && parsedMail.textAsHtml,
    ]
      .map(normalizeString)
      .filter(Boolean)
      .join('\n');
  }

  function isColdmailDeliveryFailureMessage(parsedMail, inboundText) {
    const from = getParsedMailFromEmail(parsedMail);
    const fromText = normalizeString(`${from.address} ${from.name}`).toLowerCase();
    const subject = normalizeString(parsedMail && parsedMail.subject);
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    return Boolean(
      /(^|[\s<])(mailer-daemon|postmaster)(@|[\s>]|$)/i.test(fromText) ||
        /mail delivery|delivery subsystem|automatisch antwoord/i.test(fromText) ||
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
      intent: 'delivery_failure',
      label: 'Mailservermelding ontvangen',
      bounceType: 'unknown',
      disableMail: false,
    };
  }

  function extractEmailAddressesFromText(value) {
    const matches = normalizeString(value).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi);
    if (!matches) return [];
    return Array.from(new Set(matches.map(normalizeEmailAddress).filter(isLikelyValidEmail)));
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
    return getAllowedSenderEmails().filter((email) => resolveMailboxSmtpAccount(email).smtpConfigured);
  }

  function markColdmailReplyLifecycleProcessed(replyState, processedKey, context = {}) {
    if (!replyState || !processedKey) return;
    const existing = replyState.processed[processedKey] || {};
    const from = context.from || {};
    const match = context.match || {};
    const parsedMail = context.parsedMail || {};
    const classification = context.classification || {};
    replyState.processed[processedKey] = {
      ...existing,
      at: existing.at || now().toISOString(),
      from: existing.from || from.address,
      company: existing.company || getRowCompany(match.row),
      subject:
        existing.subject ||
        truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      lifecycleStatus: normalizeString(existing.lifecycleStatus || classification.status),
      lifecycleIntent: normalizeString(existing.lifecycleIntent || classification.intent),
    };
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

  function formatMailFromHeader(senderEmail) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const name = getSenderDisplayName(address);
    return name ? `${name} <${address}>` : address;
  }

  function getSenderDisplayName(senderEmail) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    return normalizeString(SENDER_DISPLAY_NAMES[address] || mailFromName || 'Softora');
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

  function getColdmailUnsubscribeSecret() {
    return normalizeString(coldmailUnsubscribeSecret);
  }

  function signColdmailUnsubscribeEmail(email) {
    const address = normalizeEmailAddress(email);
    const secret = getColdmailUnsubscribeSecret();
    if (!address || !secret) return '';
    return crypto.createHmac('sha256', secret).update(address).digest('base64url');
  }

  function verifyColdmailUnsubscribeToken(email, token) {
    const expected = signColdmailUnsubscribeEmail(email);
    const received = normalizeString(token);
    if (!expected || !received) return false;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  function getColdmailUnsubscribeUrl(recipientEmail) {
    const baseUrl = normalizePublicHttpUrl(publicBaseUrl);
    const email = normalizeEmailAddress(recipientEmail);
    const token = signColdmailUnsubscribeEmail(email);
    if (!baseUrl || !email || !token) return '';
    const params = new URLSearchParams({ email, token });
    return `${baseUrl}/api/coldmailing/unsubscribe?${params.toString()}`;
  }

  function isColdmailOneClickUnsubscribeConfigured() {
    return Boolean(getColdmailUnsubscribeUrl('test@example.com'));
  }

  function getColdmailListUnsubscribeHeader(senderEmail, recipientEmail) {
    const unsubscribeAddress = normalizeEmailAddress(getColdmailReplyToAddress(senderEmail));
    const parts = [];
    if (isLikelyValidEmail(unsubscribeAddress)) {
      parts.push(`<mailto:${unsubscribeAddress}?subject=${encodeURIComponent('Afmelden')}>`);
    }
    const oneClickUrl = getColdmailUnsubscribeUrl(recipientEmail);
    if (oneClickUrl) parts.push(`<${oneClickUrl}>`);
    return parts.join(', ');
  }

  function getColdmailListUnsubscribePostHeader(recipientEmail) {
    return getColdmailUnsubscribeUrl(recipientEmail) ? 'List-Unsubscribe=One-Click' : '';
  }

  function getColdmailAuditBccAddress(senderEmail) {
    if (isColdmailPrivateCopyBlockedSender(senderEmail)) return '';
    const email = normalizeEmailAddress(coldmailAuditBcc);
    return isLikelyValidEmail(email) ? email : '';
  }

  function getColdmailReplyForwardFromAddress() {
    const email = normalizeEmailAddress(coldmailReplyForwardFrom);
    return isLikelyValidEmail(email) ? email : '';
  }

  function getColdmailReplyForwardToAddress() {
    const email = normalizeEmailAddress(coldmailReplyForwardTo);
    return isLikelyValidEmail(email) ? email : '';
  }

  function getActiveColdmailReplyForwardFromAddress() {
    const email = getColdmailReplyForwardFromAddress();
    if (isColdmailPrivateCopyBlockedSender(email)) return '';
    return email;
  }

  function isColdmailReplyForwardConfigured() {
    const forwardFrom = getActiveColdmailReplyForwardFromAddress();
    return Boolean(
      coldmailReplyForwardEnabled &&
        forwardFrom &&
        getColdmailReplyForwardToAddress()
    );
  }

  function parsePositiveInt(value, fallback, min, max) {
    const raw = value === undefined || value === null ? '' : String(value);
    const parsed = Number.parseInt(raw, 10);
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
    return parsePositiveInt(
      coldmailSendDelayMs,
      DEFAULT_COLDMAIL_SEND_DELAY_MS,
      0,
      5 * 60 * 1000
    );
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
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT
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
      oneClickUnsubscribeConfigured: isColdmailOneClickUnsubscribeConfigured(),
      configuredSenderEmails: getConfiguredSenderEmails(),
      auditBccConfigured: Boolean(getColdmailAuditBccAddress()),
      replyForwardConfigured: isColdmailReplyForwardConfigured(),
      replyForwardFrom: getActiveColdmailReplyForwardFromAddress() || undefined,
      replyForwardTo: getColdmailReplyForwardToAddress() || undefined,
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
    return Math.max(1, Math.min(250, parsed));
  }

  function pruneColdmailSendGuardEntries(entries) {
    const cutoffMs = now().getTime() - COLDMAIL_SEND_GUARD_WINDOW_MS;
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        count: Math.max(0, Number(entry.count || 0) || 0),
        personalCount: Math.max(0, Number(entry.personalCount || 0) || 0),
      }))
      .map((entry) => ({
        ...entry,
        personalCount: Math.min(entry.count, entry.personalCount),
      }))
      .filter((entry) => entry.count > 0 && parseTimestampMs(entry.at) >= cutoffMs);
  }

  function normalizeColdmailSafetyPause(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const until = normalizeString(raw.until);
    if (!until || parseTimestampMs(until) <= now().getTime()) return null;
    return {
      at: normalizeString(raw.at) || now().toISOString(),
      until,
      senderEmail: normalizeEmailAddress(raw.senderEmail),
      reason: truncateText(normalizeString(raw.reason), 500),
      error: truncateText(normalizeString(raw.error), 500),
    };
  }

  async function loadColdmailSendGuardState() {
    const state = await getUiStateValues(coldmailSendGuardScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailSendGuardKey] || '{}', {});
    return {
      entries: pruneColdmailSendGuardEntries(parsed && parsed.entries),
      safetyPause: normalizeColdmailSafetyPause(parsed && parsed.safetyPause),
    };
  }

  async function saveColdmailSendGuardState(sendGuardState, actor = 'coldmail-send-guard') {
    const entries = pruneColdmailSendGuardEntries(sendGuardState && sendGuardState.entries).slice(-1000);
    const safetyPause = normalizeColdmailSafetyPause(sendGuardState && sendGuardState.safetyPause);
    await setUiStateValues(
      coldmailSendGuardScope,
      {
        [coldmailSendGuardKey]: JSON.stringify({ entries, safetyPause }),
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
    const senderSent = entries
      .filter((entry) => entry.senderEmail === selectedSenderEmail)
      .reduce((sum, entry) => sum + entry.count, 0);
    const packageSent = entries.reduce((sum, entry) => sum + entry.count, 0);
    const personalMailboxSent = entries.reduce((sum, entry) => sum + entry.personalCount, 0);
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
      safetyPause: state.safetyPause || null,
    };
  }

  async function recordColdmailSendGuardEntry({ senderEmail, count, personalCount, actor }) {
    const safeCount = Math.max(0, Number(count || 0) || 0);
    if (!safeCount) return false;
    const state = await loadColdmailSendGuardState();
    state.entries.push({
      at: now().toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      count: safeCount,
      personalCount: Math.min(safeCount, Math.max(0, Number(personalCount || 0) || 0)),
    });
    await saveColdmailSendGuardState(state, actor);
    return true;
  }

  async function recordColdmailSafetyPause({ senderEmail, reason, error, actor }) {
    const state = await loadColdmailSendGuardState();
    const pauseMs = getColdmailSafetyPauseMs();
    state.safetyPause = {
      at: now().toISOString(),
      until: new Date(now().getTime() + pauseMs).toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      reason: truncateText(reason, 500),
      error: truncateText(error, 500),
    };
    await saveColdmailSendGuardState(state, actor || 'coldmail-safety-pause');
    return state.safetyPause;
  }

  function getSmtpSafetyStopReason(error) {
    const text = [
      error && error.code,
      error && error.command,
      error && error.response,
      error && error.message,
      error ? String(error) : '',
    ]
      .map(normalizeString)
      .filter(Boolean)
      .join(' ');
    if (!text || !COLDMAIL_SMTP_SAFETY_STOP_PATTERN.test(text)) return '';
    return truncateText(text.replace(/\s+/g, ' '), 500);
  }

  function buildColdmailSafetyPauseMessage(pause) {
    const until = normalizeString(pause && pause.until);
    return until
      ? `Veiligheidspauze actief tot ${until}: Strato of de mailserver gaf een waarschuwing terug.`
      : 'Veiligheidspauze actief: Strato of de mailserver gaf een waarschuwing terug.';
  }

  function getColdmailAttemptDelayMs(item) {
    const email = item && item.row ? getRowEmail(item.row) : '';
    if (email && !isTestRecipientRow(item.row, email) && isPersonalMailboxDomain(email)) {
      return Math.max(getColdmailSendDelayMs(), getColdmailPersonalMailboxSendDelayMs());
    }
    return getColdmailSendDelayMs();
  }

  async function waitBeforeColdmailAttempt(attemptIndex, item) {
    const delayMs = getColdmailAttemptDelayMs(item);
    if (attemptIndex <= 0 || delayMs <= 0) return;
    await sleep(delayMs);
  }

  function matchesBranch(row, branchFilter) {
    const filter = normalizeString(branchFilter).toLowerCase();
    if (!filter) return true;
    return normalizeString(row.branche || row.branch || '').toLowerCase() === filter;
  }

  function matchesRadius(row, radiusKm) {
    const radius = parseRadiusKm(radiusKm);
    const distanceKm = getRowDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return true;
    return distanceKm <= radius;
  }

  function isEligibleColdmailRow(row, branchFilter, radiusKm) {
    const email = getRowEmail(row);
    if (!isLikelyValidEmail(email)) return false;
    if (row.mail === false || row.canMail === false || row.doNotMail === true) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    if (!matchesRadius(row, radiusKm)) return false;
    if (isTestRecipientRow(row, email)) return true;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !EXCLUDED_DATABASE_STATUSES.has(status);
  }

  function isEligibleColdcallingRow(row, branchFilter, radiusKm, blockedPhoneKeys) {
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
    const blockedPhoneKeys = mode === 'call'
      ? parseBlockedPhoneList(input.blockedPhones || input.callBlocklist || input.blockedPhoneNumbers)
      : new Set();
    const state = await getUiStateValues(mode === 'call' ? leadDbScope : customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = mode === 'call' ? parseLeadDatabaseRows(values) : parseDatabaseRows(values);
    const requiresWebdesignPhoto = mode !== 'call' && isWebdesignSpecialAction(input.specialAction);
    const customerPhotoMap = requiresWebdesignPhoto ? await loadCustomerPhotoMap(rows) : {};
    const failed = [];
    const eligibleRows = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) =>
        mode === 'call'
          ? isEligibleColdcallingRow(row, input.branch, input.radiusKm, blockedPhoneKeys)
          : isEligibleColdmailRow(row, input.branch, input.radiusKm)
      );
    const candidateRows = (requiresWebdesignPhoto
      ? eligibleRows.filter((item) => {
          if (resolveRowWebdesignPhoto(item.row, customerPhotoMap)) return true;
          failed.push({
            id: item.id,
            bedrijf: getRowCompany(item.row),
            email: getRowEmail(item.row),
            error: `Geen webdesign-foto gevonden voor ${getRowCompany(item.row) || getRowEmail(item.row)}.`,
          });
          return false;
        })
      : eligibleRows
    ).slice(0, count);
    const selectedRows = [];

    for (const item of candidateRows) {
      if (mode === 'call') {
        selectedRows.push(item);
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
      requested: resolved.count,
      radiusKm: resolved.radiusKm,
      candidates: resolved.candidateRows.length,
      selected: resolved.selectedRows.length,
      safetyLimits: getColdmailSafetyLimits(),
      recipients: resolved.selectedRows.map((item) => ({
        id: item.id,
        bedrijf: getRowCompany(item.row),
        email: getRowEmail(item.row),
        phone: getRowPhone(item.row),
        distanceKm: Number.isFinite(getRowDistanceKm(item.row)) ? Math.round(getRowDistanceKm(item.row) * 10) / 10 : null,
      })),
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

  function markRowAsColdmailUnsubscribed(row, actor, processedKey) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const nextStatus =
      currentStatus === 'klant'
        ? currentStatus
        : canAdvanceContactStatus(currentStatus, 'geblokkeerd')
          ? 'geblokkeerd'
          : currentStatus;
    const entry = {
      type: 'geblokkeerd',
      label: 'Afmelding via one-click unsubscribe',
      date,
      actor: normalizeString(actor) || 'Coldmailing',
      source: 'coldmail-unsubscribe',
      messageKey: normalizeString(processedKey),
      subject: 'Afmelding',
      preview: 'Ontvanger heeft zich afgemeld voor coldmailing.',
    };
    return {
      ...row,
      mail: false,
      canMail: false,
      doNotMail: true,
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      coldmailReplyIntent: 'unsubscribe',
      coldmailUnsubscribedAt: date,
      activeColdmailCampaignUntil: '',
      coldmailCampaignEndsAt: '',
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, entry),
    };
  }

  async function unsubscribeColdmailRecipient(input = {}) {
    const email = normalizeEmailAddress(input.email);
    const token = normalizeString(input.token);
    if (!email || !verifyColdmailUnsubscribeToken(email, token)) {
      const error = new Error('Afmeldlink is ongeldig of verlopen.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    let updated = 0;
    const processedKey = `unsubscribe:${email}`;
    const nextRows = rows.map((row) => {
      if (getRowEmail(row) !== email) return row;
      updated += 1;
      return markRowAsColdmailUnsubscribed(row, normalizeString(input.actor) || 'Coldmailing', processedKey);
    });
    if (updated) {
      await setUiStateValues(
        customerDbScope,
        {
          ...values,
          [customerDbKey]: JSON.stringify(nextRows),
        },
        {
          source: 'coldmail-unsubscribe',
          actor: normalizeString(input.actor) || 'Coldmailing',
        }
      );
    }
    return {
      ok: true,
      email,
      updated,
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

  function appendColdmailOptOutText(text) {
    const cleanText = normalizeString(text);
    if (!cleanText) return COLDMAIL_OPT_OUT_TEXT;
    if (/(afmelden|uitschrijven|unsubscribe)/i.test(cleanText)) return cleanText;
    return `${cleanText}\n\n${COLDMAIL_OPT_OUT_TEXT}`;
  }

  function shouldAppendColdmailOptOutText(text) {
    return !/(afmelden|uitschrijven|unsubscribe)/i.test(normalizeString(text));
  }

  function buildColdmailReference(row, id) {
    const seed = sanitizeFilename(id || getRowCompany(row) || getRowEmail(row) || 'mail', 'mail')
      .replace(/-/g, '')
      .slice(0, 8)
      .toUpperCase();
    const stamp = now().toISOString().slice(0, 10).replace(/-/g, '');
    return `SF-${stamp}-${seed || 'MAIL'}`;
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

  function escapeHtml(value) {
    return normalizeString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseDataUrlImage(value) {
    const match = normalizeString(value).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    return {
      contentType: match[1].toLowerCase(),
      content: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    };
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

  function toHtml(text) {
    const body = normalizeString(text)
      .split(/\n{2,}/)
      .map((paragraph) =>
        `<p>${paragraph
          .split('\n')
          .map((line) =>
            normalizeString(line)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
          )
          .join('<br>')}</p>`
      )
      .join('\n');
    return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;">${body}</div>`;
  }

  function appendWebdesignImageHtml(html, attachment, options = {}) {
    if (!attachment || !attachment.cid) return html;
    const optOutText = normalizeString(options.optOutText || '');
    const optOutHtml = optOutText
      ? `\n<p style="margin:7px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;">${escapeHtml(
          optOutText
        )}</p>`
      : '';
    return `${html}\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:24px 0 0 0;"><tr><td style="padding:0;margin:0;width:100%;font-size:0;line-height:0;overflow:visible;"><img src="cid:${escapeHtml(attachment.cid)}" alt="${escapeHtml(
      attachment.alt || 'Webdesign'
    )}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:none;border:0;outline:none;text-decoration:none;border-radius:12px;object-fit:contain;" /></td></tr></table>${optOutHtml}`;
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
    const transporter = getSmtpTransporter(senderEmail);
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const from = getParsedMailFromEmail(parsedMail);
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    const messageId = normalizeString(parsedMail && parsedMail.messageId);
    const references = collectMessageReferenceHeader(parsedMail);
    const mail = {
      from: formatMailFromHeader(selectedSenderEmail),
      to: from.address,
      replyTo: getColdmailReplyToAddress(selectedSenderEmail),
      subject: buildReplySubject(parsedMail && parsedMail.subject),
      text: replyText,
      inReplyTo: messageId || undefined,
      references: references || undefined,
    };
    const info = await transporter.sendMail(mail);
    await saveSentCopy(selectedSenderEmail, mail, info);
    return info;
  }

  function isInboundReplyAddressedToForwardSource(parsedMail) {
    const forwardFrom = getActiveColdmailReplyForwardFromAddress();
    if (!forwardFrom) return false;
    const recipients = [
      ...getParsedMailAddressList(parsedMail, 'to'),
      ...getParsedMailAddressList(parsedMail, 'cc'),
    ];
    return recipients.some((entry) => entry.address === forwardFrom);
  }

  function buildColdmailReplyForwardSubject({ parsedMail, row }) {
    const company = getRowCompany(row) || getParsedMailFromEmail(parsedMail).address || 'Coldmail reactie';
    const subject = normalizeString(parsedMail && parsedMail.subject).replace(/^re\s*:\s*/i, '');
    return truncateText(
      ['Coldmail reactie', company, subject].filter(Boolean).join(' - '),
      240
    );
  }

  function buildColdmailReplyForwardText({ parsedMail, row, inboundText, mailboxId, forwardFrom }) {
    const from = getParsedMailFromEmail(parsedMail);
    const receivedAt =
      parsedMail && parsedMail.date instanceof Date ? parsedMail.date.toISOString() : now().toISOString();
    return [
      'Nieuwe reactie op een Softora coldmailcampagne.',
      '',
      `Bedrijf: ${getRowCompany(row) || 'Onbekend'}`,
      `Contact: ${getRowContact(row) || 'Onbekend'}`,
      `Afzender klant: ${from.address || 'Onbekend'}`,
      `Ontvangen op mailbox: ${forwardFrom}`,
      `Ontvangen om: ${receivedAt}`,
      `Onderwerp: ${normalizeString(parsedMail && parsedMail.subject) || '(Geen onderwerp)'}`,
      `Mailboxbericht: ${normalizeString(mailboxId) || 'Onbekend'}`,
      '',
      'Reactie:',
      inboundText,
    ].join('\n');
  }

  async function forwardColdmailReplyToPrivateMailbox({ parsedMail, row, inboundText, mailboxId }) {
    if (!isColdmailReplyForwardConfigured()) {
      return { forwarded: false, reason: 'forward_not_configured' };
    }
    if (!isInboundReplyAddressedToForwardSource(parsedMail)) {
      return { forwarded: false, reason: 'not_forward_source_recipient' };
    }
    const forwardFrom = getActiveColdmailReplyForwardFromAddress();
    const transporter = getSmtpTransporter(forwardFrom);
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd voor coldmail-forward.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const forwardTo = getColdmailReplyForwardToAddress();
    const mail = {
      from: formatMailFromHeader(forwardFrom),
      to: forwardTo,
      replyTo: forwardFrom,
      subject: buildColdmailReplyForwardSubject({ parsedMail, row }),
      text: buildColdmailReplyForwardText({
        parsedMail,
        row,
        inboundText,
        mailboxId,
        forwardFrom,
      }),
    };
    const info = await transporter.sendMail(mail);
    const sentCopySaved = await saveSentCopy(forwardFrom, mail, info);
    return {
      forwarded: true,
      from: forwardFrom,
      to: forwardTo,
      messageId: normalizeString(info && info.messageId),
      sentCopySaved,
    };
  }

  function buildCustomerPhotoDataKey(row) {
    return `softora_database_photo_data_v1_${normalizeString(getRowId(row, 0)).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)}`;
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
      const chunkCount = Math.max(0, Math.min(80, Number(item.chunkCount || 0) || 0));
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, chunkCount);
      if (chunked) {
        item.websitePhoto = chunked.dataUrl;
        item.chunkCount = chunked.chunkCount;
        return;
      }
      if (parseDataUrlImage(item.websitePhoto)) return;
    });
    (Array.isArray(rows) ? rows : []).forEach((entry, index) => {
      const row = entry && entry.row && typeof entry.row === 'object' ? entry.row : entry;
      const id = normalizeString(entry && entry.id) || getRowId(row, index);
      if (!id) return;
      const photoKey = buildCustomerPhotoDataKey(row);
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, 0);
      if (!chunked) return;
      const existing = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : null;
      if (existing && normalizeString(existing.photoKey) && parseDataUrlImage(existing.websitePhoto)) return;
      parsed[id] = {
        id,
        identityKey: buildRowIdentityKey(row),
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

  function resolveRowWebdesignPhoto(row, photoMap) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const direct = photos[getRowId(row, 0)];
    const identityKey = buildRowIdentityKey(row);
    const identity = Object.keys(photos)
      .map((key) => photos[key])
      .find((item) => normalizeString(item && item.identityKey) === identityKey);
    const inline = {
      websitePhoto: row && (row.websitePhoto || row.photo || row.websiteImage),
      websitePhotoName: row && (row.websitePhotoName || row.photoName || row.websiteImageName),
    };
    const candidates = [direct, identity, inline].filter(Boolean);
    const resolved = candidates
      .map((photo) => ({ photo, parsed: parseDataUrlImage(photo && photo.websitePhoto) }))
      .find((candidate) => candidate.parsed);
    if (!resolved) return null;
    const { photo, parsed } = resolved;
    if (!parsed) return null;
    const baseName = sanitizeFilename(photo.websitePhotoName || `${getRowCompany(row)} webdesign`, 'webdesign');
    const extension = getImageExtension(parsed.contentType);
    const filename = `${baseName}.${extension}`;
    const cid = `webdesign-${sanitizeFilename(getRowId(row, 0), 'image')}@softora`;
    return {
      ...parsed,
      filename,
      cid,
      alt: `${getRowCompany(row) || 'Bedrijf'} webdesign`,
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
    const isWebdesignOutreach = isWebdesignSpecialAction(context.specialAction);
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

  function markRowFromColdmailBounce(row, classification, parsedMail, inboundText, processedKey, actor, context = {}) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const hardBounce = classification && classification.bounceType === 'hard';
    const nextStatus =
      hardBounce && canAdvanceContactStatus(currentStatus, 'geblokkeerd') ? 'geblokkeerd' : currentStatus;
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
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
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
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
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
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
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

  async function sendColdmailCampaign(input = {}) {
    if (coldmailCampaignSendPromise) {
      const error = new Error(
        'Er loopt al een coldmailcampagne. Wacht tot die klaar is, zodat daglimieten en Strato-veiligheid niet kunnen botsen.'
      );
      error.code = 'COLDMAIL_SEND_IN_PROGRESS';
      throw error;
    }
    const promise = sendColdmailCampaignUnlocked(input);
    coldmailCampaignSendPromise = promise;
    try {
      return await promise;
    } finally {
      if (coldmailCampaignSendPromise === promise) coldmailCampaignSendPromise = null;
    }
  }

  async function sendColdmailCampaignUnlocked(input = {}) {
    if (!isSmtpMailConfigured()) {
      const error = new Error('Mail is nog niet gekoppeld. Vul eerst de SMTP-gegevens op de server in.');
      error.code = 'SMTP_NOT_CONFIGURED';
      error.missing = getMissingSmtpMailEnv();
      throw error;
    }

    const senderEmail = assertSenderAllowed(input.senderEmail);
    if (!resolveMailboxSmtpAccount(senderEmail).smtpConfigured) {
      const error = new Error(
        `SMTP is nog niet veilig gekoppeld voor ${senderEmail}. Voeg een mailbox-wachtwoord toe voor deze afzender of markeer hem bewust als alias.`
      );
      error.code = 'SENDER_SMTP_NOT_CONFIGURED';
      error.missing = getMissingSenderSmtpEnv(senderEmail);
      error.allowedSenderEmails = getAllowedSenderEmails();
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
    const count = resolvedRecipients.count;
    const values = resolvedRecipients.values;
    let rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;

    const shouldIncludeWebdesignPhoto = isWebdesignSpecialAction(input.specialAction);

    if (!candidateRows.length) {
      const firstFailure = resolvedRecipients.failed[0] && resolvedRecipients.failed[0].error ? resolvedRecipients.failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geschikte e-mailadressen gevonden in de database.');
      error.code = shouldIncludeWebdesignPhoto && firstFailure ? 'NO_WEBDESIGN_PHOTOS' : 'NO_RECIPIENTS';
      error.failedItems = resolvedRecipients.failed;
      throw error;
    }

    let selectedRows = resolvedRecipients.selectedRows;
    const failed = resolvedRecipients.failed;
    const quota = await getColdmailSendQuota(senderEmail);
    if (quota.safetyPause) {
      const error = new Error(buildColdmailSafetyPauseMessage(quota.safetyPause));
      error.code = 'COLDMAIL_SAFETY_PAUSED';
      error.quota = quota;
      throw error;
    }
    const quotaRemaining = Math.min(quota.senderRemaining, quota.packageRemaining);
    if (quotaRemaining <= 0) {
      const error = new Error(
        'Daglimiet bereikt: om je STRATO-mailbox en domeinreputatie te beschermen worden vandaag geen extra coldmails verzonden.'
      );
      error.code = 'COLDMAIL_DAILY_LIMIT_REACHED';
      error.quota = quota;
      throw error;
    }
    if (selectedRows.length > quotaRemaining) {
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
    if (!shouldBlockPersonalMailboxDomains()) {
      let selectedPersonalMailboxCount = 0;
      selectedRows = selectedRows.filter((item) => {
        const email = getRowEmail(item.row);
        if (isTestRecipientRow(item.row, email) || !isPersonalMailboxDomain(email)) return true;
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
    const customerPhotoMap = shouldIncludeWebdesignPhoto ? resolvedRecipients.customerPhotoMap || await loadCustomerPhotoMap(candidateRows) : {};

    if (!selectedRows.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geldige e-maildomeinen gevonden in de database.');
      error.code = 'NO_VALID_RECIPIENT_DOMAINS';
      error.failedItems = failed;
      throw error;
    }

    const transporter = getSmtpTransporter(senderEmail);
    const sent = [];
    const persistedSentRowIds = new Set();
    const auditBcc = getColdmailAuditBccAddress(senderEmail);
    let safetyPause = null;
    let attempted = 0;
    const actor = normalizeString(input.actor || 'Coldmailing');

    for (let index = 0; index < selectedRows.length; index += 1) {
      const item = selectedRows[index];
      await waitBeforeColdmailAttempt(attempted, item);
      attempted += 1;
      const row = item.row;
      const to = getRowEmail(row);
      const reference = buildColdmailReference(row, item.id);
      const baseText = buildMailText(bodyTemplate, row);
      const text = appendColdmailOptOutText(baseText);
      const subject = personalizeTemplate(subjectTemplate, row);
      const webdesignPhoto = shouldIncludeWebdesignPhoto ? resolveRowWebdesignPhoto(row, customerPhotoMap) : null;
      if (shouldIncludeWebdesignPhoto && !webdesignPhoto) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: `Geen webdesign-foto gevonden voor ${getRowCompany(row) || to}.`,
        });
        continue;
      }
      const htmlBodyText = webdesignPhoto ? baseText : text;
      const htmlBase = appendHiddenColdmailReferenceHtml(toHtml(htmlBodyText), reference);
      const html = webdesignPhoto
        ? appendWebdesignImageHtml(htmlBase, webdesignPhoto, {
            optOutText: shouldAppendColdmailOptOutText(baseText) ? COLDMAIL_OPT_OUT_TEXT : '',
          })
        : htmlBase;
      const attachments = webdesignPhoto
        ? [
            {
              filename: webdesignPhoto.filename,
              content: webdesignPhoto.content,
              contentType: webdesignPhoto.contentType,
              cid: webdesignPhoto.cid,
              contentDisposition: 'inline',
            },
          ]
        : undefined;
      try {
        const mail = {
          from: formatMailFromHeader(senderEmail),
          to,
          replyTo: getColdmailReplyToAddress(senderEmail),
          subject,
          text,
          html,
          attachments,
        };
        const listUnsubscribe = getColdmailListUnsubscribeHeader(senderEmail, to);
        if (listUnsubscribe) {
          mail.headers = {
            'List-Unsubscribe': listUnsubscribe,
          };
          const listUnsubscribePost = getColdmailListUnsubscribePostHeader(to);
          if (listUnsubscribePost) mail.headers['List-Unsubscribe-Post'] = listUnsubscribePost;
        }
        if (auditBcc && auditBcc !== normalizeEmailAddress(to)) {
          mail.bcc = auditBcc;
        }
        const info = await transporter.sendMail(mail);
        const sentCopySaved = await saveSentCopy(senderEmail, mail, info);
        const sentItem = {
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          response: truncateText(normalizeString(info && info.response), 500),
          sentCopySaved,
        };
        sent.push(sentItem);
        if (!isTestRecipientRow(row, to)) {
          const updatedRows = rows.map((currentRow, rowIndex) => {
            const rowId = getRowId(currentRow, rowIndex);
            if (rowId !== item.id) return currentRow;
            return markRowAsMailed(currentRow, actor, input.durationDays, {
              senderEmail,
              specialAction: input.specialAction,
              messageId: sentItem.messageId,
            });
          });
          rows = updatedRows;
          persistedSentRowIds.add(item.id);
          await setUiStateValues(
            customerDbScope,
            {
              ...values,
              [customerDbKey]: JSON.stringify(updatedRows),
            },
            {
              source: 'coldmail-campaign',
              actor,
            }
          );
          await recordColdmailSendGuardEntry({
            senderEmail,
            count: 1,
            personalCount: isPersonalMailboxDomain(to) ? 1 : 0,
            actor,
          });
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
            error: normalizeString(error && error.message),
            actor: normalizeString(input.actor || 'Coldmailing'),
          });
          selectedRows.slice(index + 1).forEach((remainingItem) => {
            failed.push({
              id: remainingItem.id,
              bedrijf: getRowCompany(remainingItem.row),
              email: getRowEmail(remainingItem.row),
              error: buildColdmailSafetyPauseMessage(safetyPause),
            });
          });
          break;
        }
      }
    }

    if (!sent.length && failed.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure ? `Geen mails verzonden: ${firstFailure}` : 'Geen mails verzonden.');
      error.code = safetyPause ? 'COLDMAIL_SAFETY_PAUSED' : 'SMTP_SEND_FAILED';
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
      specialAction: normalizeString(input.specialAction || ''),
      sentItems: sent,
      failedItems: failed,
    };
  }

  async function syncInboundColdmailRepliesFromImap(options = {}) {
    const force = Boolean(options.force);
    const maxMessages = Math.max(5, Math.min(100, Number(options.maxMessages || 30) || 30));
    const replyForwardConfigured = isColdmailReplyForwardConfigured();
    const bounceProcessingEnabled = coldmailBounceProcessingEnabled !== false;
    if (!coldmailAutoReplyEnabled && !replyForwardConfigured && !bounceProcessingEnabled) {
      return {
        ok: true,
        skipped: true,
        reason: 'coldmail_reply_processing_disabled',
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
    if (!isSmtpMailConfigured()) {
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
        deliveryFailures: 0,
        forwarded: 0,
        forwardSkipped: 0,
        forwardErrors: 0,
        autoReplySkipped: 0,
        errors: [],
      };
      const dbState = await getUiStateValues(customerDbScope);
      const values = dbState && typeof dbState.values === 'object' ? dbState.values : {};
      let rows = parseDatabaseRows(values);
      const replyState = await loadColdmailReplyState();
      const syncAccount = resolveColdmailReplySyncAccount();
      stats.syncAccount = syncAccount.email;
      const client = createImapClient({
        host: syncAccount.imapHost,
        port: Number(syncAccount.imapPort),
        secure: Boolean(syncAccount.imapSecure),
        auth: {
          user: syncAccount.imapUser,
          pass: syncAccount.imapPass,
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
              const processedEntry =
                replyState.processed[processedKey] && typeof replyState.processed[processedKey] === 'object'
                  ? replyState.processed[processedKey]
                  : null;
              const inboundText = getInboundReplyText(parsedMail);
              const deliveryFailure = classifyColdmailDeliveryFailure(parsedMail, inboundText);
              const addressedToForwardSource = isInboundReplyAddressedToForwardSource(parsedMail);
              const forwardNeeded =
                !deliveryFailure &&
                replyForwardConfigured &&
                addressedToForwardSource &&
                !(processedEntry && processedEntry.forwardedAt);
              const autoReplyNeeded =
                !deliveryFailure &&
                Boolean(coldmailAutoReplyEnabled) &&
                !(processedEntry && processedEntry.messageId);
              const lifecycleNeeded =
                !(processedEntry && Object.prototype.hasOwnProperty.call(processedEntry, 'lifecycleIntent'));
              if (processedEntry && !forwardNeeded && !autoReplyNeeded && !lifecycleNeeded) {
                stats.skippedProcessed += 1;
                continue;
              }

              const lifecycleText = inboundText || truncateText(normalizeString(parsedMail && parsedMail.subject), 500);
              const match = deliveryFailure
                ? findColdmailRowForDeliveryFailure(parsedMail, lifecycleText, rows)
                : findColdmailRowForInboundReply(parsedMail, rows);
              if (!match || (!inboundText && !deliveryFailure)) {
                stats.ignored += 1;
                continue;
              }

              stats.matched += 1;
              const from = getParsedMailFromEmail(parsedMail);
              const mailboxId = buildMailboxMessageId(mailboxName, message.uid);
              const classification = classifyInboundColdmailReplyLifecycle(inboundText);
              try {
                if (deliveryFailure) {
                  if (lifecycleNeeded) {
                    try {
                      const lifecycle = await persistColdmailBounceLifecycle({
                        values,
                        rows,
                        match,
                        parsedMail,
                        inboundText: lifecycleText,
                        processedKey,
                        actor: 'Coldmailing',
                        classification: deliveryFailure,
                      });
                      rows = lifecycle.rows;
                      if (lifecycle.persisted) {
                        markColdmailReplyLifecycleProcessed(replyState, processedKey, {
                          from,
                          match,
                          parsedMail,
                          classification: deliveryFailure,
                        });
                        await saveColdmailReplyState(replyState, 'coldmail-bounce');
                        stats.lifecycleUpdated += 1;
                        stats.deliveryFailures += 1;
                        if (deliveryFailure.bounceType === 'hard') stats.hardBounced += 1;
                        else if (deliveryFailure.bounceType === 'soft') stats.softBounced += 1;
                      } else {
                        stats.lifecycleSkipped += 1;
                      }
                    } catch (error) {
                      stats.errors.push(
                        `${from.address || 'mailserver'} bounce: ${truncateText(
                          error && error.message ? error.message : String(error),
                          220
                        )}`
                      );
                    }
                  } else {
                    stats.lifecycleSkipped += 1;
                  }

                  const bounceSafetyReason = getSmtpSafetyStopReason({
                    message: buildColdmailDeliveryFailureText(parsedMail, lifecycleText),
                  });
                  if (bounceSafetyReason) {
                    const pause = await recordColdmailSafetyPause({
                      senderEmail: resolveInboundMailboxAccount(parsedMail),
                      reason: bounceSafetyReason,
                      error: bounceSafetyReason,
                      actor: 'Coldmailing',
                    });
                    stats.safetyPausedUntil = pause.until;
                  }
                  continue;
                }

                if (lifecycleNeeded) {
                  try {
                    const lifecycle = await persistColdmailReplyLifecycle({
                      values,
                      rows,
                      match,
                      parsedMail,
                      inboundText,
                      processedKey,
                      actor: 'Coldmailing',
                      mailboxId,
                      mailboxFolder: mailboxName,
                      mailboxAccount: resolveInboundMailboxAccount(parsedMail),
                    });
                    rows = lifecycle.rows;
                    if (lifecycle.persisted) {
                      markColdmailReplyLifecycleProcessed(replyState, processedKey, {
                        from,
                        match,
                        parsedMail,
                        classification,
                      });
                      await saveColdmailReplyState(replyState, 'coldmail-reply-lifecycle');
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
                } else {
                  stats.lifecycleSkipped += 1;
                }

                let handled = false;
                if (forwardNeeded) {
                  try {
                    const forwardInfo = await forwardColdmailReplyToPrivateMailbox({
                      parsedMail,
                      row: match.row,
                      inboundText,
                      mailboxId,
                    });
                    if (forwardInfo.forwarded) {
                      markColdmailReplyLifecycleProcessed(replyState, processedKey, {
                        from,
                        match,
                        parsedMail,
                        classification,
                      });
                      const existing = replyState.processed[processedKey] || {};
                      replyState.processed[processedKey] = {
                        ...existing,
                        forwardedAt: now().toISOString(),
                        forwardFrom: forwardInfo.from,
                        forwardTo: forwardInfo.to,
                        forwardMessageId: forwardInfo.messageId,
                      };
                      await saveColdmailReplyState(replyState, 'coldmail-reply-forward');
                      stats.forwarded += 1;
                      handled = true;
                    } else {
                      stats.forwardSkipped += 1;
                    }
                  } catch (error) {
                    stats.forwardErrors += 1;
                    stats.errors.push(
                      `${from.address || 'onbekende afzender'} forward: ${truncateText(
                        error && error.message ? error.message : String(error),
                        220
                      )}`
                    );
                  }
                } else if (replyForwardConfigured) {
                  stats.forwardSkipped += 1;
                }

                if (autoReplyNeeded) {
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
                  markColdmailReplyLifecycleProcessed(replyState, processedKey, {
                    from,
                    match,
                    parsedMail,
                    classification,
                  });
                  const existing = replyState.processed[processedKey] || {};
                  replyState.processed[processedKey] = {
                    ...existing,
                    model: aiReply.model,
                    messageId: normalizeString(info && info.messageId),
                  };
                  await saveColdmailReplyState(replyState, 'coldmail-auto-reply');
                  stats.replied += 1;
                  handled = true;
                } else if (!coldmailAutoReplyEnabled) {
                  stats.autoReplySkipped += 1;
                }

                if (!handled && lifecycleNeeded && !forwardNeeded && !autoReplyNeeded) {
                  markColdmailReplyLifecycleProcessed(replyState, processedKey, {
                    from,
                    match,
                    parsedMail,
                    classification,
                  });
                  await saveColdmailReplyState(replyState, 'coldmail-reply-lifecycle');
                }

                const flagsSet =
                  message.flags instanceof Set
                    ? message.flags
                    : new Set(Array.isArray(message.flags) ? message.flags : []);
                if (handled && !flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
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
    listColdmailReplyFollowUps,
    unsubscribeColdmailRecipient,
    sendColdmailCampaign,
    syncInboundColdmailRepliesFromImap,
    updateWebdesignOutreachStatus,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
