const DEFAULT_WEEKLY_MINIMUM = 5;
const MINIMUM_REVIEWABLE_INDEXATION_SAMPLE = 5;
const INDEXATION_RECOVERY_THRESHOLD = 0.6;
const SCALE_INDEXATION_THRESHOLD = 0.8;

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

function evaluateSeoMachineState({
  backlogResult,
  ledger,
  indexation,
  quality,
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
    return {
      state: 'operations_p0',
      status: 'p0',
      color: 'red',
      exitCode: 1,
      action: 'repair_blocking_operations',
      publicActionRequired: false,
      maximumNewUrlsPerWeek: 0,
      reasons: operationErrors,
      nextCandidate: null,
    };
  }

  const weeklyWindow = ledger.windows && ledger.windows['7'];
  const qualifying = toNumber(weeklyWindow && weeklyWindow.qualifying);
  const deficit = Math.max(0, weeklyMinimum - qualifying);
  const reviewable = buildReviewableIndexation(indexation && indexation.summary);
  const requestEvidenceDue = toNumber(indexation && indexation.summary && indexation.summary.requestEvidenceDue);
  const nextCandidate = backlogResult.summary?.topReady?.[0] || null;
  const shared = { qualifying, weeklyMinimum, deficit, reviewable, requestEvidenceDue, nextCandidate };

  if (!indexation || !['ready', 'partial'].includes(indexation.status)) {
    return {
      ...shared,
      state: 'data_degraded',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'repair_measurement_and_ship_only_evidence_backed_safe_improvement',
      publicActionRequired: true,
      maximumNewUrlsPerWeek: 2,
      reasons: (indexation && indexation.errors) || ['URL Inspection-data ontbreekt.'],
    };
  }

  if (
    reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate < INDEXATION_RECOVERY_THRESHOLD
  ) {
    return {
      ...shared,
      state: 'indexation_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'improve_discovery_quality_internal_links_or_consolidate',
      publicActionRequired: true,
      maximumNewUrlsPerWeek: 2,
      reasons: [`Reviewbare D14/D28-indexatie is ${reviewable.indexed}/${reviewable.inspected}.`],
    };
  }

  if (quality && quality.status === 'quality_recovery') {
    return {
      ...shared,
      state: 'quality_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'replace_template_content_with_unique_information_or_consolidate',
      publicActionRequired: true,
      maximumNewUrlsPerWeek: 3,
      reasons: quality.reasons || ['Contentoriginaliteit is onvoldoende.'],
    };
  }

  if (deficit > 0) {
    return {
      ...shared,
      state: 'growth',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'publish_highest_expected_qualified_value_candidate',
      publicActionRequired: true,
      maximumNewUrlsPerWeek: 5,
      reasons: [`Publicatielevering loopt ${deficit} achter op het gezonde groeiritme.`],
    };
  }

  const canScale = reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate >= SCALE_INDEXATION_THRESHOLD;
  return {
    ...shared,
    state: canScale ? 'scale' : 'growth',
    status: 'on_track',
    color: 'green',
    exitCode: 0,
    action: 'choose_highest_expected_qualified_impact',
    publicActionRequired: true,
    maximumNewUrlsPerWeek: canScale ? 7 : 5,
    reasons: [],
  };
}

module.exports = {
  DEFAULT_WEEKLY_MINIMUM,
  INDEXATION_RECOVERY_THRESHOLD,
  MINIMUM_REVIEWABLE_INDEXATION_SAMPLE,
  SCALE_INDEXATION_THRESHOLD,
  buildReviewableIndexation,
  evaluateSeoMachineState,
};
