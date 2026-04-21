function createPremiumAuthRouteCoordinator(deps = {}) {
  const {
    sessionSecret = '',
    premiumSessionTtlHours = 12,
    premiumSessionRememberTtlDays = 30,
    premiumUsersStore,
    normalizePremiumSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
    isPremiumMfaConfigured = () => false,
    isPremiumMfaCodeValid = () => false,
    getSafePremiumRedirectPath = (value) => value,
    getResolvedPremiumAuthState = async () => ({
      configured: false,
      authenticated: false,
      revoked: false,
      email: '',
    }),
    buildPremiumAuthSessionPayload = (authState) => authState,
    isPremiumAdminIpAllowed = () => true,
    createPremiumSessionToken = () => '',
    setPremiumSessionCookie = () => {},
    clearPremiumSessionCookie = () => {},
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
  } = deps;

  function getRequestUserAgent(req) {
    return normalizeString(typeof req?.get === 'function' ? req.get('user-agent') || '' : '');
  }

  function appendAuditEvent(req, payload, reason) {
    appendSecurityAuditEvent(
      {
        ...payload,
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: getRequestUserAgent(req),
      },
      reason
    );
  }

  async function sendSessionResponse(req, res) {
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');
    if (authState.revoked) {
      clearPremiumSessionCookie(req, res);
    }
    return res.status(200).json(buildPremiumAuthSessionPayload(authState));
  }

  async function loadUsersForLogin() {
    const attempts = [{ force: false }, { force: true }];
    let lastHydrated = null;

    for (const options of attempts) {
      lastHydrated = await premiumUsersStore.ensureUsersHydrated(options);
      const hydratedUsers = Array.isArray(lastHydrated?.users) ? lastHydrated.users : [];
      const cachedUsers = premiumUsersStore.getCachedUsers();
      const users = hydratedUsers.length > 0 ? hydratedUsers : cachedUsers;
      if (users.length > 0 || lastHydrated?.source !== 'unavailable') {
        return { hydrated: lastHydrated, users };
      }
    }

    return {
      hydrated: lastHydrated,
      users: premiumUsersStore.getCachedUsers(),
    };
  }

  async function loginResponse(req, res) {
    const email = normalizePremiumSessionEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const otp = normalizeString(req.body?.otp || '').replace(/\s+/g, '');
    const remember = /^(1|true|yes|on)$/i.test(String(req.body?.remember || ''));
    const nextPath = getSafePremiumRedirectPath(req.body?.next || req.query?.next || '');

    res.setHeader('Cache-Control', 'no-store, private');

    const { hydrated, users } = await loadUsersForLogin();

    if (!sessionSecret) {
      appendAuditEvent(
        req,
        {
          type: 'login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: 'Premium login niet geconfigureerd: sessie-secret ontbreekt.',
        },
        'security_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error:
          'Premium login is nog niet volledig via Supabase geconfigureerd op de server. Zet PREMIUM_SESSION_SECRET opnieuw in de productie-omgeving.',
      });
    }

    if (users.length === 0) {
      const isTemporaryUserStoreFailure = hydrated?.source === 'unavailable';
      appendAuditEvent(
        req,
        {
          type: 'login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: isTemporaryUserStoreFailure
            ? 'Premium login tijdelijk niet beschikbaar: gebruikerslijst kon niet worden geladen.'
            : 'Premium login niet geconfigureerd: geen premium gebruikers gevonden.',
        },
        'security_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error: isTemporaryUserStoreFailure
          ? 'Premium login is tijdelijk niet beschikbaar omdat de gebruikerslijst niet kon worden geladen. Probeer het zo opnieuw.'
          : 'Premium login is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase.',
      });
    }

    if (!isPremiumAdminIpAllowed(req)) {
      appendAuditEvent(
        req,
        {
          type: 'login_ip_blocked',
          severity: 'warning',
          success: false,
          email,
          detail: 'Login geweigerd door admin IP allowlist.',
        },
        'security_login_ip_blocked'
      );
      return res.status(403).json({
        ok: false,
        error: 'Inloggen is vanaf dit IP-adres niet toegestaan.',
      });
    }

    if (!email || !password) {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'E-mailadres of wachtwoord ontbreekt.',
        },
        'security_login_failed'
      );
      return res.status(400).json({
        ok: false,
        error: 'Vul je e-mailadres en wachtwoord in.',
      });
    }

    const matchedUser = premiumUsersStore.findUserByEmail(users, email);
    const isPasswordValid = matchedUser
      ? premiumUsersStore.verifyPasswordHash(password, matchedUser.passwordHash)
      : false;
    if (!matchedUser || !isPasswordValid) {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Ongeldige inloggegevens.',
        },
        'security_login_failed'
      );
      return res.status(401).json({
        ok: false,
        error: 'Ongeldige inloggegevens.',
      });
    }

    if (premiumUsersStore.normalizeUserStatus(matchedUser.status) !== 'active') {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Inloggen geweigerd omdat het account inactief is.',
        },
        'security_login_failed'
      );
      return res.status(403).json({
        ok: false,
        error: 'Dit account is gedeactiveerd.',
      });
    }

    if (isPremiumMfaConfigured() && !isPremiumMfaCodeValid(otp)) {
      appendAuditEvent(
        req,
        {
          type: 'login_mfa_failed',
          severity: 'warning',
          success: false,
          email,
          detail: '2FA-code ongeldig of ontbreekt.',
        },
        'security_login_mfa_failed'
      );
      return res.status(401).json({
        ok: false,
        error: 'Ongeldige of ontbrekende 2FA-code.',
        mfaRequired: true,
      });
    }

    const sessionMaxAgeMs = remember
      ? premiumSessionRememberTtlDays * 24 * 60 * 60 * 1000
      : premiumSessionTtlHours * 60 * 60 * 1000;
    const sessionToken = createPremiumSessionToken({
      email,
      maxAgeMs: sessionMaxAgeMs,
      userId: matchedUser.id,
      role: matchedUser.role,
    });
    setPremiumSessionCookie(req, res, sessionToken, sessionMaxAgeMs);

    appendAuditEvent(
      req,
      {
        type: 'login_success',
        severity: 'info',
        success: true,
        email,
        detail: remember
          ? 'Premium login succesvol met verlengde sessie.'
          : 'Premium login succesvol.',
      },
      'security_login_success'
    );

    return res.status(200).json({
      ok: true,
      authenticated: true,
      role: matchedUser.role,
      next: nextPath,
    });
  }

  async function logoutResponse(req, res) {
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');
    clearPremiumSessionCookie(req, res);
    appendAuditEvent(
      req,
      {
        type: 'logout',
        severity: 'info',
        success: true,
        email: authState.email || '',
        detail: 'Premium sessie uitgelogd.',
      },
      'security_logout'
    );
    return res.status(200).json({ ok: true, authenticated: false });
  }

  return {
    loginResponse,
    logoutResponse,
    sendSessionResponse,
  };
}

module.exports = {
  createPremiumAuthRouteCoordinator,
};
