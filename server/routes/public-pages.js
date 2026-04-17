const express = require('express');

function appendOriginalQuery(pathname, originalUrl) {
  const basePath = String(pathname || '').trim() || '/';
  const original = String(originalUrl || '');
  const queryIndex = original.indexOf('?');
  if (queryIndex < 0) return basePath;
  const query = original.slice(queryIndex);
  return `${basePath}${query}`;
}

function registerPublicPageRoutes(app, deps) {
  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /premium-',
        'Disallow: /personeel-',
        'Disallow: /actieve-opdrachten',
        'Disallow: /ai-coldmailing',
        'Disallow: /ai-lead-generator',
        'Disallow: /seo-crm-system',
        '',
      ].join('\n')
    );
  });

  app.get('/.well-known/security.txt', (req, res) => {
    const publicBaseUrl = deps.getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(
      [
        `Contact: mailto:${deps.securityContactEmail || 'info@softora.nl'}`,
        `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
        `Canonical: ${publicBaseUrl}/.well-known/security.txt`,
        `Preferred-Languages: nl, en`,
        '',
      ].join('\n')
    );
  });

  app.use(
    '/assets',
    express.static(deps.assetsDirectory, {
      maxAge: '7d',
      setHeaders(res, assetPath) {
        const originalUrl = String(res.req?.originalUrl || '');
        if (/\.(woff2?|ttf|otf|eot|svg|png|jpe?g|webp|avif)$/i.test(assetPath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (originalUrl.includes('?v=')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        }
      },
    })
  );

  app.get('/', async (req, res, next) => {
    return deps.sendSeoManagedHtmlPageResponse(req, res, next, 'premium-website.html');
  });

  app.get('/:page', (req, res, next) => {
    const page = req.params.page;

    if (!/^[a-zA-Z0-9._-]+\.html$/.test(page)) {
      return next();
    }

    const slug = String(page || '').replace(/\.html$/i, '');
    const legacyTarget = deps.resolveLegacyPrettyPageRedirect(slug);
    if (legacyTarget) {
      return res.redirect(301, appendOriginalQuery(`/${legacyTarget}`, req.originalUrl));
    }

    if (!deps.knownHtmlPageFiles.has(page)) {
      return next();
    }

    const destination = deps.toPrettyPagePathFromHtmlFile(page);
    return res.redirect(301, appendOriginalQuery(destination, req.originalUrl));
  });

  app.get('/:slug', async (req, res, next) => {
    const slug = String(req.params.slug || '').trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
      return next();
    }

    if (slug === 'index') {
      return res.redirect(301, '/');
    }

    const legacyTarget = deps.resolveLegacyPrettyPageRedirect(slug);
    if (legacyTarget) {
      return res.redirect(301, appendOriginalQuery(`/${legacyTarget}`, req.originalUrl));
    }

    if (await deps.sendPublishedWebsiteLinkResponse(req, res, slug)) return undefined;

    const fileName = deps.knownPrettyPageSlugToFile.get(slug);
    if (!fileName) {
      return next();
    }

    return deps.sendSeoManagedHtmlPageResponse(req, res, next, fileName);
  });

  app.use((req, res) => {
    const requestPath = String(req.path || req.originalUrl || req.url || '');
    if (requestPath === '/' || requestPath === '') {
      return res.redirect(302, '/premium-website');
    }
    res.status(404).json({ ok: false, error: 'Niet gevonden' });
  });

  app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err);
    res.status(500).json({
      ok: false,
      error: 'Interne serverfout',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });
}

module.exports = {
  registerPublicPageRoutes,
};
