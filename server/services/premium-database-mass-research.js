const { stableHash } = require('./data-ops-serialization');
const {
  discoverBusinessEmailFromWebsite,
  fetchDeepSearchBusinessRows,
  fetchGooglePlacesBusinesses,
  inferBranchFromGoogleTypes,
  normalizeWebsiteDomain,
  normalizeWebsiteUrl,
} = require('./premium-database-import');

const MASS_RESEARCH_SCOPE = 'premium_database_mass_research';
const MASS_RESEARCH_JOBS_KEY = 'softora_mass_research_jobs_v1';
const DEFAULT_DESIRED_COUNT = 500;
const MAX_DESIRED_COUNT = 5000;
const DEFAULT_DISCOVERY_CONCURRENCY = 6;
const MAX_DISCOVERY_CONCURRENCY = 12;
const DEFAULT_ENRICHMENT_CONCURRENCY = 50;
const MAX_ENRICHMENT_CONCURRENCY = 100;
const DEFAULT_DOMAIN_CONCURRENCY = 2;
const MAX_DOMAIN_CONCURRENCY = 5;
const DEFAULT_WEBSITE_TIMEOUT_MS = 4500;
const DEFAULT_MAX_RUN_MS = 25000;
const MAX_RUN_MS = 120000;
const DEFAULT_MAX_TASKS_PER_RUN = 250;
const MAX_TASKS_PER_RUN = 1000;
const MAX_STORED_JOBS = 20;
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.nl',
  'icloud.com',
  'live.com',
  'live.nl',
  'outlook.com',
  'outlook.nl',
  'yahoo.com',
  'yahoo.nl',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength) {
  const text = normalizeString(value);
  return maxLength > 0 && text.length > maxLength ? text.slice(0, maxLength) : text;
}

function isoNow() {
  return new Date().toISOString();
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeIdentityText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  return normalizeString(value).replace(/\D+/g, '');
}

function normalizeEmail(value) {
  const email = normalizeString(value).toLowerCase();
  if (!email || email === '—' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function normalizeCompanyAddress(company, address) {
  const companyKey = normalizeIdentityText(company);
  const addressKey = normalizeIdentityText(address);
  return companyKey && addressKey && addressKey !== 'onbekend' ? `${companyKey}|${addressKey}` : '';
}

function getPlaceName(place) {
  return normalizeString(
    place &&
      (place.displayName && typeof place.displayName === 'object'
        ? place.displayName.text
        : place.displayName)
  );
}

function getPlacePhone(place) {
  return normalizeString(place && (place.nationalPhoneNumber || place.internationalPhoneNumber));
}

function normalizeQueryList(input = {}) {
  const raw =
    Array.isArray(input.queries) ? input.queries :
      Array.isArray(input.locations) ? input.locations :
        normalizeString(input.query || input.location) ? [input.query || input.location] : [];
  return Array.from(
    new Set(
      raw
        .map((item) => normalizeString(item && (item.query || item.location || item.label || item)))
        .filter(Boolean)
        .map((item) => item.slice(0, 160))
    )
  );
}

function buildTaskId(jobId, place, query) {
  const base = [
    normalizeString(place && place.id),
    getPlaceName(place),
    normalizeString(place && place.formattedAddress),
    normalizeWebsiteDomain(place && place.websiteUri),
    normalizeString(query),
  ].join('|');
  return `${jobId}_task_${stableHash(base, 18)}`;
}

function collectCustomerIdentityKeys(customer = {}) {
  const keys = [];
  const googlePlaceId = normalizeString(customer.googlePlaceId || customer.google_place_id);
  const email = normalizeEmail(customer.email || customer.contactEmail);
  const domain = normalizeWebsiteDomain(customer.website || customer.dom || customer.url || customer.site);
  const phone = normalizePhone(customer.tel || customer.telefoon || customer.phone || customer.contactPhone);
  const companyAddress = normalizeCompanyAddress(customer.bedrijf || customer.company || customer.companyName, customer.stad || customer.address);

  if (googlePlaceId) keys.push({ type: 'google_place_id', value: googlePlaceId });
  if (domain) keys.push({ type: 'domain', value: domain });
  if (email) keys.push({ type: 'email', value: email });
  if (phone.length >= 7) keys.push({ type: 'phone', value: phone });
  if (companyAddress) keys.push({ type: 'company_address', value: companyAddress });
  return keys;
}

function identityKeyId(key) {
  return `${normalizeString(key && key.type)}:${normalizeString(key && key.value)}`;
}

function isPersonalEmail(email) {
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1] || '';
  return PERSONAL_EMAIL_DOMAINS.has(domain);
}

function uniqueIdentityKeys(keys) {
  const seen = new Set();
  const output = [];
  (Array.isArray(keys) ? keys : []).forEach((key) => {
    const type = normalizeString(key && key.type);
    const value = normalizeString(key && key.value);
    const id = `${type}:${value}`;
    if (!type || !value || seen.has(id)) return;
    seen.add(id);
    output.push({ type, value });
  });
  return output;
}

function createDomainLimiter(maxPerDomain) {
  const active = new Map();
  const queues = new Map();
  const limit = Math.max(1, maxPerDomain);

  function release(domain) {
    const key = normalizeString(domain) || '_unknown';
    active.set(key, Math.max(0, Number(active.get(key)) - 1));
    const queue = queues.get(key) || [];
    const next = queue.shift();
    if (next) next();
  }

  return function runLimited(domain, task) {
    const key = normalizeString(domain) || '_unknown';
    return new Promise((resolve, reject) => {
      function start() {
        active.set(key, Number(active.get(key) || 0) + 1);
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => release(key));
      }
      if (Number(active.get(key) || 0) < limit) {
        start();
        return;
      }
      const queue = queues.get(key) || [];
      queue.push(start);
      queues.set(key, queue);
    });
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const sourceItems = Array.isArray(items) ? items : [];
  const output = new Array(sourceItems.length);
  let cursor = 0;
  const workerCount = Math.min(sourceItems.length, Math.max(1, concurrency));
  async function runNext() {
    while (cursor < sourceItems.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(sourceItems[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return output;
}

function createEmptyStats() {
  return {
    candidatesFound: 0,
    enriched: 0,
    emailsFound: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
    openAiFallbackCalls: 0,
  };
}

function normalizeJob(raw) {
  const job = raw && typeof raw === 'object' ? raw : {};
  return {
    id: normalizeString(job.id),
    status: normalizeString(job.status || 'queued') || 'queued',
    desiredCount: parsePositiveInt(job.desiredCount, DEFAULT_DESIRED_COUNT, 1, MAX_DESIRED_COUNT),
    options: job.options && typeof job.options === 'object' ? job.options : {},
    queries: Array.isArray(job.queries) ? job.queries : [],
    tasks: Array.isArray(job.tasks) ? job.tasks : [],
    stats: { ...createEmptyStats(), ...(job.stats && typeof job.stats === 'object' ? job.stats : {}) },
    createdAt: normalizeString(job.createdAt) || isoNow(),
    startedAt: normalizeString(job.startedAt),
    updatedAt: normalizeString(job.updatedAt) || isoNow(),
    finishedAt: normalizeString(job.finishedAt),
    cancelledAt: normalizeString(job.cancelledAt),
    error: normalizeString(job.error),
  };
}

function summarizeJob(job) {
  const normalized = normalizeJob(job);
  const queued = normalized.tasks.filter((task) => task.status === 'queued').length;
  const running = normalized.tasks.filter((task) => task.status === 'running').length;
  const done = normalized.tasks.filter((task) => task.status === 'done' || task.status === 'duplicate').length;
  const failed = normalized.tasks.filter((task) => task.status === 'error').length;
  const queryDone = normalized.queries.filter((item) => item.status === 'done' || item.status === 'error').length;
  const elapsedMs = normalized.startedAt
    ? Math.max(0, Date.now() - Date.parse(normalized.startedAt || normalized.createdAt))
    : 0;
  const perHour = elapsedMs > 0 ? Math.round((Number(normalized.stats.enriched || 0) / elapsedMs) * 3600000) : 0;
  return {
    id: normalized.id,
    ok: true,
    status: normalized.status,
    desiredCount: normalized.desiredCount,
    queryCount: normalized.queries.length,
    queryDone,
    taskCount: normalized.tasks.length,
    queued,
    running,
    done,
    failed,
    stats: normalized.stats,
    perHour,
    createdAt: normalized.createdAt,
    startedAt: normalized.startedAt,
    updatedAt: normalized.updatedAt,
    finishedAt: normalized.finishedAt,
    cancelledAt: normalized.cancelledAt,
    error: normalized.error,
  };
}

function buildCandidateFromPlace(place, query, jobId) {
  const websiteUrl = normalizeWebsiteUrl(place && place.websiteUri);
  const websiteDomain = normalizeWebsiteDomain(websiteUrl);
  return {
    taskId: buildTaskId(jobId, place, query),
    googlePlaceId: normalizeString(place && place.id),
    company: getPlaceName(place),
    address: normalizeString(place && place.formattedAddress),
    phone: getPlacePhone(place),
    websiteUrl,
    websiteDomain,
    types: Array.isArray(place && place.types) ? place.types : [],
    query: normalizeString(query),
  };
}

function buildCustomerFromCandidate(candidate, enrichment, job) {
  const email = normalizeEmail(enrichment && enrichment.email);
  const websiteDomain = normalizeWebsiteDomain(candidate.websiteDomain || candidate.websiteUrl);
  const today = isoNow().slice(0, 10);
  const sourceKey = stableHash([
    candidate.googlePlaceId,
    websiteDomain,
    candidate.company,
    candidate.address,
  ].join('|'), 20);
  return {
    id: `mass_research_${sourceKey}`,
    bedrijf: truncateText(candidate.company, 240),
    naam: truncateText(candidate.company, 240),
    tel: candidate.phone || '—',
    email: email || '—',
    stad: candidate.address || 'Onbekend',
    website: websiteDomain || candidate.websiteUrl || '',
    dom: websiteDomain || '',
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
    const text = normalizeString(value);
    if (!text || text === '—') return;
    if (!normalizeString(merged[key]) || normalizeString(merged[key]) === '—') merged[key] = value;
  });
  merged.id = normalizeString(existing.id || incoming.id);
  merged.status = normalizeString(existing.status || existing.databaseStatus) || incoming.status || 'benaderbaar';
  merged.databaseStatus = normalizeString(existing.databaseStatus || existing.status) || incoming.databaseStatus || 'benaderbaar';
  merged.updatedAt = incoming.updatedAt || isoNow().slice(0, 10);
  merged.massResearchJobId = incoming.massResearchJobId;
  if (incoming.googlePlaceId && !merged.googlePlaceId) merged.googlePlaceId = incoming.googlePlaceId;
  return merged;
}

function buildExistingCustomerIndex(customers) {
  const byId = new Map();
  const byKey = new Map();
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const id = normalizeString(customer && customer.id);
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

async function loadIdentityKeyOwners(dataOpsStore, keys) {
  if (!dataOpsStore || typeof dataOpsStore.listCustomerIdentityKeys !== 'function') return new Map();
  const result = await dataOpsStore.listCustomerIdentityKeys(uniqueIdentityKeys(keys));
  if (!result || !result.ok) return new Map();
  const output = new Map();
  (result.data || []).forEach((row) => {
    const key = { type: row.key_type || row.type, value: row.key_value || row.value };
    const customerId = normalizeString(row.customer_id || row.customerId);
    if (customerId) output.set(identityKeyId(key), customerId);
  });
  return output;
}

async function storeIdentityKeys(dataOpsStore, customersWithKeys, source) {
  if (!dataOpsStore || typeof dataOpsStore.upsertCustomerIdentityKeys !== 'function') {
    return { ok: true, skipped: true };
  }
  const entries = [];
  customersWithKeys.forEach(({ customer, keys }) => {
    const customerId = normalizeString(customer && customer.id);
    uniqueIdentityKeys(keys).forEach((key) => {
      entries.push({
        key_type: key.type,
        key_value: key.value,
        customer_id: customerId,
        source,
      });
    });
  });
  if (!entries.length) return { ok: true, data: [] };
  return dataOpsStore.upsertCustomerIdentityKeys(entries, { source });
}

async function resolveAndUpsertCustomers(dataOpsStore, enrichedResults, job) {
  if (!dataOpsStore || typeof dataOpsStore.upsertCustomers !== 'function') {
    throw new Error('DataOps customer upsert is niet beschikbaar.');
  }
  const existingCustomers = typeof dataOpsStore.listCustomers === 'function'
    ? await dataOpsStore.listCustomers({ suppressStaleReadCacheLog: true })
    : [];
  const index = buildExistingCustomerIndex(existingCustomers || []);
  const allKeys = enrichedResults.flatMap((item) => collectCustomerIdentityKeys(item.customer));
  const registryOwners = await loadIdentityKeyOwners(dataOpsStore, allKeys);
  registryOwners.forEach((customerId, key) => {
    if (!index.byKey.has(key)) index.byKey.set(key, customerId);
  });

  let outputById = new Map();
  let customersWithKeys = [];
  const stats = { inserted: 0, updated: 0, duplicates: 0 };
  enrichedResults.forEach((item) => {
    const keys = collectCustomerIdentityKeys(item.customer);
    const matchId = findMatchId(keys, index.byKey);
    const existing = matchId ? index.byId.get(matchId) : null;
    const resolvedCustomer = matchId
      ? mergeCustomer(existing || { id: matchId }, { ...item.customer, id: matchId })
      : item.customer;
    const customer = outputById.has(resolvedCustomer.id)
      ? mergeCustomer(outputById.get(resolvedCustomer.id), resolvedCustomer)
      : resolvedCustomer;
    outputById.set(customer.id, customer);
    customersWithKeys.push({ customer, keys });
    index.byId.set(customer.id, customer);
    keys.forEach((key) => index.byKey.set(identityKeyId(key), customer.id));
    if (matchId) {
      stats.updated += 1;
      stats.duplicates += 1;
      item.duplicate = true;
      item.customerId = matchId;
    } else {
      stats.inserted += 1;
      item.customerId = customer.id;
    }
  });

  let output = Array.from(outputById.values());
  if (!output.length) return { ok: true, ...stats };
  const claim = await storeIdentityKeys(dataOpsStore, customersWithKeys, 'premium-database-mass-research');
  if (!claim || claim.ok === false) {
    throw new Error(claim && claim.error ? claim.error.message || claim.error : 'Mass research duplicate-poort claimen mislukt.');
  }
  const claimedOwners = await loadIdentityKeyOwners(dataOpsStore, allKeys);
  if (claimedOwners.size) {
    const claimedOutputById = new Map();
    const claimedCustomersWithKeys = [];
    enrichedResults.forEach((item) => {
      const keys = collectCustomerIdentityKeys(item.customer);
      const currentId = normalizeString(item.customerId || (item.customer && item.customer.id));
      const currentCustomer = outputById.get(currentId) || item.customer;
      const claimedId = findMatchId(keys, claimedOwners);
      const finalId = claimedId || currentId;
      const resolvedCustomer = finalId && finalId !== currentId
        ? mergeCustomer(index.byId.get(finalId) || { id: finalId }, { ...currentCustomer, id: finalId })
        : currentCustomer;
      const customer = claimedOutputById.has(resolvedCustomer.id)
        ? mergeCustomer(claimedOutputById.get(resolvedCustomer.id), resolvedCustomer)
        : resolvedCustomer;
      claimedOutputById.set(customer.id, customer);
      claimedCustomersWithKeys.push({ customer, keys });
      if (claimedId && claimedId !== currentId) {
        if (!item.duplicate) {
          stats.inserted = Math.max(0, stats.inserted - 1);
          stats.updated += 1;
          stats.duplicates += 1;
        }
        item.duplicate = true;
      }
      item.customerId = customer.id;
    });
    outputById = claimedOutputById;
    customersWithKeys = claimedCustomersWithKeys;
    output = Array.from(outputById.values());
  }
  const saved = await dataOpsStore.upsertCustomers(output, { source: 'premium-database-mass-research' });
  if (!saved || !saved.ok) {
    throw new Error(saved && saved.error ? saved.error.message || saved.error : 'Mass research klanten opslaan mislukt.');
  }
  const storedKeys = await storeIdentityKeys(dataOpsStore, customersWithKeys, 'premium-database-mass-research');
  if (!storedKeys || storedKeys.ok === false) {
    throw new Error(storedKeys && storedKeys.error ? storedKeys.error.message || storedKeys.error : 'Mass research duplicate-sleutels opslaan mislukt.');
  }
  return { ok: true, ...stats };
}

function shouldUseOpenAiFallback(candidate, enrichment, options) {
  return Boolean(
    options &&
      options.openAiFallback === true &&
      (!normalizeWebsiteDomain(candidate.websiteDomain || candidate.websiteUrl) || !normalizeEmail(enrichment && enrichment.email))
  );
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
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    try {
      const parsed = JSON.parse(values[MASS_RESEARCH_JOBS_KEY] || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeJob).filter((job) => job.id) : [];
    } catch (_error) {
      return [];
    }
  }

  async function saveJobs(jobs) {
    if (typeof setUiStateValues !== 'function') return null;
    const normalized = (Array.isArray(jobs) ? jobs : []).map(normalizeJob).filter((job) => job.id);
    const compact = normalized.slice(-MAX_STORED_JOBS);
    return setUiStateValues(
      MASS_RESEARCH_SCOPE,
      { [MASS_RESEARCH_JOBS_KEY]: JSON.stringify(compact) },
      { source: 'premium-database-mass-research' }
    );
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
    const jobs = await loadJobs();
    return jobs.find((job) => job.id === normalizeString(jobId)) || null;
  }

  async function createJob(input = {}) {
    const queries = normalizeQueryList(input);
    if (!queries.length) {
      const error = new Error('Geef minimaal één zoeklocatie of zoekterm op.');
      error.statusCode = 400;
      throw error;
    }
    const now = isoNow();
    const desiredCount = parsePositiveInt(input.desiredCount || input.count, DEFAULT_DESIRED_COUNT, 1, MAX_DESIRED_COUNT);
    const job = normalizeJob({
      id: `mass_research_${Date.now()}_${stableHash(queries.join('|'), 8)}`,
      status: 'queued',
      desiredCount,
      options: {
        discoveryConcurrency: parsePositiveInt(input.discoveryConcurrency, DEFAULT_DISCOVERY_CONCURRENCY, 1, MAX_DISCOVERY_CONCURRENCY),
        enrichmentConcurrency: parsePositiveInt(input.enrichmentConcurrency, DEFAULT_ENRICHMENT_CONCURRENCY, 1, MAX_ENRICHMENT_CONCURRENCY),
        domainConcurrency: parsePositiveInt(input.domainConcurrency, DEFAULT_DOMAIN_CONCURRENCY, 1, MAX_DOMAIN_CONCURRENCY),
        websiteTimeoutMs: parsePositiveInt(input.websiteTimeoutMs, DEFAULT_WEBSITE_TIMEOUT_MS, 1000, 12000),
        openAiFallback: input.openAiFallback === true,
      },
      queries: queries.map((query) => ({ query, status: 'queued', found: 0, error: '', updatedAt: now })),
      tasks: [],
      stats: createEmptyStats(),
      createdAt: now,
      updatedAt: now,
    });
    await updateJob(job);
    return summarizeJob(job);
  }

  async function discoverCandidates(job, maxRunMs, startedAtMs) {
    const remaining = Math.max(0, job.desiredCount - job.tasks.length);
    if (remaining <= 0 || Date.now() - startedAtMs > maxRunMs * 0.4) return;
    const pending = job.queries
      .filter((item) => item.status === 'queued')
      .slice(0, parsePositiveInt(job.options.discoveryConcurrency, DEFAULT_DISCOVERY_CONCURRENCY, 1, MAX_DISCOVERY_CONCURRENCY));
    if (!pending.length) return;
    pending.forEach((item) => {
      item.status = 'running';
      item.updatedAt = isoNow();
    });
    const seenTaskIds = new Set(job.tasks.map((task) => task.id));
    const pages = await mapWithConcurrency(pending, pending.length, async (item) => {
      try {
        const places = await fetchGooglePlacesBusinessesImpl(
          { query: item.query, count: Math.min(100, Math.max(1, job.desiredCount - job.tasks.length)) },
          { env, fetchImpl }
        );
        item.status = 'done';
        item.found = places.length;
        item.updatedAt = isoNow();
        return { item, places };
      } catch (error) {
        item.status = 'error';
        item.error = truncateText(error && error.message, 300);
        item.updatedAt = isoNow();
        job.stats.failed += 1;
        return { item, places: [] };
      }
    });
    pages.forEach(({ item, places }) => {
      places.forEach((place) => {
        if (job.tasks.length >= job.desiredCount) return;
        const candidate = buildCandidateFromPlace(place, item.query, job.id);
        if (!candidate.company || seenTaskIds.has(candidate.taskId)) return;
        seenTaskIds.add(candidate.taskId);
        job.tasks.push({
          id: candidate.taskId,
          status: 'queued',
          candidate,
          attempts: 0,
          error: '',
          createdAt: isoNow(),
          updatedAt: isoNow(),
        });
        job.stats.candidatesFound += 1;
      });
    });
  }

  async function enrichTask(task, job, domainLimiter) {
    const candidate = task.candidate || {};
    const domain = normalizeWebsiteDomain(candidate.websiteDomain || candidate.websiteUrl);
    let email = '';
    let openAiFallbackUsed = false;
    if (candidate.websiteUrl) {
      email = await domainLimiter(domain, async () => {
        let found = await discoverBusinessEmailFromWebsiteImpl(candidate.websiteUrl, {
          fetchImpl,
          timeoutMs: job.options.websiteTimeoutMs || DEFAULT_WEBSITE_TIMEOUT_MS,
        });
        if (!found) {
          found = await discoverBusinessEmailFromWebsiteImpl(candidate.websiteUrl, {
            fetchImpl,
            timeoutMs: job.options.websiteTimeoutMs || DEFAULT_WEBSITE_TIMEOUT_MS,
          });
        }
        return found;
      });
    }
    const enrichment = { email };
    if (shouldUseOpenAiFallback(candidate, enrichment, job.options)) {
      openAiFallbackUsed = true;
      try {
        const fallback = await fetchDeepSearchBusinessRowsImpl(
          {
            target: `${candidate.company} ${candidate.address}`.trim(),
            count: 1,
            exclude: [],
          },
          { env, fetchImpl }
        );
        const business = fallback && Array.isArray(fallback.businesses) ? fallback.businesses[0] : null;
        if (business) {
          enrichment.email = normalizeEmail(business.email) || enrichment.email;
          if (!candidate.websiteUrl && business.website) {
            candidate.websiteUrl = normalizeWebsiteUrl(business.website);
            candidate.websiteDomain = normalizeWebsiteDomain(candidate.websiteUrl);
          }
        }
      } catch (error) {
        logger.warn('[mass-research][openai-fallback]', error && error.message ? error.message : error);
      }
    }
    const customer = buildCustomerFromCandidate(candidate, enrichment, job);
    return {
      task,
      customer,
      openAiFallbackUsed,
      emailFound: Boolean(normalizeEmail(customer.email) && !isPersonalEmail(customer.email)),
    };
  }

  async function processTasks(job, maxRunMs, startedAtMs, input = {}) {
    const maxTasks = parsePositiveInt(input.maxTasks, DEFAULT_MAX_TASKS_PER_RUN, 1, MAX_TASKS_PER_RUN);
    const queued = job.tasks.filter((task) => task.status === 'queued').slice(0, maxTasks);
    if (!queued.length || Date.now() - startedAtMs > maxRunMs * 0.85) return;
    queued.forEach((task) => {
      task.status = 'running';
      task.attempts = Number(task.attempts || 0) + 1;
      task.updatedAt = isoNow();
    });
    const domainLimiter = createDomainLimiter(
      parsePositiveInt(job.options.domainConcurrency, DEFAULT_DOMAIN_CONCURRENCY, 1, MAX_DOMAIN_CONCURRENCY)
    );
    const results = await mapWithConcurrency(
      queued,
      parsePositiveInt(job.options.enrichmentConcurrency, DEFAULT_ENRICHMENT_CONCURRENCY, 1, MAX_ENRICHMENT_CONCURRENCY),
      async (task) => {
        try {
          return await enrichTask(task, job, domainLimiter);
        } catch (error) {
          task.status = 'error';
          task.error = truncateText(error && error.message, 300);
          task.updatedAt = isoNow();
          job.stats.failed += 1;
          return null;
        }
      }
    );
    const enriched = results.filter(Boolean);
    const saved = await resolveAndUpsertCustomers(dataOpsStore, enriched, job);
    job.stats.inserted += saved.inserted || 0;
    job.stats.updated += saved.updated || 0;
    job.stats.duplicates += saved.duplicates || 0;
    enriched.forEach((result) => {
      result.task.status = result.duplicate ? 'duplicate' : 'done';
      result.task.customerId = result.customerId || (result.customer && result.customer.id);
      result.task.emailFound = result.emailFound;
      result.task.openAiFallbackUsed = result.openAiFallbackUsed;
      result.task.updatedAt = isoNow();
      job.stats.enriched += 1;
      if (result.emailFound) job.stats.emailsFound += 1;
      if (result.openAiFallbackUsed) job.stats.openAiFallbackCalls += 1;
    });
  }

  function completeJobIfFinished(job) {
    const hasOpenQueries = job.queries.some((item) => item.status === 'queued' || item.status === 'running');
    const hasOpenTasks = job.tasks.some((task) => task.status === 'queued' || task.status === 'running');
    const reachedDesired = Number(job.stats.inserted || 0) >= job.desiredCount;
    if (job.status === 'cancelled' || job.status === 'error') return;
    if (reachedDesired || (!hasOpenQueries && !hasOpenTasks)) {
      job.status = 'done';
      job.finishedAt = isoNow();
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
    const maxRunMs = parsePositiveInt(input.maxRunMs, DEFAULT_MAX_RUN_MS, 1000, MAX_RUN_MS);
    const startedAtMs = Date.now();
    job.status = 'running';
    job.startedAt = job.startedAt || isoNow();
    job.updatedAt = isoNow();
    try {
      await discoverCandidates(job, maxRunMs, startedAtMs);
      await processTasks(job, maxRunMs, startedAtMs, input);
      completeJobIfFinished(job);
    } catch (error) {
      job.status = 'error';
      job.error = truncateText(error && error.message, 500);
      job.finishedAt = isoNow();
    }
    job.updatedAt = isoNow();
    await updateJob(job);
    return summarizeJob(job);
  }

  async function getJob(jobId) {
    const job = await findJob(jobId);
    if (!job) {
      const error = new Error('Mass research job niet gevonden.');
      error.statusCode = 404;
      throw error;
    }
    return summarizeJob(job);
  }

  async function cancelJob(jobId) {
    const job = await findJob(jobId);
    if (!job) {
      const error = new Error('Mass research job niet gevonden.');
      error.statusCode = 404;
      throw error;
    }
    job.status = 'cancelled';
    job.cancelledAt = isoNow();
    job.updatedAt = isoNow();
    job.tasks.forEach((task) => {
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'cancelled';
        task.updatedAt = isoNow();
      }
    });
    await updateJob(job);
    return summarizeJob(job);
  }

  async function sendCreateJobResponse(req, res) {
    try {
      return res.status(200).json(await createJob(req.body || {}));
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: truncateText(error && error.message, 500),
      });
    }
  }

  async function sendRunJobResponse(req, res) {
    try {
      return res.status(200).json(await runJob(req.params && req.params.jobId, req.body || {}));
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: truncateText(error && error.message, 500),
      });
    }
  }

  async function sendGetJobResponse(req, res) {
    try {
      return res.status(200).json(await getJob(req.params && req.params.jobId));
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: truncateText(error && error.message, 500),
      });
    }
  }

  async function sendCancelJobResponse(req, res) {
    try {
      return res.status(200).json(await cancelJob(req.params && req.params.jobId));
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: truncateText(error && error.message, 500),
      });
    }
  }

  return {
    cancelJob,
    createJob,
    getJob,
    runJob,
    sendCancelJobResponse,
    sendCreateJobResponse,
    sendGetJobResponse,
    sendRunJobResponse,
  };
}

module.exports = {
  MASS_RESEARCH_JOBS_KEY,
  MASS_RESEARCH_SCOPE,
  collectCustomerIdentityKeys,
  createPremiumDatabaseMassResearchCoordinator,
  createDomainLimiter,
  mapWithConcurrency,
  normalizeEmail,
  normalizePhone,
};
