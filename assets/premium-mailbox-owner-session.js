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
    'attachmentEvidenceKnown', 'attachmentHydrationAttempted',
    'providerMessageIdHydrationEligible', 'providerMessageIdHydrationAttempted',
  ];
  const CONTACT_TIMELINE_FIELDS = [
    'contactTimelineLoaded', 'contactTimelineTotal', 'contactTimelineThreadCount',
    'contactTimelineNextCursor', 'contactTimelineError', 'contactTimelineNeedsRefresh',
    'externalContactEmail',
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
    const preserveAttachmentEvidence = current.attachmentEvidenceKnown === true &&
      incoming.attachmentEvidenceKnown !== true;
    const preserveAttachmentAttempt = current.attachmentHydrationAttempted === true &&
      incoming.attachmentEvidenceKnown !== true &&
      incoming.attachmentHydrationAttempted !== true;
    const preserveWebdesignLinkEvidence = current.webdesignLinkEvidenceKnown === true &&
      incoming.webdesignLinkEvidenceKnown !== true;
    const preserveWebdesignLinkAttempt = current.webdesignLinkHydrationAttempted === true &&
      incoming.webdesignLinkEvidenceKnown !== true &&
      incoming.webdesignLinkHydrationAttempted !== true;
    const preserveProviderMessageIdHydrationEligibility =
      current.providerMessageIdHydrationEligible === true &&
      incoming.providerMessageIdHydrationEligible !== true;
    const preserveProviderMessageIdHydrationAttempt =
      current.providerMessageIdHydrationAttempted === true &&
      incoming.providerMessageIdHydrationAttempted !== true;
    Object.assign(current, incoming);
    if (preserveHydration) {
      HYDRATED_MESSAGE_FIELDS.forEach((field) => { current[field] = currentBody[field]; });
    }
    if (!preserveHydration && preserveAttachmentEvidence) {
      current.attachments = currentBody.attachments;
      current.attachmentEvidenceKnown = true;
    }
    if (!preserveHydration && preserveAttachmentAttempt) {
      current.attachmentHydrationAttempted = true;
    }
    if (!preserveHydration && preserveWebdesignLinkEvidence) {
      current.webdesignLinkEvidenceKnown = true;
      current.webdesignLinkUrl = currentBody.webdesignLinkUrl;
    }
    if (!preserveHydration && preserveWebdesignLinkAttempt) {
      current.webdesignLinkHydrationAttempted = true;
    }
    if (!preserveHydration && preserveProviderMessageIdHydrationEligibility) {
      current.providerMessageIdHydrationEligible = true;
    }
    if (!preserveHydration && preserveProviderMessageIdHydrationAttempt) {
      current.providerMessageIdHydrationAttempted = true;
    }
    if (preserveContactTimeline) {
      CONTACT_TIMELINE_FIELDS.forEach((field) => { current[field] = currentContactTimeline[field]; });
      current.contactTimelineNeedsRefresh = true;
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
    return (Array.isArray(currentMessages) ? currentMessages : []).map((message) => {
      const key = getStableThreadMessageKey(message);
      if (!key || !incomingByKey.has(key)) return message;
      return reconcileMessage(message, incomingByKey.get(key));
    });
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
    const canApply = (candidate = token) => (
      isCurrent(candidate) && options.shouldApplyMessages?.() !== false
    );
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

    function openMessage(id, loadOptions = {}, openOptions = {}) {
      const nextOptions = { ...openOptions };
      if (loadOptions.showLoader === false) nextOptions.preserveVisibleDetail = true;
      return options.openMail?.(id, nextOptions);
    }

    function getConversationKey(message) {
      const customKey = String(options.getConversationKey?.(message) || '').trim().toLowerCase();
      if (customKey) return customKey;
      const account = normalize(message?.accountEmail || message?.account);
      const conversationId = normalize(message?.conversationId || message?.technicalThreadKey);
      if (conversationId) return `${account}|conversation:${conversationId}`;
      const messageId = normalize(message?.messageId).replace(/^<+|>+$/g, '');
      return account && messageId ? `${account}|message:${messageId}` : '';
    }

    function keepConversationOpen(messages, previousActiveId, loadOptions = {}, previousActiveMessage = null) {
      if (loadOptions.openLatest !== false) return;
      const activeMessage = (Array.isArray(messages) ? messages : []).find(
        (message) => String(message && message.id) === String(previousActiveId || '')
      );
      const previousConversationKey = getConversationKey(previousActiveMessage);
      const sameConversation = !activeMessage && previousConversationKey
        ? (Array.isArray(messages) ? messages : []).find(
          (message) => getConversationKey(message) === previousConversationKey
        )
        : null;
      const nextMessage = activeMessage || sameConversation || (
        loadOptions.allowUnrelatedFallback === false
          ? null
          : (Array.isArray(messages) ? messages[0] : null)
      );
      if (nextMessage) openMessage(nextMessage.id, loadOptions);
      else if (loadOptions.allowUnrelatedFallback !== false) {
        options.setActiveMail?.(null);
        options.resetDetail?.();
      }
    }

    async function hydrateOutreachContexts(candidate, loadOptions = {}) {
      const index = options.index;
      if (!index || typeof index.hydrateOutreachContexts !== 'function') return;
      await index.hydrateOutreachContexts({
        getMails: () => canApply(candidate) ? options.getMessages?.() || [] : [],
        setMails: (messages) => {
          if (canApply(candidate)) options.setMessages?.(options.filterDeleted?.(messages) || []);
        },
        renderList: (...args) => { if (canApply(candidate)) options.renderList?.(...args); },
        getActiveMail: options.getActiveMail,
        openMail: (id, openOptions) => {
          if (canApply(candidate)) openMessage(id, loadOptions, openOptions);
        },
        toast: options.toast,
      });
    }

    async function load(loadOptions = {}) {
      const scope = getScope();
      const candidate = loadOptions.reuseActiveToken === true && token && session.isCurrent(token, scope)
        ? token
        : session.begin(scope);
      token = candidate;
      const loadSignal = loadOptions.signal
        ? AbortSignal.any([candidate.signal, loadOptions.signal].filter(Boolean))
        : candidate.signal;
      const activeIdAtLoad = options.getActiveMail?.();
      const selectionVersionAtLoad = options.getSelectionVersion?.();
      const activeMessageAtLoad = (options.getMessages?.() || []).find(
        (message) => String(message && message.id) === String(activeIdAtLoad || '')
      );
      const activeMessageContextAtLoad = activeMessageAtLoad
        ? { ...activeMessageAtLoad }
        : null;
      const normalizeMessage = (message) => options.normalizeMessage?.(message, scope) || message;
      setBusy(true);
      try {
        const campaignResult = await options.campaignInbox?.load(
          scope.folder,
          normalizeMessage,
          null,
          {
            owner: scope.owner,
            signal: loadSignal,
            skipBootstrap: loadOptions.skipPageBootstrap === true,
            refreshInstantly: loadOptions.skipProviderRefresh !== true,
          }
        );
        if (!canApply(candidate) || loadSignal?.aborted) {
          setBusy(false);
          return false;
        }
        if (campaignResult) {
          options.setSync?.(campaignResult.sync);
          const ownerMessages = options.campaignInbox.filterMessages(campaignResult.messages, scope.owner);
          const currentMessages = options.getMessages?.() || [];
          const activeId = options.getActiveMail?.();
          const previousActiveMessage = currentMessages.find(
            (message) => String(message && message.id) === String(activeId || '')
          ) || null;
          const messages = reconcileMessages(
            currentMessages,
            options.filterDeleted?.(ownerMessages) || []
          );
          if (campaignResult.fromCache) releaseTransientLoadingState(messages);
          options.setMessages?.(messages);
          options.prewarm?.(messages);
          options.renderList?.({ openLatest: loadOptions.openLatest !== false });
          keepConversationOpen(messages, activeId, loadOptions, previousActiveMessage);
          options.setStatus?.('');
          setBusy(false);
          if (campaignResult.fromBootstrap && canApply(candidate)) {
            void load({
              skipPageBootstrap: true,
              skipBackgroundSync: true,
              skipProviderRefresh: true,
              showLoader: false,
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
            ...(loadSignal ? { signal: loadSignal } : {}),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Mailbox laden mislukt');
        }
        if (!canApply(candidate) || loadSignal?.aborted) {
          setBusy(false);
          return false;
        }
        const sync = data?.sync && typeof data.sync === 'object' ? data.sync : null;
        const currentMessages = options.getMessages?.() || [];
        const activeId = options.getActiveMail?.();
        const previousActiveMessage = currentMessages.find(
          (message) => String(message && message.id) === String(activeId || '')
        ) || null;
        const messages = reconcileMessages(
          currentMessages,
          options.filterDeleted?.(
            Array.isArray(data.messages) ? data.messages.map(normalizeMessage) : []
          ) || []
        );
        options.setSync?.(sync);
        options.setMessages?.(messages);
        options.prewarm?.(messages);
        options.renderList?.({ openLatest: loadOptions.openLatest !== false });
        keepConversationOpen(messages, activeId, loadOptions, previousActiveMessage);
        void hydrateOutreachContexts(candidate, loadOptions).catch(() => {});
        options.setStatus?.(sync?.warming ? 'Mailbox wordt bijgewerkt…' : '');
        if (sync?.refreshRecommended && !loadOptions.skipBackgroundSync) {
          void options.syncInBackground?.();
        }
        setBusy(false);
        return true;
      } catch (error) {
        if (!canApply(candidate) || loadSignal?.aborted || isAbortError(error)) {
          setBusy(false);
          return false;
        }
        const currentMessages = options.getMessages?.() || [];
        if (loadOptions.preserveOnError && currentMessages.length) {
          const currentActiveId = options.getActiveMail?.();
          const currentSelectionVersion = options.getSelectionVersion?.();
          const selectionChanged = String(currentActiveId || '') !== String(activeIdAtLoad || '') || Boolean(
            selectionVersionAtLoad !== undefined &&
            currentSelectionVersion !== undefined &&
            currentSelectionVersion !== selectionVersionAtLoad
          );
          if (selectionChanged) {
            setBusy(false);
            return false;
          }
          const activeMessage = currentMessages.find(
            (message) => String(message && message.id) === String(activeIdAtLoad || '')
          );
          const previousConversationKey = getConversationKey(activeMessageContextAtLoad);
          const logicalReplacement = !activeMessage && previousConversationKey
            ? currentMessages.find((message) => getConversationKey(message) === previousConversationKey)
            : null;
          const recoveryMessage = activeMessage || logicalReplacement || null;
          releaseTransientLoadingState(currentMessages);
          if (String(activeIdAtLoad || '') && !recoveryMessage) {
            options.setStatus?.('');
            setBusy(false);
            return false;
          }
          options.renderList?.({ openLatest: false });
          if (recoveryMessage) openMessage(recoveryMessage.id, loadOptions, { skipReadPersist: true });
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

    function switchOwner(value, switchOptions = {}) {
      const owner = options.campaignInbox.setOwner(value, switchOptions);
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
