(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMailboxDetailStability = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function resolvedStale() {
    return Promise.resolve({ committed: false, stale: true });
  }

  function create() {
    let generation = 0;
    let activeRun = null;

    function isLatest(run) {
      return Boolean(
        run &&
        run.generation === generation &&
        (typeof run.isCurrent !== 'function' || run.isCurrent())
      );
    }

    function isCurrent(run) {
      return Boolean(activeRun === run && !run.settled && isLatest(run));
    }

    function abort(run) {
      run?.controller?.abort?.();
    }

    function run(options = {}) {
      const id = String(options.id || '');
      const key = String(options.key || id);
      if (!id) return resolvedStale();
      if (
        options.forceNewRun !== true &&
        activeRun &&
        !activeRun.settled &&
        activeRun.key === key &&
        activeRun.identity === options.identity
      ) {
        return activeRun.promise;
      }

      abort(activeRun);
      const candidate = {
        generation: ++generation,
        id,
        identity: options.identity,
        key,
        isCurrent: options.isCurrent,
        controller: typeof AbortController === 'function' ? new AbortController() : null,
        promise: null,
        settled: false,
      };
      const abortFromParent = () => abort(candidate);
      options.signal?.addEventListener?.('abort', abortFromParent, { once: true });
      if (options.signal?.aborted) abort(candidate);
      activeRun = candidate;
      const context = Object.freeze({
        generation: candidate.generation,
        signal: candidate.controller?.signal || options.signal,
        isCurrent: () => isCurrent(candidate),
        isLatest: () => isLatest(candidate),
      });
      let preparation = null;
      candidate.promise = Promise.resolve().then(async () => {
        if (!isCurrent(candidate)) return { committed: false, stale: true };
        let value;
        let error = null;
        try {
          value = typeof options.hydrate === 'function'
            ? await options.hydrate(context)
            : undefined;
        } catch (caught) {
          error = caught;
          options.onError?.(caught);
        }
        if (!isCurrent(candidate)) return { committed: false, stale: true, error };
        try {
          if (typeof options.prepare === 'function') preparation = await options.prepare(value, context);
        } catch (caught) {
          error = error || caught;
          options.onError?.(caught);
        }
        if (!isCurrent(candidate)) return { committed: false, stale: true, error };
        const committed = typeof options.commit === 'function'
          ? options.commit({ error, id, preparation, value }) !== false
          : false;
        return { committed, stale: false, error };
      }).finally(() => {
        preparation?.release?.();
        candidate.settled = true;
        options.signal?.removeEventListener?.('abort', abortFromParent);
        if (activeRun === candidate) activeRun = null;
      });
      return candidate.promise;
    }

    function invalidate() {
      generation += 1;
      abort(activeRun);
      activeRun = null;
    }

    function getPending(id) {
      const key = String(id || '');
      if (activeRun && !activeRun.settled && (!key || activeRun.id === key)) return activeRun.promise;
      return null;
    }

    function snapshot() {
      return {
        generation,
        activeId: activeRun?.id || '',
        activeKey: activeRun?.key || '',
        pending: Boolean(activeRun && !activeRun.settled),
      };
    }

    return { getPending, invalidate, run, snapshot };
  }

  function normalizeScope(scope = {}) {
    return {
      folder: String(scope.folder || ''),
      owner: String(scope.owner || ''),
      account: String(scope.account || ''),
    };
  }

  function sameScope(left, right) {
    const first = normalizeScope(left);
    const second = normalizeScope(right);
    return first.folder === second.folder && first.owner === second.owner && first.account === second.account;
  }

  function getMessageIdentity(mail) {
    const account = String(mail?.accountEmail || mail?.account || mail?.campaign?.account || '').trim().toLowerCase();
    const messageId = String(mail?.messageId || '').trim().toLowerCase().replace(/^<+|>+$/g, '');
    return account && messageId ? JSON.stringify([account, messageId]) : '';
  }

  function createController(options = {}) {
    const stability = create();
    let committedId = '';
    let committedVisibilityKey = '';
    let committedHtml = '';
    let committedMessageIdentity = '';
    let committedScope = null;

    function getDetail() {
      return options.getDetailElement?.() || null;
    }

    let pendingSequence = 0;

    function setPending(id, pendingOptions = {}) {
      const detail = getDetail();
      if (!detail) return '';
      const marker = String(++pendingSequence);
      if (pendingOptions.keepVisible !== true) {
        detail.classList?.add?.('is-detail-pending');
        detail.setAttribute?.('aria-busy', 'true');
        detail.setAttribute?.('inert', '');
      }
      if (detail.dataset) {
        detail.dataset.mailboxPendingId = String(id || '');
        detail.dataset.mailboxPendingMarker = marker;
      }
      return marker;
    }

    function clearPending(marker = '') {
      const detail = getDetail();
      if (!detail) return;
      if (marker && String(detail.dataset?.mailboxPendingMarker || '') !== String(marker)) return;
      detail.classList?.remove?.('is-detail-pending');
      detail.setAttribute?.('aria-busy', 'false');
      detail.removeAttribute?.('inert');
      if (detail.dataset) {
        delete detail.dataset.mailboxPendingId;
        delete detail.dataset.mailboxPendingMarker;
      }
    }

    function commit(mail) {
      const detail = getDetail();
      if (!detail || !mail) return false;
      const html = String(options.renderHtml?.(mail) || '');
      const id = String(mail.id || '');
      const visibilityKey = String(options.getVisibilityKey?.(mail) || id);
      const messageIdentity = getMessageIdentity(mail);
      const scope = normalizeScope(options.getScope?.());
      const domDirty = detail.dataset?.mailboxDomDirty === 'true';
      const changed = committedId !== id || committedHtml !== html || domDirty;
      if (changed) {
        const preserveScroll = committedScope && sameScope(committedScope, scope) && (
          committedVisibilityKey === visibilityKey ||
          Boolean(messageIdentity && committedMessageIdentity === messageIdentity)
        );
        const previousBody = preserveScroll ? detail.querySelector?.('.detail-body') : null;
        const scrollTop = previousBody && Number.isFinite(Number(previousBody.scrollTop))
          ? Number(previousBody.scrollTop)
          : 0;
        detail.innerHTML = html;
        committedId = id;
        committedVisibilityKey = visibilityKey;
        committedHtml = html;
        if (detail.dataset) detail.dataset.mailboxCommittedId = id;
        if (detail.dataset) detail.dataset.mailboxCommittedVisibilityKey = visibilityKey;
        if (detail.dataset) delete detail.dataset.mailboxDomDirty;
        if (preserveScroll) {
          const nextBody = detail.querySelector?.('.detail-body');
          if (nextBody) nextBody.scrollTop = scrollTop;
        }
      }
      if (!changed) {
        committedVisibilityKey = visibilityKey;
        if (detail.dataset) detail.dataset.mailboxCommittedVisibilityKey = visibilityKey;
      }
      committedMessageIdentity = messageIdentity;
      committedScope = scope;
      clearPending();
      options.afterCommit?.(mail, { changed });
      return changed;
    }

    function getRunKey(mail, token, scope) {
      return [
        Number(token?.generation) || 0,
        scope.folder,
        scope.owner,
        scope.account,
        String(mail?.id || ''),
      ].join('|');
    }

    async function hydrate(mail, token, openOptions, scope, isSelectionCurrent, runContext) {
      const requestRender = (...args) => {
        const pending = stability.getPending(mail.id);
        if (pending) return pending;
        if (!runContext.isLatest() || !isSelectionCurrent()) return resolvedStale();
        return open(...args);
      };
      const payload = {
        mail,
        token,
        openOptions,
        scope,
        signal: runContext.signal,
        isCurrent: isSelectionCurrent,
        requestRender,
      };
      const firstPass = [];
      if (options.needsRootHydration?.(mail, openOptions)) firstPass.push(options.hydrateRoot?.(payload));
      if (!openOptions.skipContactTimeline) firstPass.push(options.hydrateTimeline?.(payload));
      if (firstPass.length) await Promise.allSettled(firstPass);
      if (!isSelectionCurrent()) return null;
      const currentMail = options.getMail?.(mail.id);
      if (currentMail !== mail) return null;
      if (options.shouldHydrateThread?.(currentMail, openOptions)) {
        await options.hydrateThread?.({ ...payload, mail: currentMail });
      }
      return isSelectionCurrent() && options.getMail?.(mail.id) === mail ? mail : null;
    }

    function open(id, openOptions = {}) {
      const mail = options.getMail?.(id);
      if (!mail) return resolvedStale();
      const token = options.ensureToken?.();
      if (!token || options.isTokenCurrent?.(token) === false) return resolvedStale();
      const scope = normalizeScope(options.getScope?.());
      options.setActiveMail?.(mail.id);
      options.select?.(mail.id);
      options.onSelect?.(mail, openOptions);
      options.renderList?.({ openLatest: false });
      const detail = getDetail();
      const visibilityKey = String(options.getVisibilityKey?.(mail) || mail.id || '');
      const messageIdentity = getMessageIdentity(mail);
      // List metadata and the contact timeline can group the exact same
      // message differently. That enrichment must not blank an open message.
      const sameRenderedMessage = Boolean(
        messageIdentity && messageIdentity === committedMessageIdentity &&
        String(detail?.dataset?.mailboxCommittedId || '') === committedId
      );
      const preserveVisibleDetail = Boolean(
        openOptions.preserveVisibleDetail === true &&
        committedScope && sameScope(committedScope, scope) && (
          sameRenderedMessage || (
            String(committedVisibilityKey || '') === visibilityKey &&
            String(detail?.dataset?.mailboxCommittedVisibilityKey || '') === visibilityKey
          )
        )
      );
      const keepDetailVisible = Boolean(
        preserveVisibleDetail && !detail?.classList?.contains?.('is-detail-pending')
      );
      const pendingMarker = setPending(mail.id, { keepVisible: keepDetailVisible });
      const isSelectionCurrent = () => Boolean(
        options.isTokenCurrent?.(token) !== false &&
        String(options.getActiveMail?.() || '') === String(mail.id || '') &&
        options.getMail?.(mail.id) === mail &&
        sameScope(options.getScope?.(), scope)
      );
      return stability.run({
        id: mail.id,
        identity: mail,
        key: getRunKey(mail, token, scope),
        forceNewRun: openOptions.forceRootHydration === true,
        signal: token.signal,
        isCurrent: isSelectionCurrent,
        hydrate: (runContext) => hydrate(mail, token, openOptions, scope, isSelectionCurrent, runContext),
        prepare: (hydratedMail, runContext) => (
          hydratedMail && isSelectionCurrent()
            ? options.prepare?.(hydratedMail, openOptions, runContext)
            : null
        ),
        commit: ({ value }) => {
          const currentMail = value || options.getMail?.(mail.id);
          if (!isSelectionCurrent() || currentMail !== mail) return false;
          return commit(currentMail);
        },
        onError: options.onError,
      }).finally(() => {
        clearPending(pendingMarker);
      });
    }

    function invalidate() {
      stability.invalidate();
      committedId = '';
      committedVisibilityKey = '';
      committedHtml = '';
      committedMessageIdentity = '';
      committedScope = null;
      const detail = getDetail();
      if (detail?.dataset) {
        delete detail.dataset.mailboxDomDirty;
        delete detail.dataset.mailboxCommittedVisibilityKey;
      }
      clearPending();
    }

    return { getPending: stability.getPending, invalidate, open, snapshot: stability.snapshot };
  }

  return { create, createController };
});
