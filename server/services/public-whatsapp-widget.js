const MARTIJN_WHATSAPP_URL = 'https://wa.me/31643262792';
const PUBLIC_WHATSAPP_WIDGET_STYLESHEET = '/assets/public-whatsapp-widget.css?v=20260826a';
const PUBLIC_CONVERSION_TRACKER = '/assets/public-conversion-tracking.js?v=20260601a';

function escapeHtmlAttribute(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectBeforeHeadClose(htmlRaw, snippet) {
  const html = String(htmlRaw || '');
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  return `${snippet}\n${html}`;
}

function injectBeforeBodyClose(htmlRaw, snippet) {
  const html = String(htmlRaw || '');
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}`;
}

function addStylesheetIfMissing(htmlRaw) {
  const html = String(htmlRaw || '');
  if (/href=["']\/assets\/public-whatsapp-widget\.css(?:\?[^"']*)?["']/i.test(html)) return html;
  return injectBeforeHeadClose(
    html,
    `    <link rel="stylesheet" href="${PUBLIC_WHATSAPP_WIDGET_STYLESHEET}">`
  );
}

function addConversionTrackerIfMissing(htmlRaw) {
  const html = String(htmlRaw || '');
  if (/src=["']\/assets\/public-conversion-tracking\.js(?:\?[^"']*)?["']/i.test(html)) return html;
  return injectBeforeBodyClose(
    html,
    `    <script src="${PUBLIC_CONVERSION_TRACKER}" defer></script>`
  );
}

function markExistingWidget(htmlRaw) {
  const html = String(htmlRaw || '');
  if (/data-softora-whatsapp-widget=["']sitewide["']/i.test(html)) return html;
  return html.replace(
    /<div\b([^>]*class=["'][^"']*\bwhatsapp-widget\b[^"']*["'][^>]*)>/i,
    '<div$1 data-softora-whatsapp-widget="sitewide">'
  );
}

function buildPublicWhatsappWidget(pagePathRaw) {
  const pagePath = escapeHtmlAttribute(pagePathRaw || '/');
  return [
    '    <div class="whatsapp-widget" data-softora-whatsapp-widget="sitewide">',
    '      <span class="whatsapp-widget-label" aria-hidden="true">WhatsApp ons</span>',
    `      <a href="${MARTIJN_WHATSAPP_URL}" class="whatsapp-widget-btn" target="_blank" rel="noopener noreferrer" aria-label="Open WhatsApp-chat met Softora" data-softora-conversion="sitewide-whatsapp-widget" data-softora-conversion-page="${pagePath}" data-softora-conversion-target="whatsapp">`,
    '        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
    '          <path d="M12.04 2.33A9.7 9.7 0 0 0 2.8 16.26L1 22l5.89-1.54a9.68 9.68 0 0 0 5.13 1.47h.01A9.7 9.7 0 0 0 21.74 12.24a9.7 9.7 0 0 0-9.7-9.91Zm5.98 15.92a8.08 8.08 0 0 1-6 2.67h-.01a8.02 8.02 0 0 1-4.09-1.12l-.29-.17-3.49.91.94-3.39-.19-.3a8.03 8.03 0 0 1-1.23-4.28 8.1 8.1 0 0 1 8.11-8.1 8.09 8.09 0 0 1 5.75 2.38 8.04 8.04 0 0 1 2.38 5.74 8.08 8.08 0 0 1-1.88 5.66Z"/>',
    '          <path d="M16.48 13.92c-.24-.12-1.41-.7-1.63-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.75.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.19-.71-.64-1.2-1.42-1.34-1.66-.13-.24-.01-.37.11-.5.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.29-.74-1.77-.19-.47-.39-.4-.53-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.83.81-.83 1.98 0 1.17.85 2.3.97 2.46.12.16 1.68 2.56 4.07 3.6.57.25 1.01.4 1.37.51.57.18 1.1.16 1.49.09.46-.07 1.41-.57 1.6-1.13.2-.56.2-1.03.14-1.13-.06-.1-.22-.16-.46-.28Z"/>',
    '        </svg>',
    '      </a>',
    '    </div>',
  ].join('\n');
}

function addPublicWhatsappWidgetIfMissing(htmlRaw, { pagePath = '/' } = {}) {
  let html = String(htmlRaw || '');
  if (!html) return html;

  // Reading pages keep a persistent contact button in the header, clear of the text.
  if (/<body\b[^>]*data-softora-contact-placement=["']header["']/i.test(html)
    && /<a\b(?=[^>]*\bclass=["'][^"']*\bcontent-header-contact\b)(?=[^>]*\bhref=["']https:\/\/wa\.me\/31643262792["'])[^>]*>/i.test(html)) {
    return addConversionTrackerIfMissing(html);
  }

  html = addStylesheetIfMissing(html);
  if (/class=["'][^"']*\bwhatsapp-widget\b[^"']*["']/i.test(html)) {
    html = markExistingWidget(html);
  } else {
    html = injectBeforeBodyClose(html, buildPublicWhatsappWidget(pagePath));
  }
  return addConversionTrackerIfMissing(html);
}

module.exports = {
  MARTIJN_WHATSAPP_URL,
  PUBLIC_WHATSAPP_WIDGET_STYLESHEET,
  addPublicWhatsappWidgetIfMissing,
};
