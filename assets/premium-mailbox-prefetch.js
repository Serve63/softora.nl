// Mailbox prefetch: once the open conversation is on screen, the next few
// conversations in the list are prepared in the background (body with AI
// presentation, contact timeline, earlier messages, images), so a click can
// render the complete conversation at once instead of "E-mail laden...".
// Nothing here renders, selects or marks as read; an open conversation is
// always left to the regular detail load.
(function (global) {
  'use strict';

  const DEFAULT_MAX = 6;
  const DEFAULT_DELAY_MS = 1200;

  function create(options = {}) {
    const max = Math.max(1, Number(options.max) || DEFAULT_MAX);
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : DEFAULT_DELAY_MS;
    const schedule = options.schedule || ((callback, ms) => global.setTimeout(callback, ms));
    const cancel = options.cancel || ((timer) => global.clearTimeout(timer));
    let generation = 0;
    let timer = null;
    let controller = null;

    const isActive = (mail) => String(options.getActiveMail?.() || '') === String(mail?.id || '');

    async function warm(run) {
      const current = () => run === generation;
      const signal = controller?.signal;
      const mails = (options.getMails?.() || []).filter((mail) => mail && !isActive(mail)).slice(0, max);
      if (!mails.length) return;
      try {
        await options.index?.prefetchRootBodies?.({
          mails, getRequest: options.getRequest, getActiveMail: options.getActiveMail, fetchImpl: options.fetch, signal,
        });
      } catch (_) { /* The detail load fetches it on click. */ }
      for (const mail of mails) {
        if (!current()) return;
        if (isActive(mail)) continue;
        try {
          await options.discovery?.prefetchContactTimeline?.(mail, { signal });
          if (!current() || isActive(mail)) continue;
          if (mail.bodyLoaded && options.shouldHydrateThread?.(mail)) {
            // A failed warm-up must never leave an error that stops the
            // detail load from trying again on click.
            const priorErrors = new Map((mail.threadMessages || []).map((message) => [message, message?.bodyLoadError || '']));
            await options.index?.loadThreadBodies?.({
              mail, normalizeBodyImages: options.normalizeBodyImages, normalizeOptOutUrl: options.normalizeOptOutUrl,
              getActiveMail: options.getActiveMail, openMail: options.openMail, fetchImpl: options.fetch, signal,
              isCurrent: () => current() && !isActive(mail),
            });
            priorErrors.forEach((prior, message) => { if (!prior && message?.bodyLoadError) message.bodyLoadError = ''; });
          }
        } catch (_) { /* Best effort: the detail load remains the source of truth. */ }
      }
      if (current()) options.images?.prewarm?.(mails, max);
    }

    function scheduleWarm() {
      stop();
      const run = generation;
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      timer = schedule(() => {
        timer = null;
        if (run !== generation) return;
        void warm(run);
      }, delayMs);
    }

    function stop() {
      generation += 1;
      if (timer) cancel(timer);
      timer = null;
      controller?.abort?.();
      controller = null;
    }

    return { schedule: scheduleWarm, stop, warmNow: () => { stop(); const run = generation; controller = typeof AbortController === 'function' ? new AbortController() : null; return warm(run); } };
  }

  const api = Object.freeze({ create });
  global.SoftoraMailboxPrefetch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
