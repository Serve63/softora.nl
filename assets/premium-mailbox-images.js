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
      if (!getSources(message && message.bodyImages).length) continue;
      void prepare(message.bodyImages);
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

  const api = { prepare, prewarm, stage };
  global.SoftoraMailboxImages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
