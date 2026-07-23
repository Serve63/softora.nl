const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateSeoMachineState } = require('../../server/services/seo-machine-control-plane');
const { loadFreshIndexationReport } = require('../../scripts/check-seo-machine-cadence');

function readyInputs(overrides = {}) {
  return {
    backlogResult: { ok: true, summary: { topReady: [{ id: 'candidate', path: '/blog/candidate', score: 4.6 }] } },
    ledger: { status: 'ready', errors: [], windows: { '7': { qualifying: 5 } } },
    indexation: {
      status: 'ready',
      summary: {
        requestEvidenceDue: 2,
        d14: { inspected: 5, indexed: 4 },
        d28: { inspected: 5, indexed: 4 },
      },
    },
    quality: { status: 'healthy', reasons: [] },
    ...overrides,
  };
}

test('control plane makes live blockers an operations P0', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: { status: 'p0', errors: ['live mismatch'], windows: {} },
  }));
  assert.equal(state.state, 'operations_p0');
  assert.equal(state.exitCode, 1);
  assert.equal(state.publicActionRequired, false);
});

test('control plane prioritizes indexation recovery over publication deficit', () => {
  const state = evaluateSeoMachineState(readyInputs({
    ledger: { status: 'ready', errors: [], windows: { '7': { qualifying: 1 } } },
    indexation: {
      status: 'ready',
      summary: { requestEvidenceDue: 8, d14: { inspected: 5, indexed: 1 }, d28: { inspected: 5, indexed: 2 } },
    },
  }));
  assert.equal(state.state, 'indexation_recovery');
  assert.equal(state.exitCode, 2);
  assert.equal(state.maximumNewUrlsPerWeek, 2);
});

test('control plane selects quality recovery before scaling new content', () => {
  const state = evaluateSeoMachineState(readyInputs({
    quality: { status: 'quality_recovery', reasons: ['template_share'] },
  }));
  assert.equal(state.state, 'quality_recovery');
  assert.equal(state.action, 'replace_template_content_with_unique_information_or_consolidate');
});

test('control plane scales only with healthy reviewable indexation', () => {
  const state = evaluateSeoMachineState(readyInputs());
  assert.equal(state.state, 'scale');
  assert.equal(state.maximumNewUrlsPerWeek, 7);
  assert.equal(state.exitCode, 0);
});

test('cadence check reuses only a fresh indexation report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-indexation-'));
  const reportPath = path.join(directory, 'indexation-latest.json');
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'ready', generatedAt: '2026-07-23T10:00:00.000Z' }));
  assert.equal(
    loadFreshIndexationReport(reportPath, new Date('2026-07-23T10:10:00.000Z')).status,
    'ready'
  );
  assert.equal(
    loadFreshIndexationReport(reportPath, new Date('2026-07-23T11:00:00.000Z')),
    null
  );
});
