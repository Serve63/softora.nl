const fs = require('node:fs');
const path = require('node:path');

const {
  SEO_CONTENT_COLLECTIONS,
  getSeoContentPublicationPlan,
} = require('./seo-content');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BACKLOG_PATH = path.join(REPO_ROOT, 'docs/growth/seo-machine-backlog.json');
const MINIMUM_READY_ITEMS = 15;
const MINIMUM_COMMERCIAL_SHARE = 0.7;
const READY_STATUS = 'ready';
const ALLOWED_STATUSES = new Set(['ready', 'selected', 'shipped', 'hold', 'rejected']);
const ALLOWED_FUNNEL_STAGES = new Set(['awareness', 'consideration', 'decision']);
const COMMERCIAL_INTENT_CLASSES = new Set([
  'buying',
  'comparison',
  'cost',
  'implementation',
  'integration',
  'migration',
  'problem-solving',
  'risk',
]);
const SCORE_FORMULA = Object.freeze({
  version: '2026-07-17-v1',
  positiveWeights: Object.freeze({
    businessFit: 0.25,
    conversionProximity: 0.2,
    nonBrandOpportunity: 0.2,
    attainability: 0.15,
    uniqueness: 0.2,
  }),
  maximumPenalties: Object.freeze({
    cannibalizationRisk: 0.6,
    effort: 0.2,
  }),
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPublicPath(value) {
  return /^\/[a-z0-9][a-z0-9/-]*$/.test(String(value || '')) && !String(value).includes('//');
}

function roundScore(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateSeoCandidateScore(scores = {}, formula = SCORE_FORMULA) {
  const positiveScore = Object.entries(formula.positiveWeights).reduce((total, [key, weight]) => {
    return total + Number(scores[key] || 0) * weight;
  }, 0);
  const riskPenalty = ((Number(scores.cannibalizationRisk || 1) - 1) / 4)
    * formula.maximumPenalties.cannibalizationRisk;
  const effortPenalty = ((Number(scores.effort || 1) - 1) / 4)
    * formula.maximumPenalties.effort;
  return roundScore(Math.max(1, Math.min(5, positiveScore - riskPenalty - effortPenalty)));
}

function loadSeoMachineBacklog(filePath = DEFAULT_BACKLOG_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listExistingSeoContentPaths() {
  return new Set(
    getSeoContentPublicationPlan({ now: new Date('2100-01-01T00:00:00.000Z') })
      .map((item) => item.path)
      .filter(Boolean)
  );
}

function validateScoreFields(item, itemLabel, errors) {
  const scores = isObject(item.scores) ? item.scores : {};
  const requiredScores = [
    ...Object.keys(SCORE_FORMULA.positiveWeights),
    'cannibalizationRisk',
    'effort',
  ];
  for (const scoreName of requiredScores) {
    const value = scores[scoreName];
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      errors.push(`${itemLabel}.scores.${scoreName} moet een integer van 1 tot en met 5 zijn.`);
    }
  }
  const calculatedScore = calculateSeoCandidateScore(scores);
  if (Number(item.weightedScore) !== calculatedScore) {
    errors.push(
      `${itemLabel}.weightedScore is ${item.weightedScore}; verwacht ${calculatedScore} volgens ${SCORE_FORMULA.version}.`
    );
  }
}

function validateEvidence(item, itemLabel, errors) {
  if (!Array.isArray(item.demandEvidence) || item.demandEvidence.length === 0) {
    errors.push(`${itemLabel}.demandEvidence moet minimaal een bewijsitem bevatten.`);
    return;
  }
  item.demandEvidence.forEach((evidence, evidenceIndex) => {
    const label = `${itemLabel}.demandEvidence[${evidenceIndex}]`;
    if (!isObject(evidence)) {
      errors.push(`${label} moet een object zijn.`);
      return;
    }
    for (const field of ['type', 'source', 'detail']) {
      if (!isNonEmptyString(evidence[field])) errors.push(`${label}.${field} ontbreekt.`);
    }
    if (!isIsoDate(evidence.observedAt)) errors.push(`${label}.observedAt moet YYYY-MM-DD zijn.`);
  });
}

function validateOverlap(item, itemLabel, errors, existingPaths) {
  const overlap = item.overlap;
  if (!isObject(overlap)) {
    errors.push(`${itemLabel}.overlap ontbreekt.`);
    return;
  }
  if (!isIsoDate(overlap.checkedAt)) errors.push(`${itemLabel}.overlap.checkedAt moet YYYY-MM-DD zijn.`);
  if (!['distinct', 'merge', 'reject'].includes(overlap.decision)) {
    errors.push(`${itemLabel}.overlap.decision moet distinct, merge of reject zijn.`);
  }
  if (!isNonEmptyString(overlap.rationale)) errors.push(`${itemLabel}.overlap.rationale ontbreekt.`);
  if (!Array.isArray(overlap.closestPaths) || overlap.closestPaths.length !== 3) {
    errors.push(`${itemLabel}.overlap.closestPaths moet exact drie bestaande Softora-URL's bevatten.`);
    return;
  }
  const uniquePaths = new Set(overlap.closestPaths);
  if (uniquePaths.size !== overlap.closestPaths.length) {
    errors.push(`${itemLabel}.overlap.closestPaths bevat duplicaten.`);
  }
  for (const closestPath of overlap.closestPaths) {
    if (!existingPaths.has(closestPath)) {
      errors.push(`${itemLabel}.overlap.closestPaths verwijst naar onbekende content-URL ${closestPath}.`);
    }
  }
}

function validateBrief(item, itemLabel, errors) {
  const brief = item.brief;
  if (!isObject(brief)) {
    errors.push(`${itemLabel}.brief ontbreekt.`);
    return;
  }
  for (const field of ['title', 'metaDescription', 'h1', 'conversionPath', 'claimRisk']) {
    if (!isNonEmptyString(brief[field])) errors.push(`${itemLabel}.brief.${field} ontbreekt.`);
  }
  const minimumArrayLengths = {
    outline: 4,
    buyerQuestions: 3,
    incomingLinks: 2,
    outgoingLinks: 2,
    structuredData: 1,
  };
  for (const [field, minimumLength] of Object.entries(minimumArrayLengths)) {
    if (!Array.isArray(brief[field]) || brief[field].length < minimumLength) {
      errors.push(`${itemLabel}.brief.${field} moet minimaal ${minimumLength} items bevatten.`);
    }
  }
  for (const linkField of ['incomingLinks', 'outgoingLinks']) {
    for (const linkPath of Array.isArray(brief[linkField]) ? brief[linkField] : []) {
      if (!isPublicPath(linkPath)) errors.push(`${itemLabel}.brief.${linkField} bevat ongeldige URL ${linkPath}.`);
    }
  }
  if (!Array.isArray(brief.visualConcepts) || brief.visualConcepts.length !== 2) {
    errors.push(`${itemLabel}.brief.visualConcepts moet exact twee nuttige visualconcepten bevatten.`);
  }
}

function validateSeoMachineBacklog(backlog, options = {}) {
  const errors = [];
  const existingPaths = options.existingPaths || listExistingSeoContentPaths();
  if (!isObject(backlog)) {
    return { ok: false, errors: ['Backlog-root moet een object zijn.'], summary: null };
  }
  if (backlog.version !== 1) errors.push('Backlog version moet 1 zijn.');
  if (!isIsoDate(backlog.updatedAt)) errors.push('Backlog updatedAt moet YYYY-MM-DD zijn.');
  if (backlog.minimumReady !== MINIMUM_READY_ITEMS) {
    errors.push(`Backlog minimumReady moet ${MINIMUM_READY_ITEMS} zijn.`);
  }
  if (backlog.minimumCommercialShare !== MINIMUM_COMMERCIAL_SHARE) {
    errors.push(`Backlog minimumCommercialShare moet ${MINIMUM_COMMERCIAL_SHARE} zijn.`);
  }
  if (JSON.stringify(backlog.scoreFormula) !== JSON.stringify(SCORE_FORMULA)) {
    errors.push(`Backlog scoreFormula wijkt af van ${SCORE_FORMULA.version}.`);
  }
  if (!Array.isArray(backlog.items)) errors.push('Backlog items moet een array zijn.');

  const items = Array.isArray(backlog.items) ? backlog.items : [];
  const seenIds = new Set();
  const seenPaths = new Set();
  items.forEach((item, itemIndex) => {
    const itemLabel = `items[${itemIndex}]`;
    if (!isObject(item)) {
      errors.push(`${itemLabel} moet een object zijn.`);
      return;
    }
    for (const field of [
      'id',
      'status',
      'path',
      'contentType',
      'cluster',
      'primaryQuery',
      'intent',
      'intentClass',
      'funnelStage',
      'targetMoneyPage',
      'clusterRole',
      'nextAction',
    ]) {
      if (!isNonEmptyString(item[field])) errors.push(`${itemLabel}.${field} ontbreekt.`);
    }
    if (seenIds.has(item.id)) errors.push(`${itemLabel}.id is dubbel: ${item.id}.`);
    if (seenPaths.has(item.path)) errors.push(`${itemLabel}.path is dubbel: ${item.path}.`);
    seenIds.add(item.id);
    seenPaths.add(item.path);
    if (!ALLOWED_STATUSES.has(item.status)) errors.push(`${itemLabel}.status is ongeldig: ${item.status}.`);
    if (!isPublicPath(item.path)) errors.push(`${itemLabel}.path is geen geldige publieke URL.`);
    if (existingPaths.has(item.path) && item.status !== 'shipped') {
      errors.push(`${itemLabel}.path bestaat al live of gepland: ${item.path}.`);
    }
    if (!Object.hasOwn(SEO_CONTENT_COLLECTIONS, item.contentType)) {
      errors.push(`${itemLabel}.contentType is onbekend: ${item.contentType}.`);
    }
    if (!ALLOWED_FUNNEL_STAGES.has(item.funnelStage)) {
      errors.push(`${itemLabel}.funnelStage is ongeldig: ${item.funnelStage}.`);
    }
    if (!isPublicPath(item.targetMoneyPage)) {
      errors.push(`${itemLabel}.targetMoneyPage is geen geldige publieke URL.`);
    }
    validateEvidence(item, itemLabel, errors);
    validateOverlap(item, itemLabel, errors, existingPaths);
    validateScoreFields(item, itemLabel, errors);
    validateBrief(item, itemLabel, errors);
  });

  const readyItems = items.filter((item) => item && item.status === READY_STATUS);
  const commercialReadyItems = readyItems.filter((item) => COMMERCIAL_INTENT_CLASSES.has(item.intentClass));
  const commercialShare = readyItems.length ? commercialReadyItems.length / readyItems.length : 0;
  if (readyItems.length < MINIMUM_READY_ITEMS) {
    errors.push(`Backlog heeft ${readyItems.length} ready items; minimaal ${MINIMUM_READY_ITEMS} vereist.`);
  }
  if (commercialShare < MINIMUM_COMMERCIAL_SHARE) {
    errors.push(
      `Commercieel aandeel is ${roundScore(commercialShare * 100)}%; minimaal ${MINIMUM_COMMERCIAL_SHARE * 100}% vereist.`
    );
  }

  const sortedReadyItems = [...readyItems].sort((a, b) => {
    return Number(b.weightedScore || 0) - Number(a.weightedScore || 0) || String(a.id).localeCompare(String(b.id));
  });
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      total: items.length,
      ready: readyItems.length,
      commercialReady: commercialReadyItems.length,
      commercialShare: roundScore(commercialShare),
      topReady: sortedReadyItems.slice(0, 5).map((item) => ({
        id: item.id,
        path: item.path,
        score: item.weightedScore,
        primaryQuery: item.primaryQuery,
      })),
    },
  };
}

function assertSeoMachineBacklog(backlog, options = {}) {
  const result = validateSeoMachineBacklog(backlog, options);
  if (!result.ok) {
    const error = new Error(result.errors.join('\n'));
    error.result = result;
    throw error;
  }
  return result;
}

module.exports = {
  COMMERCIAL_INTENT_CLASSES,
  DEFAULT_BACKLOG_PATH,
  MINIMUM_COMMERCIAL_SHARE,
  MINIMUM_READY_ITEMS,
  SCORE_FORMULA,
  assertSeoMachineBacklog,
  calculateSeoCandidateScore,
  listExistingSeoContentPaths,
  loadSeoMachineBacklog,
  validateSeoMachineBacklog,
};
