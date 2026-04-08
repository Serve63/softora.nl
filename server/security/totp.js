const crypto = require('crypto');
const { timingSafeEqualStrings } = require('./crypto-utils');

function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function decodeBase32Secret(value, normalizeString = defaultNormalizeString) {
  const normalized = normalizeString(value)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  if (!normalized) return null;

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return bytes.length > 0 ? Buffer.from(bytes) : null;
}

function generateTotpCodeForTime(secretBuffer, timestampMs = Date.now(), digits = 6, stepSeconds = 30) {
  if (!secretBuffer || !secretBuffer.length) return '';
  const counter = Math.floor(Number(timestampMs) / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, '0');
}

function createTotpManager(options = {}) {
  const {
    secret = '',
    normalizeString = defaultNormalizeString,
    timingSafeEqual = timingSafeEqualStrings,
    getNowMs = Date.now,
    digits = 6,
    stepSeconds = 30,
  } = options;

  let secretBufferCache = undefined;

  function getSecretBuffer() {
    if (secretBufferCache !== undefined) return secretBufferCache;
    if (!secret) {
      secretBufferCache = null;
      return secretBufferCache;
    }

    const base32Decoded = decodeBase32Secret(secret, normalizeString);
    secretBufferCache =
      base32Decoded && base32Decoded.length > 0 ? base32Decoded : Buffer.from(secret, 'utf8');
    return secretBufferCache;
  }

  function isConfigured() {
    const buffer = getSecretBuffer();
    return Boolean(buffer && buffer.length > 0);
  }

  function isCodeValid(codeRaw) {
    if (!isConfigured()) return true;
    const normalizedCode = normalizeString(codeRaw).replace(/\s+/g, '');
    if (!new RegExp(`^\\d{${digits}}$`).test(normalizedCode)) return false;

    const secretBuffer = getSecretBuffer();
    const nowMs = Number(getNowMs()) || Date.now();
    for (const offset of [-1, 0, 1]) {
      const candidate = generateTotpCodeForTime(
        secretBuffer,
        nowMs + offset * stepSeconds * 1000,
        digits,
        stepSeconds
      );
      if (candidate && timingSafeEqual(candidate, normalizedCode)) {
        return true;
      }
    }
    return false;
  }

  return {
    getSecretBuffer,
    isCodeValid,
    isConfigured,
  };
}

module.exports = {
  createTotpManager,
  decodeBase32Secret,
  generateTotpCodeForTime,
};
