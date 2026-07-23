#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_BACKLOG_PATH,
  loadSeoMachineBacklog,
  validateSeoMachineBacklog,
} = require('../server/services/seo-machine-backlog');
const {
  SEO_CONTENT_ITEMS,
  getSeoContentItems,
} = require('../server/services/seo-content');
const {
  buildContentOriginalityReport,
} = require('../server/services/seo-machine-quality-gates');
const {
  evaluateSeoMachineState,
} = require('../server/services/seo-machine-control-plane');
const {
  runSeoMachinePublicationReport,
} = require('./seo-machine-publication-report');
const {
  runSeoMachineIndexationReport,
} = require('./seo-machine-indexation-report');

const DEFAULT_INDEXATION_REPORT_PATH = path.resolve(__dirname, '..', 'reports', 'seo-agent', 'indexation-latest.json');
const DEFAULT_INDEXATION_MAX_AGE_MS = 30 * 60 * 1000;

function loadFreshIndexationReport(
  filePath = DEFAULT_INDEXATION_REPORT_PATH,
  now = new Date(),
  maximumAgeMs = DEFAULT_INDEXATION_MAX_AGE_MS
) {
  try {
    const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const generatedAt = new Date(report.generatedAt).getTime();
    const age = now.getTime() - generatedAt;
    if (!Number.isFinite(generatedAt) || age < 0 || age > maximumAgeMs) return null;
    return report;
  } catch (_) {
    return null;
  }
}

async function runSeoMachineCadenceCheck(options = {}) {
  const backlog = options.backlog || loadSeoMachineBacklog(options.filePath || DEFAULT_BACKLOG_PATH);
  const backlogResult = options.backlogResult || validateSeoMachineBacklog(backlog, options.validationOptions);
  const ledger = options.ledger || await runSeoMachinePublicationReport(options);
  let indexation = options.indexation || (!options.refreshIndexation && loadFreshIndexationReport(
    options.indexationReportPath,
    options.now instanceof Date ? options.now : new Date(options.now || Date.now()),
    options.indexationMaximumAgeMs
  ));
  if (!indexation) {
    try {
      indexation = await runSeoMachineIndexationReport(options);
    } catch (error) {
      indexation = { status: 'data_degraded', errors: [error.message || String(error)], summary: {} };
    }
  }
  const quality = options.quality || buildContentOriginalityReport({
    sourceItems: SEO_CONTENT_ITEMS,
    renderedItems: getSeoContentItems({ now: options.now || new Date() }),
  });
  return {
    backlog: backlogResult.summary,
    ledger,
    indexation,
    quality,
    cadence: evaluateSeoMachineState({ backlogResult, ledger, indexation, quality }),
  };
}

async function runCli() {
  try {
    const result = await runSeoMachineCadenceCheck();
    const cadence = result.cadence;
    const label = cadence.color === 'green' ? 'GREEN' : cadence.color === 'amber' ? 'AMBER' : 'RED';
    console.log(
      `[seo-cadence] ${label}: state=${cadence.state} status=${cadence.status} action=${cadence.action} `
      + `qualifying7d=${cadence.qualifying ?? 'n/a'} deficit=${cadence.deficit ?? 'n/a'}`
    );
    console.log(
      `[seo-cadence] indexation=${cadence.reviewable?.indexed ?? 'n/a'}/${cadence.reviewable?.inspected ?? 'n/a'} `
      + `requestEvidenceDue=${cadence.requestEvidenceDue ?? 'n/a'} maxNewUrls7d=${cadence.maximumNewUrlsPerWeek}`
    );
    if (cadence.nextCandidate) {
      console.log(
        `[seo-cadence] next=${cadence.nextCandidate.id} score=${cadence.nextCandidate.score} `
        + `path=${cadence.nextCandidate.path}`
      );
    }
    for (const reason of cadence.reasons || []) console.error(`[seo-cadence] ${cadence.state}: ${reason}`);
    process.exit(cadence.exitCode);
  } catch (error) {
    console.error(`[seo-cadence] P0: ${error.message || String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_INDEXATION_MAX_AGE_MS,
  DEFAULT_INDEXATION_REPORT_PATH,
  loadFreshIndexationReport,
  runSeoMachineCadenceCheck,
};
