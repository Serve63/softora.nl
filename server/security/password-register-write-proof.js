const crypto = require('crypto');
const {
  createHmacSha256Base64Url,
  fromBase64Url,
  timingSafeEqualStrings,
  toBase64Url,
} = require('./crypto-utils');
const {
  PASSWORD_REGISTER_SCOPE,
  createPasswordRegisterOwnerPolicy,
} = require('./password-register-access');
const VAULT_PROOF_SCOPE = 'password-register';
const VAULT_PROOF_DOMAIN = 'softora:password-register-write-proof:v1';
const PASSWORD_REGISTER_PROOF_MAX_TTL_MS = 5 * 60 * 1000;
const PASSWORD_REGISTER_PROOF_CLOCK_SKEW_MS = 5 * 1000;

function sessionFingerprint(token, sessionSecret) {
  return createHmacSha256Base64Url(
    `${VAULT_PROOF_DOMAIN}:session.${String(token || '')}`,
    sessionSecret
  );
}

function createPasswordRegisterWriteProofManager(options = {}) {
  const sessionSecret = String(options.sessionSecret || '');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const ttlMs = Math.min(
    PASSWORD_REGISTER_PROOF_MAX_TTL_MS,
    Math.max(60_000, Number(options.ttlMs) || PASSWORD_REGISTER_PROOF_MAX_TTL_MS)
  );

  function sign(encodedPayload) {
    return createHmacSha256Base64Url(
      `${VAULT_PROOF_DOMAIN}.${encodedPayload}`,
      sessionSecret
    );
  }

  function getBoundAuth(authState) {
    const currentMs = Number(now()) || Date.now();
    const userId = String(authState?.userId || '').trim();
    const email = String(authState?.email || '').trim().toLowerCase();
    const token = String(authState?.token || '').trim();
    const sessionExpiresAt = Number(authState?.expiresAt || 0);
    if (
      !sessionSecret ||
      !authState?.authenticated ||
      !authState?.freshUserValidated ||
      !authState?.user ||
      !userId ||
      !email ||
      !token ||
      !Number.isFinite(sessionExpiresAt) ||
      sessionExpiresAt <= currentMs
    ) {
      return null;
    }
    return { currentMs, userId, email, token, sessionExpiresAt };
  }

  function mint(authState) {
    const bound = getBoundAuth(authState);
    if (!bound) return { ok: false, code: 'PASSWORD_REGISTER_WRITE_PROOF_UNAVAILABLE' };
    const expiresAt = Math.min(bound.currentMs + ttlMs, bound.sessionExpiresAt);
    const payload = {
      v: 1,
      scope: VAULT_PROOF_SCOPE,
      uid: bound.userId,
      email: bound.email,
      sid: sessionFingerprint(bound.token, sessionSecret),
      iat: bound.currentMs,
      exp: expiresAt,
      nonce: Buffer.from(randomBytes(16)).toString('base64url'),
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    return {
      ok: true,
      writeProof: `v1.${encodedPayload}.${sign(encodedPayload)}`,
      writeProofExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  function verify(writeProof, authState) {
    const bound = getBoundAuth(authState);
    const token = String(writeProof || '').trim();
    if (!bound || token.length < 32 || token.length > 4096) return { ok: false };
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      parts[0] !== 'v1' ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
    ) return { ok: false };
    if (!timingSafeEqualStrings(parts[2], sign(parts[1]))) return { ok: false };
    try {
      const payload = JSON.parse(fromBase64Url(parts[1]));
      const issuedAt = Number(payload?.iat);
      const expiresAt = Number(payload?.exp);
      const exactPayloadKeys = Object.keys(payload || {}).sort().join(',') ===
        'email,exp,iat,nonce,scope,sid,uid,v';
      const validShape =
        exactPayloadKeys &&
        payload?.v === 1 &&
        payload?.scope === VAULT_PROOF_SCOPE &&
        typeof payload?.nonce === 'string' &&
        /^[A-Za-z0-9_-]{22}$/.test(payload.nonce) &&
        Number.isSafeInteger(issuedAt) &&
        Number.isSafeInteger(expiresAt);
      const validTime =
        issuedAt <= bound.currentMs + PASSWORD_REGISTER_PROOF_CLOCK_SKEW_MS &&
        expiresAt > issuedAt &&
        expiresAt > bound.currentMs &&
        expiresAt <= issuedAt + PASSWORD_REGISTER_PROOF_MAX_TTL_MS &&
        expiresAt <= bound.sessionExpiresAt;
      const validIdentity =
        payload?.uid === bound.userId &&
        payload?.email === bound.email &&
        timingSafeEqualStrings(payload?.sid, sessionFingerprint(bound.token, sessionSecret));
      return validShape && validTime && validIdentity
        ? { ok: true, expiresAt }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  return { mint, verify };
}

function createPasswordRegisterWriteProofGuard(options = {}) {
  const manager = options.manager || createPasswordRegisterWriteProofManager(options);
  const ownerPolicy = options.ownerPolicy || createPasswordRegisterOwnerPolicy();
  const appendSecurityAuditEvent = typeof options.appendSecurityAuditEvent === 'function'
    ? options.appendSecurityAuditEvent
    : () => {};

  function audit(req, type, success, detail) {
    appendSecurityAuditEvent({
      type,
      severity: success ? 'info' : 'warning',
      success,
      email: String(req?.premiumAuth?.email || '').trim(),
      ip: String(req?.ip || req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim(),
      path: String(req?.originalUrl || req?.url || '').trim(),
      origin: String(req?.headers?.origin || '').trim(),
      userAgent: typeof req?.get === 'function' ? req.get('user-agent') : '',
      detail,
    }, `security_${type}`);
  }

  function verifyRequestProof(req, res, next, auditAction) {
    const ownerDecision = ownerPolicy.getAccessDecision(req.premiumAuth);
    const verified = ownerDecision.ok && manager.verify(req?.body?.writeProof, req.premiumAuth).ok;
    if (!verified) {
      audit(req, `password_register_${auditAction}_proof_rejected`, false, 'Scopegebonden proof geweigerd.');
      return res.status(ownerDecision.ok ? 403 : ownerDecision.statusCode).json({
        ok: false,
        code: ownerDecision.ok ? 'PASSWORD_REGISTER_PROOF_INVALID' : ownerDecision.code,
        error: ownerDecision.ok
          ? 'Wachtwoordenregister-bevestiging is ongeldig of verlopen.'
          : ownerDecision.error,
      });
    }
    audit(req, `password_register_${auditAction}_proof_verified`, true, 'Scopegebonden proof bevestigd.');
    return next();
  }

  function requirePasswordRegisterWriteProof(req, res, next) {
    const scope = String(req?.params?.scope || req?.query?.scope || '').trim().toLowerCase();
    if (scope !== PASSWORD_REGISTER_SCOPE) return next();
    return verifyRequestProof(req, res, next, 'write');
  }

  function requirePasswordRegisterAccessProof(req, res, next) {
    const scope = String(req?.query?.scope || '').trim().toLowerCase();
    if (scope !== PASSWORD_REGISTER_SCOPE) {
      return res.status(400).json({
        ok: false,
        code: 'PASSWORD_REGISTER_SCOPE_REQUIRED',
        error: 'Deze beveiligde read-route is uitsluitend voor het wachtwoordenregister.',
      });
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).sort().join(',') !== 'writeProof') {
      return res.status(400).json({
        ok: false,
        code: 'PASSWORD_REGISTER_READ_BODY_INVALID',
        error: 'Beveiligde wachtwoordenregister-read heeft een ongeldige body.',
      });
    }
    return verifyRequestProof(req, res, next, 'access');
  }

  return {
    manager,
    requirePasswordRegisterAccessProof,
    requirePasswordRegisterWriteProof,
  };
}

module.exports = {
  PASSWORD_REGISTER_PROOF_CLOCK_SKEW_MS,
  PASSWORD_REGISTER_PROOF_MAX_TTL_MS,
  PASSWORD_REGISTER_PROOF_SCOPE: VAULT_PROOF_SCOPE,
  createPasswordRegisterWriteProofGuard,
  createPasswordRegisterWriteProofManager,
};
