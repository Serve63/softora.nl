function createMailboxWebdesignLinkProvenance(options = {}) {
  const {
    getHtmlAttribute = () => '',
    getPublicBaseUrl = () => 'https://www.softora.nl',
    htmlToReadableText = () => '',
    normalizeString = (value) => String(value || '').trim(),
    safeUrl = () => null,
  } = options;

  function extractExistingUrl(text) {
    const source = String(text || '');
    const match = source.match(/(https?:\/\/[^\s)\]]*\/webdesign\/[a-z0-9-]+(?:\/concept)?(?:\?[^)\s\]]*)?|(?:^|[\s([])(\/?webdesign\/[a-z0-9-]+(?:\/concept)?(?:\?[^)\s\]]*)?))/i);
    const rawUrl = normalizeString(match && (match[2] || match[1] || ''));
    if (!rawUrl) return '';
    const cleanUrl = rawUrl.replace(/[),.;!?]+$/g, '');
    const absoluteUrl = /^https?:\/\//i.test(cleanUrl)
      ? cleanUrl
      : `${getPublicBaseUrl()}/${cleanUrl.replace(/^\/+/, '')}`;
    return absoluteUrl
      .replace(/\/webdesign\/([^/?#]+)(?:\/concept)?(?=([?#]|$))/i, '/webdesign/$1')
      .replace(/#.*$/g, '');
  }

  function extractExactLinkFromHtml(html) {
    const source = String(html || '');
    if (!source) return '';
    const configuredBase = safeUrl(getPublicBaseUrl());
    const allowedHosts = new Set([
      'softora.nl',
      configuredBase && configuredBase.hostname
        ? configuredBase.hostname.toLowerCase().replace(/^www\./, '')
        : '',
    ].filter(Boolean));

    for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const label = htmlToReadableText(match[2] || '').replace(/\s+/g, ' ').trim();
      if (!/^(?:(?:deze\s+)?link|hier)$/i.test(label)) continue;
      const contextStart = Math.max(0, Number(match.index) - 300);
      const contextEnd = Math.min(
        source.length,
        Number(match.index) + String(match[0] || '').length + 300
      );
      const contextSource = source.slice(contextStart, contextEnd);
      const anchorOffset = Number(match.index) - contextStart;
      const markedContext = `${contextSource.slice(0, anchorOffset)} MAILBOX_LINK_TARGET ${contextSource.slice(anchorOffset + String(match[0] || '').length)}`;
      const context = htmlToReadableText(markedContext).replace(/\s+/g, ' ');
      if (!/\b(?:webdesign|ontwerp)\b.{0,160}\bvia\s+(?:deze\s+)?MAILBOX_LINK_TARGET\b/i.test(context)) continue;
      const href = getHtmlAttribute(`<a ${match[1] || ''}>`, 'href');
      const parsed = safeUrl(href);
      if (!parsed) continue;
      const normalizedHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (!allowedHosts.has(normalizedHost)) continue;
      if (!/^\/webdesign\/[a-z0-9-]+(?:\/concept)?\/?$/i.test(parsed.pathname)) continue;
      return href;
    }
    return '';
  }

  function attachExactLinkToText(text, exactUrl) {
    const source = String(text || '');
    if (!exactUrl || extractExistingUrl(source)) return source;
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!/\b(?:deze link|hier)\b/i.test(lines[index])) continue;
      const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(' ');
      if (!/\b(?:webdesign|ontwerp)\b/i.test(context)) continue;
      lines[index] = lines[index].replace(/\b(?:deze link|hier)\b/i, (label) => `${label} [${exactUrl}]`);
      return lines.join('\n');
    }
    return source;
  }

  function needsHydration(message) {
    if (!message || message.originalCampaignOutbound !== true) return false;
    if (message.webdesignLinkEvidenceKnown === true) return false;
    const body = normalizeString(message.body || message.preview);
    if (!body || extractExistingUrl(body)) return false;
    return /\b(?:webdesign|ontwerp)\b[\s\S]{0,240}\b(?:deze link|(?:open|bekijk) het via hier)\b/i.test(body);
  }

  return {
    attachExactLinkToText,
    extractExactLinkFromHtml,
    extractExistingUrl,
    needsHydration,
  };
}

module.exports = {
  createMailboxWebdesignLinkProvenance,
};
