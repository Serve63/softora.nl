const { createPremiumAdminOnlyHtmlFilesSet } = require('../config/premium-admin-html-files');

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
  } = options;

  function normalizeFileName(value) {
    return String(value || '').trim();
  }

  function getRequestUserAgent(req) {
    return typeof req?.get === 'function' ? req.get('user-agent') : '';
  }

  function isPremiumProtectedHtmlFile(fileNameRaw) {
    const fileName = normalizeFileName(fileNameRaw);
    if (!fileName) return false;
    return /^premium-/i.test(fileName) && !premiumPublicHtmlFiles.has(fileName);
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
    const authState = isLoginPage || isProtectedPremiumPage ? await getResolvedPremiumAuthState(req) : null;
    const logoutRequested = isLoginPage && /^(1|true|yes)$/i.test(String(req.query?.logout || ''));
    const requestedPath = getSafePremiumRedirectPath(req.originalUrl || req.url || req.path || '/');

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

      if (!authState?.configured) {
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
        if (authState.expired || authState.revoked) {
          clearPremiumSessionCookie(req, res);
        }
        res.redirect(302, `/premium-personeel-login?next=${encodeURIComponent(requestedPath)}`);
        return {
          handled: true,
          authState,
          fileName,
          isLoginPage,
          isProtectedPremiumPage,
          isAdminOnlyPremiumPage,
        };
      }

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
        res.redirect(302, '/premium-personeel-dashboard?forbidden=1');
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
