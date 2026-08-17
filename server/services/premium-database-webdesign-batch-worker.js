const { randomUUID } = require('crypto');

const WEBDESIGN_BULK_WORKER_LOCK_KEY = 'premium-webdesign-bulk-worker';
const WEBDESIGN_BULK_WORKER_LEASE_TTL_SECONDS = 900;

function createEmptyWorkerResult(patch = {}) {
  return {
    ok: true,
    statusCode: 200,
    batchCount: 0,
    processedJobs: 0,
    loadedJobs: 0,
    missingJobs: 0,
    completedTargets: 0,
    changedChunks: 0,
    batches: [],
    ...patch,
  };
}

async function runPremiumDatabaseWebdesignBatchWorker(options = {}, deps = {}) {
  const {
    logger = console,
    backgroundWorkerLeaseStore,
    pruneJobs,
    requiresPersistentBatchStorage,
    createBatchStorageUnavailableResult,
    listRunnableBatches,
    loadBatchChunks,
    driveBatch,
    processBatchJobsForWorker,
    serializeBatch,
    bulkWorkerBatchLimit,
  } = deps;

  pruneJobs();
  if (!requiresPersistentBatchStorage()) {
    return createBatchStorageUnavailableResult('batch-opslag controleren');
  }
  if (
    !backgroundWorkerLeaseStore ||
    typeof backgroundWorkerLeaseStore.claimBackgroundWorkerLease !== 'function' ||
    typeof backgroundWorkerLeaseStore.releaseBackgroundWorkerLease !== 'function'
  ) {
    return createBatchStorageUnavailableResult(
      'batch-workerlease claimen',
      new Error('Centrale background-workerlease ontbreekt')
    );
  }

  const lockToken = randomUUID();
  let lease;
  try {
    lease = await backgroundWorkerLeaseStore.claimBackgroundWorkerLease({
      lockKey: WEBDESIGN_BULK_WORKER_LOCK_KEY,
      lockToken,
      ttlSeconds: WEBDESIGN_BULK_WORKER_LEASE_TTL_SECONDS,
    });
  } catch (error) {
    return createBatchStorageUnavailableResult('batch-workerlease claimen', error);
  }
  if (!lease || lease.ok !== true) {
    return createBatchStorageUnavailableResult(
      'batch-workerlease claimen',
      lease?.error || new Error('Centrale background-workerlease gaf geen bevestiging')
    );
  }
  if (lease.acquired !== true) {
    return createEmptyWorkerResult({
      skipped: true,
      reason: 'coalesced',
      ...(lease.lockExpiresAt ? { lockExpiresAt: lease.lockExpiresAt } : {}),
    });
  }

  try {
    const batchLimit = Math.max(
      1,
      Math.min(bulkWorkerBatchLimit, Math.floor(Number(options.batchLimit) || bulkWorkerBatchLimit))
    );
    let runnableBatches;
    try {
      runnableBatches = await listRunnableBatches(batchLimit);
    } catch (error) {
      return createBatchStorageUnavailableResult('runnable batches lezen', error);
    }
    if (!Array.isArray(runnableBatches)) {
      return createBatchStorageUnavailableResult('runnable batches lezen', new Error('Geen batchlijst ontvangen'));
    }

    const result = createEmptyWorkerResult();
    for (const batch of runnableBatches) {
      if (!batch || !batch.id || !batch.ownerKey) continue;
      const chunksResult = await loadBatchChunks(batch.ownerKey, batch.id);
      if (chunksResult.error) continue;
      const drivenBefore = await driveBatch(batch, chunksResult.chunks || []);
      if (drivenBefore.storageError) {
        return createBatchStorageUnavailableResult(
          drivenBefore.storageError.action || 'batch-status opslaan',
          drivenBefore.storageError.error
        );
      }
      const workerResult = await processBatchJobsForWorker(drivenBefore.batch, drivenBefore.chunks, options);
      if (workerResult.storageError) {
        return createBatchStorageUnavailableResult(
          workerResult.storageError.action || 'batch-worker opslaan',
          workerResult.storageError.error
        );
      }
      const drivenAfter = await driveBatch(drivenBefore.batch, drivenBefore.chunks);
      if (drivenAfter.storageError) {
        return createBatchStorageUnavailableResult(
          drivenAfter.storageError.action || 'batch-status opslaan',
          drivenAfter.storageError.error
        );
      }
      result.batchCount += 1;
      result.processedJobs += workerResult.processedJobs;
      result.loadedJobs += workerResult.loadedJobs;
      result.missingJobs += workerResult.missingJobs;
      result.completedTargets += workerResult.completedTargets;
      result.changedChunks += workerResult.changedChunks;
      result.batches.push(serializeBatch(drivenAfter.batch, drivenAfter.chunks));
    }
    return result;
  } finally {
    try {
      const released = await backgroundWorkerLeaseStore.releaseBackgroundWorkerLease({
        lockKey: WEBDESIGN_BULK_WORKER_LOCK_KEY,
        lockToken,
      });
      if (!released || released.ok !== true) {
        logger.warn?.('[PremiumDatabaseWebdesignJobs][worker-lease-release]', released?.error?.message || 'release mislukt');
      }
    } catch (error) {
      logger.warn?.('[PremiumDatabaseWebdesignJobs][worker-lease-release]', error?.message || error);
    }
  }
}

module.exports = {
  WEBDESIGN_BULK_WORKER_LEASE_TTL_SECONDS,
  WEBDESIGN_BULK_WORKER_LOCK_KEY,
  runPremiumDatabaseWebdesignBatchWorker,
};
