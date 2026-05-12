const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { readChunkedStateValue } = require('./data-ops-serialization');
const { createMailboxService } = require('./mailbox');
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');

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
const COLDMAIL_SEND_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000;
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
const COLDMAIL_OPT_OUT_LABEL = 'Had je liever geen webdesign willen ontvangen? Laat het me hier weten!';
const COLDMAIL_OPT_OUT_TEXT_PREFIX = 'Had je liever geen webdesign willen ontvangen? Laat het me hier weten!';
const COLDMAIL_UNSUBSCRIBE_PATH = '/afmelden';
const COLDMAIL_PREVIEW_IMAGE_PATH = '/coldmailing/webdesign-foto';
const COLDMAIL_MOCKUP_CAPTION = 'Zo ziet het eruit op elk device 🤩';
const COLDMAIL_TEST_RECIPIENT_EMAIL = 'servec321@gmail.com';
const COLDMAIL_TEST_RECIPIENT_ID = 'softora-test-mode-recipient';
const TEST_RECIPIENT_EMAILS = new Set([COLDMAIL_TEST_RECIPIENT_EMAIL]);
const TEST_RECIPIENT_COMPANIES = new Set(['mcv e-commerce', 'softora testmodus']);
const SENDER_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
  'ruben@softora.nl': 'Ruben',
};
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
    imapHost = '',
    imapPort = 993,
    imapSecure = false,
    imapUser = '',
    imapPass = '',
    imapMailbox = 'INBOX',
    imapExtraMailboxes = [],
    imapPollCooldownMs = 20_000,
    coldmailCampaignSendLimit = DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
    coldmailDailySendLimit = DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
    coldmailPackageDailySendLimit = DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
    coldmailBlockPersonalMailboxDomains = false,
  } = mailConfig;

  let smtpTransporter = null;
  const senderSmtpTransporters = new Map();
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

  function isSmtpMailConfigured() {
    return Boolean(
      smtpHost &&
        Number.isFinite(Number(smtpPort)) &&
        Number(smtpPort) > 0 &&
        smtpUser &&
        smtpPass &&
        mailFromAddress
    );
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
    return {
      email,
      name: normalizeString(SENDER_DISPLAY_NAMES[email] || mailFromName || 'Softora'),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure: Boolean(smtpSecure),
      smtpUser,
      smtpPass,
    };
  }

  function resolveSenderSmtpAccount(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress || smtpUser);
    const account = getConfiguredMailboxSmtpAccounts().find((item) => normalizeEmailAddress(item.email) === selected);
    if (account) {
      const email = normalizeEmailAddress(account.email);
      return {
        email,
        name: normalizeString(SENDER_DISPLAY_NAMES[email] || account.name),
        smtpHost: account.smtpHost,
        smtpPort: Number(account.smtpPort) || 587,
        smtpSecure: Boolean(account.smtpSecure),
        smtpUser: account.smtpUser,
        smtpPass: account.smtpPass,
      };
    }
    return buildBaseSmtpAccount(selected);
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
    return (Array.isArray(customerRows) ? customerRows : []).find((row) => {
      if (!row || typeof row !== 'object') return false;
      const id = normalizeString(row.id || row.customerId || row.databaseId).toLowerCase();
      return id === COLDMAIL_TEST_RECIPIENT_ID;
    }) || null;
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

  function buildRowIdentityKey(row) {
    return [getRowCompany(row), getRowContact(row), getRowPhone(row)]
      .map((value) => normalizeString(value).toLowerCase())
      .join('|');
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
    const id = getRowId(row, index);
    const identityKey = buildRowIdentityKey(row);
    return photos[id] || byIdentity.get(identityKey) || null;
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

  function createReadyWebdesignMatcher(customerRows = [], photoMap = {}) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      if (!hasReadyWebsitePhotoRecord(item)) return;
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });

    const readyIds = new Set();
    const readyIdentityKeys = new Set();
    const readyPhoneKeys = new Set();

    (Array.isArray(customerRows) ? customerRows : []).forEach((row, index) => {
      const photo = findStoredPhotoRecordForRow(row, index, photos, photosByIdentity);
      if (!hasReadyWebsitePhotoRecord(photo)) return;

      const rowId = getRowId(row, index);
      const identityKey = buildRowIdentityKey(row);
      if (rowId) readyIds.add(rowId);
      if (identityKey) readyIdentityKeys.add(identityKey);
      getComparablePhoneKeys(getRowPhone(row)).forEach((key) => readyPhoneKeys.add(key));
    });

    return {
      hasRow(row, index = 0) {
        const rowId = getRowId(row, index);
        if (rowId && readyIds.has(rowId)) return true;
        const identityKey = buildRowIdentityKey(row);
        if (identityKey && readyIdentityKeys.has(identityKey)) return true;
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
    const accountName = smtpAccount && normalizeEmailAddress(smtpAccount.email) === address
      ? normalizeString(smtpAccount.name)
      : '';
    const name = normalizeString(accountName || SENDER_DISPLAY_NAMES[address] || mailFromName || 'Softora');
    return name ? `${name} <${address}>` : address;
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

  function shouldBlockPersonalMailboxDomains() {
    return coldmailBlockPersonalMailboxDomains !== false;
  }

  function getColdmailSafetyLimits() {
    return {
      campaignSendLimit: getColdmailCampaignSendLimit(),
      dailySendLimit: getColdmailDailySendLimit(),
      packageDailySendLimit: getColdmailPackageDailySendLimit(),
      blocksPersonalMailboxDomains: shouldBlockPersonalMailboxDomains(),
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
    return Math.max(1, Math.min(250, parsed));
  }

  function hasExplicitRadiusKm(value) {
    return normalizeString(value) !== '';
  }

  function pruneColdmailSendGuardEntries(entries) {
    const cutoffMs = now().getTime() - COLDMAIL_SEND_GUARD_WINDOW_MS;
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        count: Math.max(0, Number(entry.count || 0) || 0),
      }))
      .filter((entry) => entry.count > 0 && parseTimestampMs(entry.at) >= cutoffMs);
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
    const senderSent = entries
      .filter((entry) => entry.senderEmail === selectedSenderEmail)
      .reduce((sum, entry) => sum + entry.count, 0);
    const packageSent = entries.reduce((sum, entry) => sum + entry.count, 0);
    const dailySendLimit = getColdmailDailySendLimit();
    const packageDailySendLimit = getColdmailPackageDailySendLimit();
    return {
      entries,
      senderSent,
      packageSent,
      dailySendLimit,
      packageDailySendLimit,
      senderRemaining: Math.max(0, dailySendLimit - senderSent),
      packageRemaining: Math.max(0, packageDailySendLimit - packageSent),
    };
  }

  async function recordColdmailSendGuardEntry({ senderEmail, count, actor }) {
    const safeCount = Math.max(0, Number(count || 0) || 0);
    if (!safeCount) return false;
    const state = await loadColdmailSendGuardState();
    state.entries.push({
      at: now().toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      count: safeCount,
    });
    await saveColdmailSendGuardState(state, actor);
    return true;
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
      const customerPhotoMap = shouldUseWebdesignAssets(input, mode) ? await loadCustomerPhotoMap() : {};
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
    const customerPhotoMap = shouldRequireWebdesign ? await loadCustomerPhotoMap() : {};
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
    return !/(?:had je liever geen webdesign willen ontvangen\?\s*laat het me hier weten!?|past dit niet\?\s*laat het me hier weten|liever geen e-mails meer ontvangen|geen e-mails meer ontvangen.*https?:\/\/|afmelden:\s*https?:\/\/|\/afmelden\?t=|\/coldmailing\/afmelden\?t=|unsubscribe:\s*https?:\/\/)/i.test(
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

  function signColdmailUnsubscribePayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailUnsubscribeSecret())
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
    const imageHtml = `<img src="cid:${escapeHtml(attachment.cid)}" alt="${escapeHtml(
      attachment.alt || 'Webdesign'
    )}" style="display:block;max-width:100%;height:auto;border:0;border-radius:12px;" />`;
    const mockupHtml = attachment.mockup && attachment.mockup.cid
      ? `\n<p style="margin:20px 0 7px 0;font-size:16px;line-height:1.45;color:#1a1a2e;font-weight:700;">${escapeHtml(mockupCaption)}</p>\n<p style="margin:0;"><img src="cid:${escapeHtml(attachment.mockup.cid)}" alt="${escapeHtml(
          attachment.mockup.alt || 'Device mockup'
        )}" style="display:block;max-width:100%;height:auto;border:0;border-radius:12px;" /></p>`
      : '';
    return `${html}\n<p style="margin:24px 0 0 0;">${imageHtml}</p>${mockupHtml}${optOutHtml}`;
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

  async function generateColdmailAutoReplyWithOpenAi({ row, inboundText, inboundSubject, fromName }) {
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
    const system = [
      'Je bent Servé Creusen van Softora.',
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
        name: 'Servé Creusen',
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
    return transporter.sendMail({
      from: formatMailFromHeader(senderEmail, delivery.account),
      to: from.address,
      replyTo: mailReplyTo || senderEmail || mailFromAddress || undefined,
      subject: buildReplySubject(parsedMail && parsedMail.subject),
      text: replyText,
      inReplyTo: messageId || undefined,
      references: references || undefined,
    });
  }

  function parseCustomerPhotoMap(raw, values = {}) {
    const parsed = safeJsonParse(raw || '{}', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stateValues = values && typeof values === 'object' ? values : {};
    const readChunkedPhotoDataUrl = (photoKey, chunkCount) => {
      const key = normalizeString(photoKey);
      if (!key) return '';
      const explicitCount = Math.max(0, Math.min(80, Number(chunkCount || 0) || 0));
      const chunks = [];
      if (explicitCount) {
        for (let index = 0; index < explicitCount; index += 1) {
          chunks.push(normalizeString(stateValues[`${key}_${index}`]));
        }
      } else {
        for (let index = 0; index < 80; index += 1) {
          const value = stateValues[`${key}_${index}`];
          if (typeof value !== 'string') break;
          chunks.push(normalizeString(value));
        }
      }
      const dataUrl = chunks.join('');
      return parseDataUrlImage(dataUrl) ? dataUrl : '';
    };
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key];
      if (!item || typeof item !== 'object') return;
      const photoKey = normalizeString(item.photoKey);
      if (photoKey && !parseDataUrlImage(item.websitePhoto)) {
        const dataUrl = readChunkedPhotoDataUrl(photoKey, item.chunkCount);
        if (dataUrl) item.websitePhoto = dataUrl;
      }
      const mockupPhotoKey = normalizeString(item.mockupPhotoKey || item.websiteMockupKey);
      if (mockupPhotoKey && !parseDataUrlImage(item.websiteMockup)) {
        const mockupDataUrl = readChunkedPhotoDataUrl(
          mockupPhotoKey,
          item.mockupChunkCount || item.websiteMockupChunkCount
        );
        if (mockupDataUrl) item.websiteMockup = mockupDataUrl;
      }
    });
    return parsed;
  }

  async function loadCustomerPhotoMap() {
    const state = await getUiStateValues(customerPhotoScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values);
  }

  async function resolveRowWebdesignPhoto(row, photoMap) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });
    const photo = findStoredPhotoRecordForRow(row, 0, photos, photosByIdentity);
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

  function markRowAsMailed(row, actor, durationDays) {
    const date = now().toISOString();
    const safeDurationDays = normalizeCampaignDurationDays(durationDays);
    const campaignEndsAt = safeDurationDays > 0 ? addDaysIso(new Date(date), safeDurationDays) : '';
    const existingHistory = Array.isArray(row.hist) ? row.hist : [];
    return {
      ...row,
      status: 'gemaild',
      databaseStatus: 'gemaild',
      mail: true,
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

  function markRowFromColdmailReply(row, classification, parsedMail, inboundText, processedKey, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const canAdvance = canAdvanceContactStatus(currentStatus, classification.status);
    const nextStatus = canAdvance ? classification.status : currentStatus;
    const historyEntry = buildColdmailReplyHistoryEntry({
      classification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
    });
    const shouldClearCampaignWindow =
      ['interesse', 'geblokkeerd'].includes(nextStatus) ||
      ['interesse', 'geblokkeerd'].includes(classification.status);
    const mailFields = classification.disableMail
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

  async function persistColdmailReplyLifecycle({
    values,
    rows,
    match,
    parsedMail,
    inboundText,
    processedKey,
    actor,
  }) {
    const classification = classifyInboundColdmailReplyLifecycle(inboundText);
    if (!classification.status) {
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

    const nextRows = rows.slice();
    nextRows[match.index] = markRowFromColdmailReply(
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
      {
        ...values,
        [customerDbKey]: JSON.stringify(nextRows),
      },
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
    const photo = findStoredPhotoRecordForRow(rows[match.index], match.index, photos, photosByIdentity);
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
    if (!isSmtpMailConfigured()) {
      const error = new Error('Mail is nog niet gekoppeld. Vul eerst de SMTP-gegevens op de server in.');
      error.code = 'SMTP_NOT_CONFIGURED';
      error.missing = getMissingSmtpMailEnv();
      throw error;
    }

    const senderEmail = assertSenderAllowed(input.senderEmail);
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
    const rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;
    const failed = resolvedRecipients.failed;

    if (!candidateRows.length) {
      const error = new Error('Geen geschikte e-mailadressen gevonden in de database.');
      error.code = 'NO_RECIPIENTS';
      error.failedItems = failed;
      throw error;
    }

    let selectedRows = resolvedRecipients.selectedRows;
    const quota = await getColdmailSendQuota(senderEmail);
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
    const shouldIncludeWebdesignPhoto = shouldUseWebdesignAssets(input, 'mail');
    const customerPhotoMap = shouldIncludeWebdesignPhoto ? (resolvedRecipients.customerPhotoMap || await loadCustomerPhotoMap()) : {};

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

    for (const item of selectedRows) {
      const row = item.row;
      const to = getRowEmail(row);
      const reference = buildColdmailReference(row, item.id);
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
      const htmlBase = appendHiddenColdmailReferenceHtml(toHtml(baseText), reference);
      const html = webdesignPhoto
        ? appendWebdesignImageHtml(htmlBase, webdesignPhoto, {
            optOutText: shouldAppendOptOut ? COLDMAIL_OPT_OUT_LABEL : '',
            optOutUrl: unsubscribeUrl,
          })
        : appendColdmailOptOutHtml(htmlBase, unsubscribeUrl);
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
        const info = await transporter.sendMail({
          from: formatMailFromHeader(senderEmail, smtpAccount),
          to,
          replyTo: mailReplyTo || senderEmail || mailFromAddress || undefined,
          subject,
          text,
          html,
          attachments,
        });
        const accepted = Array.isArray(info && info.accepted)
          ? info.accepted.map(normalizeEmailAddress).filter(Boolean)
          : [];
        const rejected = Array.isArray(info && info.rejected)
          ? info.rejected.map(normalizeEmailAddress).filter(Boolean)
          : [];
        if (rejected.includes(normalizeEmailAddress(to)) || (Array.isArray(info && info.accepted) && !accepted.length)) {
          throw new Error('SMTP accepteerde de ontvanger niet.');
        }
        sent.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          response: truncateText(normalizeString(info && info.response), 500),
          accepted,
          rejected,
        });
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: truncateText(normalizeString(error && error.message), 500),
        });
      }
    }

    if (!sent.length && failed.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure ? `Geen mails verzonden: ${firstFailure}` : 'Geen mails verzonden.');
      error.code = 'SMTP_SEND_FAILED';
      error.failedItems = failed;
      throw error;
    }

    const sentPersistableRowIds = new Set(
      sent
        .filter((item) => {
          const selected = selectedRows.find((selectedItem) => selectedItem.id === item.id);
          return !isTestRecipientRow(selected && selected.row, item.email);
        })
        .map((item) => item.id)
    );

    if (sentPersistableRowIds.size) {
      const actor = normalizeString(input.actor || 'Coldmailing');
      await recordColdmailSendGuardEntry({ senderEmail, count: sent.length, actor });
      const updatedRows = rows.map((row, index) =>
        sentPersistableRowIds.has(getRowId(row, index)) ? markRowAsMailed(row, actor, input.durationDays) : row
      );
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
    }

    return {
      ok: true,
      requested: count,
      selected: selectedRows.length,
      sent: sent.length,
      failed: failed.length,
      persisted: sentPersistableRowIds.size,
      safetyLimits: getColdmailSafetyLimits(),
      dailyQuota: {
        senderSentBefore: quota.senderSent,
        packageSentBefore: quota.packageSent,
        senderRemainingBefore: quota.senderRemaining,
        packageRemainingBefore: quota.packageRemaining,
      },
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
    if (!coldmailAutoReplyEnabled) {
      return {
        ok: true,
        skipped: true,
        reason: 'coldmail_autoreply_disabled',
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
              const match = findColdmailRowForInboundReply(parsedMail, rows);
              if (!match || !inboundText) {
                stats.ignored += 1;
                continue;
              }

              stats.matched += 1;
              const from = getParsedMailFromEmail(parsedMail);
              try {
                try {
                  const lifecycle = await persistColdmailReplyLifecycle({
                    values,
                    rows,
                    match,
                    parsedMail,
                    inboundText,
                    processedKey,
                    actor: 'Coldmailing',
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
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    getColdmailSafetyLimits,
    isImapMailConfigured,
    isSmtpMailConfigured,
    isLikelyValidEmail,
    getColdmailCampaignRecipients,
    getColdmailPreviewImage,
    getColdmailUnsubscribePreview,
    listColdmailReplyFollowUps,
    sendColdmailCampaign,
    syncInboundColdmailRepliesFromImap,
    unsubscribeColdmailRecipient,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
