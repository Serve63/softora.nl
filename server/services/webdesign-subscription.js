'use strict';
const { createHash } = require('node:crypto');
const { buildWebdesignPipelineOptions } = require('./design-photo-generation-policy');
const { createWebsiteGenerationHelpers } = require('./website-generation');
const { buildWebsitePreviewPromptFromScan } = createWebsiteGenerationHelpers();
const isSubscriptionJob = (job) => job?.executionProvider === 'codex-subscription';
function isExpiredWebdesignJob(job, currentTime, ttlMs) {
  // Waiting on a Mac or quota must not expire a durable subscription queue.
  if (isSubscriptionJob(job) && ['queued', 'running'].includes(job.status)) return false;
  const referenceTime = Number(isSubscriptionJob(job) ? job.finishedAt || job.createdAt : job?.createdAt) || 0;
  return !referenceTime || currentTime - referenceTime > ttlMs;
}
function subscriptionReuseConflict(input, existing) {
  if (isSubscriptionJob(input) && !isSubscriptionJob(existing)) return {
    ok: false, statusCode: 409, error: 'Er loopt al een serveropdracht voor dit bedrijf.',
    detail: 'Wacht tot die opdracht klaar is. Handmatige ontwerpen gebruiken uitsluitend je abonnement.',
  };
  return null;
}

async function refreshWebdesignMailReady(job, service, logger = console) {
  if (job.customer.webdesignMailProvider === 'instantly') { service?.invalidate?.(); return; }
  if (!service?.markCustomersMailReadyAfterAssetUpsert) return;
  try {
    const updated = await service.markCustomersMailReadyAfterAssetUpsert([job.customer.id]);
    if (!updated) logger.warn?.('[PremiumDatabaseWebdesignJobs][mail-ready-snapshot]', job.customer.id);
  } catch (error) {
    logger.warn?.('[PremiumDatabaseWebdesignJobs][mail-ready-snapshot]', error.message);
    service.invalidate?.();
  }
}

async function startManualWebdesignBatchResponse(req, res, deps) {
  const { ownerKeyFromReq, requiresPersistentBatchStorage, createBatchStorageUnavailableResult, createBatchId, loadBatch, now, persistBatch, serializeBatch } = deps;
  const ownerKey = ownerKeyFromReq(req);
  if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
  if (!requiresPersistentBatchStorage()) {
    const result = createBatchStorageUnavailableResult('batch-opslag controleren');
    return res.status(result.statusCode).json(result);
  }
  const requestId = String(req.body?.requestId || '');
  if (requestId && !/^[a-z0-9_-]{16,100}$/i.test(requestId)) return res.status(400).json({ ok: false, error: 'Ongeldige batchaanvraag.' });
  const id = requestId ? 'webdesign_batch_' + createHash('sha256').update(ownerKey + ':' + requestId).digest('hex').slice(0, 32) : createBatchId();
  if (requestId) {
    const existing = await loadBatch(ownerKey, id);
    if (existing.error) return res.status(503).json(createBatchStorageUnavailableResult('batch-aanvraag herstellen', existing.error));
    if (existing.batch) return res.status(202).json({ ok: true, batch: serializeBatch(existing.batch, []) });
  }
  const batch = { id, ownerKey, executionProvider: deps.manualExecutionProvider || 'codex-subscription', status: 'queued',
    total: Math.max(0, Math.floor(Number(req.body?.total || 0) || 0)), expectedChunks: 0, uploadedTargets: 0,
    createdAt: now(), startedAt: null, finishedAt: null, summary: {}, lastError: '' };
  const saved = await persistBatch(batch, 'batch starten opslaan');
  if (!saved || saved.ok !== true) {
    const result = createBatchStorageUnavailableResult(saved?.action || 'batch starten opslaan', saved?.error);
    return res.status(result.statusCode).json(result);
  }
  return res.status(202).json({ ok: true, batch: serializeBatch(batch, []) });
}

// Called only after the existing KVK worker bearer-token gate.
function createWebdesignSubscriptionService({ repository, aiToolsCoordinator, coordinator }) {
  return {
    async poll(req, res) {
      const claim = String(req.body?.claim || '');
      if (!/^[a-f0-9-]{36}$/.test(claim)) return res.status(400).json({ ok: false, error: 'Ongeldige opdrachtoverdracht.' });
      if (req.body?.heartbeatJobId) {
        const id = String(req.body.heartbeatJobId);
        if (!/^[a-z0-9_-]{16,120}$/i.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldige opdracht.' });
        const result = await repository.heartbeat(id, claim);
        return res.json({ ok: true, allowed: result.ok === true && result.allowed === true });
      }
      const claimed = await repository.claim(claim);
      if (!claimed.job) return res.json({ ok: true, job: null });
      const job = claimed.job;
      try {
        const { generationScan } = await aiToolsCoordinator.prepareWebsitePreviewImage(job.websiteUrl,
          buildWebdesignPipelineOptions({ source: 'premium-database', company: job.customer.bedrijf, domain: job.customer.dom }));
        return res.json({ ok: true, job: { id: job.id, claim: job.subscriptionClaim,
          prompt: buildWebsitePreviewPromptFromScan({ ...generationScan, referenceImageCount: 1 }),
          referenceUrls: generationScan.referenceImageUrls, company: job.customer.bedrijf } });
      } catch (error) {
        await repository.finish(job.id, job.subscriptionClaim, 'Websiteanalyse mislukt: ' + String(error.message || 'Website niet bereikbaar.').slice(0, 500));
        throw error;
      }
    },
    async complete(req, res) {
      const body = req.body || {};
      if (!/^[a-z0-9_-]{16,120}$/i.test(body.jobId || '') || !/^[a-f0-9-]{36}$/.test(body.claim || '')) {
        return res.status(400).json({ ok: false, error: 'Ongeldige opdracht.' });
      }
      const begun = await repository.begin(body.jobId, body.claim);
      if (!begun.ok) return res.status(409).json({ ok: false, code: begun.reason === 'saving' ? 'WEBDESIGN_SAVING' : 'WEBDESIGN_STOPPED', error: 'Opdracht is gestopt of wordt al opgeslagen.' });
      if (begun.done) return res.json({ ok: true, done: true });
      if (body.error) {
        await repository.finish(body.jobId, body.claim, body.errorKind === 'subscription-limit'
          ? 'Je abonnementlimiet is bereikt. De wachtrij pauzeert en controleert later opnieuw; er wordt geen API gebruikt.'
          : 'Codex kon het ontwerp niet maken via je abonnement. Controleer Codex op je Mac en probeer opnieuw.');
        return res.json({ ok: true, done: true });
      }
      const dataUrl = String(body.dataUrl || '');
      if (dataUrl.length > 4_000_000 || !/^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i.test(dataUrl)) {
        await repository.finish(body.jobId, body.claim, 'Codex gaf geen bruikbare afbeelding terug.');
        return res.json({ ok: true, done: true, error: 'Ongeldige afbeelding.' });
      }
      const job = begun.job;
      job.generation = { model: 'gpt-image-2', billingMode: 'subscription', size: '1024x1536', usage: null, cost: null };
      await coordinator.saveSubscriptionPhoto(job, { dataUrl, fileName: job.id + '-webdesign.jpg' });
      const finished = await repository.finish(body.jobId, body.claim);
      if (!finished.ok) return res.status(409).json({ ok: false, error: 'Opslagafsluiting niet bevestigd.' });
      return res.json({ ok: true, done: true });
    },
  };
}

module.exports = { isSubscriptionJob, isExpiredWebdesignJob, subscriptionReuseConflict, refreshWebdesignMailReady, startManualWebdesignBatchResponse, createWebdesignSubscriptionService };
