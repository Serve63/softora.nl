const SEO_CONTENT_AUTHOR = Object.freeze({ type: 'Organization', name: 'Softora', href: '/over-softora' });

function hasSupportedReview(item, nowMs = Date.now()) {
  const evidence = item?.reviewEvidence;
  const reviewedAt = Date.parse(evidence?.reviewedAt || '');
  const contentDate = Date.parse(item?.updatedAt || item?.publishedAt || '');
  return Boolean(String(item?.reviewedBy?.name || '').trim()
    && String(evidence?.reference || '').trim().length >= 12
    && Number.isFinite(reviewedAt) && reviewedAt <= nowMs
    && (!Number.isFinite(contentDate) || reviewedAt >= contentDate));
}

function buildContributorSchema(contributor, site) {
  if (!String(contributor?.name || '').trim()) return undefined;
  const organization = contributor.type === 'Organization';
  return {
    '@type': organization ? 'Organization' : 'Person',
    name: contributor.name,
    url: new URL(contributor.href || '/over-softora', site).toString(),
    ...(organization ? {} : { jobTitle: contributor.role, worksFor: { '@id': `${site}/#organization` } }),
  };
}

function buildReviewSchema(item, site) {
  if (!hasSupportedReview(item)) return {};
  return {
    reviewedBy: buildContributorSchema(item.reviewedBy, site),
    lastReviewed: item.reviewEvidence.reviewedAt.slice(0, 10),
  };
}

module.exports = { SEO_CONTENT_AUTHOR, buildContributorSchema, buildReviewSchema, hasSupportedReview };
