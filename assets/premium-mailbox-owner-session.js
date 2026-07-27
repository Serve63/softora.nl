(function (global) {
  'use strict';

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeScope(value = {}) {
    return Object.freeze({
      owner: normalize(value.owner),
      account: normalize(value.account),
      folder: normalize(value.folder) || 'outreach',
    });
  }

  function sameScope(left, right) {
    const first = normalizeScope(left);
    const second = normalizeScope(right);
    return first.owner === second.owner &&
      first.account === second.account &&
      first.folder === second.folder;
  }

  function isAbortError(error) {
    return Boolean(error && (
      error.name === 'AbortError' ||
      error.code === 'ABORT_ERR'
    ));
  }

  function create(options = {}) {
    const AbortControllerImpl = options.AbortController || global.AbortController;
    let generation = 0;
    let active = null;

    function abortActive() {
      if (active && active.controller && typeof active.controller.abort === 'function') {
        active.controller.abort();
      }
    }

    function begin(scope) {
      abortActive();
      generation += 1;
      const controller = typeof AbortControllerImpl === 'function'
        ? new AbortControllerImpl()
        : null;
      active = Object.freeze({
        generation,
        scope: normalizeScope(scope),
        controller,
      });
      return Object.freeze({
        generation,
        scope: active.scope,
        signal: controller ? controller.signal : undefined,
      });
    }

    function cancel() {
      abortActive();
      generation += 1;
      active = null;
      return generation;
    }

    function isCurrent(token, scope) {
      if (!token || !active || token.generation !== active.generation) return false;
      if (token.signal && token.signal.aborted) return false;
      return sameScope(active.scope, scope || token.scope);
    }

    function commit(token, scope, callback) {
      if (!isCurrent(token, scope)) return false;
      if (typeof callback === 'function') callback();
      return true;
    }

    function getActiveScope() {
      return active ? active.scope : null;
    }

    return {
      begin,
      cancel,
      commit,
      getActiveScope,
      isCurrent,
    };
  }

  function createView(options = {}) {
    const session = create({ AbortController: options.AbortController });
    let token = null;
    const getScope = () => normalizeScope(options.getScope?.());
    const isCurrent = (candidate = token) => session.isCurrent(candidate, getScope());
    const setBusy = (busy) => options.getListElement?.()?.setAttribute?.('aria-busy', String(Boolean(busy)));

    async function hydrateOutreachContexts(candidate) {
      const index = options.index;
      if (!index || typeof index.hydrateOutreachContexts !== 'function') return;
      await index.hydrateOutreachContexts({
        getMails: () => isCurrent(candidate) ? options.getMessages?.() || [] : [],
        setMails: (messages) => {
          if (isCurrent(candidate)) options.setMessages?.(options.filterDeleted?.(messages) || []);
        },
        renderList: (...args) => { if (isCurrent(candidate)) options.renderList?.(...args); },
        getActiveMail: options.getActiveMail,
        openMail: (...args) => { if (isCurrent(candidate)) options.openMail?.(...args); },
        toast: options.toast,
      });
    }

    async function load(loadOptions = {}) {
      const scope = getScope();
      const candidate = session.begin(scope);
      token = candidate;
      const normalizeMessage = (message) => options.normalizeMessage?.(message, scope) || message;
      setBusy(true);
      try {
        const campaignResult = await options.campaignInbox?.load(
          scope.folder,
          normalizeMessage,
          null,
          {
            owner: scope.owner,
            signal: candidate.signal,
            skipBootstrap: loadOptions.skipPageBootstrap === true,
          }
        );
        if (!isCurrent(candidate)) return false;
        if (campaignResult) {
          options.setSync?.(campaignResult.sync);
          const ownerMessages = options.campaignInbox.filterMessages(campaignResult.messages, scope.owner);
          const messages = options.filterDeleted?.(ownerMessages) || [];
          options.setMessages?.(messages);
          options.prewarm?.(messages);
          options.renderList?.({ openLatest: loadOptions.openLatest !== false });
          options.setStatus?.('');
          setBusy(false);
          if (campaignResult.fromBootstrap && isCurrent(candidate)) {
            void load({
              skipPageBootstrap: true,
              skipBackgroundSync: true,
              openLatest: false,
              preserveOnError: true,
            });
          }
          return true;
        }
        const response = await options.fetch(
          `/api/mailbox/messages?account=${encodeURIComponent(scope.account)}&folder=${encodeURIComponent(scope.folder)}&limit=50`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            ...(candidate.signal ? { signal: candidate.signal } : {}),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Mailbox laden mislukt');
        }
        if (!isCurrent(candidate)) return false;
        const sync = data?.sync && typeof data.sync === 'object' ? data.sync : null;
        const messages = options.filterDeleted?.(
          Array.isArray(data.messages) ? data.messages.map(normalizeMessage) : []
        ) || [];
        options.setSync?.(sync);
        options.setMessages?.(messages);
        options.prewarm?.(messages);
        options.renderList?.({ openLatest: loadOptions.openLatest !== false });
        void hydrateOutreachContexts(candidate).catch(() => {});
        options.setStatus?.(sync?.warming ? 'Mailbox wordt bijgewerkt…' : '');
        if (sync?.refreshRecommended && !loadOptions.skipBackgroundSync) {
          void options.syncInBackground?.();
        }
        setBusy(false);
        return true;
      } catch (error) {
        if (!isCurrent(candidate) || isAbortError(error)) return false;
        if (loadOptions.preserveOnError && (options.getMessages?.() || []).length) {
          options.setStatus?.('');
          setBusy(false);
          return false;
        }
        options.setSync?.(null);
        options.setMessages?.([]);
        options.setStatus?.('');
        options.syncInboxBadge?.();
        const list = options.getListElement?.();
        if (list) {
          list.setAttribute('aria-busy', 'false');
          list.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">${options.escapeHtml?.(error?.message || error || 'Mailbox laden mislukt')}</div>`;
        }
        options.toast?.(String(error?.message || error || 'Mailbox laden mislukt'));
        return false;
      }
    }

    function reset() {
      session.cancel();
      token = null;
      options.closeCompose?.();
      options.setActiveMail?.(null);
      options.setMessages?.([]);
      options.setSync?.({ warming: true });
      setBusy(true);
      options.setStatus?.('Mailbox laden…');
      options.renderList?.({ openLatest: false });
      options.resetDetail?.();
    }

    function ensureToken() {
      if (!token) token = session.begin(getScope());
      return token;
    }

    function switchOwner(value) {
      const owner = options.campaignInbox.setOwner(value);
      reset();
      options.closeMenu?.();
      options.updateAccountUi?.();
      void load({ openLatest: false });
      return owner;
    }

    return { ensureToken, getToken: () => token, isCurrent, load, reset, switchOwner };
  }

  const api = { create, createView, isAbortError, normalizeScope, sameScope };
  global.SoftoraMailboxOwnerSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
