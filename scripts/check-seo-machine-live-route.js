#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizePathname,
  runSeoMachineLiveRouteCheck,
} = require('../server/services/seo-machine-live-route');
const {
  ALLOWED_ACTION_TYPES,
  isSafeRelativePath,
} = require('../server/services/seo-machine-selection');
const {
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

function parseArgs(argv) {
  const args = { 'selection-evidence': 'reports/seo-agent/selection-evidence.json' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--url', '--live-commit', '--selection-evidence'].includes(key) || !value) {
      throw new Error(`Ongeldig argument: ${key}`);
    }
    args[key.slice(2)] = value;
  }
  if (!args.url || !args['live-commit']) throw new Error('--url en --live-commit zijn verplicht.');
  if (!isSafeRelativePath(args['selection-evidence'])) {
    throw new Error('--selection-evidence moet een veilig relatief repopad zijn.');
  }
  return args;
}

function readSelectionEvidence(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8'));
}

async function runCli(argv = process.argv.slice(2)) {
  const gateOptions = extractRunGateCliOptions(argv);
  const args = parseArgs(gateOptions.remaining);
  const selectionEvidence = readSelectionEvidence(args['selection-evidence']);
  const selectedPath = normalizePathname(selectionEvidence?.selected?.path);
  const changedPath = normalizePathname(new URL(args.url).pathname);
  if (!selectedPath || selectedPath !== changedPath) {
    throw new Error(`LIVE_ROUTE_SELECTION_MISMATCH: selected.path ${selectedPath || '(ongeldig)'} wijkt af van ${changedPath || '(ongeldig)'}.`);
  }
  const selectedActionType = String(selectionEvidence?.selected?.actionType || '').trim();
  const supportingAction = selectionEvidence?.selected?.supportingAction || null;
  if (!ALLOWED_ACTION_TYPES.has(selectedActionType)) {
    throw new Error('LIVE_ROUTE_ACTION_TYPE_INVALID: selected.actionType ontbreekt of is ongeldig.');
  }
  if (!supportingAction) {
    throw new Error('LIVE_ROUTE_SUPPORTING_ACTION_MISSING: geselecteerde groei-actie mist selected.supportingAction.');
  }
  const result = await runSeoMachineLiveRouteCheck({
    url: args.url,
    liveCommit: args['live-commit'],
    supportingAction,
  });
  const runGate = result.status === 'ready'
    ? recordAutomationRunGateFromCli({
      gateOptions,
      gate: 'live_route',
      treeRef: args['live-commit'],
      liveCommit: args['live-commit'],
      changedUrl: result.summary.url,
      details: result,
    })
    : null;
  process.stdout.write(`${JSON.stringify({ ...result, runGate }, null, 2)}\n`);
  if (result.status !== 'ready') process.exitCode = 1;
  return { ...result, runGate };
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`[seo-live-route] ${error.message || String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, readSelectionEvidence, runCli };
