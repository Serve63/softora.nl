const { normalizeWebdesignVariant, WEBDESIGN_VARIANT_V2 } = require('./design-photo-generation-policy');

function createWebdesignDeliveryInterruptedError() {
  return Object.assign(new Error(
    'De ontwerpverwerking is onderbroken. Controleer eerst de opgeslagen websitefoto; er wordt niet automatisch opnieuw een ontwerp gemaakt.'
  ), { noAutomaticWebdesignRetry: true });
}

async function deliverWebdesignImage(job, {
  aiToolsCoordinator, persistJob, requiresPersistentJobStorage, persistGeneratedPhoto, assertActive,
  storageRetrySleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
}) {
  // This small marker lives in the existing durable job record, never the image
  // bytes. A restarted worker must not repeat an uncertain paid generation.
  if (job.generationAttempted === true) throw createWebdesignDeliveryInterruptedError();
  if (!aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
    throw new Error('Websitegenerator is niet beschikbaar.');
  }
  job.generationAttempted = true;
  const saved = await persistJob(job);
  if (requiresPersistentJobStorage() && !saved) {
    job.generationAttempted = false; // No provider call has happened.
    throw Object.assign(new Error('Webdesign-opdracht kon niet veilig worden vastgelegd.'), { retryableWebdesignStorage: true });
  }
  assertActive();
  const variant = normalizeWebdesignVariant(job.variant);
  const usesHomepageScreenshot = variant === WEBDESIGN_VARIANT_V2;
  let payload;
  try {
    payload = await aiToolsCoordinator.runWebsitePreviewGeneratePipeline(job.websiteUrl, {
      allowScanFallback: true,
      imageSize: '1024x1536',
      disableReferenceImages: !usesHomepageScreenshot,
      referenceImageMode: usesHomepageScreenshot ? 'homepage-screenshot' : 'prompt-only',
      requireReferenceImages: usesHomepageScreenshot,
      body: { source: 'premium-database', action: 'webdesign', variant, company: job.customer.bedrijf, domain: job.customer.dom },
    });
  } catch (error) {
    // Preserve existing provider/reference rejection retries, but not a process
    // deadline which leaves the provider operation running with an unknown result.
    if (!job.processingTimedOut) job.generationAttempted = false;
    throw error;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assertActive();
    try {
      await persistGeneratedPhoto(job, payload && payload.image);
      assertActive();
      return;
    } catch (error) {
      assertActive();
      if (!error || error.retryableWebdesignStorage !== true) throw error;
      if (attempt === 3) {
        throw Object.assign(new Error(
          'Het ontwerp is gemaakt, maar opslaan kon niet worden bevestigd. Controleer de websitefoto; er wordt niet automatisch een nieuw ontwerp gemaakt.'
        ), { noAutomaticWebdesignRetry: true, cause: error });
      }
      if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseWebdesignJobs][storage-retry]', job.id, attempt + 1);
      await storageRetrySleep(5000 * Math.pow(2, attempt));
    }
  }
}

module.exports = { deliverWebdesignImage, createWebdesignDeliveryInterruptedError };
