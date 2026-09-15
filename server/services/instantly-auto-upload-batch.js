const DEFAULT_AUTO_UPLOAD_BATCH_SIZE = 10;
const MAX_AUTO_UPLOAD_BATCH_SIZE = 25;
const GUARDED_PROVIDER_WARNING_CODES = new Set([
  'INSTANTLY_AUTO_LOCAL_LINK_FAILED',
  'INSTANTLY_AUTO_PROVIDER_PARTIAL_UPLOAD',
]);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function resolveAutoUploadBatchLimit(input = {}, config = {}) {
  const explicit = positiveInteger(input.limit);
  if (explicit) return Math.min(MAX_AUTO_UPLOAD_BATCH_SIZE, explicit);
  const configured = positiveInteger(config.batchSize) || DEFAULT_AUTO_UPLOAD_BATCH_SIZE;
  return Math.min(MAX_AUTO_UPLOAD_BATCH_SIZE, configured);
}

async function runInstantlyAutoUploadBatch(deps = {}) {
  const {
    runOne,
    input = {},
    config = {},
    now = () => new Date(),
  } = deps;
  if (typeof runOne !== 'function') {
    throw new TypeError('runOne is required');
  }

  const limit = resolveAutoUploadBatchLimit(input, config);
  let uploaded = 0;
  let attempted = 0;
  let reactivated = 0;
  const owners = { serve: 0, martijn: 0 };
  const campaigns = {};
  const warnings = [];
  let lastResult = null;

  for (let index = 0; index < limit; index += 1) {
    attempted += 1;
    let result;
    try {
      result = await runOne(input);
    } catch (error) {
      const code = String(error && error.code || '').trim();
      if (GUARDED_PROVIDER_WARNING_CODES.has(code)) {
        // These failures happen after permanent recipient guards are durable.
        // The affected row is no longer eligible for another upload, so it is
        // safe to continue with the next mail-ready lead without risking a duplicate.
        warnings.push(code);
        continue;
      }
      throw error;
    }

    lastResult = result && typeof result === 'object' ? result : null;
    const uploadedNow = Math.max(0, Math.floor(Number(lastResult && lastResult.uploaded) || 0));
    if (uploadedNow > 0) {
      uploaded += uploadedNow;
      const owner = String(lastResult.owner || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(owners, owner)) owners[owner] += uploadedNow;
      const campaignId = String(lastResult.campaignId || '').trim();
      if (campaignId) campaigns[campaignId] = (campaigns[campaignId] || 0) + uploadedNow;
      continue;
    }

    if (lastResult && lastResult.reason === 'accepted_campaign_reactivated') {
      reactivated += 1;
      continue;
    }

    if (lastResult && (lastResult.skipped === true || lastResult.ok === false)) break;
    break;
  }

  if (uploaded === 0 && warnings.length === 0 && reactivated === 0 && lastResult) {
    return lastResult;
  }

  return {
    ok: true,
    uploaded,
    attempted,
    batchLimit: limit,
    reactivated,
    owners,
    campaigns,
    warnings,
    partial: warnings.length > 0,
    skipped: uploaded === 0,
    reason: uploaded > 0 ? 'mailready_batch_synced' : (lastResult && lastResult.reason) || 'batch_completed',
    finishedAt: now().toISOString(),
  };
}

module.exports = {
  DEFAULT_AUTO_UPLOAD_BATCH_SIZE,
  MAX_AUTO_UPLOAD_BATCH_SIZE,
  resolveAutoUploadBatchLimit,
  runInstantlyAutoUploadBatch,
};
