#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  isSafeRelativePath,
  validateSelectionEvidence,
} = require('../server/services/seo-machine-selection');
const {
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

function main(argv = process.argv.slice(2)) {
  const gateOptions = extractRunGateCliOptions(argv);
  const args = parseArgs(gateOptions.remaining);
  const evidence = readJson(args.evidence);
  const report = readJson(args.report);
  const result = validateSelectionEvidence(evidence, report);
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

module.exports = { main, parseArgs };
