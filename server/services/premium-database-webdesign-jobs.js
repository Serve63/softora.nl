const { randomUUID } = require('crypto');

function createPremiumDatabaseWebdesignJobsCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator = null,
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    photoScope = 'premium_database_photos',
    photoKey = 'softora_database_photos_v1',
    photoDataPrefix = 'softora_database_photo_data_v1_',
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_JOBS = 500;
  const CHUNK_SIZE = 180000;
  let processing = false;

  function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
      if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
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
      if (!oldestId) break;
      jobs.delete(oldestId);
    }
  }

  function ownerKeyFromReq(req) {
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    return email || uid ? `${email}::${uid}` : '';
  }

  function normalizeJobId(value) {
    const id = normalizeString(value);
    return /^[a-z0-9_-]{16,120}$/i.test(id) ? id : '';
  }

  function normalizeWebsiteUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      if (!parsed.hostname || parsed.hostname.indexOf('.') === -1) return '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  }

  function normalizeCustomer(raw = {}) {
    return {
      id: truncateText(normalizeString(raw.id || raw.customerId), 120),
      bedrijf: truncateText(normalizeString(raw.bedrijf || raw.company || raw.companyName), 160),
      naam: truncateText(normalizeString(raw.naam || raw.contact || raw.contactName), 160),
      tel: truncateText(normalizeString(raw.tel || raw.telefoon || raw.phone), 80),
      dom: truncateText(normalizeString(raw.dom || raw.domain), 180),
      website: truncateText(normalizeString(raw.website || raw.websiteUrl || raw.url), 300),
    };
  }

  function normalizeSearchValue(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function buildCustomerIdentityKey(customer) {
    return [
      normalizeSearchValue(customer && customer.bedrijf),
      normalizeSearchValue(customer && customer.naam),
      normalizeSearchValue(customer && customer.tel),
    ].join('|');
  }

  function buildDataKey(customerId) {
    return photoDataPrefix + normalizeString(customerId).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
  }

  function isValidImageDataUrl(value) {
    return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(normalizeString(value));
  }

  function safeParseJsonObject(raw) {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function serializeJob(job) {
    return {
      id: job.id,
      status: job.status,
      customerId: job.customer.id,
      company: job.customer.bedrijf,
      error: job.error || null,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
    };
  }

  function findRunningJobForCustomer(ownerKey, customerId) {
    for (const job of jobs.values()) {
      if (job.ownerKey !== ownerKey) continue;
      if (job.customer.id !== customerId) continue;
      if (job.status === 'queued' || job.status === 'running') return job;
    }
    return null;
  }

  function getVisibleJobsForOwner(ownerKey) {
    return Array.from(jobs.values())
      .filter((job) => job.ownerKey === ownerKey)
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async function persistGeneratedPhoto(job, image) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') {
      throw new Error('Databasefoto-opslag is niet beschikbaar.');
    }

    const dataUrl = normalizeString(image && image.dataUrl);
    if (!isValidImageDataUrl(dataUrl)) {
      throw new Error('De AI gaf geen geldige afbeelding terug.');
    }

    const state = await getUiStateValues(photoScope);
    if (!state) throw new Error('Databasefoto-opslag kon niet worden geladen.');

    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const existingMap = safeParseJsonObject(values[photoKey]);
    const customer = job.customer;
    const photoDataKey = buildDataKey(customer.id);
    const chunks = dataUrl.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [];
    const patch = {};

    chunks.forEach((chunk, index) => {
      patch[`${photoDataKey}_${index}`] = chunk;
    });

    const existingMeta = existingMap[customer.id];
    const oldChunkCount = Math.max(0, Number(existingMeta && existingMeta.chunkCount) || 0);
    for (let index = chunks.length; index < oldChunkCount; index += 1) {
      patch[`${photoDataKey}_${index}`] = '';
    }

    const mergedMap = {
      ...existingMap,
      [customer.id]: {
        id: customer.id,
        identityKey: buildCustomerIdentityKey(customer),
        photoKey: photoDataKey,
        chunkCount: chunks.length,
        websitePhotoName:
          truncateText(normalizeString(image.fileName || `${customer.dom || customer.bedrijf || 'webdesign'}-webdesign.png`), 180) ||
          'Websitefoto',
        updatedAt: new Date().toISOString().slice(0, 10),
      },
    };

    const saved = await setUiStateValues(
      photoScope,
      {
        ...values,
        ...patch,
        [photoKey]: JSON.stringify(mergedMap),
      },
      {
        source: 'premium-database-webdesign-jobs',
        actor: 'Premium database',
      }
    );

    if (!saved) {
      throw new Error('Databasefoto opslaan is mislukt.');
    }
  }

  async function processJob(job) {
    job.status = 'running';
    job.startedAt = Date.now();

    if (!aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
      throw new Error('Websitegenerator is niet beschikbaar.');
    }

    const payload = await aiToolsCoordinator.runWebsitePreviewGeneratePipeline(job.websiteUrl, {
      allowScanFallback: true,
      body: {
        source: 'premium-database',
        action: 'webdesign',
        company: job.customer.bedrijf,
        domain: job.customer.dom,
      },
    });

    await persistGeneratedPhoto(job, payload && payload.image);
  }

  function queueProcessing() {
    if (processing) return;
    const next = Array.from(jobs.values()).find((job) => job.status === 'queued');
    if (!next) return;

    processing = true;
    setImmediate(() => {
      processJob(next)
        .then(() => {
          next.status = 'done';
          next.error = null;
          next.finishedAt = Date.now();
        })
        .catch((error) => {
          next.status = 'error';
          next.error = truncateText(normalizeString(error && error.message) || 'Webdesign maken is mislukt.', 500);
          next.finishedAt = Date.now();
          logger.error('[PremiumDatabaseWebdesignJobs][process]', error && error.message ? error.message : error);
        })
        .finally(() => {
          processing = false;
          queueProcessing();
        });
    });
  }

  async function startJobResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) {
      return res.status(401).json({
        ok: false,
        error: 'Niet ingelogd',
        detail: "Log in om webdesignfoto's te maken.",
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const customer = normalizeCustomer(body.customer || body);
    const websiteUrl = normalizeWebsiteUrl(body.websiteUrl || customer.website || customer.dom);
    if (!customer.id || !customer.bedrijf || !websiteUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Onvolledige webdesign-opdracht',
        detail: 'Stuur minimaal customer.id, customer.bedrijf en websiteUrl mee.',
      });
    }

    const existing = findRunningJobForCustomer(ownerKey, customer.id);
    if (existing) {
      return res.status(202).json({
        ok: true,
        job: serializeJob(existing),
      });
    }

    const requestedJobId = normalizeJobId(body.jobId);
    const jobId = requestedJobId || randomUUID();
    const existingById = jobs.get(jobId);
    if (existingById) {
      if (existingById.ownerKey !== ownerKey) {
        return res.status(403).json({
          ok: false,
          error: 'Geen toegang',
          detail: 'Deze webdesign-opdracht hoort bij een andere sessie.',
        });
      }
      return res.status(202).json({
        ok: true,
        job: serializeJob(existingById),
      });
    }

    const job = {
      id: jobId,
      ownerKey,
      customer,
      websiteUrl,
      status: 'queued',
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(job.id, job);
    queueProcessing();

    return res.status(202).json({
      ok: true,
      job: serializeJob(job),
    });
  }

  async function getJobResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) {
      return res.status(401).json({
        ok: false,
        error: 'Niet ingelogd',
      });
    }

    const jobId = normalizeJobId(req.params && req.params.jobId);
    if (!jobId) {
      return res.status(400).json({
        ok: false,
        error: 'Job ontbreekt',
      });
    }

    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'Job niet gevonden',
      });
    }
    if (job.ownerKey !== ownerKey) {
      return res.status(403).json({
        ok: false,
        error: 'Geen toegang',
      });
    }
    if (job.status === 'queued') queueProcessing();

    return res.status(200).json({
      ok: true,
      job: serializeJob(job),
    });
  }

  async function listJobsResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) {
      return res.status(401).json({
        ok: false,
        error: 'Niet ingelogd',
      });
    }
    queueProcessing();

    return res.status(200).json({
      ok: true,
      jobs: getVisibleJobsForOwner(ownerKey).map(serializeJob),
    });
  }

  return {
    getJobResponse,
    listJobsResponse,
    startJobResponse,
    _jobs: jobs,
  };
}

module.exports = {
  createPremiumDatabaseWebdesignJobsCoordinator,
};
