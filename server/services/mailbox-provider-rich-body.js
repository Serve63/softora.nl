const { parseDocument } = require('htmlparser2');

const SKIPPED_TAGS = new Set([
  'head',
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

function decodeMailboxEntities(value) {
  const raw = String(value || '');
  if (!raw.includes('&')) return raw;
  const document = parseDocument(raw.replace(/</g, '&lt;').replace(/>/g, '&gt;'), { decodeEntities: true });
  return document.children.map((node) => node.data || '').join('').replace(/\u00a0/g, ' ');
}

function isMailboxHtml(value) {
  return /<\/?(?:html|body|head|div|p|br|a|span|table|tbody|tr|td|th|blockquote|img|b|strong|i|em|ul|ol|li|h[1-6]|section|article|font|hr|style|script)(?:\s[^<>]*|\s*\/?)>/i.test(String(value || ''));
}

function safeProviderLink(value) {
  try { return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value).protocol); }
  catch (_) { return false; }
}

function imageLabel(node) {
  const attributes = node.attribs || {};
  if (['width', 'height'].some((key) => /^(?:0|1)(?:px)?$/.test(String(attributes[key] || '')))) return '';
  return normalizeText(attributes.alt);
}

function parseProviderHtml(value, { includeImageLabels = false, includeLinkTargets = true } = {}) {
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
    if (String(node.name || '').toLowerCase() === 'img') return imageLabel(node);
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
    if (tag === 'img') {
      const label = imageLabel(node);
      if (includeImageLabels && label) append(`\n[image: ${label}]\n`);
      return;
    }
    if (tag === 'br') {
      append('\n');
      return;
    }
    if (tag === 'a') {
      const label = normalizeText(readPlainText(node).replace(/\s+/g, ' '));
      const href = normalizeText(node.attribs && node.attribs.href);
      if (!includeLinkTargets) { append(label); return; }
      if (
        /^(?:deze\s+link|link|hier)$/i.test(label) &&
        isExactSoftoraWebdesignUrl(href)
      ) {
        append(`${label} [${href}]`);
        if (!webdesignLinkUrl) webdesignLinkUrl = href;
      } else if (safeProviderLink(href)) {
        const readableLabel = label || href;
        const labelIsTarget = readableLabel === href || href === `mailto:${readableLabel}` || href === `tel:${readableLabel}`;
        append(labelIsTarget ? readableLabel : `[${readableLabel.replace(/[\[\]]/g, '')}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`);
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

// Restore only whitespace proven by the corresponding HTML. A divergent plain-text
// alternative must never be replaced by HTML content, even when HTML looks nicer.
function restoreMailboxParagraphs(body, html, { allowHtmlOnlyLines = false } = {}) {
  const original = String(body || '');
  if (!html || !original.trim()) return original;
  let formatted = parseProviderHtml(html, { includeLinkTargets: false }).body;
  const compact = (value) => String(value).replace(/\s/g, '');
  // Display-only recovery: a plain alternative may omit complete HTML-only
  // footer blocks. Match every plain character to whole HTML lines in order;
  // never import those extra blocks or accept changed/partial line contents.
  if (allowHtmlOnlyLines && compact(formatted) !== compact(original)) {
    const target = compact(original), lines = formatted.split('\n');
    const rows = lines.flatMap((line, index) => compact(line) ? [{ line, index, key: compact(line) }] : []);
    function align(reverse) {
      const selected = [], ordered = reverse ? rows.slice().reverse() : rows;
      let offset = reverse ? target.length : 0;
      for (const row of ordered) {
        const start = reverse ? offset - row.key.length : offset;
        if (start < 0 || target.slice(start, start + row.key.length) !== row.key) continue;
        selected.push(row);
        offset = reverse ? start : offset + row.key.length;
      }
      return offset === (reverse ? 0 : target.length) ? (reverse ? selected.reverse() : selected) : null;
    }
    const forward = align(false), backward = align(true);
    if (!forward || !backward || forward.length !== backward.length ||
      forward.some((row, i) => row.index !== backward[i].index)) return original;
    formatted = forward.map((row, i) => `${i ? (row.index === forward[i - 1].index + 1 ? '\n' : '\n\n') : ''}${row.line}`).join('');
  }
  if (compact(formatted) !== compact(original)) return original;
  if (allowHtmlOnlyLines) {
    const breaks = (value) => {
      let offset = 0;
      const positions = new Set();
      for (const token of value.match(/\S+|\s+/g) || []) {
        if (/\S/.test(token)) offset += token.length;
        else if (token.includes('\n')) positions.add(offset);
      }
      return positions;
    };
    const existing = breaks(original);
    return [...breaks(formatted)].some((offset) => !existing.has(offset)) ? formatted : original;
  }
  const repairsJoinedWords = formatted.split(/\s+/).length > original.trim().split(/\s+/).length;
  return repairsJoinedWords ? formatted : original;
}

module.exports = {
  restoreMailboxParagraphs,
  decodeMailboxEntities,
  isMailboxHtml,
  isExactSoftoraWebdesignUrl,
  parseProviderHtml,
};
