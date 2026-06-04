const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const {
  buildChunkedStatePatch,
  readChunkedStateValue,
} = require('./data-ops-serialization');
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');
const {
  getPreviewImageCacheKey,
  rememberPreviewImage,
} = require('./coldmail-preview-image-cache');

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_COLDMAILING_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const DEFAULT_COLDMAILING_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
const DEFAULT_COLDMAIL_AUTOPILOT_SCOPE = 'premium_coldmail_autopilot';
const DEFAULT_COLDMAIL_AUTOPILOT_KEY = 'softora_coldmail_autopilot_v1';
const DEFAULT_COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const DEFAULT_COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const DEFAULT_API_BASE_URL = 'https://api.instantly.ai/api/v2';
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const DEFAULT_SYNC_BATCH_SIZE = 10;
const DEFAULT_MANUAL_UPLOAD_LIMIT = 100;
const MAX_MANUAL_UPLOAD_LIMIT = 250;
const DEFAULT_DAILY_CAP = 25;
const DEFAULT_REMOTE_CAMPAIGN_LEAD_RECONCILE_LIMIT = 1000;
const DEFAULT_DAILY_CAP_TIME_ZONE = 'Europe/Amsterdam';
const DEFAULT_PUBLIC_BASE_URL = 'https://www.softora.nl';
const DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL = 'https://www.softora.nl';
const DEFAULT_PREVIEW_IMAGE_BASE_URL = 'https://www.softora.nl';
const DEFAULT_COLDMAIL_LINK_SECRET = 'softora-coldmail';
const DEFAULT_COLDMAIL_PREVIEW_IMAGE_SECRET = 'softora-coldmail-preview-image-v2';
const COLDMAIL_UNSUBSCRIBE_PATH = '/afmelden';
const COLDMAIL_PREVIEW_IMAGE_PATH = '/coldmailing/webdesign-foto';
const COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_OPT_OUT_TEXT_PREFIX = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_MOCKUP_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';
const COLDMAIL_IMAGE_VISIBILITY_PS = 'PS: Wordt het webdesign niet zichtbaar?\nOpen het via hier 👈';
const COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN =
  /PS:\s*(?:als het webdesign niet zichtbaar is,\s*klik op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in het scherm\.?|zie je het webdesign niet\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm\s*😊?|wordt het webdesign niet zichtbaar\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm,?\s*of open het via deze link:\s*(?:https?:\/\/[^\s]+\/)?webdesign\/[a-z0-9-]+(?:\s*👈)?|wordt het webdesign niet zichtbaar\?\s*open het via hier\s*👈?)/i;
const INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE = 'instantly-safe-manual-upload';
const INSTANTLY_SAFE_MANUAL_UPLOAD_LABEL = 'Veilige Instantly upload voorbereid';
const COLDMAIL_EMAIL_IMAGE_WIDTH = 640;
const INSTANTLY_EMAIL_CONTENT_MAX_WIDTH = 580;
const INSTANTLY_WEBDESIGN_PREVIEW_CTA_PATTERN = /je\s+kunt\s+je\s+webdesign\s+hier\s+bekijken\s*👈?/i;
const INSTANTLY_WEBDESIGN_PLACEHOLDER_WIDTH = 1024;
const INSTANTLY_WEBDESIGN_PLACEHOLDER_HEIGHT = 1536;
const INSTANTLY_MOCKUP_PLACEHOLDER_WIDTH = 1600;
const INSTANTLY_MOCKUP_PLACEHOLDER_HEIGHT = 1000;
const COLDMAIL_PREVIEW_IMAGE_OPTIMIZE_MIN_BYTES = 128 * 1024;
const COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH = 720;
const COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY = 82;
const COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT = 800;
const COLDMAIL_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 9000;
const INSTANTLY_PUBLIC_IMAGE_PREWARM_TIMEOUT_MS = 30_000;
const INSTANTLY_WEBDESIGN_FRAME_CROP_MIN_SIZE = 80;
const INSTANTLY_WEBDESIGN_FRAME_CROP_MAX_MARGIN_RATIO = 0.12;
const INSTANTLY_WEBDESIGN_FRAME_CROP_THRESHOLD = 12;
const INSTANTLY_WEBDESIGN_FRAME_CORNER_TOLERANCE = 32;
const INSTANTLY_WEBDESIGN_FRAME_EDGE_INSET_PX = 4;
const MARTIJN_LINKEDIN_CTA_PATTERN = /(?:💼\s*)?mijn\s+linkedin\s*👈?|linkedin\.com\/in\/martijn-van-de-ven/i;
const DEFAULT_WEBDESIGN_SUBJECT = 'Nieuw webdesign gemaakt!';
const DEFAULT_WEBDESIGN_BODY = [
  'Goedemorgen {{naam}},',
  '',
  'Ik ben benieuwd wat je ervan vindt.',
  '',
  'Met vriendelijke groeten:',
  'Servé Creusen',
  '',
  '📍 {{stad}}',
  '',
  '0629917185',
].join('\n');
const DEFAULT_INSTANTLY_WEBDESIGN_BODY = [
  'Beste lezer,',
  '',
  'Afgelopen week kwam ik jullie website ({{website}}) tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
  '',
  'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening :)',
  'Als je wilt, stuur ik je ook de online preview, zodat je zelf door het ontwerp kunt scrollen.',
  'Laat me vooral weten of je dat zou willen.',
  '',
  'Mocht je er niks mee willen doen, lijkt het me alsnog tof om te horen wat je van het design vindt en wat eventueel beter kan. Daar leer ik dan weer van!',
  '',
  'Je kunt je webdesign hier bekijken 👈',
  '',
  'Met vriendelijke groet,',
  '{{afzender}}',
  '',
  '📍 {{stad}}',
].join('\n');
const DEFAULT_INSTANTLY_SENDER_EMAIL = 'serve@softora.nl';
const INSTANTLY_SENDER_PROFILE_ALIASES = Object.freeze({
  'serve@websoftora.com': ['serve@softora.nl', 'servec321@gmail.com'],
  'servecreusen@websoftora.com': ['serve@softora.nl', 'servec321@gmail.com'],
  'martijn@websoftora.com': ['martijn@softora.nl', 'martijnven123@gmail.com'],
  'martijnven@websoftora.com': ['martijn@softora.nl', 'martijnven123@gmail.com'],
  'martijnvandeven@websoftora.com': ['martijn@softora.nl', 'martijnven123@gmail.com'],
});
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
const PRIOR_COLDMAIL_HISTORY_PATTERN =
  /\b(gemaild|mail verstuurd|mail geopend|mailcontact|coldmail|cold mailing|open tracking|email sent|email opened|reply received|reactie ontvangen)\b/;
const INSTANTLY_HISTORY_PATTERN = /\b(instantly|instantly sync|instantly webhook|lead via instantly)\b/;
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
const REQUIRED_INSTANTLY_CUSTOM_VARIABLES = Object.freeze([
  'softora_customer_id',
  'softora_source',
  'softora_company',
  'softora_subject',
  'softora_mail_body',
  'softora_instantly_email_html',
  'softora_city',
  'softora_city_with_pin',
  'softora_website_domain',
  'softora_unsubscribe_url',
  'softora_webdesign_public_path',
  'softora_webdesign_public_url',
  'softora_mockup_caption',
  'softora_webdesign_ready',
]);
const INSTANTLY_SAFE_UPLOAD_CSV_HEADERS = Object.freeze([
  'email',
  'first_name',
  'last_name',
  'company_name',
  'company',
  'phone',
  'website',
  'personalization',
  'softora_customer_id',
  'softora_source',
  'softora_company',
  'softora_status',
  'softora_contact_name',
  'softora_city',
  'softora_city_with_pin',
  'softora_subject',
  'softora_mail_body',
  'softora_mail_body_with_optout',
  'softora_instantly_email_text',
  'softora_instantly_email_body',
  'softora_instantly_email_html',
  'softora_image_visibility_ps',
  'softora_reference',
  'softora_unsubscribe_url',
  'softora_webdesign_public_path',
  'softora_webdesign_public_url',
  'softora_webdesign_image_url',
  'softora_webdesign_mockup_url',
  'softora_webdesign_image_prewarmed',
  'softora_webdesign_mockup_prewarmed',
  'softora_mockup_caption',
  'softora_website_domain',
  'softora_webdesign_ready',
]);
let cachedInstantlyPreviewSharp = null;

function loadInstantlyPreviewSharp() {
  if (cachedInstantlyPreviewSharp) return cachedInstantlyPreviewSharp;
  try {
    cachedInstantlyPreviewSharp = require('sharp');
  } catch (_error) {
    cachedInstantlyPreviewSharp = null;
  }
  return cachedInstantlyPreviewSharp;
}

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
  if (typeof value === 'boolean') return value;
  const normalized = defaultNormalizeString(value);
  if (!normalized) return Boolean(fallback);
  return /^(1|true|yes)$/i.test(normalized);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(safe)));
}

function normalizePublicBaseUrl(value) {
  const raw = defaultNormalizeString(value).replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch (_) {
    return '';
  }
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

function getInstantlySenderProfileEmailCandidates(value, normalizeString = defaultNormalizeString) {
  const email = normalizeEmailAddress(value, normalizeString);
  if (!email) return [];
  return [email, ...(INSTANTLY_SENDER_PROFILE_ALIASES[email] || [])];
}

function getInstantlySenderProfileEmailCandidateList(values = [], normalizeString = defaultNormalizeString) {
  const seen = new Set();
  const candidates = [];
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    getInstantlySenderProfileEmailCandidates(value, normalizeString).forEach((candidate) => {
      if (!candidate || seen.has(candidate)) return;
      seen.add(candidate);
      candidates.push(candidate);
    });
  });
  return candidates;
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

function normalizeColdmailGuardKeyPart(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/g, '')
    .replace(/[^a-z0-9@._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function escapeCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safeJsonObjectParse(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
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

function slugifyWebdesignCompany(value, fallback = 'uw-bedrijf', normalizeString = defaultNormalizeString) {
  const slug = normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

function buildPublicWebdesignPreviewPath(row, id, normalizeString = defaultNormalizeString) {
  const slug = slugifyWebdesignCompany(
    getRowCompany(row, normalizeString),
    slugifyWebdesignCompany(id, 'uw-bedrijf', normalizeString),
    normalizeString
  );
  return `/webdesign/${slug}`;
}

function buildPublicWebdesignPreviewUrl(row, id, config, normalizeString = defaultNormalizeString) {
  const baseUrl = normalizePublicBaseUrl(config && config.webdesignPublicBaseUrl) || DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL;
  try {
    return new URL(buildPublicWebdesignPreviewPath(row, id, normalizeString), baseUrl).toString();
  } catch (_error) {
    return `${baseUrl}${buildPublicWebdesignPreviewPath(row, id, normalizeString)}`;
  }
}

function buildImageVisibilityPs(row, id, config, normalizeString = defaultNormalizeString) {
  return COLDMAIL_IMAGE_VISIBILITY_PS;
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
        row.telefoonNummer ||
        row.telefoon_nummer ||
        row.mobile ||
        row.mobilePhone ||
        row.mobiel ||
        row.phoneNumber ||
        row.contactPhone ||
        row.contact_phone ||
        '')
  );
}

function getRowWebsite(row, normalizeString = defaultNormalizeString) {
  return normalizeString(
    row &&
      (row.website ||
        row.domain ||
        row.dom ||
        row.websiteUrl ||
        row.website_url ||
        row.url ||
        row.site ||
        row.domein ||
        '')
  );
}

function getExplicitRowId(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.id || row.customerId || row.databaseId || ''));
}

function cleanPlaceLabel(value, normalizeString = defaultNormalizeString) {
  const dutchProvinceSuffix =
    '(?:N\\.?\\s?Br\\.?|N\\.?B\\.?|Noord[-\\s]?Brabant|Z\\.?H\\.?|Zuid[-\\s]?Holland|N\\.?H\\.?|Noord[-\\s]?Holland|Gld\\.?|Gelderland|Lb\\.?|Limburg|Ov\\.?|Overijssel|Dr\\.?|Drenthe|Fr\\.?|Friesland|Gr\\.?|Groningen|Fl\\.?|Flevoland|Ze\\.?|Zeeland|Ut\\.?|Utrecht)';
  return normalizeString(value)
    .replace(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g, '')
    .replace(new RegExp(`\\s*\\(${dutchProvinceSuffix}\\)\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s+${dutchProvinceSuffix}\\s*$`, 'i'), '')
    .replace(/\b(Nederland|The Netherlands)\b/gi, '')
    .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeStreetAddress(value, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value).toLowerCase();
  return (
    /\d/.test(text) &&
    /(straat|weg|laan|plein|pad|dijk|hof|kade|markt|singel|steeg|gracht|boulevard|baan|akker|plantsoen|park)\b/.test(text)
  );
}

function extractPlaceFromAddress(value, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (!text) return '';
  const postalMatch = text.match(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b\s+([A-Za-zÀ-ÿ'’.\- ]{2,})$/);
  if (postalMatch) return cleanPlaceLabel(postalMatch[1], normalizeString);
  const parts = text.split(/[,\n;|]/).map((part) => cleanPlaceLabel(part, normalizeString)).filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const candidate = parts[index];
    if (!candidate || looksLikeStreetAddress(candidate, normalizeString) || /^\d+$/.test(candidate)) continue;
    return candidate;
  }
  return cleanPlaceLabel(text, normalizeString);
}

function getRowCity(row, normalizeString = defaultNormalizeString) {
  const explicit = [
    row && row.plaats,
    row && row.city,
    row && row.gemeente,
    row && row.locality,
    row && row.town,
    row && row.village,
  ]
    .map((value) => {
      const cleaned = cleanPlaceLabel(value, normalizeString);
      if (!cleaned) return '';
      return looksLikeStreetAddress(cleaned, normalizeString)
        ? extractPlaceFromAddress(cleaned, normalizeString)
        : cleaned;
    })
    .find(Boolean);
  if (explicit) return explicit;

  return (
    [
      row && row.stad,
      row && row.adres,
      row && row.address,
      row && row.location,
    ]
      .map((value) => extractPlaceFromAddress(value, normalizeString))
      .find(Boolean) || ''
  );
}

function normalizeWebsiteVariableValue(value, normalizeString = defaultNormalizeString) {
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

function getRowDomain(row, normalizeString = defaultNormalizeString) {
  return normalizeWebsiteVariableValue(
    row && (row.dom || row.domain || row.website || row.websiteUrl || row.website_url || row.url || row.site || row.domein || ''),
    normalizeString
  );
}

function normalizePhoneDigits(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value).replace(/[^\d]/g, '');
}

function getComparablePhoneKeys(value, normalizeString = defaultNormalizeString) {
  const digits = normalizePhoneDigits(value, normalizeString);
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

function normalizeIdentityTextPart(value, normalizeString = defaultNormalizeString) {
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

function buildNormalizedIdentityKey(company, contact, phone, normalizeString = defaultNormalizeString) {
  const normalizedCompany = normalizeIdentityTextPart(company, normalizeString);
  const normalizedContact = normalizeIdentityTextPart(contact, normalizeString);
  const normalizedPhone = normalizePhoneDigits(phone, normalizeString) || normalizeIdentityTextPart(phone, normalizeString);
  if (!normalizedCompany && !normalizedContact && !normalizedPhone) return '';
  return [normalizedCompany, normalizedContact, normalizedPhone].join('|');
}

function buildNormalizedIdentityKeys(company, contact, phone, normalizeString = defaultNormalizeString) {
  const phoneKeys = Array.from(getComparablePhoneKeys(phone, normalizeString));
  const normalizedFallbackPhone = normalizePhoneDigits(phone, normalizeString) || normalizeIdentityTextPart(phone, normalizeString);
  if (!phoneKeys.length && normalizedFallbackPhone) phoneKeys.push(normalizedFallbackPhone);
  const keys = phoneKeys.length
    ? phoneKeys.map((phoneKey) => buildNormalizedIdentityKey(company, contact, phoneKey, normalizeString))
    : [buildNormalizedIdentityKey(company, contact, '', normalizeString)];
  return new Set(keys.filter(Boolean));
}

function normalizeStoredIdentityKeys(value, normalizeString = defaultNormalizeString) {
  if (value === undefined || value === null) return new Set();
  const raw = normalizeString(value);
  if (!raw || raw === 'undefined' || raw === 'null') return new Set();
  const parts = raw.split('|');
  if (parts.length >= 3) {
    return buildNormalizedIdentityKeys(parts[0], parts[1], parts.slice(2).join('|'), normalizeString);
  }
  return new Set([normalizeIdentityTextPart(raw, normalizeString)].filter(Boolean));
}

function getExplicitRowContact(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.naam || row.contact || row.contactName || row.clientName));
}

function buildRowIdentityKeys(row, normalizeString = defaultNormalizeString) {
  const company = getRowCompany(row, normalizeString);
  const explicitContact = getExplicitRowContact(row, normalizeString);
  const fallbackContact = getRowContact(row, normalizeString) || company;
  const phone = getRowPhone(row, normalizeString);
  const keys = new Set();
  [
    [company, fallbackContact, phone],
    [company, explicitContact, phone],
    [company, company, phone],
  ].forEach(([companyPart, contactPart, phonePart]) => {
    buildNormalizedIdentityKeys(companyPart, contactPart, phonePart, normalizeString).forEach((key) => keys.add(key));
  });
  return keys;
}

function buildRowIdentityKey(row, normalizeString = defaultNormalizeString) {
  return Array.from(buildRowIdentityKeys(row, normalizeString))[0] || '';
}

function getPhotoIdentityKeys(photo, normalizeString = defaultNormalizeString) {
  const keys = new Set();
  normalizeStoredIdentityKeys(photo && photo.identityKey, normalizeString).forEach((key) => keys.add(key));
  normalizeStoredIdentityKeys(photo && photo.legacyMeta && photo.legacyMeta.identityKey, normalizeString).forEach((key) => keys.add(key));
  return keys;
}

function photoRecordMatchesRowIdentity(photo, row, normalizeString = defaultNormalizeString) {
  const photoIdentityKeys = getPhotoIdentityKeys(photo, normalizeString);
  if (!photoIdentityKeys.size) return true;
  const rowIdentityKeys = buildRowIdentityKeys(row, normalizeString);
  return Array.from(rowIdentityKeys).some((key) => photoIdentityKeys.has(key));
}

function parseImageDataUrl(value, normalizeString = defaultNormalizeString) {
  const match = normalizeString(value).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const content = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!content.length) return null;
  return {
    content,
    contentType: match[1].toLowerCase(),
  };
}

function parseDataUrlImage(value, normalizeString = defaultNormalizeString) {
  return Boolean(parseImageDataUrl(value, normalizeString));
}

async function defaultFetchImageWithTimeout(url, timeoutMs = COLDMAIL_PREVIEW_IMAGE_FETCH_TIMEOUT_MS) {
  const cleanUrl = defaultNormalizeString(url);
  if (!/^https:\/\//i.test(cleanUrl) || typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || COLDMAIL_PREVIEW_IMAGE_FETCH_TIMEOUT_MS)) : null;
  try {
    const response = await fetch(cleanUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) return null;
    const contentType = defaultNormalizeString(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) return null;
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > 10 * 1024 * 1024) return null;
    return { content, contentType };
  } catch (_error) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultFetchPublicPreviewImageWithTimeout(url, timeoutMs = INSTANTLY_PUBLIC_IMAGE_PREWARM_TIMEOUT_MS) {
  const cleanUrl = defaultNormalizeString(url);
  if (!/^https:\/\//i.test(cleanUrl) || typeof fetch !== 'function') return { ok: false, reason: 'invalid_url' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || INSTANTLY_PUBLIC_IMAGE_PREWARM_TIMEOUT_MS)) : null;
  try {
    const response = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
      signal: controller ? controller.signal : undefined,
    });
    if (!response || !response.ok) {
      return { ok: false, status: response ? response.status : 0 };
    }
    const contentType = defaultNormalizeString(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) {
      return { ok: false, status: response.status, contentType };
    }
    const content = Buffer.from(await response.arrayBuffer());
    return { ok: content.length > 0, status: response.status, contentType, bytes: content.length };
  } catch (error) {
    return {
      ok: false,
      reason: error && error.name === 'AbortError' ? 'timeout' : 'fetch_failed',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveInstantlyPreviewImageSource(source, normalizeString = defaultNormalizeString, fetchImageWithTimeout = defaultFetchImageWithTimeout) {
  const parsed = parseImageDataUrl(source, normalizeString);
  if (parsed) return parsed;
  const cleanSource = normalizeString(source);
  if (!/^https:\/\//i.test(cleanSource) || typeof fetchImageWithTimeout !== 'function') return null;
  return fetchImageWithTimeout(cleanSource, COLDMAIL_PREVIEW_IMAGE_FETCH_TIMEOUT_MS);
}

function readPngDimensions(content) {
  if (
    !Buffer.isBuffer(content) ||
    content.length < 24 ||
    content[0] !== 0x89 ||
    content[1] !== 0x50 ||
    content[2] !== 0x4e ||
    content[3] !== 0x47
  ) {
    return null;
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(content) {
  if (!Buffer.isBuffer(content) || content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < content.length) {
    if (content[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = content[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = content.readUInt16BE(offset + 2);
    if (!Number.isFinite(length) || length < 2 || offset + 2 + length > content.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = content.readUInt16BE(offset + 5);
      const width = content.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function getImageDimensions(image) {
  const contentType = defaultNormalizeString(image && image.contentType).split(';')[0].toLowerCase();
  const content = image && image.content;
  if (!Buffer.isBuffer(content)) return null;
  if (contentType === 'image/png') return readPngDimensions(content);
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return readJpegDimensions(content);
  return null;
}

function getPixelColor(data, info, x, y) {
  const channels = Number(info && info.channels) || 0;
  const width = Number(info && info.width) || 0;
  if (!Buffer.isBuffer(data) || channels < 3 || width <= 0) return null;
  const offset = (y * width + x) * channels;
  if (offset < 0 || offset + 2 >= data.length) return null;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
  };
}

function colorDistance(a, b) {
  if (!a || !b) return Infinity;
  const red = Number(a.r) - Number(b.r);
  const green = Number(a.g) - Number(b.g);
  const blue = Number(a.b) - Number(b.b);
  return Math.sqrt(red * red + green * green + blue * blue);
}

function averageColors(colors) {
  const valid = colors.filter(Boolean);
  if (!valid.length) return null;
  const totals = valid.reduce(
    (next, color) => ({
      r: next.r + Number(color.r || 0),
      g: next.g + Number(color.g || 0),
      b: next.b + Number(color.b || 0),
    }),
    { r: 0, g: 0, b: 0 }
  );
  return {
    r: totals.r / valid.length,
    g: totals.g / valid.length,
    b: totals.b / valid.length,
  };
}

function averageCornerColor(data, info, startX, startY, sampleSize) {
  const colors = [];
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  for (let y = startY; y < Math.min(height, startY + sampleSize); y += 1) {
    for (let x = startX; x < Math.min(width, startX + sampleSize); x += 1) {
      colors.push(getPixelColor(data, info, x, y));
    }
  }
  return averageColors(colors);
}

function getUniformCornerBackground(data, info) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  const sampleSize = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) * 0.03)));
  const corners = [
    averageCornerColor(data, info, 0, 0, sampleSize),
    averageCornerColor(data, info, Math.max(0, width - sampleSize), 0, sampleSize),
    averageCornerColor(data, info, 0, Math.max(0, height - sampleSize), sampleSize),
    averageCornerColor(data, info, Math.max(0, width - sampleSize), Math.max(0, height - sampleSize), sampleSize),
  ].filter(Boolean);
  if (corners.length < 4) return null;
  const background = averageColors(corners);
  const cornersMatch = corners.every(
    (corner) => colorDistance(corner, background) <= INSTANTLY_WEBDESIGN_FRAME_CORNER_TOLERANCE
  );
  return cornersMatch ? background : null;
}

function findNonBackgroundBounds(data, info, background) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = getPixelColor(data, info, x, y);
      if (colorDistance(color, background) <= INSTANTLY_WEBDESIGN_FRAME_CROP_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function getSafeDecorativeFrameCrop(bounds, width, height) {
  if (!bounds || width <= 0 || height <= 0) return null;
  const left = Math.max(0, Number(bounds.left) || 0);
  const top = Math.max(0, Number(bounds.top) || 0);
  const rightMargin = Math.max(0, width - 1 - (Number(bounds.right) || 0));
  const bottomMargin = Math.max(0, height - 1 - (Number(bounds.bottom) || 0));
  const maxXMargin = Math.floor(width * INSTANTLY_WEBDESIGN_FRAME_CROP_MAX_MARGIN_RATIO);
  const maxYMargin = Math.floor(height * INSTANTLY_WEBDESIGN_FRAME_CROP_MAX_MARGIN_RATIO);
  if (left < 2 && top < 2 && rightMargin < 2 && bottomMargin < 2) return null;
  if (left > maxXMargin || rightMargin > maxXMargin || top > maxYMargin || bottomMargin > maxYMargin) {
    return null;
  }
  const cropWidth = width - left - rightMargin;
  const cropHeight = height - top - bottomMargin;
  if (cropWidth < width * 0.6 || cropHeight < height * 0.6) return null;
  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

function insetCrop(crop, imageWidth, imageHeight) {
  const inset = imageWidth >= 320 && imageHeight >= 240 ? INSTANTLY_WEBDESIGN_FRAME_EDGE_INSET_PX : 0;
  const base = crop || { left: 0, top: 0, width: imageWidth, height: imageHeight };
  if (!inset) return base;
  const left = Math.min(imageWidth - 1, Math.max(0, base.left + inset));
  const top = Math.min(imageHeight - 1, Math.max(0, base.top + inset));
  const right = Math.min(imageWidth, Math.max(left + 1, base.left + base.width - inset));
  const bottom = Math.min(imageHeight, Math.max(top + 1, base.top + base.height - inset));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function removeDecorativeWebdesignFrameForInstantly(image) {
  const contentType = defaultNormalizeString(image && image.contentType).split(';')[0].toLowerCase();
  const content = image && image.content;
  if (!Buffer.isBuffer(content) || !/^image\/(?:png|jpe?g|webp)$/i.test(contentType)) return image;
  try {
    const sharp = loadInstantlyPreviewSharp();
    if (typeof sharp !== 'function') return image;
    const raster = await sharp(content, { limitInputPixels: 45_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = Number(raster && raster.info && raster.info.width) || 0;
    const height = Number(raster && raster.info && raster.info.height) || 0;
    if (
      width < INSTANTLY_WEBDESIGN_FRAME_CROP_MIN_SIZE ||
      height < INSTANTLY_WEBDESIGN_FRAME_CROP_MIN_SIZE
    ) {
      return image;
    }
    const background = getUniformCornerBackground(raster.data, raster.info);
    const bounds = background ? findNonBackgroundBounds(raster.data, raster.info, background) : null;
    const crop = insetCrop(getSafeDecorativeFrameCrop(bounds, width, height), width, height);
    if (
      crop.left === 0 &&
      crop.top === 0 &&
      crop.width === width &&
      crop.height === height
    ) {
      return image;
    }
    const cropped = await sharp(content, { limitInputPixels: 45_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .extract(crop)
      .jpeg({
        quality: COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    if (!Buffer.isBuffer(cropped) || !cropped.length) return image;
    return {
      ...image,
      content: cropped,
      contentType: 'image/jpeg',
    };
  } catch (_error) {
    return image;
  }
}

function scaleEmailImageDimensions(dimensions) {
  const sourceWidth = Number(dimensions && dimensions.width) || 0;
  const sourceHeight = Number(dimensions && dimensions.height) || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * COLDMAIL_EMAIL_IMAGE_WIDTH));
  return {
    width: COLDMAIL_EMAIL_IMAGE_WIDTH,
    height,
  };
}

function getImageExtension(contentType) {
  const normalized = defaultNormalizeString(contentType).split(';')[0].toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'png';
}

async function optimizeInstantlyPreviewImageForEmail(image) {
  const contentType = defaultNormalizeString(image && image.contentType).split(';')[0].toLowerCase();
  const content = image && image.content;
  if (
    !Buffer.isBuffer(content) ||
    content.length < COLDMAIL_PREVIEW_IMAGE_OPTIMIZE_MIN_BYTES ||
    !/^image\/(?:png|jpe?g|webp)$/i.test(contentType)
  ) {
    return image;
  }

  try {
    const sharp = loadInstantlyPreviewSharp();
    if (typeof sharp !== 'function') return image;
    const metadata = await sharp(content, { limitInputPixels: 45_000_000 }).metadata();
    const sourceWidth = Number(metadata && metadata.width) || 0;
    const shouldResize = sourceWidth > COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH;
    const transformer = sharp(content, { limitInputPixels: 45_000_000 }).rotate();
    if (shouldResize) {
      transformer.resize({
        width: COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH,
        withoutEnlargement: true,
      });
    }
    const optimized = await transformer
      .jpeg({
        quality: COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    if (!Buffer.isBuffer(optimized) || !optimized.length) return image;
    if (!shouldResize && contentType === 'image/jpeg' && optimized.length >= content.length) return image;
    return {
      ...image,
      content: optimized,
      contentType: 'image/jpeg',
    };
  } catch (_error) {
    return image;
  }
}

function readChunkedCustomerPhoto(values, photoKey, chunkCount = 0, normalizeString = defaultNormalizeString) {
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
  return parseDataUrlImage(dataUrl, normalizeString) ? { dataUrl, chunkCount: chunks.length } : null;
}

function buildCustomerPhotoDataKey(row, normalizeString = defaultNormalizeString) {
  const id = getExplicitRowId(row, normalizeString);
  if (!id) return '';
  return `softora_database_photo_data_v1_${id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)}`;
}

function parseCustomerPhotoMap(raw, values = {}, rows = [], normalizeString = defaultNormalizeString) {
  let parsed = {};
  try {
    const data = JSON.parse(normalizeString(raw) || '{}');
    parsed = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_) {
    parsed = {};
  }
  const stateValues = values && typeof values === 'object' ? values : {};
  Object.keys(parsed).forEach((key) => {
    const item = parsed[key];
    if (!item || typeof item !== 'object') return;
    const chunked = readChunkedCustomerPhoto(stateValues, item.photoKey, item.chunkCount, normalizeString);
    if (chunked) {
      item.websitePhoto = chunked.dataUrl;
      item.chunkCount = chunked.chunkCount;
    }
    const mockupPhotoKey = normalizeString(item.mockupPhotoKey || item.websiteMockupKey);
    const mockupChunked = readChunkedCustomerPhoto(
      stateValues,
      mockupPhotoKey,
      item.mockupChunkCount || item.websiteMockupChunkCount,
      normalizeString
    );
    if (mockupChunked) {
      item.websiteMockup = mockupChunked.dataUrl;
      item.mockupChunkCount = mockupChunked.chunkCount;
    }
  });
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = getExplicitRowId(row, normalizeString);
    if (!id) return;
    const photoKey = buildCustomerPhotoDataKey(row, normalizeString);
    const chunked = readChunkedCustomerPhoto(stateValues, photoKey, 0, normalizeString);
    if (!chunked) return;
    const existing = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : null;
    if (existing && normalizeString(existing.photoKey) && parseDataUrlImage(existing.websitePhoto, normalizeString)) return;
    parsed[id] = {
      ...(existing || {}),
      id,
      identityKey: normalizeString(existing && existing.identityKey) || buildRowIdentityKey(row, normalizeString),
      photoKey,
      chunkCount: chunked.chunkCount,
      websitePhoto: chunked.dataUrl,
      websitePhotoName: normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName) || 'Websitefoto',
    };
  });
  return parsed;
}

function getWebdesignPhotoSource(photo, normalizeString = defaultNormalizeString) {
  if (!photo || typeof photo !== 'object') return '';
  return normalizeString(
    photo.websitePhoto ||
      photo.websitePhotoUrl ||
      photo.signedUrl ||
      (photo.storage && photo.storage.signedUrl)
  );
}

function getWebdesignMockupSource(photo, normalizeString = defaultNormalizeString) {
  if (!photo || typeof photo !== 'object') return '';
  return normalizeString(
    photo.websiteMockup ||
      photo.websiteMockupUrl ||
      photo.mockupUrl ||
      photo.signedMockupUrl ||
      (photo.mockupStorage && photo.mockupStorage.signedUrl)
  );
}

function isApprovedWebdesignMockupRecord(photo, normalizeString = defaultNormalizeString) {
  return isResolvableWebsitePhotoValue(getWebdesignMockupSource(photo, normalizeString), normalizeString);
}

function isResolvableWebsitePhotoValue(value, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  if (!text) return false;
  return parseDataUrlImage(text, normalizeString) || /^https:\/\//i.test(text);
}

function hasReadyWebdesignAssetRecord(photo, normalizeString = defaultNormalizeString) {
  return Boolean(
    photo &&
      typeof photo === 'object' &&
      isResolvableWebsitePhotoValue(getWebdesignPhotoSource(photo, normalizeString), normalizeString) &&
      isApprovedWebdesignMockupRecord(photo, normalizeString)
  );
}

function buildPhotosByIdentity(photoMap, normalizeString = defaultNormalizeString) {
  const photosByIdentity = new Map();
  const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
  Object.keys(photos).forEach((key) => {
    const item = photos[key];
    if (!hasReadyWebdesignAssetRecord(item, normalizeString)) return;
    getPhotoIdentityKeys(item, normalizeString).forEach((identityKey) => {
      if (identityKey) photosByIdentity.set(identityKey, item);
    });
  });
  return photosByIdentity;
}

function findStoredPhotoRecordForRow(row, index, photoMap, photosByIdentity, normalizeString = defaultNormalizeString) {
  const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
  const byIdentity = photosByIdentity instanceof Map ? photosByIdentity : new Map();
  const id = getExplicitRowId(row, normalizeString);
  const directPhoto = id ? photos[id] : null;
  if (directPhoto && photoRecordMatchesRowIdentity(directPhoto, row, normalizeString)) return directPhoto;
  for (const identityKey of buildRowIdentityKeys(row, normalizeString)) {
    const photo = byIdentity.get(identityKey);
    if (photo) return photo;
  }
  return null;
}

function preferFreshRowPhotoFields(row, storedPhoto, normalizeString = defaultNormalizeString) {
  const base = storedPhoto && typeof storedPhoto === 'object' ? { ...storedPhoto } : {};
  const next = { ...base };
  const rowPhotoSource = getWebdesignPhotoSource(row, normalizeString);
  const rowMockupSource = getWebdesignMockupSource(row, normalizeString);
  if (
    !isResolvableWebsitePhotoValue(getWebdesignPhotoSource(next, normalizeString), normalizeString) &&
    isResolvableWebsitePhotoValue(rowPhotoSource, normalizeString)
  ) {
    next.websitePhoto =
      row.websitePhoto ||
      row.websitePhotoUrl ||
      row.signedUrl ||
      (row.storage && row.storage.signedUrl) ||
      rowPhotoSource;
    const rowPhotoName = normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName);
    if (rowPhotoName) next.websitePhotoName = rowPhotoName;
  }
  if (
    !isResolvableWebsitePhotoValue(getWebdesignMockupSource(next, normalizeString), normalizeString) &&
    isResolvableWebsitePhotoValue(rowMockupSource, normalizeString)
  ) {
    next.websiteMockup =
      row.websiteMockup ||
      row.websiteMockupUrl ||
      row.mockupUrl ||
      row.signedMockupUrl ||
      (row.mockupStorage && row.mockupStorage.signedUrl) ||
      rowMockupSource;
    const rowMockupName = normalizeString(row.websiteMockupName || row.mockupName);
    if (rowMockupName) next.websiteMockupName = rowMockupName;
    next.mockupRenderer = normalizeString(row.mockupRenderer || row.websiteMockupRenderer || next.mockupRenderer);
    next.mockupOrientation = normalizeString(row.mockupOrientation || row.websiteMockupOrientation || next.mockupOrientation);
    next.mockupQualityStatus = normalizeString(row.mockupQualityStatus || row.websiteMockupQualityStatus || next.mockupQualityStatus);
    next.mockupQualityCheckedAt = normalizeString(row.mockupQualityCheckedAt || row.websiteMockupQualityCheckedAt || next.mockupQualityCheckedAt);
  }
  if (!normalizeString(next.id)) next.id = getRowId(row, 0, normalizeString);
  if (!normalizeString(next.identityKey)) next.identityKey = buildRowIdentityKey(row, normalizeString);
  return next;
}

function getWebdesignAssetRecordForRow(row, index, context = {}, normalizeString = defaultNormalizeString) {
  const photoMap = context.photoMap && typeof context.photoMap === 'object' ? context.photoMap : {};
  const photosByIdentity =
    context.photosByIdentity instanceof Map ? context.photosByIdentity : buildPhotosByIdentity(photoMap, normalizeString);
  return preferFreshRowPhotoFields(
    row,
    findStoredPhotoRecordForRow(row, index, photoMap, photosByIdentity, normalizeString),
    normalizeString
  );
}

function personalizeTemplate(template, row, normalizeString = defaultNormalizeString) {
  const company = getRowCompany(row, normalizeString) || 'uw bedrijf';
  const contact = getRowContact(row, normalizeString) || company;
  const domain = getRowDomain(row, normalizeString);
  const city = getRowCity(row, normalizeString) || 'uw regio';
  return normalizeString(template)
    .replace(/\{\{\s*bedrijf\s*\}\}/gi, company)
    .replace(/\{\{\s*naam\s*\}\}/gi, contact)
    .replace(/\{\{\s*(stad|plaats|locatie)\s*\}\}/gi, city)
    .replace(/\{\{\s*domein\s*\}\}/gi, domain || company)
    .replace(/\{\{\s*website\s*\}\}/gi, domain || company);
}

function buildMailText(body, row, normalizeString = defaultNormalizeString) {
  return personalizeTemplate(body, row, normalizeString)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function inferInstantlySenderName(profileBody, senderEmail = '', normalizeString = defaultNormalizeString) {
  const body = normalizeString(profileBody);
  const email = normalizeEmailAddress(senderEmail, normalizeString);
  if (/\bMartijn\s+van\s+de\s+Ven\b/i.test(body) || /martijn/i.test(email)) return 'Martijn van de Ven';
  if (/\bServ[ée]\s+Creusen\b/i.test(body) || /serve/i.test(email)) return 'Servé Creusen';
  return 'Martijn van de Ven';
}

function buildInstantlyWebdesignMailText(row, city, senderName, normalizeString = defaultNormalizeString) {
  const personalized = personalizeTemplate(DEFAULT_INSTANTLY_WEBDESIGN_BODY, row, normalizeString)
    .replace(/\{\{\s*(afzender|sender|senderName)\s*\}\}/gi, normalizeString(senderName) || 'Martijn van de Ven')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return ensurePinnedCityInMailText(personalized, city, normalizeString);
}

function normalizeSenderNameInMailText(text, normalizeString = defaultNormalizeString) {
  return normalizeString(text).replace(/\bServe Creusen\b/g, 'Servé Creusen');
}

function escapeRegexText(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatPinnedCity(city, normalizeString = defaultNormalizeString) {
  const cleanCity = normalizeString(city);
  return cleanCity ? `📍 ${cleanCity}` : '';
}

function ensurePinnedCityInMailText(text, city, normalizeString = defaultNormalizeString) {
  const cleanText = normalizeString(text);
  const cleanCity = normalizeString(city);
  if (!cleanText || !cleanCity || /📍/.test(cleanText)) return cleanText;
  const cityPattern = cleanCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trailingCityLine = new RegExp(`(^|\\n)\\s*${cityPattern}\\s*$`, 'i');
  if (trailingCityLine.test(cleanText)) {
    return cleanText.replace(trailingCityLine, `$1${formatPinnedCity(cleanCity, normalizeString)}`);
  }
  return `${cleanText}\n\n${formatPinnedCity(cleanCity, normalizeString)}`;
}

function hasImageVisibilityPs(text, normalizeString = defaultNormalizeString) {
  return COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(normalizeString(text));
}

function normalizeImageVisibilityPsInMailText(text, row, id, config, normalizeString = defaultNormalizeString) {
  return normalizeString(text).replace(
    COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN,
    buildImageVisibilityPs(row, id, config, normalizeString)
  );
}

function ensureImageVisibilityPsInMailText(text, city, row, id, config, normalizeString = defaultNormalizeString) {
  const cleanText = normalizeImageVisibilityPsInMailText(text, row, id, config, normalizeString);
  if (!cleanText || hasImageVisibilityPs(cleanText, normalizeString)) return cleanText;
  const cleanCity = normalizeString(city);
  const pinnedCity = formatPinnedCity(cleanCity, normalizeString);
  const lines = cleanText.split('\n');
  const cityMatchers = [pinnedCity, cleanCity]
    .filter(Boolean)
    .map((value) => new RegExp(`^\\s*${escapeRegexText(value)}\\s*$`, 'i'));
  let insertAt = -1;
  if (cityMatchers.length) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (cityMatchers.some((matcher) => matcher.test(lines[index]))) {
        insertAt = index + 1;
        break;
      }
    }
  }
  if (insertAt === -1) {
    return `${cleanText}\n\n${buildImageVisibilityPs(row, id, config, normalizeString)}`;
  }
  lines.splice(insertAt, 0, '', buildImageVisibilityPs(row, id, config, normalizeString));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeLinkedinCtaFromMailText(text, normalizeString = defaultNormalizeString) {
  const cleanText = normalizeString(text);
  if (!cleanText || !MARTIJN_LINKEDIN_CTA_PATTERN.test(cleanText)) return cleanText;
  return cleanText
    .split('\n')
    .filter((line) => !MARTIJN_LINKEDIN_CTA_PATTERN.test(normalizeString(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInstantlyMailText(text, city, row, id, config, normalizeString = defaultNormalizeString) {
  return ensureImageVisibilityPsInMailText(
    removeLinkedinCtaFromMailText(
      ensurePinnedCityInMailText(normalizeSenderNameInMailText(text, normalizeString), city, normalizeString),
      normalizeString
    ),
    city,
    row,
    id,
    config,
    normalizeString
  );
}

function shouldAppendColdmailOptOutText(text, normalizeString = defaultNormalizeString) {
  return !/(?:geen webdesign willen ontvangen\?\s*laat het me weten!?|had je liever geen webdesign willen ontvangen\?\s*laat het me hier weten!?|past dit niet\?\s*laat het me hier weten|liever geen e-mails meer ontvangen|geen e-mails meer ontvangen.*https?:\/\/|afmelden:\s*https?:\/\/|\/afmelden\?t=|\/coldmailing\/afmelden\?t=|unsubscribe:\s*https?:\/\/)/i.test(
    normalizeString(text)
  );
}

function appendColdmailOptOutText(text, unsubscribeUrl = '', normalizeString = defaultNormalizeString) {
  const cleanText = normalizeString(text);
  const cleanUrl = normalizeString(unsubscribeUrl);
  const optOutText = cleanUrl
    ? `${COLDMAIL_OPT_OUT_TEXT_PREFIX}: ${cleanUrl}`
    : COLDMAIL_OPT_OUT_LABEL;
  if (!cleanText) return optOutText;
  if (!shouldAppendColdmailOptOutText(cleanText, normalizeString)) return cleanText;
  return `${cleanText}\n\n${optOutText}`;
}

function firstTemplateValue(raw = {}, key, variantsKey, normalizeString = defaultNormalizeString) {
  const direct = normalizeString(raw && raw[key]);
  if (direct) return direct;
  const variants = raw && Array.isArray(raw[variantsKey]) ? raw[variantsKey] : [];
  return variants.map((value) => normalizeString(value)).find(Boolean) || '';
}

function normalizeColdmailProfile(value = {}, fallback = {}, normalizeString = defaultNormalizeString, truncateText = defaultTruncateText) {
  const raw = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const subject = truncateText(
    firstTemplateValue(raw, 'subject', 'subjectVariants', normalizeString) ||
      firstTemplateValue(base, 'subject', 'subjectVariants', normalizeString) ||
      DEFAULT_WEBDESIGN_SUBJECT,
    200
  );
  const body =
    firstTemplateValue(raw, 'body', 'bodyVariants', normalizeString) ||
    firstTemplateValue(base, 'body', 'bodyVariants', normalizeString) ||
    DEFAULT_WEBDESIGN_BODY;
  return {
    subject: subject || DEFAULT_WEBDESIGN_SUBJECT,
    body: body || DEFAULT_WEBDESIGN_BODY,
  };
}

function hasCompleteColdmailProfile(value = {}, normalizeString = defaultNormalizeString) {
  const raw = value && typeof value === 'object' ? value : {};
  return Boolean(
    firstTemplateValue(raw, 'subject', 'subjectVariants', normalizeString) &&
      firstTemplateValue(raw, 'body', 'bodyVariants', normalizeString)
  );
}

function normalizeProfileMap(value = {}, normalizeString = defaultNormalizeString) {
  const raw = value && typeof value === 'object' ? value : {};
  const profiles = {};
  Object.keys(raw).forEach((email) => {
    const normalizedEmail = normalizeEmailAddress(email, normalizeString);
    const profile = raw[email];
    if (!normalizedEmail || !profile || typeof profile !== 'object') return;
    profiles[normalizedEmail] = profile;
  });
  return profiles;
}

function pickColdmailProfileForSender(profiles = {}, senderEmails = [], normalizeString = defaultNormalizeString) {
  const normalizedProfiles = normalizeProfileMap(profiles, normalizeString);
  const emails = (Array.isArray(senderEmails) ? senderEmails : [senderEmails])
    .map((email) => normalizeEmailAddress(email, normalizeString))
    .filter(Boolean);
  const direct = emails
    .map((email) => normalizedProfiles[email])
    .find((profile) => hasCompleteColdmailProfile(profile, normalizeString));
  if (direct) return direct;
  return Object.values(normalizedProfiles).find((profile) => hasCompleteColdmailProfile(profile, normalizeString)) || null;
}

function extractColdmailProfileFromSettings(settings, defaultSenderEmail, normalizeString = defaultNormalizeString, truncateText = defaultTruncateText) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  const senderEmail = normalizeEmailAddress(raw.senderEmail || defaultSenderEmail, normalizeString);
  const senderProfile = pickColdmailProfileForSender(
    raw.senders,
    getInstantlySenderProfileEmailCandidateList([defaultSenderEmail, senderEmail], normalizeString),
    normalizeString
  );
  const sourceProfile = senderProfile || (hasCompleteColdmailProfile(raw, normalizeString) ? raw : null);
  if (!sourceProfile) return null;
  return normalizeColdmailProfile(
    sourceProfile,
    { subject: DEFAULT_WEBDESIGN_SUBJECT, body: DEFAULT_WEBDESIGN_BODY },
    normalizeString,
    truncateText
  );
}

function extractColdmailProfileFromAutopilotState(state, defaultSenderEmail, normalizeString = defaultNormalizeString, truncateText = defaultTruncateText) {
  const raw = state && typeof state === 'object' ? state : {};
  const config = raw.config && typeof raw.config === 'object' ? raw.config : raw;
  const senderEmail = normalizeEmailAddress(config.senderEmail || defaultSenderEmail, normalizeString);
  const senderEmails = [
    defaultSenderEmail,
    senderEmail,
    ...(Array.isArray(config.senderEmails) ? config.senderEmails : []),
  ];
  const senderProfile = pickColdmailProfileForSender(
    config.senderProfiles,
    getInstantlySenderProfileEmailCandidateList(senderEmails, normalizeString),
    normalizeString
  );
  const sourceProfile = senderProfile || (hasCompleteColdmailProfile(config, normalizeString) ? config : null);
  if (!sourceProfile) return null;
  return normalizeColdmailProfile(
    sourceProfile,
    { subject: DEFAULT_WEBDESIGN_SUBJECT, body: DEFAULT_WEBDESIGN_BODY },
    normalizeString,
    truncateText
  );
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signColdmailPayload(encodedPayload, secret) {
  return crypto
    .createHmac('sha256', defaultNormalizeString(secret) || DEFAULT_COLDMAIL_LINK_SECRET)
    .update(defaultNormalizeString(encodedPayload))
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildColdmailReference(row, id, now = () => new Date(), normalizeString = defaultNormalizeString) {
  const seed = (id || getRowCompany(row, normalizeString) || getRowEmail(row, normalizeString) || 'mail')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toUpperCase();
  const stamp = now().toISOString().slice(0, 10).replace(/-/g, '');
  return `SF-${stamp}-${seed || 'MAIL'}`;
}

function buildColdmailToken(row, id, reference, secret, extra = {}, normalizeString = defaultNormalizeString, now = () => new Date()) {
  const payload = {
    v: 1,
    id: normalizeString(id || getRowId(row, 0, normalizeString)),
    email: getRowEmail(row, normalizeString),
    ref: normalizeString(reference),
    ts: now().toISOString(),
    ...extra,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signColdmailPayload(encodedPayload, secret)}`;
}

function buildColdmailUnsubscribeUrl(row, id, reference, config, normalizeString = defaultNormalizeString, now = () => new Date()) {
  const token = buildColdmailToken(
    row,
    id,
    reference,
    config.coldmailLinkSecret,
    {},
    normalizeString,
    now
  );
  return `${config.publicBaseUrl}${COLDMAIL_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
}

function buildColdmailPreviewImageLink(row, id, reference, config, type, normalizeString = defaultNormalizeString, now = () => new Date()) {
  const token = buildColdmailToken(
    row,
    id,
    reference,
    config.coldmailPreviewImageSecret,
    {
      pv: 2,
      scope: 'preview-image',
      type: type === 'mockup' ? 'mockup' : 'webdesign',
    },
    normalizeString,
    now
  );
  const normalizedType = type === 'mockup' ? 'mockup' : 'webdesign';
  return {
    token,
    type: normalizedType,
    url: `${config.previewImageBaseUrl}${COLDMAIL_PREVIEW_IMAGE_PATH}?t=${encodeURIComponent(token)}`,
  };
}

function buildColdmailPreviewImageUrl(row, id, reference, config, type, normalizeString = defaultNormalizeString, now = () => new Date()) {
  return buildColdmailPreviewImageLink(row, id, reference, config, type, normalizeString, now).url;
}

function buildInstantlyBodyWithWebdesignLinks({ baseText, unsubscribeUrl }, normalizeString = defaultNormalizeString) {
  return appendColdmailOptOutText(normalizeString(baseText), unsubscribeUrl, normalizeString);
}

function escapeHtml(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttribute(value, normalizeString = defaultNormalizeString) {
  return escapeHtml(value, normalizeString).replace(/'/g, '&#39;');
}

function extractPublicWebdesignPreviewLinkFromPs(line, normalizeString = defaultNormalizeString) {
  const cleanLine = normalizeString(line);
  const match = cleanLine.match(/(https?:\/\/[^\s<>"']*\/webdesign\/[a-z0-9-]+(?:\?[^)\s<>"']*)?|\/?webdesign\/[a-z0-9-]+(?:\?[^)\s<>"']*)?)/i);
  if (!match) return null;
  const rawHref = match[1].replace(/[),.;!?]+$/g, '');
  const href = /^https?:\/\//i.test(rawHref)
    ? rawHref
    : `https://www.softora.nl/${rawHref.replace(/^\/+/, '')}`;
  let label = rawHref.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '');
  try {
    label = new URL(href).pathname.replace(/^\/+/, '') || label;
  } catch (_) {}
  return {
    href,
    label,
    start: match.index || 0,
    end: (match.index || 0) + match[1].length,
  };
}

function renderImageVisibilityPsHtmlLine(line, normalizeString = defaultNormalizeString, options = {}) {
  const cleanLine = normalizeString(line);
  const publicLink = extractPublicWebdesignPreviewLinkFromPs(cleanLine, normalizeString) || {
    href: normalizeString(options.webdesignPreviewUrl),
  };
  if (!publicLink.href) {
    return `<em style="font-style:italic;">${escapeHtml(cleanLine, normalizeString).replace(/\n/g, '<br>')}</em>`;
  }
  return `<em style="font-style:italic;">PS: Wordt het webdesign niet zichtbaar?<br>Open het via <a href="${escapeHtmlAttribute(
    publicLink.href,
    normalizeString
  )}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier</a> 👈</em>`;
}

function renderInstantlyWebdesignPreviewCtaHtmlLine(line, normalizeString = defaultNormalizeString, options = {}) {
  const href = normalizeString(options.webdesignPreviewUrl);
  if (!href) return escapeHtml(line, normalizeString);
  return `Je kunt je webdesign <a href="${escapeHtmlAttribute(
    href,
    normalizeString
  )}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier</a> bekijken 👈`;
}

function renderMailTextAsHtml(text, normalizeString = defaultNormalizeString, options = {}) {
  const body = normalizeString(text)
    .split(/\n{2,}/)
    .map((paragraph) => {
      const cleanParagraph = normalizeString(paragraph);
      if (INSTANTLY_WEBDESIGN_PREVIEW_CTA_PATTERN.test(cleanParagraph)) {
        return `<p>${renderInstantlyWebdesignPreviewCtaHtmlLine(cleanParagraph, normalizeString, options)}</p>`;
      }
      if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanParagraph)) {
        return `<p>${renderImageVisibilityPsHtmlLine(cleanParagraph, normalizeString, options)}</p>`;
      }
      return `<p>${paragraph
          .split('\n')
          .map((line) => {
            const cleanLine = normalizeString(line);
            if (INSTANTLY_WEBDESIGN_PREVIEW_CTA_PATTERN.test(cleanLine)) {
              return renderInstantlyWebdesignPreviewCtaHtmlLine(cleanLine, normalizeString, options);
            }
            if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanLine)) {
              return renderImageVisibilityPsHtmlLine(cleanLine, normalizeString, options);
            }
            return escapeHtml(cleanLine, normalizeString);
          })
          .join('<br>')}</p>`;
    })
    .join('\n');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;">${body}</div>`;
}

function normalizeInstantlyImageAlt(value, normalizeString = defaultNormalizeString) {
  const clean = normalizeString(value).toLowerCase();
  return clean === 'mockup' ? 'Mockup' : 'Webdesign';
}

function renderImageHtml(src, alt, margin = '24px 0 0 0', normalizeString = defaultNormalizeString, dimensions = null) {
  const cleanSrc = normalizeString(src);
  if (!cleanSrc) return '';
  const cleanAlt = normalizeInstantlyImageAlt(alt, normalizeString);
  const isWebdesign = cleanAlt === 'Webdesign';
  const fallbackWidth = isWebdesign ? INSTANTLY_WEBDESIGN_PLACEHOLDER_WIDTH : INSTANTLY_MOCKUP_PLACEHOLDER_WIDTH;
  const fallbackHeight = isWebdesign ? INSTANTLY_WEBDESIGN_PLACEHOLDER_HEIGHT : INSTANTLY_MOCKUP_PLACEHOLDER_HEIGHT;
  const scaledDimensions = scaleEmailImageDimensions(dimensions);
  const imageWidth = scaledDimensions ? scaledDimensions.width : fallbackWidth;
  const imageHeight = scaledDimensions ? scaledDimensions.height : fallbackHeight;
  return `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:${margin};"><tr><td align="left" style="padding:0;margin:0;width:100%;background:#f3f6fb;border:1px solid #dbe3f0;"><img src="${escapeHtmlAttribute(
    cleanSrc,
    normalizeString
  )}" alt="${escapeHtmlAttribute(
    cleanAlt,
    normalizeString
  )}" width="${imageWidth}" height="${imageHeight}" loading="eager" decoding="async" fetchpriority="high" style="display:block;width:100%;max-width:${COLDMAIL_EMAIL_IMAGE_WIDTH}px;height:auto;aspect-ratio:${imageWidth}/${imageHeight};border:0;outline:none;text-decoration:none;" /></td></tr></table>`;
}

function wrapInstantlyEmailHtml(content, normalizeString = defaultNormalizeString) {
  const html = typeof content === 'string' ? content.trim() : normalizeString(content);
  if (!html) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;"><tr><td align="left" style="padding:0;margin:0;"><div style="max-width:${INSTANTLY_EMAIL_CONTENT_MAX_WIDTH}px;margin:0;">${html}</div></td></tr></table>`;
}

function buildInstantlyEmailHtml(
  {
    baseText,
    company,
    webdesignImageUrl,
    webdesignMockupUrl,
    webdesignImageDimensions,
    webdesignMockupDimensions,
    webdesignPublicUrl,
    unsubscribeUrl,
  },
  normalizeString = defaultNormalizeString
) {
  const optOut = normalizeString(unsubscribeUrl)
    ? `\n<p style="margin:7px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;"><a href="${escapeHtmlAttribute(
        unsubscribeUrl,
        normalizeString
      )}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(
        COLDMAIL_OPT_OUT_LABEL,
        normalizeString
      )}</a></p>`
    : '';
  const content = `${renderMailTextAsHtml(baseText, normalizeString, {
    webdesignPreviewUrl: webdesignPublicUrl,
  })}${optOut}`;
  return wrapInstantlyEmailHtml(content, normalizeString);
}

async function warmInstantlyPreviewImageCache(
  { link, photo, type, company, fetchImageWithTimeout },
  normalizeString = defaultNormalizeString
) {
  if (!link || !link.token || !photo || typeof photo !== 'object') return { dimensions: null };
  const source = type === 'mockup'
    ? getWebdesignMockupSource(photo, normalizeString)
    : getWebdesignPhotoSource(photo, normalizeString);
  const parsed = await resolveInstantlyPreviewImageSource(source, normalizeString, fetchImageWithTimeout);
  if (!parsed) return { dimensions: null };
  const prepared = type === 'mockup'
    ? parsed
    : await removeDecorativeWebdesignFrameForInstantly(parsed);
  const optimized = await optimizeInstantlyPreviewImageForEmail(prepared);
  const dimensions = getImageDimensions(optimized) || getImageDimensions(prepared) || getImageDimensions(parsed);
  const baseName =
    type === 'mockup'
      ? normalizeString(photo.websiteMockupName || photo.mockupName) || `${normalizeString(company) || 'Softora'} device mockup`
      : normalizeString(photo.websitePhotoName || photo.photoName || photo.websiteImageName) || `${normalizeString(company) || 'Softora'} webdesign`;
  rememberPreviewImage(getPreviewImageCacheKey(link.token, link.type || type), {
    ok: true,
    type: link.type || type,
    content: optimized.content,
    contentType: optimized.contentType,
    filename: `${baseName}.${getImageExtension(optimized.contentType)}`,
  }, {
    limit: COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT,
  });
  return { dimensions };
}

async function prewarmInstantlyPublicPreviewImage(
  { link, fetchPublicPreviewImage },
  normalizeString = defaultNormalizeString
) {
  const url = normalizeString(link && link.url);
  if (!/^https:\/\//i.test(url) || typeof fetchPublicPreviewImage !== 'function') {
    return { ok: false, reason: 'disabled' };
  }
  try {
    const result = await fetchPublicPreviewImage(url, INSTANTLY_PUBLIC_IMAGE_PREWARM_TIMEOUT_MS);
    return result && typeof result === 'object' ? result : { ok: Boolean(result) };
  } catch (_error) {
    return { ok: false, reason: 'failed' };
  }
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

function normalizeRemoteInstantlyLeadStatus(lead, normalizeString = defaultNormalizeString) {
  if (!lead || typeof lead !== 'object') return 'synced';
  if (Number(lead.email_reply_count || 0) > 0 || normalizeString(lead.timestamp_last_reply)) {
    return 'reply_received';
  }
  if (Number(lead.email_open_count || 0) > 0 || normalizeString(lead.timestamp_last_open)) {
    return 'opened';
  }
  if (
    normalizeString(lead.timestamp_last_contact) ||
    normalizeString(lead.last_step_timestamp_executed) ||
    normalizeString(lead.status_summary && lead.status_summary.lastStep && lead.status_summary.lastStep.timestamp_executed)
  ) {
    return 'sent';
  }
  const status = normalizeInstantlyStatus(lead.status, normalizeString);
  return status && !/^-?\d+$/.test(status) ? status : 'synced';
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
  const raw = normalizeString(readChunkedStateValue(values, customerDbKey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
  } catch (_) {
    return [];
  }
}

function buildCustomerRowsStateValues(values, rows, customerDbKey = DEFAULT_CUSTOMER_DB_KEY) {
  return {
    ...(values && typeof values === 'object' ? values : {}),
    ...buildChunkedStatePatch(customerDbKey, JSON.stringify(Array.isArray(rows) ? rows : [])),
  };
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
    syncEnabled: readBool(config.syncEnabled, false),
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
    dailyCapTimeZone: defaultNormalizeString(config.dailyCapTimeZone || DEFAULT_DAILY_CAP_TIME_ZONE),
    verifyLeadsOnImport: readBool(config.verifyLeadsOnImport, false),
    blockPersonalMailboxDomains: readBool(config.blockPersonalMailboxDomains, true),
    requireWebdesignAssets: readBool(config.requireWebdesignAssets, true),
    prewarmPublicImageUrls: readBool(config.prewarmPublicImageUrls, true),
    publicBaseUrl: normalizePublicBaseUrl(config.publicBaseUrl) || DEFAULT_PUBLIC_BASE_URL,
    previewImageBaseUrl:
      normalizePublicBaseUrl(config.previewImageBaseUrl) || DEFAULT_PREVIEW_IMAGE_BASE_URL,
    coldmailLinkSecret: defaultNormalizeString(config.coldmailLinkSecret) || DEFAULT_COLDMAIL_LINK_SECRET,
    coldmailPreviewImageSecret:
      defaultNormalizeString(config.coldmailPreviewImageSecret) || DEFAULT_COLDMAIL_PREVIEW_IMAGE_SECRET,
    defaultSenderEmail:
      normalizeEmailAddress(config.defaultSenderEmail || DEFAULT_INSTANTLY_SENDER_EMAIL) ||
      DEFAULT_INSTANTLY_SENDER_EMAIL,
  };
}

function formatDateKeyForTimeZone(value, timeZone = DEFAULT_DAILY_CAP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
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
    fetchImageWithTimeout = defaultFetchImageWithTimeout,
    fetchPublicPreviewImage = defaultFetchPublicPreviewImageWithTimeout,
    resolveEmailDomain = resolveEmailDomainWithDns,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
    coldmailingSettingsScope = DEFAULT_COLDMAILING_SETTINGS_SCOPE,
    coldmailingSettingsKey = DEFAULT_COLDMAILING_SETTINGS_KEY,
    coldmailAutopilotScope = DEFAULT_COLDMAIL_AUTOPILOT_SCOPE,
    coldmailAutopilotKey = DEFAULT_COLDMAIL_AUTOPILOT_KEY,
    coldmailSendGuardScope = DEFAULT_COLDMAIL_SEND_GUARD_SCOPE,
    coldmailSendGuardKey = DEFAULT_COLDMAIL_SEND_GUARD_KEY,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    logger = console,
    now = () => new Date(),
    scheduleTask = (fn, delayMs) => setTimeout(fn, delayMs),
    clearScheduledTask = (timer) => clearTimeout(timer),
  } = deps;

  const config = normalizeInstantlyConfig(instantlyConfig);
  let syncPromise = null;
  let operationPromise = null;
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

  function assertSyncAllowed() {
    assertConfigured();
    if (!config.syncEnabled) {
      throw createInstantlyError(
        'Instantly-sync staat bewust uit.',
        'INSTANTLY_SYNC_DISABLED',
        503
      );
    }
  }

  function getDailySyncCount(rows) {
    const today = formatDateKeyForTimeZone(now(), config.dailyCapTimeZone);
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const syncedAt = normalizeString(row && row.instantlySyncedAt);
      return formatDateKeyForTimeZone(syncedAt, config.dailyCapTimeZone) === today;
    }).length;
  }

  function isPersonalMailboxDomain(email) {
    const domain = getEmailDomain(email);
    return Boolean(domain && PERSONAL_MAILBOX_DOMAINS.has(domain));
  }

  function normalizeHistorySearchText(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getPriorColdmailTimestamp(row) {
    return normalizeString(
      row &&
        (row.outreachSentAt ||
          row.outreach_sent_at ||
          row.lastColdmailSentAt ||
          row.lastMailSentAt ||
          row.lastMailedAt ||
          row.coldmailCampaignStartedAt ||
          row.coldmailOpenedAt ||
          row.coldmailFirstOpenedAt ||
          row.coldmailLastOpenedAt ||
          row.outreachOpenedAt ||
          row.lastColdmailReplyAt)
    );
  }

  function hasPriorColdmailHistorySignal(row) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    return history.some((item) => {
      const text = getHistorySearchText(item);
      return isPriorColdmailHistoryText(text);
    });
  }

  function getHistorySearchText(item) {
    return normalizeHistorySearchText(
      [
        item && item.type,
        item && item.status,
        item && item.label,
        item && item.message,
        item && item.title,
        item && item.source,
        item && item.subject,
        item && item.preview,
        item && item.messageKey,
      ].join(' ')
    );
  }

  function isPriorColdmailHistoryText(text) {
    return PRIOR_COLDMAIL_HISTORY_PATTERN.test(normalizeHistorySearchText(text));
  }

  function isInstantlyHistoryText(text) {
    return INSTANTLY_HISTORY_PATTERN.test(normalizeHistorySearchText(text));
  }

  function parseTimestampMs(value) {
    const raw = normalizeString(value);
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function isBeforeReferenceDate(value, referenceMs) {
    const valueMs = parseTimestampMs(value);
    if (!referenceMs) return Boolean(valueMs);
    return Boolean(valueMs && valueMs < referenceMs);
  }

  function hasExternalColdmailHistoryBeforeReference(row, referenceMs) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    if (
      history.some((item) => {
        const text = getHistorySearchText(item);
        if (!isPriorColdmailHistoryText(text) || isInstantlyHistoryText(text)) return false;
        const eventMs = parseTimestampMs(item && (item.date || item.timestamp || item.createdAt || item.created_at));
        return !referenceMs || !eventMs || eventMs < referenceMs;
      })
    ) {
      return true;
    }

    return [
      row && row.outreachSentAt,
      row && row.outreach_sent_at,
      row && row.lastColdmailSentAt,
      row && row.lastMailSentAt,
      row && row.lastMailedAt,
      row && row.coldmailOpenedAt,
      row && row.coldmailFirstOpenedAt,
      row && row.coldmailLastOpenedAt,
      row && row.outreachOpenedAt,
      row && row.lastColdmailReplyAt,
    ].some((value) => isBeforeReferenceDate(value, referenceMs));
  }

  function hasExternalColdmailHistoryBeforeInstantly(row) {
    return hasExternalColdmailHistoryBeforeReference(row, parseTimestampMs(row && row.instantlySyncedAt));
  }

  function hasPriorColdmailOutreach(row) {
    if (!row || typeof row !== 'object') return false;
    if (normalizeContactStatus(row.outreachStatus, row) === 'gemaild') return true;
    if (getPriorColdmailTimestamp(row)) return true;
    if (Number(row.coldmailOpenCount || row.outreachOpenCount || 0) > 0) return true;
    if (row.coldmailOpened === true || row.outreachOpened === true) return true;
    if (normalizeString(row.coldmailSentMessageId || row.outreachMessageId || row.sentMessageId || row.messageId)) {
      return true;
    }
    return hasPriorColdmailHistorySignal(row);
  }

  function getPriorColdmailInstantlyRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        id: getRowId(row, index, normalizeString),
        index,
        row,
        leadId: normalizeString(row && row.instantlyLeadId),
        email: getRowEmail(row, normalizeString),
        company: getRowCompany(row, normalizeString),
      }))
      .filter((item) => {
        if (!hasActiveInstantlyOutreach(item.row)) return false;
        if (!item.leadId) return false;
        return hasExternalColdmailHistoryBeforeInstantly(item.row);
      });
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

  async function loadCustomerPhotoMap(rows = []) {
    const state = await getUiStateValues(customerPhotoScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values, rows, normalizeString);
  }

  async function loadColdmailProfile() {
    const [settingsState, autopilotState] = await Promise.all([
      getUiStateValues(coldmailingSettingsScope),
      getUiStateValues(coldmailAutopilotScope),
    ]);
    const settingsValues = settingsState && typeof settingsState.values === 'object' ? settingsState.values : {};
    const autopilotValues = autopilotState && typeof autopilotState.values === 'object' ? autopilotState.values : {};
    let settings = {};
    let autopilot = {};
    try {
      const data = JSON.parse(normalizeString(settingsValues[coldmailingSettingsKey]) || '{}');
      settings = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) {
      settings = {};
    }
    try {
      const data = JSON.parse(normalizeString(autopilotValues[coldmailAutopilotKey]) || '{}');
      autopilot = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) {
      autopilot = {};
    }
    return (
      extractColdmailProfileFromAutopilotState(
        autopilot,
        config.defaultSenderEmail,
        normalizeString,
        truncateText
      ) ||
      extractColdmailProfileFromSettings(
        settings,
        config.defaultSenderEmail,
        normalizeString,
        truncateText
      ) ||
      normalizeColdmailProfile(
        {},
        { subject: DEFAULT_WEBDESIGN_SUBJECT, body: DEFAULT_WEBDESIGN_BODY },
        normalizeString,
        truncateText
      )
    );
  }

  function buildColdmailSendGuardIndex(guardState) {
    const index = {
      emails: new Set(),
      domains: new Set(),
      ids: new Set(),
      keys: new Set(),
    };
    const entries = [
      ...(Array.isArray(guardState && guardState.recipientEntries) ? guardState.recipientEntries : []),
      ...(Array.isArray(guardState && guardState.entries) ? guardState.entries : []),
    ];
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const email = normalizeEmailAddress(entry.recipientEmail || entry.email, normalizeString);
      const domain = normalizeColdmailGuardKeyPart(entry.recipientDomain || entry.domain || entry.websiteDomain, normalizeString);
      const id = normalizeColdmailGuardKeyPart(entry.recipientId || entry.customerId || entry.id, normalizeString);
      const key = normalizeColdmailGuardKeyPart(entry.recipientKey || entry.key, normalizeString);
      if (email) {
        index.emails.add(email);
        index.keys.add(`email:${email}`);
      }
      if (domain) index.domains.add(domain);
      if (id) index.ids.add(id);
      if (key) index.keys.add(key);
    });
    return index;
  }

  async function loadColdmailSendGuardIndex() {
    const state = await getUiStateValues(coldmailSendGuardScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return buildColdmailSendGuardIndex(safeJsonObjectParse(values[coldmailSendGuardKey]));
  }

  function hasColdmailSendGuardMatch(item, context = {}) {
    const guardIndex = context.coldmailSendGuardIndex;
    if (!guardIndex || typeof guardIndex !== 'object') return false;
    const row = item && item.row;
    const email = getRowEmail(row, normalizeString);
    const domain = normalizeColdmailGuardKeyPart(getRowDomain(row, normalizeString) || getEmailDomain(email), normalizeString);
    const id = normalizeColdmailGuardKeyPart(item && item.id, normalizeString);
    return Boolean(
      (email && (guardIndex.emails.has(email) || guardIndex.keys.has(`email:${email}`))) ||
        (domain && guardIndex.domains.has(domain)) ||
        (id && guardIndex.ids.has(id))
    );
  }

  async function loadPersonalizationContext(rows = []) {
    const [photoMap, mailProfile, coldmailSendGuardIndex] = await Promise.all([
      loadCustomerPhotoMap(rows),
      loadColdmailProfile(),
      loadColdmailSendGuardIndex(),
    ]);
    return {
      photoMap,
      photosByIdentity: buildPhotosByIdentity(photoMap, normalizeString),
      mailProfile,
      coldmailSendGuardIndex,
    };
  }

  function getReadyWebdesignAssets(item, context) {
    const photo = getWebdesignAssetRecordForRow(item.row, item.index, context, normalizeString);
    const ready = hasReadyWebdesignAssetRecord(photo, normalizeString);
    return {
      ready,
      photo,
    };
  }

  async function collectEligibleRows(rows, limit, context = {}) {
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
      if (hasColdmailSendGuardMatch({ id, index, row }, context)) {
        failed.push({
          id,
          bedrijf: company,
          email,
          error: 'Lead staat al in de permanente duplicate-guard; niet opnieuw naar Instantly gestuurd.',
        });
        continue;
      }
      if (hasPriorColdmailOutreach(row)) {
        failed.push({
          id,
          bedrijf: company,
          email,
          error: 'Al eerder benaderd via Softora coldmail/open-tracking; niet naar Instantly gestuurd.',
        });
        continue;
      }
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
      if (config.requireWebdesignAssets) {
        const assets = getReadyWebdesignAssets({ id, index, row }, context);
        if (!assets.ready) {
          failed.push({
            id,
            bedrijf: company,
            email,
            error: `Nog geen website-design klaar voor Instantly: ${company || email}.`,
          });
          continue;
        }
      }

      selectedRows.push({ id, index, row });
    }

    return { selectedRows, failed };
  }

  async function buildInstantlyLead(item, context = {}) {
    const row = item.row;
    const email = getRowEmail(row, normalizeString);
    const company = getRowCompany(row, normalizeString);
    const contact = getRowContact(row, normalizeString) || company;
    const nameParts = contact.split(/\s+/).filter(Boolean);
    const firstName = normalizeString(row.firstName || row.voornaam || nameParts[0] || '');
    const lastName = normalizeString(
      row.lastName || row.achternaam || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '')
    );
    const reference = buildColdmailReference(row, item.id, now, normalizeString);
    const unsubscribeUrl = buildColdmailUnsubscribeUrl(row, item.id, reference, config, normalizeString, now);
    const webdesignPublicPath = buildPublicWebdesignPreviewPath(row, item.id, normalizeString);
    const webdesignPublicUrl = buildPublicWebdesignPreviewUrl(row, item.id, config, normalizeString);
    const subjectTemplate =
      normalizeString(context.mailProfile && context.mailProfile.subject) || DEFAULT_WEBDESIGN_SUBJECT;
    const bodyTemplate =
      normalizeString(context.mailProfile && context.mailProfile.body) || DEFAULT_WEBDESIGN_BODY;
    const city = getRowCity(row, normalizeString) || 'uw regio';
    const subject = personalizeTemplate(subjectTemplate, row, normalizeString);
    const senderName = inferInstantlySenderName(bodyTemplate, config.defaultSenderEmail, normalizeString);
    const baseMailBody = buildInstantlyWebdesignMailText(row, city, senderName, normalizeString);
    const assets = getReadyWebdesignAssets(item, context);
    const webdesignLink = assets.ready
      ? buildColdmailPreviewImageLink(row, item.id, reference, config, 'webdesign', normalizeString, now)
      : null;
    const webdesignMockupLink = assets.ready
      ? buildColdmailPreviewImageLink(row, item.id, reference, config, 'mockup', normalizeString, now)
      : null;
    const webdesignCache = assets.ready
      ? await warmInstantlyPreviewImageCache({ link: webdesignLink, photo: assets.photo, type: 'webdesign', company, fetchImageWithTimeout }, normalizeString)
      : { dimensions: null };
    const webdesignMockupCache = assets.ready
      ? await warmInstantlyPreviewImageCache({ link: webdesignMockupLink, photo: assets.photo, type: 'mockup', company, fetchImageWithTimeout }, normalizeString)
      : { dimensions: null };
    const [webdesignPublicPrewarm, webdesignMockupPublicPrewarm] =
      assets.ready && config.prewarmPublicImageUrls
        ? await Promise.all([
            prewarmInstantlyPublicPreviewImage(
              { link: webdesignLink, fetchPublicPreviewImage },
              normalizeString
            ),
            prewarmInstantlyPublicPreviewImage(
              { link: webdesignMockupLink, fetchPublicPreviewImage },
              normalizeString
            ),
          ])
        : [{ ok: false, reason: 'disabled' }, { ok: false, reason: 'disabled' }];
    const webdesignImageUrl = webdesignLink ? webdesignLink.url : '';
    const webdesignMockupUrl = webdesignMockupLink ? webdesignMockupLink.url : '';
    const instantlyEmailBody = buildInstantlyBodyWithWebdesignLinks(
      {
        baseText: baseMailBody,
        webdesignImageUrl,
        webdesignMockupUrl,
        unsubscribeUrl,
      },
      normalizeString
    );
    const instantlyEmailHtml = buildInstantlyEmailHtml(
      {
        baseText: baseMailBody,
        company,
        webdesignImageUrl,
        webdesignMockupUrl,
        webdesignImageDimensions: webdesignCache.dimensions,
        webdesignMockupDimensions: webdesignMockupCache.dimensions,
        webdesignPublicUrl,
        unsubscribeUrl,
      },
      normalizeString
    );
    const customVariables = {
      softora_customer_id: item.id,
      softora_source: 'softora',
      softora_company: company,
      softora_status: normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect',
      softora_contact_name: contact,
      softora_city: city,
      softora_city_with_pin: formatPinnedCity(city, normalizeString),
      softora_subject: subject,
      softora_mail_body: baseMailBody,
      softora_mail_body_with_optout: appendColdmailOptOutText(baseMailBody, unsubscribeUrl, normalizeString),
      softora_instantly_email_text: instantlyEmailBody,
      softora_instantly_email_body: instantlyEmailBody,
      softora_instantly_email_html: instantlyEmailHtml,
      softora_image_visibility_ps: buildImageVisibilityPs(row, item.id, config, normalizeString),
      softora_reference: reference,
      softora_unsubscribe_url: unsubscribeUrl,
      softora_webdesign_public_path: webdesignPublicPath,
      softora_webdesign_public_url: webdesignPublicUrl,
      softora_webdesign_image_url: webdesignImageUrl,
      softora_webdesign_mockup_url: webdesignMockupUrl,
      softora_webdesign_image_prewarmed: webdesignPublicPrewarm && webdesignPublicPrewarm.ok ? 'true' : 'false',
      softora_webdesign_mockup_prewarmed: webdesignMockupPublicPrewarm && webdesignMockupPublicPrewarm.ok ? 'true' : 'false',
      softora_mockup_caption: COLDMAIL_MOCKUP_CAPTION,
      softora_website_domain: getRowDomain(row, normalizeString),
      softora_webdesign_ready: assets.ready ? 'true' : 'false',
    };

    return {
      email,
      personalization: instantlyEmailHtml,
      first_name: firstName,
      last_name: lastName,
      company_name: company,
      phone: getRowPhone(row, normalizeString),
      website: getRowWebsite(row, normalizeString),
      custom_variables: customVariables,
    };
  }

  function getMissingInstantlyCustomVariables(lead) {
    const variables = lead && lead.custom_variables && typeof lead.custom_variables === 'object'
      ? lead.custom_variables
      : {};
    const missing = REQUIRED_INSTANTLY_CUSTOM_VARIABLES.filter((key) => !normalizeString(variables[key]));
    if (normalizeString(variables.softora_source).toLowerCase() !== 'softora') {
      missing.push('softora_source=softora');
    }
    if (normalizeString(variables.softora_webdesign_ready).toLowerCase() !== 'true') {
      missing.push('softora_webdesign_ready=true');
    }
    if (!/^📍\s+\S+/u.test(normalizeString(variables.softora_city_with_pin))) {
      missing.push('softora_city_with_pin');
    }
    return Array.from(new Set(missing));
  }

  function assertInstantlyLeadReady(lead) {
    const missing = getMissingInstantlyCustomVariables(lead);
    if (!missing.length) return lead;
    throw createInstantlyError(
      `Instantly-lead mist verplichte Softora-variabelen: ${missing.join(', ')}. Stuur leads via de Softora-sync.`,
      'INSTANTLY_LEAD_VARIABLES_INCOMPLETE',
      400,
      { missing }
    );
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
    (Array.isArray(leads) ? leads : []).forEach(assertInstantlyLeadReady);
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

  async function deleteInstantlyLeadsByIds(leadIds) {
    const ids = Array.from(new Set((Array.isArray(leadIds) ? leadIds : []).map(normalizeString).filter(Boolean)));
    if (!ids.length) return { count: 0 };
    const { response, data } = await fetchJsonWithTimeout(
      `${config.apiBaseUrl}/leads`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          campaign_id: config.defaultCampaignId,
          ids,
        }),
      },
      30_000
    );

    if (!response || !response.ok) {
      throw createInstantlyError(
        `Instantly duplicate-cleanup mislukt (${response ? response.status : 'geen response'}).`,
        'INSTANTLY_DUPLICATE_CLEANUP_FAILED',
        response && response.status ? response.status : 502,
        { data }
      );
    }

    return data;
  }

  async function listInstantlyCampaignLeads(limit = DEFAULT_REMOTE_CAMPAIGN_LEAD_RECONCILE_LIMIT) {
    const safeLimit = clampNumber(limit, DEFAULT_REMOTE_CAMPAIGN_LEAD_RECONCILE_LIMIT, 1, 5000);
    const items = [];
    let startingAfter = '';

    for (let page = 0; page < Math.ceil(safeLimit / 100); page += 1) {
      const remaining = safeLimit - items.length;
      if (remaining <= 0) break;
      const body = {
        campaign: config.defaultCampaignId,
        limit: Math.min(100, remaining),
      };
      if (startingAfter) body.starting_after = startingAfter;

      const { response, data } = await fetchJsonWithTimeout(
        `${config.apiBaseUrl}/leads/list`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        30_000
      );

      if (!response || !response.ok) {
        throw createInstantlyError(
          `Instantly campagne-check mislukt (${response ? response.status : 'geen response'}).`,
          'INSTANTLY_CAMPAIGN_LEAD_LIST_FAILED',
          response && response.status ? response.status : 502,
          { data }
        );
      }

      const batch = extractInstantlyLeadItems(data);
      items.push(...batch);
      startingAfter = normalizeString(data && data.next_starting_after);
      if (!startingAfter || !batch.length) break;
    }

    return items;
  }

  function getRemoteLeadPayload(lead) {
    if (!lead || typeof lead !== 'object') return {};
    if (lead.payload && typeof lead.payload === 'object') return lead.payload;
    if (lead.custom_variables && typeof lead.custom_variables === 'object') return lead.custom_variables;
    return {};
  }

  function normalizeRemoteInstantlyLead(lead) {
    const payload = getRemoteLeadPayload(lead);
    const leadId = normalizeString(lead && (lead.id || lead.lead_id || lead.instantly_lead_id));
    return {
      raw: lead,
      leadId,
      campaignId: normalizeString(lead && (lead.campaign || lead.campaign_id)) || config.defaultCampaignId,
      customerId: normalizeString(
        payload.softora_customer_id ||
          payload.softoraCustomerId ||
          payload.customer_id ||
          payload.customerId
      ),
      email: normalizeEmailAddress(
        lead && (lead.email || lead.contact || lead.lead_email || payload.email || payload.softora_email),
        normalizeString
      ),
      company: normalizeString(
        lead && (lead.company_name || lead.companyName || payload.softora_company || payload.companyName)
      ),
      softoraStatus: normalizeContactStatus(payload.softora_status || payload.softoraStatus, {}),
      softoraSource: normalizeString(payload.softora_source || payload.softoraSource).toLowerCase(),
      status: normalizeRemoteInstantlyLeadStatus(lead, normalizeString),
      timestampCreated: normalizeString(lead && (lead.timestamp_created || lead.created_at)),
      timestampUpdated: normalizeString(lead && (lead.timestamp_updated || lead.updated_at)),
      timestampLastContact: normalizeString(
        lead &&
          (lead.timestamp_last_contact ||
            lead.last_step_timestamp_executed ||
            (lead.status_summary &&
              lead.status_summary.lastStep &&
              lead.status_summary.lastStep.timestamp_executed))
      ),
    };
  }

  function buildCustomerRowLookup(rows) {
    const byId = new Map();
    const byEmail = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const id = getRowId(row, index, normalizeString);
      const email = getRowEmail(row, normalizeString);
      if (id && !byId.has(id)) byId.set(id, { id, index, row });
      if (email && !byEmail.has(email)) byEmail.set(email, { id, index, row });
    });
    return { byId, byEmail };
  }

  function getLocalMatchForRemoteInstantlyLead(lead, lookup) {
    if (!lead || !lookup) return null;
    if (lead.customerId && lookup.byId.has(lead.customerId)) return lookup.byId.get(lead.customerId);
    if (lead.email && lookup.byEmail.has(lead.email)) return lookup.byEmail.get(lead.email);
    return null;
  }

  function hasNonInstantlyColdmailSignal(row) {
    if (!row || typeof row !== 'object') return false;
    const provider = normalizeString(row.lastColdmailProvider).toLowerCase();
    if (provider && provider !== 'instantly') return true;
    if (provider === 'instantly') return false;
    if (normalizeContactStatus(row.outreachStatus, row) === 'gemaild') return true;
    if (getPriorColdmailTimestamp(row)) return true;
    if (Number(row.coldmailOpenCount || row.outreachOpenCount || 0) > 0) return true;
    if (row.coldmailOpened === true || row.outreachOpened === true) return true;
    if (normalizeString(row.coldmailSentMessageId || row.outreachMessageId || row.sentMessageId || row.messageId)) {
      return true;
    }
    const history = Array.isArray(row.hist) ? row.hist : [];
    return history.some((item) => {
      const text = getHistorySearchText(item);
      return isPriorColdmailHistoryText(text) && !isInstantlyHistoryText(text);
    });
  }

  function shouldRemoveRemoteInstantlyLead(match, remote) {
    const row = match && match.row;
    if (!row || typeof row !== 'object') return false;
    if (row.mail === false || row.canMail === false || row.doNotMail === true) return true;
    const remoteReferenceMs = parseTimestampMs(
      remote && (remote.timestampCreated || remote.timestampLastContact || remote.timestampUpdated)
    );
    if (hasExternalColdmailHistoryBeforeReference(row, remoteReferenceMs)) return true;
    const status = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';
    const provider = normalizeString(row.lastColdmailProvider).toLowerCase();
    if (EXCLUDED_DATABASE_STATUSES.has(status) && provider !== 'instantly') return true;
    if (EXCLUDED_DATABASE_STATUSES.has(status) && !hasActiveInstantlyOutreach(row)) return true;
    return hasNonInstantlyColdmailSignal(row);
  }

  function getRemoteInstantlyReconcilePlan(rows, remoteLeads) {
    const lookup = buildCustomerRowLookup(rows);
    const seenRemoveLeadIds = new Set();
    const seenBackfillRows = new Set();
    const remove = [];
    const backfill = [];
    const unmatched = [];

    (Array.isArray(remoteLeads) ? remoteLeads : []).forEach((rawLead) => {
      const remote = normalizeRemoteInstantlyLead(rawLead);
      if (!remote.leadId) return;
      const match = getLocalMatchForRemoteInstantlyLead(remote, lookup);
      if (!match) {
        unmatched.push(remote);
        return;
      }
      const item = {
        ...match,
        leadId: remote.leadId,
        campaignId: remote.campaignId,
        remote,
      };
      if (shouldRemoveRemoteInstantlyLead(match, remote)) {
        if (!seenRemoveLeadIds.has(remote.leadId)) {
          seenRemoveLeadIds.add(remote.leadId);
          remove.push(item);
        }
        return;
      }
      if (!hasActiveInstantlyOutreach(match.row) && !seenBackfillRows.has(match.index)) {
        seenBackfillRows.add(match.index);
        backfill.push(item);
      }
    });

    return { remove, backfill, unmatched };
  }

  function markRowsAsBackfilledFromRemoteInstantly(rows, backfillRows, actor) {
    const markedAt = now().toISOString();
    const backfillByIndex = new Map(backfillRows.map((item) => [item.index, item]));
    return rows.map((row, index) => {
      const item = backfillByIndex.get(index);
      if (!item) return row;
      const remote = item.remote || {};
      const syncedAt = normalizeString(row.instantlySyncedAt) || remote.timestampCreated || markedAt;
      const lastEventAt = remote.timestampLastContact || remote.timestampUpdated || syncedAt;
      const nextStatus = chooseInstantlyStatus(row.instantlyStatus, remote.status || 'synced');
      const historyEntry = buildHistoryEntry(
        {
          type: 'gemaild',
          label: 'Instantly-lead teruggevonden',
          actor,
          source: 'instantly-remote-reconcile',
          messageKey: `instantly-remote-reconcile:${item.campaignId}:${item.id}:${item.leadId}`,
          subject: 'Instantly reconciliatie',
          preview:
            'Lead stond al in de Instantly-campaign en is in Softora vastgezet zodat eigen mailboxen hem niet opnieuw pakken.',
        },
        { normalizeString, truncateText, now: () => new Date(markedAt) }
      );
      return {
        ...row,
        instantlyLeadId: item.leadId,
        instantlyCampaignId: item.campaignId || config.defaultCampaignId,
        instantlyStatus: nextStatus || 'synced',
        instantlySyncedAt: syncedAt,
        instantlyLastEventAt: lastEventAt,
        instantlyEmailSentAt:
          normalizeString(row.instantlyEmailSentAt) ||
          (nextStatus === 'sent' || nextStatus === 'opened' || nextStatus === 'reply_received'
            ? remote.timestampLastContact
            : ''),
        lastColdmailProvider: 'instantly',
        lastColdmailProviderStatus: nextStatus || 'synced',
        ...buildInstantlyApproachedFields(row, syncedAt),
        updatedAt: markedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });
  }

  async function reconcileRemoteInstantlyCampaignRows(rows, actor) {
    const remoteLeads = await listInstantlyCampaignLeads();
    const plan = getRemoteInstantlyReconcilePlan(rows, remoteLeads);
    let nextRows = rows;
    let deletedCount = 0;

    if (plan.remove.length) {
      const data = await deleteInstantlyLeadsByIds(plan.remove.map((item) => item.leadId));
      deletedCount = Math.max(0, Number(data && data.count) || 0);
      nextRows = markRowsAsRemovedFromInstantly(nextRows, plan.remove, actor);
    }
    if (plan.backfill.length) {
      nextRows = markRowsAsBackfilledFromRemoteInstantly(nextRows, plan.backfill, actor);
    }

    return {
      rows: nextRows,
      remoteLeadCount: remoteLeads.length,
      removed: plan.remove.length,
      deletedCount,
      removedLeadIds: plan.remove.map((item) => item.leadId),
      backfilled: plan.backfill.length,
      unmatched: plan.unmatched.length,
    };
  }

  function buildInstantlyLeadPatchPayload(lead) {
    return {
      personalization: lead.personalization || null,
      website: lead.website || null,
      last_name: lead.last_name || null,
      first_name: lead.first_name || null,
      company_name: lead.company_name || null,
      phone: lead.phone || null,
      custom_variables: lead.custom_variables || {},
    };
  }

  async function patchInstantlyLeadById(leadId, lead) {
    const cleanLeadId = normalizeString(leadId);
    if (!cleanLeadId) return null;
    assertInstantlyLeadReady(lead);
    const { response, data } = await fetchJsonWithTimeout(
      `${config.apiBaseUrl}/leads/${encodeURIComponent(cleanLeadId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildInstantlyLeadPatchPayload(lead)),
      },
      30_000
    );

    if (!response || !response.ok) {
      throw createInstantlyError(
        `Instantly lead-update mislukt (${response ? response.status : 'geen response'}).`,
        'INSTANTLY_LEAD_UPDATE_FAILED',
        response && response.status ? response.status : 502,
        { data }
      );
    }

    return data;
  }

  function getExistingInstantlyRowsForVariableRefresh(rows, limit) {
    const safeLimit = clampNumber(limit, config.batchSize, 1, Math.max(config.batchSize, 50));
    return (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        id: getRowId(row, index, normalizeString),
        index,
        row,
        leadId: normalizeString(row && row.instantlyLeadId),
        campaignId: normalizeString(row && row.instantlyCampaignId),
      }))
      .filter((item) => {
        if (!item.leadId) return false;
        if (!hasActiveInstantlyOutreach(item.row)) return false;
        if (item.campaignId && item.campaignId !== config.defaultCampaignId) return false;
        return true;
      })
      .slice(0, safeLimit);
  }

  async function refreshExistingInstantlyLeadVariables(rows, context, limit) {
    const candidates = getExistingInstantlyRowsForVariableRefresh(rows, limit);
    let refreshed = 0;
    const failed = [];
    for (const item of candidates) {
      try {
        const lead = await buildInstantlyLead(item, context);
        await patchInstantlyLeadById(item.leadId, lead);
        refreshed += 1;
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row, normalizeString),
          email: getRowEmail(item.row, normalizeString),
          error:
            normalizeString(error && error.message) ||
            'Instantly-lead mist verplichte Softora-variabelen.',
          missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        });
      }
    }
    return {
      refreshed,
      attempted: candidates.length,
      failed,
    };
  }

  function getManualUploadCampaignId(input = {}) {
    return normalizeString(input.campaignId || input.campaign || input.defaultCampaignId || config.defaultCampaignId);
  }

  function buildSafeUploadId() {
    return `instantly-upload-${now().toISOString().replace(/[^0-9a-z]+/gi, '').slice(0, 15)}`;
  }

  function buildSafeUploadFileName(count, uploadId) {
    const cleanUploadId = normalizeString(uploadId).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
    return `softora-instantly-${Math.max(0, Number(count) || 0)}-leads-${cleanUploadId || 'upload'}.csv`;
  }

  function flattenInstantlyLeadForCsv(lead) {
    const variables = lead && lead.custom_variables && typeof lead.custom_variables === 'object'
      ? lead.custom_variables
      : {};
    return {
      email: lead && lead.email,
      first_name: lead && lead.first_name,
      last_name: lead && lead.last_name,
      company_name: lead && lead.company_name,
      company: lead && lead.company_name,
      phone: lead && lead.phone,
      website: lead && lead.website,
      personalization: lead && lead.personalization,
      ...variables,
    };
  }

  function buildInstantlyUploadCsv(leads) {
    const rows = [INSTANTLY_SAFE_UPLOAD_CSV_HEADERS.join(',')];
    (Array.isArray(leads) ? leads : []).forEach((lead) => {
      const flat = flattenInstantlyLeadForCsv(lead);
      rows.push(
        INSTANTLY_SAFE_UPLOAD_CSV_HEADERS.map((header) => escapeCsvValue(flat[header])).join(',')
      );
    });
    return rows.join('\n');
  }

  function buildPermanentInstantlyRecipientGuard(item, options = {}) {
    const row = item && item.row;
    const email = getRowEmail(row, normalizeString);
    if (!email) return null;
    const id = getRowId(row, item.index, normalizeString);
    const company = getRowCompany(row, normalizeString);
    const domain = getRowDomain(row, normalizeString) || getEmailDomain(email);
    return {
      at: normalizeString(options.at) || now().toISOString(),
      senderEmail: '',
      recipientKey: `email:${email}`,
      recipientEmail: email,
      recipientDomain: normalizeColdmailGuardKeyPart(domain, normalizeString),
      recipientId: normalizeColdmailGuardKeyPart(id, normalizeString),
      recipientCompanyKey: normalizeColdmailGuardKeyPart(company, normalizeString),
      recipientCompany: truncateText(company, 160),
      permanent: true,
      source: normalizeString(options.source) || INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
      provider: 'instantly',
      campaignId: normalizeString(options.campaignId),
      leadId: normalizeString(options.leadId),
      uploadId: normalizeString(options.uploadId),
    };
  }

  async function savePermanentInstantlyRecipientGuards(items, options = {}) {
    const at = normalizeString(options.at) || now().toISOString();
    const leadIdByEmail = options.leadIdByEmail instanceof Map ? options.leadIdByEmail : new Map();
    const recipientEntries = (Array.isArray(items) ? items : [])
      .map((item) => {
        const email = getRowEmail(item && item.row, normalizeString);
        return buildPermanentInstantlyRecipientGuard(item, {
          ...options,
          at,
          leadId: leadIdByEmail.get(email) || normalizeString(options.leadId),
        });
      })
      .filter(Boolean);
    if (!recipientEntries.length) return { count: 0 };

    const write = await setUiStateValues(
      coldmailSendGuardScope,
      {
        [coldmailSendGuardKey]: JSON.stringify({
          updatedAt: at,
          source: normalizeString(options.source) || INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
          actor: normalizeString(options.actor),
          provider: 'instantly',
          campaignId: normalizeString(options.campaignId),
          uploadId: normalizeString(options.uploadId),
          recipientEntries,
          entries: [],
        }),
      },
      {
        source: normalizeString(options.source) || INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
        actor: normalizeString(options.actor),
      }
    );
    if (!write) {
      throw createInstantlyError(
        'Instantly upload kon niet veilig worden vastgezet in de duplicate-guard.',
        'INSTANTLY_SAFE_GUARD_WRITE_FAILED',
        502
      );
    }
    return { count: recipientEntries.length };
  }

  function markRowsAsPreparedForInstantlyUpload(rows, selectedRows, options = {}) {
    const preparedAt = normalizeString(options.at) || now().toISOString();
    const campaignId = normalizeString(options.campaignId);
    const uploadId = normalizeString(options.uploadId);
    const selectedByIndex = new Map((Array.isArray(selectedRows) ? selectedRows : []).map((item) => [item.index, item]));
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
      const item = selectedByIndex.get(index);
      if (!item) return row;
      const historyEntry = buildHistoryEntry(
        {
          type: 'gemaild',
          label: INSTANTLY_SAFE_MANUAL_UPLOAD_LABEL,
          actor: options.actor,
          source: INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
          messageKey: `${INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE}:${campaignId}:${uploadId}:${item.id}`,
          subject: 'Instantly veilige upload',
          preview:
            'Lead is via de veilige Softora-route gereserveerd voor Instantly en permanent geblokkeerd voor dubbele Softora-coldmail.',
        },
        { normalizeString, truncateText, now: () => new Date(preparedAt) }
      );
      return {
        ...row,
        instantlyLeadId: normalizeString(row.instantlyLeadId),
        instantlyCampaignId: campaignId,
        instantlyStatus: chooseInstantlyStatus(row.instantlyStatus, 'queued'),
        instantlySyncedAt: normalizeString(row.instantlySyncedAt) || preparedAt,
        instantlyLastEventAt: preparedAt,
        instantlyManualUploadId: uploadId,
        instantlyManualUploadPreparedAt: preparedAt,
        lastColdmailProvider: 'instantly',
        lastColdmailProviderStatus: 'queued',
        ...buildInstantlyApproachedFields(row, preparedAt),
        updatedAt: preparedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });
  }

  async function prepareInstantlyUploadUnlocked(input = {}) {
    const actor = normalizeString(input.actor) || 'Instantly veilige upload';
    const campaignId = getManualUploadCampaignId(input);
    if (!campaignId) {
      throw createInstantlyError(
        'Instantly campaign ID ontbreekt. Gebruik de veilige Softora-route met een campaignId, zodat guards goed worden vastgezet.',
        'INSTANTLY_CAMPAIGN_ID_REQUIRED',
        400
      );
    }
    const limit = clampNumber(input.limit, DEFAULT_MANUAL_UPLOAD_LIMIT, 1, MAX_MANUAL_UPLOAD_LIMIT);
    const uploadId = normalizeString(input.uploadId) || buildSafeUploadId();
    const preparedAt = now().toISOString();
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    const personalizationContext = await loadPersonalizationContext(rows);
    const { selectedRows, failed } = await collectEligibleRows(rows, limit, personalizationContext);
    const leads = [];
    const sendableRows = [];

    for (const item of selectedRows) {
      try {
        const lead = assertInstantlyLeadReady(await buildInstantlyLead(item, personalizationContext));
        leads.push(lead);
        sendableRows.push(item);
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row, normalizeString),
          email: getRowEmail(item.row, normalizeString),
          error:
            normalizeString(error && error.message) ||
            'Instantly-lead mist verplichte Softora-variabelen.',
          missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        });
      }
    }

    if (sendableRows.length < limit) {
      const available = sendableRows.length;
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: available > 0 ? 'insufficient_eligible_leads' : 'no_eligible_leads',
        message: `Zet eerst genoeg mail-ready leads klaar. Gevraagd: ${limit}, veilig klaar: ${available}.`,
        prepared: 0,
        available,
        requested: limit,
        failed,
        campaignId,
        finishedAt: preparedAt,
      };
      return lastSyncResult;
    }

    const guardWrite = await savePermanentInstantlyRecipientGuards(sendableRows, {
      at: preparedAt,
      actor,
      campaignId,
      uploadId,
      source: INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
    });
    const nextRows = markRowsAsPreparedForInstantlyUpload(rows, sendableRows, {
      at: preparedAt,
      actor,
      campaignId,
      uploadId,
    });
    const customerWrite = await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows, customerDbKey),
      {
        source: INSTANTLY_SAFE_MANUAL_UPLOAD_SOURCE,
        actor,
      }
    );
    if (!customerWrite) {
      throw createInstantlyError(
        'Instantly upload is wel in de guard gezet, maar de database-status kon niet worden bijgewerkt.',
        'INSTANTLY_SAFE_CUSTOMER_WRITE_FAILED',
        502
      );
    }

    lastSyncResult = {
      ok: true,
      prepared: sendableRows.length,
      markedBenaderd: sendableRows.length,
      permanentGuards: guardWrite.count,
      failed,
      campaignId,
      uploadId,
      fileName: buildSafeUploadFileName(sendableRows.length, uploadId),
      csvHeaders: INSTANTLY_SAFE_UPLOAD_CSV_HEADERS,
      csv: buildInstantlyUploadCsv(leads),
      leads: sendableRows.map((item) => ({
        id: item.id,
        bedrijf: getRowCompany(item.row, normalizeString),
        email: getRowEmail(item.row, normalizeString),
      })),
      finishedAt: preparedAt,
    };
    return lastSyncResult;
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
          type: 'gemaild',
          label: 'Lead via Instantly benaderd',
          actor,
          source: 'instantly-sync',
          messageKey: `instantly-sync:${config.defaultCampaignId}:${item.id}`,
          subject: 'Instantly sync',
          preview: 'Lead is aan de Instantly-campaign toegevoegd en in Softora als benaderd vastgezet.',
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
        ...buildInstantlyApproachedFields(row, syncedAt),
        updatedAt: syncedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });
  }

  function markRowsAsRemovedFromInstantly(rows, removedRows, actor) {
    const removedAt = now().toISOString();
    const removedByIndex = new Map(removedRows.map((item) => [item.index, item]));
    return rows.map((row, index) => {
      const item = removedByIndex.get(index);
      if (!item) return row;
      const removedLeadId = normalizeString(item.leadId) || normalizeString(row.instantlyLeadId);
      const removedCampaignId =
        normalizeString(item.campaignId) || normalizeString(row.instantlyCampaignId) || config.defaultCampaignId;
      const historyEntry = buildHistoryEntry(
        {
          type: 'instantly_verwijderd',
          label: 'Instantly duplicate verwijderd',
          actor,
          source: 'instantly-dedupe-cleanup',
          messageKey: `instantly-dedupe-cleanup:${removedCampaignId}:${item.id}:${removedLeadId}`,
          subject: 'Instantly duplicate cleanup',
          preview:
            'Lead had al Softora coldmail/open-tracking en is daarom uit Instantly verwijderd om dubbele outreach te voorkomen.',
        },
        { normalizeString, truncateText, now: () => new Date(removedAt) }
      );

      return {
        ...row,
        instantlyLeadId: '',
        instantlyCampaignId: '',
        instantlyStatus: '',
        instantlySyncedAt: '',
        instantlyLastEventAt: '',
        instantlyEmailSentAt: '',
        lastColdmailProvider:
          normalizeString(row.lastColdmailProvider).toLowerCase() === 'instantly'
            ? ''
            : row.lastColdmailProvider,
        lastColdmailProviderStatus:
          normalizeString(row.lastColdmailProvider).toLowerCase() === 'instantly'
            ? ''
            : row.lastColdmailProviderStatus,
        instantlyRemovedAt: removedAt,
        instantlyRemovedLeadId: removedLeadId,
        instantlyRemovedCampaignId: removedCampaignId,
        instantlyRemovedReason: 'prior_softora_coldmail',
        updatedAt: removedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });
  }

  async function cleanupPriorColdmailInstantlyRows(rows, actor) {
    const riskyRows = getPriorColdmailInstantlyRows(rows);
    if (!riskyRows.length) {
      return {
        rows,
        removed: 0,
        deletedCount: 0,
        removedLeadIds: [],
      };
    }

    const removedLeadIds = riskyRows.map((item) => item.leadId);
    const data = await deleteInstantlyLeadsByIds(removedLeadIds);
    const deletedCount = Math.max(0, Number(data && data.count) || 0);
    return {
      rows: markRowsAsRemovedFromInstantly(rows, riskyRows, actor),
      removed: riskyRows.length,
      deletedCount,
      removedLeadIds,
    };
  }

  function buildInstantlyApproachedFields(row, date) {
    const currentStatus = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';
    const nextStatus = canAdvanceContactStatus(currentStatus, 'gemaild') ? 'gemaild' : currentStatus;
    return {
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      mail: true,
      coldmailCampaignStartedAt: normalizeString(row.coldmailCampaignStartedAt) || date,
      campaignType: 'webdesign',
      campaign_type: 'webdesign',
      outreachCampaignType: 'webdesign',
      outreach_campaign_type: 'webdesign',
      coldmailSpecialAction: 'webdesign',
      outreachStatus: 'benaderd',
      actionRequired: false,
      outreachActionRequired: false,
    };
  }

  function isMarkedAsInstantlyApproached(row) {
    return (
      normalizeContactStatus(row && (row.databaseStatus || row.status), row) === 'gemaild' &&
      normalizeContactStatus(row && row.outreachStatus, row) === 'gemaild' &&
      normalizeString(row && row.lastColdmailProvider).toLowerCase() === 'instantly'
    );
  }

  function markExistingInstantlyRowsAsApproached(rows, actor) {
    const markedAt = now().toISOString();
    let marked = 0;
    const nextRows = (Array.isArray(rows) ? rows : []).map((row, index) => {
      if (!hasActiveInstantlyOutreach(row)) return row;
      if (isMarkedAsInstantlyApproached(row)) return row;
      const currentStatus = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';
      if (!canAdvanceContactStatus(currentStatus, 'gemaild')) return row;

      marked += 1;
      const id = getRowId(row, index, normalizeString);
      const instantlyStatus = normalizeInstantlyStatus(row.instantlyStatus, normalizeString) || 'synced';
      const historyEntry = buildHistoryEntry(
        {
          type: 'gemaild',
          label: 'Instantly-lead als benaderd bijgewerkt',
          actor,
          source: 'instantly-sync',
          messageKey: `instantly-benaderd:${config.defaultCampaignId}:${id}`,
          subject: 'Instantly status',
          preview: 'Lead stond al in Instantly en is in Softora als benaderd vastgezet.',
        },
        { normalizeString, truncateText, now: () => new Date(markedAt) }
      );

      return {
        ...row,
        instantlyCampaignId: normalizeString(row.instantlyCampaignId) || config.defaultCampaignId,
        instantlyLastEventAt: normalizeString(row.instantlyLastEventAt) || markedAt,
        lastColdmailProvider: 'instantly',
        lastColdmailProviderStatus: normalizeString(row.lastColdmailProviderStatus) || instantlyStatus,
        ...buildInstantlyApproachedFields(row, markedAt),
        updatedAt: markedAt,
        hist: mergeHistory(row, historyEntry, normalizeString),
      };
    });

    return { rows: nextRows, marked };
  }

  async function syncInstantlyLeads(input = {}) {
    if (syncPromise) return syncPromise;
    syncPromise = runExclusiveInstantlyOperation(() => syncInstantlyLeadsUnlocked(input));
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function prepareInstantlyUpload(input = {}) {
    return runExclusiveInstantlyOperation(() => prepareInstantlyUploadUnlocked(input));
  }

  async function runExclusiveInstantlyOperation(factory) {
    if (operationPromise) {
      throw createInstantlyError(
        'Er loopt al een Instantly-operatie. Wacht tot die klaar is voordat je opnieuw leads klaarzet.',
        'INSTANTLY_OPERATION_ALREADY_RUNNING',
        409
      );
    }
    operationPromise = Promise.resolve().then(factory);
    try {
      return await operationPromise;
    } finally {
      operationPromise = null;
    }
  }

  async function syncInstantlyLeadsUnlocked(input = {}) {
    assertSyncAllowed();

    const actor = normalizeString(input.actor) || 'Instantly sync';
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    let rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    if (readBool(input.refreshExistingOnly, false)) {
      const personalizationContext = await loadPersonalizationContext(rows);
      const existingVariableRefresh = await refreshExistingInstantlyLeadVariables(
        rows,
        personalizationContext,
        input.refreshExistingLimit || config.batchSize
      );
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'refreshed_existing_variables',
        synced: 0,
        markedBenaderd: 0,
        refreshedExistingVariables: existingVariableRefresh.refreshed,
        attemptedExistingVariableRefresh: existingVariableRefresh.attempted,
        failed: existingVariableRefresh.failed || [],
        campaignId: config.defaultCampaignId,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    const remoteReconcile = await reconcileRemoteInstantlyCampaignRows(rows, actor);
    rows = remoteReconcile.rows;
    const priorColdmailCleanup = await cleanupPriorColdmailInstantlyRows(rows, actor);
    rows = priorColdmailCleanup.rows;
    const existingApproached = markExistingInstantlyRowsAsApproached(rows, actor);
    rows = existingApproached.rows;

    if (remoteReconcile.removed || remoteReconcile.backfilled || priorColdmailCleanup.removed) {
      await setUiStateValues(
        customerDbScope,
        buildCustomerRowsStateValues(values, rows, customerDbKey),
        {
          source: remoteReconcile.removed || remoteReconcile.backfilled
            ? 'instantly-remote-reconcile'
            : 'instantly-dedupe-cleanup',
          actor,
        }
      );
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason:
          remoteReconcile.removed || remoteReconcile.backfilled
            ? 'remote_instantly_reconcile'
            : 'prior_coldmail_cleanup',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
        remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
        removedRemoteInstantlyLeads: remoteReconcile.removed,
        backfilledRemoteInstantlyLeads: remoteReconcile.backfilled,
        removedPriorColdmailFromInstantly: priorColdmailCleanup.removed,
        instantlyDeletedCount: remoteReconcile.deletedCount + priorColdmailCleanup.deletedCount,
        campaignId: config.defaultCampaignId,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    if (readBool(input.reconcileOnly || input.cleanupOnly, false)) {
      if (existingApproached.marked) {
        await setUiStateValues(
          customerDbScope,
          buildCustomerRowsStateValues(values, rows, customerDbKey),
          {
            source: 'instantly-remote-reconcile',
            actor,
          }
        );
      }
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'reconcile_only',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
        remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
        removedRemoteInstantlyLeads: 0,
        backfilledRemoteInstantlyLeads: 0,
        removedPriorColdmailFromInstantly: 0,
        instantlyDeletedCount: 0,
        campaignId: config.defaultCampaignId,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    const syncedToday = getDailySyncCount(rows);
    const dailyRemaining = Math.max(0, config.dailyCap - syncedToday);
    const requestedLimit = clampNumber(input.limit, config.batchSize, 1, config.batchSize);
    const limit = Math.min(config.batchSize, requestedLimit, dailyRemaining);
    const personalizationContext = await loadPersonalizationContext(rows);
    const existingVariableRefresh = readBool(input.refreshExistingVariables, false)
      ? await refreshExistingInstantlyLeadVariables(
          rows,
          personalizationContext,
          input.refreshExistingLimit || config.batchSize
        )
      : { refreshed: 0, attempted: 0 };

    if (limit <= 0) {
      if (existingApproached.marked) {
        await setUiStateValues(
          customerDbScope,
          buildCustomerRowsStateValues(values, rows, customerDbKey),
          {
            source: 'instantly-sync',
            actor,
          }
        );
      }
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'daily_cap_reached',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
        remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
        refreshedExistingVariables: existingVariableRefresh.refreshed,
        attemptedExistingVariableRefresh: existingVariableRefresh.attempted,
        failed: existingVariableRefresh.failed || [],
        syncedToday,
        dailyCap: config.dailyCap,
        finishedAt: now().toISOString(),
      };
      return lastSyncResult;
    }

    const { selectedRows, failed } = await collectEligibleRows(rows, limit, personalizationContext);
    if (!selectedRows.length) {
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'no_eligible_leads',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
        remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
        refreshedExistingVariables: existingVariableRefresh.refreshed,
        attemptedExistingVariableRefresh: existingVariableRefresh.attempted,
        failed,
        finishedAt: now().toISOString(),
      };
      if (existingApproached.marked) {
        await setUiStateValues(
          customerDbScope,
          buildCustomerRowsStateValues(values, rows, customerDbKey),
          {
            source: 'instantly-sync',
            actor,
          }
        );
      }
      return lastSyncResult;
    }

    const leads = [];
    const sendableRows = [];
    for (const item of selectedRows) {
      try {
        const lead = assertInstantlyLeadReady(await buildInstantlyLead(item, personalizationContext));
        leads.push(lead);
        sendableRows.push(item);
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row, normalizeString),
          email: getRowEmail(item.row, normalizeString),
          error:
            normalizeString(error && error.message) ||
            'Instantly-lead mist verplichte Softora-variabelen.',
          missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        });
      }
    }
    if (!leads.length) {
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'no_eligible_leads',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
        remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
        refreshedExistingVariables: existingVariableRefresh.refreshed,
        attemptedExistingVariableRefresh: existingVariableRefresh.attempted,
        failed,
        finishedAt: now().toISOString(),
      };
      if (existingApproached.marked) {
        await setUiStateValues(
          customerDbScope,
          buildCustomerRowsStateValues(values, rows, customerDbKey),
          {
            source: 'instantly-sync',
            actor,
          }
        );
      }
      return lastSyncResult;
    }
    const data = await addLeadsToInstantly(leads);
    const leadIdByEmail = buildLeadIdByEmail(data);
    await savePermanentInstantlyRecipientGuards(sendableRows, {
      actor,
      campaignId: config.defaultCampaignId,
      leadIdByEmail,
      source: 'instantly-sync',
    });
    const nextRows = markRowsAsSynced(rows, sendableRows, data, actor);
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues(values, nextRows, customerDbKey),
      {
        source: 'instantly-sync',
        actor,
      }
    );

    lastSyncResult = {
      ok: true,
      synced: sendableRows.length,
      markedBenaderd: existingApproached.marked + sendableRows.length,
      remoteInstantlyLeadCount: remoteReconcile.remoteLeadCount,
      remoteInstantlyUnmatchedCount: remoteReconcile.unmatched,
      refreshedExistingVariables: existingVariableRefresh.refreshed,
      attemptedExistingVariableRefresh: existingVariableRefresh.attempted,
      failed,
      campaignId: config.defaultCampaignId,
      dailyCap: config.dailyCap,
      syncedToday: syncedToday + sendableRows.length,
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
      buildCustomerRowsStateValues(values, nextRows, customerDbKey),
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
    if (!config.enabled || !config.syncEnabled || !config.schedulerEnabled || !isConfigured()) return;
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
    const activeInstantlyRows = rows.filter((row) => hasActiveInstantlyOutreach(row)).length;
    const approachedInstantlyRows = rows.filter((row) => isMarkedAsInstantlyApproached(row)).length;
    const priorColdmailInstantlyRiskRows = getPriorColdmailInstantlyRows(rows).length;
    return {
      ok: true,
      enabled: config.enabled,
      syncEnabled: config.syncEnabled,
      configured: isConfigured(),
      missing: getMissingConfig(),
      campaignId: config.defaultCampaignId,
      apiBaseUrl: config.apiBaseUrl,
      schedulerEnabled: config.schedulerEnabled,
      intervalMinutes: config.intervalMinutes,
      batchSize: config.batchSize,
      dailyCap: config.dailyCap,
      dailyCapTimeZone: config.dailyCapTimeZone,
      safeManualUploadEnabled: true,
      safeManualUploadRequiresApi: false,
      safeManualUploadMaxLimit: MAX_MANUAL_UPLOAD_LIMIT,
      verifyLeadsOnImport: config.verifyLeadsOnImport,
      blockPersonalMailboxDomains: config.blockPersonalMailboxDomains,
      requireWebdesignAssets: config.requireWebdesignAssets,
      prewarmPublicImageUrls: config.prewarmPublicImageUrls,
      defaultSenderEmail: config.defaultSenderEmail,
      marksSyncedLeadsAsApproached: true,
      activeInstantlyRows,
      approachedInstantlyRows,
      priorColdmailInstantlyRiskRows,
      syncedToday: getDailySyncCount(rows),
      nextSyncAt,
      running: Boolean(syncPromise || operationPromise),
      lastSync: lastSyncResult,
    };
  }

  if (config.enabled && config.syncEnabled && config.schedulerEnabled) {
    startAutopilot();
  }

  return {
    getMissingConfig,
    getStatus,
    handleInstantlyWebhook,
    isConfigured,
    prepareInstantlyUpload,
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
