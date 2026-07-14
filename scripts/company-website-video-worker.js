#!/usr/bin/env node
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadSoftoraLocalEnv } = require('../server/config/load-local-env');
const {
  createCompanyWebsiteVideoRepository,
} = require('../server/repositories/company-website-video');
const {
  renderCompanyWebsiteVideo,
} = require('../server/services/company-website-video-renderer');

const projectRootDir = path.resolve(__dirname, '..');
loadSoftoraLocalEnv({ projectRootDir, cwd: process.cwd() });

function waitForNextPoll() {
  return new Promise((resolve) => setTimeout(resolve, 2500));
}

function createWorker(options = {}) {
  const logger = options.logger || console;
  const repository = options.repository || createCompanyWebsiteVideoRepository({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: process.env.WEBSITE_VIDEO_STORAGE_BUCKET,
  });
  const renderer = options.renderer || renderCompanyWebsiteVideo;

  async function runOne() {
    if (!repository.configured) throw new Error('SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn vereist voor de websitevideoworker.');
    const lockToken = crypto.randomUUID();
    const record = await repository.claimNext(lockToken, Number(process.env.WEBSITE_VIDEO_LOCK_TIMEOUT_SECONDS) || 300);
    if (!record) return false;
    const localOutputPath = path.join(os.tmpdir(), `softora-company-video-${lockToken}.mp4`);
    logger.log(`[WebsiteVideoWorker] Render gestart voor ${record.companyId}.`);
    try {
      await renderer({
        websiteUrl: record.normalizedWebsiteUrl,
        outputPath: localOutputPath,
        loadTimeoutMs: Number(process.env.WEBSITE_VIDEO_LOAD_TIMEOUT_MS) || 30_000,
        maxRedirects: Number(process.env.WEBSITE_VIDEO_MAX_REDIRECTS) || 5,
      });
      const storagePath = await repository.upload(record.companyId, localOutputPath);
      await repository.markReady(record.companyId, lockToken, storagePath);
      logger.log(`[WebsiteVideoWorker] Render gereed voor ${record.companyId}.`);
    } catch (error) {
      await repository.markFailed(record.companyId, lockToken, error && error.message ? error.message : String(error)).catch(() => undefined);
      logger.error(`[WebsiteVideoWorker] Render mislukt voor ${record.companyId}: ${error && error.message ? error.message : error}`);
    } finally {
      await fs.rm(localOutputPath, { force: true }).catch(() => undefined);
    }
    return true;
  }

  return { runOne };
}

async function main() {
  const once = process.argv.includes('--once');
  const worker = createWorker();
  do {
    const processed = await worker.runOne();
    if (once) break;
    if (!processed) await waitForNextPoll();
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  createWorker,
};
