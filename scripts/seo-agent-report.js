#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SITE_ORIGIN,
  DEFAULT_SITE_URL,
  buildSearchConsoleAgentReport,
  buildTechnicalOnlyAgentReport,
  fetchSearchConsoleSnapshot,
  fetchTechnicalSeoSnapshot,
  formatAgentMarkdown,
  getSearchConsoleConfigFromEnv,
  hasSearchConsoleCredentials,
} = require('./lib/search-console-agent-report');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    days: 28,
    endDate: '',
    outDir: path.join(process.cwd(), 'reports', 'seo-agent'),
    siteUrl: '',
    siteOrigin: DEFAULT_SITE_ORIGIN,
    technicalOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--technical-only') {
      args.technicalOnly = true;
    } else if (arg === '--days' && next) {
      args.days = Number(next);
      index += 1;
    } else if (arg === '--end-date' && next) {
      args.endDate = next;
      index += 1;
    } else if (arg === '--out-dir' && next) {
      args.outDir = path.resolve(next);
      index += 1;
    } else if (arg === '--site' && next) {
      args.siteUrl = next;
      index += 1;
    } else if (arg === '--origin' && next) {
      args.siteOrigin = next;
      index += 1;
    }
  }

  return args;
}

function writeReportFiles(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'latest.json');
  const markdownPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatAgentMarkdown(report));
  return { jsonPath, markdownPath };
}

async function main() {
  const args = parseArgs();
  const config = {
    ...getSearchConsoleConfigFromEnv(process.env),
    siteUrl: args.siteUrl || process.env.GSC_SITE_URL || process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE_URL,
  };

  const technical = await fetchTechnicalSeoSnapshot({
    siteOrigin: args.siteOrigin,
  });

  let report;
  if (!args.technicalOnly && hasSearchConsoleCredentials(config)) {
    const snapshot = await fetchSearchConsoleSnapshot({
      config,
      siteUrl: config.siteUrl,
      days: args.days,
      endDate: args.endDate,
    });
    report = buildSearchConsoleAgentReport({
      ...snapshot,
      technical,
    });
  } else {
    report = buildTechnicalOnlyAgentReport({ technical }, { config });
  }

  const files = writeReportFiles(args.outDir, report);
  console.log(`[seo-agent] Rapport geschreven: ${files.markdownPath}`);
  console.log(`[seo-agent] Status: ${report.status}`);
  if (Array.isArray(report.actionQueue) && report.actionQueue.length > 0) {
    console.log(`[seo-agent] Acties: ${report.actionQueue.length}`);
  }
}

main().catch((error) => {
  console.error('[seo-agent] Rapport mislukt:', error && error.message ? error.message : error);
  process.exit(1);
});
