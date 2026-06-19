const { Readable } = require('node:stream');

const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_VEO_MODEL = 'veo-3.1-generate-preview';
const DEFAULT_IMAGE_COUNT = 8;
const MIN_IMAGE_SEQUENCE_COUNT = 4;
const MAX_IMAGE_SEQUENCE_COUNT = 8;
const SITE_BUILDER_VERSION = 'scroll-veo-canvas-v2';
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
    imageCount = process.env.PREMIUM_CINEMATIC_IMAGE_COUNT || DEFAULT_IMAGE_COUNT,
    imageSize = process.env.PREMIUM_CINEMATIC_IMAGE_SIZE || '2048x1152',
    imageQuality = process.env.PREMIUM_CINEMATIC_IMAGE_QUALITY || 'medium',
    veoPollIntervalMs = process.env.PREMIUM_CINEMATIC_VEO_POLL_MS || 10000,
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    dataOpsStore = null,
    now = () => Date.now(),
    random = Math.random,
    generateCinematicImages = null,
    submitVeoVideo = null,
    pollVeoOperation = null,
    buildCinematicSiteHtml = null,
    useVeo = normalizeString(process.env.PREMIUM_CINEMATIC_USE_VEO || '1'),
  } = deps;

  const jobs = new Map();
  const activeAdvances = new Map();
  const IMAGE_COUNT = Math.max(
    MIN_IMAGE_SEQUENCE_COUNT,
    Math.min(MAX_IMAGE_SEQUENCE_COUNT, Math.floor(Number(imageCount) || DEFAULT_IMAGE_COUNT))
  );
  const USE_VEO = !(useVeo === false || /^(0|false|no|off)$/i.test(normalizeString(useVeo)));
  const VEO_POLL_INTERVAL_MS = Math.max(2500, Math.min(60000, Number(veoPollIntervalMs) || 10000));

  const ownerKeyFromReq = (req) => {
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    return email || uid ? `${email}::${uid}` : '';
  };
  const normalizeJobId = (value) => (/^[a-z0-9_-]{12,140}$/i.test(normalizeString(value)) ? normalizeString(value) : '');
  const createJobId = () => `cin_${now().toString(36)}_${Math.floor(random() * 1e12).toString(36)}`;
  const getVideoRoute = (jobId) => `/api/premium-database/cinematic-jobs/${encodeURIComponent(jobId)}/video`;
  const getFrameRoute = (jobId, index) =>
    `/api/premium-database/cinematic-jobs/${encodeURIComponent(jobId)}/frame/${encodeURIComponent(String(index + 1))}`;

  function getProviderStatus() {
    const openAiConfigured = Boolean(normalizeString(getOpenAiApiKey()));
    const geminiConfigured = Boolean(normalizeString(getGeminiApiKey()));
    const missing = [];
    if (!openAiConfigured) missing.push('OPENAI_API_KEY');
    if (USE_VEO && !geminiConfigured) missing.push('GEMINI_API_KEY');
    return {
      ready: missing.length === 0,
      missing,
      openAi: {
        configured: openAiConfigured,
        imageModel: normalizeString(openAiImageModel) || DEFAULT_IMAGE_MODEL,
        apiBaseUrlConfigured: Boolean(normalizeString(openAiApiBaseUrl)),
      },
      veo: {
        enabled: USE_VEO,
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
      site: 'Scrollsite wordt samengesteld',
      done: 'Cinematic website staat klaar',
      error: 'Proces gestopt',
    }[stage] || 'Opdracht staat klaar';
  }
  function setStage(job, stage, progress) {
    job.stage = stage;
    job.progress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    job.updatedAt = now();
  }
  function normalizeFrameMeta(frame = {}, index = 0) {
    const safeIndex = Math.max(0, Number(frame.index ?? index) || 0);
    return {
      index: safeIndex,
      title: truncateText(normalizeString(frame.title), 140),
      overlayTitle: truncateText(normalizeString(frame.overlayTitle || frame.title), 120),
      overlayCopy: truncateText(normalizeString(frame.overlayCopy || frame.copy), 280),
      fileName: truncateText(normalizeString(frame.fileName || `cinematic-frame-${safeIndex + 1}.png`), 180),
      prompt: truncateText(normalizeString(frame.prompt || frame.revisedPrompt), 1800),
      revisedPrompt: truncateText(normalizeString(frame.revisedPrompt), 1800),
      mimeType: normalizeString(frame.mimeType || 'image/png').toLowerCase(),
      customerId: truncateText(normalizeString(frame.customerId), 160),
      storageBucket: truncateText(normalizeString(frame.storageBucket), 180),
      storagePath: truncateText(normalizeString(frame.storagePath), 360),
      updatedAt: truncateText(normalizeString(frame.updatedAt), 80),
    };
  }
  function normalizeFrames(frames = []) {
    return (Array.isArray(frames) ? frames : []).map((frame, index) => normalizeFrameMeta(frame, index));
  }
  function publicFrameSummary(job) {
    return normalizeFrames(job?.cinematicFrames).map((frame, index) => ({
      index: frame.index,
      title: frame.overlayTitle || frame.title,
      fileName: frame.fileName,
      url: getFrameRoute(job.id, index),
    }));
  }
  function isReusableCompletedJob(job) {
    if (!job || job.status !== 'done' || !job.result?.html) return false;
    return normalizeString(job.builderVersion || job.result.builderVersion || '') === SITE_BUILDER_VERSION;
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
      frameCount: normalizeFrames(job.cinematicFrames).length,
      frames: publicFrameSummary(job),
      video: { ready: Boolean(job.videoReady && job.videoUri), url: job.videoReady && job.videoUri ? getVideoRoute(job.id) : '' },
      result: job.result && job.result.html ? { html: job.result.html, source: job.result.source || 'softora-cinematic-builder', generatedAt: job.result.generatedAt || null, builderVersion: job.result.builderVersion || SITE_BUILDER_VERSION } : null,
      error: job.error || null,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      updatedAt: job.updatedAt || job.createdAt,
      finishedAt: job.finishedAt || null,
      nextPollAt: job.nextPollAt || null,
      cachedSite: Boolean(job.cachedSite),
      builderVersion: normalizeString(job.builderVersion || job.result?.builderVersion || ''),
    };
  }
  function compactJob(job) {
    return {
      ...serializeJob(job),
      ownerKey: job.ownerKey,
      videoUri: job.videoUri || '',
      videoOperationName: job.videoOperationName || '',
      rawVideoOperation: job.rawVideoOperation || null,
      imageModel: normalizeString(job.imageModel || ''),
      imagePrompt: truncateText(normalizeString(job.imagePrompt || ''), 5000),
      imageScenes: normalizeFrames(job.imageScenes),
      cinematicFrames: normalizeFrames(job.cinematicFrames),
    };
  }
  function compactSite(job) {
    return {
      id: job.id,
      ownerKey: job.ownerKey,
      identityKeys: siteIdentityKeys(job.ownerKey, job.customer, job.websiteUrl),
      customer: job.customer,
      websiteUrl: job.websiteUrl,
      site: job.site || null,
      scan: job.scan || null,
      imageCount: Math.max(0, Number(job.imageCount || 0) || 0),
      imageModel: normalizeString(job.imageModel || ''),
      imageScenes: normalizeFrames(job.imageScenes),
      cinematicFrames: normalizeFrames(job.cinematicFrames),
      videoReady: Boolean(job.videoReady && job.videoUri),
      videoUri: job.videoUri || '',
      result: job.result || null,
      builderVersion: normalizeString(job.builderVersion || job.result?.builderVersion || SITE_BUILDER_VERSION),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt || now(),
      finishedAt: job.finishedAt || now(),
    };
  }
  function hydrateJob(stored) {
    if (!stored || typeof stored !== 'object') return null;
    const id = normalizeJobId(stored.id);
    const ownerKey = normalizeString(stored.ownerKey);
    if (!id || !ownerKey) return null;
    return { id, ownerKey, status: normalizeString(stored.status) || 'queued', stage: normalizeString(stored.stage) || 'queued', progress: Math.max(0, Math.min(100, Number(stored.progress || 0) || 0)), customer: normalizeCustomer(stored.customer || {}), websiteUrl: normalizeWebsiteUrl(stored.websiteUrl), site: stored.site || null, scan: stored.scan || null, imageCount: Math.max(0, Number(stored.imageCount || 0) || 0), imageModel: normalizeString(stored.imageModel || ''), imagePrompt: normalizeString(stored.imagePrompt || ''), imageScenes: normalizeFrames(stored.imageScenes), cinematicFrames: normalizeFrames(stored.cinematicFrames), videoReady: Boolean(stored.video?.ready || stored.videoReady), videoUri: normalizeString(stored.videoUri || ''), videoOperationName: normalizeString(stored.videoOperationName || ''), rawVideoOperation: stored.rawVideoOperation || null, result: stored.result || null, builderVersion: normalizeString(stored.builderVersion || stored.result?.builderVersion || ''), error: normalizeString(stored.error || ''), createdAt: Number(stored.createdAt || 0) || now(), startedAt: Number(stored.startedAt || 0) || null, updatedAt: Number(stored.updatedAt || 0) || null, finishedAt: Number(stored.finishedAt || 0) || null, nextPollAt: Number(stored.nextPollAt || 0) || null, cachedSite: Boolean(stored.cachedSite) };
  }
  function hydrateSite(stored) {
    const job = hydrateJob({ ...stored, status: 'done', stage: 'done', progress: 100, video: { ready: stored?.videoReady }, cachedSite: true });
    return isReusableCompletedJob(job) ? job : null;
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
  function sceneFileName(title, index) {
    const slug = identityPart(title).replace(/-/g, '-').slice(0, 80) || `frame-${index + 1}`;
    return `image-${index + 1}-${slug}.png`;
  }
  function companyContext(job) {
    const scan = job.scan || {};
    const company = job.customer.bedrijf || scan.h1 || scan.host || 'het bedrijf';
    const headings = Array.isArray(scan.headings) ? scan.headings.slice(0, 7).join(', ') : '';
    const paragraphs = Array.isArray(scan.paragraphs) ? scan.paragraphs.slice(0, 4).join(' ') : '';
    const palette = Array.isArray(scan.brandPalette) && scan.brandPalette.length ? scan.brandPalette.join(', ') : 'deep crimson accents, warm white space, refined black typography, one fresh teal highlight';
    return { company, headings, paragraphs, palette };
  }
  function framePrompt(parts = []) {
    return parts.filter(Boolean).join('\n');
  }
  function lockedStudioRules(job, subject, extraContext = '') {
    const { company, headings, paragraphs, palette } = companyContext(job);
    return framePrompt([
      `Premium cinematic scroll website frame for ${company}. Subject: ${subject}.`,
      'Keep the whole sequence perfectly consistent: exact same camera position, exact same lens, exact same central object scale, camera completely locked, zero movement.',
      'Pure black background, single warm amber studio light from directly above, soft realistic shadows, professional DSLR macro product photography, ultra photorealistic 8K, 16:9 composition.',
      'Realistic physics only. No artificial glow. No light trails. No energy effects. No CGI glow. No energy rings. No artificial light effects.',
      'No readable text, no letters, no labels, no logos, no watermarks.',
      `Brand palette hints: ${palette}.`,
      headings ? `Website themes: ${headings}.` : '',
      paragraphs ? `Business context: ${paragraphs}` : '',
      extraContext,
    ]);
  }
  function buildTeaScenes(job) {
    const prefix = lockedStudioRules(job, 'a premium tea ritual with one glass cup and botanical ingredients');
    return [
      {
        title: 'Tea Bag Sealed',
        overlayTitle: 'Het ritueel opent',
        overlayCopy: 'De eerste scroll voelt als een luxe productmoment dat net gaat beginnen.',
        prompt: framePrompt([
          prefix,
          'A single premium tea bag floating in the exact vertical center of the frame, completely sealed and intact, delicate cream cotton fabric texture, string attached at top, suspended in mid-air with no surface, no floor, no table beneath it.',
        ]),
      },
      {
        title: 'Herbs Orbiting',
        overlayTitle: 'Smaak komt los',
        overlayCopy: 'Het centrale object opent en de ingrediënten komen als een filmisch detail naar voren.',
        prompt: framePrompt([
          prefix,
          'The same tea bag fully open with four fabric flaps peeled back, center of frame, green herb leaves suspended above, dried rose petals drifting to the sides, cardamom pods floating outward, all in a clean orbital formation under the same warm amber top light.',
        ]),
      },
      {
        title: 'Ingredients Falling',
        overlayTitle: 'Beleving wordt beweging',
        overlayCopy: 'De scène verandert in een cascade die de bezoeker letterlijk door het verhaal trekt.',
        prompt: framePrompt([
          prefix,
          'The same dried herb leaves, rose petals and cardamom pods now falling downward in slow motion above the same open tea bag. Gravity is visible: rose petals tumble and rotate slowly, herb leaves drift with slight air resistance, cardamom pods drop with more weight, fine spice dust falls last. No artificial glow or fantasy effects.',
        ]),
      },
      {
        title: 'Glass Cup Brewing',
        overlayTitle: 'Het moment wordt tastbaar',
        overlayCopy: 'Warmte, beweging en productwaarde komen samen in één premium kernbeeld.',
        prompt: framePrompt([
          prefix,
          'A stunning handblown glass tea cup with no handles floating in the exact vertical center of the frame, crystal clear thin walls filled with hot steaming water. The same botanical ingredients enter the cup from above one by one, rose petals pierce the water surface with tiny circular ripples, herb leaves spread open, cardamom pods sink slowly, golden spice dust blooms outward as amber color bleeds through clear water like ink dissolving.',
        ]),
      },
      {
        title: 'Brewed Cup',
        overlayTitle: 'De belofte is helder',
        overlayCopy: 'Alles is nu één rustige, overtuigende premium ervaring.',
        prompt: framePrompt([
          prefix,
          'The same handblown glass tea cup now completely filled with brewed amber-gold tea liquid. All ingredients are settled and floating at different depths, visible through the crystal clear glass walls. Delicate wisps of white steam rise gently, the cup floats completely in mid-air with no surface, no floor, no table beneath it.',
        ]),
      },
      {
        title: 'Hands Wrapping Cup',
        overlayTitle: 'Menselijke aandacht',
        overlayCopy: 'Het product krijgt warmte en nabijheid zonder dat het beeld risicovol wordt.',
        prompt: framePrompt([
          prefix,
          'The same handblown glass tea cup filled with amber tea floating in the exact vertical center of the frame. Two elegant hands wearing matte cream cotton gloves enter slowly from both sides, fingers gently curling around the outside of the warm glass cup. Only the gloved hands are visible, no faces, no skin, no body, no sensual pose, no table, no floor.',
        ]),
      },
      {
        title: 'Premium Product Card',
        overlayTitle: 'Van beleving naar merk',
        overlayCopy: 'Het ritueel wordt vertaald naar een high-end digitale merkervaring.',
        prompt: framePrompt([
          prefix,
          'The same tea cup and botanical ingredients now arranged as a luxury hero visual for a premium website, deep black negative space, subtle realistic glass reflections, expensive product photography mood, no interface text and no brand marks.',
        ]),
      },
      {
        title: 'Scroll Website Moment',
        overlayTitle: 'Klaar voor conversie',
        overlayCopy: 'De filmische energie eindigt in een websitebeeld dat vertrouwen en actie oproept.',
        prompt: framePrompt([
          prefix,
          'A final cinematic website hero moment built from the same tea cup, steam, amber light and botanical details, premium layout composition without readable text, deep black background, strong negative space for overlay copy, high-end conversion website mood.',
        ]),
      },
    ];
  }
  function buildLegalScenes(job) {
    const prefix = lockedStudioRules(job, 'a premium legal dossier and advisory materials');
    return [
      ['Sealed Dossier', 'Het dossier opent', 'De bezoeker komt binnen in een wereld van rust, precisie en vertrouwen.', 'A sealed premium legal dossier floating in the exact center of the frame, matte black leather cover, fine metallic edge detail, no visible text on the document, no table, no floor, no surface.'],
      ['Pages Revealing', 'Bewijs krijgt focus', 'Bij elke scroll komen details naar voren alsof argumenten zorgvuldig worden opgebouwd.', 'The same legal dossier now opening in mid-air, several cream paper sheets lifting upward in slow motion, abstract evidence markers and subtle glass tabs floating around it, no readable text anywhere.'],
      ['Arguments Aligning', 'Structuur wordt zichtbaar', 'Complexiteit valt op zijn plek en verandert in helderheid.', 'The same papers and evidence elements now arranging into a precise radial formation, polished metal pen floating nearby, authoritative and calm, realistic paper fibers and metal reflections, no readable writing, no logos.'],
      ['Decision Moment', 'Zekerheid ontstaat', 'De scene verschuift van informatie naar overtuiging.', 'A premium fountain pen and the same open dossier suspended in mid-air, warm light catching paper fibers, a subtle blind embossed seal shape without text, cinematic depth of field, no desk or office clutter.'],
      ['Trust Anchors', 'Expertise wordt tastbaar', 'Subtiele materialen maken het premium gevoel persoonlijk en betrouwbaar.', 'Two refined brushed-metal arcs and translucent glass markers hold the open dossier in mid-air like a museum display, careful and confident composition, no people, no skin, no faces, no body parts, no readable text, no table, no floor.'],
      ['Trust Tableau', 'Van twijfel naar gesprek', 'Het verhaal eindigt in een duidelijke, premium volgende stap.', 'A final cinematic brand tableau built from the same dossier, pen, floating papers and warm amber top light, negative space for web copy overlays, refined premium legal website mood, no actual letters or logos.'],
    ].map(([title, overlayTitle, overlayCopy, prompt]) => ({ title, overlayTitle, overlayCopy, prompt: framePrompt([prefix, prompt]) }));
  }
  function buildSculptureScenes(job) {
    const prefix = lockedStudioRules(job, 'an abstract non-figurative sculpture for an atelier and sculpture garden', 'Strictly no human figures, no faces, no anatomy, no nude form, no body-like silhouette. Use abstract stone, bronze, clay, patina, moss and garden materials only.');
    return [
      ['Raw Stone Block', 'Het materiaal ontwaakt', 'De eerste scroll voelt als een ateliermoment voordat het kunstwerk zichtbaar wordt.', 'A raw rectangular block of pale limestone and dark bronze patina floating in the exact vertical center of the frame, rough chisel marks, tiny dust particles suspended naturally around it, no pedestal, no floor, no wall.'],
      ['Chisel Dust Suspended', 'Vorm komt los', 'Stof, steen en richting maken de ambachtelijke waarde voelbaar.', 'The same stone and bronze block now showing clean abstract cut lines opening across the surface, fine stone dust and bronze filings suspended in mid-air, realistic gravity beginning to pull the heaviest particles downward.'],
      ['Fragments Falling', 'Beweging wordt ambacht', 'Het ruwe materiaal valt laag voor laag weg en onthult intentie.', 'The same abstract material now shedding small stone chips and bronze fragments in ultra slow motion. Heavy fragments fall faster, fine dust falls last, each piece casts realistic shadows under the single amber top light, no sparks, no fantasy effects.'],
      ['Abstract Sculpture Emerging', 'Het kunstwerk verschijnt', 'De scroll onthult een sculptuur zonder uitleg nodig te hebben.', 'The same raw material transforms into a finished abstract non-figurative sculpture, curved stone and brushed bronze surfaces emerging from the center, wet moss accents and garden gravel suspended subtly around it, no human shape, no face, no anatomy.'],
      ['Garden Gallery Atmosphere', 'Atelier wordt beleving', 'Binnen en buiten komen samen als premium beeldentuinervaring.', 'The same abstract sculpture now surrounded by a restrained hint of sculpture garden atmosphere: dark moss, black gravel, a few soft leaves, and a distant blurred atelier light, all still floating on pure black background, museum-grade product photography.'],
      ['Finished Sculpture Hero', 'Van kunst naar aanvraag', 'Het eindbeeld voelt als een premium website voor mensen die kwaliteit zoeken.', 'A final cinematic website hero composition built from the same abstract stone and bronze sculpture, warm amber top light, deep black negative space, refined gallery mood, no readable text, no logos, no human figures.'],
      ['Collector Detail', 'Detail verkoopt waarde', 'Materiaal, textuur en stilte maken het premium gevoel concreet.', 'Extreme macro detail of the same abstract sculpture surface: limestone grain, brushed bronze edge, tiny dust resting in carved grooves, a single moss detail, pure black background, identical lighting language, no letters, no people.'],
      ['Atelier Tableau', 'Klaar voor contact', 'De laatste scene zet aandacht om in vertrouwen en een duidelijke volgende stap.', 'The same finished abstract sculpture, raw material chips and refined garden textures arranged as an elegant final tableau for a premium atelier website, strong negative space for overlay copy, no readable text, no logos, no body-like forms.'],
    ].map(([title, overlayTitle, overlayCopy, prompt]) => ({ title, overlayTitle, overlayCopy, prompt: framePrompt([prefix, prompt]) }));
  }
  function buildBrandScenes(job) {
    const prefix = lockedStudioRules(job, 'a physical premium symbol for the company offer');
    return [
      ['Brand Object Sealed', 'Het verhaal opent', 'De eerste scroll zet een gewoon bedrijf om in een merkervaring.', 'A mysterious premium tactile object representing the company offer floating in the exact vertical center of the frame, closed and intact, matte black ceramic, brushed metal and clear glass materials, no surface, no floor, no table beneath it.'],
      ['Core Reveal', 'De kern komt vrij', 'Het object opent en laat de essentie van het bedrijf zien zonder woorden nodig te hebben.', 'The same central premium object now opening in four elegant panels, physical service tokens made of glass and metal emerging from within, clean negative space, realistic top light, no readable interface or text.'],
      ['Value Falling', 'Waarde wordt beweging', 'Details stromen naar voren alsof de bezoeker door het aanbod heen beweegt.', 'The same glass and metal service tokens now falling downward in ultra slow motion with realistic physics, heavier metal pieces drop faster, thin glass pieces rotate slowly, fine dust falls last, no light trails, no energy effects, no fantasy particles.'],
      ['Service In Action', 'Het aanbod wordt tastbaar', 'Het verhaal voelt niet meer als uitleg, maar als iets dat je bijna kunt aanraken.', 'A cinematic macro scene where the abstract company value becomes physical: refined tools, tactile materials and controlled motion converging around the same central object, expensive product photography, no people, no text.'],
      ['Outcome Formed', 'De belofte is helder', 'Alles komt samen in een rustig, overtuigend premium resultaat.', 'The same object now fully transformed into a refined final form with clean symmetry, realistic glass reflections, warm amber highlight and one subtle teal accent, strong negative space for website overlay copy, no readable marks.'],
      ['Guided Detail', 'Vertrouwen krijgt vorm', 'Warme materialen brengen schaal, rust en actie in het beeld.', 'Two elegant translucent glass support arcs and brushed metal guides hold the transformed object in mid-air like a museum display, careful and confident premium composition, no people, no skin, no faces, no body parts, no surface, no floor, no text.'],
      ['Premium Website Hero', 'Van film naar website', 'De scene wordt een digitale premium ervaring met conversie als eindpunt.', 'A high-end cinematic web hero composition built from the same object and tactile material detail, abstract layout without readable text, no letters, no logos, deep background and refined negative space.'],
      ['Conversion Tableau', 'Klaar voor actie', 'De laatste scene zet aandacht om in vertrouwen en contact.', 'Final premium brand tableau using the same transformed object and lighting language, confident quiet luxury, a clear focal point and empty space for a call to action overlay, no readable text or logos.'],
    ].map(([title, overlayTitle, overlayCopy, prompt]) => ({ title, overlayTitle, overlayCopy, prompt: framePrompt([prefix, prompt]) }));
  }
  function buildImageScenes(job) {
    const motif = scrollMotif(job);
    const baseScenes = motif.key === 'tea'
      ? buildTeaScenes(job)
      : motif.key === 'legal'
        ? buildLegalScenes(job)
        : motif.key === 'sculpture'
          ? buildSculptureScenes(job)
          : buildBrandScenes(job);
    return baseScenes.slice(0, IMAGE_COUNT).map((scene, index) => ({
      index,
      ...scene,
      fileName: sceneFileName(scene.title, index),
    }));
  }
  function imagePrompt(job) {
    return buildImageScenes(job)
      .map((scene, index) => `Image ${index + 1} - ${scene.title}\nSave as: ${scene.fileName}\n${scene.prompt}`)
      .join('\n\n');
  }
  function openAiErrorMessage(data = {}) {
    return normalizeString(data?.error?.message || data?.error?.detail || data?.message);
  }
  function isOpenAiImageSafetyRejection(response, data = {}) {
    const status = Number(response?.status || 0);
    const message = [
      openAiErrorMessage(data),
      normalizeString(data?.error?.code),
      normalizeString(data?.error?.type),
      normalizeString(data?.error?.param),
    ].join(' ');
    return Boolean(status >= 400 && /safety|rejected|violation|sexual|content policy|moderation/i.test(message));
  }
  function safetyFallbackPrompt(scene = {}, job = {}) {
    const { company, headings, palette } = companyContext(job);
    return framePrompt([
      `Premium cinematic scroll website frame for ${company}.`,
      `Scene: ${scene.title || 'Cinematic frame'}.`,
      headings ? `Website themes: ${headings}.` : '',
      `Brand palette hints: ${palette}.`,
      'Strictly object-only commercial still life. No people or anatomy. Avoid figure-like sculpture forms.',
      'Use abstract premium materials only: glass, stone, brushed metal, paper, light, particles, refined product details, elegant negative space.',
      'Camera completely locked, zero movement. Pure black background, single warm amber studio light from directly above, realistic physics only.',
      'No artificial glow. No light trails. No energy effects. No CGI glow. No energy rings. No artificial light effects.',
      'Photorealistic 8K, 16:9 composition, no readable text, no letters, no labels, no logos, no watermarks.',
    ]);
  }
  async function mapWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const results = new Array(list.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(list.length || 1, Number(limit) || 1)) }, async () => {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(list[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }
  async function defaultGenerateImages(job) {
    const apiKey = normalizeString(getOpenAiApiKey());
    if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY ontbreekt'), { status: 503 });
    const model = normalizeString(openAiImageModel) || DEFAULT_IMAGE_MODEL;
    const scenes = buildImageScenes(job);
    const endpoint = `${String(openAiApiBaseUrl || DEFAULT_OPENAI_API_BASE_URL).replace(/\/+$/, '')}/images/generations`;
    async function requestImage(scene, index, prompt, safetyFallback = false) {
      const body = { model, prompt, size: normalizeString(imageSize) || '2048x1152', quality: normalizeString(imageQuality) || 'medium', n: 1 };
      if (/^dall-e-[23]$/i.test(model)) body.response_format = 'b64_json';
      const { response, data } = await fetchJsonWithTimeout(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }, 240000);
      if (!response?.ok) {
        if (!safetyFallback && isOpenAiImageSafetyRejection(response, data)) {
          if (typeof logger.warn === 'function') logger.warn(`[PremiumDatabaseCinematicJobs][image-safety-retry] frame ${index + 1}`, openAiErrorMessage(data) || 'safety rejection');
          return requestImage(scene, index, safetyFallbackPrompt(scene, job), true);
        }
        const message = openAiErrorMessage(data) || `OpenAI cinematic beeld ${index + 1} mislukt`;
        throw Object.assign(new Error(message), { status: Number(response?.status) || 502, data });
      }
      const entry = Array.isArray(data?.data) ? data.data[0] : null;
      const base64 = normalizeString(entry?.b64_json || entry?.b64Json || '');
      if (!base64) throw Object.assign(new Error(`OpenAI gaf geen beelddata terug voor frame ${index + 1}.`), { status: 502, data });
      return {
        index,
        title: scene.title,
        overlayTitle: scene.overlayTitle,
        overlayCopy: scene.overlayCopy,
        mimeType: 'image/png',
        base64,
        revisedPrompt: normalizeString(entry?.revised_prompt || ''),
        fileName: scene.fileName,
        prompt,
        safetyFallback,
      };
    }
    const images = await mapWithConcurrency(scenes, 2, async (scene, index) => {
      return requestImage(scene, index, scene.prompt, false);
    });
    if (!images.length) throw Object.assign(new Error('OpenAI gaf geen cinematic beeld terug.'), { status: 502 });
    return { images, prompt: imagePrompt(job), model, scenes };
  }
  function veoPrompt(job) {
    const motif = scrollMotif(job);
    const company = job.customer.bedrijf || job.scan?.h1 || job.scan?.host || 'dit bedrijf';
    return [
      `Ultra slow motion seamless transformation for a premium scroll-driven website for ${company}.`,
      `Narrative motif: ${motif.label}.`,
      'Shot on a professional DSLR macro camera. Camera completely locked, zero movement, no dolly, no pan, no zoom.',
      'Pure black background under a single warm amber studio light from directly above.',
      'Use the supplied start image as the first frame and, when an end frame is supplied, naturally bridge toward it.',
      'Realistic physics only: objects drift, fall, settle and rotate with believable weight and air resistance.',
      'No artificial glow. No light trails. No energy effects. No CGI glow. No energy rings. No artificial light effects.',
      'No readable text, no letters, no logos, no labels, no watermarks, no distorted interface elements.',
      'The final website will scrub this video frame-by-frame with scroll, so motion must be clean, slow and continuous.',
    ].join(' ');
  }
  function veoSubmitPayloadVariants(job, first, last = null) {
    const prompt = veoPrompt(job);
    const mimeType = first.mimeType || 'image/png';
    const base64 = first.base64;
    const bytesImage = { bytesBase64Encoded: base64, mimeType };
    const lastBytesImage = last?.base64 ? { bytesBase64Encoded: last.base64, mimeType: last.mimeType || mimeType } : null;
    const sdkStyleImage = { imageBytes: base64, mimeType };
    const variants = [];
    if (lastBytesImage) {
      variants.push(
        {
          label: 'bytes-first-last-config',
          body: { instances: [{ prompt, image: bytesImage }], parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p', lastFrame: lastBytesImage } },
        },
        {
          label: 'bytes-first-last-instance',
          body: { instances: [{ prompt, image: bytesImage, lastFrame: lastBytesImage }], parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' } },
        }
      );
    }
    variants.push(
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
    );
    return variants;
  }
  function veoSubmitErrorMessage(data) {
    return normalizeString(data?.error?.message || data?.error?.detail || data?.message);
  }
  function shouldRetryVeoSubmit(response, data) {
    const status = Number(response?.status || 0);
    if (![400, 422].includes(status)) return false;
    const message = veoSubmitErrorMessage(data);
    return /unsupported|supported usage|unknown|unrecognized|invalid|remove|value type|needs to be|inlineData|bytesBase64Encoded|imageBytes|lastFrame|last_frame|durationSeconds|personGeneration|resolution|aspectRatio|parameters/i.test(message);
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
    const last = images.length > 1 ? images[images.length - 1] : null;
    if (!first?.base64) throw Object.assign(new Error('Cinematic startbeeld ontbreekt voor Veo.'), { status: 422 });
    const endpoint = geminiApiUrl(`models/${encodeURIComponent(normalizeString(veoModel) || DEFAULT_VEO_MODEL)}:predictLongRunning`);
    const variants = veoSubmitPayloadVariants(job, first, last);
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

  function frameCustomerId(job, index) {
    return `cinematic_${normalizeString(job.id).replace(/[^a-z0-9_-]+/gi, '_')}_frame_${String(index + 1).padStart(2, '0')}`.slice(0, 160);
  }
  function memoryFrameData(images = []) {
    return (Array.isArray(images) ? images : [])
      .map((image, index) => ({
        index,
        mimeType: normalizeString(image.mimeType || 'image/png').toLowerCase(),
        base64: normalizeString(image.base64 || ''),
      }))
      .filter((frame) => frame.base64);
  }
  async function persistCinematicFrames(job, images = [], scenes = []) {
    const generatedImages = Array.isArray(images) ? images : [];
    const sceneList = Array.isArray(scenes) && scenes.length ? scenes : buildImageScenes(job);
    const frames = generatedImages.map((image, index) => {
      const scene = sceneList[index] || {};
      return normalizeFrameMeta({
        index,
        title: image.title || scene.title || `Frame ${index + 1}`,
        overlayTitle: image.overlayTitle || scene.overlayTitle || image.title || scene.title,
        overlayCopy: image.overlayCopy || scene.overlayCopy,
        fileName: image.fileName || scene.fileName || `cinematic-frame-${index + 1}.png`,
        prompt: image.prompt || scene.prompt,
        revisedPrompt: image.revisedPrompt,
        mimeType: image.mimeType || 'image/png',
        customerId: frameCustomerId(job, index),
        updatedAt: new Date(now()).toISOString(),
      }, index);
    });
    job.imageScenes = normalizeFrames(sceneList);
    job.cinematicFrameData = memoryFrameData(generatedImages);
    job.cinematicFrames = frames;

    if (!dataOpsStore || typeof dataOpsStore.uploadDesignPhoto !== 'function') return frames;

    for (const frame of frames) {
      const image = generatedImages[frame.index] || generatedImages.find((entry) => Number(entry.index) === frame.index) || {};
      const base64 = normalizeString(image.base64 || '');
      if (!base64) throw Object.assign(new Error(`Cinematic frame ${frame.index + 1} mist beelddata.`), { status: 502 });
      const saved = await dataOpsStore.uploadDesignPhoto(
        {
          customerId: frame.customerId,
          identityKey: `cinematic|${job.id}|${frame.index + 1}`,
          dataUrl: `data:${frame.mimeType || 'image/png'};base64,${base64}`,
          fileName: frame.fileName,
          websitePhotoName: frame.fileName,
          legacyMeta: {
            type: 'premium-cinematic-frame',
            cinematicJobId: job.id,
            frameIndex: frame.index,
            sceneTitle: frame.title,
            sourceWebsite: job.websiteUrl,
            company: job.customer?.bedrijf || job.scan?.h1 || '',
            prompt: frame.prompt,
          },
        },
        { source: 'premium-cinematic-gpt-image-2' }
      );
      if (!saved || !saved.ok) {
        throw Object.assign(new Error(saved?.error?.message || 'Cinematic frames opslaan mislukt.'), { status: 502, data: saved });
      }
    }

    if (typeof dataOpsStore.listDesignPhotosWithSignedUrls === 'function') {
      try {
        const signed = await dataOpsStore.listDesignPhotosWithSignedUrls({
          identifiers: frames.map((frame) => frame.customerId),
          maxMatches: frames.length,
          bypassReadCache: true,
          expiresInSeconds: 60 * 60,
        });
        const signedById = new Map((Array.isArray(signed) ? signed : []).map((entry) => [normalizeString(entry.customerId), entry]));
        job.cinematicFrames = frames.map((frame) => {
          const signedEntry = signedById.get(frame.customerId);
          return normalizeFrameMeta({
            ...frame,
            storageBucket: signedEntry?.storageBucket,
            storagePath: signedEntry?.storagePath,
          }, frame.index);
        });
      } catch (error) {
        if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseCinematicJobs][frame-sign]', error?.message || error);
      }
    }
    return job.cinematicFrames;
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
          ['Warmte maakt het tastbaar', 'Het product voelt niet meer als aanbod, maar als ervaring die je bijna kunt aanraken.'],
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
          ['Zekerheid wordt tastbaar', 'Het moment voelt persoonlijk: expertise wordt tastbaar in plaats van alleen verteld.'],
          ['Van twijfel naar gesprek', 'De website leidt bezoekers naar een duidelijke volgende stap met premium vertrouwen.'],
        ],
      };
    }
    if (/\b(atelier|beeldentuin|kunst|kunstenaar|sculptuur|sculpturen|sculpture|gallery|galerie|beeldhouwer|brons|bronze|steen|stone|keramiek|ceramic|art object|artwork)\b/i.test(text)) {
      return {
        key: 'sculpture',
        label: 'Atelierfilm op scroll',
        scenes: [
          ['Het materiaal ontwaakt', 'De eerste scroll opent op steen, brons en stof voordat het kunstwerk zichtbaar wordt.'],
          ['Vorm komt los', 'Materiaal valt langzaam weg en laat vakmanschap voelen zonder uitleg nodig te hebben.'],
          ['Het kunstwerk verschijnt', 'De sculptuur wordt het centrale premium object van de digitale ervaring.'],
          ['Van atelier naar aanvraag', 'De laatste scene zet aandacht om in vertrouwen, bezoek en contact.'],
        ],
      };
    }
    return {
      key: 'brand',
      label: 'Merkfilm op scroll',
      scenes: [
        ['Het verhaal opent', 'De eerste scroll haalt de bezoeker uit een gewone pagina en in een merkervaring.'],
        ['De kern komt vrij', 'Belangrijke details schuiven naar voren alsof de camera door het bedrijf beweegt.'],
        ['Het aanbod wordt tastbaar', 'Beweging, diepte en warme materialen maken de waarde direct voelbaar.'],
        ['Momentum naar contact', 'De laatste scène zet de energie om in vertrouwen, keuze en actie.'],
      ],
    };
  }

  function legacySiteHtml(job) {
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
.story-frame{transition:none!important}
</style>
</head>
<body>
<main>
<section class="hero">
<video muted playsinline preload="metadata" src="${escapeHtml(getVideoRoute(job.id))}"></video>
<div class="hero-copy">
<div class="kicker">${domain || 'Premium webdesign'} / ${escapeHtml(motif.label)}</div>
<h1>${company}</h1>
<p>${description}</p>
<div class="cta-row"><a class="cta primary" href="#contact">Plan kennismaking</a><a class="cta secondary" href="#scrollfilm">Start de scrollfilm</a></div>
</div>
</section>
<section class="story motif-${escapeHtml(motif.key)}" id="scrollfilm" data-cinematic-scroll-story data-active="0">
<div class="story-stage">
<video class="story-video" muted playsinline preload="metadata" src="${escapeHtml(getVideoRoute(job.id))}"></video>
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
<div><div class="label">Van website naar ervaring</div><h2>Een site die zich laag voor laag ontvouwt.</h2><p>Deze versie gebruikt de bestaande website als bron, maar bouwt er een premium scrollverhaal omheen: AI-beelden, scrollbeweging, tastbare details en duidelijke conversie.</p></div>
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

  function defaultSiteHtml(job) {
    const rawCompany = job.customer.bedrijf || job.scan?.h1 || job.scan?.host || 'Premium bedrijf';
    const company = escapeHtml(rawCompany);
    const domain = escapeHtml(job.scan?.host || job.customer.dom || '');
    const description = escapeHtml(job.scan?.metaDescription || job.scan?.bodyTextSample || `Een premium websiteconcept voor ${rawCompany}.`);
    const headings = Array.isArray(job.scan?.headings) && job.scan.headings.length ? job.scan.headings.slice(0, 4) : ['Strategie', 'Design', 'Beleving', 'Conversie'];
    const motif = scrollMotif(job);
    const storedFrames = normalizeFrames(job.cinematicFrames);
    const fallbackScenes = buildImageScenes(job);
    const frameSource = storedFrames.length
      ? storedFrames
      : fallbackScenes.slice(0, Math.max(1, Number(job.imageCount || 0) || fallbackScenes.length));
    const frames = frameSource.map((frame, index) => {
      const fallback = fallbackScenes[index] || {};
      return {
        index,
        title: frame.overlayTitle || frame.title || fallback.overlayTitle || fallback.title || `Act ${index + 1}`,
        copy: frame.overlayCopy || fallback.overlayCopy || 'Een gegenereerd cinematic frame draagt de volgende laag van het verhaal.',
        fileName: frame.fileName || fallback.fileName || `cinematic-frame-${index + 1}.png`,
        url: getFrameRoute(job.id, index),
      };
    });
    const safeFrames = frames.length ? frames : [{
      index: 0,
      title: motif.scenes[0]?.[0] || 'Het verhaal opent',
      copy: motif.scenes[0]?.[1] || 'De eerste scène verschijnt zodra het AI-proces beeldmateriaal heeft.',
      fileName: 'cinematic-frame-1.png',
      url: '',
    }];
    const hasScrollVideo = Boolean(job.videoReady && job.videoUri);
    const firstFrame = safeFrames[0];
    const frameFigures = safeFrames.map((frame, index) => frame.url
      ? `<figure class="story-frame${index === 0 ? ' is-active' : ''}" data-frame="${index}"><img src="${escapeHtml(frame.url)}" alt="${escapeHtml(frame.fileName)}" loading="${index === 0 ? 'eager' : 'lazy'}"></figure>`
      : '').join('');
    const steps = safeFrames.map((frame, index) => `<article class="story-step" data-scene="${index}" data-title="${escapeHtml(frame.title)}" data-copy="${escapeHtml(frame.copy)}"><span>Frame ${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(frame.title)}</b></article>`).join('');
    const proofItems = headings.map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(item)}</li>`).join('');
    const storyMinHeight = hasScrollVideo ? 800 : Math.max(420, safeFrames.length * 92 + 120);
    const heroImage = firstFrame.url ? `<img class="hero-image" src="${escapeHtml(firstFrame.url)}" alt="${escapeHtml(firstFrame.fileName)}">` : '';
    const scrollVideoMarkup = hasScrollVideo ? `<video id="scrollVideo" class="scroll-video-source" muted playsinline preload="auto" crossorigin="anonymous" src="${escapeHtml(getVideoRoute(job.id))}"></video><canvas id="scrollCanvas" class="scroll-canvas" aria-label="Scroll-controlled cinematic video"></canvas><div class="canvas-loader" data-canvas-loader><div class="canvas-loader-title">${company}</div><div class="canvas-loader-track"><span data-canvas-loader-bar></span></div><p data-canvas-loader-copy>Preparing scroll frames...</p></div>` : '';
    const proofLabel = hasScrollVideo ? 'Van Veo naar scroll-canvas' : 'Van losse beelden naar scrollfilm';
    const proofTitle = hasScrollVideo ? 'De video speelt nooit vanzelf.' : 'Elk hoofdbeeld is AI-gegenereerd.';
    const proofCopy = hasScrollVideo
      ? 'Deze versie gebruikt Image 2 beelden als keyframes, laat Veo daar motion van maken en tekent daarna video-frames op canvas. De bezoeker bestuurt het resultaat met scroll.'
      : 'Deze versie gebruikt GPT Image 2 frames als visuele basis. De website tekent geen nep-objecten meer, maar laat de bezoeker door echte gegenereerde scenes scrollen.';
    return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${company} - cinematic website</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,sans-serif;color:#171719;background:#f6f7f2}h1,h2,p{margin:0}a{color:inherit}.hero{min-height:92vh;position:relative;display:grid;align-items:end;overflow:hidden;background:#101012;color:#fff}.hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.78;filter:saturate(1.04) contrast(1.05)}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,10,.92),rgba(8,8,10,.55) 44%,rgba(8,8,10,.12)),linear-gradient(0deg,rgba(8,8,10,.76),transparent 44%)}.hero-copy{position:relative;z-index:1;width:min(1040px,92%);padding:96px 6% 82px}.kicker,.label{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:900}.kicker{color:#6ee7d8}.hero h1{max-width:820px;margin-top:18px;font-family:Impact,Arial Black,Inter,sans-serif;font-size:88px;line-height:.9;letter-spacing:0;text-transform:uppercase}.hero p{max-width:720px;margin-top:24px;font-size:20px;line-height:1.55;color:rgba(255,255,255,.82)}.cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}.cta{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.cta.primary{background:#b7295f;color:#fff}.cta.secondary{border:1px solid rgba(255,255,255,.32);color:#fff}.story{--story-progress:0;min-height:${storyMinHeight}vh;position:relative;background:#0f0f11;color:#fff}.story-stage{position:sticky;top:0;height:100vh;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.18fr) minmax(360px,.72fr);gap:42px;align-items:center;padding:62px 6% 120px;background:#0f0f11}.story-stage:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 38% 42%,rgba(15,159,147,.18),transparent 34%),radial-gradient(circle at 76% 68%,rgba(183,41,95,.18),transparent 32%)}.story-stage:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.2),rgba(0,0,0,.08),rgba(0,0,0,.58));pointer-events:none}.frame-stage,.story-copy{position:relative;z-index:1}.frame-stage{height:min(680px,72vh);border-radius:8px;overflow:hidden;background:#070708;box-shadow:0 34px 110px rgba(0,0,0,.5);isolation:isolate}.frame-stage:after{content:"";position:absolute;inset:0;border:1px solid rgba(255,255,255,.12);border-radius:8px;pointer-events:none}.story-frame{position:absolute;inset:0;margin:0;opacity:0;transform:scale(1.045);transition:opacity .7s ease,transform 1.2s ease;will-change:opacity,transform}.story-frame.is-active{opacity:1;transform:scale(calc(1.018 - var(--story-progress) * .018))}.story-frame img{width:100%;height:100%;display:block;object-fit:cover}.frame-stage.has-video .story-frame{display:none}.scroll-video-source{display:none}.scroll-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#070708}.canvas-loader{position:absolute;inset:0;z-index:3;display:grid;place-content:center;gap:14px;padding:28px;text-align:center;background:#030303;color:#fff;transition:opacity .8s ease,visibility .8s ease}.canvas-loader.is-hidden{opacity:0;visibility:hidden}.canvas-loader-title{font-family:Impact,Arial Black,Inter,sans-serif;font-size:clamp(28px,5vw,54px);line-height:.92;text-transform:uppercase;color:#d69a2d}.canvas-loader-track{width:220px;max-width:62vw;height:2px;margin:0 auto;background:rgba(214,154,45,.18);overflow:hidden}.canvas-loader-track span{display:block;width:0;height:100%;background:rgba(214,154,45,.9);transition:width .18s ease}.canvas-loader p{margin:0;color:rgba(255,255,255,.58);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.story-copy{align-self:center;max-width:560px}.scene-count{color:#6ee7d8;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.story-copy h2{margin-top:18px;font-size:56px;line-height:.98;letter-spacing:0;text-transform:uppercase}.story-copy p{margin-top:18px;color:rgba(255,255,255,.75);font-size:18px;line-height:1.7}.story-progress{margin-top:32px;height:4px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden}.story-progress span{display:block;height:100%;width:calc(var(--story-progress) * 100%);background:linear-gradient(90deg,#b7295f,#0f9f93)}.story-steps{position:absolute;left:6%;right:6%;bottom:28px;z-index:2;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.story-step{min-height:70px;padding:13px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.06);backdrop-filter:blur(12px);opacity:.46;transition:opacity .3s ease,transform .3s ease,border-color .3s ease}.story-step span{display:block;color:#6ee7d8;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.story-step b{display:block;margin-top:7px;font-size:12px;line-height:1.25;text-transform:uppercase}.story-step.is-active{opacity:1;transform:translateY(-6px);border-color:rgba(110,231,216,.48)}.proof{padding:88px 6%;background:#f6f7f2;color:#171719}.proof-inner{width:min(1120px,100%);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:56px;align-items:start}.label{color:#b7295f}.proof h2{margin-top:14px;font-size:52px;line-height:1;letter-spacing:0;text-transform:uppercase}.proof p{margin-top:18px;color:#595f66;font-size:17px;line-height:1.75}.proof-list{margin:0;padding:0;list-style:none;display:grid;gap:12px}.proof-list li{display:grid;grid-template-columns:44px minmax(0,1fr);gap:14px;align-items:center;min-height:58px;border-bottom:1px solid rgba(23,23,25,.14);font-weight:900;text-transform:uppercase}.proof-list span{color:#0f9f93;font-size:12px}.final-band{padding:76px 6%;background:#171719;color:#fff}.final-inner{width:min(1120px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:28px}.final-band h2{font-size:48px;line-height:1;letter-spacing:0;text-transform:uppercase}.final-band p{max-width:620px;margin-top:14px;color:rgba(255,255,255,.72);line-height:1.7}.domain{color:#6ee7d8;font-weight:900;text-transform:uppercase}@media(max-width:900px){.hero h1{font-size:58px}.story-stage{grid-template-columns:1fr;padding:42px 22px 150px}.frame-stage{height:44vh}.story-copy h2{font-size:38px}.story-steps{left:22px;right:22px;grid-template-columns:1fr 1fr}.proof-inner,.final-inner{display:grid;grid-template-columns:1fr}.proof h2,.final-band h2{font-size:38px}}@media(max-width:560px){.hero{min-height:82vh}.hero-copy{padding:72px 22px}.hero h1{font-size:46px}.hero p,.story-copy p{font-size:16px}.story-stage{height:100svh}.frame-stage{height:36vh}.story-steps{grid-template-columns:1fr;bottom:18px}.story-step{min-height:46px;padding:10px}.story-step b{font-size:12px}.proof,.final-band{padding:58px 22px}}
</style>
<style>
.story-frame{transition:none!important}.story-frame[data-scrubbed="true"]{transition:none!important}.story-frame img{user-select:none}
</style>
</head>
<body>
<main>
<section class="hero">
${heroImage}
<div class="hero-copy">
<div class="kicker">${domain || 'Premium webdesign'} / ${escapeHtml(motif.label)} / scroll-scrub sequence</div>
<h1>${company}</h1>
<p>${description}</p>
<div class="cta-row"><a class="cta primary" href="#contact">Plan kennismaking</a><a class="cta secondary" href="#scrollfilm">Start de scrollfilm</a></div>
</div>
</section>
<section class="story" id="scrollfilm" data-cinematic-scroll-story data-active="0">
<div class="story-stage">
<div class="frame-stage${hasScrollVideo ? ' has-video' : ''}" aria-label="${hasScrollVideo ? 'Veo scroll-controlled canvas' : 'GPT Image 2 cinematic frames'}">
${scrollVideoMarkup}
${frameFigures}
</div>
<div class="story-copy" data-story-copy>
<div class="scene-count" data-scene-count>Frame 01</div>
<h2 data-scene-title>${escapeHtml(firstFrame.title)}</h2>
<p data-scene-copy>${escapeHtml(firstFrame.copy)}</p>
<div class="story-progress"><span></span></div>
</div>
${steps ? `<div class="story-steps">${steps}</div>` : ''}
</div>
</section>
<section class="proof" id="aanpak">
<div class="proof-inner">
<div><div class="label">${proofLabel}</div><h2>${proofTitle}</h2><p>${proofCopy}</p></div>
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
  var frames=Array.prototype.slice.call(story.querySelectorAll('.story-frame'));
  var video=story.querySelector('#scrollVideo');
  var canvas=story.querySelector('#scrollCanvas');
  var ctx=canvas&&canvas.getContext?canvas.getContext('2d'):null;
  var loader=story.querySelector('[data-canvas-loader]');
  var loaderBar=story.querySelector('[data-canvas-loader-bar]');
  var loaderCopy=story.querySelector('[data-canvas-loader-copy]');
  var count=story.querySelector('[data-scene-count]');
  var title=story.querySelector('[data-scene-title]');
  var copy=story.querySelector('[data-scene-copy]');
  var extractedFrames=[];
  var hasVideo=Boolean(video&&canvas&&ctx);
  var seeking=false;
  var ticking=false;
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function setLoader(progress,label){
    if(loaderBar)loaderBar.style.width=Math.round(clamp(progress,0,1)*100)+'%';
    if(loaderCopy&&label)loaderCopy.textContent=label;
  }
  function hideLoader(){
    if(loader)loader.classList.add('is-hidden');
  }
  function resizeCanvas(){
    if(!canvas)return;
    var rect=canvas.getBoundingClientRect();
    var ratio=Math.min(2,window.devicePixelRatio||1);
    var width=Math.max(1,Math.round(rect.width*ratio));
    var height=Math.max(1,Math.round(rect.height*ratio));
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;
      canvas.height=height;
    }
  }
  function drawCover(source){
    if(!ctx||!source)return;
    resizeCanvas();
    var sw=source.videoWidth||source.naturalWidth||source.width||0;
    var sh=source.videoHeight||source.naturalHeight||source.height||0;
    if(!sw||!sh)return;
    var cw=canvas.width;
    var ch=canvas.height;
    var scale=Math.max(cw/sw,ch/sh);
    var dw=sw*scale;
    var dh=sh*scale;
    var dx=(cw-dw)/2;
    var dy=(ch-dh)/2;
    ctx.clearRect(0,0,cw,ch);
    ctx.drawImage(source,dx,dy,dw,dh);
  }
  function waitForMetadata(){
    if(!video)return Promise.resolve();
    if(video.readyState>=1&&Number.isFinite(video.duration))return Promise.resolve();
    return new Promise(function(resolve,reject){
      var timeout=setTimeout(function(){cleanup();reject(new Error('Video metadata timeout'));},6000);
      function cleanup(){
        clearTimeout(timeout);
        video.removeEventListener('loadedmetadata',done);
        video.removeEventListener('error',fail);
      }
      function done(){cleanup();resolve();}
      function fail(){cleanup();reject(new Error('Video load failed'));}
      video.addEventListener('loadedmetadata',done);
      video.addEventListener('error',fail);
      video.load();
    });
  }
  function seekVideo(time){
    return new Promise(function(resolve){
      if(!video||!Number.isFinite(video.duration)){resolve();return;}
      var target=clamp(time,0,Math.max(0,video.duration-.04));
      var settled=false;
      function done(){
        if(settled)return;
        settled=true;
        video.removeEventListener('seeked',done);
        clearTimeout(timer);
        resolve();
      }
      var timer=setTimeout(done,1400);
      video.addEventListener('seeked',done);
      try{video.currentTime=target;}catch(_){done();}
    });
  }
  function decodeImage(img){
    if(img.decode)return img.decode().catch(function(){});
    return new Promise(function(resolve){
      img.onload=resolve;
      img.onerror=resolve;
    });
  }
  async function extractFrames(){
    if(!hasVideo)return false;
    try{
      video.pause();
      video.muted=true;
      await waitForMetadata();
      resizeCanvas();
      var duration=Math.max(.25,Number(video.duration)||8);
      var targetCount=64;
      var offscreen=document.createElement('canvas');
      offscreen.width=960;
      offscreen.height=540;
      var offctx=offscreen.getContext('2d');
      if(!offctx)throw new Error('Canvas unavailable');
      for(var index=0;index<targetCount;index+=1){
        var progress=targetCount<=1?0:index/(targetCount-1);
        await seekVideo(progress*duration);
        offctx.clearRect(0,0,offscreen.width,offscreen.height);
        offctx.drawImage(video,0,0,offscreen.width,offscreen.height);
        var img=new Image();
        img.decoding='async';
        img.src=offscreen.toDataURL('image/jpeg',.86);
        await decodeImage(img);
        extractedFrames.push(img);
        setLoader((index+1)/targetCount,'Preparing scroll frames '+Math.round(((index+1)/targetCount)*100)+'%');
      }
      hideLoader();
      return true;
    }catch(_){
      hideLoader();
      return false;
    }
  }
  function setFrameVisual(frame,index,frameProgress){
    var distance=Math.abs(frameProgress-index);
    var opacity=clamp(1-distance,0,1);
    var focus=1-clamp(distance,0,1);
    var scale=1.035-(focus*.022);
    frame.dataset.scrubbed='true';
    frame.style.opacity=String(opacity);
    frame.style.transform='scale('+scale.toFixed(4)+')';
    frame.classList.toggle('is-active',opacity>.5);
    frame.setAttribute('aria-hidden',opacity>.08?'false':'true');
  }
  function drawVideoProgress(progress){
    if(!hasVideo)return;
    if(extractedFrames.length){
      var frameIndex=Math.min(extractedFrames.length-1,Math.round(progress*(extractedFrames.length-1)));
      drawCover(extractedFrames[frameIndex]);
      return;
    }
    if(video&&video.readyState>=2&&Number.isFinite(video.duration)){
      var target=clamp(progress,0,1)*Math.max(.25,video.duration);
      if(!seeking&&Math.abs(video.currentTime-target)>.05){
        seeking=true;
        try{video.currentTime=target;}catch(_){seeking=false;}
      }
      drawCover(video);
    }
  }
  function render(){
    ticking=false;
    var rect=story.getBoundingClientRect();
    var max=Math.max(1,rect.height-window.innerHeight);
    var progress=clamp(-rect.top/max,0,1);
    var total=Math.max(1,steps.length||frames.length);
    var frameProgress=total>1?progress*(total-1):0;
    var active=Math.min(total-1,Math.round(frameProgress));
    var step=steps[active];
    story.dataset.active=String(active);
    story.style.setProperty('--story-progress',progress.toFixed(4));
    if(hasVideo){drawVideoProgress(progress);}else{frames.forEach(function(frame,index){setFrameVisual(frame,index,frameProgress);});}
    steps.forEach(function(item,index){item.classList.toggle('is-active',index===active);});
    if(step){
      if(count)count.textContent='Frame '+String(active+1).padStart(2,'0');
      if(title)title.textContent=step.getAttribute('data-title')||'';
      if(copy)copy.textContent=step.getAttribute('data-copy')||'';
    }
  }
  function request(){if(!ticking){ticking=true;requestAnimationFrame(render);}}
  if(video)video.addEventListener('seeked',function(){seeking=false;request();});
  window.addEventListener('scroll',request,{passive:true});
  window.addEventListener('resize',request);
  if(hasVideo){
    setLoader(.04,'Preparing scroll frames...');
    extractFrames().then(function(){request();});
  }
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
          await persistCinematicFrames(job, images, generated?.scenes || []);
          if (!USE_VEO) {
            job.videoOperationName = '';
            job.rawVideoOperation = null;
            job.videoUri = '';
            job.videoReady = false;
            job.nextPollAt = null;
            setStage(job, 'site', 86);
            await persistJob(job);
          } else {
            setStage(job, 'video', 58);
            const submitted = await (submitVeoVideo || defaultSubmitVeo)(job, images);
            job.videoOperationName = submitted.operationName;
            job.rawVideoOperation = submitted.raw || null;
            job.nextPollAt = now() + VEO_POLL_INTERVAL_MS;
            setStage(job, 'video', 68);
            await persistJob(job);
            return job;
          }
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
          job.builderVersion = SITE_BUILDER_VERSION;
          job.result = { html, source: buildCinematicSiteHtml ? 'custom-cinematic-builder' : 'softora-cinematic-builder', generatedAt: new Date(now()).toISOString(), builderVersion: SITE_BUILDER_VERSION };
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
      if (isReusableCompletedJob(existing)) return { ok: true, statusCode: 200, existing: true, cached: true, job: serializeJob(existing) };
      if (existing.status !== 'error' && existing.status !== 'done') return { ok: true, statusCode: 202, existing: true, job: serializeJob(existing) };
    }
    const storedActiveJob = await findStoredActiveJob(ownerKey, customer, websiteUrl);
    if (storedActiveJob) {
      if (isReusableCompletedJob(storedActiveJob)) {
        return { ok: true, statusCode: 200, existing: true, cached: true, job: serializeJob(storedActiveJob) };
      }
      if (storedActiveJob.status !== 'done') {
        return { ok: true, statusCode: 202, existing: true, job: serializeJob(storedActiveJob) };
      }
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
  async function getFrameResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const job = await loadJob(req.params && req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'Job niet gevonden' });
    if (job.ownerKey !== ownerKey) return res.status(403).json({ ok: false, error: 'Geen toegang' });
    const frameNumber = Math.max(1, Math.floor(Number(req.params && req.params.frameIndex) || 0));
    const index = frameNumber - 1;
    const frame = normalizeFrames(job.cinematicFrames)[index];
    if (!frame) return res.status(404).json({ ok: false, error: 'Frame niet gevonden' });

    const memoryFrame = (Array.isArray(job.cinematicFrameData) ? job.cinematicFrameData : []).find((entry) => Number(entry.index) === index);
    if (memoryFrame?.base64) {
      res.setHeader('Content-Type', memoryFrame.mimeType || frame.mimeType || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(Buffer.from(memoryFrame.base64, 'base64'));
    }

    if (dataOpsStore && typeof dataOpsStore.listDesignPhotosWithSignedUrls === 'function' && frame.customerId) {
      try {
        const signed = await dataOpsStore.listDesignPhotosWithSignedUrls({
          identifiers: [frame.customerId],
          maxMatches: 1,
          expiresInSeconds: 60 * 60,
        });
        const match = (Array.isArray(signed) ? signed : []).find((entry) => normalizeString(entry.customerId) === frame.customerId) || (Array.isArray(signed) ? signed[0] : null);
        const signedUrl = normalizeString(match && match.websitePhotoUrl);
        if (signedUrl) {
          res.setHeader('Cache-Control', 'private, max-age=300');
          res.setHeader('Location', signedUrl);
          if (typeof res.end === 'function') {
            res.status(302);
            res.end();
            return null;
          }
          return res.status(302).json({ ok: true, url: signedUrl });
        }
      } catch (error) {
        if (typeof logger.warn === 'function') logger.warn('[PremiumDatabaseCinematicJobs][frame]', error?.message || error);
      }
    }
    return res.status(404).json({ ok: false, error: 'Frame nog niet beschikbaar' });
  }
  return { startJob, getJob, getProviderStatus, startJobResponse, configResponse, getJobResponse, getVideoResponse, getFrameResponse };
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
