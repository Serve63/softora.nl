const DEFAULT_ORIGIN = 'https://www.softora.nl';
const DEFAULT_SITE_URL = 'sc-domain:softora.nl';
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PRIORITY_PATHS = Object.freeze([
  '/website-laten-maken',
  '/ai-automatisering',
  '/bedrijfssoftware-op-maat',
  '/crm-systeem-op-maat',
  '/chatbot-laten-maken',
  '/ai-telefonist',
]);

function normalizeOrigin(value) {
  return String(value || DEFAULT_ORIGIN).trim().replace(/\/+$/g, '');
}

function normalizePath(value) {
  try {
    const parsed = new URL(String(value || ''), DEFAULT_ORIGIN);
    return parsed.pathname.replace(/\/+$/g, '') || '/';
  } catch (_) {
    return '';
  }
}

function ageInDays(publishedAt, now = new Date()) {
  const published = new Date(`${String(publishedAt || '')}T00:00:00.000Z`);
  if (!Number.isFinite(published.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - published.getTime()) / DAY_MS));
}

function classifyIndexationState(indexStatus = {}) {
  const verdict = String(indexStatus.verdict || '').toUpperCase();
  const coverage = String(indexStatus.coverageState || '').toLowerCase();
  const robots = String(indexStatus.robotsTxtState || '').toLowerCase();
  const indexing = String(indexStatus.indexingState || '').toLowerCase();
  if (verdict === 'PASS') return 'indexed';
  if (coverage.includes('unknown to google') || coverage.includes('niet bekend bij google')) return 'unknown';
  if (
    (coverage.includes('crawled') || coverage.includes('gecrawld'))
    && (coverage.includes('not indexed') || coverage.includes('niet geïndexeerd') || coverage.includes('niet geindexeerd'))
  ) return 'crawled_not_indexed';
  if (
    (coverage.includes('discovered') || coverage.includes('ontdekt'))
    && (coverage.includes('not indexed') || coverage.includes('niet geïndexeerd') || coverage.includes('niet geindexeerd'))
  ) return 'discovered_not_indexed';
  if (
    coverage.includes('duplicate')
    || coverage.includes('alternate page')
    || coverage.includes('dubbele pagina')
    || coverage.includes('alternatieve pagina')
  ) return 'duplicate';
  if (
    robots.includes('blocked')
    || robots.includes('geblokkeerd')
    || indexing.includes('blocked')
    || indexing.includes('geblokkeerd')
    || coverage.includes('noindex')
  ) return 'blocked';
  return 'not_indexed_other';
}

function normalizeInspectionResult(target, payload, now = new Date()) {
  const result = payload && payload.inspectionResult ? payload.inspectionResult : {};
  const indexStatus = result.indexStatusResult || {};
  const state = classifyIndexationState(indexStatus);
  const ageDays = ageInDays(target.publishedAt, now);
  return {
    ...target,
    inspectedAt: now.toISOString(),
    ageDays,
    state,
    verdict: String(indexStatus.verdict || ''),
    coverageState: String(indexStatus.coverageState || ''),
    pageFetchState: String(indexStatus.pageFetchState || ''),
    robotsTxtState: String(indexStatus.robotsTxtState || ''),
    indexingState: String(indexStatus.indexingState || ''),
    lastCrawlTime: String(indexStatus.lastCrawlTime || ''),
    userCanonical: String(indexStatus.userCanonical || ''),
    googleCanonical: String(indexStatus.googleCanonical || ''),
    referringUrls: Array.isArray(indexStatus.referringUrls) ? indexStatus.referringUrls : [],
    sitemap: Array.isArray(indexStatus.sitemap) ? indexStatus.sitemap : [],
    indexingRequest: state === 'indexed'
      ? { status: 'not_needed', nextAction: 'monitor_performance' }
      : {
          status: 'evidence_required',
          nextAction: 'request_once_in_search_console_if_not_already_requested',
        },
  };
}

function selectInspectionTargets({ publicationPlan = [], priorityPaths = DEFAULT_PRIORITY_PATHS, now = new Date(), days = 56 } = {}) {
  const origin = normalizeOrigin();
  const targets = new Map();
  for (const path of priorityPaths) {
    const normalizedPath = normalizePath(path);
    if (normalizedPath) {
      targets.set(normalizedPath, {
        path: normalizedPath,
        url: `${origin}${normalizedPath}`,
        kind: 'money_page',
        cluster: '',
        publishedAt: '',
      });
    }
  }
  for (const item of Array.isArray(publicationPlan) ? publicationPlan : []) {
    if (!item || item.status !== 'live') continue;
    const ageDays = ageInDays(item.publishedAt, now);
    if (ageDays === null || ageDays > days) continue;
    const path = normalizePath(item.path);
    if (!path) continue;
    targets.set(path, {
      path,
      url: `${origin}${path}`,
      kind: 'content',
      cluster: String(item.cluster || ''),
      publishedAt: String(item.publishedAt || ''),
    });
  }
  return [...targets.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'money_page' ? -1 : 1;
    return String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.path.localeCompare(b.path);
  });
}

function buildCohort(items, minimumAgeDays, maximumAgeDays = Infinity) {
  const cohort = items.filter((item) => (
    item.kind === 'content'
    && Number.isFinite(item.ageDays)
    && item.ageDays >= minimumAgeDays
    && item.ageDays <= maximumAgeDays
    && !item.error
  ));
  const indexed = cohort.filter((item) => item.state === 'indexed').length;
  return {
    inspected: cohort.length,
    indexed,
    rate: cohort.length ? Math.round((indexed / cohort.length) * 1000) / 1000 : null,
    states: cohort.reduce((counts, item) => {
      counts[item.state] = (counts[item.state] || 0) + 1;
      return counts;
    }, {}),
  };
}

function summarizeIndexation(items) {
  const inspected = items.filter((item) => !item.error);
  const indexed = inspected.filter((item) => item.state === 'indexed').length;
  return {
    inspected: inspected.length,
    indexed,
    rate: inspected.length ? Math.round((indexed / inspected.length) * 1000) / 1000 : null,
    requestEvidenceDue: inspected.filter((item) => item.indexingRequest?.status === 'evidence_required').length,
    d14: buildCohort(inspected, 14, 27),
    d28: buildCohort(inspected, 28, 56),
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function collectIndexationReport(options = {}) {
  const client = options.client;
  if (!client || typeof client.inspectUrl !== 'function') {
    throw new Error('Een Search Console URL Inspection-client is vereist.');
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const siteUrl = String(options.siteUrl || DEFAULT_SITE_URL);
  const targets = (options.targets || selectInspectionTargets({
    publicationPlan: options.publicationPlan,
    priorityPaths: options.priorityPaths,
    now,
    days: options.days,
  })).slice(0, Number(options.limit) || 75);
  const items = await mapWithConcurrency(targets, options.concurrency || 5, async (target) => {
    try {
      const payload = await client.inspectUrl(target.url, siteUrl);
      return normalizeInspectionResult(target, payload, now);
    } catch (error) {
      return {
        ...target,
        inspectedAt: now.toISOString(),
        ageDays: ageInDays(target.publishedAt, now),
        state: 'inspection_failed',
        error: error.message || String(error),
      };
    }
  });
  const errors = items.filter((item) => item.error).map((item) => `${item.path}: ${item.error}`);
  return {
    status: errors.length === 0 ? 'ready' : (items.length > errors.length ? 'partial' : 'data_degraded'),
    generatedAt: now.toISOString(),
    siteUrl,
    requestPolicy: 'Request once via Search Console UI after live verification; do not repeat without a material change or a documented follow-up window.',
    summary: summarizeIndexation(items),
    items,
    errors,
  };
}

module.exports = {
  DEFAULT_PRIORITY_PATHS,
  ageInDays,
  buildCohort,
  classifyIndexationState,
  collectIndexationReport,
  mapWithConcurrency,
  normalizeInspectionResult,
  selectInspectionTargets,
  summarizeIndexation,
};
