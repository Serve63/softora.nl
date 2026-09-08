const { parseDocument, DomUtils } = require('htmlparser2');

function hasHiddenInlineStyle(style) {
  const properties = new Map();
  for (const declaration of String(style || '').replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase();
    const important = /!\s*important\s*$/.test(value);
    if (!properties.get(name)?.important || important) properties.set(name, { value: value.replace(/!\s*important\s*$/, '').trim(), important });
  }
  return properties.get('display')?.value === 'none' || ['hidden', 'collapse'].includes(properties.get('visibility')?.value);
}

function removeHiddenWebsitePreviewContent(html) {
  // Source HTML is untrusted. Hidden descendants must not become design copy,
  // navigation, image references or business identity, regardless of their text.
  // This removes explicit HTML/inline hiding; it does not emulate browser CSS.
  const document = parseDocument(String(html || ''), { decodeEntities: false });
  const pending = [...document.children];
  while (pending.length) {
    const node = pending.pop();
    const attributes = node.attribs || {};
    const hidden = node.type === 'comment' || ['script', 'style', 'noscript', 'template'].includes(node.name)
      || Object.prototype.hasOwnProperty.call(attributes, 'hidden') || hasHiddenInlineStyle(attributes.style);
    if (hidden) DomUtils.removeElement(node);
    else if (node.children) pending.push(...node.children);
  }
  return DomUtils.getOuterHTML(document, { encodeEntities: false });
}

module.exports = { removeHiddenWebsitePreviewContent };
