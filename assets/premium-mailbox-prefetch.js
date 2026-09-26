// Mailbox prefetch: prepare the entire list in bounded background batches,
// prioritizing visible and pointed-at conversations (body with AI
// presentation, contact timeline, earlier messages, images), so a click can
// render the complete conversation at once instead of "E-mail laden...".
// Nothing here renders, selects or marks as read; an open conversation is
// always left to the regular detail load.
(function (global) {
  'use strict';

  const DEFAULT_MAX = 6;
  const DEFAULT_DELAY_MS = 0;
  const STALE_RETRY_MS = 60000;

  function create(options = {}) {
    const max = Math.max(1, Number(options.max) || DEFAULT_MAX);
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : DEFAULT_DELAY_MS;
    const schedule = options.schedule || ((callback, ms) => global.setTimeout(callback, ms));
    const cancel = options.cancel || ((timer) => global.clearTimeout(timer));
    let generation = 0;
    let timer = null;
    let controller = null;
    let running = false;
    let rerun = false;
    const warmed = new WeakSet();
    const staleAttempts = new WeakMap();
    const now = options.now || (() => Date.now());
    const concurrency = Math.max(1, Math.min(3, Number(options.concurrency) || 3));
    let priorityId = '';
    const listElement = options.getListElement?.();

    function visibleIds() {
      const bounds = listElement?.getBoundingClientRect?.();
      if (!bounds) return [];
      return Array.from(listElement.querySelectorAll('[data-mailbox-action="open-mail"]'))
        .filter((row) => { const rect = row.getBoundingClientRect(); return rect.bottom >= bounds.top && rect.top <= bounds.bottom + bounds.height; })
        .map((row) => row.getAttribute('data-mailbox-id'));
    }

    const isActive = (mail) => String(options.getActiveMail?.() || '') === String(mail?.id || '');

    // Visible and intended conversations first, then neighbours and the rest.
    function pickMails() {
      const list = (options.getMails?.() || []).filter(Boolean);
      const activeIndex = list.findIndex(isActive);
      const byId = new Map(list.map((mail) => [String(mail.id), mail]));
      const priority = [priorityId, ...visibleIds()].map((id) => byId.get(String(id))).filter(Boolean);
      const ordered = [...priority, ...(activeIndex >= 0 ? list.slice(activeIndex + 1, activeIndex + 1 + max) : []), ...list];
      // A dossier that a list refresh marked stale is warmed again (at most
      // once a minute, so a dossier that cannot refresh is not retried per render).
      const staleDue = (mail) => mail.contactTimelineNeedsRefresh === true &&
        (!staleAttempts.has(mail) || now() - staleAttempts.get(mail) >= STALE_RETRY_MS);
      return [...new Set(ordered)].filter((mail) => !isActive(mail) &&
        (!warmed.has(mail) || staleDue(mail))).slice(0, max);
    }

    async function warm(run) {
      const current = () => run === generation && !signal?.aborted;
      const signal = controller?.signal;
      await options.whenReady?.();
      if (!current()) return;
      const mails = pickMails();
      if (!mails.length) return;
      try {
        await options.index?.prefetchRootBodies?.({
          mails, getRequest: options.getRequest, getActiveMail: options.getActiveMail, fetchImpl: options.fetch, signal,
        });
      } catch (_) { /* The detail load fetches it on click. */ }
      let cursor = 0;
      async function worker() {
        while (cursor < mails.length && current()) {
          const mail = mails[cursor++];
          if (isActive(mail)) continue;
          try {
            if (mail.contactTimelineNeedsRefresh === true) staleAttempts.set(mail, now());
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
          // Attempted once per loaded message object; a failure is left to the click.
          if (current() && !isActive(mail)) warmed.add(mail);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, mails.length) }, worker));
      if (current()) options.images?.prewarm?.(mails, max);
    }

    async function runWarm() {
      running = true;
      try {
        do {
          rerun = false;
          const run = generation;
          await warm(run);
          // Drain the entire list in bounded batches, re-reading viewport
          // priority between batches. Stop does not restart the old scope.
          if (run === generation && pickMails().length) rerun = true;
        } while (rerun && !controller?.signal.aborted);
      } finally {
        running = false;
      }
    }

    // Renders of the open conversation (refreshes, images, AI) happen often;
    // they must not restart or abort a warm-up that is making progress.
    function scheduleWarm() {
      if (!controller) controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (running) { rerun = true; return; }
      if (timer) return;
      timer = schedule(() => {
        timer = null;
        void runWarm();
      }, delayMs);
    }

    function stop() {
      generation += 1;
      rerun = false;
      priorityId = '';
      if (timer) cancel(timer);
      timer = null;
      controller?.abort?.();
      controller = null;
    }

    function prioritize(event) {
      const row = event.target?.closest?.('[data-mailbox-action="open-mail"]');
      if (row) priorityId = row.getAttribute('data-mailbox-id') || '';
      scheduleWarm();
    }
    listElement?.addEventListener?.('pointerover', prioritize, { passive: true });
    listElement?.addEventListener?.('focusin', prioritize);
    listElement?.addEventListener?.('scroll', scheduleWarm, { passive: true });
    return { schedule: scheduleWarm, stop, warmNow: () => { stop(); controller = typeof AbortController === 'function' ? new AbortController() : null; return runWarm(); } };
  }

  const api = Object.freeze({ create });
  global.SoftoraMailboxPrefetch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
