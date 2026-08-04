#!/usr/bin/env node
const path = require('node:path');

const { SEO_CONTENT_ITEMS } = require('../server/services/seo-content');
const { buildVisualQualityReport } = require('../server/services/seo-machine-visual-quality');

async function runCli() {
  const report = await buildVisualQualityReport({
    items: SEO_CONTENT_ITEMS,
    repoRoot: path.resolve(__dirname, '..'),
  });
  const asJson = process.argv.includes('--json');
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const label = report.status === 'ready' ? 'GREEN' : 'RED';
    console.log(
      `[seo-visuals] ${label}: candidates=${report.candidateCount} blockingIssues=${report.issues.length} `
      + `legacyStatus=${report.legacyDebt.status} legacySimilarPairs=${report.legacyDebt.similarPairCount}`
    );
    const nearest = report.legacyDebt.nearestPairs[0];
    if (nearest) {
      console.log(
        `[seo-visuals] legacy-nearest=${nearest.left.src} <> ${nearest.right.src} similarity=${nearest.combined}`
      );
    }
    for (const finding of report.issues) console.error(`[seo-visuals] ${finding.type}: ${finding.message}`);
  }
  process.exit(report.status === 'ready' ? 0 : 1);
}

runCli().catch((error) => {
  console.error(`[seo-visuals] P0: ${error.message || String(error)}`);
  process.exit(1);
});
