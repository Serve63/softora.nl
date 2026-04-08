const dns = require('dns').promises;
const net = require('net');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeIpAddress(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const noZone = raw.replace(/%.+$/, '');
  const ipv4Mapped = noZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) return ipv4Mapped[1];
  if (noZone === '::1') return '127.0.0.1';
  return noZone;
}

function normalizeAbsoluteHttpUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.hash = '';
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = normalizedPath || '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeWebsitePreviewTargetUrl(valueRaw) {
  const rawValue = normalizeString(valueRaw);
  if (!rawValue) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
  try {
    const parsed = new URL(withProtocol);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (normalizeString(parsed.username) || normalizeString(parsed.password)) return '';
    parsed.hash = '';
    if (!parsed.pathname) parsed.pathname = '/';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isPrivateIpv4Address(valueRaw) {
  const value = normalizeIpAddress(valueRaw);
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIpv6Address(valueRaw) {
  const value = normalizeIpAddress(valueRaw).toLowerCase();
  if (!value) return false;
  if (value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe80:')) return true;
  return false;
}

function isPrivateIpAddress(valueRaw) {
  const value = normalizeIpAddress(valueRaw);
  const version = net.isIP(value);
  if (version === 4) return isPrivateIpv4Address(value);
  if (version === 6) return isPrivateIpv6Address(value);
  return false;
}

async function assertWebsitePreviewUrlIsPublic(valueRaw, options = {}) {
  const normalizedUrl = normalizeWebsitePreviewTargetUrl(valueRaw);
  if (!normalizedUrl) {
    const error = new Error('Vul een geldige website-URL in, bijvoorbeeld https://voorbeeld.nl');
    error.status = 400;
    throw error;
  }

  const parsed = new URL(normalizedUrl);
  const hostname = normalizeString(parsed.hostname).toLowerCase();
  if (!hostname) {
    const error = new Error('Kon de hostname van deze URL niet lezen.');
    error.status = 400;
    throw error;
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home')
  ) {
    const error = new Error('Lokale of interne URLs zijn niet toegestaan voor Websitegenerator.');
    error.status = 400;
    throw error;
  }

  if (net.isIP(hostname) && isPrivateIpAddress(hostname)) {
    const error = new Error('Private netwerk-IP’s zijn niet toegestaan voor Websitegenerator.');
    error.status = 400;
    throw error;
  }

  const lookup = typeof options.lookup === 'function' ? options.lookup : dns.lookup.bind(dns);

  try {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    const privateAddress = Array.isArray(resolved)
      ? resolved.find((entry) => entry && isPrivateIpAddress(entry.address))
      : null;
    if (privateAddress) {
      const error = new Error('Deze URL verwijst naar een intern netwerkadres en mag niet worden gescand.');
      error.status = 400;
      throw error;
    }
  } catch (error) {
    if (Number(error?.status)) throw error;
  }

  return normalizedUrl;
}

function getPublicBaseUrlFromRequest(req) {
  const forwardedProto = normalizeString(req?.get?.('x-forwarded-proto')).split(',')[0].trim();
  const forwardedHost = normalizeString(req?.get?.('x-forwarded-host')).split(',')[0].trim();
  const host = forwardedHost || normalizeString(req?.get?.('host'));
  const proto = forwardedProto || (req?.secure ? 'https' : 'http');
  if (!host || !proto) return '';
  return normalizeAbsoluteHttpUrl(`${proto}://${host}`);
}

function getEffectivePublicBaseUrl(req = null, overrideValue = '', defaultPublicBaseUrl = '') {
  const explicit = normalizeAbsoluteHttpUrl(overrideValue || defaultPublicBaseUrl);
  if (explicit) return explicit;
  if (req) return getPublicBaseUrlFromRequest(req);
  return '';
}

function appendQueryParamsToUrl(rawUrl, params = {}) {
  const raw = normalizeString(rawUrl);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    Object.entries(params || {}).forEach(([key, value]) => {
      const normalizedValue = normalizeString(value);
      if (!normalizeString(key) || !normalizedValue) return;
      parsed.searchParams.set(key, normalizedValue);
    });
    return parsed.toString();
  } catch {
    return raw;
  }
}

module.exports = {
  appendQueryParamsToUrl,
  assertWebsitePreviewUrlIsPublic,
  getEffectivePublicBaseUrl,
  getPublicBaseUrlFromRequest,
  isPrivateIpAddress,
  normalizeAbsoluteHttpUrl,
  normalizeWebsitePreviewTargetUrl,
};
