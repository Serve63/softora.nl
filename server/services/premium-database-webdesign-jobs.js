const { randomUUID } = require('crypto');

const DEVICE_MOCKUP_RENDERER = 'softora-server-device-v8';
const DEVICE_MOCKUP_FILE_VERSION = 'v8';
const SUSPECT_DEVICE_MOCKUP_RENDERERS = new Set([
  'softora-browser-device-v6',
  'softora-server-device-v6',
  'softora-server-device-v7',
]);
const APPROVED_MOCKUP_QUALITY_STATUSES = new Set(['checked', 'verified', 'ok']);
const WEBDESIGN_GUTTER_MIN_SIZE = 320;
const WEBDESIGN_GUTTER_THRESHOLD = 12;
const WEBDESIGN_GUTTER_CORNER_TOLERANCE = 32;
const WEBDESIGN_SIDE_GUTTER_MIN_RATIO = 0.08;
const WEBDESIGN_VERTICAL_GUTTER_MAX_RATIO = 0.025;
const WEBDESIGN_GUTTER_CROP_PAD_RATIO = 0.018;
const WEBDESIGN_GUTTER_CROP_MIN_PAD = 12;
const WEBDESIGN_GUTTER_CROP_MAX_PAD = 24;
const WEBDESIGN_SAFETY_BLOCKED_ERROR_CODE = 'WEBPREVIEW_SAFETY_BLOCKED';
const WEBDESIGN_JOB_CANCELLED_ERROR = 'Geannuleerd door gebruiker.';
const WEBDESIGN_TRANSIENT_OPENAI_ERROR_MESSAGE =
  'De OpenAI-websitegenerator had tijdelijk moeite met dit webdesign. Probeer deze lead later opnieuw.';
const WEBDESIGN_TRANSIENT_STORAGE_ERROR_MESSAGE =
  'De webdesignfoto kon tijdelijk niet veilig worden opgeslagen. Probeer deze lead later opnieuw.';
const WEBDESIGN_DEFAULT_USER_ERROR_MESSAGE = 'Webdesign maken is mislukt. Probeer deze lead later opnieuw.';
const SOFTORA_WEBDESIGN_OUTREACH_ROLE = 'WEBDESIGN & SOFTWARE ONTWIKKELING';
const DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE = Object.freeze({
  name: 'Servé Creusen',
  roleLabel: SOFTORA_WEBDESIGN_OUTREACH_ROLE,
});
const SOFTORA_WEBDESIGN_OUTREACH_PROFILES_BY_EMAIL = Object.freeze({
  'serve@softora.nl': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'servecreusen@softora.nl': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'servec321@gmail.com': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'serve290@gmail.com': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'servecreusen7@gmail.com': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'contact.venvisuals@gmail.com': DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE,
  'martijn@softora.nl': {
    name: 'Martijn van de Ven',
    roleLabel: SOFTORA_WEBDESIGN_OUTREACH_ROLE,
  },
  'martijnvandeven@softora.nl': {
    name: 'Martijn van de Ven',
    roleLabel: SOFTORA_WEBDESIGN_OUTREACH_ROLE,
  },
  'martijnven123@gmail.com': {
    name: 'Martijn van de Ven',
    roleLabel: SOFTORA_WEBDESIGN_OUTREACH_ROLE,
  },
});
let cachedSharp = null;

function loadSharpModule() {
  if (cachedSharp) return cachedSharp;
  cachedSharp = require('sharp');
  return cachedSharp;
}

function parseImageDataUrl(value) {
  const match = String(value || '').trim().match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
  const base64 = match ? match[2].replace(/\s+/g, '') : '';
  if (!match) return null;
  return {
    mimeType: `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`,
    base64,
    buffer: Buffer.from(base64, 'base64'),
  };
}

function replaceImageFileSuffix(value, suffix) {
  const raw = String(value || '').trim() || 'webdesign-preview.png';
  const clean = raw.replace(/\.[a-z0-9]+$/i, '');
  return `${clean}${suffix}.jpg`;
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPixelColor(data, info, x, y) {
  const channels = Number(info && info.channels) || 0;
  const width = Number(info && info.width) || 0;
  if (!Buffer.isBuffer(data) || channels < 3 || width <= 0) return null;
  const offset = (y * width + x) * channels;
  if (offset < 0 || offset + 2 >= data.length) return null;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
  };
}

function colorDistance(left, right) {
  if (!left || !right) return Infinity;
  const red = Number(left.r) - Number(right.r);
  const green = Number(left.g) - Number(right.g);
  const blue = Number(left.b) - Number(right.b);
  return Math.sqrt(red * red + green * green + blue * blue);
}

function averageColors(colors) {
  const valid = (Array.isArray(colors) ? colors : []).filter(Boolean);
  if (!valid.length) return null;
  const totals = valid.reduce(
    (next, color) => ({
      r: next.r + Number(color.r || 0),
      g: next.g + Number(color.g || 0),
      b: next.b + Number(color.b || 0),
    }),
    { r: 0, g: 0, b: 0 }
  );
  return {
    r: totals.r / valid.length,
    g: totals.g / valid.length,
    b: totals.b / valid.length,
  };
}

function averageCornerColor(data, info, startX, startY, sampleSize) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  const colors = [];
  for (let y = startY; y < Math.min(height, startY + sampleSize); y += 1) {
    for (let x = startX; x < Math.min(width, startX + sampleSize); x += 1) {
      colors.push(getPixelColor(data, info, x, y));
    }
  }
  return averageColors(colors);
}

function getUniformWebdesignBackground(data, info) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  const sampleSize = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) * 0.03)));
  const corners = [
    averageCornerColor(data, info, 0, 0, sampleSize),
    averageCornerColor(data, info, Math.max(0, width - sampleSize), 0, sampleSize),
    averageCornerColor(data, info, 0, Math.max(0, height - sampleSize), sampleSize),
    averageCornerColor(data, info, Math.max(0, width - sampleSize), Math.max(0, height - sampleSize), sampleSize),
  ].filter(Boolean);
  if (corners.length < 4) return null;
  const background = averageColors(corners);
  const cornersMatch = corners.every((corner) => colorDistance(corner, background) <= WEBDESIGN_GUTTER_CORNER_TOLERANCE);
  return cornersMatch ? background : null;
}

function findNonBackgroundWebdesignBounds(data, info, background) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = getPixelColor(data, info, x, y);
      if (colorDistance(color, background) <= WEBDESIGN_GUTTER_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function getSafeWebdesignSideGutterCrop(bounds, width, height) {
  if (!bounds || width < WEBDESIGN_GUTTER_MIN_SIZE || height < WEBDESIGN_GUTTER_MIN_SIZE) return null;
  const leftMargin = Math.max(0, Number(bounds.left) || 0);
  const rightMargin = Math.max(0, width - 1 - (Number(bounds.right) || 0));
  const topMargin = Math.max(0, Number(bounds.top) || 0);
  const bottomMargin = Math.max(0, height - 1 - (Number(bounds.bottom) || 0));
  const minSideMargin = Math.floor(width * WEBDESIGN_SIDE_GUTTER_MIN_RATIO);
  const maxVerticalMargin = Math.floor(height * WEBDESIGN_VERTICAL_GUTTER_MAX_RATIO);
  if (leftMargin < minSideMargin || rightMargin < minSideMargin) return null;
  if (topMargin > maxVerticalMargin || bottomMargin > maxVerticalMargin) return null;

  const contentWidth = (Number(bounds.right) || 0) - (Number(bounds.left) || 0) + 1;
  if (contentWidth < width * 0.45 || contentWidth > width * 0.9) return null;

  const pad = clampNumber(
    Math.round(width * WEBDESIGN_GUTTER_CROP_PAD_RATIO),
    WEBDESIGN_GUTTER_CROP_MIN_PAD,
    WEBDESIGN_GUTTER_CROP_MAX_PAD
  );
  const left = Math.max(0, leftMargin - pad);
  const right = Math.min(width - 1, (Number(bounds.right) || 0) + pad);
  const cropWidth = right - left + 1;
  if (cropWidth >= width * 0.94) return null;
  return {
    left,
    top: 0,
    width: cropWidth,
    height,
    detected: {
      leftMargin,
      rightMargin,
      topMargin,
      bottomMargin,
      contentWidth,
    },
  };
}

async function trimUniformWebdesignSideGuttersDataUrl(dataUrl, options = {}) {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return { dataUrl, cropped: false, reason: 'invalid_image_data_url' };
  const sharp = typeof options.loadSharpImpl === 'function' ? options.loadSharpImpl() : loadSharpModule();
  const raster = await sharp(parsed.buffer, { limitInputPixels: 45_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = Number(raster && raster.info && raster.info.width) || 0;
  const height = Number(raster && raster.info && raster.info.height) || 0;
  const original = { width, height };
  if (width < WEBDESIGN_GUTTER_MIN_SIZE || height < WEBDESIGN_GUTTER_MIN_SIZE) {
    return { dataUrl, cropped: false, reason: 'too_small', original };
  }
  const background = getUniformWebdesignBackground(raster.data, raster.info);
  const bounds = background ? findNonBackgroundWebdesignBounds(raster.data, raster.info, background) : null;
  const crop = getSafeWebdesignSideGutterCrop(bounds, width, height);
  if (!crop) return { dataUrl, cropped: false, reason: 'no_safe_side_gutter_crop', original, bounds };

  const cropped = await sharp(parsed.buffer, { limitInputPixels: 45_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .png()
    .toBuffer();
  return {
    dataUrl: `data:image/png;base64,${cropped.toString('base64')}`,
    cropped: true,
    reason: 'trimmed_uniform_side_gutters',
    original,
    output: { width: crop.width, height: crop.height },
    crop,
    bounds,
  };
}

function buildDeviceSpec(definition) {
  return {
    ...definition,
    screen: {
      x: definition.x + definition.pad,
      y: definition.y + definition.padTop,
      width: definition.w - definition.pad * 2,
      height: definition.h - definition.padTop - definition.padBottom,
      radius: definition.screenRadius,
      frame: {
        left: definition.pad,
        right: definition.pad,
        top: definition.padTop,
        bottom: definition.padBottom,
      },
    },
  };
}

function getDeviceMockupRendererSpec() {
  return {
    renderer: DEVICE_MOCKUP_RENDERER,
    fileVersion: DEVICE_MOCKUP_FILE_VERSION,
    canvas: { width: 1600, height: 1000 },
    devices: [
      buildDeviceSpec({
        id: 'laptop',
        x: 155,
        y: 200,
        w: 930,
        h: 560,
        pad: 18,
        padTop: 18,
        padBottom: 28,
        radius: 28,
        screenRadius: 14,
        frame: '#111827',
        shadow: 'rgba(15,23,42,.24)',
        blur: 44,
        offsetY: 26,
        fitMode: 'viewport-width',
        cropTopRatio: 0,
        base: '#e5e7eb',
        baseX: 105,
        baseY: 775,
        baseW: 1170,
        baseH: 42,
      }),
      buildDeviceSpec({
        id: 'tablet',
        x: 1095,
        y: 160,
        w: 305,
        h: 455,
        pad: 14,
        padTop: 18,
        padBottom: 18,
        radius: 34,
        screenRadius: 22,
        frame: '#1f2937',
        shadow: 'rgba(15,23,42,.22)',
        blur: 34,
        offsetY: 22,
        fitMode: 'viewport',
        cropTopRatio: 0,
        cropFocusX: 0.5,
        viewportHeightRatio: 1,
      }),
      buildDeviceSpec({
        id: 'phone',
        x: 1345,
        y: 350,
        w: 180,
        h: 380,
        pad: 10,
        padTop: 22,
        padBottom: 16,
        radius: 34,
        screenRadius: 20,
        frame: '#030712',
        shadow: 'rgba(15,23,42,.28)',
        blur: 30,
        offsetY: 18,
        fitMode: 'viewport',
        cropTopRatio: 0,
        cropFocusX: 0,
        viewportHeightRatio: 1,
      }),
    ],
  };
}

function resolveViewportCrop(sourceSize, screen, device) {
  const sourceWidth = Math.max(1, normalizeFiniteNumber(sourceSize.width, 1));
  const sourceHeight = Math.max(1, normalizeFiniteNumber(sourceSize.height, 1));
  const targetRatio = screen.width / screen.height;
  const viewportHeightRatio = clampNumber(normalizeFiniteNumber(device.viewportHeightRatio, 0.68), 0.38, 1);
  let sh = Math.max(1, sourceHeight * viewportHeightRatio);
  let sw = sh * targetRatio;
  if (sw > sourceWidth) {
    sw = sourceWidth;
    sh = sw / targetRatio;
  }
  sh = Math.min(sh, sourceHeight);
  sw = Math.min(sw, sourceWidth);
  const focusX = clampNumber(normalizeFiniteNumber(device.cropFocusX, 0.5), 0, 1);
  const cropTopRatio = clampNumber(normalizeFiniteNumber(device.cropTopRatio, 0), 0, 1);
  return {
    sx: clampNumber((sourceWidth - sw) * focusX, 0, Math.max(0, sourceWidth - sw)),
    sy: clampNumber((sourceHeight - sh) * cropTopRatio, 0, Math.max(0, sourceHeight - sh)),
    sw,
    sh,
  };
}

function renderDeviceImageSvg(device, sourceSize, embeddedImage) {
  const screen = device.screen;
  const sourceWidth = Math.max(1, normalizeFiniteNumber(sourceSize.width, 1));
  const sourceHeight = Math.max(1, normalizeFiniteNumber(sourceSize.height, 1));
  if (device.fitMode === 'viewport-width') {
    const scale = screen.width / sourceWidth;
    const renderedHeight = sourceHeight * scale;
    if (renderedHeight <= screen.height) {
      return `<image href="${embeddedImage}" x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${renderedHeight}" preserveAspectRatio="none" clip-path="url(#${device.id}Screen)"/>`;
    }
    const visibleSourceHeight = Math.max(1, screen.height / scale);
    const cropTopRatio = clampNumber(normalizeFiniteNumber(device.cropTopRatio, 0), 0, 1);
    const sy = clampNumber((sourceHeight - visibleSourceHeight) * cropTopRatio, 0, Math.max(0, sourceHeight - visibleSourceHeight));
    return `<svg x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" viewBox="0 ${sy} ${sourceWidth} ${visibleSourceHeight}" preserveAspectRatio="none" overflow="hidden" clip-path="url(#${device.id}Screen)"><image href="${embeddedImage}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}"/></svg>`;
  }
  const crop = resolveViewportCrop(sourceSize, screen, device);
  return `<svg x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" viewBox="${crop.sx} ${crop.sy} ${crop.sw} ${crop.sh}" preserveAspectRatio="none" overflow="hidden" clip-path="url(#${device.id}Screen)"><image href="${embeddedImage}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}"/></svg>`;
}

function renderDeviceSvg(device, sourceSize, embeddedImage) {
  const screen = device.screen;
  const notch = device.id === 'tablet'
    ? '<rect x="1198" y="300" width="96" height="10" rx="5" fill="#64748b"/>'
    : device.id === 'phone'
      ? '<rect x="1346" y="442" width="82" height="9" rx="5" fill="#64748b"/>'
      : '';
  const base = device.base
    ? `<rect x="${device.baseX}" y="${device.baseY}" width="${device.baseW}" height="${device.baseH}" rx="16" fill="${device.base}"/>`
    : '';
  const filter = device.id === 'laptop' ? 'shadow' : 'softShadow';
  return `
      <g filter="url(#${filter})">
        <rect x="${device.x}" y="${device.y}" width="${device.w}" height="${device.h}" rx="${device.radius}" fill="${device.frame}"/>
        <rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="${screen.radius}" fill="#ffffff"/>
        ${renderDeviceImageSvg(device, sourceSize, embeddedImage)}
        ${base}
        ${notch}
      </g>`;
}

async function buildDeviceMockupSvg(imageDataUrl, customer = {}, options = {}) {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) throw new Error('De webdesignfoto is niet geschikt voor een device-mockup.');
  const sharp = typeof options.loadSharpImpl === 'function' ? options.loadSharpImpl() : loadSharpModule();
  const metadata = await sharp(parsed.buffer).metadata();
  const sourceSize = {
    width: Math.max(1, Number(metadata.width) || 1024),
    height: Math.max(1, Number(metadata.height) || 1536),
  };
  const embeddedImage = `data:${parsed.mimeType};base64,${parsed.base64}`;
  const spec = getDeviceMockupRendererSpec();
  return `
    <svg width="1600" height="1000" viewBox="0 0 1600 1000" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="26" stdDeviation="44" flood-color="#0f172a" flood-opacity="0.24"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="22" stdDeviation="34" flood-color="#0f172a" flood-opacity="0.22"/>
        </filter>
        ${spec.devices.map((device) => `<clipPath id="${device.id}Screen"><rect x="${device.screen.x}" y="${device.screen.y}" width="${device.screen.width}" height="${device.screen.height}" rx="${device.screen.radius}"/></clipPath>`).join('')}
      </defs>
      <linearGradient id="backgroundGradient" x1="0" y1="0" x2="1600" y2="1000" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#f7f9fc"/>
        <stop offset="0.48" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#e8edf5"/>
      </linearGradient>
      <rect width="1600" height="1000" fill="url(#backgroundGradient)"/>
      <circle cx="1260" cy="160" r="340" fill="#3b82f6" fill-opacity="0.10"/>
      <circle cx="280" cy="820" r="300" fill="#0f172a" fill-opacity="0.08"/>
      ${spec.devices.map((device) => renderDeviceSvg(device, sourceSize, embeddedImage)).join('')}
    </svg>`;
}

async function createDeviceMockupDataUrl(imageDataUrl, customer = {}, options = {}) {
  const sharp = typeof options.loadSharpImpl === 'function' ? options.loadSharpImpl() : loadSharpModule();
  const svg = await buildDeviceMockupSvg(imageDataUrl, customer, { loadSharpImpl: () => sharp });
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function getMockupRecordQuality(entry = {}) {
  const legacyMeta = entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {};
  const mockup = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : {};
  return {
    renderer: String(
      entry.mockupRenderer ||
        entry.websiteMockupRenderer ||
        mockup.renderer ||
        legacyMeta.mockupRenderer ||
        ''
    ).trim().toLowerCase(),
    orientation: String(
      entry.mockupOrientation ||
        entry.websiteMockupOrientation ||
        mockup.orientation ||
        legacyMeta.mockupOrientation ||
        ''
    ).trim().toLowerCase(),
    status: String(
      entry.mockupQualityStatus ||
        entry.websiteMockupQualityStatus ||
        mockup.qualityStatus ||
        legacyMeta.mockupQualityStatus ||
        ''
    ).trim().toLowerCase(),
    checkedAt: String(
      entry.mockupQualityCheckedAt ||
        entry.websiteMockupQualityCheckedAt ||
        mockup.qualityCheckedAt ||
        legacyMeta.mockupQualityCheckedAt ||
        ''
    ).trim(),
  };
}

function isSuspectWebdesignMockupRenderer(renderer) {
  return SUSPECT_DEVICE_MOCKUP_RENDERERS.has(String(renderer || '').trim().toLowerCase());
}

function inferWebdesignMockupRendererFromName(fileName) {
  const match = String(fileName || '').trim().match(/-device-mockup-v([0-9]+)\.jpe?g$/i);
  return match ? `softora-server-device-v${match[1]}` : '';
}

function diagnoseWebdesignMockupRecord(entry = {}) {
  const legacyMeta = entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {};
  const mockup = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : {};
  const quality = getMockupRecordQuality(entry);
  const websiteMockupName = String(
    entry.websiteMockupName ||
      entry.mockupName ||
      mockup.fileName ||
      legacyMeta.websiteMockupName ||
      ''
  ).trim();
  const resolvedRenderer = quality.renderer || inferWebdesignMockupRendererFromName(websiteMockupName);
  const hasMockup = Boolean(
    entry.websiteMockup ||
      entry.websiteMockupUrl ||
      entry.mockupUrl ||
      entry.signedMockupUrl ||
      mockup.storagePath ||
      mockup.fileName
  );
  const reasons = [];
  if (!hasMockup) reasons.push('missing_mockup');
  if (isSuspectWebdesignMockupRenderer(resolvedRenderer)) reasons.push(`suspect_${resolvedRenderer.replace(/[^a-z0-9]+/gi, '_')}`);
  if (!quality.status && hasMockup) reasons.push('missing_quality_status');
  if (quality.status && !APPROVED_MOCKUP_QUALITY_STATUSES.has(quality.status)) reasons.push('unapproved_quality_status');
  if (quality.orientation && quality.orientation !== 'upright') reasons.push('non_upright_orientation');
  if (quality.status === 'checked' && isSuspectWebdesignMockupRenderer(resolvedRenderer)) {
    reasons.push('checked_before_visual_renderer_gate');
  }
  return {
    customerId: String(entry.customerId || entry.id || '').trim(),
    company: String(entry.company || entry.bedrijf || legacyMeta.company || legacyMeta.bedrijf || '').trim(),
    websitePhotoName: String(entry.websitePhotoName || entry.fileName || legacyMeta.websitePhotoName || '').trim(),
    websiteMockupName,
    mockupRenderer: resolvedRenderer,
    mockupOrientation: quality.orientation,
    mockupQualityStatus: quality.status,
    mockupQualityCheckedAt: quality.checkedAt,
    updatedAt: String(entry.updatedAt || legacyMeta.updatedAt || '').trim(),
    storageSource: String(entry.storageSource || entry.source || legacyMeta.source || '').trim(),
    status: reasons.length ? 'needs_review' : 'ok',
    reasons,
  };
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
    webdesignJobConcurrency = process.env.PREMIUM_WEBDESIGN_JOB_CONCURRENCY,
    bulkChunkTargetLimit = process.env.PREMIUM_WEBDESIGN_BULK_CHUNK_TARGET_LIMIT,
    bulkActiveJobLimit = process.env.PREMIUM_WEBDESIGN_BULK_ACTIVE_LIMIT,
    bulkStartLimit = process.env.PREMIUM_WEBDESIGN_BULK_START_LIMIT,
    bulkReconcileLimit = process.env.PREMIUM_WEBDESIGN_BULK_RECONCILE_LIMIT,
    bulkWorkerBatchLimit = process.env.PREMIUM_WEBDESIGN_BULK_WORKER_BATCH_LIMIT,
    bulkWorkerJobLimit = process.env.PREMIUM_WEBDESIGN_BULK_WORKER_JOB_LIMIT,
    bulkWorkerConcurrency = process.env.PREMIUM_WEBDESIGN_BULK_WORKER_CONCURRENCY,
    loadSharpImpl = loadSharpModule,
    now = () => Date.now(),
    random = Math.random,
    retryJitter = true,
  } = deps;

  const jobs = new Map();
  const JOB_TTL_MS = 6 * 60 * 60 * 1000;
  const JOB_PROCESS_TIMEOUT_MS = Math.max(100, Math.min(10 * 60 * 1000, Number(jobProcessTimeoutMs) || 0));
  const MAX_JOBS = 5000;
  const MAX_RETRY_ATTEMPTS = 6;
  const RETRY_DELAY_MIN_MS = 5000;
  const RETRY_DELAY_MAX_MS = 60000;
  const PROCESSING_CONCURRENCY = Math.max(1, Math.min(10, Math.floor(Number(webdesignJobConcurrency) || 6)));
  const BULK_CHUNK_TARGET_LIMIT = Math.max(1, Math.min(250, Math.floor(Number(bulkChunkTargetLimit) || 100)));
  const BULK_ACTIVE_JOB_LIMIT = Math.max(1, Math.min(64, Math.floor(Number(bulkActiveJobLimit) || 36)));
  const BULK_START_LIMIT = Math.max(1, Math.min(48, Math.floor(Number(bulkStartLimit) || 36)));
  const BULK_RECONCILE_LIMIT = Math.max(1, Math.min(12, Math.floor(Number(bulkReconcileLimit) || 4)));
  const BULK_WORKER_BATCH_LIMIT = Math.max(1, Math.min(8, Math.floor(Number(bulkWorkerBatchLimit) || 4)));
  const BULK_WORKER_JOB_LIMIT = Math.max(1, Math.min(24, Math.floor(Number(bulkWorkerJobLimit) || 18)));
  const BULK_WORKER_CONCURRENCY = Math.max(1, Math.min(PROCESSING_CONCURRENCY, Math.floor(Number(bulkWorkerConcurrency) || 6)));
  const CHUNK_SIZE = 180000;
  const MAX_STORAGE_CHUNKS = 80;
  const DATABASE_PHOTO_IMAGE_SIZE = '1024x1536';
  let activeProcessingCount = 0;
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

  function ownerEmailFromOwnerKey(ownerKey) {
    return normalizeString(ownerKey).split('::')[0].toLowerCase();
  }

  function resolveWebdesignOutreachProfile(ownerKey) {
    const ownerEmail = ownerEmailFromOwnerKey(ownerKey);
    const profile =
      SOFTORA_WEBDESIGN_OUTREACH_PROFILES_BY_EMAIL[ownerEmail] ||
      DEFAULT_SOFTORA_WEBDESIGN_OUTREACH_PROFILE;
    return {
      ...profile,
      source: 'premium-database-webdesign-jobs',
    };
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
    if (error && error.retryableWebdesignStorage === true) return true;

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

  function collectWebdesignErrorDetails(error) {
    return [
      typeof error === 'string' ? error : '',
      error && error.message,
      error?.data?.error?.message,
      error?.data?.error?.detail,
      error?.data?.error?.code,
      error?.data?.error,
      error?.data?.detail,
      error?.data?.safety_violations,
      error?.data?.safetyViolations,
    ].map(normalizeString).filter(Boolean).join(' ');
  }

  function isHardOpenAiWebdesignErrorText(value) {
    return /openai_api_key ontbreekt|image-model ongeldig|organization must be verified|not verified|billing|quota|credits|monthly usage|maximum monthly spend|invalid authentication|incorrect api key/i.test(
      normalizeString(value)
    );
  }

  function isTransientOpenAiWebdesignErrorText(value) {
    const text = normalizeString(value);
    if (!text || isHardOpenAiWebdesignErrorText(text)) return false;
    return /OpenAI websitegenerator mislukt \((?:408|429|5\d\d)\)|The server had an error while processing your request|Rate limit reached|Please try again|temporarily unavailable|overloaded|timeout|timed out|duurde te lang/i.test(
      text
    );
  }

  function stripOpenAiOperationalBoilerplate(value) {
    let text = normalizeString(value);
    if (!text) return '';
    text = text
      .replace(/\s*\(?Please include the request ID\b[^)]*\)?\.?/gi, ' ')
      .replace(/\breq_[a-z0-9]+\b/gi, ' ')
      .replace(/\s*Sorry about that!\s*/gi, ' ')
      .replace(/\s*You can retry your request, or contact us through our help center at help\.openai\.com if the error persists\.?/gi, ' ')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return text;
  }

  function getUserFacingWebdesignErrorFromError(error) {
    if (isOpenAiSafetyBlockedError(error)) return WEBDESIGN_SAFETY_BLOCKED_ERROR_CODE;
    if (error && error.retryableWebdesignStorage === true) return WEBDESIGN_TRANSIENT_STORAGE_ERROR_MESSAGE;
    if (isRetryableWebdesignError(error)) return WEBDESIGN_TRANSIENT_OPENAI_ERROR_MESSAGE;
    const clean = stripOpenAiOperationalBoilerplate(collectWebdesignErrorDetails(error));
    return truncateText(clean || WEBDESIGN_DEFAULT_USER_ERROR_MESSAGE, 500);
  }

  function sanitizeWebdesignJobErrorForUser(error) {
    if (!error || error === WEBDESIGN_SAFETY_BLOCKED_ERROR_CODE || isOpenAiSafetyBlockedError(error)) return null;
    const detail = collectWebdesignErrorDetails(error);
    if (isTransientOpenAiWebdesignErrorText(detail)) return WEBDESIGN_TRANSIENT_OPENAI_ERROR_MESSAGE;
    const clean = stripOpenAiOperationalBoilerplate(detail || error);
    return truncateText(clean || WEBDESIGN_DEFAULT_USER_ERROR_MESSAGE, 500);
  }

  function getBatchTargetErrorForJob(job) {
    if (!job || !job.error) return WEBDESIGN_DEFAULT_USER_ERROR_MESSAGE;
    if (job.error === WEBDESIGN_SAFETY_BLOCKED_ERROR_CODE || isOpenAiSafetyBlockedError(job.error)) return 'OpenAI safety block';
    return sanitizeWebdesignJobErrorForUser(job.error) || WEBDESIGN_DEFAULT_USER_ERROR_MESSAGE;
  }

  function sanitizeBatchUserError(value) {
    return sanitizeWebdesignJobErrorForUser(value) || '';
  }

  function isOpenAiSafetyBlockedError(error) {
    if (error && error.openAiSafetyBlocked === true) return true;
    const detail = [
      typeof error === 'string' ? error : '',
      error && error.message,
      error?.data?.error?.message,
      error?.data?.error?.detail,
      error?.data?.error?.code,
      error?.data?.error,
      error?.data?.detail,
      error?.data?.safety_violations,
      error?.data?.safetyViolations,
    ].map(normalizeString).filter(Boolean).join(' ').toLowerCase();
    return /safety[_ -]?violations|safety system|request was rejected|content policy|policy violation|violated policy/.test(
      detail
    );
  }

  function createRetryablePhotoStorageError(message, cause) {
    const error = new Error(message);
    error.status = 503;
    error.retryableWebdesignStorage = true;
    if (cause) error.cause = cause;
    return error;
  }

  function createCancelledWebdesignJobError() {
    const error = new Error(WEBDESIGN_JOB_CANCELLED_ERROR);
    error.webdesignJobCancelled = true;
    return error;
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
    const safetyBlocked = job.error === WEBDESIGN_SAFETY_BLOCKED_ERROR_CODE || isOpenAiSafetyBlockedError(job.error);
    return {
      id: job.id,
      status: job.status,
      customerId: job.customer.id,
      company: job.customer.bedrijf,
      error: safetyBlocked ? null : sanitizeWebdesignJobErrorForUser(job.error),
      safetyBlocked,
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

  function requiresPersistentJobStorage() {
    return Boolean(dataOpsStore && typeof dataOpsStore.upsertWebdesignJob === 'function');
  }

  function isWebdesignJobStatusUnavailableError(error) {
    return Boolean(error && error.webdesignJobStatusUnavailable === true);
  }

  function createWebdesignJobStatusUnavailableResult() {
    return {
      ok: false,
      statusCode: 503,
      error: 'Webdesign-status tijdelijk niet bereikbaar',
      detail: 'De webdesign-opdracht wordt nog bewaakt. De status wordt zo opnieuw opgehaald.',
      retryable: true,
    };
  }

  function logPersistentJobLoadError(error) {
    const log =
      isWebdesignJobStatusUnavailableError(error) && typeof logger.warn === 'function'
        ? logger.warn.bind(logger)
        : typeof logger.error === 'function'
          ? logger.error.bind(logger)
          : null;
    if (log) log('[PremiumDatabaseWebdesignJobs][load]', error && error.message ? error.message : error);
  }

  async function loadPersistentJobResult(jobId) {
    if (!dataOpsStore || typeof dataOpsStore.getWebdesignJob !== 'function') {
      return { job: null, error: null };
    }
    try {
      return { job: await dataOpsStore.getWebdesignJob(jobId), error: null };
    } catch (error) {
      logPersistentJobLoadError(error);
      return { job: null, error };
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

  async function cancelActiveJobRecord(job) {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return '';
    job.cancelled = true;
    job.status = 'error';
    job.error = WEBDESIGN_JOB_CANCELLED_ERROR;
    job.finishedAt = now();
    const retry = getRetryState(job);
    job.retry = {
      ...retry,
      nextAttemptAt: null,
    };
    jobs.set(job.id, job);
    await persistJob(job);
    return job.id;
  }

  async function isJobFromCancelledBatch(job) {
    const batchId = normalizeJobId(job && job.batchId);
    const ownerKey = normalizeString(job && job.ownerKey);
    if (!batchId || !ownerKey || !dataOpsStore || typeof dataOpsStore.getWebdesignBatch !== 'function') return false;
    try {
      const batch = await dataOpsStore.getWebdesignBatch(ownerKey, batchId);
      return normalizeString(batch && batch.status).toLowerCase() === 'cancelled';
    } catch (error) {
      return false;
    }
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
    const visible = [];
    for (const job of Array.from(byId.values()).sort((left, right) => left.createdAt - right.createdAt)) {
      if (await isJobFromCancelledBatch(job)) {
        await cancelActiveJobRecord(job);
        continue;
      }
      visible.push(job);
    }
    return visible;
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
    const normalizedImage = await trimUniformWebdesignSideGuttersDataUrl(dataUrl, { loadSharpImpl });
    const storageDataUrl = normalizedImage.dataUrl || dataUrl;
    const mockupDataUrl = await createDeviceMockupDataUrl(storageDataUrl, customer, { loadSharpImpl });
    const checkedAt = new Date().toISOString();
    const websitePhotoName =
      truncateText(normalizeString(image.fileName || `${customer.dom || customer.bedrijf || 'webdesign'}-webdesign.png`), 180) ||
      'Websitefoto';
    const websiteMockupName = truncateText(replaceImageFileSuffix(websitePhotoName, `-device-mockup-${DEVICE_MOCKUP_FILE_VERSION}`), 180);
    const identityKey = buildCustomerIdentityKey(customer);
    const canvasRepair = normalizedImage.cropped
      ? {
          type: normalizedImage.reason,
          original: normalizedImage.original,
          output: normalizedImage.output,
          crop: normalizedImage.crop,
          repairedAt: checkedAt,
        }
      : null;
    let structuredStorageError = null;
    if (dataOpsStore && typeof dataOpsStore.uploadDesignPhoto === 'function') {
      try {
        const structured = await dataOpsStore.uploadDesignPhoto(
          {
            customerId: customer.id,
            dataUrl: storageDataUrl,
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
              ...(canvasRepair ? { webdesignCanvasRepair: canvasRepair } : {}),
            },
          },
          { source: 'premium-database-webdesign-jobs' }
        );
        if (structured && structured.ok) return;
        structuredStorageError = structured && structured.error;
      } catch (error) {
        structuredStorageError = error;
      }
    }

    let state = null;
    try {
      state = await getUiStateValues(photoScope);
    } catch (error) {
      throw createRetryablePhotoStorageError('Databasefoto-opslag kon niet worden geladen.', error);
    }
    if (!state) {
      throw createRetryablePhotoStorageError('Databasefoto-opslag kon niet worden geladen.', structuredStorageError);
    }

    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const existingMap = safeParseJsonObject(values[photoKey]);
    const remainingRemovalIds = safeParseJsonArray(values[photoRemovalKey])
      .map(normalizeString)
      .filter(Boolean)
      .filter((id) => id !== customer.id);
    const photoDataKey = buildDataKey(customer.id);
    const mockupPhotoDataKey = buildDataKey(`${customer.id}_mockup`);
    const chunks = storageDataUrl.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [];
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
        ...(canvasRepair ? { webdesignCanvasRepair: canvasRepair } : {}),
      },
    };

    let saved = null;
    try {
      saved = await setUiStateValues(
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
    } catch (error) {
      throw createRetryablePhotoStorageError('Databasefoto opslaan is mislukt.', error);
    }

    if (!saved) {
      throw createRetryablePhotoStorageError('Databasefoto opslaan is mislukt.', structuredStorageError);
    }
  }

  async function processJob(job) {
    if (job && job.cancelled === true) throw createCancelledWebdesignJobError();
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
        softoraOutreachProfile: resolveWebdesignOutreachProfile(job.ownerKey),
      },
    });

    if (job.cancelled === true || (job.status === 'error' && job.error === WEBDESIGN_JOB_CANCELLED_ERROR)) {
      throw createCancelledWebdesignJobError();
    }

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
      if (error && error.webdesignJobCancelled === true) {
        job.status = 'error';
        job.error = WEBDESIGN_JOB_CANCELLED_ERROR;
        job.cancelled = true;
        job.finishedAt = now();
        const retry = getRetryState(job);
        job.retry = {
          ...retry,
          nextAttemptAt: null,
        };
        await persistJob(job);
        return job;
      }
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
            lastRetryReason: getUserFacingWebdesignErrorFromError(error),
          };
          if (typeof logger.warn === 'function') {
            logger.warn(
              `[PremiumDatabaseWebdesignJobs][retry] ${job.id} wacht ${Math.round(retryDelayMs / 1000)}s na tijdelijke webdesign-fout`
            );
          }
          await persistJob(job);
          return job;
        }
      }
      job.status = 'error';
      job.error = getUserFacingWebdesignErrorFromError(error);
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
    if (!shouldProcess || activeProcessingCount >= PROCESSING_CONCURRENCY || inlineProcessingJobIds.has(job.id)) return job;

    if (job.status === 'running') {
      job.status = 'queued';
      job.error = null;
      job.startedAt = null;
      job.finishedAt = null;
      clearRetryState(job);
      await persistJob(job);
    }

    activeProcessingCount += 1;
    inlineProcessingJobIds.add(job.id);
    try {
      return await settleJob(job);
    } finally {
      inlineProcessingJobIds.delete(job.id);
      activeProcessingCount = Math.max(0, activeProcessingCount - 1);
    }
  }

  async function processJobForWorker(job) {
    if (!job) return job;
    const shouldProcess = (job.status === 'queued' && isJobReadyToProcess(job)) || isStaleRunningJob(job);
    if (!shouldProcess || activeProcessingCount >= PROCESSING_CONCURRENCY || inlineProcessingJobIds.has(job.id)) return job;

    if (job.status === 'running') {
      job.status = 'queued';
      job.error = null;
      job.startedAt = null;
      job.finishedAt = null;
      clearRetryState(job);
      await persistJob(job);
    }

    activeProcessingCount += 1;
    inlineProcessingJobIds.add(job.id);
    try {
      return await settleJob(job);
    } finally {
      inlineProcessingJobIds.delete(job.id);
      activeProcessingCount = Math.max(0, activeProcessingCount - 1);
    }
  }

  function queueProcessing() {
    if (activeProcessingCount >= PROCESSING_CONCURRENCY) return;
    let started = false;
    while (activeProcessingCount < PROCESSING_CONCURRENCY) {
      const next = Array.from(jobs.values()).find((job) => isJobReadyToProcess(job) && !inlineProcessingJobIds.has(job.id));
      if (!next) break;
      started = true;
      activeProcessingCount += 1;
      inlineProcessingJobIds.add(next.id);
      setImmediate(() => {
        settleJob(next)
          .finally(() => {
            inlineProcessingJobIds.delete(next.id);
            activeProcessingCount = Math.max(0, activeProcessingCount - 1);
            queueProcessing();
          });
      });
    }
    if (!started) {
      const nextRetryAt = getSoonestQueuedRetryAt();
      if (nextRetryAt) scheduleProcessingWake(nextRetryAt - now());
    }
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
    let existingById = jobs.get(jobId);
    if (!existingById) {
      const loadedById = await loadPersistentJobResult(jobId);
      if (loadedById.error) return createWebdesignJobStatusUnavailableResult();
      existingById = loadedById.job;
    }
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
      batchId: normalizeJobId(input.batchId),
      batchTargetIndex: Number.isFinite(Number(input.batchTargetIndex))
        ? Math.max(0, Math.floor(Number(input.batchTargetIndex)))
        : null,
    };
    jobs.set(job.id, job);
    const persisted = await persistJob(job);
    if (requiresPersistentJobStorage() && !persisted) {
      jobs.delete(job.id);
      return {
        ok: false,
        statusCode: 503,
        error: 'Webdesign-opdracht opslaan mislukt',
        detail: 'De webdesign-opdracht kon tijdelijk niet veilig worden opgeslagen. Probeer opnieuw.',
      };
    }
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

    let job = jobs.get(jobId);
    let persistentLoadError = null;
    if (!job) {
      const loaded = await loadPersistentJobResult(jobId);
      job = loaded.job;
      persistentLoadError = loaded.error;
    }
    if (!job && persistentLoadError) {
      const result = createWebdesignJobStatusUnavailableResult();
      return res.status(result.statusCode).json(result);
    }
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

  function createBatchId() {
    return `webdesign_batch_${randomUUID().replace(/-/g, '')}`;
  }

  function requiresPersistentBatchStorage() {
    return Boolean(
      dataOpsStore &&
        typeof dataOpsStore.upsertWebdesignBatch === 'function' &&
        typeof dataOpsStore.upsertWebdesignBatchChunk === 'function' &&
        typeof dataOpsStore.getWebdesignBatch === 'function' &&
        typeof dataOpsStore.listWebdesignBatchChunks === 'function'
    );
  }

  function extractBatchStorageCause(value, depth = 0) {
    if (!value || depth > 5) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const direct = normalizeString(value);
      return direct === '[object Object]' ? '' : direct;
    }
    if (value instanceof Error) {
      const direct = normalizeString(value.message);
      if (direct && direct !== '[object Object]') return direct;
      return extractBatchStorageCause(value.cause, depth + 1);
    }
    if (Array.isArray(value)) {
      return value.map((item) => extractBatchStorageCause(item, depth + 1)).filter(Boolean).join('; ');
    }
    if (typeof value === 'object') {
      const source = value;
      const keys = ['message', 'detail', 'details', 'error_description', 'error', 'hint', 'code', 'statusText', 'cause', 'result'];
      for (const key of keys) {
        const nested = extractBatchStorageCause(source[key], depth + 1);
        if (nested) return nested;
      }
      try {
        const json = JSON.stringify(source);
        return json && json !== '{}' ? json : '';
      } catch (_error) {
        return '';
      }
    }
    return '';
  }

  function getBatchStorageCause(error) {
    return truncateText(extractBatchStorageCause(error), 240);
  }

  function createBatchStorageUnavailableResult(action, error) {
    const actionText = truncateText(normalizeString(action), 120);
    const cause = getBatchStorageCause(error);
    const suffix = [actionText, cause].filter(Boolean).join(' - ') || 'onbekende opslagfout';
    return {
      ok: false,
      statusCode: 503,
      error: 'Webdesign-bulk tijdelijk niet bereikbaar',
      detail: `De bulk-wachtrij kon niet veilig worden opgeslagen of gelezen. Oorzaak: ${suffix}.`,
      action: actionText,
      cause,
      retryable: true,
    };
  }

  function createPersistFailure(action, result) {
    const message = getBatchStorageCause(result) || `${action} mislukt`;
    const error = new Error(message);
    if (result && typeof result === 'object') error.cause = result;
    return { ok: false, action, error, result, cause: message };
  }

  async function persistBatch(batch, action = 'batch opslaan') {
    if (!requiresPersistentBatchStorage()) return { ok: false, action, error: new Error('Batch-opslag ontbreekt') };
    try {
      const saved = await dataOpsStore.upsertWebdesignBatch(batch);
      if (saved && saved.ok) return saved;
      const failure = createPersistFailure(action, saved);
      logger.error('[PremiumDatabaseWebdesignJobs][batch-persist-result]', failure.error.message);
      return failure;
    } catch (error) {
      logger.error('[PremiumDatabaseWebdesignJobs][batch-persist]', error && error.message ? error.message : error);
      return { ok: false, action, error };
    }
  }

  async function persistBatchChunk(chunk, action = 'batch-blok opslaan') {
    if (!requiresPersistentBatchStorage()) return { ok: false, action, error: new Error('Batch-opslag ontbreekt') };
    try {
      const saved = await dataOpsStore.upsertWebdesignBatchChunk(chunk);
      if (saved && saved.ok) return saved;
      const failure = createPersistFailure(action, saved);
      logger.error('[PremiumDatabaseWebdesignJobs][batch-chunk-persist-result]', failure.error.message);
      return failure;
    } catch (error) {
      logger.error('[PremiumDatabaseWebdesignJobs][batch-chunk-persist]', error && error.message ? error.message : error);
      return { ok: false, action, error };
    }
  }

  async function loadBatch(ownerKey, batchId) {
    if (!requiresPersistentBatchStorage()) return { batch: null, error: new Error('Batch-opslag ontbreekt') };
    try {
      return { batch: await dataOpsStore.getWebdesignBatch(ownerKey, batchId), error: null };
    } catch (error) {
      logPersistentJobLoadError(error);
      return { batch: null, error };
    }
  }

  async function loadBatchChunks(ownerKey, batchId) {
    if (!requiresPersistentBatchStorage()) return { chunks: [], error: new Error('Batch-opslag ontbreekt') };
    try {
      return { chunks: await dataOpsStore.listWebdesignBatchChunks(ownerKey, batchId), error: null };
    } catch (error) {
      logPersistentJobLoadError(error);
      return { chunks: [], error };
    }
  }

  function normalizeBatchTarget(raw = {}, index = 0) {
    const customer = normalizeCustomer(raw.customer || raw);
    const websiteUrl = normalizeWebsiteUrl(raw.websiteUrl || customer.website || customer.dom);
    return {
      index: Math.max(0, Math.floor(Number(raw.index || index) || 0)),
      status: websiteUrl && customer.id && customer.bedrijf ? normalizeString(raw.status || 'pending').toLowerCase() || 'pending' : 'error',
      jobId: truncateText(normalizeString(raw.jobId || ''), 160),
      error: websiteUrl && customer.id && customer.bedrijf ? truncateText(normalizeString(raw.error || ''), 500) : 'Ongeldige webdesign-target.',
      attempts: Math.max(0, Math.floor(Number(raw.attempts || 0) || 0)),
      nextAttemptAt: Math.max(0, Number(raw.nextAttemptAt || 0) || 0) || null,
      updatedAt: Math.max(0, Number(raw.updatedAt || 0) || 0) || now(),
      finishedAt: Math.max(0, Number(raw.finishedAt || 0) || 0) || null,
      websiteUrl,
      customer,
    };
  }

  function isBatchTerminalStatus(status) {
    const value = normalizeString(status).toLowerCase();
    return value === 'done' || value === 'error' || value === 'cancelled';
  }

  function isTargetTerminalStatus(status) {
    const value = normalizeString(status).toLowerCase();
    return value === 'done' || value === 'error' || value === 'cancelled';
  }

  function getEffectiveBatchStatus(batch, summary) {
    const status = normalizeString(batch && batch.status).toLowerCase();
    if (status === 'cancelled') return 'cancelled';
    if (summary && Math.max(0, Number(summary.cancelled) || 0) > 0) return 'cancelled';
    return status || 'queued';
  }

  function hasBatchCancellationSignal(batch, chunks) {
    const status = normalizeString(batch && batch.status).toLowerCase();
    if (status === 'cancelled') return true;
    const summary = summarizeBatchChunks(batch, chunks);
    return Math.max(0, Number(summary.cancelled) || 0) > 0;
  }

  async function loadStoredBatchCancellationSignal(batch) {
    const ownerKey = normalizeString(batch && batch.ownerKey);
    const batchId = normalizeJobId(batch && batch.id);
    if (!ownerKey || !batchId) return false;
    const loaded = await loadBatch(ownerKey, batchId);
    if (loaded.error || !loaded.batch) return false;
    return hasBatchCancellationSignal(loaded.batch, []);
  }

  async function stopIfStoredBatchCancelled(batch) {
    if (!(await loadStoredBatchCancellationSignal(batch))) return false;
    batch.status = 'cancelled';
    batch.finishedAt = batch.finishedAt || now();
    return true;
  }

  async function persistBatchUnlessStoredCancelled(batch, action) {
    if (normalizeString(batch && batch.status).toLowerCase() !== 'cancelled' && (await stopIfStoredBatchCancelled(batch))) {
      return { ok: true, skipped: true, cancelled: true };
    }
    return persistBatch(batch, action);
  }

  function summarizeBatchChunks(batch, chunks) {
    if ((!Array.isArray(chunks) || !chunks.length) && batch && batch.summary && typeof batch.summary === 'object') {
      const stored = batch.summary;
      const done = Math.max(0, Math.floor(Number(stored.done || stored.made || 0) || 0));
      const failed = Math.max(0, Math.floor(Number(stored.failed || 0) || 0));
      const pending = Math.max(0, Math.floor(Number(stored.pending || 0) || 0));
      const queued = Math.max(0, Math.floor(Number(stored.queued || 0) || 0));
      const running = Math.max(0, Math.floor(Number(stored.running || 0) || 0));
      const cancelled = Math.max(0, Math.floor(Number(stored.cancelled || 0) || 0));
      const total = Math.max(0, Math.floor(Number(batch.total || stored.total || 0) || 0));
      return {
        total,
        uploadedTargets: Math.max(0, Math.floor(Number(batch.uploadedTargets || stored.uploadedTargets || 0) || 0)),
        pending,
        queued,
        running,
        done,
        failed,
        cancelled,
        completed: done + failed + cancelled,
        remaining: Math.max(0, total - done - failed - cancelled),
        active: queued + running,
        chunks: Math.max(0, Math.floor(Number(stored.chunks || 0) || 0)),
        nextAttemptAt: Math.max(0, Number(stored.nextAttemptAt || 0) || 0) || null,
        made: done,
      };
    }
    const summary = {
      total: Math.max(0, Math.floor(Number(batch && batch.total) || 0)),
      uploadedTargets: 0,
      pending: 0,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      completed: 0,
      remaining: 0,
      active: 0,
      chunks: Array.isArray(chunks) ? chunks.length : 0,
      nextAttemptAt: null,
    };
    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
      (Array.isArray(chunk.targets) ? chunk.targets : []).forEach((target) => {
        summary.uploadedTargets += 1;
        const status = normalizeString(target && target.status).toLowerCase();
        if (status === 'done') summary.done += 1;
        else if (status === 'error') summary.failed += 1;
        else if (status === 'cancelled') summary.cancelled += 1;
        else if (status === 'running') summary.running += 1;
        else if (status === 'queued') summary.queued += 1;
        else summary.pending += 1;
        const nextAttemptAt = Math.max(0, Number(target && target.nextAttemptAt) || 0);
        if (nextAttemptAt && (!summary.nextAttemptAt || nextAttemptAt < summary.nextAttemptAt)) {
          summary.nextAttemptAt = nextAttemptAt;
        }
      });
    });
    if (!summary.total) summary.total = summary.uploadedTargets;
    summary.active = summary.queued + summary.running;
    summary.completed = summary.done + summary.failed + summary.cancelled;
    summary.remaining = Math.max(0, summary.total - summary.completed);
    summary.made = summary.done;
    return summary;
  }

  function serializeBatch(batch, chunks) {
    const summary = summarizeBatchChunks(batch, chunks);
    const activeJobIds = collectActiveBatchJobIds(chunks);
    const status = getEffectiveBatchStatus(batch, summary);
    return {
      id: batch.id,
      status,
      total: summary.total,
      uploadedTargets: summary.uploadedTargets,
      expectedChunks: Math.max(0, Math.floor(Number(batch.expectedChunks || 0) || 0)),
      chunks: summary.chunks,
      made: summary.made,
      done: summary.done,
      failed: summary.failed,
      cancelled: summary.cancelled,
      pending: summary.pending,
      queued: summary.queued,
      running: summary.running,
      active: summary.active,
      completed: summary.completed,
      remaining: summary.remaining,
      nextAttemptAt: summary.nextAttemptAt,
      activeJobIds,
      activeJobCount: activeJobIds.length,
      lastError: sanitizeBatchUserError(batch.lastError || batch.error || ''),
      createdAt: batch.createdAt || null,
      startedAt: batch.startedAt || null,
      finishedAt: batch.finishedAt || null,
    };
  }

  function collectActiveBatchJobIds(chunks) {
    const ids = [];
    const seen = new Set();
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const target of Array.isArray(chunk && chunk.targets) ? chunk.targets : []) {
        const status = normalizeString(target && target.status).toLowerCase();
        const jobId = normalizeJobId(target && target.jobId);
        if ((status !== 'queued' && status !== 'running') || !jobId || seen.has(jobId)) continue;
        const nextAttemptAt = Math.max(0, Number(target && target.nextAttemptAt) || 0);
        if (status === 'queued' && nextAttemptAt && nextAttemptAt > now()) continue;
        seen.add(jobId);
        ids.push(jobId);
        if (ids.length >= BULK_ACTIVE_JOB_LIMIT) return ids;
      }
    }
    return ids;
  }

  function applyJobResultToBatchTarget(target, job) {
    if (!target || !job) return false;
    const beforeStatus = normalizeString(target.status).toLowerCase();
    const beforeError = normalizeString(target.error || '');
    if (job.status === 'done') {
      markTarget(target, 'done', { error: '' });
    } else if (job.status === 'error') {
      markTarget(target, 'error', {
        error: getBatchTargetErrorForJob(job),
      });
    } else if (job.status === 'running') {
      markTarget(target, 'running', { error: '' });
    } else {
      const retry = getRetryState(job);
      markTarget(target, 'queued', {
        error: '',
        nextAttemptAt: retry.nextAttemptAt || null,
      });
    }
    return beforeStatus !== normalizeString(target.status).toLowerCase() || beforeError !== normalizeString(target.error || '');
  }

  function markTarget(target, status, patch = {}) {
    Object.assign(target, patch, {
      status,
      updatedAt: now(),
    });
    if (isTargetTerminalStatus(status)) target.finishedAt = now();
  }

  function isRetryableStartFailure(result) {
    const statusCode = Number(result && result.statusCode) || 0;
    if (result && result.retryable === true) return true;
    return statusCode === 408 || statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504 || statusCode >= 500;
  }

  async function reconcileBatchJobs(chunks) {
    const changed = new Set();
    for (const chunk of chunks) {
      for (const target of chunk.targets || []) {
        const status = normalizeString(target.status).toLowerCase();
        if ((status !== 'queued' && status !== 'running') || !target.jobId) continue;
        let job = jobs.get(target.jobId);
        if (!job) {
          const loaded = await loadPersistentJobResult(target.jobId);
          if (loaded.error) continue;
          job = loaded.job;
        }
        if (!job) {
          markTarget(target, 'pending', { jobId: '', error: '' });
          changed.add(chunk.index);
          continue;
        }
        jobs.set(job.id, job);
        if (!processJobsInline && job.status === 'queued') {
          queueProcessing();
        }
        if (job.status === 'done') {
          markTarget(target, 'done', { error: '' });
          changed.add(chunk.index);
        } else if (job.status === 'error') {
          markTarget(target, 'error', {
            error: getBatchTargetErrorForJob(job),
          });
          changed.add(chunk.index);
        } else if (target.status !== job.status) {
          markTarget(target, job.status === 'running' ? 'running' : 'queued');
          changed.add(chunk.index);
        }
      }
    }
    return changed;
  }

  async function startPendingBatchTargets(batch, chunks) {
    const changed = new Set();
    if (hasBatchCancellationSignal(batch, chunks) || (await loadStoredBatchCancellationSignal(batch))) return changed;
    let summary = summarizeBatchChunks(batch, chunks);
    let started = 0;
    let attempted = 0;
    for (const chunk of chunks) {
      for (const target of chunk.targets || []) {
        if (summary.active >= BULK_ACTIVE_JOB_LIMIT || attempted >= BULK_START_LIMIT) return changed;
        if (normalizeString(target.status).toLowerCase() !== 'pending') continue;
        if (target.nextAttemptAt && target.nextAttemptAt > now()) continue;
        attempted += 1;
        const result = await startJob({
          ownerKey: batch.ownerKey,
          customer: target.customer,
          websiteUrl: target.websiteUrl,
          batchId: batch.id,
          batchTargetIndex: target.index,
        });
        if (result.ok && result.job && result.job.id) {
          const job = result.job;
          if (job.status === 'done') markTarget(target, 'done', { jobId: job.id, error: '' });
          else if (job.status === 'error') markTarget(target, 'error', { jobId: job.id, error: getBatchTargetErrorForJob(job) });
          else {
            markTarget(target, job.status === 'running' ? 'running' : 'queued', { jobId: job.id, error: '' });
            summary.active += 1;
          }
          started += 1;
          changed.add(chunk.index);
          continue;
        }
        const message =
          sanitizeWebdesignJobErrorForUser(result.detail || result.error) || 'Webdesign starten is tijdelijk mislukt.';
        if (isRetryableStartFailure(result)) {
          const attempts = Math.max(0, Number(target.attempts) || 0) + 1;
          target.attempts = attempts;
          target.nextAttemptAt = now() + Math.min(RETRY_DELAY_MAX_MS, RETRY_DELAY_MIN_MS * Math.max(1, attempts));
          target.error = message;
          target.updatedAt = now();
          batch.lastError = message;
          changed.add(chunk.index);
          continue;
        }
        markTarget(target, 'error', { error: message });
        batch.lastError = message;
        changed.add(chunk.index);
      }
    }
    return changed;
  }

  async function persistChangedBatchChunks(chunks, changedIndexes, options = {}) {
    if (options.batch && !options.allowCancelledBatchWrite && (await stopIfStoredBatchCancelled(options.batch))) {
      return { ok: true, skipped: true, cancelled: true };
    }
    for (const chunk of chunks) {
      if (!changedIndexes.has(chunk.index)) continue;
      const saved = await persistBatchChunk(chunk, `batch-blok ${chunk.index} opslaan`);
      if (!saved || saved.ok !== true) return saved;
    }
    return { ok: true };
  }

  async function runLimited(items, limit, worker) {
    const safeLimit = Math.max(1, Number(limit) || 1);
    let cursor = 0;
    const results = [];
    const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        results.push(await worker(item));
      }
    });
    await Promise.all(runners);
    return results;
  }

  async function processBatchJobsForWorker(batch, chunks, options = {}) {
    const changed = new Set();
    const jobLimit = Math.max(1, Math.min(BULK_WORKER_JOB_LIMIT, Math.floor(Number(options.jobLimit) || BULK_WORKER_JOB_LIMIT)));
    const concurrency = Math.max(1, Math.min(BULK_WORKER_CONCURRENCY, Math.floor(Number(options.concurrency) || BULK_WORKER_CONCURRENCY)));
    const candidates = [];
    let loadedJobs = 0;
    let missingJobs = 0;
    let completedTargets = 0;

    if (batch.status !== 'running' || hasBatchCancellationSignal(batch, chunks) || (await loadStoredBatchCancellationSignal(batch))) {
      if (await stopIfStoredBatchCancelled(batch)) {
        return {
          loadedJobs,
          missingJobs,
          processedJobs: 0,
          completedTargets,
          changedChunks: 0,
          summary: summarizeBatchChunks(batch, chunks),
        };
      }
      return {
        loadedJobs,
        missingJobs,
        processedJobs: 0,
        completedTargets,
        changedChunks: 0,
        summary: summarizeBatchChunks(batch, chunks),
      };
    }

    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const target of Array.isArray(chunk.targets) ? chunk.targets : []) {
        if (candidates.length >= jobLimit) break;
        const status = normalizeString(target.status).toLowerCase();
        const jobId = normalizeJobId(target.jobId);
        if ((status !== 'queued' && status !== 'running') || !jobId) continue;
        let job = jobs.get(jobId);
        if (!job) {
          const loaded = await loadPersistentJobResult(jobId);
          if (loaded.error) continue;
          job = loaded.job;
        }
        if (!job) {
          markTarget(target, 'pending', { jobId: '', error: '' });
          missingJobs += 1;
          changed.add(chunk.index);
          continue;
        }
        jobs.set(job.id, job);
        loadedJobs += 1;
        if (applyJobResultToBatchTarget(target, job)) changed.add(chunk.index);
        if (job.status === 'done' || job.status === 'error') {
          completedTargets += 1;
          continue;
        }
        if ((job.status === 'queued' && isJobReadyToProcess(job)) || isStaleRunningJob(job)) {
          candidates.push({ chunk, target, job });
        }
      }
      if (candidates.length >= jobLimit) break;
    }

    let processedJobs = 0;
    await runLimited(candidates, concurrency, async ({ chunk, target, job }) => {
      const result = await processJobForWorker(job);
      if (result && (result.status === 'done' || result.status === 'error' || result.status === 'queued' || result.status === 'running')) {
        processedJobs += result.status === 'done' || result.status === 'error' || result.status === 'queued' ? 1 : 0;
        if (applyJobResultToBatchTarget(target, result)) changed.add(chunk.index);
      }
    });

    const chunksSaved = await persistChangedBatchChunks(chunks, changed, { batch });
    if (!chunksSaved || chunksSaved.ok !== true) {
      return {
        loadedJobs,
        missingJobs,
        processedJobs,
        completedTargets,
        changedChunks: changed.size,
        storageError: chunksSaved,
      };
    }
    const summary = summarizeBatchChunks(batch, chunks);
    batch.summary = summary;
    batch.uploadedTargets = summary.uploadedTargets;
    if (summary.cancelled > 0) {
      batch.status = 'cancelled';
      batch.finishedAt = batch.finishedAt || now();
    } else if (batch.status === 'running' && summary.total > 0 && summary.completed >= summary.total && summary.pending === 0 && summary.active === 0) {
      batch.status = 'done';
      batch.finishedAt = now();
    }
    const batchSaved = await persistBatchUnlessStoredCancelled(batch, 'batch-worker samenvatting opslaan');
    if (!batchSaved || batchSaved.ok !== true) {
      return {
        loadedJobs,
        missingJobs,
        processedJobs,
        completedTargets,
        changedChunks: changed.size,
        summary,
        storageError: batchSaved,
      };
    }

    return {
      loadedJobs,
      missingJobs,
      processedJobs,
      completedTargets,
      changedChunks: changed.size,
      summary,
    };
  }

  async function driveBatch(batch, chunks) {
    const changed = new Set();
    if (await stopIfStoredBatchCancelled(batch)) return { batch, chunks };
    if (batch.status === 'running') {
      const reconciled = await reconcileBatchJobs(chunks);
      reconciled.forEach((index) => changed.add(index));
      const started = await startPendingBatchTargets(batch, chunks);
      started.forEach((index) => changed.add(index));
      if (hasBatchCancellationSignal(batch, chunks) || (await stopIfStoredBatchCancelled(batch))) return { batch, chunks };
      const chunksSaved = await persistChangedBatchChunks(chunks, changed, { batch });
      if (!chunksSaved || chunksSaved.ok !== true) return { batch, chunks, storageError: chunksSaved };
      const summary = summarizeBatchChunks(batch, chunks);
      batch.summary = summary;
      batch.uploadedTargets = summary.uploadedTargets;
      if (summary.cancelled > 0) {
        batch.status = 'cancelled';
        batch.finishedAt = batch.finishedAt || now();
      } else if (summary.total > 0 && summary.completed >= summary.total && summary.pending === 0 && summary.active === 0) {
        batch.status = 'done';
        batch.finishedAt = now();
      }
      const batchSaved = await persistBatchUnlessStoredCancelled(batch, 'batch-status opslaan');
      if (!batchSaved || batchSaved.ok !== true) return { batch, chunks, storageError: batchSaved };
    }
    return { batch, chunks };
  }

  async function cancelActiveTargetJob(target) {
    const jobId = normalizeJobId(target && target.jobId);
    if (!jobId) return '';
    let job = jobs.get(jobId);
    if (!job) {
      const loaded = await loadPersistentJobResult(jobId);
      if (!loaded.error && loaded.job) job = loaded.job;
    }
    return cancelActiveJobRecord(job);
  }

  async function cancelActiveJobsForBatch(batch, seenJobIds) {
    const ownerKey = normalizeString(batch && batch.ownerKey);
    const batchId = normalizeJobId(batch && batch.id);
    if (!ownerKey || !batchId) return [];
    const candidates = new Map();
    Array.from(jobs.values())
      .filter((job) => job && job.ownerKey === ownerKey && normalizeJobId(job.batchId) === batchId)
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .forEach((job) => candidates.set(job.id, job));
    if (dataOpsStore && typeof dataOpsStore.listVisibleWebdesignJobs === 'function') {
      const persistentJobs = await dataOpsStore.listVisibleWebdesignJobs(ownerKey);
      (Array.isArray(persistentJobs) ? persistentJobs : [])
        .filter((job) => job && normalizeJobId(job.batchId) === batchId)
        .filter((job) => job.status === 'queued' || job.status === 'running')
        .forEach((job) => {
          jobs.set(job.id, job);
          candidates.set(job.id, job);
        });
    }
    const cancelledJobIds = [];
    for (const job of candidates.values()) {
      if (!job || seenJobIds.has(job.id)) continue;
      const cancelledJobId = await cancelActiveJobRecord(job);
      if (cancelledJobId) {
        cancelledJobIds.push(cancelledJobId);
      }
    }
    return cancelledJobIds;
  }

  async function cancelBatch(batch, chunks) {
    const changed = new Set();
    let cancelledTargets = 0;
    const cancelledJobIds = [];
    const seenCancelledJobIds = new Set();
    function rememberCancelledJob(jobId) {
      const normalized = normalizeJobId(jobId);
      if (!normalized || seenCancelledJobIds.has(normalized)) return;
      seenCancelledJobIds.add(normalized);
      cancelledJobIds.push(normalized);
    }
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const target of Array.isArray(chunk.targets) ? chunk.targets : []) {
        const status = normalizeString(target && target.status).toLowerCase();
        if (isTargetTerminalStatus(status)) continue;
        if ((status === 'queued' || status === 'running') && target.jobId) {
          rememberCancelledJob(await cancelActiveTargetJob(target));
        }
        markTarget(target, 'cancelled', {
          error: WEBDESIGN_JOB_CANCELLED_ERROR,
          nextAttemptAt: null,
        });
        cancelledTargets += 1;
        changed.add(chunk.index);
      }
    }
    (await cancelActiveJobsForBatch(batch, seenCancelledJobIds)).forEach(rememberCancelledJob);
    const summary = summarizeBatchChunks(batch, chunks);
    batch.status = 'cancelled';
    batch.finishedAt = batch.finishedAt || now();
    batch.summary = summary;
    batch.uploadedTargets = summary.uploadedTargets;
    const batchSaved = await persistBatch(batch, 'batch-annulering markeren');
    if (!batchSaved || batchSaved.ok !== true) {
      return {
        ok: false,
        action: batchSaved && batchSaved.action,
        error: batchSaved && batchSaved.error,
      };
    }
    const chunksSaved = await persistChangedBatchChunks(chunks, changed, { batch, allowCancelledBatchWrite: true });
    if (!chunksSaved || chunksSaved.ok !== true) {
      return {
        ok: false,
        action: chunksSaved && chunksSaved.action,
        error: chunksSaved && chunksSaved.error,
      };
    }
    return {
      ok: true,
      batch,
      chunks,
      cancelledTargets,
      cancelledJobs: cancelledJobIds.length,
      cancelledJobIds,
      summary,
    };
  }

  async function listRunnableBatches(limit) {
    if (!dataOpsStore || typeof dataOpsStore.listRunnableWebdesignBatches !== 'function') return null;
    return dataOpsStore.listRunnableWebdesignBatches(limit);
  }

  async function runBatchWorker(options = {}) {
    pruneJobs();
    if (!requiresPersistentBatchStorage()) {
      return createBatchStorageUnavailableResult('batch-opslag controleren');
    }
    const batchLimit = Math.max(1, Math.min(BULK_WORKER_BATCH_LIMIT, Math.floor(Number(options.batchLimit) || BULK_WORKER_BATCH_LIMIT)));
    let runnableBatches;
    try {
      runnableBatches = await listRunnableBatches(batchLimit);
    } catch (error) {
      return createBatchStorageUnavailableResult('runnable batches lezen', error);
    }
    if (!Array.isArray(runnableBatches)) {
      return createBatchStorageUnavailableResult('runnable batches lezen', new Error('Geen batchlijst ontvangen'));
    }

    const result = {
      ok: true,
      statusCode: 200,
      batchCount: 0,
      processedJobs: 0,
      loadedJobs: 0,
      missingJobs: 0,
      completedTargets: 0,
      changedChunks: 0,
      batches: [],
    };

    for (const batch of runnableBatches) {
      if (!batch || !batch.id || !batch.ownerKey) continue;
      const chunksResult = await loadBatchChunks(batch.ownerKey, batch.id);
      if (chunksResult.error) continue;
      const drivenBefore = await driveBatch(batch, chunksResult.chunks || []);
      if (drivenBefore.storageError) {
        return createBatchStorageUnavailableResult(
          drivenBefore.storageError.action || 'batch-status opslaan',
          drivenBefore.storageError.error
        );
      }
      const workerResult = await processBatchJobsForWorker(drivenBefore.batch, drivenBefore.chunks, options);
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
      const serialized = serializeBatch(drivenAfter.batch, drivenAfter.chunks);
      result.batchCount += 1;
      result.processedJobs += workerResult.processedJobs;
      result.loadedJobs += workerResult.loadedJobs;
      result.missingJobs += workerResult.missingJobs;
      result.completedTargets += workerResult.completedTargets;
      result.changedChunks += workerResult.changedChunks;
      result.batches.push(serialized);
    }

    return result;
  }

  async function runBatchWorkerResponse(req, res) {
    const result = await runBatchWorker({
      batchLimit: req.query?.batchLimit || req.body?.batchLimit,
      jobLimit: req.query?.jobLimit || req.body?.jobLimit,
      concurrency: req.query?.concurrency || req.body?.concurrency,
    });
    const statusCode = Math.max(100, Math.min(599, Number(result.statusCode) || (result.ok ? 200 : 500)));
    return res.status(statusCode).json(result);
  }

  async function cancelBatchResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const batchId = normalizeJobId(req.params && req.params.batchId);
    if (!batchId) return res.status(400).json({ ok: false, error: 'Batch ontbreekt' });
    const loaded = await loadBatch(ownerKey, batchId);
    if (loaded.error) {
      const result = createBatchStorageUnavailableResult('batch lezen', loaded.error);
      return res.status(result.statusCode).json(result);
    }
    if (!loaded.batch) return res.status(404).json({ ok: false, error: 'Batch niet gevonden' });
    const chunksResult = await loadBatchChunks(ownerKey, batchId);
    if (chunksResult.error) {
      const result = createBatchStorageUnavailableResult('batch-blokken lezen', chunksResult.error);
      return res.status(result.statusCode).json(result);
    }
    const chunks = chunksResult.chunks || [];
    if (isBatchTerminalStatus(loaded.batch.status)) {
      return res.status(200).json({
        ok: true,
        cancelled: loaded.batch.status === 'cancelled',
        cancelledTargets: 0,
        cancelledJobs: 0,
        cancelledJobIds: [],
        batch: serializeBatch(loaded.batch, chunks),
      });
    }
    const cancelled = await cancelBatch(loaded.batch, chunks);
    if (!cancelled || cancelled.ok !== true) {
      const result = createBatchStorageUnavailableResult(cancelled && cancelled.action ? cancelled.action : 'batch annuleren', cancelled && cancelled.error);
      return res.status(result.statusCode).json(result);
    }
    return res.status(200).json({
      ok: true,
      cancelled: true,
      cancelledTargets: cancelled.cancelledTargets,
      cancelledJobs: cancelled.cancelledJobs,
      cancelledJobIds: cancelled.cancelledJobIds || [],
      batch: serializeBatch(cancelled.batch, cancelled.chunks),
    });
  }

  async function startBatchResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    if (!requiresPersistentBatchStorage()) {
      const result = createBatchStorageUnavailableResult('batch-opslag controleren');
      return res.status(result.statusCode).json(result);
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const batch = {
      id: createBatchId(),
      ownerKey,
      status: 'queued',
      total: Math.max(0, Math.floor(Number(body.total || 0) || 0)),
      expectedChunks: 0,
      uploadedTargets: 0,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      summary: {},
      lastError: '',
    };
    const saved = await persistBatch(batch, 'batch starten opslaan');
    if (!saved || saved.ok !== true) {
      const result = createBatchStorageUnavailableResult(saved && saved.action ? saved.action : 'batch starten opslaan', saved && saved.error);
      return res.status(result.statusCode).json(result);
    }
    return res.status(202).json({ ok: true, batch: serializeBatch(batch, []) });
  }

  async function appendBatchChunkResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const batchId = normalizeJobId(req.params && req.params.batchId);
    if (!batchId) return res.status(400).json({ ok: false, error: 'Batch ontbreekt' });
    const loaded = await loadBatch(ownerKey, batchId);
    if (loaded.error) {
      const result = createBatchStorageUnavailableResult('batch lezen', loaded.error);
      return res.status(result.statusCode).json(result);
    }
    if (!loaded.batch) return res.status(404).json({ ok: false, error: 'Batch niet gevonden' });
    if (isBatchTerminalStatus(loaded.batch.status)) return res.status(409).json({ ok: false, error: 'Batch is al klaar' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawTargets = Array.isArray(body.targets) ? body.targets.slice(0, BULK_CHUNK_TARGET_LIMIT) : [];
    const index = Math.max(0, Math.floor(Number(body.index || 0) || 0));
    const offset = Math.max(0, Math.floor(Number(body.offset || index * BULK_CHUNK_TARGET_LIMIT) || 0));
    const chunk = {
      id: `${batchId}_chunk_${String(index).padStart(5, '0')}`,
      ownerKey,
      batchId,
      index,
      status: 'queued',
      targets: rawTargets.map((target, targetIndex) => normalizeBatchTarget({ ...target, index: offset + targetIndex }, offset + targetIndex)),
      createdAt: now(),
    };
    const saved = await persistBatchChunk(chunk, `batch-blok ${index} opslaan`);
    if (!saved || saved.ok !== true) {
      const result = createBatchStorageUnavailableResult(saved && saved.action ? saved.action : 'batch-blok opslaan', saved && saved.error);
      return res.status(result.statusCode).json(result);
    }
    const chunksResult = await loadBatchChunks(ownerKey, batchId);
    if (chunksResult.error) {
      const result = createBatchStorageUnavailableResult('batch-blokken na upload lezen', chunksResult.error);
      return res.status(result.statusCode).json(result);
    }
    const chunks = chunksResult.chunks || [chunk];
    const summary = summarizeBatchChunks(loaded.batch, chunks);
    loaded.batch.uploadedTargets = summary.uploadedTargets;
    loaded.batch.expectedChunks = Math.max(loaded.batch.expectedChunks || 0, index + 1);
    loaded.batch.summary = summary;
    const batchSaved = await persistBatch(loaded.batch, 'batch-upload samenvatting opslaan');
    if (!batchSaved || batchSaved.ok !== true) {
      const result = createBatchStorageUnavailableResult(batchSaved && batchSaved.action ? batchSaved.action : 'batch-upload samenvatting opslaan', batchSaved && batchSaved.error);
      return res.status(result.statusCode).json(result);
    }
    return res.status(202).json({ ok: true, batch: serializeBatch(loaded.batch, chunks) });
  }

  async function commitBatchResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const batchId = normalizeJobId(req.params && req.params.batchId);
    if (!batchId) return res.status(400).json({ ok: false, error: 'Batch ontbreekt' });
    const loaded = await loadBatch(ownerKey, batchId);
    if (loaded.error) {
      const result = createBatchStorageUnavailableResult('batch lezen', loaded.error);
      return res.status(result.statusCode).json(result);
    }
    if (!loaded.batch) return res.status(404).json({ ok: false, error: 'Batch niet gevonden' });
    if (isBatchTerminalStatus(loaded.batch.status)) return res.status(409).json({ ok: false, error: 'Batch is al klaar' });
    const chunksResult = await loadBatchChunks(ownerKey, batchId);
    if (chunksResult.error) {
      const result = createBatchStorageUnavailableResult('batch-blokken lezen', chunksResult.error);
      return res.status(result.statusCode).json(result);
    }
    const chunks = chunksResult.chunks || [];
    const summary = summarizeBatchChunks(loaded.batch, chunks);
    if (!summary.uploadedTargets) return res.status(400).json({ ok: false, error: 'Batch heeft nog geen targets' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    loaded.batch.status = 'running';
    loaded.batch.total = Math.max(summary.uploadedTargets, Math.floor(Number(body.total || loaded.batch.total || 0) || 0));
    loaded.batch.expectedChunks = Math.max(chunks.length, Math.floor(Number(body.expectedChunks || loaded.batch.expectedChunks || 0) || 0));
    loaded.batch.uploadedTargets = summary.uploadedTargets;
    loaded.batch.startedAt = loaded.batch.startedAt || now();
    loaded.batch.summary = summary;
    const batchSaved = await persistBatch(loaded.batch, 'batch starten afronden');
    if (!batchSaved || batchSaved.ok !== true) {
      const result = createBatchStorageUnavailableResult(batchSaved && batchSaved.action ? batchSaved.action : 'batch starten afronden', batchSaved && batchSaved.error);
      return res.status(result.statusCode).json(result);
    }
    const driven = await driveBatch(loaded.batch, chunks);
    if (driven.storageError) {
      const result = createBatchStorageUnavailableResult(driven.storageError.action || 'batch-status opslaan', driven.storageError.error);
      return res.status(result.statusCode).json(result);
    }
    return res.status(202).json({ ok: true, batch: serializeBatch(driven.batch, driven.chunks) });
  }

  async function getBatchResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const batchId = normalizeJobId(req.params && req.params.batchId);
    if (!batchId) return res.status(400).json({ ok: false, error: 'Batch ontbreekt' });
    const loaded = await loadBatch(ownerKey, batchId);
    if (loaded.error) {
      const result = createBatchStorageUnavailableResult('batch lezen', loaded.error);
      return res.status(result.statusCode).json(result);
    }
    if (!loaded.batch) return res.status(404).json({ ok: false, error: 'Batch niet gevonden' });
    const chunksResult = await loadBatchChunks(ownerKey, batchId);
    if (chunksResult.error) {
      const result = createBatchStorageUnavailableResult('batch-blokken lezen', chunksResult.error);
      return res.status(result.statusCode).json(result);
    }
    const driven = await driveBatch(loaded.batch, chunksResult.chunks || []);
    if (driven.storageError) {
      const result = createBatchStorageUnavailableResult(driven.storageError.action || 'batch-status opslaan', driven.storageError.error);
      return res.status(result.statusCode).json(result);
    }
    return res.status(200).json({ ok: true, batch: serializeBatch(driven.batch, driven.chunks) });
  }

  async function listBatchesResponse(req, res) {
    const ownerKey = ownerKeyFromReq(req);
    if (!ownerKey) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    if (!dataOpsStore || typeof dataOpsStore.listVisibleWebdesignBatches !== 'function') {
      const result = createBatchStorageUnavailableResult('zichtbare batches lezen');
      return res.status(result.statusCode).json(result);
    }
    let batches;
    try {
      batches = await dataOpsStore.listVisibleWebdesignBatches(ownerKey);
    } catch (error) {
      const result = createBatchStorageUnavailableResult('zichtbare batches lezen', error);
      return res.status(result.statusCode).json(result);
    }
    if (!Array.isArray(batches)) {
      const result = createBatchStorageUnavailableResult('zichtbare batches lezen', new Error('Geen batchlijst ontvangen'));
      return res.status(result.statusCode).json(result);
    }
    return res.status(200).json({ ok: true, batches: batches.map((batch) => serializeBatch(batch, [])) });
  }

  return {
    appendBatchChunkResponse,
    cancelBatchResponse,
    commitBatchResponse,
    getBatchResponse,
    getJobResponse,
    listBatchesResponse,
    listJobsResponse,
    runBatchWorker,
    runBatchWorkerResponse,
    startBatchResponse,
    startJob,
    startJobResponse,
    _jobs: jobs,
  };
}

module.exports = {
  buildDeviceMockupSvg,
  createDeviceMockupDataUrl,
  createPremiumDatabaseWebdesignJobsCoordinator,
  diagnoseWebdesignMockupRecord,
  getDeviceMockupRendererSpec,
  isSuspectWebdesignMockupRenderer,
  trimUniformWebdesignSideGuttersDataUrl,
};
