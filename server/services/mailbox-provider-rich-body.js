const { parseDocument } = require('htmlparser2');

const SKIPPED_TAGS = new Set([
  'head',
  'img',
  'noscript',
  'script',
  'style',
  'svg',
  'template',
]);
const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'section',
  'tr',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function isExactSoftoraWebdesignUrl(value) {
  try {
    const parsed = new URL(normalizeText(value));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      host === 'softora.nl' &&
      /^\/webdesign\/[a-z0-9-]+(?:\/concept)?\/?$/i.test(parsed.pathname)
    );
  } catch (_) {
    return false;
  }
}

function normalizeRenderedMailboxText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseProviderHtml(value) {
  const html = normalizeText(value);
  if (!html) {
    return {
      body: '',
      webdesignLinkEvidenceKnown: false,
      webdesignLinkUrl: '',
    };
  }

  let document;
  try {
    document = parseDocument(html, {
      decodeEntities: true,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    });
  } catch (_) {
    return {
      body: '',
      webdesignLinkEvidenceKnown: false,
      webdesignLinkUrl: '',
    };
  }

  const output = [];
  let webdesignLinkUrl = '';

  function append(valueToAppend) {
    const text = String(valueToAppend || '');
    if (text) output.push(text);
  }

  function readPlainText(node) {
    if (!node) return '';
    if (node.type === 'text') return String(node.data || '');
    if (SKIPPED_TAGS.has(String(node.name || '').toLowerCase())) return '';
    return (Array.isArray(node.children) ? node.children : [])
      .map(readPlainText)
      .join('');
  }

  function visit(node) {
    if (!node) return;
    if (node.type === 'text') {
      append(String(node.data || '').replace(/\s+/g, ' '));
      return;
    }
    const tag = String(node.name || '').toLowerCase();
    if (SKIPPED_TAGS.has(tag)) return;
    if (tag === 'br') {
      append('\n');
      return;
    }
    if (tag === 'a') {
      const label = normalizeText(readPlainText(node).replace(/\s+/g, ' '));
      const href = normalizeText(node.attribs && node.attribs.href);
      if (
        /^(?:deze\s+link|link|hier)$/i.test(label) &&
        isExactSoftoraWebdesignUrl(href)
      ) {
        append(`${label} [${href}]`);
        if (!webdesignLinkUrl) webdesignLinkUrl = href;
      } else {
        append(label);
      }
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) append('\n\n');
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
    if (isBlock) append('\n\n');
  }

  (Array.isArray(document.children) ? document.children : []).forEach(visit);
  const body = normalizeRenderedMailboxText(output.join(''));
  return {
    body,
    webdesignLinkEvidenceKnown: Boolean(webdesignLinkUrl),
    webdesignLinkUrl,
  };
}

module.exports = {
  isExactSoftoraWebdesignUrl,
  parseProviderHtml,
};
