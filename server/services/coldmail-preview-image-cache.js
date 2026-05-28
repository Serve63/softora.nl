const DEFAULT_PREVIEW_IMAGE_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_PREVIEW_IMAGE_CACHE_LIMIT = 800;

const previewImageCache = new Map();

function normalizeString(value) {
  return String(value || '').trim();
}

function getPreviewImageCacheKey(token, type = '') {
  const cleanToken = normalizeString(token);
  if (!cleanToken) return '';
  return `${cleanToken}|${normalizeString(type).toLowerCase()}`;
}

function getCachedPreviewImage(cacheKey, options = {}) {
  const cleanKey = normalizeString(cacheKey);
  if (!cleanKey) return null;
  const entry = previewImageCache.get(cleanKey);
  if (!entry) return null;
  const ttlMs = Math.max(1, Number(options.ttlMs) || DEFAULT_PREVIEW_IMAGE_CACHE_TTL_MS);
  if (Date.now() - entry.cachedAt > ttlMs) {
    previewImageCache.delete(cleanKey);
    return null;
  }
  previewImageCache.delete(cleanKey);
  previewImageCache.set(cleanKey, entry);
  return {
    ...entry.image,
    content: Buffer.from(entry.image.content),
  };
}

function rememberPreviewImage(cacheKey, image, options = {}) {
  const cleanKey = normalizeString(cacheKey);
  if (!cleanKey || !image || !Buffer.isBuffer(image.content)) return false;
  previewImageCache.set(cleanKey, {
    cachedAt: Date.now(),
    image: {
      ...image,
      content: Buffer.from(image.content),
    },
  });
  const limit = Math.max(1, Number(options.limit) || DEFAULT_PREVIEW_IMAGE_CACHE_LIMIT);
  while (previewImageCache.size > limit) {
    const oldestKey = previewImageCache.keys().next().value;
    previewImageCache.delete(oldestKey);
  }
  return true;
}

function clearPreviewImageCache() {
  previewImageCache.clear();
}

function getPreviewImageCacheSize() {
  return previewImageCache.size;
}

module.exports = {
  clearPreviewImageCache,
  getCachedPreviewImage,
  getPreviewImageCacheKey,
  getPreviewImageCacheSize,
  rememberPreviewImage,
};
