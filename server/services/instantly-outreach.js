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

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_COLDMAILING_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const DEFAULT_COLDMAILING_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
const DEFAULT_COLDMAIL_AUTOPILOT_SCOPE = 'premium_coldmail_autopilot';
const DEFAULT_COLDMAIL_AUTOPILOT_KEY = 'softora_coldmail_autopilot_v1';
const DEFAULT_API_BASE_URL = 'https://api.instantly.ai/api/v2';
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const DEFAULT_SYNC_BATCH_SIZE = 10;
const DEFAULT_DAILY_CAP = 25;
const DEFAULT_DAILY_CAP_TIME_ZONE = 'Europe/Amsterdam';
const DEFAULT_PUBLIC_BASE_URL = 'https://www.softora.nl';
const DEFAULT_COLDMAIL_LINK_SECRET = 'softora-coldmail';
const COLDMAIL_UNSUBSCRIBE_PATH = '/afmelden';
const COLDMAIL_PREVIEW_IMAGE_PATH = '/coldmailing/webdesign-foto';
const COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_OPT_OUT_TEXT_PREFIX = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_MOCKUP_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';
const COLDMAIL_IMAGE_VISIBILITY_PS =
  'PS: Zie je het webdesign niet? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊';
const COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN =
  /PS:\s*(?:als het webdesign niet zichtbaar is,\s*klik op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in het scherm\.?|zie je het webdesign niet\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm\s*😊?)/i;
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
const DEFAULT_INSTANTLY_SENDER_EMAIL = 'serve@softora.nl';
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

function parseDataUrlImage(value, normalizeString = defaultNormalizeString) {
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(normalizeString(value));
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

function getWebdesignMockupQuality(photo, normalizeString = defaultNormalizeString) {
  const meta = photo && photo.legacyMeta && typeof photo.legacyMeta === 'object' ? photo.legacyMeta : {};
  const mockup = meta.mockup && typeof meta.mockup === 'object' ? meta.mockup : {};
  return {
    renderer: normalizeString(photo && (photo.mockupRenderer || photo.websiteMockupRenderer) || mockup.renderer || meta.mockupRenderer).toLowerCase(),
    orientation: normalizeString(photo && (photo.mockupOrientation || photo.websiteMockupOrientation) || mockup.orientation || meta.mockupOrientation).toLowerCase(),
    status: normalizeString(photo && (photo.mockupQualityStatus || photo.websiteMockupQualityStatus) || mockup.qualityStatus || meta.mockupQualityStatus).toLowerCase(),
    checkedAt: normalizeString(photo && (photo.mockupQualityCheckedAt || photo.websiteMockupQualityCheckedAt) || mockup.qualityCheckedAt || meta.mockupQualityCheckedAt),
  };
}

function isApprovedWebdesignMockupRecord(photo, normalizeString = defaultNormalizeString) {
  if (!isResolvableWebsitePhotoValue(getWebdesignMockupSource(photo, normalizeString), normalizeString)) return false;
  const quality = getWebdesignMockupQuality(photo, normalizeString);
  const hasQualitySignal = Boolean(quality.renderer || quality.orientation || quality.status || quality.checkedAt);
  if (!hasQualitySignal) {
    const meta = photo && photo.legacyMeta && typeof photo.legacyMeta === 'object' ? photo.legacyMeta : {};
    const mockup = meta.mockup && typeof meta.mockup === 'object' ? meta.mockup : {};
    const name = normalizeString(photo && (photo.websiteMockupName || photo.mockupName) || mockup.fileName || meta.websiteMockupName);
    return /-device-mockup-v6\.jpe?g$/i.test(name);
  }
  if (quality.status !== 'checked' && quality.status !== 'verified' && quality.status !== 'ok') return false;
  if (quality.orientation && quality.orientation !== 'upright') return false;
  return true;
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

function normalizeImageVisibilityPsInMailText(text, normalizeString = defaultNormalizeString) {
  return normalizeString(text).replace(COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN, COLDMAIL_IMAGE_VISIBILITY_PS);
}

function ensureImageVisibilityPsInMailText(text, city, normalizeString = defaultNormalizeString) {
  const cleanText = normalizeImageVisibilityPsInMailText(text, normalizeString);
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
    return `${cleanText}\n\n${COLDMAIL_IMAGE_VISIBILITY_PS}`;
  }
  lines.splice(insertAt, 0, '', COLDMAIL_IMAGE_VISIBILITY_PS);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeInstantlyMailText(text, city, normalizeString = defaultNormalizeString) {
  return ensureImageVisibilityPsInMailText(
    ensurePinnedCityInMailText(
      normalizeSenderNameInMailText(text, normalizeString),
      city,
      normalizeString
    ),
    city,
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
    [defaultSenderEmail, senderEmail],
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
  const senderProfile = pickColdmailProfileForSender(config.senderProfiles, senderEmails, normalizeString);
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

function buildColdmailPreviewImageUrl(row, id, reference, config, type, normalizeString = defaultNormalizeString, now = () => new Date()) {
  const token = buildColdmailToken(
    row,
    id,
    reference,
    config.coldmailLinkSecret,
    { type: type === 'mockup' ? 'mockup' : 'webdesign' },
    normalizeString,
    now
  );
  return `${config.publicBaseUrl}${COLDMAIL_PREVIEW_IMAGE_PATH}?t=${encodeURIComponent(token)}`;
}

function buildInstantlyBodyWithWebdesignLinks({ baseText, webdesignImageUrl, webdesignMockupUrl, unsubscribeUrl }, normalizeString = defaultNormalizeString) {
  const parts = [normalizeString(baseText)];
  if (webdesignImageUrl) parts.push(webdesignImageUrl);
  if (webdesignMockupUrl) parts.push(COLDMAIL_MOCKUP_CAPTION, webdesignMockupUrl);
  const body = parts.filter(Boolean).join('\n\n');
  return appendColdmailOptOutText(body, unsubscribeUrl, normalizeString);
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

function renderMailTextAsHtml(text, normalizeString = defaultNormalizeString) {
  const body = normalizeString(text)
    .split(/\n{2,}/)
    .map((paragraph) =>
      `<p>${paragraph
        .split('\n')
        .map((line) => {
          const cleanLine = normalizeString(line);
          if (cleanLine === COLDMAIL_IMAGE_VISIBILITY_PS) {
            return `<em style="font-style:italic;">${escapeHtml(cleanLine, normalizeString)}</em>`;
          }
          return escapeHtml(cleanLine, normalizeString);
        })
        .join('<br>')}</p>`
    )
    .join('\n');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;">${body}</div>`;
}

function renderImageHtml(src, alt, margin = '24px 0 0 0', normalizeString = defaultNormalizeString) {
  const cleanSrc = normalizeString(src);
  if (!cleanSrc) return '';
  return `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:${margin};"><tr><td style="padding:0;margin:0;width:100%;font-size:0;line-height:0;overflow:visible;"><img src="${escapeHtmlAttribute(
    cleanSrc,
    normalizeString
  )}" alt="${escapeHtmlAttribute(
    alt,
    normalizeString
  )}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:none;border:0;outline:none;text-decoration:none;border-radius:12px;object-fit:contain;" /></td></tr></table>`;
}

function buildInstantlyEmailHtml(
  { baseText, company, webdesignImageUrl, webdesignMockupUrl, unsubscribeUrl },
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
  const mockupHtml = webdesignMockupUrl
    ? `\n<p style="margin:20px 0 7px 0;font-size:16px;line-height:1.45;color:#1a1a2e;font-weight:700;">${escapeHtml(
        COLDMAIL_MOCKUP_CAPTION,
        normalizeString
      )}</p>${renderImageHtml(webdesignMockupUrl, `${company || 'Bedrijf'} device mockup`, '0', normalizeString)}`
    : '';
  return `${renderMailTextAsHtml(baseText, normalizeString)}${renderImageHtml(
    webdesignImageUrl,
    `${company || 'Bedrijf'} webdesign`,
    '24px 0 0 0',
    normalizeString
  )}${mockupHtml}${optOut}`;
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
    publicBaseUrl: normalizePublicBaseUrl(config.publicBaseUrl) || DEFAULT_PUBLIC_BASE_URL,
    coldmailLinkSecret: defaultNormalizeString(config.coldmailLinkSecret) || DEFAULT_COLDMAIL_LINK_SECRET,
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
    resolveEmailDomain = resolveEmailDomainWithDns,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
    coldmailingSettingsScope = DEFAULT_COLDMAILING_SETTINGS_SCOPE,
    coldmailingSettingsKey = DEFAULT_COLDMAILING_SETTINGS_KEY,
    coldmailAutopilotScope = DEFAULT_COLDMAIL_AUTOPILOT_SCOPE,
    coldmailAutopilotKey = DEFAULT_COLDMAIL_AUTOPILOT_KEY,
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

  function hasExternalColdmailHistoryBeforeInstantly(row) {
    const syncedAtMs = parseTimestampMs(row && row.instantlySyncedAt);
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    if (
      history.some((item) => {
        const text = getHistorySearchText(item);
        if (!isPriorColdmailHistoryText(text) || isInstantlyHistoryText(text)) return false;
        const eventMs = parseTimestampMs(item && (item.date || item.timestamp || item.createdAt || item.created_at));
        return !syncedAtMs || !eventMs || eventMs < syncedAtMs;
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
    ].some((value) => isBeforeReferenceDate(value, syncedAtMs));
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

  async function loadPersonalizationContext(rows = []) {
    const [photoMap, mailProfile] = await Promise.all([
      loadCustomerPhotoMap(rows),
      loadColdmailProfile(),
    ]);
    return {
      photoMap,
      photosByIdentity: buildPhotosByIdentity(photoMap, normalizeString),
      mailProfile,
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

  function buildInstantlyLead(item, context = {}) {
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
    const subjectTemplate =
      normalizeString(context.mailProfile && context.mailProfile.subject) || DEFAULT_WEBDESIGN_SUBJECT;
    const bodyTemplate =
      normalizeString(context.mailProfile && context.mailProfile.body) || DEFAULT_WEBDESIGN_BODY;
    const city = getRowCity(row, normalizeString) || 'uw regio';
    const subject = personalizeTemplate(subjectTemplate, row, normalizeString);
    const baseMailBody = normalizeInstantlyMailText(
      buildMailText(bodyTemplate, row, normalizeString),
      city,
      normalizeString
    );
    const assets = getReadyWebdesignAssets(item, context);
    const webdesignImageUrl = assets.ready
      ? buildColdmailPreviewImageUrl(row, item.id, reference, config, 'webdesign', normalizeString, now)
      : '';
    const webdesignMockupUrl = assets.ready
      ? buildColdmailPreviewImageUrl(row, item.id, reference, config, 'mockup', normalizeString, now)
      : '';
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
      softora_instantly_email_body: instantlyEmailBody,
      softora_instantly_email_html: instantlyEmailHtml,
      softora_image_visibility_ps: COLDMAIL_IMAGE_VISIBILITY_PS,
      softora_reference: reference,
      softora_unsubscribe_url: unsubscribeUrl,
      softora_webdesign_image_url: webdesignImageUrl,
      softora_webdesign_mockup_url: webdesignMockupUrl,
      softora_mockup_caption: COLDMAIL_MOCKUP_CAPTION,
      softora_website_domain: getRowDomain(row, normalizeString),
      softora_webdesign_ready: assets.ready ? 'true' : 'false',
    };

    return {
      email,
      personalization: instantlyEmailBody,
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
      const removedLeadId = normalizeString(row.instantlyLeadId);
      const removedCampaignId = normalizeString(row.instantlyCampaignId) || config.defaultCampaignId;
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
    syncPromise = syncInstantlyLeadsUnlocked(input);
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function syncInstantlyLeadsUnlocked(input = {}) {
    assertSyncAllowed();

    const actor = normalizeString(input.actor) || 'Instantly sync';
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    let rows = parseDatabaseRows(values, customerDbKey, normalizeString);
    const priorColdmailCleanup = await cleanupPriorColdmailInstantlyRows(rows, actor);
    rows = priorColdmailCleanup.rows;
    const existingApproached = markExistingInstantlyRowsAsApproached(rows, actor);
    rows = existingApproached.rows;

    if (priorColdmailCleanup.removed) {
      await setUiStateValues(
        customerDbScope,
        buildCustomerRowsStateValues(values, rows, customerDbKey),
        {
          source: 'instantly-dedupe-cleanup',
          actor,
        }
      );
      lastSyncResult = {
        ok: true,
        skipped: true,
        reason: 'prior_coldmail_cleanup',
        synced: 0,
        markedBenaderd: existingApproached.marked,
        removedPriorColdmailFromInstantly: priorColdmailCleanup.removed,
        instantlyDeletedCount: priorColdmailCleanup.deletedCount,
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

    const leads = selectedRows.map((item) => buildInstantlyLead(item, personalizationContext));
    const data = await addLeadsToInstantly(leads);
    const nextRows = markRowsAsSynced(rows, selectedRows, data, actor);
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
      synced: selectedRows.length,
      markedBenaderd: existingApproached.marked + selectedRows.length,
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
      verifyLeadsOnImport: config.verifyLeadsOnImport,
      blockPersonalMailboxDomains: config.blockPersonalMailboxDomains,
      requireWebdesignAssets: config.requireWebdesignAssets,
      defaultSenderEmail: config.defaultSenderEmail,
      marksSyncedLeadsAsApproached: true,
      activeInstantlyRows,
      approachedInstantlyRows,
      priorColdmailInstantlyRiskRows,
      syncedToday: getDailySyncCount(rows),
      nextSyncAt,
      running: Boolean(syncPromise),
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
