const BRAND_TERMS = ['softora'];

const HIGH_INTENT_PATTERNS = [
  /\blaten maken\b/,
  /\bop maat\b/,
  /\bbureau\b/,
  /\bontwikkelaar\b/,
  /\bspecialist\b/,
  /\bofferte\b/,
  /\bkosten?\b/,
  /\bprijs\b/,
  /\bbedrijf\b/,
];

const CORE_SERVICE_PATTERNS = [
  /\bcrm\b/,
  /\bmaatwerk software\b/,
  /\bbedrijfssoftware\b/,
  /\bai automatisering\b/,
  /\bwebdesign\b/,
  /\bwebsite\b/,
  /\bseo\b/,
  /\bchatbot\b/,
  /\btelefon(?:ie|ist)\b/,
  /\bklantportaal\b/,
  /\bsoftware\b/,
];

const LOCAL_PATTERNS = [/\btilburg\b/, /\boisterwijk\b/, /\bbrabant\b/];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value) * factor) / factor;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function isBrandedQuery(query) {
  const normalized = normalizeText(query);
  return BRAND_TERMS.some((term) => normalized.includes(term));
}

function getBusinessFit(query) {
  const normalized = normalizeText(query);
  if (!normalized || isBrandedQuery(normalized)) return 1;

  const hasHighIntent = matchesAny(normalized, HIGH_INTENT_PATTERNS);
  const hasCoreService = matchesAny(normalized, CORE_SERVICE_PATTERNS);
  const hasLocalIntent = matchesAny(normalized, LOCAL_PATTERNS);

  if (hasHighIntent && hasCoreService) return 5;
  if (hasHighIntent || (hasCoreService && hasLocalIntent)) return 4;
  if (hasCoreService) return 3;
  if (hasLocalIntent) return 2;
  return 1;
}

function getTargetCtr(position) {
  const currentPosition = toFiniteNumber(position, 100);
  if (currentPosition <= 3) return 0.12;
  if (currentPosition <= 5) return 0.1;
  if (currentPosition <= 10) return 0.08;
  if (currentPosition <= 20) return 0.05;
  if (currentPosition <= 30) return 0.02;
  return 0.01;
}

function getPositionLeverage(position) {
  const currentPosition = toFiniteNumber(position, 100);
  if (currentPosition <= 5) return 1;
  if (currentPosition <= 10) return 1.5;
  if (currentPosition <= 20) return 1;
  if (currentPosition <= 30) return 0.5;
  if (currentPosition <= 50) return 0.2;
  return 0.05;
}

function getConfidence(impressions) {
  const currentImpressions = toFiniteNumber(impressions);
  if (currentImpressions >= 200) return 1;
  if (currentImpressions >= 100) return 0.85;
  if (currentImpressions >= 50) return 0.7;
  if (currentImpressions >= 25) return 0.55;
  return 0.35;
}

function mergeOpportunityTypes(items = []) {
  const opportunities = new Map();

  items.forEach((item) => {
    const query = normalizeText(item.query);
    const page = normalizeText(item.page);
    if (!query || isBrandedQuery(query)) return;

    const key = `${query}|${page}`;
    const existing = opportunities.get(key) || {
      ...item,
      query: String(item.query || '').trim(),
      page: String(item.page || '').trim(),
      types: [],
    };
    const types = new Set([...(existing.types || []), item.type].filter(Boolean));
    opportunities.set(key, {
      ...existing,
      ...item,
      types: Array.from(types).sort(),
    });
  });

  return Array.from(opportunities.values());
}

function scoreOpportunity(item = {}) {
  const businessFit = getBusinessFit(item.query);
  const targetCtr = getTargetCtr(item.position);
  const currentCtr = toFiniteNumber(item.ctr);
  const impressions = toFiniteNumber(item.impressions);
  const minimumImprovement = targetCtr * 0.2;
  const expectedClickUplift = impressions * Math.max(targetCtr - currentCtr, minimumImprovement);
  const positionLeverage = getPositionLeverage(item.position);
  const confidence = getConfidence(impressions);
  const opportunityScore = expectedClickUplift * businessFit * positionLeverage * confidence;

  return {
    ...item,
    businessFit,
    targetCtr: roundNumber(targetCtr, 4),
    expectedClickUplift: roundNumber(expectedClickUplift),
    positionLeverage: roundNumber(positionLeverage),
    confidence: roundNumber(confidence),
    opportunityScore: roundNumber(opportunityScore, 1),
  };
}

function rankSeoOpportunities(items = []) {
  return mergeOpportunityTypes(items)
    .map(scoreOpportunity)
    .sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore ||
        b.businessFit - a.businessFit ||
        b.impressions - a.impressions
    );
}

module.exports = {
  getBusinessFit,
  getConfidence,
  getPositionLeverage,
  getTargetCtr,
  isBrandedQuery,
  rankSeoOpportunities,
  scoreOpportunity,
};
