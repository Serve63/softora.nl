function createWebsiteInputHelpers(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  function parseImageDataUrl(rawValue) {
    const raw = normalizeString(rawValue || '').replace(/\s+/g, '');
    if (!raw) return null;
    const match = raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
    if (!match) return null;

    const mimeType = String(match[1] || '').toLowerCase();
    const base64Payload = String(match[2] || '');
    if (!base64Payload) return null;

    let sizeBytes = 0;
    try {
      sizeBytes = Buffer.from(base64Payload, 'base64').length;
    } catch {
      return null;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;

    return {
      mimeType,
      base64Payload,
      sizeBytes,
      dataUrl: `data:${mimeType};base64,${base64Payload}`,
    };
  }

  function sanitizeReferenceImages(input, options = {}) {
    const maxItems = Math.max(0, Math.min(12, Number(options.maxItems || 8) || 8));
    const maxBytesPerImage = Math.max(
      50 * 1024,
      Math.min(2 * 1024 * 1024, Number(options.maxBytesPerImage || 550 * 1024) || 550 * 1024)
    );
    const maxTotalBytes = Math.max(
      maxBytesPerImage,
      Math.min(
        8 * 1024 * 1024,
        Number(options.maxTotalBytes || 3 * 1024 * 1024) || 3 * 1024 * 1024
      )
    );

    const source = Array.isArray(input) ? input : [];
    const out = [];
    let totalBytes = 0;

    for (let i = 0; i < source.length; i += 1) {
      if (out.length >= maxItems) break;
      const item = source[i];
      if (!item || typeof item !== 'object') continue;

      const parsed = parseImageDataUrl(item.dataUrl || item.imageDataUrl || item.url || '');
      if (!parsed) continue;
      if (parsed.sizeBytes > maxBytesPerImage) continue;
      if (totalBytes + parsed.sizeBytes > maxTotalBytes) continue;

      const name =
        truncateText(normalizeString(item.name || item.fileName || `bijlage-${i + 1}`), 140) ||
        `bijlage-${i + 1}`;
      const id =
        truncateText(normalizeString(item.id || ''), 80) ||
        `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      out.push({
        id,
        name,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.sizeBytes,
        dataUrl: parsed.dataUrl,
      });
      totalBytes += parsed.sizeBytes;
    }

    return out;
  }

  function slugifyAutomationText(value, fallback = 'project') {
    const ascii = String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    const slug = ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return slug || fallback;
  }

  function sanitizeLaunchDomainName(value) {
    const raw = normalizeString(value || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim();
    if (!raw) return '';
    if (!raw.includes('.')) return '';
    if (!/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(raw)) return '';
    if (raw.includes('..')) return '';
    return raw;
  }

  return {
    parseImageDataUrl,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    slugifyAutomationText,
  };
}

module.exports = {
  createWebsiteInputHelpers,
};
