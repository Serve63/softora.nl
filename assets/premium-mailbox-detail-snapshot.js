// Complete mailbox views are retained per signed-in user and mailbox scope.
// They remain inert until the controller commits the verified live conversation.
(function (global) {
  'use strict';

  const MAX_CHARS = 400000;
  let snapshot = null;

  // Complete rendered conversations survive navigation/reload. This is a
  // bounded, session-scoped display cache, never a source for mail actions.
  function createPreparedViews(options = {}) {
    const store = options.store || global.SoftoraReadModelStore;
    const documentRef = options.document || global.document;
    const now = options.now || Date.now;
    const getIdentity = options.getIdentity || (() => {
      const session = global.SoftoraPageBootstrapSession?.get?.();
      return session?.authenticated ? String(session.userId || session.email || '').trim().toLowerCase() : '';
    });
    const identity = getIdentity();
    // Previous rendered HTML can contain quotes that the current renderer now proves.
    const key = 'mailbox-prepared-views:v2';
    const maxTotalChars = 3_000_000;
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const views = new Map();
    let showing = false, timer = null, revision = 0;
    const current = () => identity && identity === getIdentity();
    const valid = (value) => value && typeof value.html === 'string' && value.html.length <= MAX_CHARS &&
      now() - Number(value.at) >= 0 && now() - Number(value.at) < maxAgeMs;
    const ready = Promise.resolve().then(async () => {
      if (!identity) return;
      const saved = await store?.read?.(key, identity);
      if (!current()) return;
      for (const entry of Array.isArray(saved?.entries) ? saved.entries : []) {
        if (typeof entry?.[0] === 'string' && valid(entry[1]) && !views.has(entry[0])) views.set(entry[0], entry[1]);
      }
      trim();
    }).catch(() => {});

    function trim() {
      let size = [...views.values()].reduce((sum, entry) => sum + entry.html.length, 0);
      for (const [view, entry] of [...views].sort((left, right) => left[1].at - right[1].at)) {
        if (!valid(entry) || size > maxTotalChars || views.size > 200) { views.delete(view); size -= entry.html.length; }
      }
    }

    function remember(view, html) {
      if (!current() || !view || typeof html !== 'string' || !html || html.length > MAX_CHARS ||
          /detail-mail-loading|detail-mail-(?:load-)?error/.test(html)) return false;
      views.delete(view);
      views.set(view, { html, at: now() });
      trim(); revision++;
      if (timer == null) timer = global.setTimeout(() => { timer = null; void flush(); }, 200);
      return true;
    }

    let write = Promise.resolve();
    async function flush() {
      if (timer != null) { global.clearTimeout(timer); timer = null; }
      await ready;
      if (!current()) return;
      const version = revision;
      const value = { entries: [...views] };
      write = write.catch(() => {}).then(() => current() ? store?.write?.(key, identity, value) : false);
      await write.catch(() => {});
      if (current() && version !== revision && timer == null) timer = global.setTimeout(() => { timer = null; void flush(); }, 200);
    }

    function restore(view) {
      const saved = views.get(view), detail = documentRef?.getElementById?.('mail-detail');
      if (!current() || showing || !valid(saved) || !detail) return false;
      detail.innerHTML = saved.html;
      detail.setAttribute('inert', '');
      detail.setAttribute('data-softora-snapshot-inert', 'true');
      detail.dataset.mailboxDomDirty = 'true';
      detail.querySelectorAll?.('img').forEach((image) => image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, { once: true }));
      showing = true;
      return true;
    }

    function release() {
      if (!showing) return;
      const detail = documentRef?.getElementById?.('mail-detail');
      detail?.removeAttribute('inert');
      detail?.removeAttribute('data-softora-snapshot-inert');
      showing = false;
    }
    return { ready, remember, restore, release, flush, isShowing: () => showing };
  }

  const prepared = createPreparedViews();

  function instance() {
    if (!snapshot && global.SoftoraScreenSnapshot) {
      snapshot = global.SoftoraScreenSnapshot.create({
        key: 'premium-mailbox-detail:v2',
        elements: [{ id: 'mail-detail', html: true }],
        inertIds: ['mail-detail'],
        maxChars: MAX_CHARS,
      });
    }
    return snapshot;
  }

  const api = Object.freeze({
    ready: prepared.ready,
    prepare(mail, scope, render) {
      if (!mail?.bodyLoaded || mail.bodyLoading || mail.bodyTruncated || mail.threadBodiesLoading ||
          !mail.contactTimelineLoaded || mail.contactTimelineError ||
          (mail.aiPresentationUnknown && mail.aiPresentation === undefined)) return false;
      const view = [scope.folder || '', scope.owner || '', scope.account || '', String(mail.id || '')].join('|');
      return prepared.remember(view, render(mail));
    },
    restore(view) { if (prepared.restore(view)) return true; const current = instance(); return current ? current.restore(view) : false; },
    isShowing() { return prepared.isShowing() || Boolean(snapshot && snapshot.isShowing()); },
    release() { prepared.release(); if (snapshot) snapshot.release(); },
    capture(view, isValid) { if (isValid?.()) prepared.remember(view, global.document?.getElementById('mail-detail')?.innerHTML); const current = instance(); if (current) current.capture(view, { isValid }); },
    createPreparedViews,
  });
  global.SoftoraMailboxDetailSnapshot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
