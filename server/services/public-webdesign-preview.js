const PHOTO_SCOPE = 'premium_database_photos';
const PHOTO_KEY = 'softora_database_photos_v1';
const CUSTOMER_SCOPE = 'premium_customers_database';
const CUSTOMER_KEY = 'softora_customers_premium_v1';
const PUBLIC_PREVIEW_READ_FAILURE_COOLDOWN_PREFIX = 'public_webdesign_preview';
const PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS = Object.freeze({
  suppressReadFailureCooldown: true,
  suppressStaleReadCacheLog: true,
  suppressTransientReadFailureLog: true,
});
const STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES = 12;
const PUBLIC_PREVIEW_BACKGROUND_PATH = '/assets/webdesign-preview-coastal-dunes-background.png?v=20260607a';
const PUBLIC_PREVIEW_BACKGROUND_FILE = 'webdesign-preview-coastal-dunes-background.png';
const PUBLIC_PREVIEW_PROFILE_FILE = 'serve-creusen-profile.jpg';
const PUBLIC_PREVIEW_PERSONAL_TEXT_FILE = 'webdesign-preview-personal-text.png';
const PREVIEW_POSTER_WIDTH = 2400;
const PREVIEW_POSTER_HEIGHT = 1350;
const PREVIEW_POSTER_FETCH_TIMEOUT_MS = 10000;

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

function clampChunkCount(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function isValidImageSource(value) {
  const source = normalizeString(value);
  return /^https?:\/\//i.test(source) || /^data:image\//i.test(source);
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
  return slugifyCompanyName(value).replace(/-(?:nl|eu|com|be|de|net|org|info|io|co|bv)$/i, '');
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

function buildPreviewFromRecord(id, values, record) {
  const photoSource = resolvePreviewSource(values, record, 'photo');
  const mockupSource = resolvePreviewSource(values, record, 'mockup');
  if (!isValidImageSource(photoSource) || !isValidImageSource(mockupSource)) return null;
  return { id, photoSource, mockupSource };
}

function getUrlOrigin(value) {
  try {
    return new URL(normalizeString(value)).origin;
  } catch (_error) {
    return '';
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(normalizeCustomerId(value));
}

function buildPosterPathForRequest(req) {
  const params = req && req.params && typeof req.params === 'object' ? req.params : {};
  const query = req && req.query && typeof req.query === 'object' ? req.query : {};
  const routeId = params.companySlug || params.customerId || '';
  const routeBase = params.companySlug
    ? `/webdesign/${encodePathSegment(routeId)}`
    : `/mailklaar/${encodePathSegment(routeId)}`;
  const posterQuery = new URLSearchParams();
  ['cid', 'customerId', 'id'].forEach((key) => {
    const value = normalizeString(query[key]);
    if (value) posterQuery.set(key, value);
  });
  const suffix = posterQuery.toString();
  return `${routeBase}/poster.png${suffix ? `?${suffix}` : ''}`;
}

function buildPosterChromeSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_POSTER_WIDTH}" height="${PREVIEW_POSTER_HEIGHT}" viewBox="0 0 ${PREVIEW_POSTER_WIDTH} ${PREVIEW_POSTER_HEIGHT}">
  <defs>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="34" stdDeviation="30" flood-color="#4a3a24" flood-opacity=".24"/>
    </filter>
    <linearGradient id="warmVeil" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff8eb" stop-opacity=".38"/>
      <stop offset=".55" stop-color="#fff1db" stop-opacity=".16"/>
      <stop offset="1" stop-color="#604a2b" stop-opacity=".16"/>
    </linearGradient>
    <linearGradient id="cardShade" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset="1" stop-color="#f7efe2" stop-opacity=".91"/>
    </linearGradient>
    <linearGradient id="photoPanel" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f1eadf" stop-opacity=".94"/>
      <stop offset="1" stop-color="#ded2bf" stop-opacity=".88"/>
    </linearGradient>
  </defs>
  <rect width="2400" height="1350" fill="url(#warmVeil)"/>
  <rect width="2400" height="1350" fill="#21180f" opacity=".1"/>
  <rect x="70" y="84" width="850" height="1190" rx="16" fill="#ffffff" opacity=".16" filter="url(#softShadow)"/>
  <rect x="990" y="250" width="1325" height="730" rx="16" fill="#ffffff" opacity=".18" filter="url(#softShadow)"/>
  <rect x="990" y="970" width="1325" height="300" rx="22" fill="url(#cardShade)" stroke="#ffffff" stroke-opacity=".72" filter="url(#softShadow)"/>
  <rect x="1024" y="1008" width="224" height="216" rx="18" fill="url(#photoPanel)" stroke="#ffffff" stroke-opacity=".62"/>
  <circle cx="1136" cy="1116" r="76" fill="#ffffff" opacity=".92"/>
</svg>`);
}

function parseDataImageBuffer(source) {
  const match = normalizeString(source).match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  return match ? Buffer.from(match[1].replace(/\s/g, ''), 'base64') : null;
}

async function fetchImageBuffer(source) {
  const dataBuffer = parseDataImageBuffer(source);
  if (dataBuffer) return dataBuffer;
  const url = normalizeString(source);
  if (!/^https?:\/\//i.test(url)) throw new Error('Ongeldige poster-afbeelding.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_POSTER_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response || !response.ok) throw new Error('Poster-afbeelding kon niet worden geladen.');
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function readPreviewAssetBuffer(fileName) {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  return fs.readFile(path.join(process.cwd(), 'assets', fileName));
}

async function createRoundImageBuffer(sharp, input, size) {
  const image = await sharp(input)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(image)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function buildPreviewPosterPng(preview) {
  const sharp = require('sharp');
  const [background, photo, mockup, profile] = await Promise.all([
    readPreviewAssetBuffer(PUBLIC_PREVIEW_BACKGROUND_FILE),
    fetchImageBuffer(preview.photoSource),
    fetchImageBuffer(preview.mockupSource),
    readPreviewAssetBuffer(PUBLIC_PREVIEW_PROFILE_FILE),
  ]);
  const personalText = await readPreviewAssetBuffer(PUBLIC_PREVIEW_PERSONAL_TEXT_FILE);
  const base = await sharp(background)
    .resize(PREVIEW_POSTER_WIDTH, PREVIEW_POSTER_HEIGHT, { fit: 'cover' })
    .modulate({ brightness: 0.94, saturation: 0.82 })
    .composite([{ input: buildPosterChromeSvg(), left: 0, top: 0 }])
    .png()
    .toBuffer();
  const websiteImage = await sharp(photo)
    .resize(820, 1160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const mockupImage = await sharp(mockup)
    .resize(1325, 730, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const profileImage = await createRoundImageBuffer(sharp, profile, 152);
  return sharp(base)
    .composite([
      { input: websiteImage, left: 85, top: 95 },
      { input: mockupImage, left: 990, top: 250 },
      { input: profileImage, left: 1060, top: 1039 },
      { input: personalText, left: 1284, top: 970 },
    ])
    .png()
    .toBuffer();
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

function resolvePreviewFromMaps(id, values, photoMap, customers) {
  let record = findPhotoRecord(photoMap, id);
  let preview = buildPreviewFromRecord(id, values, record);
  if (preview) return preview;

  record = findPhotoRecordBySlug(photoMap, id);
  preview = buildPreviewFromRecord(normalizeString(record && (record.id || record.customerId)) || id, values, record);
  if (preview) return preview;

  const directCustomer = findCustomerById(customers, id);
  const matchedCustomers = findCustomerCandidates(customers, id);
  const candidates = directCustomer
    ? [directCustomer].concat(matchedCustomers.filter((customer) => customer !== directCustomer))
    : matchedCustomers;
  for (const customer of candidates) {
    const candidateId = normalizeString(customer && (customer.id || customer.customerId || customer.databaseId)) || id;
    record = findPhotoRecordByIdentity(photoMap, getCustomerIdentityKeys(customer)) || findPhotoRecord(photoMap, candidateId) || record;
    preview = buildPreviewFromRecord(candidateId, values, record);
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

function buildPreviewHtml(preview, posterPath) {
  const posterSource = escapeHtml(posterPath);
  const backgroundSource = escapeHtml(PUBLIC_PREVIEW_BACKGROUND_PATH);
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="preload" as="image" href="${backgroundSource}">
  <link rel="preload" as="image" href="${posterSource}" fetchpriority="high">
  <title>Webdesign preview | Softora</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;background-color:#f1e6d3;color:#1a1a2e;font-family:Inter,Arial,sans-serif}
    body{background:linear-gradient(180deg, rgba(255,249,239,.26), rgba(241,230,211,.44)),url("${backgroundSource}") center/cover fixed no-repeat}
    main{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:clamp(12px,2vw,34px)}
    .poster-image{display:block;width:min(100%,1940px);height:auto;max-height:calc(100svh - clamp(24px,4vw,68px));object-fit:contain;box-shadow:0 34px 90px rgba(73,58,36,.22)}
    @media(max-width:900px){body{background-attachment:scroll}main{align-items:flex-start;padding:12px}.poster-image{width:100%;max-height:none}}
  </style>
</head>
<body>
  <main>
    <img class="poster-image" src="${posterSource}" alt="Webdesignpresentatie met persoonlijk bericht" loading="eager" decoding="async" fetchpriority="high">
  </main>
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

  async function resolveStructuredPreview(id) {
    if (
      !dataOpsStore ||
      typeof dataOpsStore.listCustomers !== 'function' ||
      typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function'
    ) {
      return null;
    }

    const directPhotoEntries = await dataOpsStore.listDesignPhotosWithSignedUrls({
      ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
      expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
      identifiers: [id],
      maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
    });
    let preview = resolvePreviewFromMaps(id, {}, buildPhotoMapFromStructuredEntries(directPhotoEntries), []);
    if (preview) return preview;

    const customers = await dataOpsStore.listCustomers(PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS);
    const candidates = findCustomerCandidates(customers, id);
    const identifiers = Array.from(new Set([
      id,
      ...candidates.flatMap(collectCustomerStructuredPreviewIdentifiers),
    ].filter(Boolean)));

    if (identifiers.length > 1) {
      const photoEntries = await dataOpsStore.listDesignPhotosWithSignedUrls({
        ...PUBLIC_PREVIEW_DATA_OPS_READ_OPTIONS,
        expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
        identifiers,
        maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
      });
      preview = resolvePreviewFromMaps(id, {}, buildPhotoMapFromStructuredEntries(photoEntries), candidates);
      if (preview) return preview;
    }

    return null;
  }

  async function resolvePreview(identifier) {
    const id = normalizeCustomerId(identifier);
    if (!/^[a-z0-9_-]{2,160}$/i.test(id)) return null;
    const structuredPreview = await resolveStructuredPreview(id);
    if (structuredPreview) return structuredPreview;

    const state = await getUiStateValues(PHOTO_SCOPE, getPublicPreviewReadOptions(PHOTO_SCOPE));
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const photoMap = safeParseObject(values[PHOTO_KEY]);
    let preview = buildPreviewFromRecord(id, values, findPhotoRecord(photoMap, id));
    if (!preview) {
      const customerState = await getUiStateValues(CUSTOMER_SCOPE, getPublicPreviewReadOptions(CUSTOMER_SCOPE));
      const customerValues = customerState && customerState.values && typeof customerState.values === 'object' ? customerState.values : {};
      preview = resolvePreviewFromMaps(id, values, photoMap, parseCustomerRows(customerValues));
    }
    return preview;
  }

  async function resolveFirstPreview(identifiers) {
    const seen = new Set();
    for (const identifier of identifiers) {
      const id = normalizeCustomerId(identifier);
      const key = id.toLowerCase();
      if (!id || seen.has(key)) continue;
      seen.add(key);
      const preview = await resolvePreview(id);
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
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) return res.status(404).send(buildNotFoundHtml());
    return res.status(200).send(buildPreviewHtml(preview, buildPosterPathForRequest(req)));
  }

  async function getPreviewPosterResponse(req, res) {
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const preview = await resolveFirstPreview([
      query.cid ||
        query.customerId ||
        query.id,
      req && req.params && (req.params.companySlug || req.params.customerId),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) return res.status(404).send('Poster niet gevonden.');
    try {
      const poster = await buildPreviewPosterPng(preview);
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(poster);
    } catch (error) {
      console.error('[PublicWebdesignPreview] Poster genereren mislukt:', error && error.message ? error.message : error);
      return res.status(502).send('Poster niet beschikbaar.');
    }
  }

  return {
    getPreviewPosterResponse,
    getPreviewPageResponse,
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
