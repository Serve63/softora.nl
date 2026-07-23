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
      .map((image) => ({
        alt: String(image && image.alt || '').trim(),
        dataUrl: String(image && image.dataUrl || '').trim(),
      }))
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

  function getConversationImages(mail) {
    const threadImages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .flatMap((message) => Array.isArray(message && message.bodyImages) ? message.bodyImages : []);
    return merge(mail && mail.bodyImages, threadImages);
  }

  function getSentImageOwner(mail) {
    const sentMessages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => String(message && message.folder || '').trim().toLowerCase() === 'sent');
    const getAuthoredBody = global.SoftoraMailboxCampaignInbox?.stripQuotedReply;
    return sentMessages.find((message) => {
      const body = typeof getAuthoredBody === 'function'
        ? getAuthoredBody(message && message.body)
        : String(message && message.body || '');
      return /\[image:\s*[^\]]+\]/i.test(body);
    }) || sentMessages.find((message) => normalize(message && message.bodyImages).length) || null;
  }

  function createOwnershipPlan(mail, mainImages, hasMainPlaceholders) {
    const owner = hasMainPlaceholders ? null : getSentImageOwner(mail);
    const ownerImages = normalize(owner && owner.bodyImages);
    const visibleMainImages = normalize(mainImages);
    if (!owner) return { owner: null, mainImages: visibleMainImages, fallbackImages: [] };
    if (!ownerImages.length) return { owner, mainImages: [], fallbackImages: visibleMainImages };
    const reservedKeys = new Set(ownerImages.map(imageKey));
    return {
      owner,
      mainImages: visibleMainImages.filter((image) => !reservedKeys.has(imageKey(image))),
      fallbackImages: [],
    };
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
    const messageImages = context.imagesReady === false ? [] : normalize(message && message.bodyImages);
    const fallbackImages = sent && message === context.imageOwner ? context.fallbackImages : [];
    const imageState = {
      images: merge(messageImages, fallbackImages),
      optOutUrl: renderers.normalizeOptOutUrl(message && message.optOutUrl),
      senderEmail: renderers.normalizeEmail(message && message.accountEmail),
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
        ...(Array.isArray(message && message.bodyImages) ? message.bodyImages : []),
        ...(Array.isArray(message && message.threadMessages)
          ? message.threadMessages.flatMap((threadMessage) => (
              Array.isArray(threadMessage && threadMessage.bodyImages) ? threadMessage.bodyImages : []
            ))
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
    getConversationImages,
    merge,
    normalize,
    prepare,
    prewarm,
    renderThreadMessageBody,
    renderUnused,
    stage,
  };
  global.SoftoraMailboxImages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
