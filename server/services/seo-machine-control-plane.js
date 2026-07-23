const DEFAULT_WEEKLY_MINIMUM = 5;
const MINIMUM_REVIEWABLE_INDEXATION_SAMPLE = 5;
const INDEXATION_RECOVERY_THRESHOLD = 0.6;
const SCALE_INDEXATION_THRESHOLD = 0.8;
const NEW_URL_LIMITS = Object.freeze({
  operations_p0: Object.freeze({ minimum: 0, maximum: 0 }),
  data_degraded: Object.freeze({ minimum: 1, maximum: 2 }),
  indexation_recovery: Object.freeze({ minimum: 2, maximum: 2 }),
  quality_recovery: Object.freeze({ minimum: 2, maximum: 3 }),
  growth: Object.freeze({ minimum: 3, maximum: 5 }),
  scale: Object.freeze({ minimum: 5, maximum: 7 }),
});

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

function applyNewUrlFloor(stateResult, shared = {}) {
  const limits = NEW_URL_LIMITS[stateResult.state] || NEW_URL_LIMITS.growth;
  const newUrlDeficit = Math.max(0, limits.minimum - toNumber(shared.newUrls));
  const newUrlRequired = stateResult.state !== 'operations_p0' && newUrlDeficit > 0;
  return {
    ...shared,
    ...stateResult,
    minimumNewUrlsPerWeek: limits.minimum,
    maximumNewUrlsPerWeek: limits.maximum,
    newUrlDeficit,
    newUrlRequired,
    status: newUrlRequired ? 'growth_action_required' : stateResult.status,
    color: newUrlRequired ? 'amber' : stateResult.color,
    exitCode: newUrlRequired ? 2 : stateResult.exitCode,
    action: newUrlRequired
      ? 'publish_new_url_from_highest_scoring_safe_ready_candidate'
      : stateResult.action,
    reasons: newUrlRequired
      ? [
        ...(stateResult.reasons || []),
        `Nieuwe-URL-vloer mist ${newUrlDeficit}: ${toNumber(shared.newUrls)}/${limits.minimum} live in 7 dagen.`,
      ]
      : (stateResult.reasons || []),
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
    return applyNewUrlFloor({
      state: 'operations_p0',
      status: 'p0',
      color: 'red',
      exitCode: 1,
      action: 'repair_blocking_operations',
      publicActionRequired: false,
      reasons: operationErrors,
      nextCandidate: null,
    });
  }

  const weeklyWindow = ledger.windows && ledger.windows['7'];
  const qualifying = toNumber(weeklyWindow && weeklyWindow.qualifying);
  const newUrls = toNumber(
    weeklyWindow && weeklyWindow.newUrls,
    qualifying
  );
  const substantialRefreshes = toNumber(weeklyWindow && weeklyWindow.substantialRefreshes);
  const otherGrowthActions = toNumber(weeklyWindow && weeklyWindow.otherGrowthActions);
  const deficit = Math.max(0, weeklyMinimum - qualifying);
  const reviewable = buildReviewableIndexation(indexation && indexation.summary);
  const requestEvidenceDue = toNumber(indexation && indexation.summary && indexation.summary.requestEvidenceDue);
  const nextCandidate = backlogResult.summary?.topReady?.[0] || null;
  const shared = {
    qualifying,
    newUrls,
    substantialRefreshes,
    otherGrowthActions,
    weeklyMinimum,
    deficit,
    reviewable,
    requestEvidenceDue,
    nextCandidate,
  };

  if (!indexation || !['ready', 'partial'].includes(indexation.status)) {
    return applyNewUrlFloor({
      state: 'data_degraded',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'repair_measurement_and_ship_only_evidence_backed_safe_improvement',
      publicActionRequired: true,
      reasons: (indexation && indexation.errors) || ['URL Inspection-data ontbreekt.'],
    }, shared);
  }

  if (
    reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate < INDEXATION_RECOVERY_THRESHOLD
  ) {
    return applyNewUrlFloor({
      state: 'indexation_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'improve_discovery_quality_internal_links_or_consolidate',
      publicActionRequired: true,
      reasons: [`Reviewbare D14/D28-indexatie is ${reviewable.indexed}/${reviewable.inspected}.`],
    }, shared);
  }

  if (quality && quality.status === 'quality_recovery') {
    return applyNewUrlFloor({
      state: 'quality_recovery',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'replace_template_content_with_unique_information_or_consolidate',
      publicActionRequired: true,
      reasons: quality.reasons || ['Contentoriginaliteit is onvoldoende.'],
    }, shared);
  }

  if (deficit > 0) {
    return applyNewUrlFloor({
      state: 'growth',
      status: 'growth_action_required',
      color: 'amber',
      exitCode: 2,
      action: 'publish_highest_expected_qualified_value_candidate',
      publicActionRequired: true,
      reasons: [`Publicatielevering loopt ${deficit} achter op het gezonde groeiritme.`],
    }, shared);
  }

  const canScale = reviewable.inspected >= MINIMUM_REVIEWABLE_INDEXATION_SAMPLE
    && reviewable.rate >= SCALE_INDEXATION_THRESHOLD;
  return applyNewUrlFloor({
    state: canScale ? 'scale' : 'growth',
    status: 'on_track',
    color: 'green',
    exitCode: 0,
    action: 'choose_highest_expected_qualified_impact',
    publicActionRequired: true,
    reasons: [],
  }, shared);
}

module.exports = {
  DEFAULT_WEEKLY_MINIMUM,
  INDEXATION_RECOVERY_THRESHOLD,
  MINIMUM_REVIEWABLE_INDEXATION_SAMPLE,
  NEW_URL_LIMITS,
  SCALE_INDEXATION_THRESHOLD,
  buildReviewableIndexation,
  evaluateSeoMachineState,
};
