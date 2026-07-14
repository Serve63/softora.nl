const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeWebsiteUrl(value) {
  const input = normalizeString(value);
  if (!input) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch (_error) {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
    parsed.port = '';
  }
  if (!parsed.pathname) parsed.pathname = '/';
  return parsed.toString();
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return Boolean(mappedIpv4 && isPrivateIpv4(mappedIpv4[1]));
}

function isPrivateAddress(address) {
  const version = net.isIP(normalizeString(address));
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

function assertSafeHostname(hostname) {
  const normalized = normalizeString(hostname).toLowerCase().replace(/\.$/, '');
  if (!normalized || BLOCKED_HOSTNAMES.has(normalized)) throw new Error('Onveilige websitehost geblokkeerd.');
  if (!normalized.includes('.') && !net.isIP(normalized)) throw new Error('Interne websitehost geblokkeerd.');
  if (normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    throw new Error('Interne websitehost geblokkeerd.');
  }
  if (/^metadata(?:\.|$)/.test(normalized)) throw new Error('Metadata-endpoint geblokkeerd.');
  return normalized;
}

async function resolvePublicAddresses(hostname, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const normalized = assertSafeHostname(hostname);
  if (net.isIP(normalized)) {
    if (isPrivateAddress(normalized)) throw new Error('Privé-netwerkadres geblokkeerd.');
    return [normalized];
  }
  const resolved = await lookup(normalized, { all: true, verbatim: true });
  const addresses = (Array.isArray(resolved) ? resolved : [resolved]).map((entry) => entry && entry.address).filter(Boolean);
  if (!addresses.length) throw new Error('Websitehost kon niet veilig worden opgezocht.');
  if (addresses.some(isPrivateAddress)) throw new Error('Websitehost verwijst naar een privé-netwerkadres.');
  return addresses;
}

async function validatePublicWebsiteUrl(value, options = {}) {
  const normalizedUrl = normalizeWebsiteUrl(value);
  if (!normalizedUrl) throw new Error('Geen geldige http- of https-website.');
  const parsed = new URL(normalizedUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Onveilig websiteprotocol geblokkeerd.');
  assertSafeHostname(parsed.hostname);
  await resolvePublicAddresses(parsed.hostname, options);
  return normalizedUrl;
}

function createSafeNavigationGuard(options = {}) {
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects) || 5));
  const validate = options.validate || validatePublicWebsiteUrl;
  let mainFrameNavigationCount = 0;
  return async function guardRoute(route) {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== request.frame().page().mainFrame()) {
      return route.continue();
    }
    mainFrameNavigationCount += 1;
    if (mainFrameNavigationCount > maxRedirects + 1) return route.abort('blockedbyclient');
    try {
      await validate(request.url());
      return route.continue();
    } catch (_error) {
      return route.abort('blockedbyclient');
    }
  };
}

module.exports = {
  assertSafeHostname,
  createSafeNavigationGuard,
  isPrivateAddress,
  normalizeWebsiteUrl,
  resolvePublicAddresses,
  validatePublicWebsiteUrl,
};
