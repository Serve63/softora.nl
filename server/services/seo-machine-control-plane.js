const { PUBLICATION_LANES } = require('./seo-machine-publication-lanes');
const { validatePublicationWindowPolicy } = require('./seo-machine-publication-ledger');

const DEFAULT_WEEKLY_MINIMUM = 7;
const MINIMUM_REVIEWABLE_INDEXATION_SAMPLE = 5;
const INDEXATION_RECOVERY_THRESHOLD = 0.6;
const SCALE_INDEXATION_THRESHOLD = 0.8;
const PUBLICATION_LANE_LIMITS = Object.freeze({
  weeklyGrowthUrlTarget: 7,
  weeklyEditorialMinimum: 0,
  weeklyMoneyPageMaximum: 2,
});
const REQUIRED_SUPPORTING_ACTIONS = Object.freeze([
  'full_preflight_and_measurement_checks',
  'indexation_and_discovery_review',
  'contextual_internal_links',
  'evidence_backed_existing_page_optimization',
]);

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildReviewableIndexation(summary = {}) {
  const cohorts = [summary.d14, summary.d28].filter(Boolean);
  const inspected = cohorts.reduce((total, cohort) => total + toNumber(cohort.inspected), 0);
  const indexed = cohorts.reduce((total, cohort) => total + toNumber(cohort.indexed), 0);
  return {
    inspected,
    indexed,
    rate: inspected ? Math.round((indexed / inspected) * 1000) / 1000 : null,
  };
}

function highestScoringCandidate(candidates = []) {
  return [...candidates].filter(Boolean).sort((a, b) => (
    toNumber(b.score) - toNumber(a.score) || String(a.id || '').localeCompare(String(b.id || ''))
  ))[0] || null;
}

function selectNextNewUrlCandidate(backlogSummary = {}, requiredPublicationLane, moneyPageAllowed) {
  const editorial = backlogSummary.topReadyEditorial?.[0] || null;
  if (requiredPublicationLane === PUBLICATION_LANES.EDITORIAL) return editorial;
  const moneyPage = moneyPageAllowed ? backlogSummary.topReadyMoneyPages?.[0] : null;
  return highestScoringCandidate([editorial, moneyPage]);
}

function applyDailyPublicationPolicy(stateResult, shared = {}, backlogSummary = {}) {
  const operationsP0 = stateResult.state === 'operations_p0';
  const growthNewUrls = toNumber(shared.growthNewUrls, toNumber(shared.newUrls));
  const editorialNewUrls = toNumber(shared.editorialNewUrls);
  const moneyPageNewUrls = toNumber(shared.moneyPageNewUrls);
  const maximumNewUrlsPerWeek = PUBLICATION_LANE_LIMITS.weeklyGrowthUrlTarget;
  const moneyPageCapacity = Math.max(0, PUBLICATION_LANE_LIMITS.weeklyMoneyPageMaximum - moneyPageNewUrls);
  const newUrlAllowed = !operationsP0 && growthNewUrls < maximumNewUrlsPerWeek;
  const moneyPageAllowed = newUrlAllowed && moneyPageCapacity > 0;
  // These targets are planning guidance, never a reason to skip a stronger GSC opportunity.
  const targetNewUrlsPerWeek = operationsP0 ? 0 : stateResult.state === 'scale' ? 7 : stateResult.state === 'growth' ? 3 : 2;
  return {
    ...shared,
    ...stateResult,
    publicationStrategy: 'opportunity_first',
    growthNewUrls,
    editorialNewUrls,
    moneyPageNewUrls,
    minimumNewUrlsPerWeek: 0,
    minimumEditorialNewUrlsPerWeek: 0,
    maximumNewUrlsPerWeek,
    maximumMoneyPageNewUrlsPerWeek: PUBLICATION_LANE_LIMITS.weeklyMoneyPageMaximum,
    targetNewUrlsPerWeek,
    newUrlTargetGap: Math.max(0, targetNewUrlsPerWeek - growthNewUrls),
    newUrlDeficit: 0,
    editorialNewUrlDeficit: 0,
    moneyPageCapacity,
    moneyPageCapReached: moneyPageCapacity === 0,
    moneyPageAllowed,
    newUrlAllowed,
    newUrlRequired: false,
    requiredPublicationLane: null,
    allowedPublicationLanes: newUrlAllowed
      ? [PUBLICATION_LANES.EDITORIAL, ...(moneyPageAllowed ? [PUBLICATION_LANES.MONEY_PAGE] : [])]
      : [],
    supportingOptimizationRequired: !operationsP0,
    requiredSupportingActions: operationsP0 ? [] : [...REQUIRED_SUPPORTING_ACTIONS],
    companionAction: !operationsP0 ? stateResult.action : null,
    nextCandidate: newUrlAllowed
      ? selectNextNewUrlCandidate(backlogSummary, null, moneyPageAllowed)
      : null,
  };
}

function evaluateSeoMachineState({
  backlogResult,
  ledger,
  indexation,
  quality,
  performance,
  weeklyMinimum = DEFAULT_WEEKLY_MINIMUM,
} = {}) {
  const operationErrors = [];
  if (!backlogResult || !backlogResult.ok) {
    operationErrors.push(...((backlogResult && backlogResult.errors) || ['Backlogvalidatie ontbreekt.']));
  }
  if (!ledger || ledger.status !== 'ready') {
    operationErrors.push(...((ledger && ledger.errors) || ['Live publicatieledger ontbreekt.']));
  }
  if (operationErrors.length) {
    return applyDailyPublicationPolicy({
      state: 'operations_p0',
      status: 'p0',
      color: 'red',
      exitCode: 1,
      action: 'repair_blocking_operations',
      publicActionRequired: false,
      reasons: operationErrors,
      nextCandidate: null,
    }, {}, backlogResult && backlogResult.summary);
  }

  const weeklyWindow = ledger.windows && ledger.windows['7'];
  const qualifying = toNumber(weeklyWindow && weeklyWindow.qualifying);
  const newUrls = toNumber(
    weeklyWindow && weeklyWindow.newUrls,
    qualifying
  );
  const editorialNewUrls = toNumber(weeklyWindow && weeklyWindow.editorialNewUrls);
  const moneyPageNewUrls = toNumber(weeklyWindow && weeklyWindow.moneyPageNewUrls);
  const growthNewUrls = toNumber(
    weeklyWindow && weeklyWindow.growthNewUrls,
    editorialNewUrls + moneyPageNewUrls || newUrls
  );
  const otherNewUrls = toNumber(weeklyWindow && weeklyWindow.otherNewUrls);
  const unclassifiedNewUrls = toNumber(weeklyWindow && weeklyWindow.unclassifiedNewUrls);
  const substantialRefreshes = toNumber(weeklyWindow && weeklyWindow.substantialRefreshes);
  const otherGrowthActions = toNumber(weeklyWindow && weeklyWindow.otherGrowthActions);
  const deficit = Math.max(0, weeklyMinimum - qualifying);
  const reviewable = buildReviewableIndexation(indexation && indexation.summary);
  const requestEvidenceDue = toNumber(indexation && indexation.summary && indexation.summary.requestEvidenceDue);
  const nextCandidate = backlogResult.summary?.topReady?.[0] || null;
  const shared = {
    qualifying,
    newUrls,
    growthNewUrls,
    editorialNewUrls,
    moneyPageNewUrls,
    otherNewUrls,
    unclassifiedNewUrls,
    substantialRefreshes,
    otherGrowthActions,
    weeklyMinimum,
    deficit,
    reviewable,
    requestEvidenceDue,
    nextCandidate,
    performance,
  };
  const publicationPolicyErrors = validatePublicationWindowPolicy({
    days: 7,
    growthNewUrls,
    moneyPageNewUrls,
    moneyPageMaximum: PUBLICATION_LANE_LIMITS.weeklyMoneyPageMaximum,
    targetMaximum: PUBLICATION_LANE_LIMITS.weeklyGrowthUrlTarget,
  });
  if (publicationPolicyErrors.length) {
    return applyDailyPublicationPolicy({
      state: 'operations_p0',
      status: 'p0',
      color: 'red',
      exitCode: 1,
      action: 'repair_publication_policy_breach',
      publicActionRequired: false,
      reasons: publicationPolicyErrors,
      nextCandidate: null,
    }, shared, backlogResult.summary);
  }

  if (!indexation || !['ready', 'partial'].includes(indexation.status)) {
    return applyDailyPublicationPolicy({
      state: 'data_degraded',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'repair_measurement_and_ship_only_evidence_backed_safe_improvement',
      publicActionRequired: true,
      reasons: (indexation && indexation.errors) || ['URL Inspection-data ontbreekt.'],
    }, shared, backlogResult.summary);
  }

  if (!performance || performance.status === 'data_degraded') {
    return applyDailyPublicationPolicy({
      state: 'data_degraded',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'repair_measurement_and_ship_only_evidence_backed_safe_improvement',
      publicActionRequired: true,
      reasons: (performance && performance.reasons) || ['Non-branded GSC-paginadata voor publicatiecohorten ontbreekt.'],
    }, shared, backlogResult.summary);
  }

  if (
    reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate < INDEXATION_RECOVERY_THRESHOLD
  ) {
    return applyDailyPublicationPolicy({
      state: 'indexation_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'improve_discovery_quality_internal_links_or_consolidate',
      publicActionRequired: true,
      reasons: [`Reviewbare D14/D28-indexatie is ${reviewable.indexed}/${reviewable.inspected}.`],
    }, shared, backlogResult.summary);
  }

  if (performance.status === 'performance_recovery') {
    return applyDailyPublicationPolicy({
      state: 'performance_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'improve_query_page_match_snippets_internal_routes_or_consolidate',
      publicActionRequired: true,
      reasons: performance.reasons || ['De D28-publicatiecohort levert onvoldoende non-branded zoeksignalen.'],
    }, shared, backlogResult.summary);
  }

  if (quality && quality.status === 'quality_recovery') {
    return applyDailyPublicationPolicy({
      state: 'quality_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'replace_template_content_with_unique_information_or_consolidate',
      publicActionRequired: true,
      reasons: quality.reasons || ['Contentoriginaliteit is onvoldoende.'],
    }, shared, backlogResult.summary);
  }

  if (deficit > 0) {
    return applyDailyPublicationPolicy({
      state: 'growth',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'publish_highest_expected_qualified_value_candidate',
      publicActionRequired: true,
      reasons: [`Publicatielevering loopt ${deficit} achter op het gezonde groeiritme.`],
    }, shared, backlogResult.summary);
  }

  const canScale = reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate >= SCALE_INDEXATION_THRESHOLD
    && performance.status === 'scale_ready';
  return applyDailyPublicationPolicy({
    state: canScale ? 'scale' : 'growth',
    status: 'on_track',
    color: 'green',
    exitCode: 0,
    action: 'choose_highest_expected_qualified_impact',
    publicActionRequired: true,
    reasons: [],
  }, shared, backlogResult.summary);
}

module.exports = {
  DEFAULT_WEEKLY_MINIMUM,
  INDEXATION_RECOVERY_THRESHOLD,
  MINIMUM_REVIEWABLE_INDEXATION_SAMPLE,
  PUBLICATION_LANE_LIMITS,
  REQUIRED_SUPPORTING_ACTIONS,
  SCALE_INDEXATION_THRESHOLD,
  buildReviewableIndexation,
  evaluateSeoMachineState,
  selectNextNewUrlCandidate,
};
