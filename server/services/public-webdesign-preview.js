const PHOTO_SCOPE = 'premium_database_photos';
const PHOTO_KEY = 'softora_database_photos_v1';
const CUSTOMER_SCOPE = 'premium_customers_database';
const CUSTOMER_KEY = 'softora_customers_premium_v1';
const STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES = 12;

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
      expiresInSeconds: STRUCTURED_PREVIEW_SIGNED_URL_TTL_SECONDS,
      identifiers: [id],
      maxMatches: STRUCTURED_PREVIEW_MAX_SIGNED_MATCHES,
    });
    let preview = resolvePreviewFromMaps(id, {}, buildPhotoMapFromStructuredEntries(directPhotoEntries), []);
    if (preview) return preview;

    const customers = await dataOpsStore.listCustomers();
    const candidates = findCustomerCandidates(customers, id);
    const identifiers = Array.from(new Set([
      id,
      ...candidates.flatMap(collectCustomerStructuredPreviewIdentifiers),
    ].filter(Boolean)));

    if (identifiers.length > 1) {
      const photoEntries = await dataOpsStore.listDesignPhotosWithSignedUrls({
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

    const state = await getUiStateValues(PHOTO_SCOPE);
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const photoMap = safeParseObject(values[PHOTO_KEY]);
    let preview = buildPreviewFromRecord(id, values, findPhotoRecord(photoMap, id));
    if (!preview) {
      const customerState = await getUiStateValues(CUSTOMER_SCOPE);
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
    return res.status(200).send(buildPreviewHtml(preview));
  }

  return {
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
