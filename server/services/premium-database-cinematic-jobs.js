const { Readable } = require('node:stream');

const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_VEO_MODEL = 'veo-3.1-generate-preview';
const JOB_SCOPE = 'premium_database_cinematic_jobs';
const JOB_KEY = 'softora_premium_database_cinematic_jobs_v1';
const SITE_KEY = 'softora_premium_database_cinematic_sites_v1';

function createPremiumDatabaseCinematicJobsCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    fetchWebsitePreviewScanFromUrl = async () => ({ normalizedUrl: '', finalUrl: '', scan: {} }),
    fetchJsonWithTimeout = createFetchJsonWithTimeout(),
    getOpenAiApiKey = () => process.env.OPENAI_API_KEY || '',
    getGeminiApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VEO_API_KEY || '',
    openAiApiBaseUrl = process.env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE_URL,
    geminiApiBaseUrl = process.env.GEMINI_API_BASE_URL || DEFAULT_GEMINI_API_BASE_URL,
    openAiImageModel = process.env.OPENAI_CINEMATIC_IMAGE_MODEL || process.env.WEBSITE_PREVIEW_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    veoModel = process.env.GEMINI_VEO_MODEL || process.env.VEO_MODEL || DEFAULT_VEO_MODEL,
    imageCount = process.env.PREMIUM_CINEMATIC_IMAGE_COUNT || 2,
    imageSize = process.env.PREMIUM_CINEMATIC_IMAGE_SIZE || '2048x1152',
    imageQuality = process.env.PREMIUM_CINEMATIC_IMAGE_QUALITY || 'medium',
    veoPollIntervalMs = process.env.PREMIUM_CINEMATIC_VEO_POLL_MS || 10000,
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    now = () => Date.now(),
    random = Math.random,
    generateCinematicImages = null,
    submitVeoVideo = null,
    pollVeoOperation = null,
    buildCinematicSiteHtml = null,
  } = deps;

  const jobs = new Map();
  const activeAdvances = new Map();
  const IMAGE_COUNT = Math.max(1, Math.min(3, Math.floor(Number(imageCount) || 2)));
  const VEO_POLL_INTERVAL_MS = Math.max(2500, Math.min(60000, Number(veoPollIntervalMs) || 10000));

  const ownerKeyFromReq = (req) => {
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    return email || uid ? `${email}::${uid}` : '';
  };
  const normalizeJobId = (value) => (/^[a-z0-9_-]{12,140}$/i.test(normalizeString(value)) ? normalizeString(value) : '');
  const createJobId = () => `cin_${now().toString(36)}_${Math.floor(random() * 1e12).toString(36)}`;
  const getVideoRoute = (jobId) => `/api/premium-database/cinematic-jobs/${encodeURIComponent(jobId)}/video`;

  function getProviderStatus() {
    const openAiConfigured = Boolean(normalizeString(getOpenAiApiKey()));
    const geminiConfigured = Boolean(normalizeString(getGeminiApiKey()));
    const missing = [];
    if (!openAiConfigured) missing.push('OPENAI_API_KEY');
    if (!geminiConfigured) missing.push('GEMINI_API_KEY');
    return {
      ready: missing.length === 0,
      missing,
      openAi: {
        configured: openAiConfigured,
        imageModel: normalizeString(openAiImageModel) || DEFAULT_IMAGE_MODEL,
        apiBaseUrlConfigured: Boolean(normalizeString(openAiApiBaseUrl)),
      },
      veo: {
        configured: geminiConfigured,
        model: normalizeString(veoModel) || DEFAULT_VEO_MODEL,
        apiBaseUrlConfigured: Boolean(normalizeString(geminiApiBaseUrl)),
      },
    };
  }

  function normalizeWebsiteUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    try {
      const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes('.')) return '';
      parsed.hash = '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  }

  function normalizeCustomer(raw = {}) {
    const customer = raw && typeof raw === 'object' ? raw : {};
    return {
      id: truncateText(normalizeString(customer.id || customer.customerId), 120),
      bedrijf: truncateText(normalizeString(customer.bedrijf || customer.company || customer.companyName || customer.naam), 180),
      naam: truncateText(normalizeString(customer.naam || customer.contact || customer.contactName), 160),
      dom: truncateText(normalizeString(customer.dom || customer.domain || customer.websiteDomain), 180),
      website: truncateText(normalizeString(customer.website || customer.websiteUrl || customer.url || customer.site), 350),
    };
  }

  function identityPart(value) {
    return normalizeString(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
  }
  function websiteIdentity(value) {
    const url = normalizeWebsiteUrl(value);
    if (!url) return '';
    try { return identityPart(new URL(url).hostname.replace(/^www\./i, '')); } catch (_) { return identityPart(url); }
  }
  function siteIdentityKeys(ownerKey, customer = {}, websiteUrl = '') {
    const owner = identityPart(ownerKey);
    if (!owner) return [];
    const keys = [];
    const id = identityPart(customer.id || customer.customerId);
    const company = identityPart(customer.bedrijf || customer.company || customer.companyName || customer.naam);
    const website = websiteIdentity(websiteUrl || customer.website || customer.dom);
    if (id) keys.push(`${owner}:customer:${id}`);
    if (website) keys.push(`${owner}:website:${website}`);
    if (!id && !website && company) keys.push(`${owner}:company:${company}`);
    return Array.from(new Set(keys));
  }

  function getValues(state) {
    return state && typeof state === 'object' && state.values && typeof state.values === 'object' ? state.values : state && typeof state === 'object' ? state : {};
  }
  function parseObject(raw) {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  async function readMap(key) {
    const state = typeof getUiStateValues === 'function' ? await getUiStateValues(JOB_SCOPE) : null;
    return parseObject(getValues(state)[key]);
  }
  async function writeMap(key, map, source) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') return null;
    const state = await getUiStateValues(JOB_SCOPE);
    const values = getValues(state);
    return setUiStateValues(JOB_SCOPE, { ...values, [key]: JSON.stringify(map) }, { source, actor: 'Premium database' });
  }
  async function safeWriteMap(key, map, source, label) {
    try { return await writeMap(key, map, source); } catch (error) {
      if (typeof logger.warn === 'function') logger.warn(`[PremiumDatabaseCinematicJobs][${label}]`, error?.message || error);
      return null;
    }
  }

  function summarizeScan(scan = {}) {
    const array = (value, max, length) => Array.isArray(value) ? value.map((item) => truncateText(normalizeString(item), length)).filter(Boolean).slice(0, max) : [];
    return {
      host: truncateText(normalizeString(scan.host), 180),
      title: truncateText(normalizeString(scan.title), 220),
      metaDescription: truncateText(normalizeString(scan.metaDescription), 420),
      h1: truncateText(normalizeString(scan.h1), 220),
      headings: array(scan.headings, 10, 140),
      paragraphs: array(scan.paragraphs, 8, 320),
      visualCues: array(scan.visualCues, 10, 80),
      brandPalette: array(scan.brandPalette, 8, 40),
      fontHints: array(scan.fontHints, 5, 80),
      bodyTextSample: truncateText(normalizeString(scan.bodyTextSample), 900),
      fetchSource: truncateText(normalizeString(scan.fetchSource), 80),
    };
  }

  function stageLabel(stage) {
    return {
      queued: 'Opdracht staat klaar',
      scanning: 'Website wordt geanalyseerd',
      images: 'Cinematic beelden worden gemaakt',
      video: 'Veo 3.1 video wordt gebouwd',
      site: 'Premium website wordt samengesteld',
      done: 'Cinematic website staat klaar',
      error: 'Proces gestopt',
    }[stage] || 'Opdracht staat klaar';
  }
  function setStage(job, stage, progress) {
    job.stage = stage;
    job.progress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    job.updatedAt = now();
  }
  function serializeJob(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      stageLabel: stageLabel(job.stage),
      progress: Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0))),
      customer: job.customer,
      websiteUrl: job.websiteUrl,
      site: job.site || null,
      scan: job.scan || null,
      imageCount: Math.max(0, Number(job.imageCount || 0) || 0),
      video: { ready: Boolean(job.videoReady && job.videoUri), url: job.videoReady && job.videoUri ? getVideoRoute(job.id) : '' },
      result: job.result && job.result.html ? { html: job.result.html, source: job.result.source || 'softora-cinematic-builder', generatedAt: job.result.generatedAt || null } : null,
      error: job.error || null,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      updatedAt: job.updatedAt || job.createdAt,
      finishedAt: job.finishedAt || null,
      nextPollAt: job.nextPollAt || null,
      cachedSite: Boolean(job.cachedSite),
    };
  }
  function compactJob(job) {
    return { ...serializeJob(job), ownerKey: job.ownerKey, videoUri: job.videoUri || '', videoOperationName: job.videoOperationName || '', rawVideoOperation: job.rawVideoOperation || null };
  }
  function compactSite(job) {
    return { id: job.id, ownerKey: job.ownerKey, identityKeys: siteIdentityKeys(job.ownerKey, job.customer, job.websiteUrl), customer: job.customer, websiteUrl: job.websiteUrl, site: job.site || null, scan: job.scan || null, imageCount: Math.max(0, Number(job.imageCount || 0) || 0), videoReady: Boolean(job.videoReady && job.videoUri), videoUri: job.videoUri || '', result: job.result || null, createdAt: job.createdAt, updatedAt: job.updatedAt || now(), finishedAt: job.finishedAt || now() };
  }
  function hydrateJob(stored) {
    if (!stored || typeof stored !== 'object') return null;
    const id = normalizeJobId(stored.id);
    const ownerKey = normalizeString(stored.ownerKey);
    if (!id || !ownerKey) return null;
    return { id, ownerKey, status: normalizeString(stored.status) || 'queued', stage: normalizeString(stored.stage) || 'queued', progress: Math.max(0, Math.min(100, Number(stored.progress || 0) || 0)), customer: normalizeCustomer(stored.customer || {}), websiteUrl: normalizeWebsiteUrl(stored.websiteUrl), site: stored.site || null, scan: stored.scan || null, imageCount: Math.max(0, Number(stored.imageCount || 0) || 0), videoReady: Boolean(stored.video?.ready || stored.videoReady), videoUri: normalizeString(stored.videoUri || ''), videoOperationName: normalizeString(stored.videoOperationName || ''), rawVideoOperation: stored.rawVideoOperation || null, result: stored.result || null, error: normalizeString(stored.error || ''), createdAt: Number(stored.createdAt || 0) || now(), startedAt: Number(stored.startedAt || 0) || null, updatedAt: Number(stored.updatedAt || 0) || null, finishedAt: Number(stored.finishedAt || 0) || null, nextPollAt: Number(stored.nextPollAt || 0) || null, cachedSite: Boolean(stored.cachedSite) };
  }
  function hydrateSite(stored) {
    const job = hydrateJob({ ...stored, status: 'done', stage: 'done', progress: 100, video: { ready: stored?.videoReady }, cachedSite: true });
    return job && job.result && job.result.html ? job : null;
  }

  async function persistJob(job) {
    jobs.set(job.id, job);
    try {
      const map = await readMap(JOB_KEY);
      map[job.id] = compactJob(job);
      return safeWriteMap(JOB_KEY, map, 'premium-database-cinematic-jobs', 'persist');
    } catch (error) {
      if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseCinematicJobs][persist]', error?.message || error);
      return null;
    }
  }
  async function persistCompletedSite(job) {
    if (!job || job.status !== 'done' || !job.result?.html) return null;
    const record = compactSite(job);
    const map = await readMap(SITE_KEY);
    record.identityKeys.forEach((key) => { map[key] = record; });
    return safeWriteMap(SITE_KEY, map, 'premium-database-cinematic-sites', 'persist-site');
  }
  async function findCompletedSite(ownerKey, customer, websiteUrl) {
    const map = await readMap(SITE_KEY);
    for (const key of siteIdentityKeys(ownerKey, customer, websiteUrl)) {
      const job = hydrateSite(map[key]);
      if (job) {
        jobs.set(job.id, job);
        return job;
      }
    }
    return null;
  }
  async function findStoredActiveJob(ownerKey, customer, websiteUrl) {
    const candidates = Object.values(await readMap(JOB_KEY))
      .map((record) => hydrateJob(record))
      .filter((job) => {
        if (!job || job.ownerKey !== ownerKey || job.status === 'error') return false;
        return job.customer?.id === customer.id || job.websiteUrl === websiteUrl;
      })
      .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0));
    const job = candidates[0] || null;
    if (job) jobs.set(job.id, job);
    return job;
  }
  async function loadJob(jobId) {
    const id = normalizeJobId(jobId);
    if (!id) return null;
    if (jobs.has(id)) return jobs.get(id);
    const stored = hydrateJob((await readMap(JOB_KEY))[id]);
    if (stored) {
      jobs.set(stored.id, stored);
      return stored;
    }
    for (const record of Object.values(await readMap(SITE_KEY))) {
      const siteJob = hydrateSite(record);
      if (siteJob && siteJob.id === id) {
        jobs.set(siteJob.id, siteJob);
        return siteJob;
      }
    }
    return null;
  }

  function scanFallback(job) {
    const displayName = job.customer.bedrijf || job.customer.dom || job.websiteUrl;
    let host = job.customer.dom || '';
    try { host = new URL(job.websiteUrl).hostname || host; } catch (_) {}
    return { normalizedUrl: job.websiteUrl, finalUrl: job.websiteUrl, scanFallback: true, scan: { host, title: `${displayName} website`, metaDescription: `Premium cinematic websiteconcept voor ${displayName}.`, h1: displayName, headings: ['Diensten', 'Resultaten', 'Werkwijze', 'Contact'], paragraphs: [`${displayName} heeft een onderscheidende, conversiegerichte premium website nodig.`, 'De nieuwe site moet direct vertrouwen, energie en professionele autoriteit uitstralen.'], visualCues: ['cinematic', 'premium', 'conversion focused', 'modern'], brandPalette: [], bodyTextSample: `Websiteconcept voor ${displayName}. Domein: ${host || job.websiteUrl}.`, fetchSource: 'premium-cinematic-fallback' } };
  }
  async function scanWebsite(job) {
    try { return await fetchWebsitePreviewScanFromUrl(job.websiteUrl); } catch (error) {
      if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseCinematicJobs][scan-fallback]', error?.message || error);
      return scanFallback(job);
    }
  }
  function imagePrompt(job) {
    const scan = job.scan || {};
    const company = job.customer.bedrijf || scan.h1 || scan.host || 'het bedrijf';
    const headings = Array.isArray(scan.headings) ? scan.headings.slice(0, 6).join(', ') : '';
    const paragraphs = Array.isArray(scan.paragraphs) ? scan.paragraphs.slice(0, 4).join(' ') : '';
    const palette = Array.isArray(scan.brandPalette) && scan.brandPalette.length ? scan.brandPalette.join(', ') : 'deep crimson accents, warm white space, refined black typography, one fresh teal highlight';
    return [`Create ${IMAGE_COUNT} cinematic still frames for a premium scroll-driven website for ${company}.`, 'The images are not screenshots. They are high-end brand visuals that become the first act of a scroll film.', 'Think in physical scenes: an object opens, a detail is revealed, hands or motion enter the frame, then the website assembles into a premium conversion moment.', 'Style: cinematic commercial direction, premium service business, confident lighting, clean composition, realistic materials, expensive but not flashy.', `Brand palette hints: ${palette}.`, headings ? `Website themes: ${headings}.` : '', paragraphs ? `Business context: ${paragraphs}` : '', 'Avoid readable text in the image. Avoid logos unless they are abstract. Leave negative space for web copy overlays and scroll-triggered interface layers.', 'Return crisp 16:9 frames with strong depth, natural detail, and a polished premium website mood.'].filter(Boolean).join('\n');
  }
  async function defaultGenerateImages(job) {
    const apiKey = normalizeString(getOpenAiApiKey());
    if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY ontbreekt'), { status: 503 });
    const model = normalizeString(openAiImageModel) || DEFAULT_IMAGE_MODEL;
    const body = { model, prompt: imagePrompt(job), size: normalizeString(imageSize) || '2048x1152', quality: normalizeString(imageQuality) || 'medium', n: IMAGE_COUNT };
    if (/^dall-e-[23]$/i.test(model)) body.response_format = 'b64_json';
    const { response, data } = await fetchJsonWithTimeout(`${String(openAiApiBaseUrl || DEFAULT_OPENAI_API_BASE_URL).replace(/\/+$/, '')}/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }, 240000);
    if (!response?.ok) throw Object.assign(new Error(normalizeString(data?.error?.message || data?.error?.detail || data?.message) || 'OpenAI cinematic beelden mislukt'), { status: Number(response?.status) || 502, data });
    const images = (Array.isArray(data?.data) ? data.data : []).map((entry, index) => ({ index, mimeType: 'image/png', base64: normalizeString(entry?.b64_json || ''), revisedPrompt: normalizeString(entry?.revised_prompt || ''), fileName: `cinematic-frame-${index + 1}.png` })).filter((entry) => entry.base64);
    if (!images.length) throw Object.assign(new Error('OpenAI gaf geen cinematic beeld terug.'), { status: 502, data });
    return { images, prompt: body.prompt, model, usage: data?.usage || null };
  }
  function veoPrompt(job) {
    const company = job.customer.bedrijf || job.scan?.h1 || job.scan?.host || 'dit bedrijf';
    return `Cinematic premium website scroll-film for ${company}. Animate the supplied brand still into a smooth 8 second commercial sequence that feels like the first act of an interactive website: slow dolly-in, subtle parallax, a reveal of a tactile detail, elegant light movement, premium pacing. Mood: modern, trustworthy, high-performance, made for a premium Dutch business website. No readable text overlays, no distorted logos, no unrealistic artifacts.`;
  }
  function veoSubmitPayloadVariants(job, first) {
    const prompt = veoPrompt(job);
    const mimeType = first.mimeType || 'image/png';
    const base64 = first.base64;
    const bytesImage = { bytesBase64Encoded: base64, mimeType };
    const sdkStyleImage = { imageBytes: base64, mimeType };
    return [
      {
        label: 'bytes-full',
        body: { instances: [{ prompt, image: bytesImage }], parameters: { aspectRatio: '16:9', durationSeconds: 8, personGeneration: 'allow_adult', resolution: '720p' } },
      },
      {
        label: 'bytes-core',
        body: { instances: [{ prompt, image: bytesImage }], parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' } },
      },
      {
        label: 'bytes-minimal',
        body: { instances: [{ prompt, image: bytesImage }] },
      },
      {
        label: 'imageBytes-core',
        body: { instances: [{ prompt, image: sdkStyleImage }], parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' } },
      },
    ];
  }
  function veoSubmitErrorMessage(data) {
    return normalizeString(data?.error?.message || data?.error?.detail || data?.message);
  }
  function shouldRetryVeoSubmit(response, data) {
    const status = Number(response?.status || 0);
    if (![400, 422].includes(status)) return false;
    const message = veoSubmitErrorMessage(data);
    return /unsupported|supported usage|unknown|unrecognized|invalid|remove|value type|needs to be|inlineData|bytesBase64Encoded|imageBytes|durationSeconds|personGeneration|resolution|aspectRatio|parameters/i.test(message);
  }
  function geminiApiRoot() {
    return String(geminiApiBaseUrl || DEFAULT_GEMINI_API_BASE_URL).replace(/\/+$/, '');
  }
  function geminiApiUrl(value) {
    const raw = normalizeString(value);
    if (/^https?:\/\//i.test(raw)) return raw;
    const clean = raw.replace(/^\/+/, '');
    const base = geminiApiRoot();
    try {
      const parsedBase = new URL(base);
      const basePath = parsedBase.pathname.replace(/^\/+|\/+$/g, '');
      if (basePath && clean.startsWith(`${basePath}/`)) return `${parsedBase.origin}/${clean}`;
    } catch (_) {}
    return `${base}/${clean}`;
  }
  async function defaultSubmitVeo(job, images) {
    const apiKey = normalizeString(getGeminiApiKey());
    if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY ontbreekt voor Veo 3.1'), { status: 503 });
    const first = images[0];
    if (!first?.base64) throw Object.assign(new Error('Cinematic startbeeld ontbreekt voor Veo.'), { status: 422 });
    const endpoint = geminiApiUrl(`models/${encodeURIComponent(normalizeString(veoModel) || DEFAULT_VEO_MODEL)}:predictLongRunning`);
    const variants = veoSubmitPayloadVariants(job, first);
    let lastError = null;
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const { response, data } = await fetchJsonWithTimeout(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(variant.body) }, 90000);
      if (response?.ok) {
        const operationName = normalizeString(data?.name || data?.operation?.name || '');
        if (!operationName) throw Object.assign(new Error('Veo 3.1 gaf geen operation name terug.'), { status: 502, data });
        return { operationName, raw: data, requestVariant: variant.label };
      }
      const message = veoSubmitErrorMessage(data) || 'Veo 3.1 starten mislukt';
      lastError = Object.assign(new Error(message), { status: Number(response?.status) || 502, data });
      if (index >= variants.length - 1 || !shouldRetryVeoSubmit(response, data)) throw lastError;
      if (typeof logger.warn === 'function') logger.warn(`[PremiumDatabaseCinematicJobs][submit-retry] ${variant.label}`, message);
    }
    throw lastError || Object.assign(new Error('Veo 3.1 starten mislukt'), { status: 502 });
  }
  function extractVideoUri(operation) {
    const response = operation?.response || {};
    return normalizeString(response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || response?.generateVideoResponse?.generatedVideos?.[0]?.video?.uri || response?.generatedVideos?.[0]?.video?.uri || response?.generatedSamples?.[0]?.video?.uri || '');
  }
  async function defaultPollVeo(job) {
    const apiKey = normalizeString(getGeminiApiKey());
    if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY ontbreekt voor Veo 3.1'), { status: 503 });
    const operationName = normalizeString(job.videoOperationName);
    if (!operationName) throw Object.assign(new Error('Veo operation ontbreekt.'), { status: 422 });
    const { response, data } = await fetchJsonWithTimeout(geminiApiUrl(operationName), { method: 'GET', headers: { 'x-goog-api-key': apiKey } }, 45000);
    if (!response?.ok || data?.error) throw Object.assign(new Error(normalizeString(data?.error?.message || data?.error?.detail || data?.message) || 'Veo 3.1 status mislukt'), { status: Number(response?.status) || 502, data });
    if (!data?.done) return { done: false, raw: data };
    const videoUri = extractVideoUri(data);
    if (!videoUri) throw Object.assign(new Error('Veo 3.1 is klaar, maar gaf geen video URI terug.'), { status: 502, data });
    return { done: true, videoUri, raw: data };
  }

  function scrollMotif(job) {
    const scan = job.scan || {};
    const text = [
      job.customer?.bedrijf,
      job.customer?.dom,
      scan.host,
      scan.title,
      scan.metaDescription,
      scan.h1,
      Array.isArray(scan.headings) ? scan.headings.join(' ') : '',
      Array.isArray(scan.paragraphs) ? scan.paragraphs.join(' ') : '',
      scan.bodyTextSample,
    ].join(' ').toLowerCase();
    if (/\b(thee|tea|teashop|theezak|theezakje|kop thee|infusie|koffie|coffee|barista|horeca)\b/i.test(text)) {
      return {
        key: 'tea',
        label: 'Productritueel',
        scenes: [
          ['Het ritueel opent', 'Een klein detail vouwt open alsof de bezoeker de eerste handeling zelf inzet.'],
          ['Smaak komt los', 'De camera zakt naar het moment waarop warmte, geur en aandacht zichtbaar worden.'],
          ['Handen maken het tastbaar', 'Het product voelt niet meer als aanbod, maar als ervaring die je bijna kunt aanraken.'],
          ['Van beleving naar actie', 'De site gebruikt dat gevoel om bezoekers vanzelf richting contact of aankoop te trekken.'],
        ],
      };
    }
    if (/\b(advocaat|advocaten|juridisch|law|legal|recht|notaris|dossier|zaak)\b/i.test(text)) {
      return {
        key: 'legal',
        label: 'Vertrouwen in beeld',
        scenes: [
          ['Het dossier opent', 'De eerste scroll voelt als een exclusief dossier dat met precisie wordt geopend.'],
          ['Bewijs krijgt focus', 'Belangrijke argumenten schuiven naar voren zonder de rust en autoriteit te verliezen.'],
          ['Handen brengen zekerheid', 'Het moment voelt persoonlijk: expertise wordt tastbaar in plaats van alleen verteld.'],
          ['Van twijfel naar gesprek', 'De website leidt bezoekers naar een duidelijke volgende stap met premium vertrouwen.'],
        ],
      };
    }
    return {
      key: 'brand',
      label: 'Merkfilm op scroll',
      scenes: [
        ['Het verhaal opent', 'De eerste scroll haalt de bezoeker uit een gewone pagina en in een merkervaring.'],
        ['De kern komt vrij', 'Belangrijke details schuiven naar voren alsof de camera door het bedrijf beweegt.'],
        ['Het aanbod wordt tastbaar', 'Beweging, diepte en menselijke aandacht maken de waarde direct voelbaar.'],
        ['Momentum naar contact', 'De laatste scène zet de energie om in vertrouwen, keuze en actie.'],
      ],
    };
  }

  function defaultSiteHtml(job) {
    const company = escapeHtml(job.customer.bedrijf || job.scan?.h1 || job.scan?.host || 'Premium bedrijf');
    const domain = escapeHtml(job.scan?.host || job.customer.dom || '');
    const description = escapeHtml(job.scan?.metaDescription || job.scan?.bodyTextSample || `Een premium websiteconcept voor ${company}.`);
    const headings = Array.isArray(job.scan?.headings) && job.scan.headings.length ? job.scan.headings.slice(0, 4) : ['Strategie', 'Design', 'Beleving', 'Conversie'];
    const motif = scrollMotif(job);
    const steps = motif.scenes.map((scene, index) => `<article class="story-step" data-scene="${index}" data-title="${escapeHtml(scene[0])}" data-copy="${escapeHtml(scene[1])}"><span>Act ${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(scene[0])}</b></article>`).join('');
    const proofItems = headings.map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(item)}</li>`).join('');
    return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${company} - cinematic website</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,sans-serif;color:#171719;background:#f6f7f2}h1,h2,p{margin:0}a{color:inherit}.hero{min-height:92vh;position:relative;display:grid;align-items:end;overflow:hidden;background:#101012;color:#fff}.hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.74;filter:saturate(1.02) contrast(1.06)}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,10,.9),rgba(8,8,10,.46) 48%,rgba(8,8,10,.12))}.hero-copy{position:relative;z-index:1;width:min(1040px,92%);padding:96px 6% 82px}.kicker,.label{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:900}.kicker{color:#6ee7d8}.hero h1{max-width:780px;margin-top:18px;font-family:Impact,Arial Black,Inter,sans-serif;font-size:88px;line-height:.9;letter-spacing:0;text-transform:uppercase}.hero p{max-width:680px;margin-top:24px;font-size:20px;line-height:1.55;color:rgba(255,255,255,.82)}.cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}.cta{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.cta.primary{background:#b7295f;color:#fff}.cta.secondary{border:1px solid rgba(255,255,255,.32);color:#fff}.story{--story-progress:0;min-height:420vh;position:relative;background:#111;color:#fff}.story-stage{position:sticky;top:0;height:100vh;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.75fr);gap:38px;align-items:center;padding:64px 6%;background:radial-gradient(circle at 30% 45%,rgba(15,159,147,.2),transparent 34%),linear-gradient(135deg,#101012,#191719 58%,#0f1112)}.story-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.28;filter:saturate(.85) contrast(1.12)}.story-stage:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.38),rgba(0,0,0,.08),rgba(0,0,0,.48));pointer-events:none}.story-visual,.story-copy{position:relative;z-index:1}.story-visual{height:min(620px,72vh);display:grid;place-items:center}.cinematic-object{position:relative;width:min(520px,78vw);aspect-ratio:1;border-radius:50%;display:grid;place-items:center}.cinematic-object:before{content:"";position:absolute;inset:10%;border:1px solid rgba(255,255,255,.12);border-radius:50%;transform:scale(calc(.92 + var(--story-progress) * .16));opacity:.8}.object-shadow{position:absolute;bottom:12%;width:64%;height:11%;border-radius:50%;background:rgba(0,0,0,.38);filter:blur(14px);transform:scaleX(calc(.72 + var(--story-progress) * .34))}.object-core{position:absolute;width:44%;height:40%;border-radius:14px;background:linear-gradient(135deg,#f7f1e7,#d6c2a2);box-shadow:0 34px 90px rgba(0,0,0,.42);transform:translateY(24px) rotate(-7deg);transition:transform .7s ease,border-radius .7s ease}.object-lid{position:absolute;top:25%;left:28%;width:44%;height:18%;border-radius:12px 12px 4px 4px;background:linear-gradient(135deg,#fffaf2,#d7c3a0);transform-origin:50% 100%;transition:transform .7s ease}.object-detail{position:absolute;width:28%;height:28%;border:1px solid rgba(255,255,255,.24);border-radius:50%;background:rgba(110,231,216,.12);opacity:0;transform:translateY(60px) scale(.72);transition:opacity .6s ease,transform .7s ease}.hand{position:absolute;width:34%;height:18%;border-radius:999px;background:linear-gradient(135deg,#f4cfad,#c88b64);opacity:0;filter:drop-shadow(0 18px 28px rgba(0,0,0,.26));transition:opacity .7s ease,transform .8s ease}.hand.left{left:5%;bottom:24%;transform:translateX(-90px) rotate(12deg)}.hand.right{right:5%;bottom:26%;transform:translateX(90px) rotate(-14deg)}.steam{position:absolute;top:19%;width:8px;height:76px;border-radius:999px;border-left:2px solid rgba(110,231,216,.55);opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}.steam.one{left:44%}.steam.two{left:52%;transition-delay:.06s}.steam.three{left:60%;transition-delay:.12s}.motif-tea .object-core{border-radius:0 0 48% 48%;background:linear-gradient(180deg,#f0d5aa,#b9834d)}.motif-tea .object-lid{top:20%;height:22%;background:linear-gradient(135deg,#fff6dd,#d6a256)}.motif-tea .object-detail{width:46%;height:30%;bottom:18%;border-radius:0 0 80px 80px;background:linear-gradient(180deg,#f6efe7,#c88a58)}.motif-legal .object-core{border-radius:8px;background:linear-gradient(135deg,#f3efe8,#c9b98d)}.motif-legal .object-lid{top:26%;background:linear-gradient(135deg,#e7d7ad,#9b2358)}.motif-legal .object-detail{width:42%;height:30%;border-radius:8px;background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,255,255,.32))}.story[data-active="1"] .object-lid{transform:translateY(-54px) rotateX(68deg) rotate(-4deg)}.story[data-active="1"] .object-detail{opacity:.75;transform:translateY(18px) scale(.92)}.story[data-active="2"] .object-core{transform:translateY(40px) rotate(0deg) scale(.82)}.story[data-active="2"] .object-detail{opacity:1;transform:translateY(34px) scale(1.12)}.story[data-active="2"] .hand{opacity:1}.story[data-active="2"] .hand.left{transform:translateX(10px) rotate(5deg)}.story[data-active="2"] .hand.right{transform:translateX(-10px) rotate(-7deg)}.story[data-active="3"] .object-lid{transform:translateY(-72px) rotateX(76deg)}.story[data-active="3"] .object-detail{opacity:1;transform:translateY(10px) scale(1.28)}.story[data-active="3"] .steam{opacity:1;transform:translateY(-24px)}.story-copy{align-self:center;max-width:560px}.scene-count{color:#6ee7d8;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.story-copy h2{margin-top:18px;font-size:56px;line-height:.98;letter-spacing:0;text-transform:uppercase}.story-copy p{margin-top:18px;color:rgba(255,255,255,.75);font-size:18px;line-height:1.7}.story-progress{margin-top:32px;height:4px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden}.story-progress span{display:block;height:100%;width:calc(var(--story-progress) * 100%);background:linear-gradient(90deg,#b7295f,#0f9f93)}.story-steps{position:absolute;left:6%;right:6%;bottom:34px;z-index:2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.story-step{min-height:74px;padding:14px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.06);backdrop-filter:blur(12px);opacity:.5;transition:opacity .3s ease,transform .3s ease}.story-step span{display:block;color:#6ee7d8;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.story-step b{display:block;margin-top:7px;font-size:13px;line-height:1.25;text-transform:uppercase}.story[data-active="0"] .story-step[data-scene="0"],.story[data-active="1"] .story-step[data-scene="1"],.story[data-active="2"] .story-step[data-scene="2"],.story[data-active="3"] .story-step[data-scene="3"]{opacity:1;transform:translateY(-6px);border-color:rgba(110,231,216,.48)}.proof{padding:88px 6%;background:#f6f7f2;color:#171719}.proof-inner{width:min(1120px,100%);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:56px;align-items:start}.label{color:#b7295f}.proof h2{margin-top:14px;font-size:52px;line-height:1;letter-spacing:0;text-transform:uppercase}.proof p{margin-top:18px;color:#595f66;font-size:17px;line-height:1.75}.proof-list{margin:0;padding:0;list-style:none;display:grid;gap:12px}.proof-list li{display:grid;grid-template-columns:44px minmax(0,1fr);gap:14px;align-items:center;min-height:58px;border-bottom:1px solid rgba(23,23,25,.14);font-weight:900;text-transform:uppercase}.proof-list span{color:#0f9f93;font-size:12px}.final-band{padding:76px 6%;background:#171719;color:#fff}.final-inner{width:min(1120px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:28px}.final-band h2{font-size:48px;line-height:1;letter-spacing:0;text-transform:uppercase}.final-band p{max-width:620px;margin-top:14px;color:rgba(255,255,255,.72);line-height:1.7}.domain{color:#6ee7d8;font-weight:900;text-transform:uppercase}@media(max-width:900px){.hero h1{font-size:58px}.story-stage{grid-template-columns:1fr;padding:54px 22px 138px}.story-visual{height:42vh}.story-copy h2{font-size:38px}.story-steps{left:22px;right:22px;grid-template-columns:1fr 1fr}.proof-inner,.final-inner{display:grid;grid-template-columns:1fr}.proof h2,.final-band h2{font-size:38px}}@media(max-width:560px){.hero{min-height:82vh}.hero-copy{padding:72px 22px}.hero h1{font-size:46px}.hero p,.story-copy p{font-size:16px}.story{min-height:460vh}.story-stage{height:100svh}.story-visual{height:36vh}.story-steps{grid-template-columns:1fr;bottom:18px}.story-step{min-height:48px;padding:10px}.story-step b{font-size:12px}.proof,.final-band{padding:58px 22px}}
</style>
</head>
<body>
<main>
<section class="hero">
<video autoplay muted loop playsinline src="${escapeHtml(getVideoRoute(job.id))}"></video>
<div class="hero-copy">
<div class="kicker">${domain || 'Premium webdesign'} / ${escapeHtml(motif.label)}</div>
<h1>${company}</h1>
<p>${description}</p>
<div class="cta-row"><a class="cta primary" href="#contact">Plan kennismaking</a><a class="cta secondary" href="#scrollfilm">Start de scrollfilm</a></div>
</div>
</section>
<section class="story motif-${escapeHtml(motif.key)}" id="scrollfilm" data-cinematic-scroll-story data-active="0">
<div class="story-stage">
<video class="story-video" autoplay muted loop playsinline src="${escapeHtml(getVideoRoute(job.id))}"></video>
<div class="story-visual" aria-hidden="true">
<div class="cinematic-object">
<div class="object-shadow"></div>
<div class="object-lid"></div>
<div class="object-core"></div>
<div class="object-detail"></div>
<div class="hand left"></div><div class="hand right"></div>
<div class="steam one"></div><div class="steam two"></div><div class="steam three"></div>
</div>
</div>
<div class="story-copy" data-story-copy>
<div class="scene-count" data-scene-count>Act 01</div>
<h2 data-scene-title>${escapeHtml(motif.scenes[0][0])}</h2>
<p data-scene-copy>${escapeHtml(motif.scenes[0][1])}</p>
<div class="story-progress"><span></span></div>
</div>
${steps ? `<div class="story-steps">${steps}</div>` : ''}
</div>
</section>
<section class="proof" id="aanpak">
<div class="proof-inner">
<div><div class="label">Van website naar ervaring</div><h2>Een site die zich laag voor laag ontvouwt.</h2><p>Deze versie gebruikt de bestaande website als bron, maar bouwt er een premium scrollverhaal omheen: video, beweging, tastbare details en duidelijke conversie.</p></div>
<ul class="proof-list">${proofItems}</ul>
</div>
</section>
<section class="final-band" id="contact">
<div class="final-inner">
<div><div class="label">Premium conversie</div><h2>Klaar om van aandacht actie te maken.</h2><p>De ervaring voelt als een merkfilm, maar blijft gebouwd rond vertrouwen, momentum en aanvragen.</p></div>
<div class="domain">${domain}</div>
</div>
</section>
</main>
<script>
(function(){
  var story=document.querySelector('[data-cinematic-scroll-story]');
  if(!story)return;
  var steps=Array.prototype.slice.call(story.querySelectorAll('.story-step'));
  var count=story.querySelector('[data-scene-count]');
  var title=story.querySelector('[data-scene-title]');
  var copy=story.querySelector('[data-scene-copy]');
  var ticking=false;
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function render(){
    ticking=false;
    var rect=story.getBoundingClientRect();
    var max=Math.max(1,rect.height-window.innerHeight);
    var progress=clamp(-rect.top/max,0,1);
    var active=steps.length?Math.min(steps.length-1,Math.floor(progress*steps.length)):0;
    var step=steps[active];
    story.dataset.active=String(active);
    story.style.setProperty('--story-progress',progress.toFixed(4));
    if(step){
      if(count)count.textContent='Act '+String(active+1).padStart(2,'0');
      if(title)title.textContent=step.getAttribute('data-title')||'';
      if(copy)copy.textContent=step.getAttribute('data-copy')||'';
    }
  }
  function request(){if(!ticking){ticking=true;requestAnimationFrame(render);}}
  window.addEventListener('scroll',request,{passive:true});
  window.addEventListener('resize',request);
  render();
}());
</script>
</body>
</html>`;
  }

  async function advanceJob(job) {
    if (!job || job.status === 'done' || job.status === 'error') return job;
    if (activeAdvances.has(job.id)) return activeAdvances.get(job.id);
    const promise = (async () => {
      try {
        if (!job.startedAt) job.startedAt = now();
        job.status = 'running';
        if (job.stage === 'queued') {
          setStage(job, 'scanning', 12);
          await persistJob(job);
          const fetched = await scanWebsite(job);
          job.site = { requestedUrl: job.websiteUrl, normalizedUrl: fetched.normalizedUrl || job.websiteUrl, finalUrl: fetched.finalUrl || job.websiteUrl, host: fetched.scan?.host || '', scanFallback: Boolean(fetched.scanFallback) };
          job.scan = summarizeScan(fetched.scan || {});
          setStage(job, 'images', 34);
          await persistJob(job);
        }
        if (job.stage === 'images') {
          const generated = await (generateCinematicImages || defaultGenerateImages)(job);
          const images = Array.isArray(generated?.images) ? generated.images : [];
          job.imageCount = images.length;
          job.imagePrompt = generated?.prompt || '';
          job.imageModel = generated?.model || '';
          setStage(job, 'video', 58);
          const submitted = await (submitVeoVideo || defaultSubmitVeo)(job, images);
          job.videoOperationName = submitted.operationName;
          job.rawVideoOperation = submitted.raw || null;
          job.nextPollAt = now() + VEO_POLL_INTERVAL_MS;
          setStage(job, 'video', 68);
          await persistJob(job);
          return job;
        }
        if (job.stage === 'video') {
          if (job.nextPollAt && now() < job.nextPollAt && !job.videoReady) return job;
          const status = await (pollVeoOperation || defaultPollVeo)(job);
          job.rawVideoOperation = status.raw || null;
          if (!status.done) {
            job.nextPollAt = now() + VEO_POLL_INTERVAL_MS;
            setStage(job, 'video', Math.max(70, Math.min(86, Number(job.progress || 70) + 3)));
            await persistJob(job);
            return job;
          }
          job.videoUri = status.videoUri;
          job.videoReady = true;
          job.nextPollAt = null;
          setStage(job, 'site', 90);
          await persistJob(job);
        }
        if (job.stage === 'site') {
          const html = await (buildCinematicSiteHtml || defaultSiteHtml)(job);
          job.result = { html, source: buildCinematicSiteHtml ? 'custom-cinematic-builder' : 'softora-cinematic-builder', generatedAt: new Date(now()).toISOString() };
          job.status = 'done';
          job.error = null;
          job.finishedAt = now();
          setStage(job, 'done', 100);
          await persistJob(job);
          await persistCompletedSite(job);
        }
      } catch (error) {
        job.status = 'error';
        job.error = truncateText(normalizeString(error?.message) || 'Cinematic website maken is mislukt.', 600);
        job.finishedAt = now();
        setStage(job, 'error', Number(job.progress || 0) || 0);
        if (typeof logger.error === 'function') logger.error('[PremiumDatabaseCinematicJobs][advance]', error?.message || error);
        await persistJob(job);
      }
      return job;
    })();
    activeAdvances.set(job.id, promise);
    try { return await promise; } finally { activeAdvances.delete(job.id); }
  }

  async function startJob(input = {}) {
    const ownerKey = normalizeString(input.ownerKey);
    if (!ownerKey) return { ok: false, statusCode: 401, error: 'Niet ingelogd' };
    const customer = normalizeCustomer(input.customer || input);
    if (!customer.id) customer.id = createJobId();
    const websiteUrl = normalizeWebsiteUrl(input.websiteUrl || input.url || input.website) || normalizeWebsiteUrl(customer.website) || normalizeWebsiteUrl(customer.dom);
    if (!websiteUrl) return { ok: false, statusCode: 400, error: 'Website ontbreekt', detail: 'Er is een geldige website of domeinnaam nodig voor de cinematic flow.' };
    for (const existing of jobs.values()) {
      if (!existing || existing.ownerKey !== ownerKey) continue;
      if (existing.customer?.id !== customer.id && existing.websiteUrl !== websiteUrl) continue;
      if (existing.status === 'done' && existing.result?.html) return { ok: true, statusCode: 200, existing: true, cached: true, job: serializeJob(existing) };
      if (existing.status !== 'error') return { ok: true, statusCode: 202, existing: true, job: serializeJob(existing) };
    }
    const storedActiveJob = await findStoredActiveJob(ownerKey, customer, websiteUrl);
    if (storedActiveJob) {
      if (storedActiveJob.status === 'done' && storedActiveJob.result?.html) {
        return { ok: true, statusCode: 200, existing: true, cached: true, job: serializeJob(storedActiveJob) };
      }
      return { ok: true, statusCode: 202, existing: true, job: serializeJob(storedActiveJob) };
    }
    const completedSite = await findCompletedSite(ownerKey, customer, websiteUrl);
    if (completedSite) return { ok: true, statusCode: 200, existing: true, cached: true, job: serializeJob(completedSite) };
    const providerStatus = getProviderStatus();
    if (!providerStatus.ready) {
      return {
        ok: false,
        statusCode: 503,
        code: 'CINEMATIC_PROVIDER_NOT_CONFIGURED',
        error: 'Cinematic API niet compleet',
        detail: `Configureer eerst ${providerStatus.missing.join(' en ')} voordat een nieuwe cinematic website gemaakt kan worden.`,
        providerStatus,
      };
    }
    const job = { id: createJobId(), ownerKey, customer, websiteUrl, status: 'queued', stage: 'queued', progress: 5, site: null, scan: null, imageCount: 0, videoReady: false, videoUri: '', videoOperationName: '', rawVideoOperation: null, result: null, error: null, createdAt: now(), startedAt: null, updatedAt: now(), finishedAt: null, nextPollAt: null };
    jobs.set(job.id, job);
    await persistJob(job);
    return { ok: true, statusCode: 202, existing: false, job: serializeJob(job) };
  }
  async function getJob(input = {}) {
    const ownerKey = normalizeString(input.ownerKey);
    if (!ownerKey) return { ok: false, statusCode: 401, error: 'Niet ingelogd' };
    const job = await loadJob(input.jobId);
    if (!job) return { ok: false, statusCode: 404, error: 'Job niet gevonden' };
    if (job.ownerKey !== ownerKey) return { ok: false, statusCode: 403, error: 'Geen toegang' };
    await advanceJob(job);
    return { ok: true, statusCode: job.status === 'done' ? 200 : 202, job: serializeJob(job) };
  }
  async function startJobResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await startJob({ ...body, ownerKey: ownerKeyFromReq(req), customer: body.customer || body });
    return res.status(Math.max(100, Math.min(599, Number(result.statusCode) || 500))).json(result);
  }
  async function configResponse(_req, res) {
    return res.status(200).json({ ok: true, providerStatus: getProviderStatus() });
  }
  async function getJobResponse(req, res) {
    const result = await getJob({ ownerKey: ownerKeyFromReq(req), jobId: req.params && req.params.jobId });
    return res.status(Math.max(100, Math.min(599, Number(result.statusCode) || 500))).json(result);
  }
  async function getVideoResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const job = await loadJob(req.params && req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'Job niet gevonden' });
    if (job.ownerKey !== ownerKey) return res.status(403).json({ ok: false, error: 'Geen toegang' });
    if (!job.videoUri) return res.status(404).json({ ok: false, error: 'Video nog niet klaar' });
    const apiKey = normalizeString(getGeminiApiKey());
    if (!apiKey) return res.status(503).json({ ok: false, error: 'GEMINI_API_KEY ontbreekt voor video download' });
    try {
      const response = await fetch(geminiApiUrl(job.videoUri), { method: 'GET', headers: { 'x-goog-api-key': apiKey }, redirect: 'follow' });
      if (!response.ok) return res.status(response.status || 502).json({ ok: false, error: 'Video downloaden mislukt' });
      res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (response.body && typeof Readable.fromWeb === 'function' && typeof res.write === 'function') {
        res.status(200);
        await pipeReadableToResponse(Readable.fromWeb(response.body), res);
        return null;
      }
      return res.status(200).send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseCinematicJobs][video]', error?.message || error);
      return res.status(502).json({ ok: false, error: 'Video downloaden mislukt' });
    }
  }
  return { startJob, getJob, getProviderStatus, startJobResponse, configResponse, getJobResponse, getVideoResponse };
}

function pipeReadableToResponse(readable, res) {
  return (async () => {
    for await (const chunk of readable) {
      const canContinue = res.write(chunk);
      if (canContinue === false && typeof res.once === 'function') {
        await new Promise((resolve, reject) => {
          res.once('drain', resolve);
          res.once('error', reject);
        });
      }
    }
    if (typeof res.end === 'function') res.end();
  })();
}

function createFetchJsonWithTimeout() {
  return async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 30000)) : null;
    try {
      const response = await fetch(url, { ...options, signal: controller ? controller.signal : options.signal });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      return { response, data };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { createPremiumDatabaseCinematicJobsCoordinator };
