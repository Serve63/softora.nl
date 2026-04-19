const fs = require('fs');
const path = require('path');

const LOCAL_FONT_VERSION = '20260409a';
const LOCAL_FONT_STYLESHEET_HREF = `/assets/fonts.css?v=${LOCAL_FONT_VERSION}`;
const LOCAL_FONT_PRELOAD_AND_STYLESHEET = [
  `<link rel="preload" href="/assets/fonts/inter-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
  `<link rel="preload" href="/assets/fonts/oswald-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
  `<link rel="stylesheet" href="${LOCAL_FONT_STYLESHEET_HREF}">`,
].join('\n');
const HOMEPAGE_HERO_IMAGE_URL =
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2000&q=85';
const HOMEPAGE_HERO_IMAGE_PRELOAD = `<link rel="preload" as="image" href="${HOMEPAGE_HERO_IMAGE_URL}" crossorigin>`;

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
  let premiumSidebarProfilePrefillInlineTag = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPremiumSidebarRoleLabel(role) {
    return String(role || '').trim().toLowerCase() === 'admin' ? 'Full Acces' : 'Medewerker';
  }

  function buildPremiumSidebarInitials(authState) {
    const displayName = String(
      (authState && (authState.displayName || authState.firstName || authState.email)) || ''
    ).trim();
    if (!displayName) return 'SP';
    const parts = displayName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    }
    const compact = displayName.replace(/[^a-z0-9]+/gi, '');
    return (compact.slice(0, 2) || 'SP').toUpperCase();
  }

  function buildPremiumSidebarProfileRenderKey(authState) {
    const displayName = String((authState && authState.displayName) || 'Softora Premium').trim() || 'Softora Premium';
    const role = String((authState && authState.role) || 'admin').trim().toLowerCase() || 'admin';
    const avatarDataUrl = String((authState && authState.avatarDataUrl) || '').trim();
    return [displayName, role, avatarDataUrl].join('\u0001');
  }

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

  function inlinePremiumSidebarProfilePrefill(html) {
    const sourceHtml = String(html || '');
    const scriptPattern =
      /<script[^>]+src=["']\/?assets\/premium-sidebar-profile-prefill\.js(?:\?[^"']*)?["'][^>]*><\/script>/i;
    if (!scriptPattern.test(sourceHtml)) return sourceHtml;
    if (premiumSidebarProfilePrefillInlineTag === null) {
      try {
        const assetPath = path.join(pagesDir, 'assets', 'premium-sidebar-profile-prefill.js');
        const assetSource = fs.readFileSync(assetPath, 'utf8');
        premiumSidebarProfilePrefillInlineTag = `<script>${assetSource}</script>`;
      } catch (error) {
        logger.error('[HTML][InlineSidebarPrefillError]', error?.message || error);
        premiumSidebarProfilePrefillInlineTag = '';
      }
    }
    if (!premiumSidebarProfilePrefillInlineTag) return sourceHtml;
    return sourceHtml.replace(scriptPattern, premiumSidebarProfilePrefillInlineTag);
  }

  function injectPremiumSidebarProfileHtml(html, authState) {
    let renderedHtml = String(html || '');
    if (!authState || !authState.authenticated) return renderedHtml;
    if (!/data-sidebar-user-name/i.test(renderedHtml)) return renderedHtml;

    const displayNameRaw =
      String(authState.displayName || authState.firstName || authState.email || 'Softora Premium').trim() ||
      'Softora Premium';
    const roleLabelRaw = buildPremiumSidebarRoleLabel(authState.role);
    const renderKey = escapeHtml(buildPremiumSidebarProfileRenderKey(authState));
    const loggedInAriaLabel = escapeHtml(`Ingelogd als ${displayNameRaw}`);
    const avatarDataUrl = String(authState.avatarDataUrl || '').trim();
    const avatarHtml = avatarDataUrl
      ? `<img src="${escapeHtml(avatarDataUrl)}" alt="${escapeHtml(displayNameRaw || 'Profielfoto')}" decoding="async">`
      : escapeHtml(buildPremiumSidebarInitials(authState));

    renderedHtml = renderedHtml.replace(
      /<aside([^>]*\bclass="sidebar\b[^"]*"[^>]*)>/i,
      (match, attrs) => {
        const normalizedAttrs = String(attrs || '').replace(/\sdata-sidebar-profile-render-key="[^"]*"/i, '');
        return `<aside${normalizedAttrs} data-sidebar-profile-render-key="${renderKey}">`;
      }
    );
    renderedHtml = renderedHtml.replace(
      /(<button[^>]*data-sidebar-profile-trigger="1"[^>]*aria-label=")[^"]*(")/i,
      `$1${loggedInAriaLabel}$2`
    );
    renderedHtml = renderedHtml.replace(
      /(<div[^>]*\bsidebar-user-trigger\b[^>]*aria-label=")[^"]*(")/i,
      `$1${loggedInAriaLabel}$2`
    );
    renderedHtml = renderedHtml.replace(
      /(<div class="sidebar-avatar"[^>]*data-sidebar-avatar[^>]*>)([\s\S]*?)(<\/div>)/i,
      `$1${avatarHtml}$3`
    );
    renderedHtml = renderedHtml.replace(
      /(<div class="sidebar-user-name"[^>]*data-sidebar-user-name[^>]*>)([\s\S]*?)(<\/div>)/i,
      `$1${escapeHtml(displayNameRaw)}$3`
    );
    renderedHtml = renderedHtml.replace(
      /(<div class="sidebar-user-role"[^>]*data-sidebar-user-role[^>]*>)([\s\S]*?)(<\/div>)/i,
      `$1${escapeHtml(roleLabelRaw)}$3`
    );

    return renderedHtml;
  }

  function optimizeHtmlDelivery(html, fileName, authState) {
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

    renderedHtml = injectPremiumSidebarProfileHtml(renderedHtml, authState);
    renderedHtml = inlinePremiumSidebarProfilePrefill(renderedHtml);

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
      rendered = optimizeHtmlDelivery(rendered, fileName, premiumPageAccess?.authState || null);
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
