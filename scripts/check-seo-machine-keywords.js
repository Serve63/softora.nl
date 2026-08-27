#!/usr/bin/env node
const { SEO_CONTENT_ITEMS } = require('../server/services/seo-content');
const {
  KEYWORD_EVIDENCE_CUTOFF,
  auditKeywordEvidence,
  requiresKeywordEvidence,
} = require('../server/services/seo-machine-keyword-evidence');

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
  const result = runSeoMachineKeywordCheck();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(
      `[seo-keywords] ${result.status.toUpperCase()}: required=${result.required} checked=${result.checked} issues=${result.issues.length}`
    );
    for (const issue of result.issues) console.error(`[seo-keywords] ${issue.type}: ${issue.message}`);
  }
  if (result.status !== 'ready') process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  runSeoMachineKeywordCheck,
};
