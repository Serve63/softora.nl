const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PERFORMANCE_THRESHOLDS = Object.freeze({
  minimumReviewableUrls: 5,
  recoveryMinimumImpressionRate: 0.4,
  recoveryZeroClickImpressions: 100,
  scaleMinimumImpressionRate: 0.6,
  scaleMinimumClicks: 10,
  scaleMinimumClickingUrls: 3,
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function normalizePagePath(valueRaw) {
  try {
    const parsed = new URL(String(valueRaw || ''), 'https://www.softora.nl');
    return parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  } catch (_) {
    return '';
  }
}

function ageInDays(valueRaw, now = new Date()) {
  const value = String(valueRaw || '').slice(0, 10);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

function buildD28NonBrandedPerformance({
  publicationPlan = [],
  report,
  now = new Date(),
  thresholds = DEFAULT_PERFORMANCE_THRESHOLDS,
} = {}) {
  if (!report || report.status !== 'ready' || !Array.isArray(report.pages && report.pages.nonBranded)) {
    return {
      status: 'data_degraded',
      reasons: ['Verse non-branded GSC-paginadata ontbreekt.'],
      thresholds,
      summary: { reviewed: 0, impressing: 0, clicking: 0, impressions: 0, clicks: 0 },
      items: [],
    };
  }

  const pageMetrics = new Map();
  for (const page of report.pages.nonBranded) {
    const path = normalizePagePath(page.page);
    if (!path) continue;
    const previous = pageMetrics.get(path) || { clicks: 0, impressions: 0, weightedPosition: 0 };
    const impressions = toNumber(page.impressions);
    previous.clicks += toNumber(page.clicks);
    previous.impressions += impressions;
    previous.weightedPosition += toNumber(page.position) * impressions;
    pageMetrics.set(path, previous);
  }

  const items = (Array.isArray(publicationPlan) ? publicationPlan : [])
    .filter((entry) => entry && entry.status === 'live' && entry.publicationKind === 'new_url')
    .map((entry) => ({
      ...entry,
      path: normalizePagePath(entry.path),
      ageDays: ageInDays(entry.eventAt || entry.publishedAt, now),
    }))
    .filter((entry) => entry.path && entry.ageDays >= 28 && entry.ageDays <= 56)
    .map((entry) => {
      const metrics = pageMetrics.get(entry.path) || { clicks: 0, impressions: 0, weightedPosition: 0 };
      return {
        path: entry.path,
        publishedAt: String(entry.eventAt || entry.publishedAt || ''),
        ageDays: entry.ageDays,
        clicks: round(metrics.clicks, 2),
        impressions: round(metrics.impressions, 2),
        ctr: metrics.impressions ? round(metrics.clicks / metrics.impressions, 4) : 0,
        position: metrics.impressions ? round(metrics.weightedPosition / metrics.impressions, 2) : null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const reviewed = items.length;
  const impressing = items.filter((item) => item.impressions > 0).length;
  const clicking = items.filter((item) => item.clicks > 0).length;
  const impressions = round(items.reduce((total, item) => total + item.impressions, 0), 2);
  const clicks = round(items.reduce((total, item) => total + item.clicks, 0), 2);
  const impressionRate = reviewed ? round(impressing / reviewed) : null;
  const clickRate = reviewed ? round(clicking / reviewed) : null;
  const summary = { reviewed, impressing, clicking, impressionRate, clickRate, impressions, clicks };

  if (reviewed < thresholds.minimumReviewableUrls) {
    return { status: 'insufficient_sample', reasons: [], thresholds, summary, items };
  }

  if (
    impressionRate < thresholds.recoveryMinimumImpressionRate
    || (impressions >= thresholds.recoveryZeroClickImpressions && clicks === 0)
  ) {
    return {
      status: 'performance_recovery',
      reasons: [
        `D28-cohort: ${impressing}/${reviewed} URL's met non-branded impressies, ${clicks} klikken uit ${impressions} impressies.`,
      ],
      thresholds,
      summary,
      items,
    };
  }

  if (impressionRate >= thresholds.scaleMinimumImpressionRate && clicks >= thresholds.scaleMinimumClicks
    && clicking >= thresholds.scaleMinimumClickingUrls) {
    return { status: 'scale_ready', reasons: [], thresholds, summary, items };
  }

  return { status: 'learning', reasons: [], thresholds, summary, items };
}

module.exports = {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  ageInDays,
  buildD28NonBrandedPerformance,
  normalizePagePath,
};
