#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const {
  validateExperimentReviewEvidence,
} = require('../server/services/seo-machine-experiment-reviews');
const { isSafeRelativePath } = require('../server/services/seo-machine-selection');
const {
  DEFAULT_MEMORY_PATH,
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    evidence: 'reports/seo-agent/review-evidence.json',
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
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8'));
}

function main(argv = process.argv.slice(2), options = {}) {
  const gateOptions = extractRunGateCliOptions(argv);
  const args = parseArgs(gateOptions.remaining);
  const memoryPath = options.memoryPath || DEFAULT_MEMORY_PATH;
  const memoryContent = fs.readFileSync(memoryPath, 'utf8');
  const evidence = readJson(args.evidence);
  const report = readJson(args.report);
  const result = validateExperimentReviewEvidence({
    memoryContent,
    evidence,
    report,
    reportPath: args.report,
    now: options.now || new Date(),
  });
  let runGate = null;
  if (result.status === 'ready') {
    runGate = recordAutomationRunGateFromCli({
      gateOptions,
      gate: 'reviews',
      details: {
        status: result.status,
        ...result.summary,
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
    console.error(`[seo-reviews] ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
