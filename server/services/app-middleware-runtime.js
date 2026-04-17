const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function applyAppMiddleware(app, deps = {}) {
  const {
    express,
    isProduction,
    isPremiumPublicApiRequest,
    appendSecurityAuditEvent,
    getPremiumAuthState,
    normalizePremiumSessionEmail,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    getStateChangingApiProtectionDecision,
    noindexHeaderValue,
    isSupabaseConfigured,
    ensureRuntimeStateHydratedFromSupabase,
  } = deps;

  app.disable('x-powered-by');

  app.use(
    helmet({
      frameguard: { action: 'deny' },
      permissionsPolicy: {
        features: {
          accelerometer: [],
          autoplay: ['self'],
          camera: [],
          geolocation: [],
          gyroscope: [],
          magnetometer: [],
          microphone: [],
          payment: [],
          usb: [],
        },
      },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    })
  );

  app.use(
    compression({
      threshold: 1024,
      filter(req, res) {
        return (
          !String(res.getHeader('Cache-Control') || '').includes('no-transform') &&
          compression.filter(req, res)
        );
      },
    })
  );

  app.use(
    express.json({
      limit: '8mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  const generalApiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => isPremiumPublicApiRequest(req),
    handler: (req, res) => {
      appendSecurityAuditEvent(
        {
          type: 'rate_limit_hit',
          severity: 'warning',
          success: false,
          email: getPremiumAuthState(req)?.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Algemene API rate limit geraakt.',
        },
        'security_rate_limit_hit'
      );
      return res.status(429).json({
        ok: false,
        error: 'Te veel verzoeken. Probeer het over enkele minuten opnieuw.',
      });
    },
  });

  const premiumLoginRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      appendSecurityAuditEvent(
        {
          type: 'login_rate_limit_hit',
          severity: 'warning',
          success: false,
          email: normalizePremiumSessionEmail(req.body?.email || ''),
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Te veel premium loginpogingen.',
        },
        'security_login_rate_limit_hit'
      );
      return res.status(429).json({
        ok: false,
        error: 'Te veel inlogpogingen. Wacht 10 minuten en probeer opnieuw.',
      });
    },
  });

  app.use('/api', generalApiRateLimiter);

  app.use('/api', (req, res, next) => {
    res.setHeader('X-Robots-Tag', noindexHeaderValue);
    return next();
  });

  app.use('/api', (req, res, next) => {
    const protectionDecision = getStateChangingApiProtectionDecision(req);
    if (protectionDecision.allowed) return next();

    appendSecurityAuditEvent(
      {
        type: protectionDecision.reason || 'csrf_origin_blocked',
        severity: 'warning',
        success: false,
        email: getPremiumAuthState(req)?.email || '',
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: protectionDecision.detail || 'State-changing API request geweigerd door API-beveiliging.',
      },
      `security_${protectionDecision.reason || 'same_origin_blocked'}`
    );

    return res.status(403).json({
      ok: false,
      error: protectionDecision.publicMessage || 'Verzoek geweigerd door API-beveiliging.',
    });
  });

  app.use((req, _res, next) => {
    const requestPath = String(req.path || '');
    if (!isSupabaseConfigured()) return next();
    if (!requestPath.startsWith('/api/')) return next();

    ensureRuntimeStateHydratedFromSupabase()
      .then(() => next())
      .catch((error) => {
        console.error('[Supabase][HydrateMiddlewareError]', error?.message || error);
        next();
      });
  });

  return {
    premiumLoginRateLimiter,
  };
}

module.exports = {
  applyAppMiddleware,
};
