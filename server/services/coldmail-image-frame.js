const FRAME_CROP_MIN_SIZE = 80;
const FRAME_CROP_MAX_MARGIN_RATIO = 0.12;
const FRAME_CROP_THRESHOLD = 12;
const FRAME_CORNER_TOLERANCE = 32;
const FRAME_EDGE_INSET_PX = 4;
const EMAIL_IMAGE_JPEG_QUALITY = 82;

let cachedSharp = null;

function loadSharp() {
  if (cachedSharp) return cachedSharp;
  try {
    cachedSharp = require('sharp');
  } catch (_error) {
    cachedSharp = null;
  }
  return cachedSharp;
}

function normalizeString(value) {
  return String(value || '').trim();
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

function colorDistance(a, b) {
  if (!a || !b) return Infinity;
  const red = Number(a.r) - Number(b.r);
  const green = Number(a.g) - Number(b.g);
  const blue = Number(a.b) - Number(b.b);
  return Math.sqrt(red * red + green * green + blue * blue);
}

function averageColors(colors) {
  const valid = colors.filter(Boolean);
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
  const colors = [];
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  for (let y = startY; y < Math.min(height, startY + sampleSize); y += 1) {
    for (let x = startX; x < Math.min(width, startX + sampleSize); x += 1) {
      colors.push(getPixelColor(data, info, x, y));
    }
  }
  return averageColors(colors);
}

function getUniformCornerBackground(data, info) {
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
  const cornersMatch = corners.every((corner) => colorDistance(corner, background) <= FRAME_CORNER_TOLERANCE);
  return cornersMatch ? background : null;
}

function findNonBackgroundBounds(data, info, background) {
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = getPixelColor(data, info, x, y);
      if (colorDistance(color, background) <= FRAME_CROP_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function getSafeDecorativeFrameCrop(bounds, width, height) {
  if (!bounds || width <= 0 || height <= 0) return null;
  const left = Math.max(0, Number(bounds.left) || 0);
  const top = Math.max(0, Number(bounds.top) || 0);
  const rightMargin = Math.max(0, width - 1 - (Number(bounds.right) || 0));
  const bottomMargin = Math.max(0, height - 1 - (Number(bounds.bottom) || 0));
  const maxXMargin = Math.floor(width * FRAME_CROP_MAX_MARGIN_RATIO);
  const maxYMargin = Math.floor(height * FRAME_CROP_MAX_MARGIN_RATIO);
  if (left < 2 && top < 2 && rightMargin < 2 && bottomMargin < 2) return null;
  if (left > maxXMargin || rightMargin > maxXMargin || top > maxYMargin || bottomMargin > maxYMargin) {
    return null;
  }
  const cropWidth = width - left - rightMargin;
  const cropHeight = height - top - bottomMargin;
  if (cropWidth < width * 0.6 || cropHeight < height * 0.6) return null;
  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

function insetCrop(crop, imageWidth, imageHeight) {
  const inset = imageWidth >= 320 && imageHeight >= 240 ? FRAME_EDGE_INSET_PX : 0;
  const base = crop || { left: 0, top: 0, width: imageWidth, height: imageHeight };
  if (!inset) return base;
  const left = Math.min(imageWidth - 1, Math.max(0, base.left + inset));
  const top = Math.min(imageHeight - 1, Math.max(0, base.top + inset));
  const right = Math.min(imageWidth, Math.max(left + 1, base.left + base.width - inset));
  const bottom = Math.min(imageHeight, Math.max(top + 1, base.top + base.height - inset));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function removeDecorativeWebdesignFrameForEmail(image) {
  const contentType = normalizeString(image && image.contentType).split(';')[0].toLowerCase();
  const content = image && image.content;
  if (!Buffer.isBuffer(content) || !/^image\/(?:png|jpe?g|webp)$/i.test(contentType)) return image;
  try {
    const sharp = loadSharp();
    if (typeof sharp !== 'function') return image;
    const raster = await sharp(content, { limitInputPixels: 45_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = Number(raster && raster.info && raster.info.width) || 0;
    const height = Number(raster && raster.info && raster.info.height) || 0;
    if (width < FRAME_CROP_MIN_SIZE || height < FRAME_CROP_MIN_SIZE) return image;
    const background = getUniformCornerBackground(raster.data, raster.info);
    const bounds = background ? findNonBackgroundBounds(raster.data, raster.info, background) : null;
    const crop = insetCrop(getSafeDecorativeFrameCrop(bounds, width, height), width, height);
    if (crop.left === 0 && crop.top === 0 && crop.width === width && crop.height === height) return image;
    const cropped = await sharp(content, { limitInputPixels: 45_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .extract(crop)
      .jpeg({
        quality: EMAIL_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    if (!Buffer.isBuffer(cropped) || !cropped.length) return image;
    return {
      ...image,
      content: cropped,
      contentType: 'image/jpeg',
    };
  } catch (_error) {
    return image;
  }
}

module.exports = {
  removeDecorativeWebdesignFrameForEmail,
};
