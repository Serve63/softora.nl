#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const { loadSoftoraLocalEnv } = require('../server/config/load-local-env');
const { getSeoContentPublicationPlan } = require('../server/services/seo-content');
const { collectIndexationReport } = require('../server/services/seo-machine-indexation');
const {
  DEFAULT_SITE_URL,
  createSearchConsoleClient,
  getSearchConsoleConfigFromEnv,
} = require('./lib/search-console-agent-report');

const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv = process.argv.slice(2)) {
  const getValue = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    json: argv.includes('--json'),
    days: Number(getValue('--days', 56)) || 56,
    limit: Number(getValue('--limit', 75)) || 75,
    concurrency: Number(getValue('--concurrency', 5)) || 5,
    outDir: path.resolve(getValue('--out-dir', path.join(REPO_ROOT, 'reports', 'seo-agent'))),
  };
}

function formatIndexationReport(report) {
  const summary = report.summary || {};
  const lines = [
    `[seo-indexation] status=${report.status} inspected=${summary.inspected || 0} indexed=${summary.indexed || 0} rate=${summary.rate ?? 'n/a'}`,
    `[seo-indexation] d14=${summary.d14?.indexed || 0}/${summary.d14?.inspected || 0} d28=${summary.d28?.indexed || 0}/${summary.d28?.inspected || 0} requestEvidenceDue=${summary.requestEvidenceDue || 0}`,
  ];
  for (const item of report.items || []) {
    lines.push(`- ${item.path} state=${item.state}${item.error ? ` error=${item.error}` : ''}`);
  }
  for (const error of report.errors || []) lines.push(`[seo-indexation] DEGRADED: ${error}`);
  return lines.join('\n');
}

async function runSeoMachineIndexationReport(options = {}) {
  loadSoftoraLocalEnv({ projectRootDir: REPO_ROOT, cwd: options.cwd || process.cwd() });
  const config = { ...getSearchConsoleConfigFromEnv(process.env), ...(options.config || {}) };
  const client = options.client || createSearchConsoleClient({ config, fetchImpl: options.fetchImpl });
  return collectIndexationReport({
    client,
    siteUrl: options.siteUrl || config.siteUrl || DEFAULT_SITE_URL,
    publicationPlan: options.publicationPlan || getSeoContentPublicationPlan({ now: options.now || new Date() }),
    priorityPaths: options.priorityPaths,
    now: options.now,
    days: options.days,
    limit: options.limit,
    concurrency: options.concurrency,
    targets: options.targets,
  });
}

function writeReport(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, 'indexation-latest.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

async function main() {
  const args = parseArgs();
  let report;
  try {
    report = await runSeoMachineIndexationReport(args);
  } catch (error) {
    report = {
      status: 'data_degraded',
      generatedAt: new Date().toISOString(),
      siteUrl: DEFAULT_SITE_URL,
      summary: { inspected: 0, indexed: 0, rate: null, requestEvidenceDue: 0 },
      items: [],
      errors: [error.message || String(error)],
    };
  }
  const outputPath = writeReport(args.outDir, report);
  console.log(args.json ? JSON.stringify(report, null, 2) : formatIndexationReport(report));
  console.log(`[seo-indexation] report=${outputPath}`);
}

if (require.main === module) main();

module.exports = {
  formatIndexationReport,
  parseArgs,
  runSeoMachineIndexationReport,
  writeReport,
};
