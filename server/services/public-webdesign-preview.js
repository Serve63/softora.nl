const crypto = require('crypto');

const PHOTO_SCOPE = 'premium_database_photos';
const PHOTO_KEY = 'softora_database_photos_v1';
const CUSTOMER_SCOPE = 'premium_customers_database';
const CUSTOMER_KEY = 'softora_customers_premium_v1';
const PUBLIC_PREVIEW_READ_FAILURE_COOLDOWN_PREFIX = 'public_webdesign_preview';
const PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS = Object.freeze({
  bypassReadFailureCooldown: true,
  bypassReadCache: true,
  suppressReadFailureCooldown: true,
  suppressStaleReadCacheLog: true,
  suppressTransientReadFailureLog: true,
});
const STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES = 12;
const STRUCTURED_PREVIEW_READ_ATTEMPTS = 3;
const PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS = 10000;
const PUBLIC_PREVIEW_PROFILE_CONTEXT_TIMEOUT_MS = 900;
const PUBLIC_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 5000;
const PUBLIC_PREVIEW_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PUBLIC_PREVIEW_IMAGE_LIMIT_INPUT_PIXELS = 45_000_000;
const PUBLIC_PREVIEW_RESOLUTION_CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_PREVIEW_RESOLUTION_CACHE_MAX_ENTRIES = 500;
const PUBLIC_PREVIEW_ASSET_CACHE_TTL_MS = 60 * 60 * 1000;
const PUBLIC_PREVIEW_ASSET_CACHE_MAX_ENTRIES = 200;
const PUBLIC_PREVIEW_HTML_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=1800';
const PUBLIC_PREVIEW_OPTIMIZED_ASSET_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const PUBLIC_PREVIEW_REDIRECT_ASSET_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=1800';
const PUBLIC_PREVIEW_PROFILE_ROLE = 'Webdesign & Software Ontwikkeling';
const PUBLIC_PREVIEW_PROFILE_DEFAULT_KEY = 'serve';
const PUBLIC_PREVIEW_PROFILES = Object.freeze({
  serve: Object.freeze({
    key: 'serve',
    name: 'Softora',
    role: 'Webdesign en software',
    photoSource: '/assets/softora-strategy-meeting.jpg?v=20260612a',
  }),
  martijn: Object.freeze({
    key: 'martijn',
    name: 'Martijn van de Ven',
    role: PUBLIC_PREVIEW_PROFILE_ROLE,
    photoSource: '/assets/martijn-van-de-ven-profile.png?v=20260609a',
  }),
});
let sharpModule = null;
const publicPreviewResolutionCache = new Map();
const publicPreviewAssetCache = new Map();
const PUBLIC_PREVIEW_PROFILE_EMAIL_ALIASES = Object.freeze({
  'serve@softora.nl': 'serve',
  'servecreusen@softora.nl': 'serve',
  'servec321@gmail.com': 'serve',
  'serve290@gmail.com': 'serve',
  'servecreusen7@gmail.com': 'serve',
  'contact.venvisuals@gmail.com': 'serve',
  'serve@websoftora.com': 'serve',
  'servecreusen@websoftora.com': 'serve',
  'martijn@softora.nl': 'martijn',
  'martijnvandeven@softora.nl': 'martijn',
  'martijnven123@gmail.com': 'martijn',
  'martijn@websoftora.com': 'martijn',
  'martijnven@websoftora.com': 'martijn',
  'martijnvandeven@websoftora.com': 'martijn',
});
const PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS = Object.freeze([
  'lastColdmailSenderEmail',
  'senderEmail',
  'sender_email',
  'sentFromEmail',
  'sent_from_email',
  'outreachSentFromEmail',
  'outreach_sent_from_email',
  'replyMailboxAccount',
  'lastColdmailReplyMailboxAccount',
  'mailboxAccount',
  'accountEmail',
  'account_email',
  'fromEmail',
  'mailFrom',
  'mail_from',
]);
const PUBLIC_PREVIEW_PROFILE_EXPLICIT_FIELDS = Object.freeze([
  'senderProfileKey',
  'senderKey',
  'profileKey',
  'senderDisplayName',
  'senderName',
  'fromName',
]);
const PUBLIC_PREVIEW_PROFILE_OWNER_FIELDS = Object.freeze([
  'leadOwnerKey',
  'ownerKey',
  'assignedOwnerKey',
  'leadOwnerEmail',
  'ownerEmail',
  'responsibleEmail',
  'leadOwnerFullName',
  'leadOwnerName',
  'ownerFullName',
  'ownerName',
  'responsible',
  'verantwoordelijk',
  'claimedBy',
  'assignedTo',
]);
const PUBLIC_PREVIEW_PROFILE_NESTED_FIELDS = Object.freeze([
  'legacyMeta',
  'payload',
  'sender',
  'senderProfile',
  'profile',
  'leadOwner',
  'owner',
  'responsibleUser',
  'assignedUser',
]);

const {
  buildCustomerIdentityKey,
  readChunkedStateValue,
} = require('./data-ops-serialization');

function normalizeString(value) {
  return String(value || '').trim();
}

function getPublicPreviewCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setPublicPreviewCacheEntry(cache, key, value, ttlMs, maxEntries) {
  if (!key || value === null || value === undefined) return value;
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  while (cache.size > maxEntries) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) break;
    cache.delete(firstKey);
  }
  return value;
}

function getPublicPreviewResolutionCacheKey(id, includeProfileContext) {
  return `${includeProfileContext ? 'profile' : 'base'}:${normalizeCustomerId(id).toLowerCase()}`;
}

function setPublicPreviewResolutionCache(id, includeProfileContext, preview) {
  if (!preview) return preview;
  const value = setPublicPreviewCacheEntry(
    publicPreviewResolutionCache,
    getPublicPreviewResolutionCacheKey(id, includeProfileContext),
    preview,
    PUBLIC_PREVIEW_RESOLUTION_CACHE_TTL_MS,
    PUBLIC_PREVIEW_RESOLUTION_CACHE_MAX_ENTRIES
  );
  if (includeProfileContext) {
    setPublicPreviewCacheEntry(
      publicPreviewResolutionCache,
      getPublicPreviewResolutionCacheKey(id, false),
      preview,
      PUBLIC_PREVIEW_RESOLUTION_CACHE_TTL_MS,
      PUBLIC_PREVIEW_RESOLUTION_CACHE_MAX_ENTRIES
    );
  }
  return value;
}

function setPublicPreviewBaseResolutionCache(id, preview) {
  if (!preview || hasPendingPublicPreviewProfileContext(preview)) return preview;
  return setPublicPreviewCacheEntry(
    publicPreviewResolutionCache,
    getPublicPreviewResolutionCacheKey(id, false),
    preview,
    PUBLIC_PREVIEW_RESOLUTION_CACHE_TTL_MS,
    PUBLIC_PREVIEW_RESOLUTION_CACHE_MAX_ENTRIES
  );
}

function getPublicPreviewSourceCacheKey(source) {
  return crypto
    .createHash('sha1')
    .update(normalizeString(source))
    .digest('hex')
    .slice(0, 24);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeParseObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeParseArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function withPublicPreviewTimeout(promise, timeoutMs, label = 'public-preview-read') {
  const ms = Math.max(50, Math.min(10000, Number(timeoutMs) || PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS));
  let timeout = null;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([
    Promise.resolve(promise)
      .catch((_error) => undefined)
      .finally(() => {
        if (timeout) clearTimeout(timeout);
      }),
    timeoutPromise,
  ]).then((result) => {
    if (result === undefined && label) return undefined;
    return result;
  });
}

function createPublicPreviewDiagnostics() {
  return {
    transientReadFailure: false,
    lastReadFailureSource: '',
  };
}

function markPublicPreviewTransientReadFailure(diagnostics, source = 'public-preview-read') {
  if (!diagnostics || typeof diagnostics !== 'object') return;
  diagnostics.transientReadFailure = true;
  diagnostics.lastReadFailureSource = normalizeString(source);
}

function hasPublicPreviewTransientReadFailure(diagnostics) {
  return Boolean(diagnostics && diagnostics.transientReadFailure);
}

function clampChunkCount(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function isValidImageSource(value) {
  const source = normalizeString(value);
  return /^https?:\/\//i.test(source) || /^data:image\//i.test(source);
}

function isRemoteImageSource(value) {
  return /^https?:\/\//i.test(normalizeString(value));
}

function normalizeProfileSignal(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProfileEmail(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .replace(/[),.;!?]+$/g, '');
}

function inferPublicPreviewProfileKeyFromKnownEmail(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const emailMatches = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const emails = emailMatches.length ? emailMatches : [raw];
  for (const email of emails) {
    const key = PUBLIC_PREVIEW_PROFILE_EMAIL_ALIASES[normalizeProfileEmail(email)];
    if (key) return key;
  }
  return '';
}

function inferPublicPreviewProfileKeyFromText(value) {
  const raw = normalizeString(value);
  const emailKey = inferPublicPreviewProfileKeyFromKnownEmail(raw);
  if (emailKey) return emailKey;
  if (/@/.test(raw)) return '';
  const signal = normalizeProfileSignal(value);
  const compact = signal.replace(/[^a-z0-9]+/g, '');
  if (!signal) return '';
  if (signal.includes('martijn') || compact.includes('martijnvandeven')) return 'martijn';
  if (signal.includes('serve') || signal.includes('creusen') || compact.includes('servecreusen')) return 'serve';
  return '';
}

function collectProfileObjects(...sources) {
  const objects = [];
  const seen = new Set();
  const pushObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return;
    seen.add(value);
    objects.push(value);
    PUBLIC_PREVIEW_PROFILE_NESTED_FIELDS.forEach((field) => pushObject(value[field]));
  };
  sources.forEach(pushObject);
  return objects;
}

function inferPublicPreviewProfileKeyFromFields(objects, fields) {
  for (const object of objects) {
    for (const field of fields) {
      const key = inferPublicPreviewProfileKeyFromText(object && object[field]);
      if (key) return key;
    }
  }
  return '';
}

function hasPublicPreviewProfileFieldSignal(objects, fields) {
  return (Array.isArray(objects) ? objects : []).some((object) =>
    fields.some((field) => Boolean(normalizeString(object && object[field])))
  );
}

function inferPublicPreviewProfileKey(objects) {
  const sentKey = inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS);
  if (sentKey) return sentKey;
  if (hasPublicPreviewProfileFieldSignal(objects, PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS)) {
    return 'unresolved';
  }
  return inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_EXPLICIT_FIELDS)
    || inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_OWNER_FIELDS);
}

function resolvePublicPreviewProfile(record = null, customer = null, outboundContext = null) {
  const objects = collectProfileObjects(outboundContext, record, customer);
  const inferredKey = inferPublicPreviewProfileKey(objects);
  if (inferredKey === 'unresolved') {
    return {
      key: 'unresolved',
      name: '',
      role: PUBLIC_PREVIEW_PROFILE_ROLE,
      photoSource: '',
      source: 'unresolved',
    };
  }
  const key = inferredKey || PUBLIC_PREVIEW_PROFILE_DEFAULT_KEY;
  const fallback = PUBLIC_PREVIEW_PROFILES[key] || PUBLIC_PREVIEW_PROFILES[PUBLIC_PREVIEW_PROFILE_DEFAULT_KEY];
  return {
    key: fallback.key,
    name: fallback.name,
    role: fallback.role,
    photoSource: fallback.photoSource,
    source: inferredKey ? 'explicit' : 'default',
  };
}

function hasExplicitPublicPreviewProfile(preview) {
  return Boolean(preview && preview.profile && preview.profile.source === 'explicit');
}

function hasUnresolvedPublicPreviewProfile(preview) {
  return Boolean(preview && preview.profile && preview.profile.source === 'unresolved');
}

function markPublicPreviewProfileContextPending(preview) {
  return preview && typeof preview === 'object'
    ? {
        ...preview,
        profileContextPending: true,
      }
    : preview;
}

function hasPendingPublicPreviewProfileContext(preview) {
  return Boolean(preview && preview.profileContextPending && !hasExplicitPublicPreviewProfile(preview));
}

function readChunkedDataUrl(values, photoKey, chunkCount) {
  const key = normalizeString(photoKey);
  if (!key) return '';
  const stateValues = values && typeof values === 'object' ? values : {};
  const count = clampChunkCount(chunkCount);
  const chunks = [];
  if (count) {
    for (let index = 0; index < count; index += 1) chunks.push(normalizeString(stateValues[`${key}_${index}`]));
  } else {
    for (let index = 0; index < 100; index += 1) {
      const chunk = stateValues[`${key}_${index}`];
      if (typeof chunk !== 'string') break;
      chunks.push(normalizeString(chunk));
    }
  }
  const dataUrl = chunks.join('');
  return /^data:image\//i.test(dataUrl) ? dataUrl : '';
}

function normalizeCustomerId(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    return normalizeString(decodeURIComponent(raw));
  } catch (_error) {
    return raw;
  }
}

function slugifyCompanyName(value, fallback = '') {
  const normalized = normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return slug || fallback;
}

function compactCompanySlug(value) {
  return slugifyCompanyName(value).replace(/-/g, '');
}

function stripKnownDomainSuffix(value) {
  let slug = slugifyCompanyName(value);
  let previous = '';
  while (slug && slug !== previous) {
    previous = slug;
    slug = slug
      .replace(/-(?:nl|eu|com|be|de|net|org|info|io|co)$/i, '')
      .replace(/-(?:b-v|n-v|v-o-f|c-v|bv|nv|vof|cv|ltd|llc|inc)$/i, '');
  }
  return slug;
}

function slugMatchesIdentifier(candidate, identifier) {
  const candidateSlug = slugifyCompanyName(candidate);
  const identifierSlug = slugifyCompanyName(identifier);
  if (!candidateSlug || !identifierSlug) return false;
  if (candidateSlug === identifierSlug) return true;
  const candidateCompact = compactCompanySlug(candidateSlug);
  const identifierCompact = compactCompanySlug(identifierSlug);
  if (candidateCompact && candidateCompact === identifierCompact) return true;
  const candidateRootCompact = compactCompanySlug(stripKnownDomainSuffix(candidateSlug));
  const identifierRootCompact = compactCompanySlug(stripKnownDomainSuffix(identifierSlug));
  const identifierLooksSpecific = identifierCompact.length >= 4;
  const candidateLooksSpecific = candidateCompact.length >= 4;
  if (
    identifierLooksSpecific &&
    candidateLooksSpecific &&
    (candidateCompact.startsWith(identifierCompact) || candidateRootCompact.startsWith(identifierCompact))
  ) {
    return true;
  }
  if (
    identifierRootCompact.length >= 5 &&
    /^manual-import-/.test(candidateSlug) &&
    candidateCompact.includes(identifierRootCompact)
  ) {
    return true;
  }
  return Boolean(
    candidateRootCompact &&
      identifierRootCompact &&
      (candidateRootCompact === identifierCompact ||
        candidateCompact === identifierRootCompact ||
        candidateRootCompact === identifierRootCompact)
  );
}

function domainNameCandidate(value) {
  const raw = normalizeString(value)
    .replace(/^<|>$/g, '')
    .replace(/[),.;!?]+$/g, '');
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return normalizeString(new URL(candidate).hostname)
      .replace(/^www\./i, '')
      .split('.')[0];
  } catch (_error) {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[/?#]/)[0]
      .split('.')[0];
  }
}

function stripImageNameSuffix(value) {
  return normalizeString(value)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_\s]*(?:website|webdesign|preview|device|mockup|screenshot|foto|image|afbeelding)(?:[-_\s]*(?:v[0-9]+|[0-9]+))?$/i, '')
    .replace(/[-_\s]+$/g, '');
}

function collectPhotoRecordSlugCandidates(record) {
  if (!record || typeof record !== 'object') return [];
  const legacyMeta = record.legacyMeta && typeof record.legacyMeta === 'object' ? record.legacyMeta : {};
  const identityCompany = normalizeString(record.identityKey || legacyMeta.identityKey).split('|')[0];
  const imageName = stripImageNameSuffix(record.websitePhotoName || record.fileName || legacyMeta.websitePhotoName);
  const legacyImageName = stripImageNameSuffix(legacyMeta.fileName);
  return Array.from(new Set([
    normalizeString(record.id || record.customerId),
    identityCompany,
    normalizeString(record.bedrijf || record.company || record.companyName),
    normalizeString(legacyMeta.bedrijf || legacyMeta.company || legacyMeta.companyName),
    normalizeString(record.website || record.websiteUrl || record.domain || record.domein),
    normalizeString(legacyMeta.website || legacyMeta.websiteUrl || legacyMeta.domain || legacyMeta.domein),
    imageName,
    legacyImageName,
    domainNameCandidate(imageName),
    domainNameCandidate(legacyImageName),
  ]
    .map((value) => slugifyCompanyName(value))
    .filter(Boolean)));
}

function findPhotoRecordByIdentity(photoMap, identityKeys = []) {
  const identities = new Set((Array.isArray(identityKeys) ? identityKeys : []).map(normalizeString).filter(Boolean));
  if (!identities.size) return null;
  return Object.keys(photoMap || {}).reduce((match, key) => {
    if (match) return match;
    const item = photoMap[key];
    if (!item || typeof item !== 'object') return null;
    return identities.has(normalizeString(item.identityKey)) ? { ...item, id: normalizeString(item.id || key) } : null;
  }, null);
}

function findPhotoRecordBySlug(photoMap, slug) {
  const cleanSlug = slugifyCompanyName(slug);
  if (!cleanSlug) return null;
  return Object.keys(photoMap || {}).reduce((match, key) => {
    if (match) return match;
    const item = photoMap[key];
    if (!item || typeof item !== 'object') return null;
    const record = { ...item, id: normalizeString(item.id || item.customerId || key) };
    return collectPhotoRecordSlugCandidates(record).some((candidate) => slugMatchesIdentifier(candidate, cleanSlug)) ? record : null;
  }, null);
}

function findPhotoRecord(photoMap, customerId) {
  const id = normalizeString(customerId);
  if (!id) return null;
  const direct = photoMap && photoMap[id];
  if (direct && typeof direct === 'object') return { ...direct, id: normalizeString(direct.id) || id };
  return Object.keys(photoMap || {}).reduce((match, key) => {
    if (match) return match;
    const item = photoMap[key];
    if (!item || typeof item !== 'object') return null;
    if (normalizeString(item.id || key) === id) return { ...item, id };
    return null;
  }, null);
}

function parseCustomerRows(values) {
  const stateValues = values && typeof values === 'object' ? values : {};
  return safeParseArray(readChunkedStateValue(stateValues, CUSTOMER_KEY));
}

function findCustomerById(customers, customerId) {
  const id = normalizeString(customerId);
  const lowerId = id.toLowerCase();
  if (!id) return null;
  return (Array.isArray(customers) ? customers : []).find((customer) => {
    const candidateId = normalizeString(customer && (customer.id || customer.customerId || customer.databaseId));
    return candidateId === id || candidateId.toLowerCase() === lowerId;
  }) || null;
}

function getPublicPreviewReadOptions(scope) {
  return {
    readFailureCooldownScope: `${PUBLIC_PREVIEW_READ_FAILURE_COOLDOWN_PREFIX}_${normalizeString(scope)}`,
  };
}

async function retryPublicPreviewRead(reader, attempts = STRUCTURED_PREVIEW_READ_ATTEMPTS, diagnostics = null, source = 'structured-read') {
  const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 1));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await withPublicPreviewTimeout(
        reader(),
        PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS,
        `public-preview-read-${attempt + 1}`
      );
      if (result !== null && result !== undefined) return result;
      markPublicPreviewTransientReadFailure(diagnostics, `${source}-${attempt + 1}`);
    } catch (_error) {
      // Public preview links are opened from email; a transient read miss should not become a broken page.
      markPublicPreviewTransientReadFailure(diagnostics, `${source}-${attempt + 1}`);
    }
  }
  return null;
}

function findCustomerCandidates(customers, identifier) {
  const id = normalizeString(identifier);
  const slug = slugifyCompanyName(id);
  const rows = Array.isArray(customers) ? customers : [];
  const direct = [];
  const bySlug = [];
  rows.forEach((customer) => {
    const candidateId = normalizeString(customer && (customer.id || customer.customerId || customer.databaseId));
    if (candidateId === id || candidateId.toLowerCase() === id.toLowerCase()) {
      direct.push(customer);
      return;
    }
    const candidates = [
      customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam),
      customer && (customer.website || customer.websiteUrl || customer.domain || customer.domein),
      domainNameCandidate(customer && (customer.website || customer.websiteUrl || customer.domain || customer.domein)),
    ].filter(Boolean);
    if (candidates.some((candidate) => slugMatchesIdentifier(candidate, slug))) bySlug.push(customer);
  });
  return direct.concat(bySlug);
}

function getCustomerIdentityKeys(customer) {
  if (!customer || typeof customer !== 'object') return [];
  return Array.from(new Set([
    normalizeString(customer.identityKey),
    buildCustomerIdentityKey(customer),
  ].filter(Boolean)));
}

function findCustomerForPreviewRecord(customers, identifier, record) {
  const rows = Array.isArray(customers) ? customers : [];
  if (!rows.length) return null;
  const legacyMeta = record && record.legacyMeta && typeof record.legacyMeta === 'object' ? record.legacyMeta : {};
  const directIds = Array.from(new Set([
    normalizeString(identifier),
    normalizeString(record && (record.id || record.customerId || record.databaseId)),
    normalizeString(legacyMeta.id || legacyMeta.customerId || legacyMeta.databaseId),
  ].filter(Boolean)));
  for (const directId of directIds) {
    const direct = findCustomerById(rows, directId);
    if (direct) return direct;
  }

  const identityKeys = new Set([
    normalizeString(record && record.identityKey),
    normalizeString(legacyMeta.identityKey),
  ].filter(Boolean));
  if (identityKeys.size) {
    const byIdentity = rows.find((customer) =>
      getCustomerIdentityKeys(customer).some((identityKey) => identityKeys.has(normalizeString(identityKey)))
    );
    if (byIdentity) return byIdentity;
  }

  const recordSlugs = Array.from(new Set([
    normalizeString(identifier),
    ...collectPhotoRecordSlugCandidates(record),
  ].map((value) => slugifyCompanyName(value)).filter(Boolean)));
  if (!recordSlugs.length) return null;
  return rows.find((customer) =>
    collectCustomerStructuredPreviewIdentifiers(customer)
      .some((candidate) => recordSlugs.some((slug) => slugMatchesIdentifier(candidate, slug)))
  ) || null;
}

function collectCustomerStructuredPreviewIdentifiers(customer) {
  if (!customer || typeof customer !== 'object') return [];
  return Array.from(new Set([
    normalizeString(customer.id || customer.customerId || customer.databaseId),
    normalizeString(customer.bedrijf || customer.company || customer.companyName || customer.naam),
    normalizeString(customer.website || customer.websiteUrl || customer.domain || customer.domein),
    domainNameCandidate(customer.website || customer.websiteUrl || customer.domain || customer.domein),
    ...getCustomerIdentityKeys(customer),
  ].filter(Boolean)));
}

function getPreviewRecordList(photoMap) {
  return Object.keys(photoMap || {}).map((key) => {
    const item = photoMap[key];
    return item && typeof item === 'object'
      ? { ...item, id: normalizeString(item.id || item.customerId || key) }
      : null;
  }).filter(Boolean);
}

function collectPublicPreviewContextIdentifiers(identifier, records = [], customers = []) {
  const values = [
    normalizeString(identifier),
    ...(Array.isArray(records) ? records : []).flatMap((record) => {
      if (!record || typeof record !== 'object') return [];
      const legacyMeta = record.legacyMeta && typeof record.legacyMeta === 'object' ? record.legacyMeta : {};
      return [
        normalizeString(record.id || record.customerId || record.databaseId),
        normalizeString(record.identityKey),
        normalizeString(legacyMeta.id || legacyMeta.customerId || legacyMeta.databaseId),
        normalizeString(legacyMeta.identityKey),
        ...collectPhotoRecordSlugCandidates(record),
      ];
    }),
    ...(Array.isArray(customers) ? customers : []).flatMap(collectCustomerStructuredPreviewIdentifiers),
  ];
  return Array.from(new Set(values.map(normalizeString).filter(Boolean))).slice(0, 80);
}

function parsePublicPreviewContextTimestampMs(value) {
  const parsed = Date.parse(normalizeString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOutboundContextSlugCandidates(context) {
  if (!context || typeof context !== 'object') return [];
  const payload = context.payload && typeof context.payload === 'object' ? context.payload : {};
  return Array.from(new Set([
    normalizeString(context.recipient_id || context.recipientId),
    normalizeString(context.recipient_company_key || context.recipientCompanyKey),
    normalizeString(context.recipient_domain || context.recipientDomain),
    normalizeString(context.recipient_email || context.recipientEmail),
    normalizeString(context.key_value || context.keyValue),
    normalizeString(context.recipient_company || context.recipientCompany),
    normalizeString(payload.bedrijf || payload.company || payload.companyName),
    normalizeString(payload.website || payload.websiteUrl || payload.domain || payload.domein),
    domainNameCandidate(context.recipient_email || context.recipientEmail),
    domainNameCandidate(payload.website || payload.websiteUrl || payload.domain || payload.domein),
  ].filter(Boolean)));
}

function collectOutboundContextStructuredPreviewIdentifiers(context) {
  if (!context || typeof context !== 'object') return [];
  const payload = context.payload && typeof context.payload === 'object' ? context.payload : {};
  return Array.from(new Set([
    normalizeString(context.recipient_id || context.recipientId),
    normalizeString(context.recipient_company_key || context.recipientCompanyKey),
    normalizeString(context.recipient_domain || context.recipientDomain),
    normalizeString(context.recipient_email || context.recipientEmail),
    normalizeString(context.recipient_company || context.recipientCompany),
    normalizeString(payload.bedrijf || payload.company || payload.companyName),
    normalizeString(payload.website || payload.websiteUrl || payload.domain || payload.domein),
    domainNameCandidate(context.recipient_email || context.recipientEmail),
    domainNameCandidate(payload.website || payload.websiteUrl || payload.domain || payload.domein),
  ].filter(Boolean)));
}

function outboundContextMatchesPreview(context, identifier, record = null, customer = null) {
  const identifiers = collectPublicPreviewContextIdentifiers(identifier, record ? [record] : [], customer ? [customer] : []);
  if (!identifiers.length) return false;
  const directIdentifiers = new Set(identifiers.map((value) => normalizeString(value).toLowerCase()));
  const directCandidates = [
    context && (context.recipient_id || context.recipientId),
    context && (context.recipient_company_key || context.recipientCompanyKey),
    context && (context.recipient_domain || context.recipientDomain),
    context && (context.key_value || context.keyValue),
  ].map((value) => normalizeString(value).toLowerCase()).filter(Boolean);
  if (directCandidates.some((candidate) => directIdentifiers.has(candidate))) return true;
  const slugCandidates = getOutboundContextSlugCandidates(context);
  return identifiers.some((identifierCandidate) =>
    slugCandidates.some((slugCandidate) =>
      slugMatchesIdentifier(slugCandidate, identifierCandidate) ||
        slugMatchesIdentifier(identifierCandidate, slugCandidate)
    )
  );
}

function findOutboundContextForPreview(contexts, identifier, record = null, customer = null) {
  return (Array.isArray(contexts) ? contexts : [])
    .filter((context) =>
      hasPublicPreviewProfileFieldSignal([context], PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS) &&
        outboundContextMatchesPreview(context, identifier, record, customer)
    )
    .sort((left, right) =>
      Math.max(
        parsePublicPreviewContextTimestampMs(right && right.updated_at),
        parsePublicPreviewContextTimestampMs(right && right.updatedAt),
        parsePublicPreviewContextTimestampMs(right && right.created_at),
        parsePublicPreviewContextTimestampMs(right && right.createdAt)
      ) -
        Math.max(
          parsePublicPreviewContextTimestampMs(left && left.updated_at),
          parsePublicPreviewContextTimestampMs(left && left.updatedAt),
          parsePublicPreviewContextTimestampMs(left && left.created_at),
          parsePublicPreviewContextTimestampMs(left && left.createdAt)
        )
    )[0] || null;
}

function buildPreviewFromRecord(id, values, record, customer = null, outboundContext = null) {
  const photoSource = resolvePreviewSource(values, record, 'photo');
  const mockupSource = resolvePreviewSource(values, record, 'mockup');
  if (!isValidImageSource(photoSource) || !isValidImageSource(mockupSource)) return null;
  const legacyMeta = record && record.legacyMeta && typeof record.legacyMeta === 'object' ? record.legacyMeta : {};
  const customerLegacyMeta = customer && customer.legacyMeta && typeof customer.legacyMeta === 'object' ? customer.legacyMeta : {};
  const outboundPayload = outboundContext && outboundContext.payload && typeof outboundContext.payload === 'object'
    ? outboundContext.payload
    : {};
  const title = normalizeString(
    record &&
      (record.bedrijf ||
        record.company ||
        record.companyName ||
        record.naam ||
        legacyMeta.bedrijf ||
        legacyMeta.company ||
        legacyMeta.companyName ||
        legacyMeta.naam)
  ) || normalizeString(
    customer &&
      (customer.bedrijf ||
        customer.company ||
        customer.companyName ||
        customer.naam ||
        customerLegacyMeta.bedrijf ||
        customerLegacyMeta.company ||
        customerLegacyMeta.companyName ||
        customerLegacyMeta.naam)
  ) || normalizeString(
    outboundContext &&
      (outboundContext.recipient_company ||
        outboundContext.recipientCompany ||
        outboundPayload.bedrijf ||
        outboundPayload.company ||
        outboundPayload.companyName)
  );
  return {
    id,
    photoSource,
    mockupSource,
    title,
    profile: resolvePublicPreviewProfile(record, customer, outboundContext),
  };
}

function getUrlOrigin(value) {
  try {
    return new URL(normalizeString(value)).origin;
  } catch (_error) {
    return '';
  }
}

function getSharp() {
  if (!sharpModule) sharpModule = require('sharp');
  return sharpModule;
}

function normalizePublicPreviewAssetWidth(type, value) {
  const assetType = getPublicPreviewAssetType(type);
  const parsed = Math.round(Number(value) || 0);
  if (!parsed) return assetType === 'mockup' ? 1280 : 920;
  const minWidth = assetType === 'mockup' ? 640 : 520;
  const maxWidth = assetType === 'mockup' ? 1280 : 920;
  const rounded = Math.round(parsed / 40) * 40;
  return Math.max(minWidth, Math.min(maxWidth, rounded));
}

function buildPublicPreviewAssetPath(identifier, type, width = null) {
  const id = normalizeCustomerId(identifier);
  const assetType = normalizeString(type).toLowerCase() === 'mockup' ? 'mockup' : 'webdesign';
  const normalizedWidth = width ? normalizePublicPreviewAssetWidth(assetType, width) : 0;
  const query = normalizedWidth ? `?w=${normalizedWidth}` : '';
  return `/webdesign/${encodeURIComponent(id || 'preview')}/asset/${assetType}${query}`;
}

function resolvePublicPreviewDisplayAssetSource(preview, type, assetIdentifier, options = {}) {
  const assetType = getPublicPreviewAssetType(type);
  return buildPublicPreviewAssetPath(assetIdentifier || preview && preview.id, assetType, options.width);
}

function getPublicPreviewAssetType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'mockup' || normalized === 'device' || normalized === 'device-mockup'
    ? 'mockup'
    : 'webdesign';
}

function parseDataImageSource(source) {
  const match = normalizeString(source).match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    contentType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

async function fetchPublicPreviewImageBuffer(source) {
  const dataImage = parseDataImageSource(source);
  if (dataImage) return dataImage;
  const url = normalizeString(source);
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_PREVIEW_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
    });
    if (!response.ok) return null;
    const contentType = normalizeString(response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (!/^image\/(?:png|jpe?g|webp)$/i.test(contentType)) return null;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > PUBLIC_PREVIEW_IMAGE_MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > PUBLIC_PREVIEW_IMAGE_MAX_BYTES) return null;
    return { buffer, contentType };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function optimizePublicPreviewImage(source, type, width = null) {
  const assetType = getPublicPreviewAssetType(type);
  const targetWidth = normalizePublicPreviewAssetWidth(assetType, width);
  const cacheKey = `${assetType}:${targetWidth}:${getPublicPreviewSourceCacheKey(source)}`;
  const cached = getPublicPreviewCacheEntry(publicPreviewAssetCache, cacheKey);
  if (cached) return cached;
  const image = await fetchPublicPreviewImageBuffer(source);
  if (!image || !Buffer.isBuffer(image.buffer)) return null;
  const buffer = await getSharp()(image.buffer, { limitInputPixels: PUBLIC_PREVIEW_IMAGE_LIMIT_INPUT_PIXELS })
    .rotate()
    .resize({
      width: targetWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({
      quality: assetType === 'mockup' ? 78 : 76,
      effort: 3,
    })
    .toBuffer();
  return setPublicPreviewCacheEntry(publicPreviewAssetCache, cacheKey, {
    buffer,
    contentType: 'image/webp',
  }, PUBLIC_PREVIEW_ASSET_CACHE_TTL_MS, PUBLIC_PREVIEW_ASSET_CACHE_MAX_ENTRIES);
}

function titleFromIdentifier(value) {
  const cleaned = slugifyCompanyName(value)
    .replace(/^manual-import-/, '')
    .replace(/-(?:nl|be|de|com|eu|net|org)(?:-|$)/g, '-')
    .replace(/-(?:contact|klant|customer|lead)-?\d*$/g, '')
    .replace(/-\d+$/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const words = [];
  cleaned.split('-').filter(Boolean).forEach((word) => {
    if (word === 's' && words.length) {
      words[words.length - 1] = `${words[words.length - 1]}'s`;
      return;
    }
    if (word === 'piggys') {
      words.push("Piggy's");
      return;
    }
    words.push(word.length <= 2 ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  });
  return normalizePublicPreviewLegalSuffix(words.join(' ')) || 'Webdesign Concept';
}

function normalizePublicPreviewLegalSuffix(value) {
  return normalizeString(value)
    .replace(/\bB\.?\s*V\.?$/i, 'B.V.')
    .replace(/\bN\.?\s*V\.?$/i, 'N.V.')
    .replace(/\bC\.?\s*V\.?$/i, 'C.V.')
    .replace(/\bV\.?\s*O\.?\s*F\.?$/i, 'V.O.F.');
}

function cleanPublicPreviewTitle(value, fallback) {
  const title = normalizeString(value);
  if (!title || /^manual import\b/i.test(title)) return titleFromIdentifier(fallback || title);
  return normalizePublicPreviewLegalSuffix(title);
}

function cleanPublicPreviewNarrativeCompanyName(value) {
  const title = normalizeString(value);
  const cleaned = title
    .replace(/\s*,?\s*(?:b\.?\s*v\.?|n\.?\s*v\.?|v\.?\s*o\.?\s*f\.?|c\.?\s*v\.?|ltd\.?|llc|inc\.?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || title;
}

function buildPhotoMapFromStructuredEntries(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((map, entry) => {
    const id = normalizeString(entry && (entry.customerId || entry.id));
    if (!id) return map;
    const legacyMeta = entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {};
    map[id] = {
      ...(entry && typeof entry === 'object' ? entry : {}),
      id,
      websitePhotoUrl: normalizeString(entry && (entry.websitePhotoUrl || entry.signedUrl)),
      websiteMockupUrl: normalizeString(entry && (entry.websiteMockupUrl || entry.mockupUrl)),
      websitePhotoName: normalizeString(entry && (entry.websitePhotoName || entry.fileName || legacyMeta.websitePhotoName)),
      identityKey: normalizeString(entry && entry.identityKey),
      legacyMeta,
    };
    return map;
  }, {});
}

function resolvePreviewFromMaps(id, values, photoMap, customers, outboundContexts = []) {
  let record = findPhotoRecord(photoMap, id);
  let customer = findCustomerForPreviewRecord(customers, id, record);
  let outboundContext = findOutboundContextForPreview(outboundContexts, id, record, customer);
  let preview = buildPreviewFromRecord(id, values, record, customer, outboundContext);
  if (preview) return preview;

  record = findPhotoRecordBySlug(photoMap, id);
  customer = findCustomerForPreviewRecord(customers, id, record);
  outboundContext = findOutboundContextForPreview(outboundContexts, id, record, customer);
  preview = buildPreviewFromRecord(
    normalizeString(record && (record.id || record.customerId)) || id,
    values,
    record,
    customer,
    outboundContext
  );
  if (preview) return preview;

  const directCustomer = findCustomerById(customers, id);
  const matchedCustomers = findCustomerCandidates(customers, id);
  const candidates = directCustomer
    ? [directCustomer].concat(matchedCustomers.filter((customer) => customer !== directCustomer))
    : matchedCustomers;
  for (const customer of candidates) {
    const candidateId = normalizeString(customer && (customer.id || customer.customerId || customer.databaseId)) || id;
    record = findPhotoRecordByIdentity(photoMap, getCustomerIdentityKeys(customer)) || findPhotoRecord(photoMap, candidateId) || record;
    outboundContext = findOutboundContextForPreview(outboundContexts, id, record, customer);
    preview = buildPreviewFromRecord(candidateId, values, record, customer, outboundContext);
    if (preview) return preview;
  }
  return null;
}

function resolvePreviewSource(values, record, type) {
  if (!record || typeof record !== 'object') return '';
  if (type === 'mockup') {
    const direct = normalizeString(
      record.websiteMockup ||
        record.mockup ||
        record.websiteMockupUrl ||
        record.mockupUrl ||
        record.signedMockupUrl ||
        (record.mockupStorage && record.mockupStorage.signedUrl)
    );
    if (isValidImageSource(direct)) return direct;
    return readChunkedDataUrl(values, record.mockupPhotoKey || record.websiteMockupKey, record.mockupChunkCount || record.websiteMockupChunkCount);
  }
  const direct = normalizeString(
    record.websitePhoto ||
      record.dataUrl ||
      record.websitePhotoUrl ||
      record.signedUrl ||
      record.publicUrl ||
      (record.storage && record.storage.signedUrl)
  );
  if (isValidImageSource(direct)) return direct;
  return readChunkedDataUrl(values, record.photoKey, record.chunkCount);
}

function buildPreviewHtml(preview, assetIdentifier = null) {
  const displayIdentifier = assetIdentifier || preview.id;
  const photoSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'webdesign', displayIdentifier, { width: 840 }));
  const mockupSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'mockup', displayIdentifier, { width: 1040 }));
  const preconnectTags = Array.from(new Set([
    getUrlOrigin(preview.photoSource),
    getUrlOrigin(preview.mockupSource),
  ].filter(Boolean)))
    .map((origin) => `  <link rel="preconnect" href="${escapeHtml(origin)}" crossorigin>`)
    .join('\n');
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
${preconnectTags}
  <link rel="preload" as="image" href="${photoSource}" fetchpriority="high">
  <link rel="preload" as="image" href="${mockupSource}">
  <title>Webdesign preview | Softora</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;background:#121212;color:#fff;font-family:Inter,Arial,sans-serif}
    body{overflow-x:hidden}
    main{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:clamp(18px,2.8vw,46px)}
    .preview-grid{width:min(1660px,100%);height:min(920px,calc(100svh - clamp(36px,5.6vw,92px)));display:grid;grid-template-columns:minmax(280px,.78fr) minmax(420px,1.12fr);gap:clamp(22px,2.4vw,42px);align-items:center;opacity:0;transform:translateY(10px);transition:opacity .38s ease,transform .38s ease}
    body.preview-ready .preview-grid{opacity:1;transform:none}
    .preview-frame{min-width:0;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .preview-frame img{display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain;background:transparent}
    .mockup-frame img{width:100%;max-height:86%}
    .public-preview-loader{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:#121212;transition:opacity .32s ease,visibility .32s ease}
    .loader-mark{width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.18);border-top-color:#fff;animation:previewSpin .8s linear infinite}
    .loader-text{position:absolute;left:50%;top:calc(50% + 48px);transform:translateX(-50%);font-size:12px;letter-spacing:0;text-transform:uppercase;color:rgba(255,255,255,.72);white-space:nowrap}
    body.preview-ready .public-preview-loader{opacity:0;visibility:hidden;pointer-events:none}
    @keyframes previewSpin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.preview-grid,.public-preview-loader{transition:none}.loader-mark{animation:none}}
    @media(max-width:900px){main{min-height:100vh;align-items:flex-start;padding:14px}.preview-grid{width:100%;height:auto;grid-template-columns:1fr;gap:14px}.preview-frame{height:auto;overflow:visible}.preview-frame img,.mockup-frame img{width:100%;max-height:none}}
  </style>
</head>
<body class="preview-loading" aria-busy="true">
  <div class="public-preview-loader" role="status" aria-live="polite">
    <div class="loader-mark" aria-hidden="true"></div>
    <div class="loader-text">Preview laden</div>
  </div>
  <main>
    <div class="preview-grid" aria-label="Webdesign en device mockup naast elkaar">
      <div class="preview-frame website-frame"><img src="${photoSource}" alt="Webdesign" loading="eager" decoding="async" fetchpriority="high"></div>
      <div class="preview-frame mockup-frame"><img src="${mockupSource}" alt="Device mockup" loading="eager" decoding="async"></div>
    </div>
  </main>
  <script>
    (function(){
      var startedAt = Date.now();
      var minimumDelay = 1100;
      var fallbackDelay = 5500;
      var revealed = false;
      function showPreview(){
        if(revealed)return;
        revealed = true;
        var remaining = Math.max(0, minimumDelay - (Date.now() - startedAt));
        window.setTimeout(function(){
          document.body.classList.remove('preview-loading');
          document.body.classList.add('preview-ready');
          document.body.setAttribute('aria-busy','false');
        }, remaining);
      }
      function waitForWindow(){
        if(document.readyState === 'complete')return Promise.resolve();
        return new Promise(function(resolve){window.addEventListener('load',resolve,{once:true});});
      }
      function waitForImage(image){
        if(image.complete){
          return image.decode ? image.decode().catch(function(){}) : Promise.resolve();
        }
        return new Promise(function(resolve){
          image.addEventListener('load',resolve,{once:true});
          image.addEventListener('error',resolve,{once:true});
        }).then(function(){
          return image.decode ? image.decode().catch(function(){}) : undefined;
        });
      }
      var imageTasks = Array.prototype.map.call(document.querySelectorAll('.preview-grid img'),waitForImage);
      var fontTask = document.fonts && document.fonts.ready ? document.fonts.ready.catch(function(){}) : Promise.resolve();
      Promise.allSettled([waitForWindow(),fontTask].concat(imageTasks)).then(showPreview);
      window.setTimeout(showPreview,fallbackDelay);
    }());
  </script>
</body>
</html>`;
}

function buildConceptHtml(preview, titleFallback, assetIdentifier) {
  const displayIdentifier = assetIdentifier || titleFallback || preview.id;
  const photoSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'webdesign', displayIdentifier, { width: 840 }));
  const mockupSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'mockup', displayIdentifier, { width: 1040 }));
  const profile = preview.profile || resolvePublicPreviewProfile();
  const profileSource = escapeHtml(profile.photoSource);
  const profileName = escapeHtml(profile.name);
  const profileRole = escapeHtml(profile.role);
  const titleText = cleanPublicPreviewTitle(preview.title, titleFallback || preview.id);
  const title = escapeHtml(titleText);
  const narrativeCompanyName = escapeHtml(cleanPublicPreviewNarrativeCompanyName(titleText));
  const isPersonalProfile = profile.key === 'martijn';
  const aboutTitleDesktop = isPersonalProfile ? 'Zó heb ik het webdesign gebouwd...' : 'Zó is het webdesign gebouwd...';
  const aboutIntro = isPersonalProfile
    ? 'Begonnen met HTML-code en een leeg scherm. De structuur, indeling en techniek heb ik stap voor stap opgebouwd. Vanuit daar heb ik gekeken hoe de website logisch, overzichtelijk en prettig werkt voor bezoekers.'
    : 'We zijn begonnen met HTML-code en een leeg scherm. De structuur, indeling en techniek zijn stap voor stap opgebouwd. Vanuit daar is gekeken hoe de website logisch, overzichtelijk en prettig werkt voor bezoekers.';
  const aboutMarket = isPersonalProfile
    ? `Ook heb ik de concurrenten van ${narrativeCompanyName} in kaart gebracht. Niet om te kopiëren, maar om te zien wat in deze markt sterk werkt: welke opbouw vertrouwen geeft, welke details bezoekers helpen en waar kansen liggen om het net frisser en beter neer te zetten.`
    : `Ook zijn de concurrenten van ${narrativeCompanyName} in kaart gebracht. Niet om te kopiëren, maar om te zien wat in deze markt sterk werkt: welke opbouw vertrouwen geeft, welke details bezoekers helpen en waar kansen liggen om het net frisser en beter neer te zetten.`;
  const aboutAi = isPersonalProfile
    ? 'Later heb ik AI subtiel gebruikt om de uitstraling te versterken. AI is krachtig, maar kan kleine details missen. Vergeef me als iets niet helemaal klopt; zoals een adres of een logo.'
    : 'Later is AI subtiel gebruikt om de uitstraling te versterken. AI is krachtig, maar kan kleine details missen. Kleine details kunnen nog afwijken, zoals een adres of een logo.';
  const aboutServices = isPersonalProfile
    ? 'Naast webdesign bouw ik ook bedrijfssoftware, dashboards en klantportalen. Ook voor onderhoud en doorontwikkeling denk ik graag mee.'
    : 'Naast webdesign bouwt Softora ook bedrijfssoftware, dashboards en klantportalen. Ook voor onderhoud en doorontwikkeling denken we graag mee.';
  const aboutResult = isPersonalProfile
    ? 'Die inzichten heb ik meegenomen in dit ontwerp. Zo ontstaat een website die niet alleen mooi oogt, maar ook duidelijk, klantgericht en doordacht aanvoelt.'
    : 'Die inzichten zijn meegenomen in dit ontwerp. Zo ontstaat een website die niet alleen mooi oogt, maar ook duidelijk, klantgericht en doordacht aanvoelt.';
  const preconnectTags = Array.from(new Set([
    getUrlOrigin(preview.photoSource),
    getUrlOrigin(preview.mockupSource),
    getUrlOrigin(profile.photoSource),
  ].filter(Boolean)))
    .map((origin) => `  <link rel="preconnect" href="${escapeHtml(origin)}" crossorigin>`)
    .join('\n');
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
${preconnectTags}
  <link rel="preload" as="image" href="${photoSource}" fetchpriority="high">
  <link rel="preload" as="image" href="${mockupSource}">
  <title>${title} | Design presentatie</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--navy:#1c2b50;--teal:#5bada0;--cream:#f2ede6;--muted:#728095;--rule:#d8d2ca;--panel:#fffaf4}
    html,body{min-height:100%;background:var(--cream);color:var(--navy);font-family:Inter,Arial,sans-serif}
    body{overflow-x:hidden;overflow-anchor:none}
    body.concept-loading{overflow:hidden}
    .concept-hero,.divider,.about-section{opacity:0;transition:opacity .34s ease}
    body.concept-ready .concept-hero,body.concept-ready .divider,body.concept-ready .about-section{opacity:1}
    .concept-loader{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:var(--cream);color:var(--navy);transition:opacity .3s ease,visibility .3s ease}
    .concept-loader-mark{width:52px;height:52px;border-radius:999px;border:1px solid rgba(28,43,80,.18);border-top-color:var(--teal);animation:conceptSpin .8s linear infinite}
    .concept-loader-text{position:absolute;left:50%;top:calc(50% + 48px);transform:translateX(-50%);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--teal);font-weight:800;white-space:nowrap}
    body.concept-ready .concept-loader{opacity:0;visibility:hidden;pointer-events:none}
    @keyframes conceptSpin{to{transform:rotate(360deg)}}
    .concept-hero{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px clamp(18px,4vw,64px);gap:44px;position:relative}
    .hero-heading{text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;max-width:920px}
    .hero-label{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--teal);font-weight:800}
    .hero-title{font-family:Georgia,'Times New Roman',serif;font-size:clamp(32px,4vw,44px);font-weight:600;line-height:1.14;color:var(--navy);max-width:100%;text-wrap:balance;overflow-wrap:normal;word-break:normal;hyphens:none}
    .mockup-stage{display:flex;align-items:flex-end;justify-content:center;gap:38px;width:100%;max-width:1440px;padding:0 clamp(0px,3vw,44px)}
    .wide-stack{width:min(54%,780px);display:flex;flex-direction:column;align-items:center;gap:22px}
    .stage-card{background:rgba(255,255,255,.28);box-shadow:0 20px 60px rgba(28,43,80,.14);overflow:hidden;flex-shrink:0;position:relative}
    .stage-card::before{content:attr(data-loading);position:absolute;inset:0;display:grid;place-items:center;padding:20px;text-align:center;color:rgba(28,43,80,.5);font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;background:linear-gradient(135deg,rgba(255,250,244,.9),rgba(255,255,255,.56));z-index:0}
    .tall{width:min(42%,540px);border-radius:16px}
    .wide{width:100%;border-radius:14px;aspect-ratio:16/10}
    .visual{display:block;width:100%;height:100%;background:var(--panel);position:relative;z-index:1}
    .tall .visual{height:auto;aspect-ratio:auto;object-fit:contain;object-position:top center}
    .wide .visual{height:100%;object-fit:contain;object-position:center}
    .scroll-cue{position:fixed;right:clamp(18px,4vw,56px);bottom:clamp(18px,3.5vw,42px);z-index:20;width:46px;height:46px;border-radius:999px;display:grid;place-items:center;background:rgba(255,250,244,.92);color:var(--navy);border:1px solid rgba(28,43,80,.12);box-shadow:0 14px 32px rgba(28,43,80,.18);text-decoration:none;transition:background .18s ease}
    .scroll-cue:hover{background:#fff}
    .scroll-cue svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .divider{width:calc(100% - clamp(36px,8vw,128px));height:1px;background:var(--rule);margin:0 auto}
    .about-section{padding:96px clamp(18px,4vw,64px) 112px;display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:flex-start;max-width:1300px;margin:0 auto}
    .about-profile{width:min(100%,340px);justify-self:center}
    .desktop-profile-role{display:none}
    .about-photo{width:100%;border-radius:18px;aspect-ratio:4/3;overflow:hidden;box-shadow:0 12px 40px rgba(28,43,80,.1);background:var(--panel)}
    .about-photo img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}
    .about-text h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(22px,1.9vw,28px);color:var(--navy);line-height:1.3;margin-bottom:18px;font-weight:600}
    .about-text h2 .title-line{display:block;white-space:nowrap}
    .about-title-mobile{display:none}
    .about-text p{font-size:14px;color:var(--muted);line-height:1.85;margin-bottom:12px}
    .signature{margin-top:28px;padding-top:24px;border-top:1px solid var(--rule)}
    .profile-signature{margin-top:18px;padding-top:0;text-align:center;border-top:0}
    .signature strong{display:block;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:var(--navy);margin-bottom:4px}
    .signature span{font-size:11px;color:var(--teal);font-weight:800;letter-spacing:2px;text-transform:uppercase}
    @media(min-width:1121px){.about-section{grid-template-columns:minmax(0,760px);gap:24px;max-width:860px}.about-profile{width:100%;justify-self:start;display:flex;align-items:center;gap:16px}.desktop-profile-role{display:none}.about-photo{width:86px;flex:0 0 86px;border-radius:16px;aspect-ratio:1/1}.profile-signature{margin-top:0;text-align:left}.profile-signature span{display:block;font-size:10.5px;line-height:1.35}}
    @media(max-width:1120px){.about-section{grid-template-columns:1fr;gap:30px;padding-top:56px}.about-profile{width:min(100%,360px);justify-self:center;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:14px}.about-photo{width:68px;flex:0 0 68px;border-radius:999px;aspect-ratio:1/1;box-shadow:0 8px 24px rgba(28,43,80,.1)}.profile-signature{margin:0;text-align:left;padding:0;border-top:0}.profile-signature span{display:block;font-size:10.5px;line-height:1.35}}
    @media(max-width:700px){.about-section{gap:28px}.about-profile{width:min(100%,320px);justify-content:flex-start}.about-photo{width:58px;flex-basis:58px}.profile-signature{display:flex;flex-direction:column;align-items:flex-start}.profile-signature span{order:-1;white-space:nowrap;font-size:clamp(8px,2.5vw,10px);letter-spacing:.7px;margin-bottom:2px}.about-text h2{font-size:clamp(13px,4.1vw,22px);text-align:center}.about-title-desktop{display:none}.about-title-mobile{display:inline}}
    @media(max-width:700px){.scroll-cue{display:none}}
    @media(max-width:700px){.hero-heading{gap:7px;max-width:calc(100vw - 36px)}.hero-title{font-size:clamp(24px,9.2vw,36px);line-height:1.08}}
    @media(prefers-reduced-motion:reduce){.concept-hero,.divider,.about-section,.concept-loader{transition:none}.concept-loader-mark{animation:none}}
    @media(max-width:900px){.concept-hero{min-height:100svh;padding-top:34px;justify-content:flex-start}.mockup-stage{flex-direction:column;padding:0;gap:22px}.wide-stack{display:contents}.hero-heading{order:-1;width:100%}.tall{width:100%;order:0}.wide{width:100%;order:1}.divider{width:calc(100% - 36px)}}
  </style>
</head>
<body class="concept-loading" aria-busy="true">
  <div class="concept-loader" role="status" aria-live="polite">
    <div class="concept-loader-mark" aria-hidden="true"></div>
    <div class="concept-loader-text">Design laden</div>
  </div>
  <section class="concept-hero">
    <div class="mockup-stage">
      <div class="stage-card tall" data-loading="Webdesign wordt geladen"><img class="visual" src="${photoSource}" alt="Volledige webdesign preview" width="900" height="1440" loading="eager" decoding="async" fetchpriority="high"></div>
      <div class="wide-stack">
        <div class="hero-heading">
          <span class="hero-label">Webdesign presentatie</span>
          <h1 class="hero-title">${title}</h1>
        </div>
        <div class="stage-card wide" data-loading="Mockup wordt geladen"><img class="visual" src="${mockupSource}" alt="Device mockup preview" width="1600" height="1000" loading="eager" decoding="async"></div>
      </div>
    </div>
    <a class="scroll-cue" href="#concept-about" aria-label="Scroll naar meer informatie"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg></a>
  </section>
  <div class="divider"></div>
  <section class="about-section" id="concept-about">
    <div class="about-profile">
      <div class="desktop-profile-role">${profileRole}</div>
      <div class="about-photo"><img src="${profileSource}" alt="${profileName}" loading="lazy" decoding="async"></div>
      <div class="signature profile-signature">
        <strong>${profileName}</strong>
        <span>${profileRole}</span>
      </div>
    </div>
    <div class="about-text">
      <h2><span class="about-title-desktop">${aboutTitleDesktop}</span><span class="about-title-mobile">Zó is het webdesign gebouwd!</span></h2>
      <p>${aboutIntro}</p>
      <p>${aboutMarket}</p>
      <p>${aboutResult}</p>
      <p>${aboutAi}</p>
      <p>${aboutServices}</p>
    </div>
  </section>
  <script>
    (function(){
      var startedAt = Date.now();
      var minimumDelay = 1100;
      var fallbackDelay = 7000;
      var revealed = false;
      function fitHeroTitle(){
        var title = document.querySelector('.hero-title');
        if(!title)return;
        title.style.fontSize = '';
        var minSize = window.innerWidth <= 700 ? 18 : 24;
        var size = parseFloat(window.getComputedStyle(title).fontSize) || 36;
        function fits(){
          var style = window.getComputedStyle(title);
          var lineHeight = parseFloat(style.lineHeight) || size * 1.1;
          return title.scrollHeight <= lineHeight * 2 + 2 && title.scrollWidth <= title.clientWidth + 1;
        }
        while(size > minSize && !fits()){
          size -= 1;
          title.style.fontSize = size + 'px';
        }
      }
      function revealConcept(){
        if(revealed)return;
        revealed = true;
        fitHeroTitle();
        var remaining = Math.max(0, minimumDelay - (Date.now() - startedAt));
        window.setTimeout(function(){
          document.body.classList.remove('concept-loading');
          document.body.classList.add('concept-ready');
          document.body.setAttribute('aria-busy','false');
        }, remaining);
      }
      function waitForWindow(){
        if(document.readyState === 'complete')return Promise.resolve();
        return new Promise(function(resolve){window.addEventListener('load',resolve,{once:true});});
      }
      function waitForImage(image){
        if(image.complete){
          return image.decode ? image.decode().catch(function(){}) : Promise.resolve();
        }
        return new Promise(function(resolve){
          image.addEventListener('load',resolve,{once:true});
          image.addEventListener('error',resolve,{once:true});
        }).then(function(){
          return image.decode ? image.decode().catch(function(){}) : undefined;
        });
      }
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded',fitHeroTitle,{once:true});
      }else{
        fitHeroTitle();
      }
      if(document.fonts && document.fonts.ready)document.fonts.ready.then(fitHeroTitle).catch(function(){fitHeroTitle();});
      window.addEventListener('load',fitHeroTitle,{once:true});
      window.addEventListener('resize',fitHeroTitle);
      var imageTasks = Array.prototype.map.call(document.querySelectorAll('.concept-hero img.visual'),waitForImage);
      var fontTask = document.fonts && document.fonts.ready ? document.fonts.ready.catch(function(){}) : Promise.resolve();
      Promise.allSettled([waitForWindow(),fontTask].concat(imageTasks)).then(revealConcept);
      window.setTimeout(revealConcept,fallbackDelay);
    }());
  </script>
</body>
</html>`;
}

function buildNotFoundHtml() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Preview niet gevonden | Softora</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161616;color:#fff;font-family:Inter,Arial,sans-serif}
    p{max-width:520px;margin:0;padding:24px;text-align:center;line-height:1.5}
  </style>
</head>
<body><p>Deze preview is niet beschikbaar.</p></body>
</html>`;
}

function buildTemporarilyUnavailableHtml() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta http-equiv="refresh" content="5">
  <title>Preview wordt geladen | Softora</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161616;color:#fff;font-family:Inter,Arial,sans-serif}
    p{max-width:560px;margin:0;padding:24px;text-align:center;line-height:1.5}
    strong{display:block;margin-bottom:8px;font-size:18px}
  </style>
</head>
<body><p><strong>Preview wordt geladen.</strong>De webdesign-preview is tijdelijk nog onderweg. Deze pagina ververst automatisch.</p></body>
</html>`;
}

function createPublicWebdesignPreviewService(options = {}) {
  publicPreviewResolutionCache.clear();
  publicPreviewAssetCache.clear();
  const getUiStateValues = typeof options.getUiStateValues === 'function' ? options.getUiStateValues : async () => ({ values: {} });
  const dataOpsStore = options.dataOpsStore && typeof options.dataOpsStore === 'object' ? options.dataOpsStore : null;
  const profileContextTimeoutMs = Math.max(
    50,
    Math.min(
      PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS,
      Number(options.profileContextTimeoutMs) || PUBLIC_PREVIEW_PROFILE_CONTEXT_TIMEOUT_MS
    )
  );

  async function readUiStateScopeValues(scope, diagnostics) {
    const state = await withPublicPreviewTimeout(
      getUiStateValues(scope, getPublicPreviewReadOptions(scope)),
      PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS,
      `public-preview-ui-state-${scope}`
    );
    if (!state || typeof state !== 'object') {
      markPublicPreviewTransientReadFailure(diagnostics, `ui-state-${scope}`);
      return {};
    }
    return state.values && typeof state.values === 'object' ? state.values : {};
  }

  async function resolveProfileContextWithTimeout(promise, fallbackPreview) {
    let timeout = null;
    const timeoutResult = { profileContextTimedOut: true };
    const result = await Promise.race([
      Promise.resolve(promise)
        .catch(() => null)
        .finally(() => {
          if (timeout) clearTimeout(timeout);
        }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(timeoutResult), profileContextTimeoutMs);
      }),
    ]);
    if (result && result.profileContextTimedOut) {
      return markPublicPreviewProfileContextPending(fallbackPreview);
    }
    return result || fallbackPreview;
  }

  async function resolveStructuredPreview(id, options = {}) {
    if (
      !dataOpsStore ||
      typeof dataOpsStore.listCustomers !== 'function' ||
      typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function'
    ) {
      return null;
    }
    const diagnostics = options.diagnostics || null;

    const directPhotoEntries = await retryPublicPreviewRead(() => dataOpsStore.listDesignPhotosWithSignedUrls({
      ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
      expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
      identifiers: [id],
      maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
    }), STRUCTURED_PREVIEW_READ_ATTEMPTS, diagnostics, 'design-photos-direct');
    const directPhotoMap = buildPhotoMapFromStructuredEntries(directPhotoEntries);
    const includeProfileContext = Boolean(options.includeProfileContext);
    const loadOutboundContexts = async (identifiers) => {
      if (
        !includeProfileContext ||
        !dataOpsStore ||
        typeof dataOpsStore.listOutboundRecipientGuardsForPreview !== 'function'
      ) {
        return [];
      }
      const loaded = await retryPublicPreviewRead(
        () => dataOpsStore.listOutboundRecipientGuardsForPreview({
          ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
          identifiers,
          maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
        }),
        STRUCTURED_PREVIEW_READ_ATTEMPTS,
        diagnostics,
        'outbound-context'
      );
      return Array.isArray(loaded) ? loaded : [];
    };
    const directRecords = getPreviewRecordList(directPhotoMap);
    let preview = resolvePreviewFromMaps(id, {}, directPhotoMap, [], []);
    if (preview && !includeProfileContext) {
      return preview;
    }

    async function enrichDirectPreview() {
      let outboundContexts = await loadOutboundContexts(
        collectPublicPreviewContextIdentifiers(id, directRecords, [])
      );
      preview = resolvePreviewFromMaps(id, {}, directPhotoMap, [], outboundContexts) || preview;
      if (preview && hasExplicitPublicPreviewProfile(preview) && normalizeString(preview.title)) {
        return preview;
      }

      let customers = [];
      const loadedCustomers = await retryPublicPreviewRead(
        () => dataOpsStore.listCustomers(PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS),
        STRUCTURED_PREVIEW_READ_ATTEMPTS,
        diagnostics,
        'customers-direct'
      );
      try {
        customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
      } catch (_error) {
        customers = [];
      }
      const matchedCustomers = directRecords
        .map((record) => findCustomerForPreviewRecord(customers, id, record))
        .filter(Boolean);
      outboundContexts = await loadOutboundContexts(
        collectPublicPreviewContextIdentifiers(id, directRecords, matchedCustomers)
      );
      const enrichedPreview = resolvePreviewFromMaps(id, {}, directPhotoMap, customers, outboundContexts);
      return enrichedPreview || preview || null;
    }

    if (preview) {
      const enrichedPreview = await resolveProfileContextWithTimeout(
        enrichDirectPreview(),
        preview
      );
      return enrichedPreview || preview;
    }

    let outboundContexts = await loadOutboundContexts(
      collectPublicPreviewContextIdentifiers(id, directRecords, [])
    );
    let customers = [];
    const loadedCustomers = await retryPublicPreviewRead(
      () => dataOpsStore.listCustomers(PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS),
      STRUCTURED_PREVIEW_READ_ATTEMPTS,
      diagnostics,
      'customers-candidates'
    );
    try {
      customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
    } catch (_error) {
      customers = [];
    }
    const candidates = findCustomerCandidates(customers, id);
    const identifiers = Array.from(new Set([
      id,
      ...candidates.flatMap(collectCustomerStructuredPreviewIdentifiers),
      ...outboundContexts.flatMap(collectOutboundContextStructuredPreviewIdentifiers),
    ].filter(Boolean)));

    if (identifiers.length > 1) {
      const photoEntries = await retryPublicPreviewRead(() => dataOpsStore.listDesignPhotosWithSignedUrls({
        ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
        expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
        identifiers,
        maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
      }), STRUCTURED_PREVIEW_READ_ATTEMPTS, diagnostics, 'design-photos-expanded');
      const photoMap = buildPhotoMapFromStructuredEntries(photoEntries);
      outboundContexts = await loadOutboundContexts(
        collectPublicPreviewContextIdentifiers(id, getPreviewRecordList(photoMap), candidates)
      );
      preview = resolvePreviewFromMaps(id, {}, photoMap, candidates, outboundContexts);
      if (preview) return preview;
    }

    return null;
  }

  async function resolvePreview(identifier, options = {}) {
    const id = normalizeCustomerId(identifier);
    if (!/^[a-z0-9_-]{2,160}$/i.test(id)) return null;
    const includeProfileContext = Boolean(options.includeProfileContext);
    const cacheKey = getPublicPreviewResolutionCacheKey(id, includeProfileContext);
    const cachedPreview = getPublicPreviewCacheEntry(publicPreviewResolutionCache, cacheKey);
    if (cachedPreview) return cachedPreview;
    const diagnostics = options.diagnostics || null;
    const structuredPreview = await resolveStructuredPreview(id, { includeProfileContext, diagnostics });
    if (structuredPreview) {
      if (structuredPreview.profileContextPending) {
        return structuredPreview;
      }
      if (includeProfileContext && !hasExplicitPublicPreviewProfile(structuredPreview)) {
        setPublicPreviewBaseResolutionCache(id, structuredPreview);
        return structuredPreview;
      }
      return setPublicPreviewResolutionCache(id, includeProfileContext, structuredPreview);
    }

    const values = await readUiStateScopeValues(PHOTO_SCOPE, diagnostics);
    const photoMap = safeParseObject(values[PHOTO_KEY]);
    let preview = buildPreviewFromRecord(id, values, findPhotoRecord(photoMap, id));
    if (preview && (!includeProfileContext || hasExplicitPublicPreviewProfile(preview))) {
      return setPublicPreviewResolutionCache(id, includeProfileContext, preview);
    }
    if (!preview || includeProfileContext) {
      const customerValues = await readUiStateScopeValues(CUSTOMER_SCOPE, diagnostics);
      preview = resolvePreviewFromMaps(id, values, photoMap, parseCustomerRows(customerValues)) || preview;
    }
    if (preview) {
      if (includeProfileContext && !hasExplicitPublicPreviewProfile(preview)) {
        setPublicPreviewBaseResolutionCache(id, preview);
        return preview;
      }
      return setPublicPreviewResolutionCache(id, includeProfileContext, preview);
    }
    return null;
  }

  async function resolveFirstPreview(identifiers, options = {}) {
    const seen = new Set();
    for (const identifier of identifiers) {
      const id = normalizeCustomerId(identifier);
      const key = id.toLowerCase();
      if (!id || seen.has(key)) continue;
      seen.add(key);
      const preview = await resolvePreview(id, options);
      if (preview) return preview;
      if (hasPublicPreviewTransientReadFailure(options.diagnostics)) return null;
    }
    return null;
  }

  async function getPreviewPageResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const diagnostics = createPublicPreviewDiagnostics();
    const preview = await resolveFirstPreview([
      query.cid ||
        query.customerId ||
        query.id,
      req && req.params && (req.params.companySlug || req.params.customerId),
    ], { diagnostics });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      if (hasPublicPreviewTransientReadFailure(diagnostics)) {
        res.setHeader('Retry-After', '5');
        return res.status(503).send(buildTemporarilyUnavailableHtml());
      }
      return res.status(404).send(buildNotFoundHtml());
    }
    res.setHeader('Cache-Control', PUBLIC_PREVIEW_HTML_CACHE_CONTROL);
    const assetIdentifier = query.cid || query.customerId || query.id || (req && req.params && (req.params.companySlug || req.params.customerId));
    return res.status(200).send(buildPreviewHtml(preview, assetIdentifier));
  }

  async function getConceptPageResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const routeIdentifier = params.companySlug || params.customerId;
    const queryIdentifier = query.cid || query.customerId || query.id;
    const assetIdentifier = queryIdentifier || routeIdentifier;
    const diagnostics = createPublicPreviewDiagnostics();
    const preview = await resolveFirstPreview([
      queryIdentifier,
      routeIdentifier,
    ], { includeProfileContext: true, diagnostics });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      if (hasPublicPreviewTransientReadFailure(diagnostics)) {
        res.setHeader('Retry-After', '5');
        return res.status(503).send(buildTemporarilyUnavailableHtml());
      }
      return res.status(404).send(buildNotFoundHtml());
    }
    if (hasPendingPublicPreviewProfileContext(preview)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      res.setHeader('Retry-After', '2');
      return res.status(503).send(buildTemporarilyUnavailableHtml());
    }
    if (hasUnresolvedPublicPreviewProfile(preview)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(503).send(buildTemporarilyUnavailableHtml());
    }
    res.setHeader(
      'Cache-Control',
      hasExplicitPublicPreviewProfile(preview)
        ? PUBLIC_PREVIEW_HTML_CACHE_CONTROL
        : 'no-store, max-age=0, must-revalidate'
    );
    return res.status(200).send(buildConceptHtml(preview, routeIdentifier, assetIdentifier));
  }

  async function getPreviewAssetResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const routeIdentifier = params.companySlug || params.customerId;
    const queryIdentifier = query.cid || query.customerId || query.id;
    const diagnostics = createPublicPreviewDiagnostics();
    const preview = await resolveFirstPreview([
      queryIdentifier,
      routeIdentifier,
    ], { diagnostics });
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      if (hasPublicPreviewTransientReadFailure(diagnostics)) {
        res.setHeader('Retry-After', '5');
        return res.status(503).send('Preview image temporarily unavailable');
      }
      return res.status(404).send('Preview image unavailable');
    }
    const assetType = getPublicPreviewAssetType(params.assetType || query.type);
    const assetWidth = normalizePublicPreviewAssetWidth(assetType, query.w || query.width);
    const source = assetType === 'mockup' ? preview.mockupSource : preview.photoSource;
    try {
      const optimized = await optimizePublicPreviewImage(source, assetType, assetWidth);
      if (optimized && Buffer.isBuffer(optimized.buffer)) {
        res.setHeader('Content-Type', optimized.contentType);
        res.setHeader('Cache-Control', PUBLIC_PREVIEW_OPTIMIZED_ASSET_CACHE_CONTROL);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(optimized.buffer);
      }
    } catch (_error) {
      // If optimization fails, keep the public page usable by falling back to the original signed source.
    }
    if (isRemoteImageSource(source) && typeof res.redirect === 'function') {
      res.setHeader('Cache-Control', PUBLIC_PREVIEW_REDIRECT_ASSET_CACHE_CONTROL);
      return res.redirect(302, source);
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return res.status(404).send('Preview image unavailable');
  }

  return {
    getConceptPageResponse,
    getPreviewPageResponse,
    getPreviewAssetResponse,
    resolvePreview,
  };
}

module.exports = {
  CUSTOMER_KEY,
  CUSTOMER_SCOPE,
  PHOTO_KEY,
  PHOTO_SCOPE,
  createPublicWebdesignPreviewService,
};
