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
const PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS = 2600;
const PUBLIC_PREVIEW_PROFILE_CONTEXT_TIMEOUT_MS = 900;
const PUBLIC_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 5000;
const PUBLIC_PREVIEW_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PUBLIC_PREVIEW_IMAGE_LIMIT_INPUT_PIXELS = 45_000_000;
const PUBLIC_PREVIEW_HTML_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=1800';
const PUBLIC_PREVIEW_OPTIMIZED_ASSET_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const PUBLIC_PREVIEW_REDIRECT_ASSET_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=1800';
const PUBLIC_PREVIEW_PROFILE_ROLE = 'Webdesign & Software Ontwikkeling';
const PUBLIC_PREVIEW_PROFILE_DEFAULT_KEY = 'serve';
const PUBLIC_PREVIEW_PROFILES = Object.freeze({
  serve: Object.freeze({
    key: 'serve',
    name: 'Servé Creusen',
    role: PUBLIC_PREVIEW_PROFILE_ROLE,
    photoSource: '/assets/serve-creusen-profile.jpg?v=20260608e',
  }),
  martijn: Object.freeze({
    key: 'martijn',
    name: 'Martijn van de Ven',
    role: PUBLIC_PREVIEW_PROFILE_ROLE,
    photoSource: '/assets/martijn-van-de-ven-profile.png?v=20260609a',
  }),
});
let sharpModule = null;
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

function inferPublicPreviewProfileKey(objects) {
  return inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS)
    || inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_EXPLICIT_FIELDS)
    || inferPublicPreviewProfileKeyFromFields(objects, PUBLIC_PREVIEW_PROFILE_OWNER_FIELDS);
}

function resolvePublicPreviewProfile(record = null, customer = null, outboundContext = null) {
  const objects = collectProfileObjects(outboundContext, record, customer);
  const inferredKey = inferPublicPreviewProfileKey(objects);
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
  return Boolean(preview && preview.profile && preview.profile.source !== 'default');
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

async function retryPublicPreviewRead(reader, attempts = STRUCTURED_PREVIEW_READ_ATTEMPTS) {
  const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 1));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await withPublicPreviewTimeout(
        reader(),
        PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS,
        `public-preview-read-${attempt + 1}`
      );
      if (result !== null && result !== undefined) return result;
    } catch (_error) {
      // Public preview links are opened from email; a transient read miss should not become a broken page.
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
      inferPublicPreviewProfileKeyFromFields([context], PUBLIC_PREVIEW_PROFILE_SENT_EMAIL_FIELDS) &&
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

function buildPublicPreviewAssetPath(identifier, type) {
  const id = normalizeCustomerId(identifier);
  const assetType = normalizeString(type).toLowerCase() === 'mockup' ? 'mockup' : 'webdesign';
  return `/webdesign/${encodeURIComponent(id || 'preview')}/asset/${assetType}`;
}

function resolvePublicPreviewDisplayAssetSource(preview, type, assetIdentifier) {
  const assetType = getPublicPreviewAssetType(type);
  const source = assetType === 'mockup' ? preview && preview.mockupSource : preview && preview.photoSource;
  if (isRemoteImageSource(source)) return source;
  return buildPublicPreviewAssetPath(assetIdentifier || preview && preview.id, assetType);
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

async function optimizePublicPreviewImage(source, type) {
  const image = await fetchPublicPreviewImageBuffer(source);
  if (!image || !Buffer.isBuffer(image.buffer)) return null;
  const targetWidth = type === 'mockup' ? 1280 : 920;
  const buffer = await getSharp()(image.buffer, { limitInputPixels: PUBLIC_PREVIEW_IMAGE_LIMIT_INPUT_PIXELS })
    .rotate()
    .resize({
      width: targetWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({
      quality: type === 'mockup' ? 78 : 76,
      effort: 4,
    })
    .toBuffer();
  return {
    buffer,
    contentType: 'image/webp',
  };
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
  return words.join(' ') || 'Webdesign Concept';
}

function cleanPublicPreviewTitle(value, fallback) {
  const title = normalizeString(value);
  if (!title || /^manual import\b/i.test(title)) return titleFromIdentifier(fallback || title);
  return title;
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

function buildPreviewHtml(preview) {
  const photoSource = escapeHtml(preview.photoSource);
  const mockupSource = escapeHtml(preview.mockupSource);
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
    main{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:clamp(18px,2.8vw,46px)}
    .preview-grid{width:min(1660px,100%);height:min(920px,calc(100svh - clamp(36px,5.6vw,92px)));display:grid;grid-template-columns:minmax(280px,.78fr) minmax(420px,1.12fr);gap:clamp(22px,2.4vw,42px);align-items:center}
    .preview-frame{min-width:0;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .preview-frame img{display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain;background:transparent}
    .mockup-frame img{width:100%;max-height:86%}
    @media(max-width:900px){main{min-height:100vh;align-items:flex-start;padding:14px}.preview-grid{width:100%;height:auto;grid-template-columns:1fr;gap:14px}.preview-frame{height:auto;overflow:visible}.preview-frame img,.mockup-frame img{width:100%;max-height:none}}
  </style>
</head>
<body>
  <main>
    <div class="preview-grid" aria-label="Webdesign en device mockup naast elkaar">
      <div class="preview-frame website-frame"><img src="${photoSource}" alt="Webdesign" loading="eager" decoding="async" fetchpriority="high"></div>
      <div class="preview-frame mockup-frame"><img src="${mockupSource}" alt="Device mockup" loading="eager" decoding="async"></div>
    </div>
  </main>
</body>
</html>`;
}

function buildConceptHtml(preview, titleFallback, assetIdentifier) {
  const displayIdentifier = assetIdentifier || titleFallback || preview.id;
  const photoSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'webdesign', displayIdentifier));
  const mockupSource = escapeHtml(resolvePublicPreviewDisplayAssetSource(preview, 'mockup', displayIdentifier));
  const profile = preview.profile || resolvePublicPreviewProfile();
  const profileSource = escapeHtml(profile.photoSource);
  const profileName = escapeHtml(profile.name);
  const profileRole = escapeHtml(profile.role);
  const titleText = cleanPublicPreviewTitle(preview.title, titleFallback || preview.id);
  const title = escapeHtml(titleText);
  const narrativeCompanyName = escapeHtml(cleanPublicPreviewNarrativeCompanyName(titleText));
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
  <title>${title} | Design presentatie</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--navy:#1c2b50;--teal:#5bada0;--cream:#f2ede6;--muted:#728095;--rule:#d8d2ca;--panel:#fffaf4}
    html,body{min-height:100%;background:var(--cream);color:var(--navy);font-family:Inter,Arial,sans-serif}
    body{overflow-x:hidden;overflow-anchor:none}
    .concept-hero{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px clamp(18px,4vw,64px);gap:44px;position:relative}
    .hero-heading{text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center}
    .hero-label{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--teal);font-weight:800}
    .hero-title{font-family:Georgia,'Times New Roman',serif;font-size:clamp(32px,4vw,44px);font-weight:600;line-height:1.18;color:var(--navy)}
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
    @media(max-width:900px){.concept-hero{min-height:100svh;padding-top:34px;justify-content:flex-start}.mockup-stage{flex-direction:column;padding:0;gap:22px}.wide-stack{display:contents}.hero-heading{order:-1;width:100%}.tall{width:100%;order:0}.wide{width:100%;order:1}.divider{width:calc(100% - 36px)}}
  </style>
</head>
<body>
  <section class="concept-hero">
    <div class="mockup-stage">
      <div class="stage-card tall" data-loading="Webdesign wordt geladen"><img class="visual" src="${photoSource}" alt="Volledige webdesign preview" width="900" height="1440" loading="eager" decoding="async" fetchpriority="high"></div>
      <div class="wide-stack">
        <div class="hero-heading">
          <span class="hero-label">Webdesign presentatie</span>
          <h1 class="hero-title">${title}</h1>
        </div>
        <div class="stage-card wide" data-loading="Mockup wordt geladen"><img class="visual" src="${mockupSource}" alt="Device mockup preview" width="1600" height="1000" loading="lazy" decoding="async"></div>
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
      <h2><span class="about-title-desktop">Zó heb ik het webdesign gebouwd...</span><span class="about-title-mobile">Zó is het webdesign gebouwd!</span></h2>
      <p>Begonnen met HTML-code en een leeg scherm. De structuur, indeling en techniek heb ik stap voor stap opgebouwd. Vanuit daar heb ik gekeken hoe de website logisch, overzichtelijk en prettig werkt voor bezoekers.</p>
      <p>Ook heb ik de concurrenten van ${narrativeCompanyName} in kaart gebracht. Niet om te kopiëren, maar om te zien wat in deze markt sterk werkt: welke opbouw vertrouwen geeft, welke details bezoekers helpen en waar kansen liggen om het net frisser en beter neer te zetten.</p>
      <p>Die inzichten heb ik meegenomen in dit ontwerp. Zo ontstaat een website die niet alleen mooi oogt, maar ook duidelijk, klantgericht en doordacht aanvoelt.</p>
      <p>Later heb ik AI subtiel gebruikt om de uitstraling te versterken. AI is krachtig, maar kan kleine details missen. Vergeef me als iets niet helemaal klopt; zoals een adres of een logo.</p>
      <p>Naast webdesign bouw ik ook bedrijfssoftware, dashboards en klantportalen. Ook voor onderhoud en doorontwikkeling denk ik graag mee.</p>
    </div>
  </section>
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

function createPublicWebdesignPreviewService(options = {}) {
  const getUiStateValues = typeof options.getUiStateValues === 'function' ? options.getUiStateValues : async () => ({ values: {} });
  const dataOpsStore = options.dataOpsStore && typeof options.dataOpsStore === 'object' ? options.dataOpsStore : null;
  const profileContextTimeoutMs = Math.max(
    50,
    Math.min(
      PUBLIC_PREVIEW_READ_ATTEMPT_TIMEOUT_MS,
      Number(options.profileContextTimeoutMs) || PUBLIC_PREVIEW_PROFILE_CONTEXT_TIMEOUT_MS
    )
  );

  async function resolveStructuredPreview(id, options = {}) {
    if (
      !dataOpsStore ||
      typeof dataOpsStore.listCustomers !== 'function' ||
      typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function'
    ) {
      return null;
    }

    const directPhotoEntries = await retryPublicPreviewRead(() => dataOpsStore.listDesignPhotosWithSignedUrls({
      ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
      expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
      identifiers: [id],
      maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
    }));
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
      const loaded = await retryPublicPreviewRead(() =>
        dataOpsStore.listOutboundRecipientGuardsForPreview({
          ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
          identifiers,
          maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
        })
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
      const loadedCustomers = await retryPublicPreviewRead(() =>
        dataOpsStore.listCustomers(PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS)
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
      const enrichedPreview = await withPublicPreviewTimeout(
        enrichDirectPreview(),
        profileContextTimeoutMs,
        'public-preview-profile-context'
      );
      return enrichedPreview || preview;
    }

    let outboundContexts = await loadOutboundContexts(
      collectPublicPreviewContextIdentifiers(id, directRecords, [])
    );
    let customers = [];
    const loadedCustomers = await retryPublicPreviewRead(() =>
      dataOpsStore.listCustomers(PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS)
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
      }));
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
    const structuredPreview = await resolveStructuredPreview(id, { includeProfileContext });
    if (structuredPreview) return structuredPreview;

    const state = await getUiStateValues(PHOTO_SCOPE, getPublicPreviewReadOptions(PHOTO_SCOPE));
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const photoMap = safeParseObject(values[PHOTO_KEY]);
    let preview = buildPreviewFromRecord(id, values, findPhotoRecord(photoMap, id));
    if (preview && (!includeProfileContext || hasExplicitPublicPreviewProfile(preview))) return preview;
    if (!preview || includeProfileContext) {
      const customerState = await getUiStateValues(CUSTOMER_SCOPE, getPublicPreviewReadOptions(CUSTOMER_SCOPE));
      const customerValues = customerState && customerState.values && typeof customerState.values === 'object' ? customerState.values : {};
      preview = resolvePreviewFromMaps(id, values, photoMap, parseCustomerRows(customerValues)) || preview;
    }
    return preview;
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
    }
    return null;
  }

  async function getPreviewPageResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const preview = await resolveFirstPreview([
      query.cid ||
        query.customerId ||
        query.id,
      req && req.params && (req.params.companySlug || req.params.customerId),
    ]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(404).send(buildNotFoundHtml());
    }
    res.setHeader('Cache-Control', PUBLIC_PREVIEW_HTML_CACHE_CONTROL);
    return res.status(200).send(buildPreviewHtml(preview));
  }

  async function getConceptPageResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const routeIdentifier = params.companySlug || params.customerId;
    const queryIdentifier = query.cid || query.customerId || query.id;
    const assetIdentifier = queryIdentifier || routeIdentifier;
    const preview = await resolveFirstPreview([
      queryIdentifier,
      routeIdentifier,
    ], { includeProfileContext: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(404).send(buildNotFoundHtml());
    }
    res.setHeader('Cache-Control', PUBLIC_PREVIEW_HTML_CACHE_CONTROL);
    return res.status(200).send(buildConceptHtml(preview, routeIdentifier, assetIdentifier));
  }

  async function getPreviewAssetResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const routeIdentifier = params.companySlug || params.customerId;
    const queryIdentifier = query.cid || query.customerId || query.id;
    const preview = await resolveFirstPreview([
      queryIdentifier,
      routeIdentifier,
    ]);
    if (!preview) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(404).send('Preview image unavailable');
    }
    const assetType = getPublicPreviewAssetType(params.assetType || query.type);
    const source = assetType === 'mockup' ? preview.mockupSource : preview.photoSource;
    if (isRemoteImageSource(source) && typeof res.redirect === 'function') {
      res.setHeader('Cache-Control', PUBLIC_PREVIEW_REDIRECT_ASSET_CACHE_CONTROL);
      return res.redirect(302, source);
    }
    try {
      const optimized = await optimizePublicPreviewImage(source, assetType);
      if (optimized && Buffer.isBuffer(optimized.buffer)) {
        res.setHeader('Content-Type', optimized.contentType);
        res.setHeader('Cache-Control', PUBLIC_PREVIEW_OPTIMIZED_ASSET_CACHE_CONTROL);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(optimized.buffer);
      }
    } catch (_error) {
      // If optimization fails, keep the public page usable by falling back to the original signed source.
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
