'use strict';

const WEBDESIGN_EMAIL_TEMPLATE_VERSION = 'softora-webdesign-email-2026-07-15-v7';
const WEBDESIGN_EMAIL_MOCKUP_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';

const EMAIL_CONTENT_MAX_WIDTH = 600;
const SINGLE_IMAGE_WIDTH = 480;
const EMAIL_WORD_JOINER = '\u2060';
const UNLINKED_WEBSITE_DOMAIN_STYLE =
  'display:inline-block;white-space:nowrap!important;overflow-wrap:normal!important;word-break:keep-all!important;color:inherit!important;text-decoration:none!important;';

function renderWebdesignEmailHeadStyles() {
  return [
    `html,body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%!important;-ms-text-size-adjust:100%!important;text-size-adjust:100%!important}`,
    `.softora-webdesign-email-body{width:100%!important;max-width:${EMAIL_CONTENT_MAX_WIDTH}px!important;min-width:0!important;box-sizing:border-box!important;overflow-wrap:anywhere!important;word-break:normal!important;-webkit-text-size-adjust:100%!important;-ms-text-size-adjust:100%!important;text-size-adjust:100%!important}`,
    `.softora-coldmail-body p{font-size:16px!important;line-height:26px!important;max-width:100%!important;overflow-wrap:anywhere!important;word-break:normal!important}`,
    `.softora-mailbox-webdesign-body p{font-size:16px!important;line-height:26px!important;max-width:100%!important;overflow-wrap:anywhere!important;word-break:normal!important}`,
  ].join('');
}

function renderWebdesignEmailDocument(content) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><style type="text/css">${renderWebdesignEmailHeadStyles()}</style></head><body style="margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;">${String(
    content || ''
  )}</body></html>`;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWebsiteDomain(value) {
  const raw = normalizeString(value)
    .replace(/^<|>$/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[/?#].*$/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/i.test(raw)
    ? raw
    : '';
}

function escapeRegexText(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectWebsiteDomainText(value) {
  return String(value || '').replace(/([.-])/g, `${EMAIL_WORD_JOINER}$1${EMAIL_WORD_JOINER}`);
}

function renderUnlinkedWebsiteDomain(value, options = {}) {
  const display = normalizeString(value);
  if (!display) return '';
  return `<span class="softora-unlinked-website-domain" style="${UNLINKED_WEBSITE_DOMAIN_STYLE}">${escapeHtml(
    options.protectPunctuation === false ? display : protectWebsiteDomainText(display)
  )}</span>`;
}

function replaceWebsiteDomainInText(value, websiteDomain, replacement) {
  const source = String(value || '');
  const domain = normalizeWebsiteDomain(websiteDomain);
  if (!source || !domain || typeof replacement !== 'function') return source;
  const pattern = new RegExp(
    `(^|[^a-z0-9@._-])((?:www\\.)?${escapeRegexText(domain)})(?=$|[^a-z0-9._-])`,
    'gi'
  );
  let result = '';
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const prefix = match[1] || '';
    const token = match[2] || '';
    const tokenStart = (match.index || 0) + prefix.length;
    result += source.slice(lastIndex, tokenStart);
    result += replacement(token);
    lastIndex = tokenStart + token.length;
  }
  return lastIndex ? `${result}${source.slice(lastIndex)}` : source;
}

function protectWebsiteDomainInText(value, websiteDomain) {
  return replaceWebsiteDomainInText(value, websiteDomain, protectWebsiteDomainText);
}

function renderTextWithUnlinkedWebsiteDomain(value, websiteDomain) {
  const source = String(value || '');
  const domain = normalizeWebsiteDomain(websiteDomain);
  if (!domain) return escapeHtml(source);
  const protectedSource = replaceWebsiteDomainInText(
    source,
    domain,
    (token) => `\u0000${token}\u0000`
  );
  const parts = protectedSource.split('\u0000');
  return parts
    .map((part, index) => (index % 2 === 1 ? renderUnlinkedWebsiteDomain(part) : escapeHtml(part)))
    .join('');
}

function imageSource(image) {
  return normalizeString(image && (image.src || (image.cid ? `cid:${image.cid}` : '')));
}

function imageAlt(image, fallback) {
  return normalizeString(image && image.alt) || fallback;
}

function renderStackedImage(image, fallbackAlt, options = {}) {
  const src = imageSource(image);
  if (!src) return '';
  const isMockup = options.mockup === true;
  const className = isMockup
    ? 'softora-webdesign-image softora-webdesign-image--mockup'
    : 'softora-webdesign-image';
  const positionStyle = isMockup ? 'object-position:center top;' : '';
  const imageHtml = `<img src="${escapeHtml(src)}" alt="${escapeHtml(
    imageAlt(image, fallbackAlt)
  )}" class="${className}" width="${EMAIL_CONTENT_MAX_WIDTH}" style="display:block;width:100%;max-width:${EMAIL_CONTENT_MAX_WIDTH}px;height:auto;max-height:none;object-fit:contain;${positionStyle}border:0;outline:none;text-decoration:none;font-size:0;line-height:0;" />`;
  return `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:${EMAIL_CONTENT_MAX_WIDTH}px;margin:0 0 16px 0;"><tr><td width="100%" style="display:block;padding:0;margin:0;width:100%;max-width:${EMAIL_CONTENT_MAX_WIDTH}px;font-size:0;line-height:0;overflow:visible;">${imageHtml}</td></tr></table>`;
}

function renderSingleImage(image, options = {}) {
  const src = imageSource(image);
  if (!src) return '';
  const width = Math.min(EMAIL_CONTENT_MAX_WIDTH, Math.max(1, Number(options.width) || SINGLE_IMAGE_WIDTH));
  const margin = normalizeString(options.margin) || '24px 0 0 0';
  return `\n<table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:${width}px;max-width:100%;margin:${margin};"><tr><td width="${width}" style="padding:0;margin:0;width:${width}px;max-width:100%;font-size:0;line-height:0;overflow:visible;"><img src="${escapeHtml(
    src
  )}" alt="${escapeHtml(imageAlt(image, 'Webdesign'))}" width="${width}" style="display:block;width:${width}px;max-width:100%;max-height:960px;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;" /></td></tr></table>`;
}

function renderResponsiveImagePair(mainImage, mockupImage, options = {}) {
  const mainHtml = renderStackedImage(mainImage, 'Webdesign');
  const mockupHtml = renderStackedImage(mockupImage, 'Device mockup', { mockup: true });
  if (!mainHtml || !mockupHtml) return '';

  const caption = normalizeString(options.caption) || WEBDESIGN_EMAIL_MOCKUP_CAPTION;
  const margin = normalizeString(options.margin) || '24px 0 0 0';
  return `\n<!-- ${WEBDESIGN_EMAIL_TEMPLATE_VERSION} --><div class="softora-webdesign-image-stack" style="display:block;margin:${margin};padding:0;width:100%;max-width:${EMAIL_CONTENT_MAX_WIDTH}px;overflow:visible;font-size:0;line-height:0;">${mainHtml}<p class="softora-mockup-caption" style="display:block;margin:20px 0 12px 0;font-family:Arial,sans-serif;font-size:16px;line-height:26px;color:#111827;font-weight:700;overflow-wrap:anywhere;word-break:normal;">${escapeHtml(
    caption
  )}</p>${mockupHtml}</div>`;
}

function renderWebdesignImageSection(mainImage, options = {}) {
  const mockupImage = options.mockupImage || (mainImage && mainImage.mockup);
  return mockupImage
    ? renderResponsiveImagePair(mainImage, mockupImage, options)
    : renderSingleImage(mainImage, options);
}

module.exports = {
  WEBDESIGN_EMAIL_MOCKUP_CAPTION,
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  renderWebdesignEmailDocument,
  renderWebdesignEmailHeadStyles,
  renderResponsiveImagePair,
  renderSingleImage,
  normalizeWebsiteDomain,
  protectWebsiteDomainInText,
  protectWebsiteDomainText,
  renderTextWithUnlinkedWebsiteDomain,
  renderUnlinkedWebsiteDomain,
  renderWebdesignImageSection,
};
