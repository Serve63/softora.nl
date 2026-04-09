const fs = require('fs');
const path = require('path');

const LOCAL_FONT_VERSION = '20260409a';
const LOCAL_FONT_STYLESHEET_HREF = `/assets/fonts.css?v=${LOCAL_FONT_VERSION}`;
const LOCAL_FONT_PRELOAD_AND_STYLESHEET = [
  `<link rel="preload" href="/assets/fonts/inter-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
  `<link rel="preload" href="/assets/fonts/oswald-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
  `<link rel="stylesheet" href="${LOCAL_FONT_STYLESHEET_HREF}">`,
].join('\n');
const HOMEPAGE_HERO_IMAGE_PRELOAD = [
  '<link rel="preload" as="image"',
  `href="/assets/hero-workspace-1254.jpg?v=${LOCAL_FONT_VERSION}"`,
  `imagesrcset="/assets/hero-workspace-640.jpg?v=${LOCAL_FONT_VERSION} 640w, /assets/hero-workspace-960.jpg?v=${LOCAL_FONT_VERSION} 960w, /assets/hero-workspace-1254.jpg?v=${LOCAL_FONT_VERSION} 1254w"`,
  'imagesizes="(max-width: 980px) 92vw, 46vw">',
].join(' ');

function createHtmlPageCoordinator(options = {}) {
  const {
    pagesDir = process.cwd(),
    logger = console,
    sanitizeKnownHtmlFileName = (value) => String(value || '').trim(),
    normalizeString = (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile = new Map(),
    resolvePremiumHtmlPageAccess = async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached = async () => ({}),
    applySeoOverridesToHtml = (_fileName, html) => String(html || ''),
    getPageBootstrapData = async () => null,
  } = options;

  function escapeJsonForInlineHtml(value) {
    return JSON.stringify(value === undefined ? null : value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function injectPageBootstrapHtml(html, bootstrapData) {
    const sourceHtml = String(html || '');
    if (!bootstrapData || typeof bootstrapData !== 'object') return sourceHtml;

    const scriptId = normalizeString(bootstrapData.scriptId || '');
    if (!scriptId) return sourceHtml;

    const marker = normalizeString(bootstrapData.marker || '');
    const serialized =
      typeof bootstrapData.serialized === 'string'
        ? bootstrapData.serialized
        : escapeJsonForInlineHtml(bootstrapData.data);
    const scriptTag = `<script id="${scriptId}" type="application/json">${serialized}</script>`;

    if (marker) {
      const markerToken = `<!-- ${marker} -->`;
      if (sourceHtml.includes(markerToken)) {
        return sourceHtml.replace(markerToken, scriptTag);
      }
    }

    if (/<\/body>/i.test(sourceHtml)) {
      return sourceHtml.replace(/<\/body>/i, `${scriptTag}\n</body>`);
    }

    return `${sourceHtml}\n${scriptTag}`;
  }

  function injectHtmlMarkerReplacements(html, bootstrapData) {
    let renderedHtml = String(html || '');
    if (!bootstrapData || typeof bootstrapData !== 'object') return renderedHtml;

    const replacements = bootstrapData.htmlReplacements;
    if (!replacements || typeof replacements !== 'object') return renderedHtml;

    const entries = Array.isArray(replacements)
      ? replacements
      : Object.entries(replacements).map(([marker, value]) => ({ marker, html: value }));

    entries.forEach((entry) => {
      const marker = normalizeString(entry?.marker || '');
      if (!marker) return;
      const markerToken = `<!-- ${marker} -->`;
      if (!renderedHtml.includes(markerToken)) return;
      renderedHtml = renderedHtml.split(markerToken).join(String(entry?.html || ''));
    });

    return renderedHtml;
  }

  function injectSnippetBeforeHeadClose(html, snippet) {
    const sourceHtml = String(html || '');
    if (!snippet || sourceHtml.includes(snippet)) return sourceHtml;
    if (/<\/head>/i.test(sourceHtml)) {
      return sourceHtml.replace(/<\/head>/i, `${snippet}\n</head>`);
    }
    return `${snippet}\n${sourceHtml}`;
  }

  function optimizeHtmlDelivery(html, fileName) {
    let renderedHtml = String(html || '')
      .replace(/^[ \t]*<link[^>]+href="https:\/\/fonts\.googleapis\.com"[^>]*>\s*/gim, '')
      .replace(/^[ \t]*<link[^>]+href="https:\/\/fonts\.gstatic\.com"[^>]*>\s*/gim, '');

    if (renderedHtml.includes('fonts.googleapis.com/css2')) {
      renderedHtml = renderedHtml.replace(
        /<link[^>]+href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+"[^>]*>\s*/i,
        `${LOCAL_FONT_PRELOAD_AND_STYLESHEET}\n`
      );
    } else if (!renderedHtml.includes(LOCAL_FONT_STYLESHEET_HREF)) {
      renderedHtml = injectSnippetBeforeHeadClose(renderedHtml, LOCAL_FONT_PRELOAD_AND_STYLESHEET);
    }

    if (fileName === 'premium-website.html') {
      renderedHtml = injectSnippetBeforeHeadClose(renderedHtml, HOMEPAGE_HERO_IMAGE_PRELOAD);
    }

    return renderedHtml;
  }

  async function readHtmlPageContent(fileNameRaw) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    if (!fileName) return '';
    try {
      return await fs.promises.readFile(path.join(pagesDir, fileName), 'utf8');
    } catch (error) {
      logger.error('[SEO][ReadPageError]', fileName, error?.message || error);
      return '';
    }
  }

  function resolveSeoPageFileFromRequest(fileRaw, slugRaw = '') {
    const directFile = sanitizeKnownHtmlFileName(fileRaw);
    if (directFile) return directFile;

    const slug = normalizeString(slugRaw).toLowerCase();
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return '';

    const mappedFile = knownPrettyPageSlugToFile.get(slug);
    return sanitizeKnownHtmlFileName(mappedFile);
  }

  async function sendSeoManagedHtmlPageResponse(req, res, next, fileNameRaw) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    if (!fileName) return next();

    const premiumPageAccess = await resolvePremiumHtmlPageAccess(req, res, fileName);
    if (premiumPageAccess.handled) return undefined;
    const { isLoginPage, isProtectedPremiumPage } = premiumPageAccess;

    try {
      const html = await readHtmlPageContent(fileName);
      if (!html) return next();
      const config = await getSeoConfigCached();
      let rendered = applySeoOverridesToHtml(fileName, html, config);
      try {
        const bootstrapData = await getPageBootstrapData(req, fileName);
        rendered = injectHtmlMarkerReplacements(rendered, bootstrapData);
        rendered = injectPageBootstrapHtml(rendered, bootstrapData);
      } catch (error) {
        logger.error('[HTML][BootstrapError]', fileName, error?.message || error);
      }
      rendered = optimizeHtmlDelivery(rendered, fileName);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Cache-Control',
        isLoginPage || isProtectedPremiumPage
          ? 'no-store, private'
          : 'public, max-age=300, stale-while-revalidate=900'
      );
      return res.status(200).send(rendered);
    } catch (error) {
      logger.error('[SEO][RenderPageError]', fileName, error?.message || error);
      if (isLoginPage || isProtectedPremiumPage) {
        res.setHeader('Cache-Control', 'no-store, private');
      }
      return res.sendFile(path.join(pagesDir, fileName), (sendErr) => {
        if (sendErr) next();
      });
    }
  }

  return {
    readHtmlPageContent,
    resolveSeoPageFileFromRequest,
    sendSeoManagedHtmlPageResponse,
  };
}

module.exports = {
  createHtmlPageCoordinator,
};
