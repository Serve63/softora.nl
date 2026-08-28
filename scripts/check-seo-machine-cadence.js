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
const {
  buildD28NonBrandedPerformance,
} = require('../server/services/seo-machine-performance');
const {
  getSeoMachinePublicationPlan,
} = require('../server/services/seo-machine-publication-plan');
const {
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

const DEFAULT_INDEXATION_REPORT_PATH = path.resolve(__dirname, '..', 'reports', 'seo-agent', 'indexation-latest.json');
const DEFAULT_INDEXATION_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_PERFORMANCE_REPORT_PATH = path.resolve(__dirname, '..', 'reports', 'seo-agent', 'latest.json');
const DEFAULT_PERFORMANCE_MAX_AGE_MS = 30 * 60 * 1000;

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

function loadFreshPerformanceReport(
  filePath = DEFAULT_PERFORMANCE_REPORT_PATH,
  now = new Date(),
  maximumAgeMs = DEFAULT_PERFORMANCE_MAX_AGE_MS
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
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const backlog = options.backlog || loadSeoMachineBacklog(options.filePath || DEFAULT_BACKLOG_PATH);
  const backlogResult = options.backlogResult || validateSeoMachineBacklog(backlog, options.validationOptions);
  const ledger = options.ledger || await runSeoMachinePublicationReport(options);
  let indexation = options.indexation || (!options.refreshIndexation && loadFreshIndexationReport(
    options.indexationReportPath,
    now,
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
    renderedItems: getSeoContentItems({ now }),
  });
  const performanceReport = options.performanceReport || loadFreshPerformanceReport(
    options.performanceReportPath,
    now,
    options.performanceMaximumAgeMs
  );
  const performance = options.performance || buildD28NonBrandedPerformance({
    publicationPlan: options.publicationPlan || getSeoMachinePublicationPlan({ now }),
    report: performanceReport,
    now,
  });
  return {
    backlog: backlogResult.summary,
    ledger,
    indexation,
    quality,
    performance,
    cadence: evaluateSeoMachineState({ backlogResult, ledger, indexation, quality, performance }),
  };
}

async function runCli() {
  try {
    const gateOptions = extractRunGateCliOptions(process.argv.slice(2));
    if (gateOptions.remaining.length) throw new Error(`Onbekende argumenten: ${gateOptions.remaining.join(' ')}`);
    const result = await runSeoMachineCadenceCheck();
    const cadence = result.cadence;
    const label = cadence.color === 'green' ? 'GREEN' : cadence.color === 'amber' ? 'AMBER' : 'RED';
    console.log(
      `[seo-cadence] ${label}: state=${cadence.state} status=${cadence.status} action=${cadence.action} `
      + `qualifying7d=${cadence.qualifying ?? 'n/a'} newUrls7d=${cadence.newUrls ?? 'n/a'} `
      + `growthNewUrls7d=${cadence.growthNewUrls ?? 'n/a'} editorialNewUrls7d=${cadence.editorialNewUrls ?? 'n/a'} `
      + `moneyPageNewUrls7d=${cadence.moneyPageNewUrls ?? 'n/a'} `
      + `refreshes7d=${cadence.substantialRefreshes ?? 'n/a'} otherActions7d=${cadence.otherGrowthActions ?? 'n/a'} `
      + `deficit=${cadence.deficit ?? 'n/a'}`
    );
    console.log(
      `[seo-cadence] indexation=${cadence.reviewable?.indexed ?? 'n/a'}/${cadence.reviewable?.inspected ?? 'n/a'} `
      + `requestEvidenceDue=${cadence.requestEvidenceDue ?? 'n/a'} `
      + `newUrlTarget7d=${cadence.minimumNewUrlsPerWeek} newUrlDeficit=${cadence.newUrlDeficit} `
      + `editorialMinimum7d=${cadence.minimumEditorialNewUrlsPerWeek} `
      + `editorialDeficit=${cadence.editorialNewUrlDeficit} `
      + `moneyPageMaximum7d=${cadence.maximumMoneyPageNewUrlsPerWeek} `
      + `moneyPageCapacity=${cadence.moneyPageCapacity} requiredLane=${cadence.requiredPublicationLane || 'either'}`
    );
    console.log(
      `[seo-cadence] performance=${result.performance.status} `
      + `d28Impressing=${result.performance.summary?.impressing ?? 'n/a'}/${result.performance.summary?.reviewed ?? 'n/a'} `
      + `d28NonBrandClicks=${result.performance.summary?.clicks ?? 'n/a'} `
      + `d28NonBrandImpressions=${result.performance.summary?.impressions ?? 'n/a'}`
    );
    if (cadence.nextCandidate) {
      console.log(
        `[seo-cadence] next=${cadence.nextCandidate.id} score=${cadence.nextCandidate.score} `
        + `path=${cadence.nextCandidate.path} lane=${cadence.nextCandidate.publicationLane || 'unclassified'}`
      );
    }
    const runGate = cadence.exitCode === 0 || cadence.exitCode === 2
      ? recordAutomationRunGateFromCli({
        gateOptions,
        gate: 'cadence',
        details: {
          state: cadence.state,
          status: cadence.status,
          action: cadence.action,
          exitCode: cadence.exitCode,
          newUrls: cadence.newUrls,
          growthNewUrls: cadence.growthNewUrls,
          editorialNewUrls: cadence.editorialNewUrls,
          moneyPageNewUrls: cadence.moneyPageNewUrls,
          newUrlDeficit: cadence.newUrlDeficit,
          editorialNewUrlDeficit: cadence.editorialNewUrlDeficit,
          minimumNewUrlsPerWeek: cadence.minimumNewUrlsPerWeek,
          minimumEditorialNewUrlsPerWeek: cadence.minimumEditorialNewUrlsPerWeek,
          maximumMoneyPageNewUrlsPerWeek: cadence.maximumMoneyPageNewUrlsPerWeek,
          moneyPageAllowed: cadence.moneyPageAllowed,
          requiredPublicationLane: cadence.requiredPublicationLane,
          supportingOptimizationRequired: cadence.supportingOptimizationRequired,
          companionAction: cadence.companionAction,
          nextCandidate: cadence.nextCandidate ? {
            id: cadence.nextCandidate.id,
            path: cadence.nextCandidate.path,
            score: cadence.nextCandidate.score,
            publicationLane: cadence.nextCandidate.publicationLane,
          } : null,
        },
      })
      : null;
    if (runGate) console.log(`[seo-cadence] run-gate=${runGate.resultDigest}`);
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
  DEFAULT_PERFORMANCE_MAX_AGE_MS,
  DEFAULT_PERFORMANCE_REPORT_PATH,
  loadFreshIndexationReport,
  loadFreshPerformanceReport,
  runSeoMachineCadenceCheck,
};
