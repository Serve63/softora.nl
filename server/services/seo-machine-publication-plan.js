const { getSeoContentPublicationPlan } = require('./seo-content');
const { INDEXABLE_PUBLIC_SEO_PAGES } = require('./public-seo');

function publicationDayMs(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getPublicSeoGrowthEventPlan({ now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return INDEXABLE_PUBLIC_SEO_PAGES
    .filter((entry) => entry.growthEventKind && entry.lastmod)
    .map((entry) => {
      const eventMs = publicationDayMs(entry.lastmod);
      return {
        collection: entry.kind || 'public-page',
        path: entry.path,
        title: entry.title,
        cluster: entry.growthCluster || entry.kind || 'public-page',
        publishedAt: entry.publishedAt || '',
        eventAt: entry.lastmod,
        publicationKind: entry.growthEventKind,
        status: Number.isFinite(eventMs) && eventMs <= nowMs ? 'live' : 'scheduled',
      };
    });
}

function getSeoMachinePublicationPlan({ now = new Date() } = {}) {
  return [
    ...getSeoContentPublicationPlan({ now }),
    ...getPublicSeoGrowthEventPlan({ now }),
  ].sort((a, b) => (
    String(a.eventAt || a.publishedAt).localeCompare(String(b.eventAt || b.publishedAt))
    || a.path.localeCompare(b.path)
  ));
}

module.exports = {
  getPublicSeoGrowthEventPlan,
  getSeoMachinePublicationPlan,
};
