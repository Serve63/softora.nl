const { createPremiumAdminOnlyHtmlFilesSet } = require('../config/premium-admin-html-files');
const {
  createPasswordRegisterOwnerPolicy,
  isPasswordRegisterPage,
} = require('./password-register-access');

function createPremiumHtmlPageAccessController(options = {}) {
  const {
    premiumPublicHtmlFiles = new Set(),
    premiumAdminOnlyHtmlFiles = createPremiumAdminOnlyHtmlFilesSet(),
    noindexHeaderValue = 'noindex',
    getResolvedPremiumAuthState = async () => ({
      configured: false,
      authenticated: false,
      expired: false,
      revoked: false,
      email: '',
    }),
    getSafePremiumRedirectPath = (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
    clearPremiumSessionCookie = () => {},
    isPremiumAdminIpAllowed = () => true,
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestOriginFromHeaders = () => '',
    hasLiveMomentumAccess = () => false,
    passwordRegisterOwnerPolicy = createPasswordRegisterOwnerPolicy(),
  } = options;

  function normalizeFileName(value) {
    return String(value || '').trim();
  }

  function getRequestUserAgent(req) {
    return typeof req?.get === 'function' ? req.get('user-agent') : '';
  }

  function getRequestAccept(req) {
    if (typeof req?.get === 'function') {
      return String(req.get('accept') || '').toLowerCase();
    }
    return String(req?.headers?.accept || '').toLowerCase();
  }

  function prefersJsonResponse(req) {
    const accept = getRequestAccept(req);
    return accept.includes('application/json') && !accept.includes('text/html');
  }

  function appendVaryHeader(res, values) {
    if (!res || typeof res.setHeader !== 'function') return;
    const current = typeof res.getHeader === 'function' ? String(res.getHeader('Vary') || '') : '';
    const next = [...current.split(','), ...String(values || '').split(',')]
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
      .join(', ');
    if (next) res.setHeader('Vary', next);
  }

  function sendPasswordRegisterJson(res, statusCode, payload) {
    if (!res || typeof res.status !== 'function' || typeof res.json !== 'function') return false;
    res.status(statusCode).json(payload);
    return true;
  }

  function isPremiumProtectedHtmlFile(fileNameRaw) {
    const fileName = normalizeFileName(fileNameRaw);
    if (!fileName) return false;
    return (
      (/^premium-/i.test(fileName) && !premiumPublicHtmlFiles.has(fileName)) ||
      premiumAdminOnlyHtmlFiles.has(fileName)
    );
  }

  function isPremiumAdminOnlyHtmlFile(fileNameRaw) {
    const fileName = normalizeFileName(fileNameRaw);
    if (!fileName) return false;
    return premiumAdminOnlyHtmlFiles.has(fileName);
  }

  async function resolvePremiumHtmlPageAccess(req, res, fileNameRaw) {
    const fileName = normalizeFileName(fileNameRaw);
    const isLoginPage = fileName === 'premium-personeel-login.html';
    const isProtectedPremiumPage = isPremiumProtectedHtmlFile(fileName);
    const isAdminOnlyPremiumPage = isProtectedPremiumPage && isPremiumAdminOnlyHtmlFile(fileName);
    const isPasswordRegister = isPasswordRegisterPage(fileName);
    const authState =
      isLoginPage || isProtectedPremiumPage
        ? await getResolvedPremiumAuthState(req, {
            allowAnonymousWithoutHydration: isLoginPage || isProtectedPremiumPage,
            allowTokenFallbackWithoutHydration:
              (isLoginPage || isProtectedPremiumPage) && !isPasswordRegister,
            ...(isPasswordRegister ? { requireFreshUserHydration: true } : {}),
          })
        : null;
    const logoutRequested = isLoginPage && /^(1|true|yes)$/i.test(String(req.query?.logout || ''));
    const requestedPath = getSafePremiumRedirectPath(req.originalUrl || req.url || req.path || '/');

    if (isPasswordRegister) {
      appendVaryHeader(res, 'Accept, Cookie');
    }

    if (logoutRequested) {
      clearPremiumSessionCookie(req, res);
    }

    if (isLoginPage) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('X-Robots-Tag', noindexHeaderValue);
      if (!logoutRequested && authState?.authenticated) {
        const nextPath = getSafePremiumRedirectPath(req.query?.next || '', '/premium-personeel-dashboard');
        res.redirect(302, nextPath);
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
        };
      }
    }

    if (isProtectedPremiumPage) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('X-Robots-Tag', noindexHeaderValue);

      if (
        isPasswordRegister &&
        (
          authState?.hydrationUnavailable ||
          (
            authState?.authenticated &&
            (!authState?.freshUserValidated || !authState?.user || authState?.tokenFallback)
          )
        )
      ) {
        appendSecurityAuditEvent(
          {
            type: 'password_register_fresh_auth_required',
            severity: 'warning',
            success: false,
            email: authState?.email || '',
            ip: getClientIpFromRequest(req),
            path: requestedPath,
            origin: getRequestOriginFromHeaders(req),
            userAgent: getRequestUserAgent(req),
            detail: 'Wachtwoordenregister-pagina geweigerd omdat de gebruiker niet vers via Supabase kon worden bevestigd.',
          },
          'security_password_register_fresh_auth_required'
        );
        if (prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 503, {
            ok: false,
            code: 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE',
            retryable: true,
            error: 'De beveiligde sessiecontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.',
          });
          return {
            handled: true,
            authState,
            fileName,
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }
        return {
          handled: false,
          authState,
          fileName,
          responseStatusCode: 503,
          passwordRegisterAuthRecovery: {
            code: 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE',
            retryable: true,
          },
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

      if (!authState?.configured) {
        if (isPasswordRegister && prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 503, {
            ok: false,
            code: 'PREMIUM_AUTH_NOT_CONFIGURED',
            retryable: false,
            error: 'Premium toegang is tijdelijk niet beschikbaar.',
          });
          return {
            handled: true,
            authState,
            fileName,
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }
        res.redirect(302, `/premium-personeel-login?setup=1&next=${encodeURIComponent(requestedPath)}`);
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

      if (!authState.authenticated) {
        const sessionEnded = Boolean(authState.expired || authState.revoked || authState.token);
        if (sessionEnded) {
          clearPremiumSessionCookie(req, res);
        }
        if (isPasswordRegister && prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 401, {
            ok: false,
            code: sessionEnded ? 'PREMIUM_SESSION_EXPIRED' : 'PREMIUM_AUTH_REQUIRED',
            retryable: false,
            error: sessionEnded
              ? 'Je sessie is verlopen. Bevestig je toegang opnieuw.'
              : 'Log in om je toegang te bevestigen.',
          });
          return {
            handled: true,
            authState,
            fileName,
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }
        res.redirect(
          302,
          `/premium-personeel-login?next=${encodeURIComponent(requestedPath)}${sessionEnded ? '&expired=1&logout=1' : ''}`
        );
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

      // De HTML-renderer gebruikt dezelfde bevestigde sessie om serverdata direct
      // in de eerste pagina te plaatsen; zo is geen tweede sessieverzoek nodig.
      req.premiumAuth = authState;

      if (!isPremiumAdminIpAllowed(req)) {
        appendSecurityAuditEvent(
          {
            type: 'admin_ip_blocked',
            severity: 'warning',
            success: false,
            email: authState.email || '',
            ip: getClientIpFromRequest(req),
            path: requestedPath,
            origin: getRequestOriginFromHeaders(req),
            userAgent: getRequestUserAgent(req),
            detail: 'Protected premium pagina geweigerd door admin IP allowlist.',
          },
          'security_admin_ip_blocked'
        );
        clearPremiumSessionCookie(req, res);
        if (isPasswordRegister && prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 403, {
            ok: false,
            code: 'PREMIUM_ADMIN_IP_BLOCKED',
            retryable: false,
            error: 'Toegang is vanaf deze verbinding niet toegestaan.',
          });
          return {
            handled: true,
            authState,
            fileName,
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }
        res.redirect(302, '/premium-personeel-login?blocked=1');
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

      if (isAdminOnlyPremiumPage && !authState.isAdmin) {
        appendSecurityAuditEvent(
          {
            type: 'premium_admin_page_required',
            severity: 'warning',
            success: false,
            email: authState.email || '',
            ip: getClientIpFromRequest(req),
            path: requestedPath,
            origin: getRequestOriginFromHeaders(req),
            userAgent: getRequestUserAgent(req),
            detail: 'Admin-only premium pagina geweigerd voor niet-admin account.',
          },
          'security_premium_admin_page_required'
        );
        if (isPasswordRegister && prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 403, {
            ok: false,
            code: 'PREMIUM_ADMIN_REQUIRED',
            retryable: false,
            error: 'Je account heeft geen toegang tot dit onderdeel.',
          });
        } else {
          res.redirect(302, '/premium-personeel-dashboard?forbidden=1');
        }
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

      if (isPasswordRegisterPage(fileName)) {
        const ownerDecision = passwordRegisterOwnerPolicy.getAccessDecision(authState);
        if (!ownerDecision.ok) {
          appendSecurityAuditEvent(
            {
              type: 'password_register_owner_denied',
              severity: 'warning',
              success: false,
              email: authState.email || '',
              ip: getClientIpFromRequest(req),
              path: requestedPath,
              origin: getRequestOriginFromHeaders(req),
              userAgent: getRequestUserAgent(req),
              detail: ownerDecision.statusCode === 503
                ? 'Wachtwoordenregister-pagina geweigerd omdat eigenaarstoegang niet geconfigureerd is.'
                : 'Wachtwoordenregister-pagina geweigerd voor niet-eigenaar.',
            },
            'security_password_register_owner_denied'
          );
          const statusCode = ownerDecision.statusCode === 503 ? 503 : 403;
          if (prefersJsonResponse(req)) {
            sendPasswordRegisterJson(res, statusCode, {
              ok: false,
              code: ownerDecision.code || 'PASSWORD_REGISTER_OWNER_REQUIRED',
              retryable: statusCode === 503,
              error: statusCode === 503
                ? 'De eigenaarstoegang kan tijdelijk niet worden bevestigd.'
                : 'Dit wachtwoordenregister is alleen beschikbaar voor de eigenaar.',
            });
            return {
              handled: true,
              authState,
              fileName,
              isLoginPage,
              isProtectedPremiumPage,
              isAdminOnlyPremiumPage,
            };
          }
          return {
            handled: false,
            authState,
            fileName,
            responseStatusCode: statusCode,
            passwordRegisterAuthRecovery: {
              code: ownerDecision.code || 'PASSWORD_REGISTER_OWNER_REQUIRED',
              retryable: statusCode === 503,
            },
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }

        if (prefersJsonResponse(req)) {
          sendPasswordRegisterJson(res, 200, {
            ok: true,
            code: 'PASSWORD_REGISTER_FRESH_AUTH_CONFIRMED',
          });
          return {
            handled: true,
            authState,
            fileName,
            isLoginPage,
            isProtectedPremiumPage,
            isAdminOnlyPremiumPage,
          };
        }
      }

      if (fileName === 'live-momentum.html' && !hasLiveMomentumAccess(req, authState)) {
        appendSecurityAuditEvent(
          {
            type: 'live_momentum_code_required',
            severity: 'info',
            success: false,
            email: authState.email || '',
            ip: getClientIpFromRequest(req),
            path: requestedPath,
            origin: getRequestOriginFromHeaders(req),
            userAgent: getRequestUserAgent(req),
            detail: 'Winnen toont de beveiligde toegangspagina omdat de toegangscode nog niet is bevestigd.',
          },
          'security_live_momentum_code_required'
        );
        return {
          handled: false,
          authState,
          fileName,
          renderFileName: 'live-momentum-access.html',
          liveMomentumAccessRequired: true,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }
    }

    return {
      handled: false,
      authState,
      fileName,
      isLoginPage,
      isProtectedPremiumPage,
      isAdminOnlyPremiumPage,
    };
  }

  return {
    isPremiumAdminOnlyHtmlFile,
    isPremiumProtectedHtmlFile,
    resolvePremiumHtmlPageAccess,
  };
}

module.exports = {
  createPremiumHtmlPageAccessController,
};
