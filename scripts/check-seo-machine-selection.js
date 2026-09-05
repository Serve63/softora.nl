#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  isSafeRelativePath,
  validateSelectionEvidence,
} = require('../server/services/seo-machine-selection');
const { getIndexablePublicSeoPages } = require('../server/services/public-seo');
const { getSeoContentPublicPaths } = require('../server/services/seo-content');
const {
  assertSeoMachineBacklog,
  loadSeoMachineBacklog,
} = require('../server/services/seo-machine-backlog');
const {
  DEFAULT_MEMORY_PATH,
  inspectAutomationState,
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    evidence: 'reports/seo-agent/selection-evidence.json',
    report: 'reports/seo-agent/latest.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--evidence', '--report'].includes(key) || !value) throw new Error(`Ongeldig argument: ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const [key, value] of Object.entries(args)) {
    if (!isSafeRelativePath(value)) throw new Error(`${key} moet een veilig relatief repopad zijn.`);
  }
  return args;
}

function readJson(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function getKnownPublicPaths() {
  return new Set([
    ...getIndexablePublicSeoPages().map((entry) => entry.path),
    ...getSeoContentPublicPaths(),
  ]);
}

function getReadyBacklogPaths() {
  const backlog = loadSeoMachineBacklog();
  assertSeoMachineBacklog(backlog);
  return new Set(backlog.items.filter((item) => item.status === 'ready').map((item) => item.path));
}

function main(argv = process.argv.slice(2)) {
  const gateOptions = extractRunGateCliOptions(argv);
  const args = parseArgs(gateOptions.remaining);
  const evidence = readJson(args.evidence);
  const report = readJson(args.report);
  let controlPlane;
  if (gateOptions.enabled) {
    const active = inspectAutomationState(DEFAULT_MEMORY_PATH).lifecycle.activeRun;
    if (active?.threadId !== gateOptions.threadId || active?.invocationAt !== gateOptions.invocationAt || !active?.gates?.cadence) {
      throw new Error('Selectie vereist de cadence-receipt van exact deze invocation.');
    }
    controlPlane = active.gates.cadence.summary;
  }
  const result = validateSelectionEvidence(evidence, report, {
    controlPlane,
    knownPublicPaths: getKnownPublicPaths(),
    readyBacklogPaths: getReadyBacklogPaths(),
    reportPath: args.report,
    now: new Date(),
  });
  let runGate = null;
  if (result.status === 'ready') {
    runGate = recordAutomationRunGateFromCli({
      gateOptions,
      gate: 'selection',
      details: {
        status: result.status,
        sourceReportGeneratedAt: report.generatedAt,
        selectedSource: result.summary.selectedSource,
        selectedPath: result.summary.selectedPath,
        selectedActionType: String(evidence?.selected?.actionType || '').trim() || null,
        selectedPublicationLane: result.summary.selectedPublicationLane,
        supportingAction: result.summary.supportingAction,
        prioritizedReviewed: result.summary.prioritizedReviewed,
        highestOpportunity: result.summary.highestOpportunity,
      },
    });
  }
  const output = { ...result, runGate };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result.status !== 'ready') process.exitCode = 1;
  return output;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[seo-selection] ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { getKnownPublicPaths, getReadyBacklogPaths, main, parseArgs };
