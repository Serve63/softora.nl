(function (root) {
  'use strict';

  function render(section, imageState, leadingHtml = '', options = {}) {
    const sectionLead = String(leadingHtml || '');
    const embeddedIncoming = options.embeddedIncoming === true;
    const rootIncomingQuote = options.rootIncomingQuote === true;
    const escapeHtml = options.escapeHtml || String;
    const renderParagraphs = options.renderParagraphs || (() => '');
    const trimQuotedLines = options.trimQuotedLines || ((lines) => lines);
    const renderInlineImage = options.renderInlineImage || (() => '');
    if (!section || !Array.isArray(section.lines)) {
      return `<section class="detail-mail-section">${sectionLead}<p>Geen inhoud.</p></section>`;
    }
    if (section.type === 'quote') {
      const firstLine = String(section.lines[0] || '').trim();
      const hasMeta = options.isReplyHeaderLine(firstLine);
      const quoteMeta = hasMeta ? `<div class="detail-mail-quote-meta">${escapeHtml(firstLine)}</div>` : '';
      const isOwnQuote = !embeddedIncoming && hasMeta && options.isOwnReplyHeaderLine(firstLine);
      // Een citaat in een ontvangen bronmail is geen canoniek timelinebericht,
      // ongeacht of de afzender uit de geciteerde header betrouwbaar herkenbaar is.
      // Echte uitgaande berichten worden afzonderlijk uit threadMessages gerenderd.
      if (rootIncomingQuote) return '';
      const quoteLabel = isOwnQuote
        ? '<div class="detail-mail-section-label">Eerdere mail</div>'
        : '';
      const quoteLines = trimQuotedLines(hasMeta ? section.lines.slice(1) : section.lines, isOwnQuote ? options.ownReplyAuthorPattern : null);
      const preparedImages = isOwnQuote && imageState.quoteImages.length
        ? options.prepareOwnQuote(imageState.quoteImages.splice(0), imageState, renderInlineImage)
        : { imageState, html: '' };
      return `
      <section class="detail-mail-section ${isOwnQuote ? 'detail-mail-section-history-sent' : 'detail-mail-section-history'}" aria-label="Ingesloten berichtgeschiedenis">
        ${sectionLead}
        ${quoteLabel}
        ${quoteMeta}
        <div class="detail-mail-quote-body">${renderParagraphs(quoteLines, { quoteBody: true, images: preparedImages.imageState.images, optOutUrl: preparedImages.imageState.optOutUrl, senderEmail: preparedImages.imageState.senderEmail, usedImages: preparedImages.imageState.usedImages })}${preparedImages.html}</div>
      </section>`;
    }
    if (section.type === 'signature') {
      return `
      <section class="detail-mail-section detail-mail-section-signature">
        ${sectionLead}
        ${renderParagraphs(section.lines, imageState)}
      </section>`;
    }
    return `
    <section class="detail-mail-section">
      ${sectionLead}
      ${renderParagraphs(section.lines, imageState)}
    </section>`;
  }

  const api = { render };
  if (root) root.SoftoraMailboxBodySection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
