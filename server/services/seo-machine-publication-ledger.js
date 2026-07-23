const { getSeoMachinePublicationPlan } = require('./seo-machine-publication-plan');

const DEFAULT_ORIGIN = 'https://www.softora.nl';
const DEFAULT_HEALTH_PATH = '/api/health/baseline';
const DEFAULT_SITEMAP_PATH = '/sitemap.xml';
const DEFAULT_WINDOWS = Object.freeze([7, 28]);
const DAILY_TARGET = 1;
const WEEKLY_MINIMUM = 5;
const WEEKLY_TARGET_MAXIMUM = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLICATION_KINDS = Object.freeze({
  NEW_URL: 'new_url',
  SUBSTANTIAL_REFRESH: 'substantial_refresh',
  OTHER_GROWTH_ACTION: 'other_growth_action',
});

function normalizeOrigin(value) {
  return String(value || DEFAULT_ORIGIN).trim().replace(/\/+$/g, '');
}

function normalizePublicPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, DEFAULT_ORIGIN);
    return parsed.pathname.replace(/\/+$/g, '') || '/';
  } catch (_) {
    return '';
  }
}

function normalizeCanonical(value, origin = DEFAULT_ORIGIN) {
  try {
    const parsed = new URL(String(value || '').trim(), normalizeOrigin(origin));
    parsed.hash = '';
    parsed.search = '';
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/g, '') || '/'}`;
  } catch (_) {
    return '';
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHtmlAttribute(tagRaw, attributeName) {
  const match = String(tagRaw || '').match(
    new RegExp(`\\b${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return String((match && (match[1] || match[2] || match[3])) || '').trim();
}

function extractCanonicalHref(htmlRaw) {
  const html = String(htmlRaw || '');
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = extractHtmlAttribute(tag, 'rel').toLowerCase().split(/\s+/);
    if (rel.includes('canonical')) return extractHtmlAttribute(tag, 'href');
  }
  return '';
}

function extractRobotsDirectives(htmlRaw) {
  const html = String(htmlRaw || '');
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  return tags.flatMap((tag) => {
    const name = extractHtmlAttribute(tag, 'name').toLowerCase();
    if (name !== 'robots' && name !== 'googlebot') return [];
    return extractHtmlAttribute(tag, 'content').toLowerCase().split(/[\s,]+/).filter(Boolean);
  });
}

function extractDatePublished(htmlRaw) {
  const match = String(htmlRaw || '').match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})(?:[^"]*)"/i);
  return match ? match[1] : '';
}

function extractDateModified(htmlRaw) {
  const match = String(htmlRaw || '').match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})(?:[^"]*)"/i);
  return match ? match[1] : '';
}

function hasVisiblePublishedDate(htmlRaw, publishedAt) {
  const date = escapeRegExp(String(publishedAt || ''));
  if (!date) return false;
  return new RegExp(`>\\s*${date}\\s*<`, 'i').test(String(htmlRaw || ''));
}

function extractSitemapLocations(xmlRaw) {
  const locations = new Set();
  const pattern = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match;
  while ((match = pattern.exec(String(xmlRaw || '')))) {
    locations.add(normalizeCanonical(match[1]));
  }
  return locations;
}

function resolveHealthCommit(payload) {
  const deployment = payload && payload.deployment && typeof payload.deployment === 'object'
    ? payload.deployment
    : {};
  return String(deployment.commitSha || deployment.sha || '').trim();
}

function toUtcDayMs(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return NaN;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function publicationDateMs(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isPublicationInWindow(publishedAt, now, days) {
  const publishedMs = publicationDateMs(publishedAt);
  const todayMs = toUtcDayMs(now);
  const windowDays = Number(days);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(todayMs) || !Number.isInteger(windowDays) || windowDays < 1) {
    return false;
  }
  const cutoffMs = todayMs - (windowDays - 1) * DAY_MS;
  return publishedMs >= cutoffMs && publishedMs <= todayMs;
}

function resolvePublicationKind(item = {}) {
  return Object.values(PUBLICATION_KINDS).includes(item.publicationKind)
    ? item.publicationKind
    : PUBLICATION_KINDS.NEW_URL;
}

function resolvePublicationEventAt(item = {}) {
  return String(item.eventAt || item.publishedAt || '').trim();
}

function buildPublicationCandidates({ publicationPlan, now = new Date(), maximumDays = 28 } = {}) {
  const plan = Array.isArray(publicationPlan)
    ? publicationPlan
    : getSeoMachinePublicationPlan({ now });
  return plan
    .filter((item) => item && item.status === 'live' && isPublicationInWindow(
      resolvePublicationEventAt(item),
      now,
      maximumDays
    ))
    .sort((a, b) => (
      resolvePublicationEventAt(b).localeCompare(resolvePublicationEventAt(a))
      || a.path.localeCompare(b.path)
    ));
}

function buildPublicationAudit({
  item,
  response,
  html,
  sitemapLocations,
  origin = DEFAULT_ORIGIN,
  liveCommitMatches,
} = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  const expectedCanonical = normalizeCanonical(`${normalizedOrigin}${item.path}`, normalizedOrigin);
  const canonical = normalizeCanonical(extractCanonicalHref(html), normalizedOrigin);
  const robotsDirectives = extractRobotsDirectives(html);
  const xRobotsTag = String(response.headers.get('x-robots-tag') || '').toLowerCase();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const publicationKind = resolvePublicationKind(item);
  const eventAt = resolvePublicationEventAt(item);
  const datePublished = extractDatePublished(html);
  const dateModified = extractDateModified(html);
  const eventDate = publicationKind === PUBLICATION_KINDS.SUBSTANTIAL_REFRESH
    ? dateModified
    : datePublished;
  const publishedDateSource = eventDate === eventAt
    ? 'structured-data'
    : (hasVisiblePublishedDate(html, eventAt) ? 'visible' : 'missing');
  const checks = {
    status200: response.status === 200,
    html: contentType.includes('text/html'),
    canonical: canonical === expectedCanonical,
    indexable: !robotsDirectives.includes('noindex') && !xRobotsTag.includes('noindex'),
    sitemap: sitemapLocations.has(expectedCanonical),
    publishedDate: publishedDateSource !== 'missing',
    liveCommit: Boolean(liveCommitMatches),
  };
  return {
    path: item.path,
    title: item.title,
    contentType: item.collection,
    cluster: item.cluster,
    publishedAt: item.publishedAt,
    eventAt,
    publicationKind,
    status: response.status,
    canonical,
    datePublished,
    dateModified,
    publishedDateSource,
    checks,
    qualifies: Object.values(checks).every(Boolean),
  };
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: 'text/html,application/xml,application/json;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
  });
  const text = await response.text();
  return { response, text };
}

function buildWindowSummary(items, now, days) {
  const cohort = items.filter((item) => isPublicationInWindow(
    item.eventAt || item.publishedAt,
    now,
    days
  ));
  const qualifyingItems = cohort.filter((item) => item.qualifies);
  const countKind = (kind) => qualifyingItems.filter((item) => (
    resolvePublicationKind(item) === kind
  )).length;
  const target = Math.round((days / 7) * WEEKLY_MINIMUM);
  return {
    days,
    target,
    targetMaximum: Math.round((days / 7) * WEEKLY_TARGET_MAXIMUM),
    declared: cohort.length,
    qualifying: qualifyingItems.length,
    newUrls: countKind(PUBLICATION_KINDS.NEW_URL),
    substantialRefreshes: countKind(PUBLICATION_KINDS.SUBSTANTIAL_REFRESH),
    otherGrowthActions: countKind(PUBLICATION_KINDS.OTHER_GROWTH_ACTION),
    deficit: Math.max(0, target - qualifyingItems.length),
    items: cohort,
  };
}

async function collectLivePublicationLedger(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Een fetch-implementatie is vereist.');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const origin = normalizeOrigin(options.origin);
  const expectedCommit = String(options.expectedCommit || '').trim();
  const externallyVerifiedCommit = String(options.verifiedLiveCommit || '').trim();
  const windows = Array.isArray(options.windows) && options.windows.length ? options.windows : DEFAULT_WINDOWS;
  const maximumDays = Math.max(...windows);
  const errors = [];

  let healthPayload = null;
  try {
    const health = await fetchText(fetchImpl, `${origin}${DEFAULT_HEALTH_PATH}`);
    if (health.response.status !== 200) errors.push(`Health endpoint gaf HTTP ${health.response.status}.`);
    try {
      healthPayload = JSON.parse(health.text);
    } catch (_) {
      errors.push('Health endpoint gaf geen geldige JSON.');
    }
  } catch (error) {
    errors.push(`Health endpoint onbereikbaar: ${error.message || String(error)}.`);
  }
  const healthCommit = resolveHealthCommit(healthPayload);
  const liveCommit = healthCommit || externallyVerifiedCommit;
  if (!liveCommit) errors.push('Live productiecommit ontbreekt in health payload.');
  if (!expectedCommit) errors.push('Verwachte origin/main commit ontbreekt.');
  if (expectedCommit && liveCommit && expectedCommit !== liveCommit) {
    errors.push(`Live commit ${liveCommit} wijkt af van origin/main ${expectedCommit}.`);
  }
  const liveCommitMatches = Boolean(expectedCommit && liveCommit && expectedCommit === liveCommit);

  let sitemapLocations = new Set();
  try {
    const sitemap = await fetchText(fetchImpl, `${origin}${DEFAULT_SITEMAP_PATH}`);
    if (sitemap.response.status !== 200) errors.push(`Sitemap gaf HTTP ${sitemap.response.status}.`);
    sitemapLocations = extractSitemapLocations(sitemap.text);
    if (!sitemapLocations.size) errors.push('Sitemap bevat geen leesbare URL-locaties.');
  } catch (error) {
    errors.push(`Sitemap onbereikbaar: ${error.message || String(error)}.`);
  }

  const candidates = buildPublicationCandidates({
    publicationPlan: options.publicationPlan,
    now,
    maximumDays,
  });
  const items = await Promise.all(candidates.map(async (item) => {
    try {
      const page = await fetchText(fetchImpl, `${origin}${item.path}`);
      return buildPublicationAudit({
        item,
        response: page.response,
        html: page.text,
        sitemapLocations,
        origin,
        liveCommitMatches,
      });
    } catch (error) {
      return {
        path: item.path,
        title: item.title,
        contentType: item.collection,
        cluster: item.cluster,
        publishedAt: item.publishedAt,
        eventAt: resolvePublicationEventAt(item),
        publicationKind: resolvePublicationKind(item),
        status: 0,
        canonical: '',
        datePublished: '',
        dateModified: '',
        checks: {
          status200: false,
          html: false,
          canonical: false,
          indexable: false,
          sitemap: sitemapLocations.has(normalizeCanonical(`${origin}${item.path}`, origin)),
          publishedDate: false,
          liveCommit: liveCommitMatches,
        },
        qualifies: false,
        error: error.message || String(error),
      };
    }
  }));

  const crawlBlockerChecks = ['status200', 'html', 'canonical', 'indexable', 'sitemap'];
  for (const item of items) {
    const failedBlockers = crawlBlockerChecks.filter((checkName) => !item.checks[checkName]);
    if (failedBlockers.length) {
      errors.push(`${item.path} heeft live publicatieblokkers: ${failedBlockers.join(', ')}.`);
    }
  }

  const windowSummaries = Object.fromEntries(
    windows.map((days) => [String(days), buildWindowSummary(items, now, days)])
  );
  return {
    status: errors.length ? 'p0' : 'ready',
    generatedAt: now.toISOString(),
    origin,
    expectedCommit,
    liveCommit,
    errors,
    windows: windowSummaries,
  };
}

function evaluateCadence({ ledger, backlogResult, weeklyMinimum = WEEKLY_MINIMUM } = {}) {
  const errors = [];
  if (!backlogResult || !backlogResult.ok) {
    errors.push(...((backlogResult && backlogResult.errors) || ['Backlogvalidatie ontbreekt.']));
  }
  if (!ledger || ledger.status !== 'ready') {
    errors.push(...((ledger && ledger.errors) || ['Live publicatieledger ontbreekt.']));
  }
  if (errors.length) {
    return {
      status: 'p0',
      color: 'red',
      exitCode: 1,
      action: 'repair_operations',
      errors,
    };
  }
  const weeklyWindow = ledger.windows && ledger.windows['7'];
  const qualifying = Number((weeklyWindow && weeklyWindow.qualifying) || 0);
  const deficit = Math.max(0, weeklyMinimum - qualifying);
  if (deficit > 0) {
    return {
      status: 'content_required',
      color: 'red',
      exitCode: 2,
      action: 'publish_highest_scoring_ready_candidate',
      qualifying,
      weeklyMinimum,
      deficit,
      nextCandidate: backlogResult.summary.topReady[0] || null,
      errors: [],
    };
  }
  return {
    status: 'on_track',
    color: 'green',
    exitCode: 0,
    action: 'choose_highest_expected_qualified_impact',
    qualifying,
    weeklyMinimum,
    deficit: 0,
    nextCandidate: backlogResult.summary.topReady[0] || null,
    errors: [],
  };
}

module.exports = {
  DAILY_TARGET,
  DEFAULT_ORIGIN,
  DEFAULT_WINDOWS,
  PUBLICATION_KINDS,
  WEEKLY_MINIMUM,
  WEEKLY_TARGET_MAXIMUM,
  buildPublicationAudit,
  buildPublicationCandidates,
  buildWindowSummary,
  collectLivePublicationLedger,
  evaluateCadence,
  extractCanonicalHref,
  extractDatePublished,
  extractDateModified,
  extractRobotsDirectives,
  extractSitemapLocations,
  hasVisiblePublishedDate,
  isPublicationInWindow,
  normalizeCanonical,
  normalizePublicPath,
  resolveHealthCommit,
};
