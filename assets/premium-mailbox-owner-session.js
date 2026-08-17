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

  const HYDRATED_MESSAGE_FIELDS = [
    'body', 'hasBody', 'bodyLoaded', 'bodyLoading', 'bodyLoadError', 'bodyTruncated',
    'bodyImages', 'bodyImagesTruncated', 'bodyImageEvidenceKnown', 'embeddedImageCount',
    'attachments', 'optOutUrl', 'originalCampaignOutbound', 'webdesignLinkEvidenceKnown',
    'webdesignLinkHydrationAttempted', 'webdesignLinkUrl', 'recipientRoutingEvidenceKnown',
    'recipientRoutingNeedsHydration', 'to', 'toDisplay', 'cc', 'bcc', 'deliveredTo',
  ];
  const CONTACT_TIMELINE_FIELDS = [
    'contactTimelineLoaded', 'contactTimelineTotal', 'contactTimelineThreadCount',
    'contactTimelineNextCursor', 'contactTimelineError', 'externalContactEmail',
  ];

  function getMessageKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const direct = source.id || source.mailboxId || source.messageId;
    if (direct != null && String(direct).trim()) return String(direct).trim();
    const account = normalize(source.accountEmail || source.account);
    const folder = normalize(source.storageFolder || source.folder);
    const uid = String(source.uid == null ? '' : source.uid).trim();
    return account && folder && uid ? `${account}|${folder}|${uid}` : '';
  }

  function getStableThreadMessageKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const messageId = normalize(source.messageId).replace(/^<|>$/g, '');
    if (messageId) return `message-id:${messageId}`;
    const account = normalize(source.accountEmail || source.account);
    const providerMessageId = normalize(source.providerMessageId || source.instantlyMessageId);
    if (providerMessageId) return `provider:${account}|${providerMessageId}`;
    const messageKey = normalize(source.messageKey);
    if (messageKey) return `message-key:${messageKey}`;
    const folder = normalize(source.storageFolder || source.folder);
    const uid = String(source.uid == null ? '' : source.uid).trim();
    if (account && folder && uid) return `mailbox:${account}|${folder}|${uid}`;
    const fallback = getMessageKey(source);
    return fallback ? `ui:${fallback}` : '';
  }

  function getBodyCompleteness(message) {
    const source = message && typeof message === 'object' ? message : {};
    const body = String(source.body || '').trim();
    if (source.bodyLoaded === true && (body || source.hasBody === false)) return 4;
    if (body && source.bodyTruncated !== true && source.bodyImagesTruncated !== true) return 3;
    if (body) return 2;
    return source.hasBody ? 1 : 0;
  }

  function reconcileMessage(current, incoming) {
    if (!current || typeof current !== 'object') return incoming;
    if (!incoming || typeof incoming !== 'object') return current;
    const currentBody = Object.fromEntries(HYDRATED_MESSAGE_FIELDS.map((field) => [field, current[field]]));
    const currentThread = Array.isArray(current.threadMessages) ? current.threadMessages : [];
    const preserveContactTimeline = current.contactTimelineLoaded === true && incoming.contactTimelineLoaded !== true;
    const currentContactTimeline = Object.fromEntries(
      CONTACT_TIMELINE_FIELDS.map((field) => [field, current[field]])
    );
    const preserveHydration = current.bodyLoading === true ||
      getBodyCompleteness(current) > getBodyCompleteness(incoming);
    Object.assign(current, incoming);
    if (preserveHydration) {
      HYDRATED_MESSAGE_FIELDS.forEach((field) => { current[field] = currentBody[field]; });
    }
    if (preserveContactTimeline) {
      CONTACT_TIMELINE_FIELDS.forEach((field) => { current[field] = currentContactTimeline[field]; });
    }
    if (Array.isArray(incoming.threadMessages)) {
      current.threadMessages = preserveContactTimeline
        ? mergeMessagesPreservingCurrent(currentThread, incoming.threadMessages)
        : reconcileMessages(currentThread, incoming.threadMessages);
    }
    return current;
  }

  function mergeMessagesPreservingCurrent(currentMessages, incomingMessages) {
    const incomingByKey = new Map(
      (Array.isArray(incomingMessages) ? incomingMessages : [])
        .map((message) => [getStableThreadMessageKey(message), message])
        .filter(([key]) => key)
    );
    const seen = new Set();
    const preserved = (Array.isArray(currentMessages) ? currentMessages : []).map((message) => {
      const key = getStableThreadMessageKey(message);
      if (!key || !incomingByKey.has(key)) return message;
      seen.add(key);
      return reconcileMessage(message, incomingByKey.get(key));
    });
    (Array.isArray(incomingMessages) ? incomingMessages : []).forEach((message) => {
      const key = getStableThreadMessageKey(message);
      if (!key || seen.has(key)) return;
      seen.add(key);
      preserved.push(message);
    });
    return preserved;
  }

  function reconcileMessages(currentMessages, incomingMessages) {
    const currentByKey = new Map(
      (Array.isArray(currentMessages) ? currentMessages : [])
        .map((message) => [getMessageKey(message), message])
        .filter(([key]) => key)
    );
    return (Array.isArray(incomingMessages) ? incomingMessages : []).map((message) => {
      const key = getMessageKey(message);
      return key && currentByKey.has(key)
        ? reconcileMessage(currentByKey.get(key), message)
        : message;
    });
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

    function releaseTransientLoadingState(messages) {
      (Array.isArray(messages) ? messages : []).forEach((message) => {
        if (!message || typeof message !== 'object') return;
        message.bodyLoading = false;
        message.threadBodiesLoading = false;
        (Array.isArray(message.threadMessages) ? message.threadMessages : []).forEach((threadMessage) => {
          if (!threadMessage || typeof threadMessage !== 'object') return;
          threadMessage.bodyLoading = false;
          threadMessage.imageLoading = false;
        });
      });
    }

    function keepConversationOpen(messages, previousActiveId, loadOptions = {}) {
      if (loadOptions.openLatest !== false) return;
      const activeMessage = (Array.isArray(messages) ? messages : []).find(
        (message) => String(message && message.id) === String(previousActiveId || '')
      );
      const nextMessage = activeMessage || (Array.isArray(messages) ? messages[0] : null);
      if (nextMessage) options.openMail?.(nextMessage.id);
      else {
        options.setActiveMail?.(null);
        options.resetDetail?.();
      }
    }

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
      const candidate = loadOptions.reuseActiveToken === true && token && session.isCurrent(token, scope)
        ? token
        : session.begin(scope);
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
            refreshInstantly: loadOptions.skipProviderRefresh !== true,
          }
        );
        if (!isCurrent(candidate)) return false;
        if (campaignResult) {
          options.setSync?.(campaignResult.sync);
          const ownerMessages = options.campaignInbox.filterMessages(campaignResult.messages, scope.owner);
          const messages = reconcileMessages(
            options.getMessages?.() || [],
            options.filterDeleted?.(ownerMessages) || []
          );
          const activeId = options.getActiveMail?.();
          if (campaignResult.fromCache) releaseTransientLoadingState(messages);
          options.setMessages?.(messages);
          options.prewarm?.(messages);
          options.renderList?.({ openLatest: loadOptions.openLatest !== false });
          keepConversationOpen(messages, activeId, loadOptions);
          options.setStatus?.('');
          setBusy(false);
          if (campaignResult.fromBootstrap && isCurrent(candidate)) {
            void load({
              skipPageBootstrap: true,
              skipBackgroundSync: true,
              skipProviderRefresh: true,
              openLatest: false,
              preserveOnError: true,
              reuseActiveToken: true,
            });
          }
          return campaignResult.fromCache !== true;
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
        const messages = reconcileMessages(
          options.getMessages?.() || [],
          options.filterDeleted?.(
            Array.isArray(data.messages) ? data.messages.map(normalizeMessage) : []
          ) || []
        );
        options.setSync?.(sync);
        options.setMessages?.(messages);
        options.prewarm?.(messages);
        options.renderList?.({ openLatest: loadOptions.openLatest !== false });
        keepConversationOpen(messages, options.getActiveMail?.(), loadOptions);
        void hydrateOutreachContexts(candidate).catch(() => {});
        options.setStatus?.(sync?.warming ? 'Mailbox wordt bijgewerkt…' : '');
        if (sync?.refreshRecommended && !loadOptions.skipBackgroundSync) {
          void options.syncInBackground?.();
        }
        setBusy(false);
        return true;
      } catch (error) {
        if (!isCurrent(candidate) || isAbortError(error)) return false;
        const currentMessages = options.getMessages?.() || [];
        if (loadOptions.preserveOnError && currentMessages.length) {
          const activeId = options.getActiveMail?.();
          releaseTransientLoadingState(currentMessages);
          options.renderList?.({ openLatest: false });
          const activeMessage = currentMessages.find(
            (message) => String(message && message.id) === String(activeId || '')
          );
          if (activeMessage) options.openMail?.(activeMessage.id, { skipReadPersist: true });
          else keepConversationOpen(currentMessages, activeId, { openLatest: false });
          options.setStatus?.('');
          setBusy(false);
          return false;
        }
        options.setSync?.(null);
        options.setMessages?.([]);
        options.setStatus?.('Opnieuw verbinden…');
        options.syncInboxBadge?.();
        const list = options.getListElement?.();
        if (list) {
          list.setAttribute('aria-busy', 'false');
          list.innerHTML = '<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">Mailbox wordt opnieuw verbonden…</div>';
        }
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
      void load({ openLatest: false, skipProviderRefresh: true });
      return owner;
    }

    return { ensureToken, getToken: () => token, isCurrent, load, reset, switchOwner };
  }

  const api = { create, createView, isAbortError, normalizeScope, reconcileMessages, sameScope };
  global.SoftoraMailboxOwnerSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
