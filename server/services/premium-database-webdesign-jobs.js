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
    now = () => Date.now(),
    random = Math.random,
    retryJitter = true,
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const JOB_PROCESS_TIMEOUT_MS = Math.max(100, Math.min(10 * 60 * 1000, Number(jobProcessTimeoutMs) || 0));
  const MAX_JOBS = 500;
  const MAX_RETRY_ATTEMPTS = 6;
  const RETRY_DELAY_MIN_MS = 5000;
  const RETRY_DELAY_MAX_MS = 60000;
  const CHUNK_SIZE = 180000;
  const MAX_STORAGE_CHUNKS = 80;
  const DATABASE_PHOTO_IMAGE_SIZE = '1024x1536';
  let processing = false;
  let processingWakeTimer = null;
  let processingWakeAt = 0;
  const inlineProcessingJobIds = new Set();

  function pruneJobs() {
    const currentTime = now();
    for (const [id, job] of jobs.entries()) {
      if (currentTime - job.createdAt > JOB_TTL_MS) jobs.delete(id);
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

  function normalizeRetryState(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      attempts: Math.max(0, Math.floor(Number(source.attempts || 0) || 0)),
      nextAttemptAt: Math.max(0, Number(source.nextAttemptAt || 0) || 0) || null,
      lastRetryAt: Math.max(0, Number(source.lastRetryAt || 0) || 0) || null,
      lastRetryReason: truncateText(normalizeString(source.lastRetryReason || ''), 500),
    };
  }

  function getRetryState(job) {
    if (!job || typeof job !== 'object') return normalizeRetryState();
    job.retry = normalizeRetryState(job.retry);
    return job.retry;
  }

  function clearRetryState(job) {
    if (!job || typeof job !== 'object') return;
    job.retry = normalizeRetryState();
  }

  function parseRetryDurationMs(value, options = {}) {
    const raw = normalizeString(value || '');
    if (!raw) return 0;

    if (options.retryAfterHeader) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const dateMs = Date.parse(raw);
      if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now());
    }

    if (options.milliseconds) {
      const milliseconds = Number(raw);
      return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 0;
    }

    let totalMs = 0;
    const pattern = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)/gi;
    let match;
    while ((match = pattern.exec(raw))) {
      const amount = Number(match[1]);
      const unit = normalizeString(match[2]).toLowerCase();
      if (!Number.isFinite(amount) || amount < 0) continue;
      if (unit === 'ms' || unit.startsWith('millisecond')) totalMs += amount;
      else if (unit === 'm' || unit.startsWith('min')) totalMs += amount * 60 * 1000;
      else totalMs += amount * 1000;
    }
    return totalMs;
  }

  function parseRetryMessageMs(value) {
    const raw = normalizeString(value || '');
    const match = raw.match(/(?:try again|retry|probeer opnieuw|opnieuw proberen)\s*(?:in|after|over)?\s*([0-9][^.;,\n]*)/i);
    return match ? parseRetryDurationMs(match[1]) : 0;
  }

  function clampRetryDelayMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.max(1000, Math.min(RETRY_DELAY_MAX_MS, Math.ceil(numeric)));
  }

  function resolveRetryDelayMs(error, failedAttemptCount) {
    const explicit = clampRetryDelayMs(error && error.retryAfterMs);
    if (explicit > 0) return explicit;

    const detail = [
      error && error.message,
      error?.data?.error?.message,
      error?.data?.error?.detail,
      error?.data?.detail,
    ].map(normalizeString).filter(Boolean).join(' ');
    const messageDelay = clampRetryDelayMs(parseRetryMessageMs(detail));
    if (messageDelay > 0) return messageDelay;

    const retryAfter = clampRetryDelayMs(parseRetryDurationMs(error?.retryAfter, { retryAfterHeader: true }));
    if (retryAfter > 0) return retryAfter;

    const baseDelay = Math.min(
      RETRY_DELAY_MAX_MS,
      RETRY_DELAY_MIN_MS * Math.pow(2, Math.max(0, Number(failedAttemptCount || 1) - 1))
    );
    if (retryJitter === false) return baseDelay;
    const jitterFactor = 0.8 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4;
    return Math.min(RETRY_DELAY_MAX_MS, Math.max(1000, Math.round(baseDelay * jitterFactor)));
  }

  function isRetryableWebdesignError(error) {
    const status = Number(error && error.status) || 0;
    const message = normalizeString(error && error.message).toLowerCase();
    const upstreamMessage = normalizeString(
      error?.data?.error?.message || error?.data?.error?.detail || error?.data?.detail || ''
    ).toLowerCase();
    const combined = `${message} ${upstreamMessage}`;

    if (
      /openai_api_key ontbreekt|image-model ongeldig|organization must be verified|not verified|billing|quota|credits|monthly usage|maximum monthly spend|invalid authentication|incorrect api key/.test(combined)
    ) {
      return false;
    }
    if (status === 401 || status === 403 || status === 400 || status === 422) return false;
    if (error && error.retryableOpenAiImage === true) return true;
    if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status >= 500) {
      return true;
    }
    return /abort|timeout|timed out|duurde te lang|fetch failed|terminated|econnreset|socket|netwerkfout/i.test(combined);
  }

  function isJobReadyToProcess(job) {
    if (!job || job.status !== 'queued') return false;
    const retry = getRetryState(job);
    return !retry.nextAttemptAt || retry.nextAttemptAt <= now();
  }

  function getSoonestQueuedRetryAt() {
    let soonest = Infinity;
    for (const job of jobs.values()) {
      if (!job || job.status !== 'queued') continue;
      const retry = getRetryState(job);
      if (retry.nextAttemptAt && retry.nextAttemptAt > now()) {
        soonest = Math.min(soonest, retry.nextAttemptAt);
      }
    }
    return Number.isFinite(soonest) ? soonest : 0;
  }

  function scheduleProcessingWake(delayMs) {
    const delay = Math.max(0, Math.min(RETRY_DELAY_MAX_MS, Number(delayMs) || 0));
    const wakeAt = now() + delay;
    if (processingWakeTimer && processingWakeAt && processingWakeAt <= wakeAt) return;
    if (processingWakeTimer) clearTimeout(processingWakeTimer);
    processingWakeAt = wakeAt;
    processingWakeTimer = setTimeout(() => {
      processingWakeTimer = null;
      processingWakeAt = 0;
      queueProcessing();
    }, delay);
  }

  function serializeJob(job) {
    const retry = getRetryState(job);
    return {
      id: job.id,
      status: job.status,
      customerId: job.customer.id,
      company: job.customer.bedrijf,
      error: job.error || null,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      nextAttemptAt: retry.nextAttemptAt || null,
      retryAttempts: retry.attempts,
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
    job.startedAt = now();
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
        const error = new Error(`Webdesign maken duurde te lang (${Math.round(JOB_PROCESS_TIMEOUT_MS / 1000)}s). Probeer het opnieuw.`);
        error.status = 504;
        error.retryableOpenAiImage = true;
        reject(error);
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
      job.finishedAt = now();
      clearRetryState(job);
      await persistJob(job);
    } catch (error) {
      if (isRetryableWebdesignError(error)) {
        const retry = getRetryState(job);
        const failedAttemptCount = retry.attempts + 1;
        if (failedAttemptCount < MAX_RETRY_ATTEMPTS) {
          const retryDelayMs = resolveRetryDelayMs(error, failedAttemptCount);
          job.status = 'queued';
          job.error = null;
          job.startedAt = null;
          job.finishedAt = null;
          job.retry = {
            attempts: failedAttemptCount,
            nextAttemptAt: now() + retryDelayMs,
            lastRetryAt: now(),
            lastRetryReason: truncateText(normalizeString(error && error.message) || 'Tijdelijke OpenAI-limiet.', 500),
          };
          if (typeof logger.warn === 'function') {
            logger.warn(
              `[PremiumDatabaseWebdesignJobs][retry] ${job.id} wacht ${Math.round(retryDelayMs / 1000)}s na tijdelijke OpenAI-fout`
            );
          }
          await persistJob(job);
          return job;
        }
      }
      job.status = 'error';
      job.error = truncateText(normalizeString(error && error.message) || 'Webdesign maken is mislukt.', 500);
      job.finishedAt = now();
      const retry = getRetryState(job);
      job.retry = {
        ...retry,
        nextAttemptAt: null,
      };
      logger.error('[PremiumDatabaseWebdesignJobs][process]', error && error.message ? error.message : error);
      await persistJob(job);
    }
    return job;
  }

  function isStaleRunningJob(job) {
    if (!job || job.status !== 'running') return false;
    const startedAt = Number(job.startedAt) || 0;
    if (!startedAt) return true;
    return now() - startedAt > JOB_PROCESS_TIMEOUT_MS + 30 * 1000;
  }

  async function processJobForStatusRequest(job) {
    if (!processJobsInline || !job) return job;
    const shouldProcess = (job.status === 'queued' && isJobReadyToProcess(job)) || isStaleRunningJob(job);
    if (!shouldProcess || processing || inlineProcessingJobIds.has(job.id)) return job;

    if (job.status === 'running') {
      job.status = 'queued';
      job.error = null;
      job.startedAt = null;
      job.finishedAt = null;
      clearRetryState(job);
      await persistJob(job);
    }

    processing = true;
    inlineProcessingJobIds.add(job.id);
    try {
      return await settleJob(job);
    } finally {
      inlineProcessingJobIds.delete(job.id);
      processing = false;
    }
  }

  function queueProcessing() {
    if (processing) return;
    const next = Array.from(jobs.values()).find(isJobReadyToProcess);
    if (!next) {
      const nextRetryAt = getSoonestQueuedRetryAt();
      if (nextRetryAt) scheduleProcessingWake(nextRetryAt - now());
      return;
    }

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
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      retry: normalizeRetryState(),
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
