const express = require('express');
const {
  buildPublicSeoRobotsTxt,
  buildPublicSeoSitemapXml,
  getIndexablePublicHtmlFileFromPath,
  getIndexablePublicPathFromHtmlFile,
  getLegacyPublicSeoRedirectTargetPath,
} = require('../services/public-seo');
const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentItem,
} = require('../services/seo-content');

function appendOriginalQuery(pathname, originalUrl) {
  const basePath = String(pathname || '').trim() || '/';
  const original = String(originalUrl || '');
  const queryIndex = original.indexOf('?');
  if (queryIndex < 0) return basePath;
  const query = original.slice(queryIndex);
  return `${basePath}${query}`;
}

function isContentHashedAssetPath(assetPath) {
  const fileName = String(assetPath || '').split(/[\\/]/).pop() || '';
  return /(?:^|[._-])[a-f0-9]{12,}(?:[._-]|$)/i.test(fileName);
}

function getStaticAssetCacheControl(assetPath, originalUrl = '') {
  const asset = String(assetPath || '');
  const requestUrl = String(originalUrl || '');
  const isFontOrImage = /\.(woff2?|ttf|otf|eot|svg|png|jpe?g|webp|avif)$/i.test(asset);
  const isAppScriptOrStyle = /\.(?:js|css)$/i.test(asset);

  if (isFontOrImage) return 'public, max-age=31536000, immutable';
  if (isAppScriptOrStyle) {
    return isContentHashedAssetPath(asset)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60, stale-while-revalidate=300';
  }
  if (requestUrl.includes('?v=')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=604800, stale-while-revalidate=86400';
}

function registerPublicPageRoutes(app, deps) {
  app.get('/robots.txt', (req, res) => {
    const publicBaseUrl = deps.getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(
      buildPublicSeoRobotsTxt({
        knownHtmlPageFiles: deps.knownHtmlPageFiles,
        siteOrigin: publicBaseUrl,
      })
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const publicBaseUrl = deps.getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(
      buildPublicSeoSitemapXml({
        knownHtmlPageFiles: deps.knownHtmlPageFiles,
        siteOrigin: publicBaseUrl,
      })
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

  app.get('/favicon.ico', (req, res, next) => {
    return res.redirect(302, '/assets/softora-favicon-round.png?v=20260513a');
  });

  app.use(
    '/assets',
    express.static(deps.assetsDirectory, {
      maxAge: '7d',
      setHeaders(res, assetPath) {
        const originalUrl = String(res.req?.originalUrl || '');
        res.setHeader('Cache-Control', getStaticAssetCacheControl(assetPath, originalUrl));
      },
    })
  );

  app.get('/', async (req, res, next) => {
    return deps.sendSeoManagedHtmlPageResponse(req, res, next, 'premium-website.html');
  });

  app.get('/premium-blog', (req, res) => {
    return res.redirect(301, appendOriginalQuery('/blog', req.originalUrl));
  });

  app.get(['/blog', '/kennisbank'], (req, res, next) => {
    const collection = String(req.path || '').replace(/^\//, '');
    const publicBaseUrl = deps.getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    const html = buildSeoContentIndexHtml(collection, { siteOrigin: publicBaseUrl });
    if (!html) return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return res.status(200).send(html);
  });

  app.get(['/blog/:slug', '/kennisbank/:slug'], (req, res, next) => {
    const collection = String(req.path || '').split('/').filter(Boolean)[0] || '';
    const slug = String(req.params.slug || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return next();

    const item = getSeoContentItem(collection, slug);
    if (!item) return next();

    const publicBaseUrl = deps.getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    const html = buildSeoContentArticleHtml(item, { siteOrigin: publicBaseUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return res.status(200).send(html);
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

    const destination = getIndexablePublicPathFromHtmlFile(page) || deps.toPrettyPagePathFromHtmlFile(page);
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

    const requestPath = `/${slug}`;
    const publicSeoRedirectTarget = getLegacyPublicSeoRedirectTargetPath(requestPath);
    if (publicSeoRedirectTarget) {
      return res.redirect(301, appendOriginalQuery(publicSeoRedirectTarget, req.originalUrl));
    }

    const publicSeoFileName = getIndexablePublicHtmlFileFromPath(requestPath);
    if (publicSeoFileName) {
      return deps.sendSeoManagedHtmlPageResponse(req, res, next, publicSeoFileName);
    }

    if (await deps.sendPublishedWebsiteLinkResponse(req, res, slug)) return undefined;

    const fileName = deps.knownPrettyPageSlugToFile.get(slug);
    if (!fileName) {
      return next();
    }

    if (slug === 'premium-website' && fileName === 'premium-website.html') {
      return deps.sendSeoManagedHtmlPageResponse(req, res, next, fileName);
    }

    const indexablePublicPath = getIndexablePublicPathFromHtmlFile(fileName);
    if (indexablePublicPath && indexablePublicPath !== `/${slug}`) {
      return res.redirect(301, appendOriginalQuery(indexablePublicPath, req.originalUrl));
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
  appendOriginalQuery,
  getStaticAssetCacheControl,
  registerPublicPageRoutes,
};
