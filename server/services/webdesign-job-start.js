const { createHash, randomUUID } = require('node:crypto');
const { subscriptionReuseConflict } = require('./webdesign-subscription');
const { normalizeWebdesignVariant } = require('./design-photo-generation-policy');
const { assignWebdesignOwner } = require('./webdesign-owner-assignment');

function createWebdesignJobStarter(deps) {
  const { pruneJobs, normalizeString, normalizeCustomer, normalizeWebsiteUrl, normalizeJobId,
    findRunningJobForCustomer, logPersistentJobLoadError, createWebdesignJobStatusUnavailableResult,
    serializeJob, jobs, loadPersistentJobResult, isExpiredJob, dataOpsStore, logger, now,
    normalizeRetryState, persistJob, requiresPersistentJobStorage, processJobsInline, queueProcessing } = deps;
  return async function startJob(input = {}) {
    pruneJobs();
    const ownerKey = normalizeString(input.ownerKey);
    if (!ownerKey) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Niet ingelogd',
        detail: "Log in om webdesignfoto's te maken.",
      };
    }

    const customer = normalizeCustomer(input.customer || input);
    const websiteUrl = normalizeWebsiteUrl(input.websiteUrl || customer.website || customer.dom);
    if (!customer.id || !customer.bedrijf || !websiteUrl) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Onvolledige webdesign-opdracht',
        detail: 'Stuur minimaal customer.id, customer.bedrijf en websiteUrl mee.',
      };
    }

    const batchId = normalizeJobId(input.batchId);
    const targetIndex = input.batchTargetIndex != null && Number.isFinite(Number(input.batchTargetIndex))
      ? Math.max(0, Math.floor(Number(input.batchTargetIndex))) : null;
    const batchTarget = batchId && targetIndex !== null;
    let existing = null;
    try {
      if (batchTarget && dataOpsStore?.findWebdesignBatchTargetJob) {
        existing = await dataOpsStore.findWebdesignBatchTargetJob(ownerKey, batchId, targetIndex);
      }
      if (!existing) existing = await findRunningJobForCustomer(ownerKey, customer.id);
    } catch (error) {
      logPersistentJobLoadError(error);
      return createWebdesignJobStatusUnavailableResult();
    }
    if (existing) {
      if (subscriptionReuseConflict(input, existing)) return subscriptionReuseConflict(input, existing);
      return {
        ok: true,
        statusCode: 202,
        job: serializeJob(existing),
        existing: true,
      };
    }

    const requestedJobId = normalizeJobId(input.jobId);
    const jobId = requestedJobId || (batchTarget ? 'webdesign_target_' + createHash('sha256')
      .update(JSON.stringify([ownerKey, batchId, targetIndex])).digest('hex').slice(0, 40)
      : randomUUID());
    let existingById = jobs.get(jobId);
    if (!existingById) {
      const loadedById = await loadPersistentJobResult(jobId);
      if (loadedById.error) return createWebdesignJobStatusUnavailableResult();
      existingById = loadedById.job;
    }
    if (existingById && !batchTarget && isExpiredJob(existingById)) {
      jobs.delete(existingById.id);
      existingById = null;
    }
    if (existingById) {
      jobs.set(existingById.id, existingById);
      if (existingById.ownerKey !== ownerKey) {
        return {
          ok: false,
          statusCode: 403,
          error: 'Geen toegang',
          detail: 'Deze webdesign-opdracht hoort bij een andere sessie.',
        };
      }
      if (subscriptionReuseConflict(input, existingById)) return subscriptionReuseConflict(input, existingById);
      return {
        ok: true,
        statusCode: 202,
        job: serializeJob(existingById),
        existing: true,
      };
    }
    const ownerAssignment = await assignWebdesignOwner(customer, dataOpsStore, logger);
    if (!ownerAssignment.ok) return ownerAssignment;
    let job = {
      id: jobId,
      ownerKey, assignedDesignOwnerEmail: ownerAssignment.ownerEmail,
      executionProvider: input.executionProvider === 'codex-subscription' ? 'codex-subscription' : 'api',
      customer,
      websiteUrl,
      variant: normalizeWebdesignVariant(input.variant),
      status: 'queued',
      error: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      retry: normalizeRetryState(),
      batchId,
      batchTargetIndex: targetIndex,
    };
    let persisted;
    try {
      // A losing starter must read the winner, never overwrite running/done work.
      if (batchTarget && dataOpsStore?.createWebdesignJobIfAbsent) {
        persisted = await dataOpsStore.createWebdesignJobIfAbsent(job);
        if (persisted?.job) job = persisted.job;
      } else persisted = await persistJob(job);
    } catch (error) {
      logPersistentJobLoadError(error);
    }
    if (requiresPersistentJobStorage() && (!persisted || persisted.ok === false)) {
      jobs.delete(job.id);
      return {
        ok: false,
        statusCode: 503,
        error: 'Webdesign-opdracht opslaan mislukt',
        detail: 'De webdesign-opdracht kon tijdelijk niet veilig worden opgeslagen. Probeer opnieuw.',
      };
    }
    const conflict = subscriptionReuseConflict(input, job);
    if (conflict) return conflict;
    jobs.set(job.id, job);
    if (!processJobsInline) {
      queueProcessing();
    }
    return {
      ok: true,
      statusCode: 202,
      job: serializeJob(job),
      existing: false,
    };
  };
}

module.exports = { createWebdesignJobStarter };
