'use strict';

// Keep historical content and publication records for rollback; retire only these public URLs.
const RETIRED_PUBLIC_LANDINGS = Object.freeze({
  '/diensten': '/',
  '/pakketten': '/website-laten-maken',
  '/website-laten-maken-oisterwijk': '/website-laten-maken',
  '/crm-systeem-op-maat': '/bedrijfssoftware-op-maat',
  '/ai-automatisering': '/bedrijfssoftware-op-maat',
  '/ai-telefonist': '/voicesoftware-op-maat',
  '/branches/adviesbureaus': '/bedrijfssoftware-op-maat',
  '/branches/installateurs': '/bedrijfssoftware-op-maat',
  '/branches/makelaars': '/website-laten-maken',
  '/branches/zakelijke-dienstverleners': '/bedrijfssoftware-op-maat',
  '/regio/oisterwijk': '/website-laten-maken',
  '/regio/tilburg': '/website-laten-maken',
  '/regio/den-bosch': '/website-laten-maken',
  '/regio/midden-brabant': '/website-laten-maken',
  '/regio/tilburg-ai-automatisering': '/bedrijfssoftware-op-maat',
  '/vergelijkingen/website-laten-maken-vs-zelf-maken': '/website-laten-maken',
  '/vergelijkingen/ai-telefonist-vs-receptionist': '/voicesoftware-op-maat',
  '/vergelijkingen/chatbot-vs-livechat': '/chatbot-laten-maken',
  '/vergelijkingen/maatwerk-software-vs-standaard-software': '/bedrijfssoftware-op-maat',
  '/vergelijkingen/crm-op-maat-vs-standaard-crm': '/bedrijfssoftware-op-maat',
});
const EMPTY_LANDING_COLLECTIONS = Object.freeze(['/branches', '/regio', '/vergelijkingen']);

function normalizeLandingPath(value) {
  let pathname = String(value || '').split(/[?#]/)[0];
  try { pathname = decodeURIComponent(pathname); } catch { return ''; }
  return pathname.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '') || '/';
}

function isRetiredPublicLanding(value) {
  return Object.hasOwn(RETIRED_PUBLIC_LANDINGS, normalizeLandingPath(value));
}

function isRemovedFromPublicSitemap(value) {
  return isRetiredPublicLanding(value) || EMPTY_LANDING_COLLECTIONS.includes(normalizeLandingPath(value));
}

function replaceRetiredPublicLinks(html) {
  return String(html || '').replace(/(<a\b[^>]*?\s+href\s*=\s*)(["'])([^"']*)\2/gi, (match, prefix, quote, href) => {
    let url;
    try { url = new URL(href, 'https://www.softora.nl'); } catch { return match; }
    if (!['softora.nl', 'www.softora.nl'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return match;
    const pathname = normalizeLandingPath(url.pathname);
    const replacement = RETIRED_PUBLIC_LANDINGS[pathname] || (EMPTY_LANDING_COLLECTIONS.includes(pathname) ? '/blog' : '');
    return replacement ? `${prefix}${quote}${replacement}${url.search}${url.hash}${quote}` : match;
  });
}

function publicLandingRetirementMiddleware(req, res, next) {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const pathname = normalizeLandingPath(req.path);
  if (isRetiredPublicLanding(pathname)) {
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    return res.status(410).type('html').send('<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="robots" content="noindex, follow"><title>Pagina verwijderd | Softora</title></head><body><h1>Deze pagina is verwijderd</h1><p><a href="/">Ga naar Softora</a></p></body></html>');
  }
  if (EMPTY_LANDING_COLLECTIONS.includes(pathname)) {
    const queryIndex = String(req.originalUrl || '').indexOf('?');
    return res.redirect(301, `/blog${queryIndex < 0 ? '' : req.originalUrl.slice(queryIndex)}`);
  }
  const originalSend = res.send;
  res.send = function sendWithRetainedLinks(body) {
    const privateResponse = /\b(?:private|no-store)\b/i.test(String(this.getHeader('Cache-Control') || ''));
    if (!privateResponse && typeof body === 'string' && /^text\/html\b/i.test(String(this.getHeader('Content-Type') || ''))) {
      body = replaceRetiredPublicLinks(body);
    }
    return originalSend.call(this, body);
  };
  return next();
}

module.exports = {
  RETIRED_PUBLIC_LANDINGS, EMPTY_LANDING_COLLECTIONS,
  isRetiredPublicLanding, isRemovedFromPublicSitemap,
  replaceRetiredPublicLinks, publicLandingRetirementMiddleware,
};
