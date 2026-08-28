#!/usr/bin/env node
const {
  runSeoMachineLiveRouteCheck,
} = require('../server/services/seo-machine-live-route');
const {
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--url', '--live-commit'].includes(key) || !value) throw new Error(`Ongeldig argument: ${key}`);
    args[key.slice(2)] = value;
  }
  if (!args.url || !args['live-commit']) throw new Error('--url en --live-commit zijn verplicht.');
  return args;
}

async function runCli(argv = process.argv.slice(2)) {
  const gateOptions = extractRunGateCliOptions(argv);
  const args = parseArgs(gateOptions.remaining);
  const result = await runSeoMachineLiveRouteCheck({
    url: args.url,
    liveCommit: args['live-commit'],
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

module.exports = { parseArgs, runCli };
