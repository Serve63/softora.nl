const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateSeoMachineState } = require('../../server/services/seo-machine-control-plane');
const {
  loadFreshIndexationReport,
  loadFreshPerformanceReport,
} = require('../../scripts/check-seo-machine-cadence');

function backlogSummary() {
  const editorial = {
    id: 'editorial-candidate',
    path: '/blog/editorial-candidate',
    score: 4.6,
    publicationLane: 'editorial',
  };
  const moneyPage = {
    id: 'money-candidate',
    path: '/branches/money-candidate',
    score: 4.7,
    publicationLane: 'money_page',
  };
  return {
    topReady: [moneyPage, editorial],
    topReadyEditorial: [editorial],
    topReadyMoneyPages: [moneyPage],
  };
}

function ledgerWindow(overrides = {}) {
  return {
    qualifying: 7,
    newUrls: 7,
    growthNewUrls: 7,
    editorialNewUrls: 5,
    moneyPageNewUrls: 2,
    otherNewUrls: 0,
    unclassifiedNewUrls: 0,
    substantialRefreshes: 0,
    otherGrowthActions: 0,
    ...overrides,
  };
}

function readyInputs(overrides = {}) {
  return {
    backlogResult: { ok: true, summary: backlogSummary() },
    ledger: { status: 'ready', errors: [], windows: { '7': ledgerWindow() } },
    indexation: {
      status: 'ready',
      summary: {
        requestEvidenceDue: 2,
        d14: { inspected: 5, indexed: 4 },
        d28: { inspected: 5, indexed: 4 },
      },
    },
    quality: { status: 'healthy', reasons: [] },
    performance: {
      status: 'scale_ready',
      reasons: [],
      summary: { reviewed: 5, impressing: 3, clicking: 1, impressions: 100, clicks: 1 },
    },
    ...overrides,
  };
}

test('control plane makes live blockers an operations P0 without a publication lane', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: { status: 'p0', errors: ['live mismatch'], windows: {} },
  }));
  assert.equal(state.state, 'operations_p0');
  assert.equal(state.exitCode, 1);
  assert.equal(state.publicActionRequired, false);
  assert.equal(state.newUrlRequired, false);
  assert.deepEqual(state.allowedPublicationLanes, []);
  assert.equal(state.supportingOptimizationRequired, false);
});

test('every non-P0 state keeps the seven-per-week growth URL target', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        qualifying: 5,
        newUrls: 0,
        growthNewUrls: 0,
        editorialNewUrls: 0,
        moneyPageNewUrls: 0,
        substantialRefreshes: 5,
      }) },
    },
    indexation: {
      status: 'ready',
      summary: { requestEvidenceDue: 8, d14: { inspected: 5, indexed: 1 }, d28: { inspected: 5, indexed: 2 } },
    },
  }));
  assert.equal(state.state, 'indexation_recovery');
  assert.equal(state.minimumNewUrlsPerWeek, 7);
  assert.equal(state.minimumEditorialNewUrlsPerWeek, 5);
  assert.equal(state.maximumMoneyPageNewUrlsPerWeek, 2);
  assert.equal(state.newUrlDeficit, 7);
  assert.equal(state.requiredPublicationLane, 'editorial');
  assert.equal(state.nextCandidate.id, 'editorial-candidate');
  assert.equal(state.companionAction, 'improve_discovery_quality_internal_links_or_consolidate');
});

test('performance recovery remains a companion action while the daily URL lane is behind', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        qualifying: 5,
        newUrls: 3,
        growthNewUrls: 3,
        editorialNewUrls: 3,
        moneyPageNewUrls: 0,
        substantialRefreshes: 2,
      }) },
    },
    performance: {
      status: 'performance_recovery',
      reasons: ['slechts 1/5 URLs met impressies'],
      summary: { reviewed: 5, impressing: 1, clicking: 0, impressions: 120, clicks: 0 },
    },
  }));
  assert.equal(state.state, 'performance_recovery');
  assert.equal(state.newUrlRequired, true);
  assert.equal(state.newUrlDeficit, 4);
  assert.equal(state.requiredPublicationLane, 'editorial');
  assert.match(state.action, /editorial_candidate_with_supporting_optimization/);
  assert.equal(state.companionAction, 'improve_query_page_match_snippets_internal_routes_or_consolidate');
});

test('measured D28 recovery outranks corpus debt once the daily URL target is met', () => {
  const state = evaluateSeoMachineState(readyInputs({
    quality: { status: 'quality_recovery', reasons: ['template_share'] },
    performance: {
      status: 'performance_recovery',
      reasons: ['0/5 reviewbare URLs met non-branded impressies'],
      summary: { reviewed: 5, impressing: 0, clicking: 0, impressions: 0, clicks: 0 },
    },
  }));
  assert.equal(state.state, 'performance_recovery');
  assert.equal(state.newUrlRequired, false);
  assert.equal(state.action, 'improve_query_page_match_snippets_internal_routes_or_consolidate');
});

test('the third rolling money page is blocked and an editorial candidate is forced', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        qualifying: 6,
        newUrls: 6,
        growthNewUrls: 6,
        editorialNewUrls: 4,
        moneyPageNewUrls: 2,
      }) },
    },
  }));
  assert.equal(state.newUrlDeficit, 1);
  assert.equal(state.moneyPageCapReached, true);
  assert.equal(state.moneyPageAllowed, false);
  assert.equal(state.requiredPublicationLane, 'editorial');
  assert.deepEqual(state.allowedPublicationLanes, ['editorial']);
  assert.equal(state.nextCandidate.id, 'editorial-candidate');
});

test('a second money page may win on score after five editorial URLs are live', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        qualifying: 6,
        newUrls: 6,
        growthNewUrls: 6,
        editorialNewUrls: 5,
        moneyPageNewUrls: 1,
      }) },
    },
  }));
  assert.equal(state.newUrlRequired, true);
  assert.equal(state.requiredPublicationLane, null);
  assert.equal(state.moneyPageAllowed, true);
  assert.deepEqual(state.allowedPublicationLanes, ['editorial', 'money_page']);
  assert.equal(state.nextCandidate.id, 'money-candidate');
});

test('supporting checks and existing-page optimization stay required on safe runs', () => {
  const state = evaluateSeoMachineState(readyInputs());
  assert.equal(state.state, 'scale');
  assert.equal(state.newUrlRequired, false);
  assert.equal(state.supportingOptimizationRequired, true);
  assert.deepEqual(state.requiredSupportingActions, [
    'full_preflight_and_measurement_checks',
    'indexation_and_discovery_review',
    'contextual_internal_links',
    'evidence_backed_existing_page_optimization',
  ]);
  assert.equal(state.maximumNewUrlsPerWeek, 7);
});

test('control plane fails closed when a ready ledger already breached the money-page cap', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        growthNewUrls: 7,
        editorialNewUrls: 2,
        moneyPageNewUrls: 5,
      }) },
    },
  }));

  assert.equal(state.state, 'operations_p0');
  assert.equal(state.exitCode, 1);
  assert.equal(state.newUrlRequired, false);
  assert.match(state.reasons.join(' '), /geldpagina-cap.*5\/2/i);
});

test('control plane fails closed when more than one growth URL per daily heartbeat is observed', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': ledgerWindow({
        qualifying: 8,
        newUrls: 8,
        growthNewUrls: 8,
        editorialNewUrls: 6,
        moneyPageNewUrls: 2,
      }) },
    },
  }));

  assert.equal(state.state, 'operations_p0');
  assert.equal(state.exitCode, 1);
  assert.match(state.reasons.join(' '), /groei-URL.*8\/7/i);
});

test('control plane refuses scale without positive D28 non-brand evidence', () => {
  const state = evaluateSeoMachineState(readyInputs({
    performance: {
      status: 'learning',
      reasons: [],
      summary: { reviewed: 5, impressing: 2, clicking: 0, impressions: 40, clicks: 0 },
    },
  }));
  assert.equal(state.state, 'growth');
  assert.equal(state.minimumNewUrlsPerWeek, 7);
});

test('cadence check reuses only a fresh indexation report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-indexation-'));
  const reportPath = path.join(directory, 'indexation-latest.json');
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'ready', generatedAt: '2026-07-23T10:00:00.000Z' }));
  assert.equal(
    loadFreshIndexationReport(reportPath, new Date('2026-07-23T10:10:00.000Z')).status,
    'ready'
  );
  assert.equal(loadFreshIndexationReport(reportPath, new Date('2026-07-23T11:00:00.000Z')), null);
});

test('cadence check reuses only a fresh GSC performance report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-performance-'));
  const reportPath = path.join(directory, 'latest.json');
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'ready', generatedAt: '2026-07-23T10:00:00.000Z' }));
  assert.equal(
    loadFreshPerformanceReport(reportPath, new Date('2026-07-23T10:10:00.000Z')).status,
    'ready'
  );
  assert.equal(loadFreshPerformanceReport(reportPath, new Date('2026-07-23T11:00:00.000Z')), null);
});
