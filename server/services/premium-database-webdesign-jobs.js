const { randomUUID } = require('crypto');

const DEVICE_MOCKUP_RENDERER = 'softora-server-device-v6';
let cachedSharp = null;

function loadSharpModule() {
  if (cachedSharp) return cachedSharp;
  cachedSharp = require('sharp');
  return cachedSharp;
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseImageDataUrl(value) {
  const match = String(value || '').trim().match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    mimeType: `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`,
    base64: match[2].replace(/\s+/g, ''),
  };
}

function replaceImageFileSuffix(value, suffix) {
  const raw = String(value || '').trim() || 'webdesign-preview.png';
  const clean = raw.replace(/\.[a-z0-9]+$/i, '');
  return `${clean}${suffix}.jpg`;
}

async function createDeviceMockupDataUrl(imageDataUrl, customer = {}, options = {}) {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) throw new Error('De webdesignfoto is niet geschikt voor een device-mockup.');
  const sharp = typeof options.loadSharpImpl === 'function' ? options.loadSharpImpl() : loadSharpModule();
  const embeddedImage = `data:${parsed.mimeType};base64,${parsed.base64}`;
  const companyName = escapeSvgText(customer.bedrijf || customer.company || 'Webdesign');
  const svg = `
    <svg width="1600" height="1000" viewBox="0 0 1600 1000" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#0f172a" flood-opacity="0.18"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#475569" flood-opacity="0.16"/>
        </filter>
        <clipPath id="laptopScreen"><rect x="332" y="375" width="880" height="430" rx="16"/></clipPath>
        <clipPath id="tabletScreen"><rect x="1124" y="325" width="246" height="410" rx="12"/></clipPath>
        <clipPath id="phoneScreen"><rect x="1306" y="462" width="162" height="340" rx="14"/></clipPath>
      </defs>
      <rect width="1600" height="1000" fill="#f8fbff"/>
      <circle cx="1270" cy="155" r="330" fill="#e8f0ff"/>
      <circle cx="220" cy="880" r="290" fill="#eef3f8"/>
      <text x="145" y="150" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="800" fill="#111827">WEBDESIGN PREVIEW</text>
      <text x="147" y="195" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#7b8494">Laptop - iPad - iPhone</text>
      <g filter="url(#shadow)">
        <rect x="290" y="335" width="964" height="520" rx="36" fill="#111827"/>
        <rect x="332" y="375" width="880" height="430" rx="16" fill="#ffffff"/>
        <image href="${embeddedImage}" x="332" y="375" width="880" height="430" preserveAspectRatio="xMidYMin slice" clip-path="url(#laptopScreen)"/>
        <rect x="260" y="855" width="1030" height="54" rx="22" fill="#e4ebf4"/>
        <rect x="620" y="864" width="270" height="18" rx="9" fill="#c6d1df"/>
      </g>
      <g filter="url(#softShadow)">
        <rect x="1095" y="285" width="306" height="498" rx="34" fill="#111827"/>
        <rect x="1124" y="325" width="246" height="410" rx="12" fill="#ffffff"/>
        <image href="${embeddedImage}" x="1124" y="325" width="246" height="410" preserveAspectRatio="xMidYMin slice" clip-path="url(#tabletScreen)"/>
        <rect x="1198" y="300" width="96" height="10" rx="5" fill="#64748b"/>
      </g>
      <g filter="url(#softShadow)">
        <rect x="1278" y="424" width="218" height="432" rx="36" fill="#111827"/>
        <rect x="1306" y="462" width="162" height="340" rx="14" fill="#ffffff"/>
        <image href="${embeddedImage}" x="1306" y="462" width="162" height="340" preserveAspectRatio="xMidYMin slice" clip-path="url(#phoneScreen)"/>
        <rect x="1346" y="442" width="82" height="9" rx="5" fill="#64748b"/>
      </g>
      <text x="145" y="942" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#cbd5e1">${companyName}</text>
    </svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

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
    photoRemovalKey = 'softora_database_photos_removed_v1',
    photoDataPrefix = 'softora_database_photo_data_v1_',
    jobProcessTimeoutMs = 10 * 60 * 1000,
    processJobsInline = process.env.VERCEL === '1' || process.env.VERCEL === 'true',
    loadSharpImpl = loadSharpModule,
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const JOB_PROCESS_TIMEOUT_MS = Math.max(100, Math.min(10 * 60 * 1000, Number(jobProcessTimeoutMs) || 0));
  const MAX_JOBS = 500;
  const CHUNK_SIZE = 180000;
  const MAX_STORAGE_CHUNKS = 80;
  const DATABASE_PHOTO_IMAGE_SIZE = '1024x1536';
  let processing = false;
  const inlineProcessingJobIds = new Set();

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

  function safeParseJsonArray(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
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

  async function findRunningJobForCustomer(ownerKey, customerId) {
    if (dataOpsStore && typeof dataOpsStore.findRunningWebdesignJob === 'function') {
      const persistent = await dataOpsStore.findRunningWebdesignJob(ownerKey, customerId);
      if (persistent) {
        jobs.set(persistent.id, persistent);
        return persistent;
      }
    }
    for (const job of jobs.values()) {
      if (job.ownerKey !== ownerKey) continue;
      if (job.customer.id !== customerId) continue;
      if (job.status === 'queued' || job.status === 'running') return job;
    }
    return null;
  }

  async function getVisibleJobsForOwner(ownerKey) {
    const byId = new Map();
    if (dataOpsStore && typeof dataOpsStore.listVisibleWebdesignJobs === 'function') {
      const persistentJobs = await dataOpsStore.listVisibleWebdesignJobs(ownerKey);
      (Array.isArray(persistentJobs) ? persistentJobs : []).forEach((job) => {
        if (job && job.id) {
          jobs.set(job.id, job);
          byId.set(job.id, job);
        }
      });
    }
    Array.from(jobs.values())
      .filter((job) => job.ownerKey === ownerKey)
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values()).sort((left, right) => left.createdAt - right.createdAt);
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
    const mockupDataUrl = await createDeviceMockupDataUrl(dataUrl, customer, { loadSharpImpl });
    const checkedAt = new Date().toISOString();
    const websitePhotoName =
      truncateText(normalizeString(image.fileName || `${customer.dom || customer.bedrijf || 'webdesign'}-webdesign.png`), 180) ||
      'Websitefoto';
    const websiteMockupName = truncateText(replaceImageFileSuffix(websitePhotoName, '-device-mockup-v6'), 180);
    const identityKey = buildCustomerIdentityKey(customer);
    if (dataOpsStore && typeof dataOpsStore.uploadDesignPhoto === 'function') {
      const structured = await dataOpsStore.uploadDesignPhoto(
        {
          customerId: customer.id,
          dataUrl,
          websiteMockup: mockupDataUrl,
          websiteMockupName,
          mockupRenderer: DEVICE_MOCKUP_RENDERER,
          mockupOrientation: 'upright',
          mockupQualityStatus: 'checked',
          mockupQualityCheckedAt: checkedAt,
          identityKey,
          fileName: websitePhotoName,
          legacyMeta: {
            id: customer.id,
            identityKey,
            websitePhotoName,
            websiteMockupName,
            mockupRenderer: DEVICE_MOCKUP_RENDERER,
            mockupOrientation: 'upright',
            mockupQualityStatus: 'checked',
            mockupQualityCheckedAt: checkedAt,
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
    const remainingRemovalIds = safeParseJsonArray(values[photoRemovalKey])
      .map(normalizeString)
      .filter(Boolean)
      .filter((id) => id !== customer.id);
    const photoDataKey = buildDataKey(customer.id);
    const mockupPhotoDataKey = buildDataKey(`${customer.id}_mockup`);
    const chunks = dataUrl.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [];
    const mockupChunks = mockupDataUrl.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [];
    if (chunks.length > MAX_STORAGE_CHUNKS || mockupChunks.length > MAX_STORAGE_CHUNKS) {
      throw new Error('De AI-foto was te groot om betrouwbaar op te slaan. Probeer het opnieuw.');
    }
    const patch = {};

    chunks.forEach((chunk, index) => {
      patch[`${photoDataKey}_${index}`] = chunk;
    });
    mockupChunks.forEach((chunk, index) => {
      patch[`${mockupPhotoDataKey}_${index}`] = chunk;
    });

    const existingMeta = existingMap[customer.id];
    const oldChunkCount = Math.max(0, Number(existingMeta && existingMeta.chunkCount) || 0);
    for (let index = chunks.length; index < oldChunkCount; index += 1) {
      patch[`${photoDataKey}_${index}`] = '';
    }
    const oldMockupChunkCount = Math.max(0, Number(existingMeta && existingMeta.mockupChunkCount) || 0);
    for (let index = mockupChunks.length; index < oldMockupChunkCount; index += 1) {
      patch[`${mockupPhotoDataKey}_${index}`] = '';
    }

    const mergedMap = {
      ...existingMap,
      [customer.id]: {
        id: customer.id,
        identityKey,
        photoKey: photoDataKey,
        chunkCount: chunks.length,
        mockupPhotoKey: mockupPhotoDataKey,
        mockupChunkCount: mockupChunks.length,
        websitePhotoName,
        websiteMockupName,
        mockupRenderer: DEVICE_MOCKUP_RENDERER,
        mockupOrientation: 'upright',
        mockupQualityStatus: 'checked',
        mockupQualityCheckedAt: checkedAt,
        updatedAt: new Date().toISOString().slice(0, 10),
      },
    };

    const saved = await setUiStateValues(
      photoScope,
      {
        ...values,
        ...patch,
        [photoKey]: JSON.stringify(mergedMap),
        [photoRemovalKey]: JSON.stringify(remainingRemovalIds),
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
    await persistJob(job);

    if (!aiToolsCoordinator || typeof aiToolsCoordinator.runWebsitePreviewGeneratePipeline !== 'function') {
      throw new Error('Websitegenerator is niet beschikbaar.');
    }

    const payload = await aiToolsCoordinator.runWebsitePreviewGeneratePipeline(job.websiteUrl, {
      allowScanFallback: true,
      imageSize: DATABASE_PHOTO_IMAGE_SIZE,
      disableReferenceImages: true,
      referenceImageMode: 'prompt-only',
      body: {
        source: 'premium-database',
        action: 'webdesign',
        company: job.customer.bedrijf,
        domain: job.customer.dom,
      },
    });

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

  function isStaleRunningJob(job) {
    if (!job || job.status !== 'running') return false;
    const startedAt = Number(job.startedAt) || 0;
    if (!startedAt) return true;
    return Date.now() - startedAt > JOB_PROCESS_TIMEOUT_MS + 30 * 1000;
  }

  async function processJobForStatusRequest(job) {
    if (!processJobsInline || !job) return job;
    const shouldProcess = job.status === 'queued' || isStaleRunningJob(job);
    if (!shouldProcess || inlineProcessingJobIds.has(job.id)) return job;

    if (job.status === 'running') {
      job.status = 'queued';
      job.error = null;
      job.startedAt = null;
      job.finishedAt = null;
      await persistJob(job);
    }

    inlineProcessingJobIds.add(job.id);
    try {
      return await settleJob(job);
    } finally {
      inlineProcessingJobIds.delete(job.id);
    }
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

  async function startJob(input = {}) {
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

    const existing = await findRunningJobForCustomer(ownerKey, customer.id);
    if (existing) {
      return {
        ok: true,
        statusCode: 202,
        job: serializeJob(existing),
        existing: true,
      };
    }

    const requestedJobId = normalizeJobId(input.jobId);
    const jobId = requestedJobId || randomUUID();
    const existingById = jobs.get(jobId) || await loadPersistentJob(jobId);
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
      return {
        ok: true,
        statusCode: 202,
        job: serializeJob(existingById),
        existing: true,
      };
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
    if (!processJobsInline) {
      queueProcessing();
    }

    return {
      ok: true,
      statusCode: 202,
      job: serializeJob(job),
      existing: false,
    };
  }

  async function startJobResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await startJob({
      ...body,
      ownerKey: ownerKeyFromReq(req),
      customer: body.customer || body,
    });
    const statusCode = Math.max(100, Math.min(599, Number(result.statusCode) || (result.ok ? 202 : 500)));
    return res.status(statusCode).json(result);
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
    if (job.ownerKey !== ownerKey) {
      return res.status(403).json({
        ok: false,
        error: 'Geen toegang',
      });
    }
    jobs.set(job.id, job);
    if (processJobsInline) {
      await processJobForStatusRequest(job);
    } else if (job.status === 'queued') {
      queueProcessing();
    }

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
    if (!processJobsInline) queueProcessing();

    return res.status(200).json({
      ok: true,
      jobs: (await getVisibleJobsForOwner(ownerKey)).map(serializeJob),
    });
  }

  return {
    getJobResponse,
    listJobsResponse,
    startJob,
    startJobResponse,
    _jobs: jobs,
  };
}

module.exports = {
  createDeviceMockupDataUrl,
  createPremiumDatabaseWebdesignJobsCoordinator,
};
