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
  if (job.executionProvider === 'codex-subscription') payload.executionProvider = 'codex-subscription';
  if (job.subscriptionClaim) payload.subscriptionClaim = job.subscriptionClaim;
  if (job.variant) payload.variant = normalizeString(job.variant).slice(0, 80);
  if (job.assignedDesignOwnerEmail) payload.assignedDesignOwnerEmail = normalizeString(job.assignedDesignOwnerEmail).toLowerCase().slice(0, 240);
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

function toMsFromIso(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }

function normalizeWebdesignJobRow(row = {}) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: normalizeString(row.job_id),
    ownerKey: normalizeString(row.owner_key),
    customer: payload.customer && typeof payload.customer === 'object' ? payload.customer : {},
    websiteUrl: normalizeString(row.website_url),
    status: normalizeString(row.status || 'queued').toLowerCase(),
    error: normalizeString(row.error || ''),
    createdAt: toMsFromIso(row.created_at) || Date.now(),
    startedAt: toMsFromIso(row.started_at),
    finishedAt: toMsFromIso(row.finished_at),
    retry: normalizeWebdesignJobRetryPayload(payload.retry),
    cancelled: payload.cancelled === true,
    generationAttempted: payload.generationAttempted === true, generation: payload.generation || null, assignedDesignOwnerEmail: normalizeString(payload.assignedDesignOwnerEmail).toLowerCase(),
    executionProvider: payload.executionProvider || '', subscriptionClaim: payload.subscriptionClaim || '',
    variant: normalizeString(payload.variant || ''),
    batchId: normalizeString(payload.batchId || ''),
    batchTargetIndex: Number.isFinite(Number(payload.batchTargetIndex))
      ? Math.max(0, Math.floor(Number(payload.batchTargetIndex)))
      : null,
  };
}


module.exports = { normalizeWebdesignJobRetryPayload, buildWebdesignJobPayload, normalizeWebdesignJobRow };
