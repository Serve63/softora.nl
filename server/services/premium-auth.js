function createPremiumAuthRouteCoordinator(deps = {}) {
  const {
    sessionSecret = '',
    premiumSessionTtlHours = 12,
    premiumSessionRememberTtlDays = 7,
    premiumUsersStore,
    normalizePremiumSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
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
    premiumLoginUsersReadTimeoutMs = 450,
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
    let authState = await getResolvedPremiumAuthState(req, {
      allowAnonymousWithoutHydration: true,
      allowTokenFallbackWithoutHydration: true,
    });
    if (authState?.authenticated && authState?.tokenFallback) {
      const refreshedAuthState = await getResolvedPremiumAuthState(req, {
        allowAnonymousWithoutHydration: true,
        allowTokenFallbackWithoutHydration: false,
      });
      if (
        refreshedAuthState?.revoked ||
        refreshedAuthState?.expired ||
        (refreshedAuthState?.authenticated && refreshedAuthState?.user)
      ) {
        authState = refreshedAuthState;
      }
    }
    res.setHeader('Cache-Control', 'no-store, private');
    if (authState.revoked) {
      clearPremiumSessionCookie(req, res);
    }
    return res.status(200).json(buildPremiumAuthSessionPayload(authState));
  }

  function getLoginUsersReadTimeoutMs() {
    return Math.max(250, Math.min(900, Number(premiumLoginUsersReadTimeoutMs) || 450));
  }

  function getAuthoritativeRevision(value) {
    if (value === null || value === undefined || value === '') return null;
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  }

  async function loadUsersForLogin() {
    const hydrated = await premiumUsersStore.ensureUsersHydrated({
      force: true,
      readTimeoutMs: getLoginUsersReadTimeoutMs(),
      allowBootstrapFallback: true,
    });
    const hydratedUsers = Array.isArray(hydrated?.users) ? hydrated.users : [];
    const cachedUsers = premiumUsersStore.getCachedUsers();
    return {
      hydrated,
      users: hydratedUsers.length > 0 ? hydratedUsers : cachedUsers,
      revision: getAuthoritativeRevision(hydrated?.revision),
    };
  }

  async function recoverBootstrapLoginUser(req, users, email, password, matchedUser, expectedRevision) {
    if (!matchedUser) return null;
    if (normalizeString(matchedUser.source || '').toLowerCase() !== 'bootstrap_env') return null;
    if (typeof premiumUsersStore.findBootstrapUserByEmail !== 'function') return null;

    const bootstrapUser = premiumUsersStore.findBootstrapUserByEmail(email);
    if (!bootstrapUser) return null;
    if (!premiumUsersStore.verifyPasswordHash(password, bootstrapUser.passwordHash)) return null;

    const nowIso = new Date().toISOString();
    const nextUser = {
      ...matchedUser,
      passwordHash: bootstrapUser.passwordHash,
      updatedAt: nowIso,
    };
    const existingUsers = Array.isArray(users) ? users : [];
    const nextUsers = existingUsers.map((user) =>
      user && (user.id === matchedUser.id || user.email === matchedUser.email) ? nextUser : user
    );

    let savedUsers = nextUsers;
    if (typeof premiumUsersStore.persistUsersCollection === 'function') {
      const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
        source: 'premium_auth_bootstrap_recovery',
        reason: 'premium_login_bootstrap_password_sync',
        actorEmail: email,
        expectedRevision,
      });
      if (saved?.source !== 'supabase' || !Array.isArray(saved.users) || saved.users.length === 0) {
        return null;
      }
      savedUsers = saved.users;
    }

    appendAuditEvent(
      req,
      {
        type: 'login_bootstrap_password_recovered',
        severity: 'info',
        success: true,
        email,
        detail: 'Premium login wachtwoordhash hersteld vanuit bootstrap-env.',
      },
      'security_login_bootstrap_password_recovered'
    );

    return premiumUsersStore.findUserByEmail(savedUsers, email) || nextUser;
  }

  async function loginResponse(req, res) {
    const email = normalizePremiumSessionEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const remember = /^(1|true|yes|on)$/i.test(String(req.body?.remember || ''));
    const nextPath = getSafePremiumRedirectPath(req.body?.next || req.query?.next || '');

    res.setHeader('Cache-Control', 'no-store, private');

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

    const { hydrated, users, revision } = await loadUsersForLogin();

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

    let matchedUser = premiumUsersStore.findUserByEmail(users, email);
    let isPasswordValid = matchedUser
      ? premiumUsersStore.verifyPasswordHash(password, matchedUser.passwordHash)
      : false;
    if (!isPasswordValid) {
      const recoveredUser = await recoverBootstrapLoginUser(
        req,
        users,
        email,
        password,
        matchedUser,
        revision
      );
      if (recoveredUser) {
        matchedUser = recoveredUser;
        isPasswordValid = true;
      }
    }

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

    const sessionMaxAgeMs = remember
      ? Math.max(1, Math.min(7, Number(premiumSessionRememberTtlDays) || 7)) * 24 * 60 * 60 * 1000
      : Math.max(1, Math.min(12, Number(premiumSessionTtlHours) || 12)) * 60 * 60 * 1000;
    const sessionToken = createPremiumSessionToken({
      email,
      maxAgeMs: sessionMaxAgeMs,
      userId: matchedUser.id,
      role: matchedUser.role,
      authVersion: matchedUser.authVersion,
    });
    if (!sessionToken) {
      return res.status(503).json({ ok: false, error: 'Veilige sessie kon niet worden aangemaakt.' });
    }
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

  async function agendaAppLoginResponse(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    appendAuditEvent(
      req,
      {
        type: 'agenda_app_pin_login_disabled',
        severity: 'warning',
        success: false,
        email: '',
        detail: 'Legacy agenda-PIN-login geweigerd; gebruik e-mail en wachtwoord.',
      },
      'security_agenda_app_pin_login_disabled'
    );
    return res.status(410).json({
      ok: false,
      authenticated: false,
      error: 'Agenda-app PIN-login is uitgeschakeld. Log in met je e-mailadres en wachtwoord.',
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
    agendaAppLoginResponse,
    loginResponse,
    logoutResponse,
    sendSessionResponse,
  };
}

module.exports = {
  createPremiumAuthRouteCoordinator,
};
