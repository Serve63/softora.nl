const { stableHash } = require('./data-ops-serialization');
const {
  buildGooglePlacesSearchQueries,
  fetchDeepSearchBusinessRows,
} = require('./premium-database-import');
const MASS_RESEARCH_SCOPE = 'premium_database_mass_research';
const MASS_RESEARCH_JOBS_KEY = 'softora_mass_research_jobs_v1';
const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.types,places.businessStatus,nextPageToken';
const LIMITS = { desired: [1, 5000, 500], discovery: [1, 12, 6], enrichment: [1, 100, 50], domain: [1, 5, 2], timeout: [1000, 12000, 4500], runMs: [1000, 120000, 25000], tasks: [1, 1000, 250] };
const PERSONAL_EMAIL_DOMAINS = new Set('gmail.com,googlemail.com,hotmail.com,hotmail.nl,icloud.com,live.com,live.nl,outlook.com,outlook.nl,yahoo.com,yahoo.nl'.split(','));
const text = (value) => String(value || '').trim();
const now = () => new Date().toISOString();
const trim = (value, max) => { const stringValue = text(value); return max > 0 && stringValue.length > max ? stringValue.slice(0, max) : stringValue; };
function isBlockedWebsiteHost(hostname) {
  const host = text(hostname).toLowerCase();
  const private172 = host.match(/^172\.(\d{1,2})\./);
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '[::1]' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}
function normalizeWebsiteUrl(value) {
  try {
    const raw = text(value);
    if (!raw) return '';
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' || isBlockedWebsiteHost(parsed.hostname)) return '';
    parsed.hash = ''; return parsed.toString();
  } catch (_error) { return ''; }
}
function normalizeWebsiteDomain(value) {
  try {
    const url = normalizeWebsiteUrl(value);
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch (_error) { return ''; }
}
function inferBranchFromGoogleTypes(types = []) {
  const normalized = new Set((Array.isArray(types) ? types : []).map((type) => text(type).toLowerCase()));
  if (['restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway'].some((type) => normalized.has(type))) return 'Horeca & Restaurants';
  if (['store', 'clothing_store', 'shoe_store', 'jewelry_store', 'furniture_store'].some((type) => normalized.has(type))) return 'Retail & Winkels';
  if (['real_estate_agency', 'accounting', 'lawyer', 'insurance_agency'].some((type) => normalized.has(type))) return 'Zakelijke Dienstverlening';
  if (['general_contractor', 'plumber', 'electrician', 'roofing_contractor'].some((type) => normalized.has(type))) return 'Bouw & Vastgoed';
  if (['doctor', 'dentist', 'physiotherapist', 'health'].some((type) => normalized.has(type))) return 'Gezondheidszorg';
  return 'Overig';
}
function extractEmailCandidatesFromHtml(html) {
  const decoded = String(html || '').replace(/&#64;|&#x40;|%40/gi, '@').replace(/&commat;/gi, '@').replace(/&period;/gi, '.').replace(/&amp;/gi, '&');
  const candidates = new Set();
  decoded.replace(/mailto:([^"'\s?<>]+)/gi, (_match, value) => { candidates.add(decodeURIComponent(value).toLowerCase()); return ''; });
  decoded.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (value) => { candidates.add(value.toLowerCase()); return ''; });
  return Array.from(candidates).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email) && !/^(noreply|no-reply|donotreply|example)@/i.test(email));
}
function pickBestBusinessEmail(emails, websiteUrl) { const websiteDomain = normalizeWebsiteDomain(websiteUrl); return emails.find((email) => normalizeWebsiteDomain(email.split('@')[1]) === websiteDomain) || emails[0] || ''; }
async function discoverBusinessEmailFromWebsite(websiteUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
  if (!normalizedUrl || typeof fetchImpl !== 'function') return '';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 4500) : null;
  try {
    const response = await fetchImpl(normalizedUrl, { method: 'GET', redirect: 'follow', signal: controller ? controller.signal : undefined, headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.7,*/*;q=0.2', 'user-agent': 'SoftoraMassResearch/1.0' } });
    const contentType = response && response.headers && typeof response.headers.get === 'function' ? text(response.headers.get('content-type')).toLowerCase() : '';
    const contentLength = response && response.headers && typeof response.headers.get === 'function' ? Number(response.headers.get('content-length') || 0) : 0;
    if (!response || !response.ok || typeof response.text !== 'function' || contentType && !/(html|text)/.test(contentType) || Number.isFinite(contentLength) && contentLength > 700000) return '';
    return pickBestBusinessEmail(extractEmailCandidatesFromHtml((await response.text()).slice(0, 350000)), normalizedUrl);
  } catch (_error) { return ''; } finally { if (timeout) clearTimeout(timeout); }
}
function getGooglePlacesApiKey(env = process.env) { return text(env.GOOGLE_MAPS_SERVER_API_KEY || env.GOOGLE_MAPS_API_KEY || env.GOOGLE_PLACES_API_KEY); }
function getMassResearchPreflightStatus(env = process.env) {
  return {
    ok: true,
    googlePlacesConfigured: Boolean(getGooglePlacesApiKey(env)),
    openAiFallbackConfigured: Boolean(text(env.OPENAI_API_KEY)),
    limits: {
      desiredDefault: LIMITS.desired[2],
      desiredMax: LIMITS.desired[1],
      discoveryConcurrencyDefault: LIMITS.discovery[2],
      discoveryConcurrencyMax: LIMITS.discovery[1],
      enrichmentConcurrencyDefault: LIMITS.enrichment[2],
      enrichmentConcurrencyMax: LIMITS.enrichment[1],
      domainConcurrencyDefault: LIMITS.domain[2],
      domainConcurrencyMax: LIMITS.domain[1],
      maxTasksPerRunDefault: LIMITS.tasks[2],
      maxTasksPerRunMax: LIMITS.tasks[1],
      websiteTimeoutMsDefault: LIMITS.timeout[2],
    },
    qualityRails: {
      duplicateKeys: ['google_place_id', 'domain', 'email', 'phone', 'company_address'],
      partialUpsertOnly: true,
      fullCustomerStateRewrite: false,
      openAiFallbackDefault: false,
    },
  };
}
async function readJsonResponse(response) {
  if (response && typeof response.json === 'function') return response.json();
  if (!response || typeof response.text !== 'function') return {};
  try { return JSON.parse(await response.text() || '{}'); } catch (_error) { return {}; }
}
async function fetchGooglePlacesBusinesses(input = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const env = deps.env || process.env;
  const apiKey = getGooglePlacesApiKey(env);
  const requestedCount = int(input.count, LIMITS.tasks);
  if (typeof fetchImpl !== 'function') throw new Error('Bedrijven ophalen is niet beschikbaar op deze server.');
  if (!apiKey) throw new Error('Google Places API-key ontbreekt.');
  const places = [];
  const seen = new Set();
  for (const query of buildGooglePlacesSearchQueries(input.query, requestedCount)) {
    let pageToken = '';
    for (let pageIndex = 0; pageIndex < 3 && places.length < requestedCount; pageIndex += 1) {
      const body = { textQuery: text(query), pageSize: Math.min(20, Math.max(1, requestedCount - places.length)), languageCode: 'nl', regionCode: 'NL', includePureServiceAreaBusinesses: true };
      if (pageToken) body.pageToken = pageToken;
      const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK }, body: JSON.stringify(body) });
      const data = await readJsonResponse(response);
      if (!response || !response.ok) throw new Error(text(data && data.error && data.error.message) || 'Google Places kon geen bedrijven ophalen.');
      (Array.isArray(data && data.places) ? data.places : []).forEach((place) => {
        const status = text(place && place.businessStatus);
        const key = `${text(place && place.id)}|${getPlaceName(place).toLowerCase()}|${text(place && place.formattedAddress).toLowerCase()}|${normalizeWebsiteDomain(place && place.websiteUri)}`;
        if (!getPlaceName(place) || status && status !== 'OPERATIONAL' || seen.has(key)) return;
        seen.add(key);
        places.push(place);
      });
      pageToken = text(data && data.nextPageToken);
      if (!pageToken) break;
    }
    if (places.length >= requestedCount) break;
  }
  return places.slice(0, requestedCount);
}
const int = (value, [min, max, fallback]) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback; };
function normalizeIdentityText(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizePhone(value) { return text(value).replace(/\D+/g, ''); }
function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  return email && email !== '—' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
function normalizeCompanyAddress(company, address) {
  const companyKey = normalizeIdentityText(company);
  const addressKey = normalizeIdentityText(address);
  return companyKey && addressKey && addressKey !== 'onbekend' ? `${companyKey}|${addressKey}` : '';
}
function getPlaceName(place) { return text(place && (place.displayName && typeof place.displayName === 'object' ? place.displayName.text : place.displayName)); }
function getPlacePhone(place) { return text(place && (place.nationalPhoneNumber || place.internationalPhoneNumber)); }
function normalizeQueryList(input = {}) {
  const raw = Array.isArray(input.queries)
    ? input.queries
    : Array.isArray(input.locations)
      ? input.locations
      : text(input.query || input.location)
        ? [input.query || input.location]
        : [];
  return Array.from(new Set(raw.map((item) => text(item && (item.query || item.location || item.label || item))).filter(Boolean).map((item) => item.slice(0, 160))));
}
function collectCustomerIdentityKeys(customer = {}) {
  const pairs = [
    ['google_place_id', text(customer.googlePlaceId || customer.google_place_id)],
    ['domain', normalizeWebsiteDomain(customer.website || customer.dom || customer.url || customer.site)],
    ['email', normalizeEmail(customer.email || customer.contactEmail)],
    ['phone', normalizePhone(customer.tel || customer.telefoon || customer.phone || customer.contactPhone)],
    ['company_address', normalizeCompanyAddress(customer.bedrijf || customer.company || customer.companyName, customer.stad || customer.address)],
  ];
  return pairs.filter(([type, value]) => value && (type !== 'phone' || value.length >= 7)).map(([type, value]) => ({ type, value }));
}
function identityKeyId(key) {
  return `${text(key && key.type)}:${text(key && key.value)}`;
}
function uniqueIdentityKeys(keys) {
  const seen = new Set();
  return (Array.isArray(keys) ? keys : []).reduce((output, key) => {
    const type = text(key && key.type);
    const value = text(key && key.value);
    const id = `${type}:${value}`;
    if (type && value && !seen.has(id)) {
      seen.add(id);
      output.push({ type, value });
    }
    return output;
  }, []);
}
function createDomainLimiter(maxPerDomain) {
  const active = new Map();
  const queues = new Map();
  const limit = Math.max(1, Number(maxPerDomain) || 1);
  function release(key) {
    active.set(key, Math.max(0, Number(active.get(key)) - 1));
    const next = (queues.get(key) || []).shift();
    if (next) next();
  }
  return (domain, task) => new Promise((resolve, reject) => {
    const key = text(domain) || '_unknown';
    const start = () => {
      active.set(key, Number(active.get(key) || 0) + 1);
      Promise.resolve().then(task).then(resolve, reject).finally(() => release(key));
    };
    if (Number(active.get(key) || 0) < limit) return start();
    const queue = queues.get(key) || [];
    queue.push(start);
    queues.set(key, queue);
  });
}
async function mapWithConcurrency(items, concurrency, mapper) {
  const source = Array.isArray(items) ? items : [];
  const output = new Array(source.length);
  let cursor = 0;
  async function worker() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(source[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(source.length, Math.max(1, concurrency)) }, worker));
  return output;
}
const emptyStats = () => ({ candidatesFound: 0, enriched: 0, emailsFound: 0, inserted: 0, updated: 0, duplicates: 0, failed: 0, openAiFallbackCalls: 0 });
function normalizeJob(raw = {}) {
  const job = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(job.id),
    status: text(job.status || 'queued') || 'queued',
    desiredCount: int(job.desiredCount, LIMITS.desired),
    options: job.options && typeof job.options === 'object' ? job.options : {},
    queries: Array.isArray(job.queries) ? job.queries : [],
    tasks: Array.isArray(job.tasks) ? job.tasks : [],
    stats: { ...emptyStats(), ...(job.stats && typeof job.stats === 'object' ? job.stats : {}) },
    createdAt: text(job.createdAt) || now(),
    startedAt: text(job.startedAt),
    updatedAt: text(job.updatedAt) || now(),
    finishedAt: text(job.finishedAt),
    cancelledAt: text(job.cancelledAt),
    error: text(job.error),
  };
}
function summarizeJob(job) {
  const normalized = normalizeJob(job);
  const count = (predicate) => normalized.tasks.filter(predicate).length;
  const elapsedMs = normalized.startedAt ? Math.max(0, Date.now() - Date.parse(normalized.startedAt || normalized.createdAt)) : 0;
  return {
    id: normalized.id,
    ok: true,
    status: normalized.status,
    desiredCount: normalized.desiredCount,
    queryCount: normalized.queries.length,
    queryDone: normalized.queries.filter((item) => item.status === 'done' || item.status === 'error').length,
    taskCount: normalized.tasks.length,
    queued: count((task) => task.status === 'queued'),
    running: count((task) => task.status === 'running'),
    done: count((task) => task.status === 'done' || task.status === 'duplicate'),
    failed: count((task) => task.status === 'error'),
    stats: normalized.stats,
    perHour: elapsedMs > 0 ? Math.round((Number(normalized.stats.enriched || 0) / elapsedMs) * 3600000) : 0,
    createdAt: normalized.createdAt,
    startedAt: normalized.startedAt,
    updatedAt: normalized.updatedAt,
    finishedAt: normalized.finishedAt,
    cancelledAt: normalized.cancelledAt,
    error: normalized.error,
  };
}
function buildTaskId(jobId, place, query) {
  return `${jobId}_task_${stableHash([
    text(place && place.id),
    getPlaceName(place),
    text(place && place.formattedAddress),
    normalizeWebsiteDomain(place && place.websiteUri),
    text(query),
  ].join('|'), 18)}`;
}
function buildCandidate(place, query, jobId) {
  const websiteUrl = normalizeWebsiteUrl(place && place.websiteUri);
  return {
    taskId: buildTaskId(jobId, place, query),
    googlePlaceId: text(place && place.id),
    company: getPlaceName(place),
    address: text(place && place.formattedAddress),
    phone: getPlacePhone(place),
    websiteUrl,
    websiteDomain: normalizeWebsiteDomain(websiteUrl),
    types: Array.isArray(place && place.types) ? place.types : [],
    query: text(query),
  };
}
function buildCustomer(candidate, enrichment, job) {
  const email = normalizeEmail(enrichment && enrichment.email);
  const domain = normalizeWebsiteDomain(candidate.websiteDomain || candidate.websiteUrl);
  const today = now().slice(0, 10);
  const sourceKey = stableHash([candidate.googlePlaceId, domain, candidate.company, candidate.address].join('|'), 20);
  return {
    id: `mass_research_${sourceKey}`,
    bedrijf: trim(candidate.company, 240),
    naam: trim(candidate.company, 240),
    tel: candidate.phone || '—',
    email: email || '—',
    stad: candidate.address || 'Onbekend',
    website: domain || candidate.websiteUrl || '',
    dom: domain || '',
    branche: inferBranchFromGoogleTypes(candidate.types),
    status: 'benaderbaar',
    databaseStatus: 'benaderbaar',
    verantwoordelijk: 'Serve',
    service: 'website',
    createdAt: today,
    updatedAt: today,
    source: 'premium-database-mass-research',
    googlePlaceId: candidate.googlePlaceId,
    massResearchJobId: job.id,
    massResearchQuery: candidate.query,
  };
}
function mergeCustomer(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    const valueText = text(value);
    if (valueText && valueText !== '—' && (!text(merged[key]) || text(merged[key]) === '—')) merged[key] = value;
  });
  merged.id = text(existing.id || incoming.id);
  merged.status = text(existing.status || existing.databaseStatus) || incoming.status || 'benaderbaar';
  merged.databaseStatus = text(existing.databaseStatus || existing.status) || incoming.databaseStatus || 'benaderbaar';
  merged.updatedAt = incoming.updatedAt || now().slice(0, 10);
  merged.massResearchJobId = incoming.massResearchJobId;
  if (incoming.googlePlaceId && !merged.googlePlaceId) merged.googlePlaceId = incoming.googlePlaceId;
  return merged;
}
function buildExistingIndex(customers) {
  const byId = new Map();
  const byKey = new Map();
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const id = text(customer && customer.id);
    if (!id) return;
    byId.set(id, customer);
    collectCustomerIdentityKeys(customer).forEach((key) => {
      if (!byKey.has(identityKeyId(key))) byKey.set(identityKeyId(key), id);
    });
  });
  return { byId, byKey };
}
function findMatchId(keys, keyIndex) {
  for (const key of keys) {
    const match = keyIndex.get(identityKeyId(key));
    if (match) return match;
  }
  return '';
}
async function loadIdentityOwners(dataOpsStore, keys) {
  if (!dataOpsStore || typeof dataOpsStore.listCustomerIdentityKeys !== 'function') return new Map();
  const result = await dataOpsStore.listCustomerIdentityKeys(uniqueIdentityKeys(keys));
  const owners = new Map();
  if (!result || !result.ok) return owners;
  (result.data || []).forEach((row) => {
    const customerId = text(row.customer_id || row.customerId);
    if (customerId) owners.set(identityKeyId({ type: row.key_type || row.type, value: row.key_value || row.value }), customerId);
  });
  return owners;
}
async function storeIdentityKeys(dataOpsStore, customersWithKeys, source) {
  if (!dataOpsStore || typeof dataOpsStore.upsertCustomerIdentityKeys !== 'function') return { ok: true, skipped: true };
  const seen = new Set();
  const entries = [];
  customersWithKeys.forEach(({ customer, keys }) => {
    const customerId = text(customer && customer.id);
    uniqueIdentityKeys(keys).forEach((key) => {
      const id = `${key.type}:${key.value}:${customerId}`;
      if (!customerId || seen.has(id)) return;
      seen.add(id);
      entries.push({ key_type: key.type, key_value: key.value, customer_id: customerId, source });
    });
  });
  return entries.length ? dataOpsStore.upsertCustomerIdentityKeys(entries, { source }) : { ok: true, data: [] };
}
async function resolveAndUpsertCustomers(dataOpsStore, enrichedResults, job) {
  if (!dataOpsStore || typeof dataOpsStore.upsertCustomers !== 'function') throw new Error('DataOps customer upsert is niet beschikbaar.');
  const existingCustomers = typeof dataOpsStore.listCustomers === 'function' ? await dataOpsStore.listCustomers({ suppressStaleReadCacheLog: true }) : [];
  const index = buildExistingIndex(existingCustomers || []);
  const allKeys = enrichedResults.flatMap((item) => collectCustomerIdentityKeys(item.customer));
  const owners = await loadIdentityOwners(dataOpsStore, allKeys);
  owners.forEach((customerId, key) => {
    if (!index.byKey.has(key)) index.byKey.set(key, customerId);
  });
  let outputById = new Map();
  let customersWithKeys = [];
  const stats = { inserted: 0, updated: 0, duplicates: 0 };
  enrichedResults.forEach((item) => {
    const keys = collectCustomerIdentityKeys(item.customer);
    const matchId = findMatchId(keys, index.byKey);
    const resolved = matchId ? mergeCustomer(index.byId.get(matchId) || { id: matchId }, { ...item.customer, id: matchId }) : item.customer;
    const customer = outputById.has(resolved.id) ? mergeCustomer(outputById.get(resolved.id), resolved) : resolved;
    outputById.set(customer.id, customer);
    customersWithKeys.push({ customer, keys });
    index.byId.set(customer.id, customer);
    keys.forEach((key) => index.byKey.set(identityKeyId(key), customer.id));
    if (matchId) {
      stats.updated += 1;
      stats.duplicates += 1;
      item.duplicate = true;
    } else {
      stats.inserted += 1;
    }
    item.customerId = customer.id;
  });
  if (!outputById.size) return { ok: true, ...stats };
  const claim = await storeIdentityKeys(dataOpsStore, customersWithKeys, 'premium-database-mass-research');
  if (!claim || claim.ok === false) throw new Error(claim && claim.error ? claim.error.message || claim.error : 'Mass research duplicate-poort claimen mislukt.');
  const claimedOwners = await loadIdentityOwners(dataOpsStore, allKeys);
  if (claimedOwners.size) {
    outputById = new Map();
    customersWithKeys = [];
    enrichedResults.forEach((item) => {
      const keys = collectCustomerIdentityKeys(item.customer);
      const currentId = text(item.customerId || (item.customer && item.customer.id));
      const currentCustomer = item.customerId ? { ...item.customer, id: currentId } : item.customer;
      const claimedId = findMatchId(keys, claimedOwners);
      const finalId = claimedId || currentId;
      const resolved = finalId && finalId !== currentId ? mergeCustomer(index.byId.get(finalId) || { id: finalId }, { ...currentCustomer, id: finalId }) : currentCustomer;
      const customer = outputById.has(resolved.id) ? mergeCustomer(outputById.get(resolved.id), resolved) : resolved;
      outputById.set(customer.id, customer);
      customersWithKeys.push({ customer, keys });
      if (claimedId && claimedId !== currentId && !item.duplicate) {
        stats.inserted = Math.max(0, stats.inserted - 1);
        stats.updated += 1;
        stats.duplicates += 1;
        item.duplicate = true;
      }
      item.customerId = customer.id;
    });
  }
  const saved = await dataOpsStore.upsertCustomers(Array.from(outputById.values()), { source: 'premium-database-mass-research' });
  if (!saved || !saved.ok) throw new Error(saved && saved.error ? saved.error.message || saved.error : 'Mass research klanten opslaan mislukt.');
  const storedKeys = await storeIdentityKeys(dataOpsStore, customersWithKeys, 'premium-database-mass-research');
  if (!storedKeys || storedKeys.ok === false) throw new Error(storedKeys && storedKeys.error ? storedKeys.error.message || storedKeys.error : 'Mass research duplicate-sleutels opslaan mislukt.');
  return { ok: true, ...stats };
}
function createPremiumDatabaseMassResearchCoordinator(deps = {}) {
  const {
    dataOpsStore,
    env = process.env,
    fetchImpl = global.fetch,
    discoverBusinessEmailFromWebsiteImpl = discoverBusinessEmailFromWebsite,
    fetchDeepSearchBusinessRowsImpl = fetchDeepSearchBusinessRows,
    fetchGooglePlacesBusinessesImpl = fetchGooglePlacesBusinesses,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;
  async function loadJobs() {
    if (typeof getUiStateValues !== 'function') return [];
    const state = await getUiStateValues(MASS_RESEARCH_SCOPE);
    try {
      const parsed = JSON.parse((state && state.values && state.values[MASS_RESEARCH_JOBS_KEY]) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeJob).filter((job) => job.id) : [];
    } catch (_error) {
      return [];
    }
  }
  async function saveJobs(jobs) {
    if (typeof setUiStateValues !== 'function') return null;
    const compact = (Array.isArray(jobs) ? jobs : []).map(normalizeJob).filter((job) => job.id).slice(-20);
    return setUiStateValues(MASS_RESEARCH_SCOPE, { [MASS_RESEARCH_JOBS_KEY]: JSON.stringify(compact) }, { source: 'premium-database-mass-research' });
  }
  async function updateJob(job) {
    const jobs = await loadJobs();
    const index = jobs.findIndex((item) => item.id === job.id);
    if (index === -1) jobs.push(job);
    else jobs[index] = job;
    await saveJobs(jobs);
    return job;
  }
  async function findJob(jobId) {
    return (await loadJobs()).find((job) => job.id === text(jobId)) || null;
  }
  async function createJob(input = {}) {
    const queries = normalizeQueryList(input);
    if (!queries.length) {
      const error = new Error('Geef minimaal één zoeklocatie of zoekterm op.');
      error.statusCode = 400;
      throw error;
    }
    const createdAt = now();
    const job = normalizeJob({
      id: `mass_research_${Date.now()}_${stableHash(queries.join('|'), 8)}`,
      status: 'queued',
      desiredCount: int(input.desiredCount || input.count, LIMITS.desired),
      options: {
        discoveryConcurrency: int(input.discoveryConcurrency, LIMITS.discovery),
        enrichmentConcurrency: int(input.enrichmentConcurrency, LIMITS.enrichment),
        domainConcurrency: int(input.domainConcurrency, LIMITS.domain),
        websiteTimeoutMs: int(input.websiteTimeoutMs, LIMITS.timeout),
        openAiFallback: input.openAiFallback === true,
      },
      queries: queries.map((query) => ({ query, status: 'queued', found: 0, error: '', updatedAt: createdAt })),
      tasks: [],
      stats: emptyStats(),
      createdAt,
      updatedAt: createdAt,
    });
    await updateJob(job);
    return summarizeJob(job);
  }
  async function discoverCandidates(job, maxRunMs, startedAtMs) {
    if (job.tasks.length >= job.desiredCount || Date.now() - startedAtMs > maxRunMs * 0.4) return;
    const pending = job.queries.filter((item) => item.status === 'queued').slice(0, int(job.options.discoveryConcurrency, LIMITS.discovery));
    if (!pending.length) return;
    pending.forEach((item) => {
      item.status = 'running';
      item.updatedAt = now();
    });
    const seen = new Set(job.tasks.map((task) => task.id));
    const pages = await mapWithConcurrency(pending, pending.length, async (item) => {
      try {
        const places = await fetchGooglePlacesBusinessesImpl({ query: item.query, count: Math.min(100, Math.max(1, job.desiredCount - job.tasks.length)) }, { env, fetchImpl });
        Object.assign(item, { status: 'done', found: places.length, updatedAt: now() });
        return { item, places };
      } catch (error) {
        Object.assign(item, { status: 'error', error: trim(error && error.message, 300), updatedAt: now() });
        job.stats.failed += 1;
        return { item, places: [] };
      }
    });
    pages.forEach(({ item, places }) => places.forEach((place) => {
      if (job.tasks.length >= job.desiredCount) return;
      const candidate = buildCandidate(place, item.query, job.id);
      if (!candidate.company || seen.has(candidate.taskId)) return;
      seen.add(candidate.taskId);
      job.tasks.push({ id: candidate.taskId, status: 'queued', candidate, attempts: 0, error: '', createdAt: now(), updatedAt: now() });
      job.stats.candidatesFound += 1;
    }));
  }
  async function enrichTask(task, job, domainLimiter) {
    const candidate = task.candidate || {};
    const domain = normalizeWebsiteDomain(candidate.websiteDomain || candidate.websiteUrl);
    let email = '';
    let openAiFallbackUsed = false;
    if (candidate.websiteUrl) {
      email = await domainLimiter(domain, async () => {
        const options = { fetchImpl, timeoutMs: job.options.websiteTimeoutMs || LIMITS.timeout[2] };
        return (await discoverBusinessEmailFromWebsiteImpl(candidate.websiteUrl, options)) || discoverBusinessEmailFromWebsiteImpl(candidate.websiteUrl, options);
      });
    }
    if (job.options.openAiFallback === true && (!domain || !normalizeEmail(email))) {
      openAiFallbackUsed = true;
      try {
        const fallback = await fetchDeepSearchBusinessRowsImpl({ target: `${candidate.company} ${candidate.address}`.trim(), count: 1, exclude: [] }, { env, fetchImpl });
        const business = fallback && Array.isArray(fallback.businesses) ? fallback.businesses[0] : null;
        if (business) {
          email = normalizeEmail(business.email) || email;
          if (!candidate.websiteUrl && business.website) {
            candidate.websiteUrl = normalizeWebsiteUrl(business.website);
            candidate.websiteDomain = normalizeWebsiteDomain(candidate.websiteUrl);
          }
        }
      } catch (error) {
        logger.warn('[mass-research][openai-fallback]', error && error.message ? error.message : error);
      }
    }
    const customer = buildCustomer(candidate, { email }, job);
    const emailDomain = normalizeEmail(customer.email).split('@')[1] || '';
    return { task, customer, openAiFallbackUsed, emailFound: Boolean(normalizeEmail(customer.email) && !PERSONAL_EMAIL_DOMAINS.has(emailDomain)) };
  }
  async function processTasks(job, maxRunMs, startedAtMs, input = {}) {
    const queued = job.tasks.filter((task) => task.status === 'queued').slice(0, int(input.maxTasks, LIMITS.tasks));
    if (!queued.length || Date.now() - startedAtMs > maxRunMs * 0.85) return;
    queued.forEach((task) => {
      task.status = 'running';
      task.attempts = Number(task.attempts || 0) + 1;
      task.updatedAt = now();
    });
    const domainLimiter = createDomainLimiter(int(job.options.domainConcurrency, LIMITS.domain));
    const results = await mapWithConcurrency(queued, int(job.options.enrichmentConcurrency, LIMITS.enrichment), async (task) => {
      try {
        return await enrichTask(task, job, domainLimiter);
      } catch (error) {
        Object.assign(task, { status: 'error', error: trim(error && error.message, 300), updatedAt: now() });
        job.stats.failed += 1;
        return null;
      }
    });
    const enriched = results.filter(Boolean);
    const saved = await resolveAndUpsertCustomers(dataOpsStore, enriched, job);
    ['inserted', 'updated', 'duplicates'].forEach((key) => {
      job.stats[key] += saved[key] || 0;
    });
    enriched.forEach((result) => {
      Object.assign(result.task, {
        status: result.duplicate ? 'duplicate' : 'done',
        customerId: result.customerId || (result.customer && result.customer.id),
        emailFound: result.emailFound,
        openAiFallbackUsed: result.openAiFallbackUsed,
        updatedAt: now(),
      });
      job.stats.enriched += 1;
      if (result.emailFound) job.stats.emailsFound += 1;
      if (result.openAiFallbackUsed) job.stats.openAiFallbackCalls += 1;
    });
  }
  function completeJobIfFinished(job) {
    const open = (item) => item.status === 'queued' || item.status === 'running';
    if (job.status === 'cancelled' || job.status === 'error') return;
    if (Number(job.stats.inserted || 0) >= job.desiredCount || (!job.queries.some(open) && !job.tasks.some(open))) {
      job.status = 'done';
      job.finishedAt = now();
    } else {
      job.status = 'running';
    }
  }
  async function runJob(jobId, input = {}) {
    const job = await findJob(jobId);
    if (!job) {
      const error = new Error('Mass research job niet gevonden.');
      error.statusCode = 404;
      throw error;
    }
    if (job.status === 'cancelled' || job.status === 'done') return summarizeJob(job);
    const maxRunMs = int(input.maxRunMs, LIMITS.runMs);
    const startedAtMs = Date.now();
    Object.assign(job, { status: 'running', startedAt: job.startedAt || now(), updatedAt: now() });
    try {
      await discoverCandidates(job, maxRunMs, startedAtMs);
      await processTasks(job, maxRunMs, startedAtMs, input);
      completeJobIfFinished(job);
    } catch (error) {
      Object.assign(job, { status: 'error', error: trim(error && error.message, 500), finishedAt: now() });
    }
    job.updatedAt = now();
    await updateJob(job);
    return summarizeJob(job);
  }
  async function getJob(jobId) {
    const job = await findJob(jobId);
    if (job) return summarizeJob(job);
    const error = new Error('Mass research job niet gevonden.');
    error.statusCode = 404;
    throw error;
  }
  async function cancelJob(jobId) {
    const job = await findJob(jobId);
    if (!job) {
      const error = new Error('Mass research job niet gevonden.');
      error.statusCode = 404;
      throw error;
    }
    Object.assign(job, { status: 'cancelled', cancelledAt: now(), updatedAt: now() });
    job.tasks.forEach((task) => {
      if (task.status === 'queued' || task.status === 'running') Object.assign(task, { status: 'cancelled', updatedAt: now() });
    });
    await updateJob(job);
    return summarizeJob(job);
  }
  const send = (handler, statusCode = 400) => async (req, res) => {
    try {
      return res.status(200).json(await handler(req));
    } catch (error) {
      return res.status(error.statusCode || statusCode).json({ ok: false, error: trim(error && error.message, 500) });
    }
  };
  return {
    cancelJob,
    createJob,
    getJob,
    runJob,
    sendCancelJobResponse: send((req) => cancelJob(req.params && req.params.jobId)),
    sendCreateJobResponse: send((req) => createJob(req.body || {})),
    sendGetJobResponse: send((req) => getJob(req.params && req.params.jobId)),
    sendGetStatusResponse: send(() => getMassResearchPreflightStatus(env)),
    sendRunJobResponse: send((req) => runJob(req.params && req.params.jobId, req.body || {})),
  };
}
module.exports = {
  MASS_RESEARCH_JOBS_KEY,
  MASS_RESEARCH_SCOPE,
  collectCustomerIdentityKeys,
  createDomainLimiter,
  createPremiumDatabaseMassResearchCoordinator,
  getMassResearchPreflightStatus,
  mapWithConcurrency,
  normalizeEmail,
  normalizePhone,
};
