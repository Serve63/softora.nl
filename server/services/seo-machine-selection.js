const path = require('node:path');
const { PUBLICATION_LANES } = require('./seo-machine-publication-lanes');
const { isSeoAutomationExcludedPath } = require('./seo-machine-route-policy');

const SELECTION_SCHEMA_VERSION = 1;
const MIN_PRIORITIZED_REVIEWS = 3;
const SELECTION_REPORT_MAX_AGE_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const ALLOWED_SOURCES = new Set([
  'gsc_prioritized',
  'canonical_backlog',
  'indexation_finding',
  'quality_finding',
  'conversion_finding',
  'technical_finding',
]);
const ALLOWED_DECISIONS = new Set(['selected', 'skipped']);
const ALLOWED_ACTION_TYPES = new Set(['new_url', 'substantial_refresh', 'other_growth_action']);
const ALLOWED_SKIP_REASONS = new Set([
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
const ALLOWED_SUPPORTING_VERIFICATION_KINDS = new Set([
  'link_to_selected_url',
  'link_present',
  'text_present',
  'title_equals',
  'meta_description_equals',
]);
const SUPPORTING_VERIFICATION_BY_ACTION = Object.freeze({
  contextual_internal_link: new Set(['link_to_selected_url']),
  existing_page_refresh: new Set(['link_present', 'text_present', 'title_equals', 'meta_description_equals']),
  query_page_match: new Set(['link_present', 'text_present', 'title_equals', 'meta_description_equals']),
  snippet_improvement: new Set(['title_equals', 'meta_description_equals']),
  discovery_or_indexation_improvement: new Set(['link_to_selected_url', 'link_present', 'text_present']),
  conversion_improvement: new Set(['link_present', 'text_present']),
});

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

function opportunityPath(value) {
  try {
    const parsed = new URL(normalizeText(value), 'https://www.softora.nl');
    if (!['softora.nl', 'www.softora.nl'].includes(parsed.hostname) || parsed.search || parsed.hash) return '';
    return normalizePublicPath(parsed.pathname);
  } catch { return ''; }
}

function sameOpportunity(review, opportunity) {
  const page = opportunityPath(review?.page);
  return Boolean(page) && normalizeComparable(review?.query) === normalizeComparable(opportunity?.query)
    && page === opportunityPath(opportunity?.page);
}

function normalizePublicPath(value) {
  const raw = normalizeText(value);
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  try {
    const parsed = new URL(raw, 'https://www.softora.nl');
    if (parsed.origin !== 'https://www.softora.nl' || parsed.search || parsed.hash) return '';
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

function normalizeKnownPublicPaths(value) {
  if (!(value instanceof Set) && !Array.isArray(value)) return null;
  return new Set([...value].map(normalizePublicPath).filter(Boolean));
}

function validateSupportingVerification(supportingAction, errors) {
  const verification = supportingAction.verification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    errors.push('selected.supportingAction.verification ontbreekt.');
    return;
  }
  const kind = normalizeText(verification.kind);
  if (!ALLOWED_SUPPORTING_VERIFICATION_KINDS.has(kind)) {
    errors.push('selected.supportingAction.verification.kind is ongeldig.');
    return;
  }
  const allowedKinds = SUPPORTING_VERIFICATION_BY_ACTION[normalizeText(supportingAction.type)];
  if (allowedKinds && !allowedKinds.has(kind)) {
    errors.push(`selected.supportingAction.verification.kind ${kind} past niet bij type ${supportingAction.type}.`);
  }
  if (kind === 'link_to_selected_url') return;
  const value = normalizeText(verification.value);
  if (kind === 'link_present' && !normalizePublicPath(value)) {
    errors.push('selected.supportingAction.verification.value moet voor link_present een publieke Softora-route zijn.');
  } else if (kind === 'link_present' && isSeoAutomationExcludedPath(value)) {
    errors.push(`selected.supportingAction.verification.value valt buiten de SEO-automation: ${normalizePublicPath(value)}.`);
  } else if (kind === 'text_present' && value.length < 12) {
    errors.push('selected.supportingAction.verification.value is te vaag voor text_present.');
  } else if (kind === 'title_equals' && value.length < 10) {
    errors.push('selected.supportingAction.verification.value is te kort voor title_equals.');
  } else if (kind === 'meta_description_equals' && value.length < 30) {
    errors.push('selected.supportingAction.verification.value is te kort voor meta_description_equals.');
  }
}

function validateSupportingAction(selected, errors, options = {}) {
  const supportingAction = selected.supportingAction;
  if (!supportingAction || typeof supportingAction !== 'object') {
    errors.push('selected.supportingAction op een bestaande publieke pagina ontbreekt.');
    return;
  }
  if (!ALLOWED_SUPPORTING_ACTION_TYPES.has(normalizeText(supportingAction.type))) {
    errors.push('selected.supportingAction.type is ongeldig.');
  }
  const supportingPath = normalizePublicPath(supportingAction.path);
  if (!supportingPath) {
    errors.push('selected.supportingAction.path moet een publieke Softora-route zijn.');
  } else if (isSeoAutomationExcludedPath(supportingPath)) {
    errors.push(`selected.supportingAction.path valt buiten de SEO-automation: ${supportingPath}.`);
  }
  if (supportingPath && supportingPath === normalizePublicPath(selected.path)) {
    errors.push('selected.supportingAction.path moet een bestaande andere pagina versterken.');
  }
  const knownPublicPaths = normalizeKnownPublicPaths(options.knownPublicPaths);
  if (!knownPublicPaths) {
    errors.push('De canonieke publieke inventaris ontbreekt; supportingAction kan niet veilig worden gevalideerd.');
  } else if (supportingPath && !knownPublicPaths.has(supportingPath)) {
    errors.push(`selected.supportingAction.path staat niet in de canonieke publieke inventaris: ${supportingPath}.`);
  }
  if (normalizeText(supportingAction.evidence).length < 20) {
    errors.push('selected.supportingAction.evidence mist controleerbare onderbouwing.');
  }
  validateSupportingVerification(supportingAction, errors);
}

function validateSelectedAction(selected, evidence, errors, options = {}) {
  if (!selected || typeof selected !== 'object') {
    errors.push('selected ontbreekt.');
    return;
  }
  if (!ALLOWED_SOURCES.has(normalizeText(selected.source))) errors.push('selected.source is ongeldig.');
  const selectedPath = normalizePublicPath(selected.path);
  if (!selectedPath) errors.push('selected.path moet een publieke Softora-route zijn.');
  if (selectedPath && isSeoAutomationExcludedPath(selectedPath)) {
    errors.push(`selected.path valt buiten de SEO-automation: ${selectedPath}.`);
  }
  const targetMoneyPage = normalizePublicPath(selected.targetMoneyPage);
  if (targetMoneyPage && isSeoAutomationExcludedPath(targetMoneyPage)) {
    errors.push(`selected.targetMoneyPage valt buiten de SEO-automation: ${targetMoneyPage}.`);
  }
  const actionType = normalizeText(selected.actionType);
  if (!ALLOWED_ACTION_TYPES.has(actionType)) errors.push('selected.actionType is ongeldig.');
  if (normalizeText(selected.buyerTask).length < 12) errors.push('selected.buyerTask is te vaag.');
  if (normalizeText(selected.expectedQualifiedImpact).length < 20) {
    errors.push('selected.expectedQualifiedImpact mist concrete kwalificatie-impact.');
  }
  if (normalizeText(selected.selectionEvidence).length < 20) {
    errors.push('selected.selectionEvidence mist controleerbaar vergelijkingsbewijs.');
  }
  validateSupportingAction(selected, errors, options);
  const knownPublicPaths = normalizeKnownPublicPaths(options.knownPublicPaths);
  const readyBacklogPaths = normalizeKnownPublicPaths(options.readyBacklogPaths);
  if (actionType !== 'new_url') {
    if (!knownPublicPaths) {
      errors.push('De canonieke publieke inventaris ontbreekt; selected.path kan niet veilig worden gevalideerd.');
    } else if (selectedPath && !knownPublicPaths.has(selectedPath)) {
      errors.push(`selected.path staat niet in de canonieke publieke inventaris: ${selectedPath}.`);
    }
    return;
  }
  if (knownPublicPaths && selectedPath && knownPublicPaths.has(selectedPath)) {
    errors.push(`Een new_url bestaat al in de canonieke publieke inventaris: ${selectedPath}.`);
  }
  if (!readyBacklogPaths) {
    errors.push('De canonieke ready backlog ontbreekt; new_url kan niet veilig worden gevalideerd.');
  } else if (selectedPath && !readyBacklogPaths.has(selectedPath)) {
    errors.push(`selected.path is geen ready kandidaat in de canonieke backlog: ${selectedPath}.`);
  }

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

function validateSelectionEvidence(evidence = {}, report = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const prioritized = Array.isArray(report?.queries?.prioritized) ? report.queries.prioritized : [];
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowTime = now.getTime();
  const evidenceTime = new Date(evidence.generatedAt).getTime();
  const reportTime = new Date(report.generatedAt).getTime();

  if (Number(evidence.schemaVersion) !== SELECTION_SCHEMA_VERSION) errors.push('schemaVersion moet 1 zijn.');
  if (!isValidDateTime(evidence.generatedAt)) errors.push('generatedAt ontbreekt of is ongeldig.');
  if (
    isValidDateTime(evidence.generatedAt)
    && (evidenceTime > nowTime + CLOCK_SKEW_MS || nowTime - evidenceTime > SELECTION_REPORT_MAX_AGE_MS)
  ) {
    errors.push('generatedAt valt buiten het verse selectievenster van 30 minuten.');
  }
  if (report.status !== 'ready') errors.push('Het gekoppelde GSC-rapport is niet ready.');
  for (const opportunity of prioritized) {
    if (isSeoAutomationExcludedPath(opportunity?.page)) {
      errors.push(`Het GSC-rapport bevat een uitgesloten SEO-route in queries.prioritized: ${normalizePublicPath(opportunity.page)}.`);
    }
  }
  if (!isValidDateTime(report.generatedAt)) errors.push('Het gekoppelde GSC-rapport mist generatedAt.');
  if (
    isValidDateTime(report.generatedAt)
    && (reportTime > nowTime + CLOCK_SKEW_MS || nowTime - reportTime > SELECTION_REPORT_MAX_AGE_MS)
  ) {
    errors.push('Het gekoppelde GSC-rapport is ouder dan 30 minuten of ligt in de toekomst.');
  }
  if (isValidDateTime(evidence.generatedAt) && isValidDateTime(report.generatedAt) && evidenceTime < reportTime) {
    errors.push('generatedAt van het selectiebewijs ligt voor het gekoppelde GSC-rapport.');
  }
  if (normalizeText(evidence?.sourceReport?.generatedAt) !== normalizeText(report.generatedAt)) {
    errors.push('sourceReport.generatedAt wijkt af van het actuele GSC-rapport.');
  }
  if (!isSafeRelativePath(evidence?.sourceReport?.path)) {
    errors.push('sourceReport.path moet een veilig relatief repopad zijn.');
  } else if (
    options.reportPath
    && normalizeText(evidence.sourceReport.path) !== normalizeText(options.reportPath)
  ) {
    errors.push('sourceReport.path wijkt af van het werkelijk ingelezen GSC-rapport.');
  }
  if (!normalizeText(evidence.machineState)) errors.push('machineState ontbreekt.');
  if (evidence.controlPlane?.newUrlRequired === true || Number(evidence.controlPlane?.newUrlDeficit) > 0) {
    errors.push('De opportunity-first strategie kent geen bindende nieuwe-URL-vloer.');
  }
  if (options.controlPlane) {
    for (const field of ['moneyPageAllowed', 'moneyPageNewUrls', 'maximumMoneyPageNewUrlsPerWeek', 'allowedPublicationLanes']) {
      if (JSON.stringify(evidence.controlPlane?.[field]) !== JSON.stringify(options.controlPlane[field])) {
        errors.push(`controlPlane.${field} wijkt af van de cadence-receipt van deze invocation.`);
      }
    }
  }
  validateSelectedAction(evidence.selected, evidence, errors, options);

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
    for (const closestUrl of Array.isArray(review?.closestUrls) ? review.closestUrls : []) {
      if (isSeoAutomationExcludedPath(closestUrl)) {
        errors.push(`prioritizedReview rank ${index + 1} vergelijkt met een uitgesloten SEO-route: ${normalizePublicPath(closestUrl)}.`);
      }
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
        path: normalizePublicPath(evidence.selected.supportingAction.path) || null,
        verification: evidence.selected.supportingAction.verification ? {
          kind: normalizeText(evidence.selected.supportingAction.verification.kind) || null,
          value: normalizeText(evidence.selected.supportingAction.verification.value) || null,
        } : null,
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
  ALLOWED_ACTION_TYPES,
  ALLOWED_SKIP_REASONS,
  ALLOWED_SUPPORTING_ACTION_TYPES,
  ALLOWED_SUPPORTING_VERIFICATION_KINDS,
  MIN_PRIORITIZED_REVIEWS,
  SELECTION_REPORT_MAX_AGE_MS,
  SELECTION_SCHEMA_VERSION,
  isSafeRelativePath,
  normalizePublicPath,
  validateSelectionEvidence,
};
