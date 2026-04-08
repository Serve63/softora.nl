function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function buildCookieMap(req) {
  const headerValue = normalizeString(req?.headers?.cookie || '');
  const map = new Map();
  if (!headerValue) return map;

  headerValue.split(/;\s*/).forEach((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) return;
    const key = normalizeString(entry.slice(0, separatorIndex));
    if (!key) return;
    const rawValue = entry.slice(separatorIndex + 1);
    try {
      map.set(key, decodeURIComponent(rawValue));
    } catch {
      map.set(key, rawValue);
    }
  });

  return map;
}

function buildSetCookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(normalizeString(value))}`];
  const pathValue = normalizeString(options.path || '/');
  if (pathValue) parts.push(`Path=${pathValue}`);
  parts.push('HttpOnly');
  parts.push(`SameSite=${normalizeString(options.sameSite || 'Lax') || 'Lax'}`);

  if (options.secure) parts.push('Secure');

  if (Number.isFinite(Number(options.maxAgeSeconds))) {
    const maxAgeSeconds = Math.max(0, Math.floor(Number(options.maxAgeSeconds)));
    parts.push(`Max-Age=${maxAgeSeconds}`);
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
    parts.push(`Expires=${expiresAt.toUTCString()}`);
  }

  return parts.join('; ');
}

module.exports = {
  buildCookieMap,
  buildSetCookieHeader,
};
