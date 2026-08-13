const crypto = require('crypto');
const { decodeBase32Secret, generateTotpCodeForTime } = require('./totp');
const { timingSafeEqualStrings } = require('./crypto-utils');

const MFA_CIPHER_VERSION = 'v1';
const RECOVERY_CODE_COUNT = 8;

function normalizeString(value) {
  return String(value || '').trim();
}

function encodeBase32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    output += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function normalizeRecoveryCode(value) {
  return normalizeString(value).toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function createPremiumMfaService(options = {}) {
  const {
    sessionSecret = '',
    now = Date.now,
    randomBytes = crypto.randomBytes,
  } = options;

  const encryptionKey = crypto
    .createHash('sha256')
    .update(`softora-premium-mfa-v1\0${sessionSecret}`)
    .digest();
  const recoveryPepper = crypto
    .createHmac('sha256', sessionSecret)
    .update('softora-premium-mfa-recovery-v1')
    .digest();

  function isConfigured() {
    return Boolean(normalizeString(sessionSecret));
  }

  function encryptSecret(secret) {
    if (!isConfigured()) return '';
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [MFA_CIPHER_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  function decryptSecret(encryptedSecret) {
    if (!isConfigured()) return '';
    const [version, ivRaw, tagRaw, ciphertextRaw] = normalizeString(encryptedSecret).split('.');
    if (version !== MFA_CIPHER_VERSION || !ivRaw || !tagRaw || !ciphertextRaw) return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivRaw, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return '';
    }
  }

  function hashRecoveryCode(code) {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return '';
    return crypto.createHmac('sha256', recoveryPepper).update(normalized).digest('base64url');
  }

  function createRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = encodeBase32(randomBytes(8)).slice(0, 12);
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    });
  }

  function createEnrollment(user = {}) {
    if (!isConfigured()) return null;
    const setupKey = encodeBase32(randomBytes(20));
    const recoveryCodes = createRecoveryCodes();
    const email = normalizeString(user.email).toLowerCase();
    const label = encodeURIComponent(`Softora:${email || 'account'}`);
    const issuer = encodeURIComponent('Softora');
    return {
      mfa: {
        enabled: false,
        encryptedSecret: encryptSecret(setupKey),
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        lastTotpCounter: 0,
        pendingAt: new Date(Number(now()) || Date.now()).toISOString(),
        enrolledAt: '',
      },
      setupKey,
      recoveryCodes,
      otpauthUri: `otpauth://totp/${label}?secret=${setupKey}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    };
  }

  function isEnrolled(user = {}) {
    return Boolean(user?.mfa?.enabled && decryptSecret(user?.mfa?.encryptedSecret));
  }

  function getVerifiedTotpCounter(user, code) {
    const secret = decryptSecret(user?.mfa?.encryptedSecret);
    const normalizedCode = normalizeString(code).replace(/\s+/g, '');
    const secretBuffer = decodeBase32Secret(secret);
    if (!secretBuffer || !/^\d{6}$/.test(normalizedCode)) return 0;
    const nowMs = Number(now()) || Date.now();
    const currentCounter = Math.floor(nowMs / 1000 / 30);
    const lastTotpCounter = Math.max(0, Math.floor(Number(user?.mfa?.lastTotpCounter) || 0));
    for (const offset of [-1, 0, 1]) {
      const candidateCounter = currentCounter + offset;
      if (candidateCounter <= lastTotpCounter) continue;
      const candidate = generateTotpCodeForTime(secretBuffer, candidateCounter * 30 * 1000);
      if (candidate && timingSafeEqualStrings(candidate, normalizedCode)) return candidateCounter;
    }
    return 0;
  }

  function completeEnrollment(user, code) {
    const verifiedCounter = getVerifiedTotpCounter(user, code);
    if (isEnrolled(user) || !verifiedCounter) return null;
    return {
      ...user.mfa,
      enabled: true,
      lastTotpCounter: verifiedCounter,
      pendingAt: '',
      enrolledAt: new Date(Number(now()) || Date.now()).toISOString(),
    };
  }

  function verifyLoginCode(user, code) {
    if (!isEnrolled(user)) return { ok: false, usedRecoveryCode: false, recoveryCodeHash: '', mfa: user?.mfa || null };
    const verifiedCounter = getVerifiedTotpCounter(user, code);
    if (verifiedCounter) {
      return {
        ok: true,
        usedRecoveryCode: false,
        recoveryCodeHash: '',
        mfa: { ...user.mfa, lastTotpCounter: verifiedCounter },
      };
    }

    const candidateHash = hashRecoveryCode(code);
    const hashes = Array.isArray(user?.mfa?.recoveryCodeHashes)
      ? user.mfa.recoveryCodeHashes.filter(Boolean)
      : [];
    const matchedIndex = hashes.findIndex((hash) => timingSafeEqualStrings(hash, candidateHash));
    if (matchedIndex < 0) return { ok: false, usedRecoveryCode: false, recoveryCodeHash: '', mfa: user.mfa };
    return {
      ok: true,
      usedRecoveryCode: true,
      recoveryCodeHash: candidateHash,
      mfa: {
        ...user.mfa,
        recoveryCodeHashes: hashes.filter((_, index) => index !== matchedIndex),
      },
    };
  }

  return {
    completeEnrollment,
    createEnrollment,
    decryptSecret,
    isConfigured,
    isEnrolled,
    verifyLoginCode,
  };
}

module.exports = {
  createPremiumMfaService,
  encodeBase32,
  normalizeRecoveryCode,
};
