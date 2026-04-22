const { randomUUID } = require('crypto');

function createWebsitePreviewBatchCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    aiToolsCoordinator = null,
    websitePreviewLibraryCoordinator = null,
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_JOBS = 200;
  const MAX_URLS = 50;

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
    };
  }

  async function processJob(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') return;

    const stub = job.ownerStub;
    if (!stub || !aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
      job.status = 'error';
      job.error = 'Serverconfiguratie ontbreekt voor batchverwerking.';
      job.finishedAt = Date.now();
      return;
    }

    const persist = websitePreviewLibraryCoordinator?.persistPreviewLibraryEntry;
    if (typeof persist !== 'function') {
      job.status = 'error';
      job.error = 'Bibliotheek-coördinator ontbreekt.';
      job.finishedAt = Date.now();
      return;
    }

    try {
      for (let i = 0; i < job.items.length; i += 1) {
        const item = job.items[i];
        item.status = 'running';
        job.currentIndex = i;

        try {
          const payload = await aiToolsCoordinator.runWebsitePreviewGeneratePipeline(item.url);
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
      }

      job.status = 'done';
      job.finishedAt = Date.now();
    } catch (fatal) {
      job.status = 'error';
      job.error = String(fatal?.message || fatal || 'Batch mislukt');
      job.finishedAt = Date.now();
      logger.error('[WebsitePreviewBatch][Fatal]', fatal?.message || fatal);
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
    };

    jobs.set(jobId, job);

    setImmediate(() => {
      processJob(jobId).catch((err) => {
        logger.error('[WebsitePreviewBatch][processJob]', err?.message || err);
      });
    });

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

    const job = jobs.get(jobId);
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

    return res.status(200).json({
      ok: true,
      job: serializeJob(job),
    });
  }

  return {
    startBatchResponse,
    getBatchResponse,
  };
}

module.exports = {
  createWebsitePreviewBatchCoordinator,
};
