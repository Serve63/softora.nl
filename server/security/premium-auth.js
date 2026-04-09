const PREMIUM_PUBLIC_API_EXACT_MATCHES = new Set([
  '/api/healthz',
  '/api/health/baseline',
  '/api/health/dependencies',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/twilio/voice',
  '/api/twilio/status',
  '/api/retell/webhook',
]);

function createPremiumAuthStateManager(options = {}) {
  const {
    sessionSecret = '',
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value) => String(value || '').trim(),
    normalizeSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    readSessionTokenFromRequest = () => '',
    verifySessionToken = () => ({ ok: false, expired: false, payload: null }),
    premiumUsersStore,
    isPremiumMfaConfigured = () => false,
    getRequestPathname = () => '/',
  } = options;

  function getPremiumAuthState(req) {
    const configured = Boolean(sessionSecret);
    if (!configured) {
      return {
        configured: false,
        authenticated: false,
        expired: false,
        email: '',
        userId: '',
        role: '',
        expiresAt: null,
        token: '',
      };
    }

    const token = readSessionTokenFromRequest(req);
    const verification = verifySessionToken(token);
    return {
      configured: true,
      authenticated: Boolean(verification.ok),
      expired: Boolean(verification.expired),
      email: normalizeSessionEmail(verification?.payload?.email || ''),
      userId: truncateText(normalizeString(verification?.payload?.uid || ''), 120),
      role: truncateText(normalizeString(verification?.payload?.role || ''), 40).toLowerCase(),
      expiresAt: Number(verification?.payload?.exp || 0) || null,
      token,
    };
  }

  async function getResolvedPremiumAuthState(req) {
    const basicAuthState = getPremiumAuthState(req);
    const hydrated = await premiumUsersStore.ensureUsersHydrated();
    const users = Array.isArray(hydrated?.users) ? hydrated.users : premiumUsersStore.getCachedUsers();
    const configured = Boolean(sessionSecret && hydrated?.source === 'supabase' && users.length > 0);

    if (!configured) {
      return {
        ...basicAuthState,
        configured: false,
        authenticated: false,
        expired: false,
        userId: '',
        role: '',
        isAdmin: false,
        revoked: false,
        user: null,
        displayName: '',
      };
    }

    if (!basicAuthState.authenticated) {
      return {
        ...basicAuthState,
        configured: true,
        authenticated: false,
        userId: '',
        role: '',
        isAdmin: false,
        revoked: false,
        user: null,
        displayName: '',
      };
    }

    const user =
      premiumUsersStore.findUserById(users, basicAuthState.userId) ||
      premiumUsersStore.findUserByEmail(users, basicAuthState.email);

    if (!user || premiumUsersStore.normalizeUserStatus(user.status) !== 'active') {
      return {
        ...basicAuthState,
        configured: true,
        authenticated: false,
        role: '',
        isAdmin: false,
        revoked: true,
        user: null,
        displayName: '',
      };
    }

    return {
      ...basicAuthState,
      configured: true,
      authenticated: true,
      email: user.email,
      userId: user.id,
      role: user.role,
      isAdmin: premiumUsersStore.isAdminRole(user.role),
      revoked: false,
      user,
      displayName: premiumUsersStore.buildUserDisplayName(user),
      firstName: normalizeString(user.firstName || ''),
      lastName: normalizeString(user.lastName || ''),
      avatarDataUrl: premiumUsersStore.sanitizeAvatarDataUrl(user.avatarDataUrl || ''),
    };
  }

  function buildPremiumAuthSessionPayload(authState) {
    return {
      ok: true,
      configured: authState.configured,
      authenticated: authState.authenticated,
      mfaEnabled: isPremiumMfaConfigured(),
      email: authState.authenticated ? authState.email : '',
      userId: authState.authenticated ? authState.userId : '',
      role: authState.authenticated ? authState.role : '',
      firstName: authState.authenticated
        ? normalizeString(authState.firstName || authState.user?.firstName || '')
        : '',
      lastName: authState.authenticated
        ? normalizeString(authState.lastName || authState.user?.lastName || '')
        : '',
      displayName: authState.authenticated ? authState.displayName : '',
      avatarDataUrl: authState.authenticated
        ? premiumUsersStore.sanitizeAvatarDataUrl(authState.avatarDataUrl || authState.user?.avatarDataUrl || '')
        : '',
      canManageUsers: Boolean(authState.authenticated && authState.isAdmin),
      expiresAt: authState.authenticated ? authState.expiresAt : null,
    };
  }

  function getSafePremiumRedirectPath(rawTarget, fallback = '/premium-personeel-dashboard') {
    const target = normalizeString(rawTarget);
    if (!target) return fallback;
    if (!target.startsWith('/')) return fallback;
    if (target.startsWith('//')) return fallback;
    if (target.includes('://')) return fallback;
    return target;
  }

  function isPremiumPublicApiRequest(req) {
    const method = normalizeString(req?.method || 'GET').toUpperCase();
    const requestPath = normalizeString(getRequestPathname(req) || '');
    if (!requestPath.startsWith('/')) return false;

    if (PREMIUM_PUBLIC_API_EXACT_MATCHES.has(requestPath)) return true;
    if (requestPath === '/api/twilio/voice' && (method === 'GET' || method === 'POST')) return true;
    return false;
  }

  return {
    buildPremiumAuthSessionPayload,
    getPremiumAuthState,
    getResolvedPremiumAuthState,
    getSafePremiumRedirectPath,
    isPremiumPublicApiRequest,
  };
}

function createPremiumApiAccessGuard(options = {}) {
  const {
    isPremiumPublicApiRequest = () => false,
    getResolvedPremiumAuthState = async () => ({
      configured: false,
      authenticated: false,
      expired: false,
      revoked: false,
      email: '',
    }),
    isPremiumAdminIpAllowed = () => true,
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
    clearPremiumSessionCookie = () => {},
  } = options;

  async function requirePremiumApiAccess(req, res, next) {
    if (isPremiumPublicApiRequest(req)) return next();

    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');

    if (!authState.configured) {
      return res.status(503).json({
        ok: false,
        error:
          'Premium auth is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase en zet PREMIUM_SESSION_SECRET.',
      });
    }

    if (authState.authenticated) {
      if (!isPremiumAdminIpAllowed(req)) {
        appendSecurityAuditEvent(
          {
            type: 'admin_ip_blocked',
            severity: 'warning',
            success: false,
            email: authState.email || '',
            ip: getClientIpFromRequest(req),
            path: getRequestPathname(req),
            origin: getRequestOriginFromHeaders(req),
            userAgent: req.get('user-agent'),
            detail: 'Ingelogde API-request geweigerd door admin IP allowlist.',
          },
          'security_admin_ip_blocked'
        );
        clearPremiumSessionCookie(req, res);
        return res.status(403).json({
          ok: false,
          error: 'Toegang vanaf dit IP-adres is niet toegestaan.',
        });
      }
      req.premiumAuth = authState;
      return next();
    }

    if (authState.expired || authState.revoked) {
      clearPremiumSessionCookie(req, res);
    }

    return res.status(401).json({
      ok: false,
      error: 'Niet ingelogd.',
    });
  }

  function requirePremiumAdminApiAccess(req, res, next) {
    const authState = req.premiumAuth || null;
    if (!authState || !authState.authenticated) {
      return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    }
    if (!authState.isAdmin) {
      return res.status(403).json({ ok: false, error: 'Alleen Full Acces-accounts hebben toegang.' });
    }
    return next();
  }

  return {
    requirePremiumAdminApiAccess,
    requirePremiumApiAccess,
  };
}

module.exports = {
  createPremiumApiAccessGuard,
  createPremiumAuthStateManager,
};
