const crypto = require('crypto');

function toBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const padded = normalized.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const suffix = remainder === 0 ? '' : '='.repeat(4 - remainder);
  return Buffer.from(`${padded}${suffix}`, 'base64').toString('utf8');
}

function createHmacSha256Base64Url(value, secret) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(String(value || ''))
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEqualStrings(left, right) {
  const leftValue = String(left || '');
  const rightValue = String(right || '');
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  createHmacSha256Base64Url,
  fromBase64Url,
  timingSafeEqualStrings,
  toBase64Url,
};
