const { normalizeRequestPathname } = require('./request-context');
const { PASSWORD_REGISTER_SCOPE } = require('./password-register-access');

const PREMIUM_PUBLIC_API_EXACT_MATCHES = new Set([
  '/api/healthz',
  '/api/health/baseline',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/agenda-app/login',
  '/api/twilio/voice',
  '/api/twilio/status',
  '/api/coldmailing/open.gif',
  '/api/coldmailing/unsubscribe',
  '/api/instantly/webhook',
  '/api/whatsapp/webhook',
  '/api/whatsapp/webhook-worker',
  '/api/whatsapp/status',
  '/api/whatsapp/messages',
  '/api/retell/webhook',
  '/api/retell/functions/agenda/availability',
  '/retell/webhook',
  '/retell/functions/agenda/availability',
]);
const PREMIUM_PUBLIC_API_PREFIXES = Object.freeze([
  '/api/retell/functions/agenda/',
  '/retell/functions/agenda/',
]);

function getPublicApiPathVariants(requestPath) {
  const normalizedPath = normalizeRequestPathname(requestPath || '/');
  const variants = new Set([normalizedPath]);

  if (normalizedPath.startsWith('/api/')) {
    variants.add(normalizedPath.slice(4) || '/');
  } else if (normalizedPath !== '/api') {
    variants.add(`/api${normalizedPath}`);
  }

  return variants;
}

function createPremiumAuthStateManager(options = {}) {
  const {
    sessionSecret = '',
    resolveTimeoutMs = 1500,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value) => String(value || '').trim(),
    normalizeSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    readSessionTokenFromRequest = () => '',
    verifySessionToken = () => ({ ok: false, expired: false, payload: null }),
    premiumUsersStore,
    isPremiumMfaConfigured = () => false,
    getRequestPathname = () => '/',
  } = options;

  function getSafeResolveTimeoutMs() {
    return Math.max(0, Math.min(10000, Number(resolveTimeoutMs) || 0));
  }

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
      authVersion: Math.max(0, Math.floor(Number(verification?.payload?.av) || 0)),
      authMethods: Array.isArray(verification?.payload?.amr) ? verification.payload.amr : [],
      expiresAt: Number(verification?.payload?.exp || 0) || null,
      token,
    };
  }

  function buildConfiguredAnonymousState(basicAuthState) {
    return {
      ...basicAuthState,
      configured: Boolean(sessionSecret),
      authenticated: false,
      userId: '',
      role: '',
      isAdmin: false,
      revoked: false,
      user: null,
      displayName: '',
    };
  }

  function buildAuthenticatedStateFromUser(basicAuthState, user) {
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

  function isUserCompatibleWithSession(basicAuthState, user) {
    return Boolean(
      basicAuthState?.authenticated &&
        Math.max(1, Math.floor(Number(user?.authVersion) || 1)) === basicAuthState.authVersion
    );
  }

  function buildTokenFallbackState(basicAuthState) {
    if (!basicAuthState.authenticated) {
      return buildConfiguredAnonymousState(basicAuthState);
    }

    const cachedUsers = premiumUsersStore.getCachedUsers();
    const cachedUser =
      premiumUsersStore.findUserById(cachedUsers, basicAuthState.userId) ||
      premiumUsersStore.findUserByEmail(cachedUsers, basicAuthState.email);

    if (cachedUser) {
      if (
        premiumUsersStore.normalizeUserStatus(cachedUser.status) !== 'active' ||
        !isUserCompatibleWithSession(basicAuthState, cachedUser)
      ) {
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
        ...buildAuthenticatedStateFromUser(basicAuthState, cachedUser),
        tokenFallback: true,
      };
    }

    return {
      ...buildConfiguredAnonymousState(basicAuthState),
      configured: true,
      revoked: true,
      tokenFallback: true,
    };
  }

  function resolveHydratedUsers(hydrated) {
    const hydratedUsers = Array.isArray(hydrated?.users) ? hydrated.users : [];
    return hydratedUsers.length > 0 ? hydratedUsers : premiumUsersStore.getCachedUsers();
  }

  async function getResolvedPremiumAuthState(req, options = {}) {
    const basicAuthState = getPremiumAuthState(req);
    const allowAnonymousWithoutHydration = Boolean(options?.allowAnonymousWithoutHydration);
    const allowTokenFallbackWithoutHydration = Boolean(options?.allowTokenFallbackWithoutHydration);
    const requireFreshUserHydration = Boolean(options?.requireFreshUserHydration);
    if (!basicAuthState.authenticated) {
      if (allowAnonymousWithoutHydration) {
        return buildConfiguredAnonymousState({
          ...basicAuthState,
          configured: Boolean(sessionSecret),
        });
      }
      const cachedUsers = premiumUsersStore.getCachedUsers();
      if (Array.isArray(cachedUsers) && cachedUsers.length > 0) {
        return buildConfiguredAnonymousState({
          ...basicAuthState,
          configured: true,
        });
      }
    }
    if (basicAuthState.authenticated && allowTokenFallbackWithoutHydration) {
      return buildTokenFallbackState(basicAuthState);
    }
    const timeoutMs = getSafeResolveTimeoutMs();
    let hydrated;
    if (!timeoutMs) {
      hydrated = await premiumUsersStore.ensureUsersHydrated(
        requireFreshUserHydration ? { force: true, requireFresh: true } : undefined
      );
    } else {
      hydrated = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(value);
        };

        const timeoutHandle = setTimeout(() => {
          console.error('[PremiumAuth][ResolveTimeout]', `na ${timeoutMs}ms`);
          finish({
            users: premiumUsersStore.getCachedUsers(),
            source: 'timeout',
          });
        }, timeoutMs);

        Promise.resolve()
          .then(() => premiumUsersStore.ensureUsersHydrated(
            requireFreshUserHydration ? { force: true, requireFresh: true } : undefined
          ))
          .then((value) => finish(value))
          .catch((error) => {
            console.error('[PremiumAuth][ResolveError]', error?.message || error);
            finish({
              users: premiumUsersStore.getCachedUsers(),
              source: 'timeout',
            });
          });
      });
    }
    if (requireFreshUserHydration && hydrated?.source !== 'supabase') {
      return {
        ...buildConfiguredAnonymousState(basicAuthState),
        configured: Boolean(sessionSecret),
        hydrationUnavailable: true,
      };
    }
    const users = resolveHydratedUsers(hydrated);
    const configured = Boolean(
      sessionSecret &&
        users.length > 0 &&
        hydrated?.source !== 'unavailable'
    );

    if (hydrated?.source === 'timeout') {
      return buildTokenFallbackState(basicAuthState);
    }

    if (!configured) {
      return buildConfiguredAnonymousState({
        ...basicAuthState,
        configured: false,
        authenticated: false,
        expired: false,
      });
    }

    if (!basicAuthState.authenticated) {
      return buildConfiguredAnonymousState({
        ...basicAuthState,
        configured: true,
      });
    }

    const user =
      premiumUsersStore.findUserById(users, basicAuthState.userId) ||
      premiumUsersStore.findUserByEmail(users, basicAuthState.email);

    if (
      !user ||
      premiumUsersStore.normalizeUserStatus(user.status) !== 'active' ||
      !isUserCompatibleWithSession(basicAuthState, user)
    ) {
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
      ...buildAuthenticatedStateFromUser(basicAuthState, user),
      ...(requireFreshUserHydration ? { freshUserValidated: true } : {}),
    };
  }

  function buildPremiumAuthSessionPayload(authState) {
    return {
      ok: true,
      configured: authState.configured,
      authenticated: authState.authenticated,
      mfaEnabled: false,
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
    const requestPathVariants = getPublicApiPathVariants(getRequestPathname(req));
    if (requestPathVariants.size === 0) return false;

    for (const requestPath of requestPathVariants) {
      if (PREMIUM_PUBLIC_API_EXACT_MATCHES.has(requestPath)) return true;
      if (PREMIUM_PUBLIC_API_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
        return true;
      }
      if (requestPath === '/api/mailbox/sync' && method === 'GET') {
        return true;
      }
      if (requestPath === '/api/mailbox/instantly/sync' && method === 'GET') {
        return true;
      }
      if (requestPath === '/api/coldmailing/autopilot/run' && method === 'GET') {
        return true;
      }
      if (requestPath === '/api/premium-database/webdesign-photo-batches/run' && method === 'GET') {
        return true;
      }
      if (requestPath === '/api/kvk-database/snapshot' && method === 'POST') {
        return true;
      }
      if (requestPath === '/api/kvk-database/company-directory/sync' && method === 'POST') {
        return true;
      }
      if (
        (requestPath === '/api/kvk-database/control/command' ||
          requestPath === '/api/kvk-database/control/poll' ||
          requestPath === '/api/kvk-database/control/worker') &&
        method === 'POST'
      ) {
        return true;
      }
      if (
        requestPath === '/api/twilio/voice' &&
        (method === 'GET' || method === 'POST')
      ) {
        return true;
      }
    }
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
    normalizeString = (value) => String(value || '').trim(),
  } = options;

  async function requirePremiumApiAccess(req, res, next) {
    if (isPremiumPublicApiRequest(req)) return next();

    const authState = await getResolvedPremiumAuthState(req, {
      allowAnonymousWithoutHydration: true,
      allowTokenFallbackWithoutHydration: true,
    });
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

  function getUserAgent(req) {
    return typeof req?.get === 'function' ? req.get('user-agent') : '';
  }

  function getNormalizedAdminRequestPath(req) {
    const rawPath = normalizeString(getRequestPathname(req) || '/').split(/[?#]/, 1)[0] || '/';
    return normalizeRequestPathname(rawPath);
  }

  function isAutopilotAdminFallbackRequest(req) {
    const method = normalizeString(req?.method || '').toUpperCase();
    return method === 'POST' && getNormalizedAdminRequestPath(req) === '/api/coldmailing/autopilot/settings';
  }

  function isMailboxReadOnlyAdminFallbackRequest(req) {
    const method = normalizeString(req?.method || '').toUpperCase();
    const path = getNormalizedAdminRequestPath(req);
    return (
      method === 'GET' && ['/api/mailbox/message', '/api/mailbox/message-image'].includes(path)
    ) || (
      method === 'POST' && path === '/api/mailbox/messages/bodies'
    );
  }

  function isTrustedAdminTokenFallback(authState) {
    return Boolean(
      authState &&
        authState.configured &&
        authState.authenticated &&
        authState.isAdmin &&
        authState.tokenFallback &&
        authState.token &&
        authState.userId &&
        authState.email &&
        !authState.expired &&
        !authState.revoked
    );
  }

  async function refreshAdminAuthState(req) {
    try {
      return await getResolvedPremiumAuthState(req, {
        allowAnonymousWithoutHydration: false,
        allowTokenFallbackWithoutHydration: false,
      });
    } catch (error) {
      appendSecurityAuditEvent(
        {
          type: 'admin_reconfirm_failed',
          severity: 'warning',
          success: false,
          email: req?.premiumAuth?.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: getUserAgent(req),
          detail: `Adminstatus kon niet opnieuw worden bevestigd: ${normalizeString(error?.message || error)}`,
        },
        'security_admin_reconfirm_failed'
      );
      return null;
    }
  }

  async function requirePremiumAdminApiAccess(req, res, next) {
    const authState = req.premiumAuth || null;
    if (!authState || !authState.authenticated) {
      return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    }
    if (!authState.isAdmin) {
      return res.status(403).json({ ok: false, error: 'Alleen Full Acces-accounts hebben toegang.' });
    }
    if (authState.user) {
      return next();
    }

    const refreshedAuthState = await refreshAdminAuthState(req);
    if (refreshedAuthState?.authenticated && refreshedAuthState?.isAdmin && refreshedAuthState?.user) {
      req.premiumAuth = refreshedAuthState;
      return next();
    }

    if (refreshedAuthState?.expired || refreshedAuthState?.revoked) {
      clearPremiumSessionCookie(req, res);
      return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    }

    const fallbackAuthState = refreshedAuthState?.authenticated ? refreshedAuthState : authState;
    if (isAutopilotAdminFallbackRequest(req) && isTrustedAdminTokenFallback(fallbackAuthState)) {
      req.premiumAuth = fallbackAuthState;
      appendSecurityAuditEvent(
        {
          type: 'admin_token_fallback_allowed',
          severity: 'info',
          success: true,
          email: fallbackAuthState.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: getUserAgent(req),
          detail: 'Autopilot admin-actie toegestaan op basis van een geldige gesigneerde Full Access-sessie.',
        },
        'security_admin_token_fallback_allowed'
      );
      return next();
    }

    if (isMailboxReadOnlyAdminFallbackRequest(req) && isTrustedAdminTokenFallback(fallbackAuthState)) {
      req.premiumAuth = fallbackAuthState;
      appendSecurityAuditEvent(
        {
          type: 'mailbox_readonly_token_fallback_allowed',
          severity: 'info',
          success: true,
          email: fallbackAuthState.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: getUserAgent(req),
          detail: 'Alleen-lezen mailboxbody toegestaan op basis van een geldige gesigneerde Full Access-sessie.',
        },
        'security_mailbox_readonly_token_fallback_allowed'
      );
      return next();
    }

    return res.status(403).json({ ok: false, error: 'Adminstatus kon niet veilig worden bevestigd.' });
  }

  async function requireFreshPasswordRegisterApiAccess(req, res, next) {
    const requestedScope = normalizeString(
      req?.params?.scope || req?.query?.scope || req?.body?.actionConfirmScope || ''
    ).toLowerCase();
    if (requestedScope !== PASSWORD_REGISTER_SCOPE && requestedScope !== 'password-register') {
      return next();
    }

    const authState = await getResolvedPremiumAuthState(req, {
      allowAnonymousWithoutHydration: false,
      allowTokenFallbackWithoutHydration: false,
      requireFreshUserHydration: true,
    });
    res.setHeader('Cache-Control', 'no-store, private');
    if (authState?.expired || authState?.revoked) {
      clearPremiumSessionCookie(req, res);
      return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    }
    if (
      !authState?.authenticated ||
      !authState?.user ||
      !authState?.freshUserValidated ||
      authState?.tokenFallback
    ) {
      return res.status(503).json({
        ok: false,
        code: 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE',
        error: 'Wachtwoordenregister is tijdelijk niet beschikbaar omdat de gebruiker niet vers via Supabase kon worden bevestigd.',
      });
    }
    req.premiumAuth = authState;
    return next();
  }

  return {
    requireFreshPasswordRegisterApiAccess,
    requirePremiumAdminApiAccess,
    requirePremiumApiAccess,
  };
}

module.exports = {
  createPremiumApiAccessGuard,
  createPremiumAuthStateManager,
};
