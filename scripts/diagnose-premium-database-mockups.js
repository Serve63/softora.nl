#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');

const { loadRuntimeEnv } = require('../server/config/runtime-env');
const { createSupabaseStateStore } = require('../server/services/supabase-state');
const { createSoftoraDataOpsStore } = require('../server/services/data-ops-store');
const {
  diagnoseWebdesignMockupRecord,
  getDeviceMockupRendererSpec,
} = require('../server/services/premium-database-webdesign-jobs');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function parseArgs(argv) {
  const args = new Set(argv);
  const limitArg = argv.find((item) => /^--limit=/.test(item));
  return {
    json: args.has('--json'),
    limit: Math.max(1, Math.min(500, Number(limitArg ? limitArg.split('=')[1] : 100) || 100)),
  };
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function pickEvidenceRows(items, status, limit = 5) {
  return items
    .filter((item) => item.status === status)
    .slice(0, limit)
    .map((item) => ({
      customerId: item.customerId,
      company: item.company,
      websitePhotoName: item.websitePhotoName,
      websiteMockupName: item.websiteMockupName,
      mockupRenderer: item.mockupRenderer,
      mockupQualityStatus: item.mockupQualityStatus,
      mockupQualityCheckedAt: item.mockupQualityCheckedAt,
      updatedAt: item.updatedAt,
      reasons: item.reasons,
    }));
}

async function loadDesignPhotoDiagnostics(limit) {
  const runtimeEnv = loadRuntimeEnv(process.env);
  const supabase = runtimeEnv.supabase;
  const stateStore = createSupabaseStateStore({
    supabaseUrl: supabase.url,
    supabaseServiceRoleKey: supabase.serviceRoleKey,
    supabaseStateTable: supabase.stateTable,
    supabaseStateKey: supabase.stateKey,
    supabaseCallUpdateStateKeyPrefix: supabase.callUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit: supabase.callUpdateRowsFetchLimit,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  if (!stateStore.isSupabaseConfigured()) {
    throw new Error('Supabase is niet geconfigureerd; mockupdiagnose kan geen live opslag lezen.');
  }

  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: stateStore.isSupabaseConfigured,
    getSupabaseClient: stateStore.getSupabaseClient,
    logger: console,
  });
  const entries = await store.listDesignPhotosWithSignedUrls({ expiresInSeconds: 300 });
  if (!entries) throw new Error('Designfoto-opslag kon niet worden gelezen.');
  return entries.slice(0, limit).map((entry) =>
    diagnoseWebdesignMockupRecord({
      ...entry,
      websitePhotoName: entry.fileName,
      storageSource: 'softora_design_photos',
    })
  );
}

function buildReport(diagnostics) {
  const rendererSpec = getDeviceMockupRendererSpec();
  const reviewRows = diagnostics.filter((item) => item.status === 'needs_review');
  const okRows = diagnostics.filter((item) => item.status === 'ok');
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    rendererSpec: {
      currentServerRenderer: rendererSpec.renderer,
      fileVersion: rendererSpec.fileVersion,
      laptopFrame: rendererSpec.devices.find((device) => device.id === 'laptop')?.screen.frame || null,
    },
    summary: {
      checked: diagnostics.length,
      ok: okRows.length,
      needsReview: reviewRows.length,
      byRenderer: countBy(diagnostics, (item) => item.mockupRenderer),
      byReason: countBy(reviewRows.flatMap((item) => item.reasons), (item) => item),
    },
    goodExamples: pickEvidenceRows(diagnostics, 'ok'),
    reviewExamples: pickEvidenceRows(diagnostics, 'needs_review'),
  };
}

function printHuman(report) {
  console.log('Premium database mockupdiagnose');
  console.log(`- Huidige serverrenderer: ${report.rendererSpec.currentServerRenderer}`);
  console.log(`- Gecontroleerde records: ${report.summary.checked}`);
  console.log(`- OK: ${report.summary.ok}`);
  console.log(`- Review nodig: ${report.summary.needsReview}`);
  console.log(`- Renderers: ${JSON.stringify(report.summary.byRenderer)}`);
  console.log(`- Review-redenen: ${JSON.stringify(report.summary.byReason)}`);
  console.log('\nGoede voorbeelden:');
  console.table(report.goodExamples);
  console.log('\nReview voorbeelden:');
  console.table(report.reviewExamples);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const diagnostics = await loadDesignPhotoDiagnostics(options.limit);
  const report = buildReport(diagnostics);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printHuman(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[premium-database-mockup-diagnose] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  loadDesignPhotoDiagnostics,
};
