const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const DEVICE_MOCKUP_RENDERER = 'softora-server-device-v12';
const DEVICE_MOCKUP_FILE_VERSION = 'v12';
const DEVICE_MOCKUP_BACKGROUND_PATH = path.join(__dirname, '../../assets/webdesign-preview-stage-bg.jpg');
const DEVICE_MOCKUP_TEMPLATE_PATH = path.join(__dirname, '../../assets/webdesign-device-mockup-template-v12.jpg');
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
let cachedSharp = null;
let cachedDeviceMockupBackgroundDataUri;
let cachedDeviceMockupTemplateDataUri;

function loadSharpModule() {
  if (cachedSharp) return cachedSharp;
  cachedSharp = require('sharp');
  return cachedSharp;
}

function getDeviceMockupBackgroundDataUri() {
  if (cachedDeviceMockupBackgroundDataUri !== undefined) return cachedDeviceMockupBackgroundDataUri;
  try {
    cachedDeviceMockupBackgroundDataUri = `data:image/jpeg;base64,${fs.readFileSync(DEVICE_MOCKUP_BACKGROUND_PATH).toString('base64')}`;
  } catch (_error) {
    cachedDeviceMockupBackgroundDataUri = '';
  }
  return cachedDeviceMockupBackgroundDataUri;
}

function getDeviceMockupTemplateDataUri() {
  if (cachedDeviceMockupTemplateDataUri !== undefined) return cachedDeviceMockupTemplateDataUri;
  try {
    cachedDeviceMockupTemplateDataUri = `data:image/jpeg;base64,${fs.readFileSync(DEVICE_MOCKUP_TEMPLATE_PATH).toString('base64')}`;
  } catch (_error) {
    cachedDeviceMockupTemplateDataUri = '';
  }
  return cachedDeviceMockupTemplateDataUri;
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
    canvas: { width: 1600, height: 900 },
    template: '/assets/webdesign-device-mockup-template-v12.jpg',
    devices: [
      {
        id: 'laptop',
        points: [{ x: 224, y: 126 }, { x: 909, y: 150 }, { x: 930, y: 653 }, { x: 238, y: 631 }],
        fitMode: 'viewport-width',
        cropTopRatio: 0,
        glassOpacity: 0.12,
      },
      {
        id: 'tablet',
        points: [{ x: 1028, y: 174 }, { x: 1282, y: 183 }, { x: 1293, y: 641 }, { x: 1041, y: 637 }],
        fitMode: 'viewport-width',
        cropTopRatio: 0,
        glassOpacity: 0.14,
      },
      {
        id: 'phone',
        points: [{ x: 1374, y: 351 }, { x: 1508, y: 360 }, { x: 1518, y: 646 }, { x: 1385, y: 644 }],
        fitMode: 'viewport-width',
        cropTopRatio: 0,
        glassOpacity: 0.16,
      },
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

function getPointDistance(first, second) {
  return Math.hypot((Number(second.x) || 0) - (Number(first.x) || 0), (Number(second.y) || 0) - (Number(first.y) || 0));
}

function getDeviceScreenTarget(device) {
  const points = Array.isArray(device.points) ? device.points : [];
  const topLeft = points[0] || { x: 0, y: 0 };
  const topRight = points[1] || { x: 1, y: 0 };
  const bottomLeft = points[3] || { x: 0, y: 1 };
  return {
    width: Math.max(1, getPointDistance(topLeft, topRight)),
    height: Math.max(1, getPointDistance(topLeft, bottomLeft)),
  };
}

function getDeviceScreenMatrix(device, target) {
  const points = Array.isArray(device.points) ? device.points : [];
  const topLeft = points[0] || { x: 0, y: 0 };
  const topRight = points[1] || { x: target.width, y: 0 };
  const bottomLeft = points[3] || { x: 0, y: target.height };
  return {
    a: ((Number(topRight.x) || 0) - (Number(topLeft.x) || 0)) / target.width,
    b: ((Number(topRight.y) || 0) - (Number(topLeft.y) || 0)) / target.width,
    c: ((Number(bottomLeft.x) || 0) - (Number(topLeft.x) || 0)) / target.height,
    d: ((Number(bottomLeft.y) || 0) - (Number(topLeft.y) || 0)) / target.height,
    e: Number(topLeft.x) || 0,
    f: Number(topLeft.y) || 0,
  };
}

function formatDevicePoints(device) {
  return (Array.isArray(device.points) ? device.points : [])
    .map((point) => `${Number(point.x) || 0},${Number(point.y) || 0}`)
    .join(' ');
}

function renderTemplateDeviceImageSvg(device, sourceSize, embeddedImage) {
  const target = getDeviceScreenTarget(device);
  const matrix = getDeviceScreenMatrix(device, target);
  const screen = { width: target.width, height: target.height };
  const sourceWidth = Math.max(1, normalizeFiniteNumber(sourceSize.width, 1));
  const sourceHeight = Math.max(1, normalizeFiniteNumber(sourceSize.height, 1));
  let crop;
  if (device.fitMode === 'viewport-width') {
    const scale = screen.width / sourceWidth;
    const visibleSourceHeight = Math.min(sourceHeight, Math.max(1, screen.height / scale));
    const cropTopRatio = clampNumber(normalizeFiniteNumber(device.cropTopRatio, 0), 0, 1);
    crop = {
      sx: 0,
      sy: clampNumber((sourceHeight - visibleSourceHeight) * cropTopRatio, 0, Math.max(0, sourceHeight - visibleSourceHeight)),
      sw: sourceWidth,
      sh: visibleSourceHeight,
    };
  } else {
    crop = resolveViewportCrop(sourceSize, screen, device);
    crop = { sx: crop.sx, sy: crop.sy, sw: crop.sw, sh: crop.sh };
  }
  return `
      <g clip-path="url(#${device.id}Screen)">
        <g transform="matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})">
          <svg x="0" y="0" width="${target.width}" height="${target.height}" viewBox="${crop.sx} ${crop.sy} ${crop.sw} ${crop.sh}" preserveAspectRatio="none" overflow="hidden">
            <image href="${embeddedImage}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}"/>
          </svg>
        </g>
        <polygon points="${formatDevicePoints(device)}" fill="#000000" opacity="${device.glassOpacity || 0.12}"/>
        <polygon points="${formatDevicePoints(device)}" fill="url(#screenSheenGradient)" opacity="0.2"/>
      </g>`;
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
  const base = device.baseStyle === 'modern-laptop'
    ? renderModernLaptopBaseSvg(device)
    : (device.base ? `<rect x="${device.baseX}" y="${device.baseY}" width="${device.baseW}" height="${device.baseH}" rx="16" fill="${device.base}"/>` : '');
  const filter = device.id === 'laptop' ? 'shadow' : 'softShadow';
  return `
      <g filter="url(#${filter})">
        <rect x="${device.x}" y="${device.y}" width="${device.w}" height="${device.h}" rx="${device.radius}" fill="${device.frame}" stroke="${device.edge || device.frame}" stroke-width="${device.id === 'laptop' ? 3 : 0}"/>
        <rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="${screen.radius}" fill="#ffffff"/>
        ${renderDeviceImageSvg(device, sourceSize, embeddedImage)}
        ${base}
        ${notch}
      </g>`;
}

function renderModernLaptopBaseSvg(device) {
  const hingeY = device.y + device.h - 15;
  const deckTopY = device.baseY;
  const deckBottomY = device.baseY + device.baseH;
  const left = device.baseX;
  const right = device.baseX + device.baseW;
  const topLeft = device.x + 64;
  const topRight = device.x + device.w - 64;
  const bottomLeft = left + 24;
  const bottomRight = right - 24;
  const keyboardRows = [
    { y: deckTopY + 42, count: 14, keyW: 38, gap: 9, h: 12 },
    { y: deckTopY + 66, count: 13, keyW: 41, gap: 10, h: 13 },
    { y: deckTopY + 92, count: 12, keyW: 45, gap: 10, h: 14 },
    { y: deckTopY + 120, count: 10, keyW: 53, gap: 12, h: 15 },
  ];
  const keyboardSvg = keyboardRows.map((row) => {
    const rowW = row.count * row.keyW + (row.count - 1) * row.gap;
    const rowX = left + (device.baseW - rowW) / 2;
    return Array.from({ length: row.count }, (_item, index) => (
      `<rect x="${rowX + index * (row.keyW + row.gap)}" y="${row.y}" width="${row.keyW}" height="${row.h}" rx="4" fill="#94a3b8" fill-opacity="0.32" stroke="#ffffff" stroke-opacity="0.20" stroke-width="1"/>`
    )).join('');
  }).join('');
  return `
        <rect x="${device.x + 82}" y="${hingeY}" width="${device.w - 164}" height="22" rx="11" fill="url(#laptopHingeGradient)" opacity="0.96"/>
        <path d="M ${topLeft} ${deckTopY} L ${topRight} ${deckTopY} L ${bottomRight} ${deckBottomY} L ${bottomLeft} ${deckBottomY} Z" fill="url(#laptopBaseGradient)"/>
        <path d="M ${left + 86} ${deckTopY + 5} L ${right - 86} ${deckTopY + 5}" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3" stroke-linecap="round"/>
        <path d="M ${left + 20} ${deckBottomY - 18} L ${right - 20} ${deckBottomY - 18}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="3" stroke-linecap="round"/>
        ${keyboardSvg}
        <rect x="${left + device.baseW * 0.39}" y="${deckBottomY - 72}" width="${device.baseW * 0.22}" height="48" rx="10" fill="#080d17" fill-opacity="0.66" stroke="#94a3b8" stroke-opacity="0.42" stroke-width="2"/>
        <rect x="${left + device.baseW * 0.43}" y="${deckBottomY - 18}" width="${device.baseW * 0.14}" height="7" rx="4" fill="#94a3b8" opacity="0.24"/>`;
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
  const templateDataUri = getDeviceMockupTemplateDataUri();
  const backgroundDataUri = getDeviceMockupBackgroundDataUri();
  return `
    <svg width="1600" height="900" viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${spec.devices.map((device) => `<clipPath id="${device.id}Screen" clipPathUnits="userSpaceOnUse"><polygon points="${formatDevicePoints(device)}"/></clipPath>`).join('')}
        <linearGradient id="backgroundGradient" x1="0" y1="0" x2="1600" y2="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#f7f3ec"/>
          <stop offset="0.52" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#dfe8ee"/>
        </linearGradient>
        <linearGradient id="screenSheenGradient" x1="220" y1="120" x2="930" y2="650" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.24"/>
          <stop offset="0.36" stop-color="#ffffff" stop-opacity="0.02"/>
          <stop offset="0.72" stop-color="#000000" stop-opacity="0.10"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0.10"/>
        </linearGradient>
      </defs>
      ${templateDataUri
        ? `<image href="${templateDataUri}" x="0" y="0" width="1600" height="900" preserveAspectRatio="xMidYMid slice"/>`
        : (backgroundDataUri
          ? `<image href="${backgroundDataUri}" x="0" y="0" width="1600" height="900" preserveAspectRatio="xMidYMid slice"/>`
          : `<rect width="1600" height="900" fill="url(#backgroundGradient)"/>`)}
      ${spec.devices.map((device) => renderTemplateDeviceImageSvg(device, sourceSize, embeddedImage)).join('')}
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

  function createRetryablePhotoStorageError(message, cause) {
    const error = new Error(message);
    error.status = 503;
    error.retryableWebdesignStorage = true;
    if (cause) error.cause = cause;
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
              `[PremiumDatabaseWebdesignJobs][retry] ${job.id} wacht ${Math.round(retryDelayMs / 1000)}s na tijdelijke webdesign-fout`
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
  buildDeviceMockupSvg,
  createDeviceMockupDataUrl,
  createPremiumDatabaseWebdesignJobsCoordinator,
  diagnoseWebdesignMockupRecord,
  getDeviceMockupRendererSpec,
  isSuspectWebdesignMockupRenderer,
  trimUniformWebdesignSideGuttersDataUrl,
};
