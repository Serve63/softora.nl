const nodemailer = require('nodemailer');
const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

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
const COLDMAIL_OPT_OUT_TEXT =
  'Geen interesse? Reageer met "stop" of "afmelden", dan mailen we u niet meer.';
const TEST_RECIPIENT_EMAILS = new Set(['servec321@gmail.com']);
const TEST_RECIPIENT_COMPANIES = new Set(['mcv e-commerce']);
const SENDER_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn',
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

  function normalizeEmailAddress(value) {
    return normalizeString(value).toLowerCase();
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

  function normalizeDatabaseStatus(value, row = {}) {
    const raw = normalizeString(value).toLowerCase();
    if (raw === 'interested' || raw === 'geinteresseerd' || raw === 'geïnteresseerd') {
      return 'interesse';
    }
    if (raw === 'no_deal' || raw === 'geendeal' || raw === 'lost') return 'afgehaakt';
    if (raw === 'betaald') return 'klant';
    if (raw === 'open') return 'benaderbaar';
    if (normalizeString(row.actief).toLowerCase() === 'nee') return 'buiten';
    return raw || 'prospect';
  }

  function getChunkMetaKey(baseKey) {
    return `${normalizeString(baseKey)}_chunks_v1`;
  }

  function getChunkPrefix(baseKey) {
    return `${normalizeString(baseKey)}_chunk_`;
  }

  function readChunkedStateValue(values, baseKey) {
    const stateValues = values && typeof values === 'object' ? values : {};
    const normalizedKey = normalizeString(baseKey);
    const fallback = typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : '';
    const metaRaw = normalizeString(stateValues[getChunkMetaKey(normalizedKey)]);
    if (!metaRaw) return fallback;
    try {
      const meta = JSON.parse(metaRaw);
      const count = Math.max(0, Math.min(100, Number(meta && meta.count) || 0));
      if (!count) return fallback;
      const prefix = getChunkPrefix(normalizedKey);
      const chunks = [];
      for (let index = 0; index < count; index += 1) {
        const chunk = stateValues[prefix + index];
        if (typeof chunk !== 'string') return fallback;
        chunks.push(chunk);
      }
      return chunks.join('') || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function buildChunkedStateValues(baseKey, rawValue, chunkSize) {
    const normalizedKey = normalizeString(baseKey);
    const serialized = String(rawValue || '');
    const safeChunkSize = Math.max(10000, Math.min(180000, Number(chunkSize) || 120000));
    const chunks = [];
    for (let index = 0; index < serialized.length; index += safeChunkSize) {
      chunks.push(serialized.slice(index, index + safeChunkSize));
    }
    if (!chunks.length) chunks.push('');
    const values = {
      [normalizedKey]: serialized.length <= safeChunkSize ? serialized : '',
      [getChunkMetaKey(normalizedKey)]: JSON.stringify({
        count: chunks.length,
        updatedAt: new Date().toISOString(),
      }),
    };
    const prefix = getChunkPrefix(normalizedKey);
    chunks.forEach((chunk, index) => {
      values[prefix + index] = chunk;
    });
    return values;
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

  function parseLeadDatabaseRows(values = {}) {
    const raw = normalizeString(readChunkedStateValue(values, leadDbKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((row) => row && typeof row === 'object')
        .map((row, index) => ({
          ...row,
          id: normalizeString(row.id || row.leadId || '') || `lead-${index}`,
          bedrijf: normalizeString(row.company || row.name || row.bedrijf || row.naam || '') || `Lead ${index + 1}`,
          naam: normalizeString(row.contactPerson || row.contact || row.naam || ''),
          phone: normalizeString(
            row.phone ||
              row.phoneE164 ||
              row.tel ||
              row.telefoon ||
              row.telefoonnummer ||
              row.telefoonNummer ||
              row.mobile ||
              row.mobiel ||
              row.phoneNumber ||
              row.contactPhone ||
              ''
          ),
          branche: normalizeString(row.branche || row.branch || ''),
          region: normalizeString(row.region || row.regio || row.province || row.provincie || row.city || row.stad || row.plaats || ''),
          regio: normalizeString(row.regio || row.region || row.province || row.provincie || row.city || row.stad || row.plaats || ''),
          province: normalizeString(row.province || row.provincie || ''),
          stad: normalizeString(row.stad || row.city || row.plaats || row.gemeente || ''),
          plaats: normalizeString(row.plaats || row.city || row.stad || row.gemeente || ''),
          city: normalizeString(row.city || row.stad || row.plaats || row.gemeente || ''),
          gemeente: normalizeString(row.gemeente || row.city || row.stad || row.plaats || ''),
          address: normalizeString(row.address || row.adres || row.formattedAddress || row.fullAddress || row.location || ''),
          adres: normalizeString(row.adres || row.address || row.formattedAddress || row.fullAddress || row.location || ''),
          location: normalizeString(row.location || row.formattedAddress || row.fullAddress || row.address || row.adres || ''),
          formattedAddress: normalizeString(row.formattedAddress || row.fullAddress || row.location || row.address || row.adres || ''),
          fullAddress: normalizeString(row.fullAddress || row.formattedAddress || row.location || row.address || row.adres || ''),
          website: normalizeString(row.website || ''),
          call: row.call,
          canCall: row.canCall,
          doNotCall: row.doNotCall,
          status: normalizeString(row.status || row.databaseStatus || ''),
          databaseStatus: normalizeString(row.databaseStatus || row.status || ''),
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

  function formatMailFromHeader(senderEmail) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const name = normalizeString(SENDER_DISPLAY_NAMES[address] || mailFromName || 'Softora');
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
  const campaignPlaceCoordEntries = [
    ['oisterwijk', 51.5792, 5.1889],
    ['moergestel', 51.5456, 5.1778],
    ['berkel-enschot', 51.6026, 5.1461],
    ['udenhout', 51.6098, 5.1436],
    ['haaren', 51.6027, 5.2222],
    ['tilburg', 51.5555, 5.0913],
    ['goirle', 51.5206, 5.0667],
    ['hilvarenbeek', 51.4858, 5.1397],
    ['diessen', 51.475, 5.175],
    ['middelbeers', 51.517, 5.095],
    ['vught', 51.6533, 5.2875],
    ['boxtel', 51.5908, 5.3293],
    ['schijndel', 51.6225, 5.4319],
    ['sint-michielsgestel', 51.6417, 5.3519],
    ['sint-oedenrode', 51.5675, 5.4597],
    ['liempde', 51.568, 5.375],
    ['best', 51.5075, 5.3903],
    ['oirschot', 51.505, 5.3139],
    ['eindhoven', 51.4416, 5.4697],
    ['nuenen', 51.473, 5.551],
    ['geldrop', 51.4217, 5.5578],
    ['son-en-breugel', 51.513, 5.494],
    ['veldhoven', 51.418, 5.4024],
    ['waalre', 51.3867, 5.4447],
    ['helmond', 51.4793, 5.657],
    ['deurne', 51.456, 5.79],
    ['gemert', 51.555, 5.698],
    ['veghel', 51.6167, 5.5486],
    ['zeeland', 51.697, 5.676],
    ['mill', 51.685, 5.78],
    ['cuijk', 51.727, 5.879],
    ['grave', 51.759, 5.741],
    ['nijmegen', 51.8426, 5.8598],
    ['oss', 51.765, 5.5181],
    ['uden', 51.6608, 5.6194],
    ['den bosch', 51.6978, 5.3037],
    ['den-bosch', 51.6978, 5.3037],
    ['s hertogenbosch', 51.6978, 5.3037],
    ['s-hertogenbosch', 51.6978, 5.3037],
    ["'s-hertogenbosch", 51.6978, 5.3037],
    ['rosmalen', 51.7167, 5.3681],
    ['waalwijk', 51.6828, 5.0707],
    ['drunen', 51.686, 5.059],
    ['kaatsheuvel', 51.6598, 5.0304],
    ['loon-op-zand', 51.6278, 5.0753],
    ['sprang-capelle', 51.671, 5.049],
    ['dongen', 51.6265, 4.9383],
    ['gilze', 51.5447, 4.9403],
    ['rijen', 51.5881, 4.9267],
    ['bavel', 51.555, 4.865],
    ['alphen', 51.483, 4.956],
    ['chaam', 51.505, 4.861],
    ['baarle-nassau', 51.445, 4.929],
    ['oosterhout', 51.6439, 4.8601],
    ['breda', 51.5719, 4.7683],
    ['etten-leur', 51.5706, 4.6373],
    ['rucphen', 51.532, 4.558],
    ['roosendaal', 51.5308, 4.4653],
    ['bergen op zoom', 51.4946, 4.2872],
    ['bergen-op-zoom', 51.4946, 4.2872],
    ['steenbergen', 51.585, 4.317],
    ['zevenbergen', 51.645, 4.606],
    ['almkerk', 51.7714, 4.9597],
    ['werkendam', 51.8101, 4.8944],
    ['sleeuwijk', 51.815, 4.952],
    ['gorinchem', 51.833, 4.974],
    ['zaltbommel', 51.81, 5.244],
    ['tiel', 51.886, 5.429],
    ['bladel', 51.368, 5.208],
    ['reusel', 51.36, 5.165],
    ['eersel', 51.357, 5.318],
    ['valkenswaard', 51.3513, 5.4595],
    ['leende', 51.35, 5.553],
    ['someren', 51.386, 5.711],
    ['asten', 51.404, 5.748],
    ['weert', 51.2517, 5.7067],
    ['roermond', 51.194, 6.002],
    ['venlo', 51.3703, 6.1724],
    ['venray', 51.525, 5.975],
    ['turnhout', 51.3225, 4.9447],
    ['geel', 51.161, 4.99],
    ['mol', 51.191, 5.115],
    ['hamont-achel', 51.251, 5.545],
    ['maastricht', 50.8514, 5.691],
    ['heerlen', 50.8837, 5.981],
    ['utrecht', 52.0907, 5.1214],
    ['amsterdam', 52.3676, 4.9041],
    ['rotterdam', 51.9244, 4.4777],
    ['den haag', 52.0705, 4.3007],
    ['den-haag', 52.0705, 4.3007],
    ['dordrecht', 51.8133, 4.6901],
  ];
  const campaignPlaceCoords = campaignPlaceCoordEntries.reduce((coords, entry) => {
    const [name, lat, lng] = entry;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return coords;
    coords[normalizePlaceKey(name)] = { lat, lng };
    return coords;
  }, Object.create(null));

  function normalizePlaceKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b[1-9][0-9]{3}\s?[a-z]{2}\b/gi, ' ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function coordsForPlaceHint(value) {
    const normalized = normalizePlaceKey(value);
    if (!normalized) return null;
    if (campaignPlaceCoords[normalized]) return campaignPlaceCoords[normalized];
    const placeKey = Object.keys(campaignPlaceCoords)
      .sort((left, right) => right.length - left.length)
      .find((key) => new RegExp(`(^| )${escapeRegExp(key)}($| )`).test(normalized));
    return placeKey ? campaignPlaceCoords[placeKey] : null;
  }

  function collectRowLocationHints(row) {
    const source = row && typeof row === 'object' ? row : {};
    const values = [
      source.stad,
      source.plaats,
      source.city,
      source.gemeente,
      source.regio,
      source.region,
      source.province,
      source.adres,
      source.address,
      source.location,
      source.formattedAddress,
      source.fullAddress,
    ];
    const hints = [];
    values.filter(Boolean).forEach((value) => {
      const text = normalizeString(value).replace(/\s+/g, ' ').trim();
      if (!text) return;
      hints.push(text);
      text.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => hints.push(part));
      const postalTail = text.match(/\b[1-9][0-9]{3}\s?[A-Z]{2}\s+([^,]+)/i);
      if (postalTail && postalTail[1]) hints.push(postalTail[1]);
    });
    return hints;
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
    const hints = collectRowLocationHints(row);
    for (const hint of hints) {
      const coords = coordsForPlaceHint(hint);
      if (coords) return coords;
    }
    return null;
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
    if (!normalizeString(radiusKm)) return true;
    const radius = parseRadiusKm(radiusKm);
    const distanceKm = getRowDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return false;
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
    const candidateRows = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) =>
        mode === 'call'
          ? isEligibleColdcallingRow(row, input.branch, input.radiusKm, blockedPhoneKeys)
          : isEligibleColdmailRow(row, input.branch, input.radiusKm)
      )
      .slice(0, count);
    const selectedRows = [];
    const failed = [];

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
    return `${html}\n<p style="margin:24px 0 0 0;"><img src="cid:${escapeHtml(attachment.cid)}" alt="${escapeHtml(
      attachment.alt || 'Webdesign'
    )}" style="display:block;max-width:100%;height:auto;border:0;border-radius:12px;" /></p>${optOutHtml}`;
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
    const transporter = getSmtpTransporter();
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const from = getParsedMailFromEmail(parsedMail);
    const messageId = normalizeString(parsedMail && parsedMail.messageId);
    const references = collectMessageReferenceHeader(parsedMail);
    return transporter.sendMail({
      from: formatMailFromHeader(senderEmail),
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
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key];
      if (!item || typeof item !== 'object' || parseDataUrlImage(item.websitePhoto)) return;
      const photoKey = normalizeString(item.photoKey);
      const chunkCount = Math.max(0, Math.min(80, Number(item.chunkCount || 0) || 0));
      if (!photoKey || !chunkCount) return;
      const dataUrl = Array.from({ length: chunkCount }, (_, index) => normalizeString(stateValues[`${photoKey}_${index}`])).join('');
      if (parseDataUrlImage(dataUrl)) item.websitePhoto = dataUrl;
    });
    return parsed;
  }

  async function loadCustomerPhotoMap() {
    const state = await getUiStateValues(customerPhotoScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values);
  }

  function resolveRowWebdesignPhoto(row, photoMap) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const direct = photos[getRowId(row, 0)];
    const identityKey = buildRowIdentityKey(row);
    const identity = Object.keys(photos)
      .map((key) => photos[key])
      .find((item) => normalizeString(item && item.identityKey) === identityKey);
    const photo = direct || identity || null;
    const parsed = parseDataUrlImage(photo && photo.websitePhoto);
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
    const count = resolvedRecipients.count;
    const values = resolvedRecipients.values;
    const rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;

    if (!candidateRows.length) {
      const error = new Error('Geen geschikte e-mailadressen gevonden in de database.');
      error.code = 'NO_RECIPIENTS';
      throw error;
    }

    let selectedRows = resolvedRecipients.selectedRows;
    const failed = resolvedRecipients.failed;
    const quota = await getColdmailSendQuota(senderEmail);
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
    const shouldIncludeWebdesignPhoto = isWebdesignSpecialAction(input.specialAction);
    const customerPhotoMap = shouldIncludeWebdesignPhoto ? await loadCustomerPhotoMap() : {};

    if (!selectedRows.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geldige e-maildomeinen gevonden in de database.');
      error.code = 'NO_VALID_RECIPIENT_DOMAINS';
      error.failedItems = failed;
      throw error;
    }

    const transporter = getSmtpTransporter();
    const sent = [];

    for (const item of selectedRows) {
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
        const info = await transporter.sendMail({
          from: formatMailFromHeader(senderEmail),
          to,
          replyTo: mailReplyTo || mailFromAddress || undefined,
          subject,
          text,
          html,
          attachments,
        });
        sent.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          response: truncateText(normalizeString(info && info.response), 500),
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
          ...buildChunkedStateValues(customerDbKey, JSON.stringify(updatedRows)),
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
        errors: [],
      };
      const dbState = await getUiStateValues(customerDbScope);
      const values = dbState && typeof dbState.values === 'object' ? dbState.values : {};
      const rows = parseDatabaseRows(values);
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
    sendColdmailCampaign,
    syncInboundColdmailRepliesFromImap,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
