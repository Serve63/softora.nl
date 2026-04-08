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
  } = options;

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
      const rendered = applySeoOverridesToHtml(fileName, html, config);
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
