'use strict';
const { buildWebdesignPipelineOptions } = require('./design-photo-generation-policy');
const { createWebsiteGenerationHelpers } = require('./website-generation');
const { prepareWebsitePreviewBrandGuard } = require('./website-brand-color-guard');
const { buildWebsitePreviewPromptFromScan } = createWebsiteGenerationHelpers();

async function prepareWorkerJob(job, aiToolsCoordinator, logger, timeoutMs) {
  const { generationScan } = await withPreparationDeadline(() => aiToolsCoordinator.prepareWebsitePreviewImage(job.websiteUrl,
    buildWebdesignPipelineOptions({ source: 'premium-database', company: job.customer.bedrijf, domain: job.customer.dom })), timeoutMs * 0.75);
  let brandGuard = null;
  try {
    brandGuard = await withPreparationDeadline(async () => {
      const references = await aiToolsCoordinator.fetchWebsitePreviewReferenceImages(generationScan);
      return prepareWebsitePreviewBrandGuard(generationScan, references);
    }, timeoutMs * 0.25);
  } catch (error) {
    // The Mac still requires its own screenshot; the extra colour lock is optional.
    logger.warn?.('[WebdesignSubscription][brand-guard]', job.id, error.message);
  }
  return { brandGuard, workerJob: { id: job.id, claim: job.subscriptionClaim,
    prompt: buildWebsitePreviewPromptFromScan({ ...generationScan, referenceImageCount: 1,
      verifiedBrandPalette: brandGuard?.palette.map((color) => color.hex) }),
    referenceUrls: generationScan.referenceImageUrls, company: job.customer.bedrijf } };
}

async function withPreparationDeadline(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([action(), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Websiteanalyse duurde te lang.'),
        { status: 504, retryableWebsiteFetch: true })), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function prepareSubscriptionClaim(job, { repository, aiToolsCoordinator, logger,
  preparationTimeoutMs = 120000, now = Date.now }) {
  const begun = await repository.beginPreparation(job.id, job.subscriptionClaim);
  if (begun.stopped) return { ok: true, job: null };
  if (begun.ready) return { ok: true, job: begun.ready };
  if (begun.waiting) return { ok: true, job: null, waiting: true };
  async function fail(error) {
    const finished = await repository.finish(job.id, job.subscriptionClaim,
      'Websiteanalyse mislukt: ' + String(error.message || 'Website niet bereikbaar.').slice(0, 500));
    if (!finished.ok) throw new Error('Afsluiting websiteanalyse niet bevestigd.');
    throw error;
  }
  if (begun.exhausted) return fail(Object.assign(new Error(begun.error || 'Websiteanalyse bleef mislukken.'), { status: 502 }));
  let prepared;
  try {
    // Preparation performs reads only. A late result after the deadline cannot
    // write a stale palette/prompt or start any model request.
    prepared = await prepareWorkerJob(job, aiToolsCoordinator, logger, preparationTimeoutMs);
  } catch (error) {
    const retry = error.retryableWebsiteFetch === true && begun.preparation.attempts < 3;
    const saved = await repository.savePreparation(job.id, job.subscriptionClaim, begun.preparation,
      { phase: retry ? 'retry' : 'failed', error: String(error.message).slice(0, 500), retryAt: retry ? now() + 15000 : 0 });
    if (saved.stopped) return { ok: true, job: null };
    if (!saved.ok || retry) return { ok: true, job: null, waiting: true };
    return fail(error);
  }
  const saved = await repository.savePreparation(job.id, job.subscriptionClaim, begun.preparation,
    { phase: 'ready', ...prepared });
  if (saved.stopped) return { ok: true, job: null };
  return saved.ok ? { ok: true, job: prepared.workerJob } : { ok: true, job: null, waiting: true };
}

module.exports = { prepareSubscriptionClaim };
