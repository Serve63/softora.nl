#!/usr/bin/env node
const { SEO_CONTENT_ITEMS } = require('../server/services/seo-content');
const {
  KEYWORD_EVIDENCE_CUTOFF,
  auditKeywordEvidence,
  requiresKeywordEvidence,
} = require('../server/services/seo-machine-keyword-evidence');
const {
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

function runSeoMachineKeywordCheck({ items = SEO_CONTENT_ITEMS, cutoff = KEYWORD_EVIDENCE_CUTOFF } = {}) {
  const issues = auditKeywordEvidence({ items, cutoff });
  const required = items.filter((item) => requiresKeywordEvidence(item, cutoff)).length;
  return {
    status: issues.length ? 'blocked' : 'ready',
    cutoff,
    required,
    checked: items.length,
    issues,
  };
}

function runCli() {
  const gateOptions = extractRunGateCliOptions(process.argv.slice(2));
  const result = runSeoMachineKeywordCheck();
  const runGate = result.status === 'ready'
    ? recordAutomationRunGateFromCli({
      gateOptions,
      gate: 'keywords',
      details: {
        status: result.status,
        cutoff: result.cutoff,
        required: result.required,
        checked: result.checked,
        issueCount: result.issues.length,
      },
    })
    : null;
  if (gateOptions.remaining.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...result, runGate }, null, 2)}\n`);
  } else {
    console.log(
      `[seo-keywords] ${result.status.toUpperCase()}: required=${result.required} checked=${result.checked} issues=${result.issues.length}`
    );
    if (runGate) console.log(`[seo-keywords] run-gate=${runGate.resultDigest}`);
    for (const issue of result.issues) console.error(`[seo-keywords] ${issue.type}: ${issue.message}`);
  }
  if (result.status !== 'ready') process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  runSeoMachineKeywordCheck,
};
