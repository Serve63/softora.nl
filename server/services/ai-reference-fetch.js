function normalizeString(value) {
  return String(value || '').trim();
}

function isLikelyUsefulReferenceImageUrl(urlRaw) {
  const url = normalizeString(urlRaw).toLowerCase();
  if (!url) return false;
  if (/^data:|^blob:|^javascript:/i.test(url)) return false;
  if (/\.(?:svg|ico)(?:[?#].*)?$/i.test(url)) return false;
  return /^https?:\/\//i.test(url);
}

function inferWebsitePreviewReferenceFileName(urlRaw, index, mimeTypeRaw) {
  const mimeType = normalizeString(mimeTypeRaw).toLowerCase();
  const extension =
    mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  let base = '';
  try {
    const parsed = new URL(String(urlRaw || ''));
    base = normalizeString(parsed.pathname.split('/').filter(Boolean).pop())
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  } catch {
    base = '';
  }
  return `${base || `website-reference-${index + 1}`}.${extension}`;
}

function resolveHomepageScreenshotCandidateCount(options = {}) {
  const candidateCount = Math.max(0, Number(options.candidateCount) || 0);
  if (!options.isHomepageScreenshot) return candidateCount;
  const configuredCount = Number(options.configuredCount);
  if (!Number.isFinite(configuredCount)) return candidateCount;
  return Math.max(0, Math.min(candidateCount, Math.floor(configuredCount)));
}

function resolveReferenceFetchAttempts(options = {}) {
  return options.isHomepageScreenshot && options.index < options.screenshotCandidateCount ? 3 : 1;
}

function isRetryableReferenceHttpStatus(statusRaw) {
  const status = Number(statusRaw) || 0;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status !== 501);
}

module.exports = {
  inferWebsitePreviewReferenceFileName,
  isLikelyUsefulReferenceImageUrl,
  isRetryableReferenceHttpStatus,
  resolveHomepageScreenshotCandidateCount,
  resolveReferenceFetchAttempts,
};
