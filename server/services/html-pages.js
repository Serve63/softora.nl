const fs = require('fs');
const path = require('path');
const { applyPublicSeoHeadDefaults } = require('./public-seo');

const LOCAL_FONT_VERSION = '20260409a';
const LOCAL_FONT_STYLESHEET_HREF = `/assets/fonts.css?v=${LOCAL_FONT_VERSION}`;
const LOCAL_FONT_PRELOAD_LINKS = [
  `<link rel="preload" href="/assets/fonts/inter-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
  `<link rel="preload" href="/assets/fonts/oswald-latin.woff2?v=${LOCAL_FONT_VERSION}" as="font" type="font/woff2" crossorigin>`,
];
const LOCAL_FONT_STYLESHEET_LINK = `<link rel="stylesheet" href="${LOCAL_FONT_STYLESHEET_HREF}">`;
const LOCAL_FONT_PRELOAD_AND_STYLESHEET = [
  ...LOCAL_FONT_PRELOAD_LINKS,
  LOCAL_FONT_STYLESHEET_LINK,
].join('\n');
const PREMIUM_SIDEBAR_CRITICAL_HEAD_SNIPPET = [
  `<script id="softora-personnel-first-paint">(function(){try{document.documentElement.setAttribute("data-personnel-loading","true");document.documentElement.setAttribute("data-theme-mode","light");document.documentElement.setAttribute("data-theme","light");}catch(_){}})();</script>`,
  ...LOCAL_FONT_PRELOAD_LINKS,
  `<style id="softora-premium-sidebar-critical">
@font-face{font-family:'SoftoraSidebarInter';font-style:normal;font-weight:300 700;font-display:block;src:url('/assets/fonts/inter-latin.woff2?v=${LOCAL_FONT_VERSION}') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
@font-face{font-family:'SoftoraSidebarOswald';font-style:normal;font-weight:400 700;font-display:block;src:url('/assets/fonts/oswald-latin.woff2?v=${LOCAL_FONT_VERSION}') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
:root{--premium-sidebar-width:320px;--premium-sidebar-font-sans:'SoftoraSidebarInter','Inter',system-ui,sans-serif;--premium-sidebar-font-display:'SoftoraSidebarOswald','Oswald',sans-serif;}
.sidebar[data-static-sidebar="1"]{width:var(--premium-sidebar-width,320px) !important;display:flex !important;flex-direction:column !important;background:#fff !important;border-right:1px solid rgba(0,0,0,.08) !important;padding:19px 0 0 !important;opacity:1 !important;visibility:visible !important;transform:none !important;translate:none !important;contain:layout paint style !important;font-family:var(--premium-sidebar-font-sans) !important;font-size:14px !important;line-height:1.2 !important;letter-spacing:0 !important;font-synthesis:none !important;}
.sidebar[data-static-sidebar="1"],.sidebar[data-static-sidebar="1"] *,.sidebar[data-static-sidebar="1"] *::before,.sidebar[data-static-sidebar="1"] *::after{box-sizing:border-box !important;transition:none !important;animation-duration:.001ms !important;animation-delay:0ms !important;}
.sidebar[data-static-sidebar="1"] .sidebar-logo{display:block !important;padding:0 24px !important;margin:0 0 11px !important;font-family:var(--premium-sidebar-font-display) !important;font-size:25px !important;font-weight:700 !important;line-height:1 !important;letter-spacing:.02em !important;color:#8b2252 !important;text-transform:uppercase !important;text-decoration:none !important;white-space:nowrap !important;font-synthesis:none !important;}
.sidebar[data-static-sidebar="1"] .sidebar-nav{flex:1 1 auto !important;min-height:0 !important;overflow-y:auto !important;overflow-x:hidden !important;scrollbar-gutter:stable !important;overscroll-behavior:contain !important;}
.sidebar[data-static-sidebar="1"] .sidebar-section{margin-bottom:6px !important;}
.sidebar[data-static-sidebar="1"] .sidebar-section-label{padding:0 24px !important;margin:0 0 2px !important;font-family:var(--premium-sidebar-font-display) !important;font-size:10px !important;font-weight:500 !important;line-height:1.35 !important;letter-spacing:.13em !important;color:#9599a8 !important;text-transform:uppercase !important;}
.sidebar[data-static-sidebar="1"] .sidebar-link{display:flex !important;align-items:center !important;width:100% !important;min-height:0 !important;height:auto !important;gap:9px !important;padding:4px 24px !important;font-family:var(--premium-sidebar-font-sans) !important;font-size:14px !important;font-weight:400 !important;line-height:1.12 !important;color:#606272 !important;text-decoration:none !important;white-space:nowrap !important;transform:none !important;translate:none !important;}
.sidebar[data-static-sidebar="1"] .sidebar-link.active{color:#1a1a2e !important;background:rgba(139,34,82,.06) !important;border-left:0 !important;}
.sidebar[data-static-sidebar="1"] .sidebar-link .sidebar-link-text{display:block !important;min-width:0 !important;overflow:hidden !important;text-overflow:ellipsis !important;line-height:1.16 !important;letter-spacing:0 !important;white-space:nowrap !important;}
.sidebar[data-static-sidebar="1"] .sidebar-link svg{width:17px !important;height:17px !important;stroke:currentColor !important;opacity:.5 !important;flex-shrink:0 !important;}
.sidebar[data-static-sidebar="1"] .sidebar-link.active svg{opacity:1 !important;}
.sidebar[data-static-sidebar="1"] .sidebar-flow-section{position:relative !important;}
.sidebar[data-static-sidebar="1"] .sidebar-flow-section .sidebar-link{padding-left:31px !important;}
.sidebar[data-static-sidebar="1"] .sidebar-flow-section::before{content:'' !important;position:absolute !important;left:10px !important;top:59px !important;bottom:9px !important;width:10px !important;background:rgba(139,34,82,.72) !important;clip-path:polygon(50% 0,100% .46rem,66% .46rem,66% 100%,34% 100%,34% .46rem,0 .46rem) !important;pointer-events:none !important;}
.sidebar[data-static-sidebar="1"] .sidebar-footer{flex-shrink:0 !important;margin-top:0 !important;padding:12px 24px !important;border-top:1px solid rgba(0,0,0,.08) !important;}
.sidebar[data-static-sidebar="1"] .sidebar-user{display:flex !important;align-items:center !important;gap:11px !important;min-height:38px !important;}
.sidebar[data-static-sidebar="1"] .sidebar-user-trigger{display:flex !important;align-items:center !important;gap:11px !important;min-width:0 !important;flex:1 1 auto !important;}
.sidebar[data-static-sidebar="1"] .sidebar-avatar{width:38px !important;height:38px !important;border-radius:50% !important;background:#8b2252 !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;font-family:var(--premium-sidebar-font-display) !important;font-size:13px !important;font-weight:600 !important;flex-shrink:0 !important;overflow:hidden !important;}
.sidebar[data-static-sidebar="1"] .sidebar-user-info{min-width:0 !important;flex:1 1 auto !important;}
.sidebar[data-static-sidebar="1"] .sidebar-user-name{font-family:var(--premium-sidebar-font-sans) !important;font-size:14px !important;font-weight:500 !important;line-height:1.15 !important;color:#1a1a2e !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;}
.sidebar[data-static-sidebar="1"] .sidebar-user-role{font-family:var(--premium-sidebar-font-sans) !important;font-size:12px !important;line-height:1.12 !important;color:#9599a8 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;}
.sidebar[data-static-sidebar="1"] .logout-btn{margin-left:auto !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;padding:4px !important;color:#9599a8 !important;background:none !important;border:0 !important;}
.sidebar[data-static-sidebar="1"] .logout-btn svg{width:17px !important;height:17px !important;}
@media (min-width:901px){
html,body{min-height:100vh;}
.sidebar[data-static-sidebar="1"]{position:fixed !important;inset:0 auto 0 0 !important;height:100vh !important;min-height:100vh !important;max-height:100vh !important;z-index:40 !important;overflow:hidden !important;}
.main,.page-shell,.main-content,.dashboard-layout[data-sidebar-shell="canonical"]>.main-content{margin-left:var(--premium-sidebar-width,320px) !important;}
}
</style>`,
  LOCAL_FONT_STYLESHEET_LINK,
].join('\n');
const HOMEPAGE_HERO_IMAGE_URL = '/assets/home-hero-generated-v2.jpg?v=20260511a';
const HOMEPAGE_HERO_IMAGE_PRELOAD = `<link rel="preload" as="image" href="${HOMEPAGE_HERO_IMAGE_URL}">`;
const PREMIUM_SESSION_WATCHDOG_SCRIPT = '<script src="/assets/premium-session-watchdog.js?v=20260516a" defer></script>';

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
    publicPageDependencyWaitMs = 1500,
  } = options;
  let premiumSidebarProfilePrefillInlineTag = null;

  function getSafePublicPageDependencyWaitMs() {
    return Math.max(0, Math.min(10000, Number(publicPageDependencyWaitMs) || 0));
  }

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

  function injectSnippetAfterHeadOpen(html, snippet, marker) {
    const sourceHtml = String(html || '');
    if (!snippet || (marker && sourceHtml.includes(marker)) || sourceHtml.includes(snippet)) return sourceHtml;
    if (/<head[^>]*>/i.test(sourceHtml)) {
      return sourceHtml.replace(/<head[^>]*>/i, (match) => `${match}\n${snippet}`);
    }
    return `${snippet}\n${sourceHtml}`;
  }

  function hasPremiumStaticSidebar(html) {
    const sourceHtml = String(html || '');
    return /<aside[^>]+\bclass=["'][^"']*\bsidebar\b[^"']*["'][^>]*>/i.test(sourceHtml)
      && /<aside[^>]+\bdata-static-sidebar=["']1["'][^>]*>/i.test(sourceHtml);
  }

  function isLocalGoogleFontStylesheetTag(tag) {
    return /fonts\.googleapis\.com\/css2/i.test(String(tag || ''))
      && /\bfamily=(?:[^"']*)?(?:Inter|Oswald)\b/i.test(String(tag || ''));
  }

  function optimizeLocalFontDelivery(html, { preferHeadStart = false } = {}) {
    let renderedHtml = String(html || '');

    renderedHtml = renderedHtml.replace(
      /[ \t]*<link[^>]+href=["']https:\/\/fonts\.googleapis\.com\/css2\?[^"']+["'][^>]*>\s*/gi,
      (tag) => {
        if (!isLocalGoogleFontStylesheetTag(tag)) return tag;
        return '';
      }
    );

    if (!renderedHtml.includes(LOCAL_FONT_STYLESHEET_HREF)) {
      renderedHtml = preferHeadStart
        ? injectSnippetAfterHeadOpen(renderedHtml, LOCAL_FONT_PRELOAD_AND_STYLESHEET, LOCAL_FONT_STYLESHEET_HREF)
        : injectSnippetBeforeHeadClose(renderedHtml, LOCAL_FONT_PRELOAD_AND_STYLESHEET);
    }

    return renderedHtml;
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

  function injectPremiumSessionWatchdog(html, authState) {
    const sourceHtml = String(html || '');
    if (!authState || !authState.authenticated) return sourceHtml;
    if (/assets\/premium-session-watchdog\.js/i.test(sourceHtml)) return sourceHtml;
    return injectSnippetBeforeHeadClose(sourceHtml, PREMIUM_SESSION_WATCHDOG_SCRIPT);
  }

  function optimizeHtmlDelivery(html, fileName, authState) {
    let renderedHtml = String(html || '')
      .replace(/^[ \t]*<link[^>]+href="https:\/\/fonts\.googleapis\.com"[^>]*>\s*/gim, '')
      .replace(/^[ \t]*<link[^>]+href="https:\/\/fonts\.gstatic\.com"[^>]*>\s*/gim, '');

    const hasStaticSidebar = hasPremiumStaticSidebar(renderedHtml);
    if (hasStaticSidebar) {
      renderedHtml = injectSnippetAfterHeadOpen(
        renderedHtml,
        PREMIUM_SIDEBAR_CRITICAL_HEAD_SNIPPET,
        'id="softora-premium-sidebar-critical"'
      );
    }
    renderedHtml = optimizeLocalFontDelivery(renderedHtml, { preferHeadStart: hasStaticSidebar });

    if (fileName === 'premium-website.html') {
      renderedHtml = injectSnippetBeforeHeadClose(renderedHtml, HOMEPAGE_HERO_IMAGE_PRELOAD);
    }

    renderedHtml = injectPremiumSidebarProfileHtml(renderedHtml, authState);
    renderedHtml = injectPremiumSessionWatchdog(renderedHtml, authState);
    renderedHtml = inlinePremiumSidebarProfilePrefill(renderedHtml);

    return renderedHtml;
  }

  async function resolveWithSoftTimeout(run, { fileName, label, timeoutMs, fallbackValue }) {
    const safeTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    if (!safeTimeoutMs) {
      return run();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve(value);
      };

      const timeoutHandle = setTimeout(() => {
        logger.error(`[HTML][${label}Timeout]`, fileName, `na ${safeTimeoutMs}ms`);
        finish(fallbackValue);
      }, safeTimeoutMs);

      Promise.resolve()
        .then(run)
        .then((value) => finish(value))
        .catch((error) => {
          logger.error(`[HTML][${label}Error]`, fileName, error?.message || error);
          finish(fallbackValue);
        });
    });
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
    const publicDependencyWaitMs =
      !isLoginPage && !isProtectedPremiumPage ? getSafePublicPageDependencyWaitMs() : 0;

    try {
      const html = await readHtmlPageContent(fileName);
      if (!html) return next();
      const config =
        publicDependencyWaitMs > 0
          ? await resolveWithSoftTimeout(() => getSeoConfigCached(), {
              fileName,
              label: 'SeoConfig',
              timeoutMs: publicDependencyWaitMs,
              fallbackValue: {},
            })
          : await getSeoConfigCached();
      let rendered = applySeoOverridesToHtml(fileName, html, config);
      try {
        const bootstrapData =
          publicDependencyWaitMs > 0
            ? await resolveWithSoftTimeout(() => getPageBootstrapData(req, fileName), {
                fileName,
                label: 'Bootstrap',
                timeoutMs: publicDependencyWaitMs,
                fallbackValue: null,
              })
            : await getPageBootstrapData(req, fileName);
        rendered = injectHtmlMarkerReplacements(rendered, bootstrapData);
        rendered = injectPageBootstrapHtml(rendered, bootstrapData);
      } catch (error) {
        logger.error('[HTML][BootstrapError]', fileName, error?.message || error);
      }
      if (!isLoginPage && !isProtectedPremiumPage) {
        rendered = applyPublicSeoHeadDefaults(rendered, fileName);
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
