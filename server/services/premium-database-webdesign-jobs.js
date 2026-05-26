const { randomUUID } = require('crypto');

function createPremiumDatabaseWebdesignJobsCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator = null,
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    dataOpsStore = null,
    photoScope = 'premium_database_photos',
    photoKey = 'softora_database_photos_v1',
    photoDataPrefix = 'softora_database_photo_data_v1_',
    jobProcessTimeoutMs = 4 * 60 * 1000,
    waitForRetry = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    processJobsInline = process.env.VERCEL === '1' || process.env.VERCEL === 'true',
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const JOB_PROCESS_TIMEOUT_MS = Math.max(100, Math.min(10 * 60 * 1000, Number(jobProcessTimeoutMs) || 0));
  const MAX_JOBS = 500;
  const CHUNK_SIZE = 180000;
  const MAX_STORAGE_CHUNKS = 80;
  const DATABASE_PHOTO_IMAGE_SIZE = '1024x1536';
  const ADMIN_TEAM_OWNER_KEY = 'softora-admin-team';
  const RATE_LIMIT_RETRY_ATTEMPTS = 4;
  const RATE_LIMIT_RETRY_FALLBACK_MS = 15000;
  const RATE_LIMIT_RETRY_MAX_MS = 65000;
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
    if (hasAdminTeamAccess(req)) return ADMIN_TEAM_OWNER_KEY;
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    return email || uid ? `${email}::${uid}` : '';
  }

  function hasAdminTeamAccess(req) {
    const auth = req?.premiumAuth || {};
    const role = normalizeString(auth.role || auth.rol || '').toLowerCase();
    return Boolean(auth.authenticated && (auth.isAdmin || role === 'admin'));
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

  function getErrorMessage(error) {
    return [
      error && error.message,
      error && error.data && error.data.error && error.data.error.message,
      error && error.data && error.data.error && error.data.error.detail,
      error && error.data && error.data.detail,
    ]
      .map((value) => normalizeString(value))
      .filter(Boolean)
      .join(' ');
  }

  function isRateLimitError(error) {
    const status = Number(error && (error.status || error.statusCode)) || 0;
    if (status === 429) return true;
    return /rate limit|too many requests|try again in/i.test(getErrorMessage(error));
  }

  function getRateLimitRetryMs(error) {
    const message = getErrorMessage(error);
    const secondsMatch = message.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
    const parsedMs = secondsMatch ? Math.ceil(Number(secondsMatch[1]) * 1000) + 1000 : RATE_LIMIT_RETRY_FALLBACK_MS;
    const safeMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : RATE_LIMIT_RETRY_FALLBACK_MS;
    return Math.max(1000, Math.min(RATE_LIMIT_RETRY_MAX_MS, safeMs));
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

  async function persistJob(job) {
    if (!dataOpsStore || typeof dataOpsStore.upsertWebdesignJob !== 'function') return null;
    try {
      const saved = await dataOpsStore.upsertWebdesignJob(job);
      return saved && saved.ok ? saved : null;
    } catch (error) {
      logger.error('[PremiumDatabaseWebdesignJobs][persist]', error && error.message ? error.message : error);
      return null;
    }
  }

  async function loadPersistentJob(jobId) {
    if (!dataOpsStore || typeof dataOpsStore.getWebdesignJob !== 'function') return null;
    try {
      return dataOpsStore.getWebdesignJob(jobId);
    } catch (error) {
      logger.error('[PremiumDatabaseWebdesignJobs][load]', error && error.message ? error.message : error);
      return null;
    }
  }

  async function findRunningJobForCustomer(ownerKey, customerId, options = {}) {
    const adminTeamAccess = Boolean(options.adminTeamAccess);
    if (dataOpsStore && typeof dataOpsStore.findRunningWebdesignJob === 'function') {
      const persistent =
        adminTeamAccess && typeof dataOpsStore.findRunningWebdesignJobForAdmin === 'function'
          ? await dataOpsStore.findRunningWebdesignJobForAdmin(customerId)
          : await dataOpsStore.findRunningWebdesignJob(ownerKey, customerId);
      if (persistent) {
        jobs.set(persistent.id, persistent);
        return persistent;
      }
    }
    for (const job of jobs.values()) {
      if (!adminTeamAccess && job.ownerKey !== ownerKey) continue;
      if (job.customer.id !== customerId) continue;
      if (job.status === 'queued' || job.status === 'running') return job;
    }
    return null;
  }

  async function getVisibleJobsForOwner(ownerKey, options = {}) {
    const adminTeamAccess = Boolean(options.adminTeamAccess);
    const byId = new Map();
    if (dataOpsStore && typeof dataOpsStore.listVisibleWebdesignJobs === 'function') {
      const persistentJobs =
        adminTeamAccess && typeof dataOpsStore.listVisibleWebdesignJobsForAdmin === 'function'
          ? await dataOpsStore.listVisibleWebdesignJobsForAdmin()
          : await dataOpsStore.listVisibleWebdesignJobs(ownerKey);
      (Array.isArray(persistentJobs) ? persistentJobs : []).forEach((job) => {
        if (job && job.id) {
          jobs.set(job.id, job);
          byId.set(job.id, job);
        }
      });
    }
    Array.from(jobs.values())
      .filter((job) => adminTeamAccess || job.ownerKey === ownerKey)
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values()).sort((left, right) => left.createdAt - right.createdAt);
  }

  function canAccessJob(req, job, ownerKey) {
    if (!job) return false;
    if (hasAdminTeamAccess(req)) return true;
    return job.ownerKey === ownerKey;
  }

  async function persistGeneratedPhoto(job, image) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') {
      throw new Error('Databasefoto-opslag is niet beschikbaar.');
    }

    const dataUrl = normalizeString(image && image.dataUrl);
    if (!isValidImageDataUrl(dataUrl)) {
      throw new Error('De AI gaf geen geldige afbeelding terug.');
    }

    const customer = job.customer;
    if (dataOpsStore && typeof dataOpsStore.uploadDesignPhoto === 'function') {
      const structured = await dataOpsStore.uploadDesignPhoto(
        {
          customerId: customer.id,
          dataUrl,
          identityKey: buildCustomerIdentityKey(customer),
          fileName: truncateText(normalizeString(image.fileName || `${customer.dom || customer.bedrijf || 'webdesign'}-webdesign.png`), 180),
          legacyMeta: {
            id: customer.id,
            identityKey: buildCustomerIdentityKey(customer),
            websitePhotoName: truncateText(normalizeString(image.fileName || `${customer.dom || customer.bedrijf || 'webdesign'}-webdesign.png`), 180) || 'Websitefoto',
            updatedAt: new Date().toISOString().slice(0, 10),
          },
        },
        { source: 'premium-database-webdesign-jobs' }
      );
      if (structured && structured.ok) return;
    }

    const state = await getUiStateValues(photoScope);
    if (!state) throw new Error('Databasefoto-opslag kon niet worden geladen.');

    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const existingMap = safeParseJsonObject(values[photoKey]);
    const photoDataKey = buildDataKey(customer.id);
    const chunks = dataUrl.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [];
    if (chunks.length > MAX_STORAGE_CHUNKS) {
      throw new Error('De AI-foto was te groot om betrouwbaar op te slaan. Probeer het opnieuw.');
    }
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

  async function generateWebsitePreviewWithRetry(job) {
    if (!aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
      throw new Error('Websitegenerator is niet beschikbaar.');
    }

    for (let attempt = 1; attempt <= RATE_LIMIT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await aiToolsCoordinator.runWebsitePreviewGeneratePipeline(job.websiteUrl, {
          allowScanFallback: true,
          imageSize: DATABASE_PHOTO_IMAGE_SIZE,
          body: {
            source: 'premium-database',
            action: 'webdesign',
            company: job.customer.bedrijf,
            domain: job.customer.dom,
          },
        });
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= RATE_LIMIT_RETRY_ATTEMPTS) throw error;
        const retryMs = getRateLimitRetryMs(error);
        if (logger && typeof logger.warn === 'function') {
          logger.warn(
            `[PremiumDatabaseWebdesignJobs][rate-limit] OpenAI rate limit, retry over ${Math.round(retryMs / 1000)}s`
          );
        }
        await waitForRetry(retryMs);
      }
    }

    throw new Error('Websitegenerator is mislukt.');
  }

  async function processJob(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    await persistJob(job);

    const payload = await generateWebsitePreviewWithRetry(job);

    await persistGeneratedPhoto(job, payload && payload.image);
  }

  function withJobProcessTimeout(job, promise) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Webdesign maken duurde te lang (${Math.round(JOB_PROCESS_TIMEOUT_MS / 1000)}s). Probeer het opnieuw.`));
      }, JOB_PROCESS_TIMEOUT_MS);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  async function settleJob(job) {
    try {
      await withJobProcessTimeout(job, processJob(job));
      job.status = 'done';
      job.error = null;
      job.finishedAt = Date.now();
      await persistJob(job);
    } catch (error) {
      job.status = 'error';
      job.error = truncateText(normalizeString(error && error.message) || 'Webdesign maken is mislukt.', 500);
      job.finishedAt = Date.now();
      logger.error('[PremiumDatabaseWebdesignJobs][process]', error && error.message ? error.message : error);
      await persistJob(job);
    }
    return job;
  }

  function queueProcessing() {
    if (processing) return;
    const next = Array.from(jobs.values()).find((job) => job.status === 'queued');
    if (!next) return;

    processing = true;
    setImmediate(() => {
      settleJob(next)
        .finally(() => {
          processing = false;
          queueProcessing();
        });
    });
  }

  async function startJobResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    const adminTeamAccess = hasAdminTeamAccess(req);
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

    const existing = await findRunningJobForCustomer(ownerKey, customer.id, { adminTeamAccess });
    if (existing) {
      return res.status(202).json({
        ok: true,
        job: serializeJob(existing),
      });
    }

    const requestedJobId = normalizeJobId(body.jobId);
    const jobId = requestedJobId || randomUUID();
    const existingById = jobs.get(jobId) || await loadPersistentJob(jobId);
    if (existingById) {
      jobs.set(existingById.id, existingById);
      if (!canAccessJob(req, existingById, ownerKey)) {
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
    await persistJob(job);
    if (processJobsInline) {
      await settleJob(job);
    } else {
      queueProcessing();
    }

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

    const job = jobs.get(jobId) || await loadPersistentJob(jobId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'Job niet gevonden',
      });
    }
    if (!canAccessJob(req, job, ownerKey)) {
      return res.status(403).json({
        ok: false,
        error: 'Geen toegang',
      });
    }
    jobs.set(job.id, job);
    if (job.status === 'queued') queueProcessing();

    return res.status(200).json({
      ok: true,
      job: serializeJob(job),
    });
  }

  async function listJobsResponse(req, res) {
    pruneJobs();
    const ownerKey = ownerKeyFromReq(req);
    const adminTeamAccess = hasAdminTeamAccess(req);
    if (!ownerKey) {
      return res.status(401).json({
        ok: false,
        error: 'Niet ingelogd',
      });
    }
    queueProcessing();

    return res.status(200).json({
      ok: true,
      jobs: (await getVisibleJobsForOwner(ownerKey, { adminTeamAccess })).map(serializeJob),
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
