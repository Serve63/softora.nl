const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEARCH_CONSOLE_API_BASE = 'https://www.googleapis.com/webmasters/v3';
const SEARCH_CONSOLE_INSPECTION_API_BASE = 'https://searchconsole.googleapis.com/v1';
const SEARCH_CONSOLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_SITE_URL = 'sc-domain:softora.nl';
const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const SEO_STRETCH_TARGET_CLICKS = 100000;
const SEO_STRETCH_DEADLINE = '2026-12-31';
const AVERAGE_MONTH_DAYS = 365.2425 / 12;
const {
  classifySeoQuery,
  getBusinessFit,
  isNonBrandedQuery,
  rankSeoOpportunities,
} = require('./seo-opportunity-scoring');
const {
  SEO_AUTOMATION_EXCLUDED_PATHS,
  isSeoAutomationExcludedPath,
} = require('../../server/services/seo-machine-route-policy');

function normalizeString(value) {
  return String(value || '').trim();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundNumber(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value) * factor) / factor;
}

function startOfUtcDay(date) {
  const source = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = startOfUtcDay(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function parseYyyyMmDd(value) {
  const raw = normalizeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function formatYyyyMmDd(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function buildGrowthHorizon(options = {}) {
  const targetClicks = Math.max(1, Math.round(toFiniteNumber(
    options.targetClicks,
    SEO_STRETCH_TARGET_CLICKS
  )));
  const currentClicks = Math.max(0, toFiniteNumber(options.currentClicks));
  const deadline = normalizeString(options.deadline || SEO_STRETCH_DEADLINE);
  const deadlineDate = parseYyyyMmDd(deadline);
  if (!deadlineDate) throw new Error(`Ongeldige SEO-stretchdeadline: ${deadline}`);

  const referenceInput = parseYyyyMmDd(options.referenceDate)
    || new Date(options.referenceDate || Date.now());
  const referenceDate = startOfUtcDay(referenceInput);
  const remainingDaysRaw = Math.ceil((deadlineDate.getTime() - referenceDate.getTime()) / 86400000);
  const deadlineElapsed = remainingDaysRaw < 0;
  const remainingDays = deadlineElapsed ? 0 : remainingDaysRaw;
  const remainingCompoundMonths = deadlineElapsed
    ? null
    : roundNumber(remainingDays / AVERAGE_MONTH_DAYS, 2);
  const gap = Math.max(0, targetClicks - currentClicks);
  const factorToTarget = currentClicks > 0
    ? roundNumber(targetClicks / currentClicks, 4)
    : null;
  const canCalculatePace = gap > 0
    && currentClicks > 0
    && remainingCompoundMonths > 0;
  const requiredMonthlyMultiplier = canCalculatePace
    ? roundNumber((targetClicks / currentClicks) ** (1 / remainingCompoundMonths), 4)
    : null;

  let phase = 'stretch_countdown';
  if (currentClicks >= targetClicks) phase = 'target_reached_defend_and_compound';
  else if (deadlineElapsed) phase = 'evergreen_compounding_after_deadline';

  return {
    phase,
    targetClicks,
    deadline,
    referenceDate: formatYyyyMmDd(referenceDate),
    currentClicks: roundNumber(currentClicks, 2),
    gap: roundNumber(gap, 2),
    factorToTarget,
    remainingDays: deadlineElapsed ? null : remainingDays,
    remainingCompoundMonths,
    requiredMonthlyMultiplier,
    requiredMonthlyGrowthRate: requiredMonthlyMultiplier === null
      ? null
      : roundNumber(requiredMonthlyMultiplier - 1, 4),
    deadlineStatus: deadlineElapsed
      ? 'elapsed_requires_archived_deadline_snapshot'
      : 'pending',
    continuationRule: 'keep_running_until_explicitly_paused',
  };
}

function resolveDateWindows(options = {}) {
  const days = Math.max(7, Math.min(90, Math.round(toFiniteNumber(options.days, 28))));
  const now = options.now instanceof Date ? options.now : new Date();
  const endDate = parseYyyyMmDd(options.endDate) || addUtcDays(now, -1);
  const currentStart = addUtcDays(endDate, -(days - 1));
  const previousEnd = addUtcDays(currentStart, -1);
  const previousStart = addUtcDays(previousEnd, -(days - 1));

  return {
    days,
    current: {
      startDate: formatYyyyMmDd(currentStart),
      endDate: formatYyyyMmDd(endDate),
    },
    previous: {
      startDate: formatYyyyMmDd(previousStart),
      endDate: formatYyyyMmDd(previousEnd),
    },
  };
}

function getSearchConsoleConfigFromEnv(env = process.env) {
  return {
    siteUrl: normalizeString(env.GSC_SITE_URL || env.GOOGLE_SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE_URL),
    clientId: normalizeString(env.GSC_CLIENT_ID || env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID),
    clientSecret: normalizeString(env.GSC_CLIENT_SECRET || env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET),
    refreshToken: normalizeString(env.GSC_REFRESH_TOKEN || env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN),
    accessToken: normalizeString(env.GSC_ACCESS_TOKEN || env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN),
    tokenUrl: normalizeString(env.GSC_TOKEN_URL || GOOGLE_TOKEN_URL) || GOOGLE_TOKEN_URL,
    apiBaseUrl: normalizeString(env.GSC_API_BASE_URL || SEARCH_CONSOLE_API_BASE) || SEARCH_CONSOLE_API_BASE,
  };
}

function getMissingSearchConsoleConfig(config = {}) {
  if (normalizeString(config.accessToken)) return [];
  return [
    !normalizeString(config.clientId) ? 'GSC_CLIENT_ID' : null,
    !normalizeString(config.clientSecret) ? 'GSC_CLIENT_SECRET' : null,
    !normalizeString(config.refreshToken) ? 'GSC_REFRESH_TOKEN' : null,
  ].filter(Boolean);
}

function hasSearchConsoleCredentials(config = {}) {
  return getMissingSearchConsoleConfig(config).length === 0;
}

function encodeSiteUrl(siteUrl) {
  return encodeURIComponent(normalizeString(siteUrl || DEFAULT_SITE_URL));
}

function createSearchConsoleClient(options = {}) {
  const config = {
    ...getSearchConsoleConfigFromEnv({}),
    ...(options.config || {}),
  };
  const fetchImpl = options.fetchImpl || fetch;
  let tokenCache = null;
  let refreshPromise = null;
  let configuredAccessTokenEnabled = Boolean(normalizeString(config.accessToken));

  function hasRefreshCredentials() {
    return Boolean(
      normalizeString(config.clientId)
      && normalizeString(config.clientSecret)
      && normalizeString(config.refreshToken)
    );
  }

  async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;
    const missing = [
      !normalizeString(config.clientId) ? 'GSC_CLIENT_ID' : null,
      !normalizeString(config.clientSecret) ? 'GSC_CLIENT_SECRET' : null,
      !normalizeString(config.refreshToken) ? 'GSC_REFRESH_TOKEN' : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      const error = new Error(`Search Console OAuth ontbreekt: ${missing.join(', ')}`);
      error.code = 'GSC_CONFIG_MISSING';
      error.missing = missing;
      throw error;
    }

    refreshPromise = (async () => {
      const response = await fetchImpl(config.tokenUrl || GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        const error = new Error(`Search Console OAuth token mislukt (${response.status})`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      tokenCache = {
        accessToken: normalizeString(data.access_token),
        expiresAtMs: Date.now() + Math.max(300, toFiniteNumber(data.expires_in, 3600)) * 1000,
      };
      return tokenCache.accessToken;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function resolveAccessToken(options = {}) {
    if (!options.forceRefresh && configuredAccessTokenEnabled) return normalizeString(config.accessToken);
    if (tokenCache && tokenCache.expiresAtMs - 60000 > Date.now()) return tokenCache.accessToken;
    return refreshAccessToken();
  }

  async function fetchWithOAuthRetry(url, requestOptions = {}) {
    const initialToken = await resolveAccessToken();
    const request = (token) => fetchImpl(url, {
      ...requestOptions,
      headers: {
        ...(requestOptions.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const response = await request(initialToken);
    if (response.status !== 401 || !hasRefreshCredentials()) return response;

    configuredAccessTokenEnabled = false;
    let retryToken = null;
    if (
      tokenCache
      && tokenCache.expiresAtMs - 60000 > Date.now()
      && tokenCache.accessToken !== initialToken
    ) {
      retryToken = tokenCache.accessToken;
    } else {
      if (tokenCache && tokenCache.accessToken === initialToken) tokenCache = null;
      retryToken = await resolveAccessToken({ forceRefresh: true });
    }
    return request(retryToken);
  }

  async function requestJson(path, requestOptions = {}) {
    const response = await fetchWithOAuthRetry(`${config.apiBaseUrl || SEARCH_CONSOLE_API_BASE}${path}`, {
      ...requestOptions,
      headers: {
        Accept: 'application/json',
        ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestOptions.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Search Console request mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function querySearchAnalytics(query = {}) {
    const siteUrl = normalizeString(query.siteUrl || config.siteUrl || DEFAULT_SITE_URL);
    const body = {
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: Array.isArray(query.dimensions) ? query.dimensions : [],
      rowLimit: Math.max(1, Math.min(25000, Math.round(toFiniteNumber(query.rowLimit, 250)))),
      startRow: Math.max(0, Math.round(toFiniteNumber(query.startRow, 0))),
      aggregationType: query.aggregationType || 'auto',
    };
    if (Array.isArray(query.dimensionFilterGroups) && query.dimensionFilterGroups.length > 0) {
      body.dimensionFilterGroups = query.dimensionFilterGroups;
    }

    const data = await requestJson(`/sites/${encodeSiteUrl(siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return normalizeSearchRows(data.rows || []);
  }

  async function listSitemaps(siteUrl = config.siteUrl || DEFAULT_SITE_URL) {
    const data = await requestJson(`/sites/${encodeSiteUrl(siteUrl)}/sitemaps`);
    return normalizeSitemaps(data.sitemap || []);
  }

  async function inspectUrl(inspectionUrl, siteUrl = config.siteUrl || DEFAULT_SITE_URL) {
    const response = await fetchWithOAuthRetry(
      `${config.inspectionApiBaseUrl || SEARCH_CONSOLE_INSPECTION_API_BASE}/urlInspection/index:inspect`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inspectionUrl: normalizeString(inspectionUrl),
          siteUrl: normalizeString(siteUrl),
          languageCode: 'nl-NL',
        }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Search Console URL Inspection mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  return {
    config,
    resolveAccessToken,
    querySearchAnalytics,
    listSitemaps,
    inspectUrl,
  };
}

function normalizeSearchRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      keys: Array.isArray(row.keys) ? row.keys.map((key) => normalizeString(key)) : [],
      clicks: toFiniteNumber(row.clicks),
      impressions: toFiniteNumber(row.impressions),
      ctr: toFiniteNumber(row.ctr),
      position: toFiniteNumber(row.position),
    }))
    .filter((row) => row.keys.length > 0 || row.clicks > 0 || row.impressions > 0);
}

function normalizeSitemaps(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((sitemap) => ({
    path: normalizeString(sitemap.path),
    lastSubmitted: normalizeString(sitemap.lastSubmitted),
    lastDownloaded: normalizeString(sitemap.lastDownloaded),
    isPending: Boolean(sitemap.isPending),
    isSitemapsIndex: Boolean(sitemap.isSitemapsIndex),
    type: normalizeString(sitemap.type),
    errors: toFiniteNumber(sitemap.errors),
    warnings: toFiniteNumber(sitemap.warnings),
    contents: Array.isArray(sitemap.contents)
      ? sitemap.contents.map((item) => ({
          type: normalizeString(item.type),
          submitted: toFiniteNumber(item.submitted),
          indexed: toFiniteNumber(item.indexed),
        }))
      : [],
  }));
}

function aggregateRows(rows = []) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.clicks += toFiniteNumber(row.clicks);
      acc.impressions += toFiniteNumber(row.impressions);
      acc.weightedPosition += toFiniteNumber(row.position) * toFiniteNumber(row.impressions);
      return acc;
    },
    { clicks: 0, impressions: 0, weightedPosition: 0 }
  );
  return {
    clicks: roundNumber(totals.clicks, 2),
    impressions: roundNumber(totals.impressions, 2),
    ctr: totals.impressions > 0 ? roundNumber(totals.clicks / totals.impressions, 4) : 0,
    position: totals.impressions > 0 ? roundNumber(totals.weightedPosition / totals.impressions, 2) : 0,
  };
}

function aggregateNonBrandedPages(pageQueryRows = []) {
  const byPage = new Map();
  for (const row of normalizeSearchRows(pageQueryRows)) {
    const page = rowKey(row, 0);
    const query = rowKey(row, 1);
    if (!page || !isNonBrandedQuery(query)) continue;
    const current = byPage.get(page) || { clicks: 0, impressions: 0, weightedPosition: 0 };
    current.clicks += toFiniteNumber(row.clicks);
    current.impressions += toFiniteNumber(row.impressions);
    current.weightedPosition += toFiniteNumber(row.position) * toFiniteNumber(row.impressions);
    byPage.set(page, current);
  }
  return [...byPage.entries()]
    .map(([page, totals]) => ({
      page,
      clicks: roundNumber(totals.clicks, 2),
      impressions: roundNumber(totals.impressions, 2),
      ctr: totals.impressions ? roundNumber(totals.clicks / totals.impressions, 4) : 0,
      position: totals.impressions ? roundNumber(totals.weightedPosition / totals.impressions, 2) : 0,
    }))
    .sort((left, right) => right.clicks - left.clicks || right.impressions - left.impressions || left.page.localeCompare(right.page));
}

function buildUnclassifiedSegment(propertyTotals, visibleQueryTotals) {
  const clicks = Math.max(0, toFiniteNumber(propertyTotals.clicks) - toFiniteNumber(visibleQueryTotals.clicks));
  const impressions = Math.max(
    0,
    toFiniteNumber(propertyTotals.impressions) - toFiniteNumber(visibleQueryTotals.impressions)
  );
  return {
    clicks: roundNumber(clicks, 2),
    impressions: roundNumber(impressions, 2),
    ctr: impressions > 0 ? roundNumber(clicks / impressions, 4) : 0,
    position: null,
  };
}

function rowKey(row, index = 0) {
  return normalizeString((row.keys || [])[index]);
}

function rowsWithDelta(currentRows = [], previousRows = [], keyIndex = 0) {
  const previousByKey = new Map(previousRows.map((row) => [rowKey(row, keyIndex), row]));
  return currentRows.map((row) => {
    const previous = previousByKey.get(rowKey(row, keyIndex)) || {};
    return {
      ...row,
      previousClicks: toFiniteNumber(previous.clicks),
      previousImpressions: toFiniteNumber(previous.impressions),
      clicksDelta: roundNumber(toFiniteNumber(row.clicks) - toFiniteNumber(previous.clicks), 2),
      impressionsDelta: roundNumber(toFiniteNumber(row.impressions) - toFiniteNumber(previous.impressions), 2),
      positionDelta: previous.position
        ? roundNumber(toFiniteNumber(row.position) - toFiniteNumber(previous.position), 2)
        : null,
    };
  });
}

function sortByNumberDesc(key) {
  return (a, b) => toFiniteNumber(b[key]) - toFiniteNumber(a[key]);
}

function findLandingPageForQuery(query, pageQueryRows = []) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  const matches = pageQueryRows
    .filter((row) => normalizeString(row.keys?.[1]).toLowerCase() === normalizedQuery)
    .sort((a, b) => toFiniteNumber(b.impressions) - toFiniteNumber(a.impressions));
  const match = matches.find((row) => !isSeoAutomationExcludedPath(row.keys?.[0])) || matches[0];
  return normalizeString(match?.keys?.[0]);
}

function compactOpportunity(row, type, pageQueryRows = []) {
  const query = rowKey(row, 0);
  return {
    type,
    query,
    page: findLandingPageForQuery(query, pageQueryRows),
    clicks: roundNumber(row.clicks, 2),
    impressions: roundNumber(row.impressions, 2),
    ctr: roundNumber(row.ctr, 4),
    position: roundNumber(row.position, 2),
    clicksDelta: roundNumber(row.clicksDelta, 2),
    impressionsDelta: roundNumber(row.impressionsDelta, 2),
  };
}

function compactPage(row, type) {
  return {
    type,
    page: rowKey(row, 0),
    clicks: roundNumber(row.clicks, 2),
    impressions: roundNumber(row.impressions, 2),
    ctr: roundNumber(row.ctr, 4),
    position: roundNumber(row.position, 2),
    clicksDelta: roundNumber(row.clicksDelta, 2),
    impressionsDelta: roundNumber(row.impressionsDelta, 2),
  };
}

function buildSearchConsoleAgentReport(snapshot = {}, options = {}) {
  const pageRows = rowsWithDelta(snapshot.pagesCurrent || [], snapshot.pagesPrevious || [], 0);
  const queryRows = rowsWithDelta(snapshot.queriesCurrent || [], snapshot.queriesPrevious || [], 0);
  const pageQueryRows = normalizeSearchRows(snapshot.pageQueryCurrent || []);
  const nonBrandedPages = aggregateNonBrandedPages(pageQueryRows);
  const visibleCurrentTotals = aggregateRows(snapshot.queriesCurrent || []);
  const currentTotals = aggregateRows(snapshot.totalsCurrent || snapshot.queriesCurrent || []);
  const previousTotals = aggregateRows(snapshot.totalsPrevious || snapshot.queriesPrevious || []);
  const segmentRows = (segment) => queryRows.filter((row) => classifySeoQuery(rowKey(row, 0)) === segment);
  const classifiedQueryRows = queryRows.filter((row) => classifySeoQuery(rowKey(row, 0)) !== 'unclassified');
  const sitemapIssues = (snapshot.sitemaps || []).filter(
    (sitemap) => sitemap.errors > 0 || sitemap.warnings > 0 || sitemap.isPending
  );

  const lowCtrQueries = queryRows
    .filter((row) => row.impressions >= toFiniteNumber(options.minOpportunityImpressions, 25))
    .filter((row) => row.position <= toFiniteNumber(options.maxLowCtrPosition, 20))
    .filter((row) => isNonBrandedQuery(rowKey(row, 0)))
    .filter((row) => row.ctr < toFiniteNumber(options.lowCtrThreshold, 0.025))
    .sort(sortByNumberDesc('impressions'))
    .map((row) => compactOpportunity(row, 'low_ctr', pageQueryRows))
    .filter((item) => !isSeoAutomationExcludedPath(item.page))
    .slice(0, 12);

  const strikingDistanceQueries = queryRows
    .filter((row) => row.impressions >= toFiniteNumber(options.minOpportunityImpressions, 25))
    .filter((row) => row.position > 5 && row.position <= toFiniteNumber(options.maxStrikingDistancePosition, 20))
    .filter((row) => isNonBrandedQuery(rowKey(row, 0)))
    .sort((a, b) => a.position - b.position || b.impressions - a.impressions)
    .map((row) => compactOpportunity(row, 'striking_distance', pageQueryRows))
    .filter((item) => !isSeoAutomationExcludedPath(item.page))
    .slice(0, 12);

  const emergingQueries = queryRows
    .filter((row) => row.impressions >= toFiniteNumber(options.minOpportunityImpressions, 25))
    .filter((row) => row.position > toFiniteNumber(options.maxStrikingDistancePosition, 20))
    .filter((row) => row.position <= toFiniteNumber(options.maxEmergingPosition, 40))
    .filter((row) => isNonBrandedQuery(rowKey(row, 0)))
    .filter((row) => getBusinessFit(rowKey(row, 0)) >= 4)
    .sort(sortByNumberDesc('impressions'))
    .map((row) => compactOpportunity(row, 'emerging', pageQueryRows))
    .filter((item) => !isSeoAutomationExcludedPath(item.page))
    .slice(0, 12);

  const prioritizedQueries = rankSeoOpportunities([
    ...lowCtrQueries,
    ...strikingDistanceQueries,
    ...emergingQueries,
  ]);

  const decliningPages = pageRows
    .filter((row) => row.previousClicks >= 3 || row.previousImpressions >= 50)
    .filter((row) => row.clicksDelta < 0 || row.impressionsDelta < -25)
    .sort((a, b) => a.clicksDelta - b.clicksDelta || a.impressionsDelta - b.impressionsDelta)
    .map((row) => compactPage(row, 'declining_page'))
    .filter((item) => !isSeoAutomationExcludedPath(item.page))
    .slice(0, 10);

  const risingPages = pageRows
    .filter((row) => row.clicksDelta > 0 || row.impressionsDelta > 25)
    .sort((a, b) => b.clicksDelta - a.clicksDelta || b.impressionsDelta - a.impressionsDelta)
    .map((row) => compactPage(row, 'rising_page'))
    .filter((item) => !isSeoAutomationExcludedPath(item.page))
    .slice(0, 10);

  const actionQueue = [];
  if (sitemapIssues.length > 0) {
    actionQueue.push({
      priority: 'hoog',
      type: 'technical_sitemap',
      action: 'Controleer sitemap errors, warnings of pending status in Search Console.',
    });
  }
  prioritizedQueries.slice(0, 5).forEach((item) => {
    const needsSnippet = item.types.includes('low_ctr');
    const needsPageStrength = item.types.includes('striking_distance');
    const action = needsSnippet && needsPageStrength
      ? `Verbeter snippet, intentdekking en interne links voor zoekterm "${item.query}".`
      : needsSnippet
        ? `Verbeter titel/meta en intro voor zoekterm "${item.query}".`
        : `Versterk content en interne links voor zoekterm "${item.query}".`;
    actionQueue.push({
      priority: item.businessFit >= 4 && item.opportunityScore >= 10 ? 'hoog' : 'middel',
      type: needsSnippet && needsPageStrength
        ? 'rewrite_snippet_and_strengthen_page'
        : needsSnippet
          ? 'rewrite_snippet'
          : 'strengthen_page',
      action,
      page: item.page,
      query: item.query,
      businessFit: item.businessFit,
      expectedClickUplift: item.expectedClickUplift,
      opportunityScore: item.opportunityScore,
    });
  });
  decliningPages.slice(0, 5).forEach((item) => {
    actionQueue.push({
      priority: 'middel',
      type: 'recover_page',
      action: `Onderzoek daling en refresh pagina ${item.page}.`,
      page: item.page,
    });
  });

  const generatedAt = normalizeString(snapshot.generatedAt) || new Date().toISOString();
  return {
    status: 'ready',
    source: 'google-search-console',
    generatedAt,
    siteUrl: normalizeString(snapshot.siteUrl || DEFAULT_SITE_URL),
    excludedAutomationPaths: [...SEO_AUTOMATION_EXCLUDED_PATHS],
    dateWindows: snapshot.dateWindows,
    totals: {
      current: currentTotals,
      previous: previousTotals,
      clicksDelta: roundNumber(currentTotals.clicks - previousTotals.clicks, 2),
      impressionsDelta: roundNumber(currentTotals.impressions - previousTotals.impressions, 2),
      ctrDelta: roundNumber(currentTotals.ctr - previousTotals.ctr, 4),
      positionDelta: roundNumber(currentTotals.position - previousTotals.position, 2),
    },
    growthHorizon: buildGrowthHorizon({
      currentClicks: currentTotals.clicks,
      referenceDate: snapshot.dateWindows?.current?.endDate || generatedAt,
      targetClicks: options.stretchTargetClicks,
      deadline: options.stretchDeadline,
    }),
    segments: {
      branded: aggregateRows(segmentRows('branded')),
      navigational: aggregateRows(segmentRows('navigational')),
      ambiguousBrand: aggregateRows(segmentRows('ambiguousBrand')),
      nonBranded: aggregateRows(segmentRows('nonBranded')),
      visibleQueries: visibleCurrentTotals,
      unclassified: buildUnclassifiedSegment(currentTotals, aggregateRows(classifiedQueryRows)),
    },
    queries: {
      top: [...queryRows].sort(sortByNumberDesc('clicks')).slice(0, 20),
      lowCtr: lowCtrQueries,
      strikingDistance: strikingDistanceQueries,
      emerging: emergingQueries,
      prioritized: prioritizedQueries,
    },
    pages: {
      top: pageRows
        .sort(sortByNumberDesc('clicks'))
        .filter((row) => !isSeoAutomationExcludedPath(rowKey(row, 0)))
        .slice(0, 20),
      nonBranded: nonBrandedPages.filter((row) => !isSeoAutomationExcludedPath(row.page)),
      rising: risingPages,
      declining: decliningPages,
    },
    sitemaps: normalizeSitemaps(snapshot.sitemaps || []),
    technical: snapshot.technical || null,
    actionQueue,
  };
}

async function fetchSearchConsoleSnapshot(options = {}) {
  const config = {
    ...getSearchConsoleConfigFromEnv(process.env),
    ...(options.config || {}),
  };
  const client = options.client || createSearchConsoleClient({ config, fetchImpl: options.fetchImpl });
  const siteUrl = normalizeString(options.siteUrl || config.siteUrl || DEFAULT_SITE_URL);
  const dateWindows = resolveDateWindows({
    days: options.days,
    endDate: options.endDate,
    now: options.now,
  });

  const [totalsCurrent, totalsPrevious, pagesCurrent, pagesPrevious, queriesCurrent, queriesPrevious, pageQueryCurrent, sitemaps] =
    await Promise.all([
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.current,
        dimensions: [],
        rowLimit: 1,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.previous,
        dimensions: [],
        rowLimit: 1,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.current,
        dimensions: ['page'],
        rowLimit: 500,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.previous,
        dimensions: ['page'],
        rowLimit: 500,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.current,
        dimensions: ['query'],
        rowLimit: 500,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.previous,
        dimensions: ['query'],
        rowLimit: 500,
      }),
      client.querySearchAnalytics({
        siteUrl,
        ...dateWindows.current,
        dimensions: ['page', 'query'],
        rowLimit: 1000,
      }),
      client.listSitemaps(siteUrl),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    siteUrl,
    dateWindows,
    totalsCurrent,
    totalsPrevious,
    pagesCurrent,
    pagesPrevious,
    queriesCurrent,
    queriesPrevious,
    pageQueryCurrent,
    sitemaps,
  };
}

function extractSitemapUrls(xml = '') {
  return Array.from(String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map((match) =>
    normalizeString(match[1])
  );
}

function analyzeRobotsTxt(source = '') {
  const lines = String(source || '')
    .split(/\r?\n/)
    .map((line) => normalizeString(line))
    .filter(Boolean);
  return {
    hasSitemapDirective: lines.some((line) => /^sitemap:/i.test(line)),
    blocksAll: lines.some((line) => /^disallow:\s*\/\s*$/i.test(line)),
    allowsRoot: lines.some((line) => /^allow:\s*\/\s*$/i.test(line)),
    disallowCount: lines.filter((line) => /^disallow:/i.test(line)).length,
  };
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: 'text/plain, application/xml;q=0.9, */*;q=0.8' } });
  const text = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    url,
    text,
  };
}

async function fetchTechnicalSeoSnapshot(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const siteOrigin = normalizeString(options.siteOrigin || DEFAULT_SITE_ORIGIN).replace(/\/+$/, '');
  const [sitemapResponse, robotsResponse] = await Promise.all([
    fetchText(fetchImpl, `${siteOrigin}/sitemap.xml`),
    fetchText(fetchImpl, `${siteOrigin}/robots.txt`),
  ]);
  const sitemapUrls = extractSitemapUrls(sitemapResponse.text);
  const robots = analyzeRobotsTxt(robotsResponse.text);
  return {
    checkedAt: new Date().toISOString(),
    siteOrigin,
    sitemap: {
      ok: sitemapResponse.ok,
      status: sitemapResponse.status,
      url: sitemapResponse.url,
      urlCount: sitemapUrls.length,
      sampleUrls: sitemapUrls.slice(0, 20),
    },
    robots: {
      ok: robotsResponse.ok,
      status: robotsResponse.status,
      url: robotsResponse.url,
      ...robots,
    },
  };
}

function buildTechnicalOnlyAgentReport(snapshot = {}, options = {}) {
  const config = options.config || {};
  const missing = getMissingSearchConsoleConfig(config);
  const technical = snapshot.technical || snapshot;
  const actionQueue = [];

  if (!technical?.sitemap?.ok || technical?.sitemap?.urlCount <= 0) {
    actionQueue.push({
      priority: 'hoog',
      type: 'technical_sitemap',
      action: 'Maak de live sitemap bereikbaar voordat Search Console erop stuurt.',
    });
  }
  if (!technical?.robots?.ok || technical?.robots?.blocksAll) {
    actionQueue.push({
      priority: 'hoog',
      type: 'technical_robots',
      action: 'Controleer robots.txt; Google mag publieke pagina’s niet geblokkeerd zien.',
    });
  }
  if (missing.length > 0) {
    actionQueue.push({
      priority: 'hoog',
      type: 'connect_gsc',
      action: `Koppel Search Console OAuth voor prestatiedata (${missing.join(', ')}).`,
    });
  }

  return {
    status: missing.length > 0 ? 'technical-only' : 'ready-for-gsc',
    source: 'public-technical-check',
    generatedAt: new Date().toISOString(),
    siteUrl: normalizeString(config.siteUrl || DEFAULT_SITE_URL),
    missingSearchConsoleConfig: missing,
    requiredScope: SEARCH_CONSOLE_READONLY_SCOPE,
    technical,
    actionQueue,
  };
}

function formatPercent(value) {
  return `${roundNumber(toFiniteNumber(value) * 100, 2)}%`;
}

function formatAgentMarkdown(report = {}) {
  const lines = [
    '# Softora SEO Agent Report',
    '',
    `Status: ${report.status || 'unknown'}`,
    `Bron: ${report.source || 'unknown'}`,
    `Gemaakt: ${report.generatedAt || ''}`,
    `Property: ${report.siteUrl || ''}`,
    '',
  ];

  if (report.totals) {
    lines.push(
      '## Scorebord',
      '',
      `Klikken: ${report.totals.current.clicks} (${report.totals.clicksDelta >= 0 ? '+' : ''}${report.totals.clicksDelta})`,
      `Vertoningen: ${report.totals.current.impressions} (${report.totals.impressionsDelta >= 0 ? '+' : ''}${report.totals.impressionsDelta})`,
      `CTR: ${formatPercent(report.totals.current.ctr)} (${report.totals.ctrDelta >= 0 ? '+' : ''}${formatPercent(report.totals.ctrDelta)})`,
      `Positie: ${report.totals.current.position} (${report.totals.positionDelta >= 0 ? '+' : ''}${report.totals.positionDelta})`,
      ''
    );
  }

  if (report.segments) {
    lines.push(
      '## Groei-segmenten',
      '',
      `Non-branded: ${report.segments.nonBranded?.clicks || 0} klikken, ${report.segments.nonBranded?.impressions || 0} vertoningen, CTR ${formatPercent(report.segments.nonBranded?.ctr || 0)}`,
      `Branded: ${report.segments.branded?.clicks || 0} klikken, ${report.segments.branded?.impressions || 0} vertoningen, CTR ${formatPercent(report.segments.branded?.ctr || 0)}`,
      `Naamgericht: ${report.segments.navigational?.clicks || 0} klikken, ${report.segments.navigational?.impressions || 0} vertoningen (persoonlijke naam, geen generieke klantvraag)`,
      `Mogelijk merkgericht: ${report.segments.ambiguousBrand?.clicks || 0} klikken, ${report.segments.ambiguousBrand?.impressions || 0} vertoningen (mogelijke merktypfout, apart gehouden)`,
      `Niet classificeerbaar: ${report.segments.unclassified?.clicks || 0} klikken, ${report.segments.unclassified?.impressions || 0} vertoningen (geen merkclaim mogelijk)`,
      ''
    );
  }

  if (report.growthHorizon) {
    const horizon = report.growthHorizon;
    lines.push('## Langetermijnhorizon', '');
    if (horizon.phase === 'stretch_countdown') {
      const pace = horizon.requiredMonthlyGrowthRate === null
        ? 'niet berekenbaar vanaf nul klikken of zonder resterende maand'
        : `${formatPercent(horizon.requiredMonthlyGrowthRate)} samengestelde groei per maand`;
      lines.push(
        `Referentie: ${horizon.targetClicks} klikken per 28 dagen op ${horizon.deadline}.`,
        `Gap: ${horizon.gap}; factor: ${horizon.factorToTarget ?? 'n/a'}; vereist tempo: ${pace}.`
      );
    } else if (horizon.phase === 'target_reached_defend_and_compound') {
      lines.push('De stretchreferentie is in het actuele venster bereikt; verdedig winnaars en bouw gecontroleerd door.');
    } else {
      lines.push('De stretchdeadline is verstreken; bereken geen fictief resterend tempo en ga door op rollende 28/90-daagse bewijsvoering.');
    }
    lines.push('De machine blijft actief totdat Serve haar expliciet pauzeert.', '');
  }

  if (report.technical) {
    lines.push(
      '## Techniek',
      '',
      `Sitemap: ${report.technical.sitemap?.ok ? 'ok' : 'niet ok'} (${report.technical.sitemap?.urlCount || 0} URLs)`,
      `Robots: ${report.technical.robots?.ok ? 'ok' : 'niet ok'}${report.technical.robots?.blocksAll ? ' - blokkeert alles' : ''}`,
      ''
    );
  }

  lines.push('## Acties', '');
  const actions = Array.isArray(report.actionQueue) ? report.actionQueue : [];
  if (actions.length === 0) {
    lines.push('- Geen directe actie uit dit rapport.');
  } else {
    actions.slice(0, 15).forEach((item) => {
      lines.push(`- [${item.priority || 'middel'}] ${item.action || item.type}`);
    });
  }

  if (Array.isArray(report.queries?.lowCtr) && report.queries.lowCtr.length > 0) {
    lines.push('', '## Lage CTR kansen', '');
    report.queries.lowCtr.slice(0, 8).forEach((item) => {
      lines.push(`- ${item.query}: ${item.impressions} vertoningen, CTR ${formatPercent(item.ctr)}, positie ${item.position}`);
    });
  }

  if (Array.isArray(report.queries?.prioritized) && report.queries.prioritized.length > 0) {
    lines.push('', '## Geprioriteerde kansen', '');
    report.queries.prioritized.slice(0, 8).forEach((item) => {
      lines.push(
        `- ${item.query}: score ${item.opportunityScore}, business fit ${item.businessFit}/5, verwachte klikwinst ${item.expectedClickUplift}, positie ${item.position}`
      );
    });
  }

  if (Array.isArray(report.pages?.declining) && report.pages.declining.length > 0) {
    lines.push('', '## Dalende paginas', '');
    report.pages.declining.slice(0, 8).forEach((item) => {
      lines.push(`- ${item.page}: klikken ${item.clicksDelta}, vertoningen ${item.impressionsDelta}`);
    });
  }

  if (Array.isArray(report.pages?.nonBranded) && report.pages.nonBranded.length > 0) {
    lines.push('', '## Non-branded landingspaginas', '');
    report.pages.nonBranded.slice(0, 10).forEach((item) => {
      lines.push(
        `- ${item.page}: ${item.clicks} klikken, ${item.impressions} vertoningen, CTR ${formatPercent(item.ctr)}, positie ${item.position}`
      );
    });
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  AVERAGE_MONTH_DAYS,
  DEFAULT_SITE_ORIGIN,
  DEFAULT_SITE_URL,
  GOOGLE_TOKEN_URL,
  SEARCH_CONSOLE_API_BASE,
  SEARCH_CONSOLE_INSPECTION_API_BASE,
  SEARCH_CONSOLE_READONLY_SCOPE,
  SEO_STRETCH_DEADLINE,
  SEO_STRETCH_TARGET_CLICKS,
  aggregateRows,
  analyzeRobotsTxt,
  buildGrowthHorizon,
  buildSearchConsoleAgentReport,
  buildTechnicalOnlyAgentReport,
  buildUnclassifiedSegment,
  createSearchConsoleClient,
  extractSitemapUrls,
  fetchSearchConsoleSnapshot,
  fetchTechnicalSeoSnapshot,
  formatAgentMarkdown,
  getMissingSearchConsoleConfig,
  getSearchConsoleConfigFromEnv,
  hasSearchConsoleCredentials,
  normalizeSearchRows,
  normalizeSitemaps,
  resolveDateWindows,
};
