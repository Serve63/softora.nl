'use strict';

const WEBDESIGN_EMAIL_TEMPLATE_VERSION = 'softora-webdesign-email-2026-07-15-v6';
const WEBDESIGN_EMAIL_MOCKUP_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';

const DESKTOP_WEBDESIGN_WIDTH = 300;
const DESKTOP_MOCKUP_WIDTH = 584;
const DESKTOP_IMAGE_HEIGHT = 560;
const DESKTOP_GAP_WIDTH = 16;
const SINGLE_IMAGE_WIDTH = 480;
const MOBILE_BREAKPOINT_PX = 980;

function renderWebdesignEmailHeadStyles() {
  return [
    `html,body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%!important;-ms-text-size-adjust:100%!important;text-size-adjust:100%!important}`,
    `.softora-webdesign-email-body{-webkit-text-size-adjust:100%!important;-ms-text-size-adjust:100%!important;text-size-adjust:100%!important}`,
    `.softora-coldmail-body{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;overflow-wrap:anywhere!important;word-break:normal!important}`,
    `.softora-coldmail-body p{font-size:16px!important;line-height:26px!important;max-width:100%!important;overflow-wrap:anywhere!important;word-break:normal!important}`,
    `@media only screen and (min-device-width:601px){.softora-coldmail-body{max-width:600px!important}}`,
    `@media only screen and (min-width:${MOBILE_BREAKPOINT_PX + 1}px) and (min-device-width:${MOBILE_BREAKPOINT_PX + 1}px){`,
    `.softora-mobile-image-pair,.softora-mobile-image-pair table,.softora-mobile-image-pair p,.softora-mobile-image-pair img{display:none!important;mso-hide:all!important;max-height:0!important;overflow:hidden!important;width:0!important;max-width:0!important;line-height:0!important;font-size:0!important}`,
    `.softora-desktop-image-pair{display:table!important;width:${DESKTOP_WEBDESIGN_WIDTH + DESKTOP_GAP_WIDTH + DESKTOP_MOCKUP_WIDTH}px!important;max-width:${DESKTOP_WEBDESIGN_WIDTH + DESKTOP_GAP_WIDTH + DESKTOP_MOCKUP_WIDTH}px!important;max-height:none!important;overflow:visible!important}`,
    `.softora-desktop-image-pair tr{display:table-row!important}`,
    `.softora-desktop-image-pair td{display:table-cell!important;max-height:none!important;overflow:hidden!important}`,
    `.softora-desktop-image-pair img{display:block!important;max-height:${DESKTOP_IMAGE_HEIGHT}px!important;overflow:visible!important}`,
    `}`,
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

function imageSource(image) {
  return normalizeString(image && (image.src || (image.cid ? `cid:${image.cid}` : '')));
}

function imageAlt(image, fallback) {
  return normalizeString(image && image.alt) || fallback;
}

function renderDesktopImage(image, fallbackAlt, width) {
  const src = imageSource(image);
  if (!src) return '';
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(
    imageAlt(image, fallbackAlt)
  )}" class="softora-webdesign-desktop-image" width="${width}" height="${DESKTOP_IMAGE_HEIGHT}" style="display:block;width:${width}px;max-width:${width}px;height:${DESKTOP_IMAGE_HEIGHT}px;max-height:${DESKTOP_IMAGE_HEIGHT}px;object-fit:cover;object-position:center top;border:0;outline:none;text-decoration:none;" />`;
}

function renderMobileImage(image, fallbackAlt, options = {}) {
  const src = imageSource(image);
  if (!src) return '';
  const isMockup = options.mockup === true;
  const className = isMockup
    ? 'softora-webdesign-image softora-webdesign-image--mockup'
    : 'softora-webdesign-image';
  const positionStyle = isMockup ? 'object-position:center top;' : '';
  const imageHtml = `<img src="${escapeHtml(src)}" alt="${escapeHtml(
    imageAlt(image, fallbackAlt)
  )}" class="${className}" width="100%" style="display:block;width:100%;max-width:100%;height:auto;max-height:none;object-fit:contain;${positionStyle}border:0;outline:none;text-decoration:none;font-size:0;line-height:0;" />`;
  return `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:0 0 16px 0;"><tr><td width="100%" style="display:block;padding:0;margin:0;width:100%;max-width:100%;font-size:0;line-height:0;overflow:visible;">${imageHtml}</td></tr></table>`;
}

function renderSingleImage(image, options = {}) {
  const src = imageSource(image);
  if (!src) return '';
  const width = Math.max(1, Number(options.width) || SINGLE_IMAGE_WIDTH);
  const margin = normalizeString(options.margin) || '24px 0 0 0';
  return `\n<table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:${width}px;max-width:100%;margin:${margin};"><tr><td width="${width}" style="padding:0;margin:0;width:${width}px;max-width:100%;font-size:0;line-height:0;overflow:visible;"><img src="${escapeHtml(
    src
  )}" alt="${escapeHtml(imageAlt(image, 'Webdesign'))}" width="${width}" style="display:block;width:${width}px;max-width:100%;max-height:960px;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;" /></td></tr></table>`;
}

function renderResponsiveImagePair(mainImage, mockupImage, options = {}) {
  const desktopMainHtml = renderDesktopImage(mainImage, 'Webdesign', DESKTOP_WEBDESIGN_WIDTH);
  const desktopMockupHtml = renderDesktopImage(mockupImage, 'Device mockup', DESKTOP_MOCKUP_WIDTH);
  const mobileMainHtml = renderMobileImage(mainImage, 'Webdesign');
  const mobileMockupHtml = renderMobileImage(mockupImage, 'Device mockup', { mockup: true });
  if (!desktopMainHtml || !desktopMockupHtml || !mobileMainHtml || !mobileMockupHtml) return '';

  const caption = normalizeString(options.caption) || WEBDESIGN_EMAIL_MOCKUP_CAPTION;
  const margin = normalizeString(options.margin) || '24px 0 0 0';
  return `\n<!-- ${WEBDESIGN_EMAIL_TEMPLATE_VERSION} --><div class="softora-mobile-image-pair" style="display:block;margin:${margin};padding:0;width:100%;max-width:100%;max-height:none;overflow:visible;font-size:0;line-height:0;">${mobileMainHtml}<p class="softora-mobile-mockup-caption" style="display:block;margin:20px 0 12px 0;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#111827;font-weight:700;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;">${escapeHtml(
    caption
  )}</p>${mobileMockupHtml}</div><table class="softora-desktop-image-pair" role="presentation" cellspacing="0" cellpadding="0" border="0" style="display:none;mso-hide:all;border-collapse:collapse;width:0;max-width:0;max-height:0;overflow:hidden;margin:${margin};font-size:0;line-height:0;"><tr><td width="${DESKTOP_WEBDESIGN_WIDTH}" valign="top" style="padding:0;margin:0;width:${DESKTOP_WEBDESIGN_WIDTH}px;max-width:${DESKTOP_WEBDESIGN_WIDTH}px;font-size:0;line-height:0;overflow:hidden;vertical-align:top;">${desktopMainHtml}</td><td width="${DESKTOP_GAP_WIDTH}" style="padding:0;margin:0;width:${DESKTOP_GAP_WIDTH}px;min-width:${DESKTOP_GAP_WIDTH}px;font-size:0;line-height:0;">&nbsp;</td><td width="${DESKTOP_MOCKUP_WIDTH}" valign="top" style="padding:0;margin:0;width:${DESKTOP_MOCKUP_WIDTH}px;max-width:${DESKTOP_MOCKUP_WIDTH}px;font-size:0;line-height:0;overflow:hidden;vertical-align:top;">${desktopMockupHtml}</td></tr></table>`;
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
  renderWebdesignImageSection,
};
