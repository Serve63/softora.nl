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
    supabaseHydrateMiddlewareWaitMs = 1500,
    strictSupabaseHydrateApiPrefixes = [
      '/api/ui-state',
      '/api/ui-state-get',
      '/api/agenda',
      '/api/coldcalling',
    ],
    skipSupabaseHydrateApiPrefixes = [
      '/api/auth/',
      '/api/health',
      '/api/healthz',
      '/api/mailbox/sync',
      '/api/coldmailing/autopilot/run',
    ],
  } = deps;

  const safeSupabaseHydrateMiddlewareWaitMs = Math.max(
    250,
    Math.min(10000, Number(supabaseHydrateMiddlewareWaitMs) || 1500)
  );

  const normalizedStrictSupabaseHydrateApiPrefixes = (
    Array.isArray(strictSupabaseHydrateApiPrefixes) ? strictSupabaseHydrateApiPrefixes : []
  )
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const normalizedSkipSupabaseHydrateApiPrefixes = (
    Array.isArray(skipSupabaseHydrateApiPrefixes) ? skipSupabaseHydrateApiPrefixes : []
  )
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  function isReadOnlyRequestMethod(method) {
    const normalizedMethod = String(method || 'GET').trim().toUpperCase();
    return normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS';
  }

  function requiresStrictSupabaseHydration(pathname, method = 'GET') {
    if (isReadOnlyRequestMethod(method)) return false;
    const requestPath = String(pathname || '');
    return normalizedStrictSupabaseHydrateApiPrefixes.some((prefix) => requestPath.startsWith(prefix));
  }

  function skipsSupabaseHydration(pathname) {
    const requestPath = String(pathname || '');
    return normalizedSkipSupabaseHydrateApiPrefixes.some((prefix) => requestPath.startsWith(prefix));
  }

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

  const jsonBodyParser8mb = express.json({
    limit: '8mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });
  const jsonBodyParserPreviewLibrary = express.json({
    limit: '18mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });
  const jsonBodyParserAudioUpload = express.json({
    limit: '34mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });

  app.use((req, res, next) => {
    const pathname = getRequestPathname(req);
    if (req.method === 'POST' && pathname === '/api/website-preview-library') {
      return jsonBodyParserPreviewLibrary(req, res, next);
    }
    if (
      req.method === 'POST' &&
      (pathname === '/api/ai/notes-audio-to-text' || pathname === '/api/ai-notes-audio-to-text')
    ) {
      return jsonBodyParserAudioUpload(req, res, next);
    }
    return jsonBodyParser8mb(req, res, next);
  });

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

  function createFocusedApiRateLimiter(options = {}) {
    const type = String(options.type || 'focused_rate_limit_hit').trim() || 'focused_rate_limit_hit';
    const detail = String(options.detail || 'Gerichte API rate limit geraakt.').trim();
    const error = String(options.error || 'Te veel verzoeken. Probeer het over enkele minuten opnieuw.').trim();
    return rateLimit({
      windowMs: Math.max(60 * 1000, Number(options.windowMs || 15 * 60 * 1000) || 15 * 60 * 1000),
      max: Math.max(1, Number(options.max || 60) || 60),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => {
        appendSecurityAuditEvent(
          {
            type,
            severity: 'warning',
            success: false,
            email: getPremiumAuthState(req)?.email || '',
            ip: getClientIpFromRequest(req),
            path: getRequestPathname(req),
            origin: getRequestOriginFromHeaders(req),
            userAgent: req.get('user-agent'),
            detail,
          },
          `security_${type}`
        );
        return res.status(429).json({
          ok: false,
          error,
        });
      },
    });
  }

  const sensitiveActionRateLimiter = createFocusedApiRateLimiter({
    type: 'sensitive_action_rate_limit_hit',
    max: 40,
    detail: 'Gerichte limiet geraakt voor mailbox, coldmail, coldcalling of order-actie.',
  });

  const aiApiRateLimiter = createFocusedApiRateLimiter({
    type: 'ai_rate_limit_hit',
    max: 80,
    detail: 'Gerichte limiet geraakt voor AI endpoint.',
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

  app.use(
    [
      '/api/mailbox/send',
      '/api/mailbox/sync',
      '/api/coldmailing/autopilot/run',
      '/api/coldmailing/autopilot/settings',
      '/api/coldmailing/campaigns/send',
      '/api/coldmailing/outreach/status',
      '/api/coldmailing/replies/sync',
      '/api/instantly/sync',
      '/api/outreach/provider-sync',
      '/api/instantly/prepare-upload',
      '/api/outreach/provider-upload',
      '/api/coldcalling/start',
      '/api/active-orders/generate-site',
      '/api/active-order-generate-site',
      '/api/active-orders/launch-site',
      '/api/active-order-launch-site',
      '/api/website-links/create',
    ],
    sensitiveActionRateLimiter
  );

  app.use(
    [
      '/api/ai/ruben-chat',
      '/api/ai/dashboard-chat',
      '/api/ai-dashboard-chat',
      '/api/ai/summarize',
      '/api/ai/order-dossier',
      '/api/ai-order-dossier',
      '/api/ai/transcript-to-prompt',
      '/api/ai-transcript-to-prompt',
      '/api/ai/notes-image-to-text',
      '/api/ai-notes-image-to-text',
      '/api/ai/notes-audio-to-text',
      '/api/ai-notes-audio-to-text',
      '/api/website-preview/generate',
      '/api/website-preview-generate',
      '/api/website-preview/batch',
    ],
    aiApiRateLimiter
  );

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

  app.use((req, res, next) => {
    const requestPath = String(req.path || '');
    if (!isSupabaseConfigured()) return next();
    if (!requestPath.startsWith('/api/')) return next();
    if (skipsSupabaseHydration(requestPath)) return next();
    const strictHydration = requiresStrictSupabaseHydration(requestPath, req.method);

    if (!strictHydration) {
      ensureRuntimeStateHydratedFromSupabase().catch((error) => {
        console.error('[Supabase][HydrateMiddlewareBackgroundError]', error?.message || error);
      });
      return next();
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      next();
    };
    const failStrictHydration = (message) => {
      if (released) return;
      released = true;
      return res.status(503).json({
        ok: false,
        error: message || 'Gedeelde Supabase-opslag is nog niet geladen. Probeer het zo opnieuw.',
      });
    };

    const timeout = setTimeout(() => {
      console.warn(
        '[Supabase][HydrateMiddlewareTimeout]',
        `${requestPath} na ${safeSupabaseHydrateMiddlewareWaitMs}ms doorgelaten`
      );
      if (strictHydration) {
        failStrictHydration('Gedeelde Supabase-opslag is nog niet geladen. Probeer het zo opnieuw.');
        return;
      }
      release();
    }, safeSupabaseHydrateMiddlewareWaitMs);

    ensureRuntimeStateHydratedFromSupabase()
      .then((hydrated) => {
        clearTimeout(timeout);
        if (strictHydration && hydrated === false) {
          failStrictHydration('Gedeelde Supabase-opslag kon niet veilig geladen worden.');
          return;
        }
        release();
      })
      .catch((error) => {
        clearTimeout(timeout);
        console.error('[Supabase][HydrateMiddlewareError]', error?.message || error);
        if (strictHydration) {
          failStrictHydration('Gedeelde Supabase-opslag kon niet veilig geladen worden.');
          return;
        }
        release();
      });
  });

  return {
    premiumLoginRateLimiter,
  };
}

module.exports = {
  applyAppMiddleware,
};
