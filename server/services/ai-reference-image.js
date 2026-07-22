let cachedSharp;

function loadSharp() {
  if (cachedSharp !== undefined) return cachedSharp;
  try {
    cachedSharp = require('sharp');
  } catch (_error) {
    cachedSharp = null;
  }
  return cachedSharp;
}

async function normalizeWebsitePreviewReferenceImage(options = {}) {
  const bytes = Buffer.isBuffer(options.bytes) ? options.bytes : null;
  const contentType = String(options.contentType || '').trim().toLowerCase().split(';')[0];
  const maxBytes = Math.max(1024, Number(options.maxBytes) || 2 * 1024 * 1024);
  const maxInputBytes = Math.max(maxBytes, Number(options.maxInputBytes) || 12 * 1024 * 1024);
  if (!bytes || bytes.length < 1024 || !/^image\/(?:png|jpeg|webp)$/.test(contentType)) return null;
  if (bytes.length <= maxBytes) return { bytes, contentType };
  if (bytes.length > maxInputBytes) return null;

  const sharp = loadSharp();
  if (typeof sharp !== 'function') return null;
  const profiles = [
    { width: 1200, height: 1600, quality: 80 },
    { width: 1000, height: 1400, quality: 68 },
  ];
  for (const profile of profiles) {
    try {
      const normalizedBytes = await sharp(bytes, { limitInputPixels: 45_000_000 })
        .rotate()
        .resize({
          width: profile.width,
          height: profile.height,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: profile.quality, mozjpeg: true })
        .toBuffer();
      if (normalizedBytes.length >= 1024 && normalizedBytes.length <= maxBytes) {
        return { bytes: normalizedBytes, contentType: 'image/jpeg' };
      }
    } catch (_error) {
      return null;
    }
  }
  return null;
}

module.exports = {
  normalizeWebsitePreviewReferenceImage,
};
