const { randomUUID } = require('crypto');

function createWebsitePreviewBatchCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    aiToolsCoordinator = null,
    websitePreviewLibraryCoordinator = null,
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    batchScope = 'website_preview_batches',
    batchStorageKey = 'softora_website_preview_batches_v1',
    processJobsInline = process.env.VERCEL === '1' || process.env.VERCEL === 'true',
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_JOBS = 200;
  const MAX_URLS = 50;
  const ITEM_TIMEOUT_MS = 2 * 60 * 1000;
  const VALID_ITEM_STATUSES = new Set(['pending', 'running', 'done', 'error']);
  const VALID_JOB_STATUSES = new Set(['running', 'done', 'error']);

  function ownerKeyFromReq(req) {
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    return `${email}::${uid}`;
  }

  function ownerStubFromReq(req) {
    const pa = req?.premiumAuth;
    if (!pa || typeof pa !== 'object') return null;
    return {
      email: pa.email,
      userId: pa.userId,
      displayName: pa.displayName,
      authenticated: Boolean(pa.authenticated),
      role: pa.role,
    };
  }

  function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
      if (now - job.createdAt > JOB_TTL_MS) {
        jobs.delete(id);
      }
    }
    while (jobs.size > MAX_JOBS) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, job] of jobs.entries()) {
        if (job.createdAt < oldestAt) {
          oldestAt = job.createdAt;
          oldestId = id;
        }
      }
      if (oldestId) jobs.delete(oldestId);
      else break;
    }
  }

  function safeParseJsonObject(raw) {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function normalizeJobStatus(value, fallback = 'running') {
    const status = normalizeString(value || '').toLowerCase();
    return VALID_JOB_STATUSES.has(status) ? status : fallback;
  }

  function normalizeItemStatus(value, fallback = 'pending') {
    const status = normalizeString(value || '').toLowerCase();
    return VALID_ITEM_STATUSES.has(status) ? status : fallback;
  }

  function normalizeOwnerStub(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      email: normalizeString(source.email),
      userId: normalizeString(source.userId),
      displayName: normalizeString(source.displayName),
      authenticated: Boolean(source.authenticated),
      role: normalizeString(source.role),
    };
  }

  function normalizeStoredItem(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const url = normalizeUrlToken(source.url);
    if (!url) return null;
    let hostname = normalizeString(source.hostname || '');
    try {
      hostname = hostname || new URL(url).hostname;
    } catch (_) {}
    return {
      url,
      hostname,
      status: normalizeItemStatus(source.status),
      error: normalizeString(source.error || '') || null,
      libraryEntryId: normalizeString(source.libraryEntryId || '') || null,
    };
  }

  function normalizeStoredJob(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = normalizeString(source.id || '');
    if (!/^[a-f0-9-]{16,80}$/i.test(id)) return null;
    const ownerKey = normalizeString(source.ownerKey || '');
    if (!ownerKey) return null;
    const items = (Array.isArray(source.items) ? source.items : [])
      .map(normalizeStoredItem)
      .filter(Boolean);
    if (!items.length) return null;
    return {
      id,
      ownerKey,
      ownerStub: normalizeOwnerStub(source.ownerStub),
      status: normalizeJobStatus(source.status),
      currentIndex: Math.max(0, Math.min(items.length - 1, Number(source.currentIndex) || 0)),
      items,
      error: normalizeString(source.error || '') || null,
      createdAt: Math.max(0, Number(source.createdAt) || Date.now()),
      finishedAt: Number(source.finishedAt) || null,
      processing: false,
      processingStartedAt: null,
    };
  }

  function serializeJobForStorage(job) {
    return {
      id: job.id,
      ownerKey: job.ownerKey,
      ownerStub: normalizeOwnerStub(job.ownerStub),
      status: job.status,
      currentIndex: job.currentIndex,
      items: job.items.map((item) => ({
        url: item.url,
        hostname: item.hostname,
        status: item.status,
        error: item.error || null,
        libraryEntryId: item.libraryEntryId || null,
      })),
      error: job.error || null,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null,
    };
  }

  async function loadSharedJobMap() {
    if (typeof getUiStateValues !== 'function') return {};
    try {
      const state = await getUiStateValues(batchScope);
      const values = state && state.values && typeof state.values === 'object' ? state.values : {};
      return safeParseJsonObject(values[batchStorageKey]);
    } catch (error) {
      logger.error('[WebsitePreviewBatch][loadShared]', error?.message || error);
      return {};
    }
  }

  async function persistSharedJob(job) {
    if (typeof setUiStateValues !== 'function') return null;
    try {
      const existingMap = await loadSharedJobMap();
      const now = Date.now();
      const nextMap = {};
      Object.entries(existingMap).forEach(([id, rawJob]) => {
        const stored = normalizeStoredJob(rawJob);
        if (!stored) return;
        if (now - stored.createdAt > JOB_TTL_MS) return;
        nextMap[id] = serializeJobForStorage(stored);
      });
      nextMap[job.id] = serializeJobForStorage(job);
      return setUiStateValues(
        batchScope,
        { [batchStorageKey]: JSON.stringify(nextMap) },
        { source: 'website-preview-batch', actor: 'Premium websitegenerator' }
      );
    } catch (error) {
      logger.error('[WebsitePreviewBatch][persistShared]', error?.message || error);
      return null;
    }
  }

  async function loadSharedJob(jobId) {
    const sharedMap = await loadSharedJobMap();
    const job = normalizeStoredJob(sharedMap[jobId]);
    if (job) jobs.set(job.id, job);
    return job;
  }

  async function findLatestSharedJobForOwner(ownerKey, statusSet) {
    const sharedMap = await loadSharedJobMap();
    let latest = null;
    Object.values(sharedMap).forEach((rawJob) => {
      const job = normalizeStoredJob(rawJob);
      if (!job || job.ownerKey !== ownerKey) return;
      if (statusSet && statusSet.size && !statusSet.has(job.status)) return;
      if (!latest || job.createdAt > latest.createdAt) latest = job;
    });
    if (latest) jobs.set(latest.id, latest);
    return latest;
  }

  function normalizeUrlToken(chunk) {
    let u = normalizeString(chunk);
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) {
      u = `https://${u.replace(/^\/+/, '')}`;
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch (_) {
      return null;
    }
  }

  function buildNormalizedUrlList(rawList) {
    const seen = new Set();
    const out = [];
    const list = Array.isArray(rawList) ? rawList : [];
    for (const chunk of list) {
      const u = normalizeUrlToken(chunk);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= MAX_URLS) break;
    }
    return out;
  }

  function serializeJob(job) {
    return {
      id: job.id,
      status: job.status,
      total: job.items.length,
      currentIndex: job.currentIndex,
      items: job.items.map((item) => ({
        url: item.url,
        hostname: item.hostname,
        status: item.status,
        error: item.error || null,
        libraryEntryId: item.libraryEntryId || null,
      })),
      error: job.error || null,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null,
      processing: Boolean(job.processing),
    };
  }

  function findLatestJobForOwner(ownerKey, statusSet) {
    let latest = null;
    for (const job of jobs.values()) {
      if (job.ownerKey !== ownerKey) continue;
      if (statusSet && statusSet.size && !statusSet.has(job.status)) continue;
      if (!latest || job.createdAt > latest.createdAt) {
        latest = job;
      }
    }
    return latest;
  }

  function findLatestRunningJobForOwner(ownerKey) {
    return findLatestJobForOwner(ownerKey, new Set(['running']));
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function queueJobProcessing(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running' || job.processing) return;
    job.processing = true;
    job.processingStartedAt = Date.now();
    void persistSharedJob(job);
    setImmediate(() => {
      processJob(jobId).catch((err) => {
        const currentJob = jobs.get(jobId);
        if (currentJob && currentJob.status === 'running') {
          currentJob.status = 'error';
          currentJob.error = String(err?.message || err || 'Batch mislukt');
          currentJob.finishedAt = Date.now();
          currentJob.processing = false;
          void persistSharedJob(currentJob);
        }
        logger.error('[WebsitePreviewBatch][processJob]', err?.message || err);
      });
    });
  }

  async function processJob(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') return;
    job.processing = true;
    job.processingStartedAt = Date.now();
    await persistSharedJob(job);

    const stub = job.ownerStub;
    if (!stub || !aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
      job.status = 'error';
      job.error = 'Serverconfiguratie ontbreekt voor batchverwerking.';
      job.finishedAt = Date.now();
      job.processing = false;
      await persistSharedJob(job);
      return;
    }

    const persist = websitePreviewLibraryCoordinator?.persistPreviewLibraryEntry;
    if (typeof persist !== 'function') {
      job.status = 'error';
      job.error = 'Bibliotheek-coördinator ontbreekt.';
      job.finishedAt = Date.now();
      job.processing = false;
      await persistSharedJob(job);
      return;
    }

    try {
      for (let i = 0; i < job.items.length; i += 1) {
        const item = job.items[i];
        item.status = 'running';
        job.currentIndex = i;
        await persistSharedJob(job);

        try {
          const payload = await withTimeout(
            aiToolsCoordinator.runWebsitePreviewGeneratePipeline(item.url),
            ITEM_TIMEOUT_MS,
            'Preview genereren duurde te lang. Probeer opnieuw of scan een lichtere URL.'
          );
          const img = payload?.image;
          const dataUrl = String(img?.dataUrl || '').trim();
          if (!dataUrl) {
            throw new Error('Geen previewafbeelding ontvangen van de server.');
          }

          const host = String(payload?.site?.host || item.hostname || '').trim() || item.hostname;
          const fileName = String(img?.fileName || `${host || 'site'}-preview.png`).trim();
          const saveResult = await persist(stub, {
            dataUrl,
            url: item.url,
            hostname: host,
            fileName,
            width: 1024,
            height: 1536,
          });

          if (!saveResult.ok || !saveResult.entry?.id) {
            const detail = saveResult.detail || saveResult.error || 'Opslaan mislukt';
            throw new Error(detail);
          }

          item.status = 'done';
          item.libraryEntryId = saveResult.entry.id;
          item.error = null;
        } catch (err) {
          item.status = 'error';
          item.error = String(err?.message || err || 'Onbekende fout');
          item.libraryEntryId = null;
        }
        await persistSharedJob(job);
      }

      job.status = 'done';
      job.finishedAt = Date.now();
    } catch (fatal) {
      job.status = 'error';
      job.error = String(fatal?.message || fatal || 'Batch mislukt');
      job.finishedAt = Date.now();
      logger.error('[WebsitePreviewBatch][Fatal]', fatal?.message || fatal);
    } finally {
      job.processing = false;
      await persistSharedJob(job);
    }
  }

  async function startBatchResponse(req, res) {
    pruneJobs();

    if (!aiToolsCoordinator || !websitePreviewLibraryCoordinator) {
      return res.status(503).json({
        ok: false,
        error: 'Website preview batch niet beschikbaar',
        detail: 'Servercomponent ontbreekt.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const urls = buildNormalizedUrlList(body.urls);
    if (!urls.length) {
      return res.status(400).json({
        ok: false,
        error: 'Geen geldige URL’s',
        detail: 'Stuur { urls: ["https://…"] } (max 50).',
      });
    }

    const ownerStub = ownerStubFromReq(req);
    if (!ownerStub) {
      return res.status(401).json({
        ok: false,
        error: 'Niet ingelogd',
        detail: 'Log in om een batch te starten.',
      });
    }

    const jobId = randomUUID();
    const items = urls.map((url) => {
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch (_) {
        hostname = '';
      }
      return {
        url,
        hostname,
        status: 'pending',
        error: null,
        libraryEntryId: null,
      };
    });

    const job = {
      id: jobId,
      ownerKey: ownerKeyFromReq(req),
      ownerStub,
      status: 'running',
      currentIndex: 0,
      items,
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
      processing: false,
      processingStartedAt: null,
    };

    jobs.set(jobId, job);
    await persistSharedJob(job);

    if (processJobsInline) {
      await processJob(jobId);
    } else {
      queueJobProcessing(jobId);
    }

    return res.status(202).json({
      ok: true,
      jobId,
      total: items.length,
    });
  }

  async function getBatchResponse(req, res) {
    pruneJobs();
    const jobId = normalizeString(req.params?.jobId || '');
    if (!jobId) {
      return res.status(400).json({
        ok: false,
        error: 'Job ontbreekt',
        detail: 'Geen geldige job-id.',
      });
    }

    let job = jobs.get(jobId);
    if (!job) {
      job = await loadSharedJob(jobId);
    }
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'Job niet gevonden',
        detail: 'De batch bestaat niet (meer) of is verlopen.',
      });
    }

    if (ownerKeyFromReq(req) !== job.ownerKey) {
      return res.status(403).json({
        ok: false,
        error: 'Geen toegang',
        detail: 'Deze batch hoort bij een andere sessie.',
      });
    }

    if (job.status === 'running' && !job.processing) {
      if (processJobsInline) {
        await processJob(job.id);
      } else {
        queueJobProcessing(job.id);
      }
    }

    return res.status(200).json({
      ok: true,
      job: serializeJob(job),
    });
  }

  async function getCurrentBatchResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    const localJob = findLatestJobForOwner(ownerKey);
    const sharedJob = await findLatestSharedJobForOwner(ownerKey);
    let job = localJob;
    if (sharedJob && (!job || sharedJob.createdAt > job.createdAt)) {
      job = sharedJob;
    }
    if (job && !job.processing) {
      if (job.status === 'running' && processJobsInline) {
        await processJob(job.id);
      } else {
        queueJobProcessing(job.id);
      }
    }
    return res.status(200).json({
      ok: true,
      job: job ? serializeJob(job) : null,
    });
  }

  return {
    startBatchResponse,
    getBatchResponse,
    getCurrentBatchResponse,
  };
}

module.exports = {
  createWebsitePreviewBatchCoordinator,
};
