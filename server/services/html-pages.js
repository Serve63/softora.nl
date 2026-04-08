const fs = require('fs');
const path = require('path');

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
        rendered = injectPageBootstrapHtml(rendered, bootstrapData);
      } catch (error) {
        logger.error('[HTML][BootstrapError]', fileName, error?.message || error);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
