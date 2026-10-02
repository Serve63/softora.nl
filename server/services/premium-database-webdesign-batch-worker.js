const { randomUUID } = require('crypto');
const { OWNER_KEY } = require('./nightly-mail-stock');

const WEBDESIGN_BULK_WORKER_LOCK_KEY = 'premium-webdesign-bulk-worker';
const WEBDESIGN_BULK_WORKER_LEASE_TTL_SECONDS = 900;

function resolveWorkerConcurrency(batch, options = {}, { bulkWorkerConcurrency = 2, processingConcurrency = 6 } = {}) {
  const limit = batch?.ownerKey === OWNER_KEY ? Math.min(4, processingConcurrency) : bulkWorkerConcurrency;
  return Math.max(1, Math.min(limit, Math.floor(Number(options.concurrency) || limit)));
}

function resolveWorkerJobLimit(batch, options, concurrency, bulkWorkerJobLimit) {
  const limit = batch?.ownerKey === OWNER_KEY ? concurrency : Math.min(concurrency, bulkWorkerJobLimit);
  return Math.max(1, Math.min(limit, Math.floor(Number(options.jobLimit) || limit)));
}

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
    bulkWorkerConcurrency = 2,
    processingConcurrency = 6,
    nightlyMailStockService,
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

  const invocationStartedAt = Date.now();
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
    const nightlyStock = nightlyMailStockService ? await nightlyMailStockService.runDueCheck() : null;
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

    const result = createEmptyWorkerResult(nightlyStock ? { nightlyStock } : {});
    // A job can take 600 seconds. Never start another wave in an 800s function.
    for (const batch of runnableBatches) {
      if (result.batchCount || Date.now() - invocationStartedAt > 100000) break;
      if (!batch || !batch.id || !batch.ownerKey) continue;
      if (batch.ownerKey === OWNER_KEY && ['disabled', 'budget_exhausted', 'stock_check_unavailable'].includes(nightlyStock?.reason)) continue;
      const chunksResult = await loadBatchChunks(batch.ownerKey, batch.id);
      if (chunksResult.error) continue;
      const drivenBefore = await driveBatch(batch, chunksResult.chunks || []);
      if (drivenBefore.storageError) {
        return createBatchStorageUnavailableResult(
          drivenBefore.storageError.action || 'batch-status opslaan',
          drivenBefore.storageError.error
        );
      }
      const concurrency = resolveWorkerConcurrency(batch, options, { bulkWorkerConcurrency, processingConcurrency });
      const waveOptions = { ...options, concurrency, jobLimit: Math.min(concurrency, Math.max(1, Number(options.jobLimit) || concurrency)) };
      const workerResult = await processBatchJobsForWorker(drivenBefore.batch, drivenBefore.chunks, waveOptions);
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

async function sendBatchWorkerResponse(req, res, runBatchWorker, nightlyMailStockService) {
  if (req.query?.mailStockStatus === '1' && nightlyMailStockService) {
    return sendMailStockStatusResponse(res, nightlyMailStockService);
  }
  const result = await runBatchWorker({
    batchLimit: req.query?.batchLimit || req.body?.batchLimit,
    jobLimit: req.query?.jobLimit || req.body?.jobLimit,
    concurrency: req.query?.concurrency || req.body?.concurrency,
  });
  const statusCode = Math.max(100, Math.min(599, Number(result.statusCode) || (result.ok ? 200 : 500)));
  return res.status(statusCode).json(result);
}

async function sendMailStockStatusResponse(res, nightlyMailStockService) {
  try { return res.status(200).json(await nightlyMailStockService.getStatus({ includeInventory: true })); }
  catch (_error) { return res.status(503).json({ ok: false, code: 'MAIL_STOCK_STATUS_UNAVAILABLE' }); }
}

module.exports = {
  resolveWorkerConcurrency, resolveWorkerJobLimit,
  WEBDESIGN_BULK_WORKER_LEASE_TTL_SECONDS,
  WEBDESIGN_BULK_WORKER_LOCK_KEY,
  runPremiumDatabaseWebdesignBatchWorker,
  sendBatchWorkerResponse,
  sendMailStockStatusResponse,
};
