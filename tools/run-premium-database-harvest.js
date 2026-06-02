#!/usr/bin/env node

const path = require('path');
const { DEFAULT_SITE_PROGRESS_RELATIVE_PATH, runHarvest } = require('./lib/premium-database-harvest-core');

function parseArgs(argv) {
  const args = {
    maxLocations: 1,
    outputDir: path.join(process.cwd(), 'reports/premium-database-harvest'),
    paidDataBudgetEur: 0,
    syncSiteProgress: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--output-dir') {
      args.outputDir = next;
      index += 1;
    } else if (arg === '--locations') {
      args.maxLocations = Number(next) || 1;
      index += 1;
    } else if (arg === '--start') {
      args.startAt = next;
      index += 1;
    } else if (arg === '--search-provider') {
      args.searchProvider = next;
      index += 1;
    } else if (arg === '--max-sites-per-location') {
      args.maxOfficialSitesPerLocation = Number(next) || undefined;
      index += 1;
    } else if (arg === '--max-search-results') {
      args.maxSearchResultsPerSource = Number(next) || undefined;
      index += 1;
    } else if (arg === '--fetch-timeout-ms') {
      args.fetchTimeoutMs = Number(next) || undefined;
      index += 1;
    } else if (arg === '--paid-data-budget-eur') {
      args.paidDataBudgetEur = Number(next) || 0;
      index += 1;
    } else if (arg === '--site-progress-path') {
      args.siteProgressPath = path.resolve(next);
      index += 1;
    } else if (arg === '--no-site-progress') {
      args.syncSiteProgress = false;
    } else if (arg === '--help') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Gebruik:
  npm run harvest:database -- --output-dir "$HOME/Desktop" --locations 2
  npm run harvest:database -- --start "Nederland | Noord-Brabant | Loon op Zand | Loon op Zand" --locations 1

Belangrijk:
  - Standaard gebruikt deze tool alleen openbare bronnen en betaalde databronnen staan uit.
  - Gebruik --search-provider none om alleen handmatige seed-URL's in tests of uitbreidingen te gebruiken.
  - Output: softora-bedrijven-verzamellijst-live.html, softora-bedrijven-importklaar.csv, softora-bedrijven-raw.jsonl en softora-bedrijven-progress.json.
  - De site-modal leest standaard mee via ${DEFAULT_SITE_PROGRESS_RELATIVE_PATH}; gebruik --no-site-progress om dat uit te zetten.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (Number(args.paidDataBudgetEur || 0) > 0) {
    throw new Error('Betaalde databronnen zijn in V1 bewust niet aangesloten. Laat paidDataBudgetEur op 0.');
  }
  const result = await runHarvest(args);
  console.log('Harvest klaar.');
  console.log(`Importklaar: ${result.records.length}`);
  console.log(`Live document: ${result.output.liveHtmlPath}`);
  console.log(`CSV: ${result.output.csvPath}`);
  console.log(`Raw JSONL: ${result.output.rawJsonlPath}`);
  console.log(`Voortgang JSON: ${result.output.progressJsonPath}`);
  if (result.output.siteProgressPath) console.log(`Site-modal voortgang: ${result.output.siteProgressPath}`);
}

main().catch((error) => {
  console.error(`Harvest mislukt: ${error.message || error}`);
  process.exit(1);
});
