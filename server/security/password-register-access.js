const PASSWORD_REGISTER_SCOPE = 'premium_password_register';
const PASSWORD_REGISTER_PAGE = 'premium-wachtwoordenregister.html';
const PASSWORD_REGISTER_OWNER_CONFIG_CODE = 'PASSWORD_REGISTER_OWNER_NOT_CONFIGURED';
const PASSWORD_REGISTER_OWNER_REQUIRED_CODE = 'PASSWORD_REGISTER_OWNER_REQUIRED';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function parseAllowlist(value, normalizeValue, maxLength) {
  return new Set(
    String(value || '')
      .split(/[\s,;]+/)
      .map((entry) => normalizeValue(entry).slice(0, maxLength))
      .filter(Boolean)
      .slice(0, 32)
  );
}

function createPasswordRegisterOwnerPolicy(env = process.env) {
  const safeEnv = env && typeof env === 'object' ? env : {};
  const ownerUserIds = parseAllowlist(
    safeEnv.PREMIUM_PASSWORD_REGISTER_OWNER_USER_IDS,
    normalizeString,
    120
  );
  const ownerEmails = parseAllowlist(
    safeEnv.PREMIUM_PASSWORD_REGISTER_OWNER_EMAILS,
    normalizeEmail,
    180
  );
  const configured = ownerUserIds.size > 0 || ownerEmails.size > 0;

  function getAccessDecision(authState) {
    if (!configured) {
      return {
        ok: false,
        statusCode: 503,
        code: PASSWORD_REGISTER_OWNER_CONFIG_CODE,
        error: 'Wachtwoordenregister-eigenaar is niet veilig geconfigureerd op de server.',
      };
    }

    const userId = normalizeString(authState && authState.userId);
    const email = normalizeEmail(authState && authState.email);
    if ((userId && ownerUserIds.has(userId)) || (email && ownerEmails.has(email))) {
      return { ok: true };
    }

    return {
      ok: false,
      statusCode: 403,
      code: PASSWORD_REGISTER_OWNER_REQUIRED_CODE,
      error: 'Alleen de geconfigureerde eigenaar heeft toegang tot het wachtwoordenregister.',
    };
  }

  return {
    configured,
    getAccessDecision,
  };
}

function isPasswordRegisterScope(scope) {
  return normalizeString(scope).toLowerCase() === PASSWORD_REGISTER_SCOPE;
}

function isPasswordRegisterPage(fileName) {
  return normalizeString(fileName).toLowerCase() === PASSWORD_REGISTER_PAGE;
}

module.exports = {
  PASSWORD_REGISTER_OWNER_CONFIG_CODE,
  PASSWORD_REGISTER_OWNER_REQUIRED_CODE,
  PASSWORD_REGISTER_PAGE,
  PASSWORD_REGISTER_SCOPE,
  createPasswordRegisterOwnerPolicy,
  isPasswordRegisterPage,
  isPasswordRegisterScope,
};
