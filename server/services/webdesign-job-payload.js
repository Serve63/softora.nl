const { buildWebsiteImageGenerationMetadata } = require('./website-image-generation-cost');
const { normalizeString } = require('./data-ops-serialization');

function normalizeWebdesignJobRetryPayload(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    attempts: Math.max(0, Math.floor(Number(source.attempts || 0) || 0)),
    nextAttemptAt: Math.max(0, Number(source.nextAttemptAt || 0) || 0) || null,
    lastRetryAt: Math.max(0, Number(source.lastRetryAt || 0) || 0) || null,
    lastRetryReason: normalizeString(source.lastRetryReason || '').slice(0, 500),
  };
}

function buildWebdesignJobPayload(job = {}) {
  const retry = normalizeWebdesignJobRetryPayload(job.retry);
  const payload = { customer: job.customer && typeof job.customer === 'object' ? job.customer : {} };
  if (job.variant) payload.variant = normalizeString(job.variant).slice(0, 80);
  if (job.batchId) payload.batchId = normalizeString(job.batchId).slice(0, 120);
  if (Number.isFinite(Number(job.batchTargetIndex))) {
    payload.batchTargetIndex = Math.max(0, Math.floor(Number(job.batchTargetIndex)));
  }
  if (job.cancelled === true) payload.cancelled = true;
  if (job.generationAttempted === true) payload.generationAttempted = true;
  if (job.generation) payload.generation = buildWebsiteImageGenerationMetadata(job.generation);
  if (retry.attempts || retry.nextAttemptAt || retry.lastRetryAt || retry.lastRetryReason) payload.retry = retry;
  return payload;
}

module.exports = { normalizeWebdesignJobRetryPayload, buildWebdesignJobPayload };
