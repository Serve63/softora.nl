(function (global) {
  'use strict';

  const MAX_CACHED_IMAGES = 24;
  const LOAD_TIMEOUT_MS = 15_000;
  const cache = new Map();
  let renderRequest = 0;

  function getSources(images) {
    const isSafeImageSource = global.SoftoraMailboxCampaignInbox?.isSafeImageSource;
    if (typeof isSafeImageSource !== 'function') return [];
    return (Array.isArray(images) ? images : [])
      .map((image) => String(image && image.dataUrl || '').trim())
      .filter((source, index, sources) => isSafeImageSource(source) && sources.indexOf(source) === index);
  }

  function normalizeLabel(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.[a-z0-9]{2,5}$/gi, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalize(images) {
    const isSafeImageSource = global.SoftoraMailboxCampaignInbox?.isSafeImageSource;
    if (typeof isSafeImageSource !== 'function') return [];
    return (Array.isArray(images) ? images : [])
      .map((image) => {
        const normalized = {
          alt: String(image && image.alt || '').trim(),
          dataUrl: String(image && image.dataUrl || '').trim(),
        };
        if (String(image && image.owner || '').trim().toLowerCase() === 'sent-campaign') {
          normalized.owner = 'sent-campaign';
        }
        return normalized;
      })
      .filter((image) => image.alt && isSafeImageSource(image.dataUrl));
  }

  function imageKey(image) {
    return normalizeLabel(image && image.alt) || String(image && image.dataUrl || '').trim();
  }

  function merge(...collections) {
    const seen = new Set();
    return collections.flatMap(normalize).filter((image) => {
      const key = imageKey(image);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isSentCampaignImage(image) {
    if (String(image && image.owner || '').trim().toLowerCase() === 'sent-campaign') return true;
    return /\b(?:webdesign|preview|device mockup|mockup|website generator)\b/.test(
      normalizeLabel(image && image.alt)
    );
  }

  function getMessageImages(message) {
    const images = normalize(message && message.bodyImages);
    const folder = String(message && message.folder || '').trim().toLowerCase();
    if (folder === 'sent' && message && message.originalCampaignOutbound === true) {
      return images;
    }
    return images.filter((image) => !isSentCampaignImage(image));
  }

  function getConversationImages(mail) {
    const threadImages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .flatMap(getMessageImages);
    return merge(getMessageImages(mail), threadImages);
  }

  function normalizeMessageId(value) {
    return String(value || '')
      .trim()
      .replace(/^<+|>+$/g, '')
      .toLowerCase();
  }

  function getMessageIdentity(message) {
    const account = String(message && message.accountEmail || '').trim().toLowerCase();
    const messageId = normalizeMessageId(message && message.messageId);
    if (account && messageId) return `${account}|message:${messageId}`;
    const mailboxId = String(message && (message.mailboxId || message.id) || '').trim();
    return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
  }

  function isSameMessage(left, right) {
    if (left === right) return true;
    const leftIdentity = getMessageIdentity(left);
    const rightIdentity = getMessageIdentity(right);
    return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
  }

  function sectionHasPlaceholder(section) {
    return Boolean(section && Array.isArray(section.lines) && section.lines.some((line) => (
      /^\s*\[image:\s*[^\]]+\]\s*$/i.test(String(line || ''))
    )));
  }

  function isOwnQuoteSection(section, isReplyHeaderLine, isOwnReplyHeaderLine) {
    if (!section || section.type !== 'quote' || !Array.isArray(section.lines)) return false;
    const firstLine = String(section.lines[0] || '').trim();
    return typeof isReplyHeaderLine === 'function' &&
      typeof isOwnReplyHeaderLine === 'function' &&
      isReplyHeaderLine(firstLine) &&
      isOwnReplyHeaderLine(firstLine);
  }

  function getSentImageOwner(mail) {
    const sentMessages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => (
        String(message && message.folder || '').trim().toLowerCase() === 'sent' &&
        message && message.originalCampaignOutbound === true
      ));
    return sentMessages.find((message) => getMessageImages(message).length) || null;
  }

  function getAuthoredBody(message) {
    const stripQuotedReply = global.SoftoraMailboxCampaignInbox?.stripQuotedReply;
    return typeof stripQuotedReply === 'function'
      ? stripQuotedReply(message && message.body)
      : String(message && message.body || '');
  }

  function looksLikeSentWebdesignCampaign(message) {
    const body = getAuthoredBody(message)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!body) return false;
    const signals = [
      /\b(?:afgelopen|vorige)\s+week kwam ik (?:jullie|je) website\b/,
      /\b(?:uit|vanuit)\s+enthousiasme\b.{0,100}\b(?:fris|nieuw)\s+webdesign\b/,
      /\bik heb\b.{0,100}\b(?:fris|nieuw)\s+webdesign\b.{0,80}\bgemaakt\b/,
      /\bik ben oprecht benieuwd wat je ervan vindt\b/,
      /\bonline preview\b/,
      /\bontwerp in de bijlage\b/,
      /\bwebdesign\b.{0,80}\bbekijken\b/,
    ];
    return signals.filter((pattern) => pattern.test(body)).length >= 2;
  }

  function getSentCampaignOwner(mail) {
    return (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => (
        String(message && message.folder || '').trim().toLowerCase() === 'sent' &&
        message && message.originalCampaignOutbound === true
      ))
      .find(looksLikeSentWebdesignCampaign) || null;
  }

  function createOwnershipPlan(mail, mainImages, hasMainPlaceholders, options = {}) {
    const visibleMainImages = getMessageImages({
      ...mail,
      bodyImages: normalize(mainImages),
    });
    return {
      owner: null,
      mainImages: visibleMainImages,
      fallbackImages: [],
      quoteImages: [],
    };
  }

  function createSectionOwnershipPlan(mail, mainImages, sections, isReplyHeaderLine, isOwnReplyHeaderLine) {
    const bodySections = Array.isArray(sections) ? sections : [];
    const hasMainPlaceholders = bodySections.some(sectionHasPlaceholder);
    const hasOwnQuotePlaceholders = bodySections.some((section) => (
      isOwnQuoteSection(section, isReplyHeaderLine, isOwnReplyHeaderLine) &&
      sectionHasPlaceholder(section)
    ));
    return createOwnershipPlan(mail, mainImages, hasMainPlaceholders, { hasOwnQuotePlaceholders });
  }

  function renderInlineImage(image, escapeHtml) {
    const dataUrl = String(image && image.dataUrl || '').trim();
    const isSafeImageSource = global.SoftoraMailboxCampaignInbox?.isSafeImageSource;
    if (typeof isSafeImageSource !== 'function' || !isSafeImageSource(dataUrl)) return '';
    const alt = String(image && image.alt || 'Afbeelding').trim() || 'Afbeelding';
    const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
    return `<figure class="detail-mail-image"><img src="${escape(dataUrl)}" alt="${escape(alt)}" loading="eager" decoding="async" fetchpriority="high" data-mailbox-inline-image></figure>`;
  }

  function prepareOwnQuote(images, baseState, renderImage) {
    const imageState = {
      images: normalize(images),
      optOutUrl: baseState && baseState.optOutUrl,
      senderEmail: baseState && baseState.senderEmail,
      usedImages: new Set(),
    };
    return {
      imageState,
      html: renderUnused(imageState, renderImage, { inline: true }),
    };
  }

  function renderOwnQuoteSection(images, baseState, renderImage) {
    const prepared = prepareOwnQuote(images, baseState, renderImage);
    if (!prepared.html) return '';
    return `
      <section class="detail-mail-section detail-mail-section-history-sent" aria-label="Ingesloten berichtgeschiedenis">
        <div class="detail-mail-section-label">Eerdere mail</div>
        <div class="detail-mail-quote-body">${prepared.html}</div>
      </section>`;
  }

  function renderUnused(imageState, renderImage, options = {}) {
    if (
      !imageState ||
      !Array.isArray(imageState.images) ||
      !imageState.usedImages ||
      typeof imageState.usedImages.has !== 'function' ||
      typeof imageState.usedImages.add !== 'function'
    ) return '';
    const unused = imageState.images
      .map((image, index) => ({ image, index }))
      .filter((entry) => !imageState.usedImages.has(entry.index));
    unused.forEach((entry) => imageState.usedImages.add(entry.index));
    const html = unused.map((entry) => renderImage(entry.image)).filter(Boolean).join('');
    if (!html) return '';
    return options.inline
      ? `<div class="detail-mail-thread-images">${html}</div>`
      : `<section class="detail-mail-section detail-mail-section-images">${html}</section>`;
  }

  function renderThreadMessageBody(payload, context, renderers) {
    const message = payload && payload.message;
    const sent = Boolean(payload && payload.sent);
    const messageImages = context.imagesReady === false ? [] : getMessageImages(message);
    const fallbackImages = sent && isSameMessage(message, context.imageOwner) ? context.fallbackImages : [];
    const imageState = {
      images: merge(messageImages, fallbackImages),
      optOutUrl: renderers.normalizeOptOutUrl(message && message.optOutUrl),
      senderEmail: renderers.normalizeEmail(message && message.accountEmail),
      mail: message,
      usedImages: new Set(),
    };
    const paragraphs = renderers.renderParagraphs(String(payload && payload.body || '').split('\n'), imageState);
    const unusedImages = sent ? renderUnused(imageState, renderers.renderInlineImage, { inline: true }) : '';
    return `${paragraphs}${unusedImages}`;
  }

  function pruneCache() {
    while (cache.size > MAX_CACHED_IMAGES) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  function loadSource(source) {
    const cached = cache.get(source);
    if (cached) return cached.settled ? null : cached.promise;
    if (typeof global.Image !== 'function') return null;

    const entry = { finishing: false, settled: false, promise: null };
    entry.promise = new Promise((resolve) => {
      const image = new global.Image();
      let timer = null;
      const finish = async () => {
        if (entry.finishing || entry.settled) return;
        entry.finishing = true;
        if (timer) global.clearTimeout(timer);
        try {
          if (image.complete && image.naturalWidth > 0 && typeof image.decode === 'function') {
            await image.decode();
          }
        } catch (_) {
          // Het load-event bewijst al dat de bytes beschikbaar zijn; decode kan per browser alsnog weigeren.
        }
        entry.settled = true;
        resolve();
      };
      image.onload = finish;
      image.onerror = finish;
      image.decoding = 'async';
      image.fetchPriority = 'high';
      image.src = source;
      timer = global.setTimeout(finish, LOAD_TIMEOUT_MS);
      if (image.complete) void finish();
    });
    cache.set(source, entry);
    pruneCache();
    return entry.promise;
  }

  function prepare(images) {
    const pending = getSources(images).map(loadSource).filter(Boolean);
    return pending.length ? Promise.allSettled(pending) : null;
  }

  function prewarm(messages, maxMessages = 2) {
    let warmed = 0;
    for (const message of Array.isArray(messages) ? messages : []) {
      const conversationImages = [
        ...getMessageImages(message),
        ...(Array.isArray(message && message.threadMessages)
          ? message.threadMessages.flatMap(getMessageImages)
          : []),
      ];
      if (!getSources(conversationImages).length) continue;
      void prepare(conversationImages);
      warmed += 1;
      if (warmed >= Math.max(1, Number(maxMessages) || 1)) break;
    }
  }

  function stage(images, isCurrent, render) {
    const request = ++renderRequest;
    const pending = prepare(images);
    if (!pending) return false;
    void pending.finally(() => {
      if (request !== renderRequest || (typeof isCurrent === 'function' && !isCurrent())) return;
      if (typeof render === 'function') render();
    });
    return true;
  }

  const api = {
    createOwnershipPlan,
    createSectionOwnershipPlan,
    getConversationImages,
    getMessageImages,
    isOwnQuoteSection,
    merge,
    normalize,
    prepare,
    prepareOwnQuote,
    prewarm,
    renderInlineImage,
    renderOwnQuoteSection,
    renderThreadMessageBody,
    renderUnused,
    sectionHasPlaceholder,
    stage,
  };
  global.SoftoraMailboxImages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
