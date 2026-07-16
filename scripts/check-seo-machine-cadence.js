#!/usr/bin/env node
const {
  DEFAULT_BACKLOG_PATH,
  loadSeoMachineBacklog,
  validateSeoMachineBacklog,
} = require('../server/services/seo-machine-backlog');
const {
  evaluateCadence,
} = require('../server/services/seo-machine-publication-ledger');
const {
  runSeoMachinePublicationReport,
} = require('./seo-machine-publication-report');

async function runSeoMachineCadenceCheck(options = {}) {
  const backlog = options.backlog || loadSeoMachineBacklog(options.filePath || DEFAULT_BACKLOG_PATH);
  const backlogResult = options.backlogResult || validateSeoMachineBacklog(backlog, options.validationOptions);
  const ledger = options.ledger || await runSeoMachinePublicationReport(options);
  return {
    backlog: backlogResult.summary,
    ledger,
    cadence: evaluateCadence({ backlogResult, ledger }),
  };
}

async function runCli() {
  try {
    const result = await runSeoMachineCadenceCheck();
    const cadence = result.cadence;
    const label = cadence.color === 'green' ? 'GREEN' : 'RED';
    console.log(
      `[seo-cadence] ${label}: status=${cadence.status} action=${cadence.action} `
      + `qualifying7d=${cadence.qualifying ?? 'n/a'} deficit=${cadence.deficit ?? 'n/a'}`
    );
    if (cadence.nextCandidate) {
      console.log(
        `[seo-cadence] next=${cadence.nextCandidate.id} score=${cadence.nextCandidate.score} `
        + `path=${cadence.nextCandidate.path}`
      );
    }
    for (const error of cadence.errors || []) console.error(`[seo-cadence] P0: ${error}`);
    process.exit(cadence.exitCode);
  } catch (error) {
    console.error(`[seo-cadence] P0: ${error.message || String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) runCli();

module.exports = {
  runSeoMachineCadenceCheck,
};
