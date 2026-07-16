#!/usr/bin/env node
const {
  DEFAULT_BACKLOG_PATH,
  loadSeoMachineBacklog,
  validateSeoMachineBacklog,
} = require('../server/services/seo-machine-backlog');

function runSeoMachineBacklogCheck(options = {}) {
  const backlog = loadSeoMachineBacklog(options.filePath || DEFAULT_BACKLOG_PATH);
  return validateSeoMachineBacklog(backlog, options.validationOptions);
}

function runCli() {
  try {
    const result = runSeoMachineBacklogCheck();
    if (!result.ok) {
      console.error('[seo-backlog] RED: backlog is niet publicatieklaar.');
      for (const error of result.errors) console.error(`- ${error}`);
      process.exit(1);
    }
    console.log(
      `[seo-backlog] GREEN: ${result.summary.ready} ready, `
      + `${Math.round(result.summary.commercialShare * 100)}% commercieel, `
      + `topkandidaat ${result.summary.topReady[0].id} (${result.summary.topReady[0].score}).`
    );
  } catch (error) {
    console.error(`[seo-backlog] RED: ${error.message || String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) runCli();

module.exports = {
  runSeoMachineBacklogCheck,
};
