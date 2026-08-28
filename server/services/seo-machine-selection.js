const path = require('node:path');
const { PUBLICATION_LANES } = require('./seo-machine-publication-lanes');

const SELECTION_SCHEMA_VERSION = 1;
const MIN_PRIORITIZED_REVIEWS = 3;
const ALLOWED_SOURCES = new Set([
  'gsc_prioritized',
  'canonical_backlog',
  'indexation_finding',
  'quality_finding',
  'conversion_finding',
  'technical_finding',
]);
const ALLOWED_DECISIONS = new Set(['selected', 'skipped']);
const ALLOWED_SKIP_REASONS = new Set([
  'binding_new_url_floor',
  'recent_material_change',
  'protect_proven_winner',
  'intent_mismatch',
  'cannibalization_or_overlap',
  'claim_or_expertise_risk',
  'not_safe_or_not_ready',
  'higher_qualified_impact',
  'operations_or_safety_p0',
  'external_merge_or_deploy_blocker',
]);
const RECENCY_SKIP_REASONS = new Set(['recent_material_change', 'protect_proven_winner']);
const ALLOWED_SUPPORTING_ACTION_TYPES = new Set([
  'contextual_internal_link',
  'existing_page_refresh',
  'query_page_match',
  'snippet_improvement',
  'discovery_or_indexation_improvement',
  'conversion_improvement',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLocaleLowerCase('nl-NL');
}

function isValidDateTime(value) {
  return Boolean(normalizeText(value)) && Number.isFinite(new Date(value).getTime());
}

function isSafeRelativePath(value) {
  const normalized = normalizeText(value);
  if (!normalized || path.isAbsolute(normalized)) return false;
  return !normalized.split(/[\\/]+/).includes('..');
}

function sameOpportunity(review, opportunity) {
  return normalizeComparable(review?.query) === normalizeComparable(opportunity?.query)
    && normalizeComparable(review?.page) === normalizeComparable(opportunity?.page);
}

function validateSupportingAction(selected, errors) {
  const supportingAction = selected.supportingAction;
  if (!supportingAction || typeof supportingAction !== 'object') {
    errors.push('Een nieuwe URL vereist selected.supportingAction op een bestaande publieke pagina.');
    return;
  }
  if (!ALLOWED_SUPPORTING_ACTION_TYPES.has(normalizeText(supportingAction.type))) {
    errors.push('selected.supportingAction.type is ongeldig.');
  }
  if (!normalizeText(supportingAction.path).startsWith('/')) {
    errors.push('selected.supportingAction.path moet een publieke Softora-route zijn.');
  }
  if (normalizeText(supportingAction.path) === normalizeText(selected.path)) {
    errors.push('selected.supportingAction.path moet een bestaande andere pagina versterken.');
  }
  if (normalizeText(supportingAction.evidence).length < 20) {
    errors.push('selected.supportingAction.evidence mist controleerbare onderbouwing.');
  }
}

function validateSelectedAction(selected, evidence, errors) {
  if (!selected || typeof selected !== 'object') {
    errors.push('selected ontbreekt.');
    return;
  }
  if (!ALLOWED_SOURCES.has(normalizeText(selected.source))) errors.push('selected.source is ongeldig.');
  if (!normalizeText(selected.path)) errors.push('selected.path ontbreekt.');
  if (!normalizeText(selected.actionType)) errors.push('selected.actionType ontbreekt.');
  if (normalizeText(selected.buyerTask).length < 12) errors.push('selected.buyerTask is te vaag.');
  if (normalizeText(selected.expectedQualifiedImpact).length < 20) {
    errors.push('selected.expectedQualifiedImpact mist concrete kwalificatie-impact.');
  }
  if (normalizeText(selected.selectionEvidence).length < 20) {
    errors.push('selected.selectionEvidence mist controleerbaar vergelijkingsbewijs.');
  }
  if (normalizeText(selected.actionType) !== 'new_url') return;

  const publicationLane = normalizeText(selected.publicationLane);
  if (![PUBLICATION_LANES.EDITORIAL, PUBLICATION_LANES.MONEY_PAGE].includes(publicationLane)) {
    errors.push('Een nieuwe URL vereist publicationLane editorial of money_page.');
  }
  const controlPlane = evidence.controlPlane || {};
  if (
    normalizeText(controlPlane.requiredPublicationLane)
    && publicationLane !== normalizeText(controlPlane.requiredPublicationLane)
  ) {
    errors.push(`De cadence vereist publicationLane ${controlPlane.requiredPublicationLane}.`);
  }
  if (
    Array.isArray(controlPlane.allowedPublicationLanes)
    && !controlPlane.allowedPublicationLanes.includes(publicationLane)
  ) {
    errors.push(`publicationLane ${publicationLane} is niet toegestaan door de cadence.`);
  }
  if (
    publicationLane === PUBLICATION_LANES.MONEY_PAGE
    && (
      controlPlane.moneyPageAllowed !== true
      || Number(controlPlane.moneyPageNewUrls) >= Number(controlPlane.maximumMoneyPageNewUrlsPerWeek)
    )
  ) {
    errors.push('De rollende geldpagina-cap laat deze nieuwe money page niet toe.');
  }
  validateSupportingAction(selected, errors);
}

function validateSkipEvidence(review, evidence, errors) {
  const reasonCode = normalizeText(review.reasonCode);
  if (!ALLOWED_SKIP_REASONS.has(reasonCode)) {
    errors.push(`prioritizedReview rank ${review.rank} heeft een ongeldige reasonCode.`);
    return;
  }
  if (normalizeText(review.evidence).length < 20) {
    errors.push(`prioritizedReview rank ${review.rank} mist concreet skipbewijs.`);
  }
  if (reasonCode === 'binding_new_url_floor') {
    const controlPlane = evidence.controlPlane || {};
    if (controlPlane.newUrlRequired !== true && Number(controlPlane.newUrlDeficit) <= 0) {
      errors.push(`prioritizedReview rank ${review.rank} claimt een nieuwe-URL-vloer zonder bindend deficit.`);
    }
  }
  if (RECENCY_SKIP_REASONS.has(reasonCode)) {
    if (!isValidDateTime(review.lastChangedAt)) {
      errors.push(`prioritizedReview rank ${review.rank} mist lastChangedAt voor de recency-skip.`);
    }
    if (!isValidDateTime(review.recheckAt)) {
      errors.push(`prioritizedReview rank ${review.rank} mist recheckAt voor de recency-skip.`);
    }
    if (normalizeText(review.changeReference).length < 7) {
      errors.push(`prioritizedReview rank ${review.rank} mist een commit- of PR-referentie.`);
    }
  }
  if (reasonCode === 'cannibalization_or_overlap') {
    if (!Array.isArray(review.closestUrls) || review.closestUrls.length < 3) {
      errors.push(`prioritizedReview rank ${review.rank} mist drie overlap-URL's.`);
    }
  }
  if (reasonCode === 'operations_or_safety_p0' && evidence.machineState !== 'operations_p0') {
    errors.push(`prioritizedReview rank ${review.rank} claimt P0 buiten operations_p0.`);
  }
}

function validateSelectionEvidence(evidence = {}, report = {}) {
  const errors = [];
  const warnings = [];
  const prioritized = Array.isArray(report?.queries?.prioritized) ? report.queries.prioritized : [];

  if (Number(evidence.schemaVersion) !== SELECTION_SCHEMA_VERSION) errors.push('schemaVersion moet 1 zijn.');
  if (!isValidDateTime(evidence.generatedAt)) errors.push('generatedAt ontbreekt of is ongeldig.');
  if (report.status !== 'ready') errors.push('Het gekoppelde GSC-rapport is niet ready.');
  if (!isValidDateTime(report.generatedAt)) errors.push('Het gekoppelde GSC-rapport mist generatedAt.');
  if (normalizeText(evidence?.sourceReport?.generatedAt) !== normalizeText(report.generatedAt)) {
    errors.push('sourceReport.generatedAt wijkt af van het actuele GSC-rapport.');
  }
  if (!isSafeRelativePath(evidence?.sourceReport?.path)) {
    errors.push('sourceReport.path moet een veilig relatief repopad zijn.');
  }
  if (!normalizeText(evidence.machineState)) errors.push('machineState ontbreekt.');
  validateSelectedAction(evidence.selected, evidence, errors);

  const reviews = Array.isArray(evidence.prioritizedReview) ? evidence.prioritizedReview : [];
  const requiredReviewCount = Math.min(MIN_PRIORITIZED_REVIEWS, prioritized.length);
  if (reviews.length < requiredReviewCount) {
    errors.push(`prioritizedReview moet de top ${requiredReviewCount} GSC-kansen afdekken.`);
  }

  for (let index = 0; index < requiredReviewCount; index += 1) {
    const review = reviews[index];
    const opportunity = prioritized[index];
    if (!review || Number(review.rank) !== index + 1) {
      errors.push(`prioritizedReview mist de exacte GSC-rank ${index + 1}.`);
      continue;
    }
    if (!sameOpportunity(review, opportunity)) {
      errors.push(`prioritizedReview rank ${index + 1} wijkt af van query/pagina in GSC.`);
    }
    if (Number(review.opportunityScore) !== Number(opportunity.opportunityScore)) {
      errors.push(`prioritizedReview rank ${index + 1} heeft een afwijkende opportunityScore.`);
    }
    if (!ALLOWED_DECISIONS.has(normalizeText(review.decision))) {
      errors.push(`prioritizedReview rank ${index + 1} heeft een ongeldige decision.`);
    } else if (review.decision === 'skipped') {
      validateSkipEvidence(review, evidence, errors);
    }
  }

  const selectedReviews = reviews.filter((review) => review?.decision === 'selected');
  if (selectedReviews.length > 1) errors.push('prioritizedReview mag maximaal één geselecteerde GSC-kans bevatten.');
  if (evidence?.selected?.source === 'gsc_prioritized') {
    if (selectedReviews.length !== 1) {
      errors.push('Een GSC-selectie vereist exact één decision=selected in prioritizedReview.');
    } else if (!sameOpportunity(selectedReviews[0], {
      query: evidence.selected.query,
      page: evidence.selected.path,
    })) {
      errors.push('De geselecteerde GSC-kans wijkt af van selected.query/path.');
    }
    const selectedIndex = reviews.indexOf(selectedReviews[0]);
    const earlierUnskipped = reviews.slice(0, selectedIndex).find((review) => review?.decision !== 'skipped');
    if (earlierUnskipped) errors.push('Iedere hoger gerankte GSC-kans moet expliciet worden overgeslagen.');
  } else if (selectedReviews.length > 0) {
    errors.push('Een niet-GSC-actie mag geen prioritizedReview-item als selected markeren.');
  }

  if (prioritized.length === 0) {
    warnings.push('Het GSC-rapport bevat geen geprioriteerde querykansen; de fallbackbron moet de keuze dragen.');
  }

  return {
    status: errors.length ? 'blocked' : 'ready',
    errors,
    warnings,
    summary: {
      selectedSource: normalizeText(evidence?.selected?.source) || null,
      selectedPath: normalizeText(evidence?.selected?.path) || null,
      selectedPublicationLane: normalizeText(evidence?.selected?.publicationLane) || null,
      supportingAction: evidence?.selected?.supportingAction ? {
        type: normalizeText(evidence.selected.supportingAction.type) || null,
        path: normalizeText(evidence.selected.supportingAction.path) || null,
      } : null,
      prioritizedAvailable: prioritized.length,
      prioritizedReviewed: Math.min(reviews.length, requiredReviewCount),
      highestOpportunity: prioritized[0] ? {
        query: prioritized[0].query,
        page: prioritized[0].page,
        opportunityScore: prioritized[0].opportunityScore,
        decision: reviews[0]?.decision || null,
        reasonCode: reviews[0]?.reasonCode || null,
      } : null,
    },
  };
}

module.exports = {
  ALLOWED_SKIP_REASONS,
  ALLOWED_SUPPORTING_ACTION_TYPES,
  MIN_PRIORITIZED_REVIEWS,
  SELECTION_SCHEMA_VERSION,
  isSafeRelativePath,
  validateSelectionEvidence,
};
