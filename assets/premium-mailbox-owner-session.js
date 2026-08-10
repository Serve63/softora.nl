(function (global) {
  'use strict';

  const MAILBOX_STALE_STATUS = 'Mailbox niet live · getoonde gegevens zijn verouderd · nieuwe berichten kunnen ontbreken';

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

  function getMessageKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const account = normalize(source.accountEmail || source.account);
    const folder = normalize(source.storageFolder || source.folder);
    const uid = Number(source.uid) || 0;
    const uidValidity = Number(source.uidValidity) || 0;
    if (account && folder && folder !== 'instantly' && Number.isSafeInteger(uid) && uid > 0) {
      return `${account}|${folder}|uv:${uidValidity}|uid:${uid}`;
    }
    const direct = source.id || source.mailboxId || source.messageId;
    if (direct != null && String(direct).trim()) {
      return account && folder ? `${account}|${folder}|id:${String(direct).trim()}` : String(direct).trim();
    }
    return '';
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
    const preserveHydration = current.bodyLoading === true ||
      getBodyCompleteness(current) > getBodyCompleteness(incoming);
    Object.assign(current, incoming);
    if (preserveHydration) {
      HYDRATED_MESSAGE_FIELDS.forEach((field) => { current[field] = currentBody[field]; });
    }
    if (Array.isArray(incoming.threadMessages)) {
      current.threadMessages = reconcileMessages(currentThread, incoming.threadMessages);
    }
    return current;
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

  function getSnapshotFreshnessApi() {
    if (global.PremiumMailboxSnapshotFreshness) return global.PremiumMailboxSnapshotFreshness;
    if (global.SoftoraMailboxSnapshotFreshness) return global.SoftoraMailboxSnapshotFreshness;
    if (typeof module === 'undefined' || !module.exports) return null;
    try {
      return require('./premium-mailbox-snapshot-freshness.js');
    } catch (_) {
      return null;
    }
  }

  function getRequestDeadlineApi() {
    if (global.SoftoraMailboxRequestDeadline) return global.SoftoraMailboxRequestDeadline;
    if (typeof module === 'undefined' || !module.exports) return null;
    try {
      return require('./premium-mailbox-request-deadline.js');
    } catch (_) {
      return null;
    }
  }

  function getSnapshotContentAt(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const value = source.contentAt || source.sync?.contentAt;
    return Number.isFinite(Date.parse(String(value || ''))) ? String(value) : '';
  }

  function isDegradedSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return source.complete === false || source.degraded === true || source.sync?.stale === true ||
      source.sync?.degraded === true;
  }

  function toSnapshot(result, messages, fallbackOrigin = 'live-api') {
    const source = result && typeof result === 'object' ? result : {};
    const sync = source.sync && typeof source.sync === 'object' ? source.sync : {};
    const origin = String(source.origin || sync.origin || fallbackOrigin || 'live-api').trim() || 'live-api';
    const contentAt = getSnapshotContentAt(source);
    const complete = source.complete === false ? false : !isDegradedSnapshot(source);
    return {
      ...source,
      messages: Array.isArray(messages) ? messages : [],
      origin,
      contentAt,
      complete,
      sync: { ...sync, origin, ...(contentAt ? { contentAt } : {}) },
    };
  }

  function decideSnapshotUpdate(current, incoming) {
    const currentContentAt = getSnapshotContentAt(current);
    const incomingContentAt = getSnapshotContentAt(incoming);
    if (!incomingContentAt) {
      return currentContentAt ? 'reject' : 'replace';
    }
    const api = getSnapshotFreshnessApi();
    if (typeof api?.decideSnapshotUpdate === 'function') {
      const decision = api.decideSnapshotUpdate({ current, incoming });
      const action = typeof decision === 'string' ? decision : decision?.action;
      if (action === 'replace' || action === 'merge-additive' || action === 'reject') return action;
    }
    if (!currentContentAt || !Array.isArray(current?.messages) || !current.messages.length) {
      return incoming.complete === false ? 'merge-additive' : 'replace';
    }
    const currentTime = Date.parse(currentContentAt);
    const incomingTime = Date.parse(incomingContentAt);
    if (incomingTime < currentTime) return 'reject';
    if (incoming.complete === false) return 'merge-additive';
    return incomingTime > currentTime ? 'replace' : 'reject';
  }

  function mergeMessagesAdditively(currentMessages, incomingMessages) {
    const api = getSnapshotFreshnessApi();
    const merge = api?.mergeMessagesAdditively || api?.mergeAdditiveMessages;
    const incomingKeys = new Set((Array.isArray(incomingMessages) ? incomingMessages : [])
      .map(getMessageKey).filter(Boolean));
    const merged = typeof merge === 'function'
      ? merge(currentMessages, incomingMessages)
      : [
          ...(Array.isArray(incomingMessages) ? incomingMessages : []),
          ...(Array.isArray(currentMessages) ? currentMessages : [])
            .filter((message) => !incomingKeys.has(getMessageKey(message))),
        ];
    const seen = new Set();
    return (Array.isArray(merged) ? merged : []).filter((message) => {
      const key = getMessageKey(message);
      if (!key || !seen.has(key)) {
        if (key) seen.add(key);
        return true;
      }
      return false;
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
    let committedSnapshot = null;
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
          const ownerMessages = options.campaignInbox.filterMessages(campaignResult.messages, scope.owner);
          const currentMessages = options.getMessages?.() || [];
          const currentSnapshot = committedSnapshot
            ? { ...committedSnapshot, messages: currentMessages }
            : toSnapshot({ sync: options.getSync?.() }, currentMessages, 'live-api');
          const incoming = toSnapshot(
            campaignResult,
            options.filterDeleted?.(ownerMessages) || [],
            campaignResult.fromBootstrap ? 'server-bootstrap' : campaignResult.fromCache ? 'session-cache' : 'live-api'
          );
          const action = decideSnapshotUpdate(currentSnapshot, incoming);
          if (action === 'reject') {
            if (isDegradedSnapshot(incoming) || incoming.origin === 'live-api') {
              options.setStatus?.(MAILBOX_STALE_STATUS);
            }
            setBusy(false);
            if (campaignResult.fromBootstrap && isCurrent(candidate)) {
              void load({
                skipPageBootstrap: true,
                skipBackgroundSync: true,
                openLatest: false,
                preserveOnError: true,
                reuseActiveToken: true,
              });
            }
            return false;
          }
          const acceptedMessages = action === 'merge-additive'
            ? mergeMessagesAdditively(currentMessages, incoming.messages)
            : incoming.messages;
          const messages = action === 'merge-additive'
            ? acceptedMessages
            : reconcileMessages(currentMessages, acceptedMessages);
          const acceptedSync = {
            ...(incoming.sync || {}),
            ...(action === 'merge-additive' ? { degraded: true, stale: true } : {}),
          };
          const activeId = options.getActiveMail?.();
          if (campaignResult.fromCache) releaseTransientLoadingState(messages);
          options.setSync?.(acceptedSync);
          options.setMessages?.(messages);
          committedSnapshot = { ...incoming, messages, sync: acceptedSync, complete: action === 'replace' && incoming.complete !== false };
          options.prewarm?.(messages);
          options.renderList?.({ openLatest: loadOptions.openLatest !== false });
          keepConversationOpen(messages, activeId, loadOptions);
          options.setStatus?.(
            action === 'merge-additive' || isDegradedSnapshot(incoming)
              ? MAILBOX_STALE_STATUS
              : ''
          );
          setBusy(false);
          if (campaignResult.fromBootstrap && isCurrent(candidate)) {
            void load({
              skipPageBootstrap: true,
              skipBackgroundSync: true,
              openLatest: false,
              preserveOnError: true,
              reuseActiveToken: true,
            });
          }
          return action === 'replace' && incoming.complete !== false && campaignResult.fromCache !== true;
        }
        const deadlineApi = options.requestDeadline || getRequestDeadlineApi();
        if (typeof deadlineApi?.requestJsonWithDeadline !== 'function') {
          throw new Error('Mailboxdeadline ontbreekt.');
        }
        const { response, data } = await deadlineApi.requestJsonWithDeadline({
          request: options.fetch,
          url: `/api/mailbox/messages?account=${encodeURIComponent(scope.account)}&folder=${encodeURIComponent(scope.folder)}&limit=50`,
          init: {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          },
          signal: candidate.signal,
          timeoutMs: options.listRequestTimeoutMs,
          timeoutMessage: 'Mailboxlijst laden duurde te lang.',
          timeoutCode: 'MAILBOX_MESSAGES_TIMEOUT',
          AbortController: options.AbortController,
          setTimeout: options.setTimeout,
          clearTimeout: options.clearTimeout,
        });
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
          options.setStatus?.(MAILBOX_STALE_STATUS);
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
      committedSnapshot = null;
      options.closeCompose?.();
      options.setActiveMail?.(null);
      options.setMessages?.([]);
      options.setSync?.({ warming: true });
      setBusy(true);
      options.setStatus?.('Mailbox laden…');
      options.renderList?.({ openLatest: false });
      options.resetDetail?.();
    }

    function cancelActive() {
      session.cancel();
      token = null;
      setBusy(false);
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

    return { cancelActive, ensureToken, getToken: () => token, isCurrent, load, reset, switchOwner };
  }

  const api = {
    MAILBOX_STALE_STATUS,
    create,
    createView,
    decideSnapshotUpdate,
    isAbortError,
    mergeMessagesAdditively,
    normalizeScope,
    reconcileMessages,
    sameScope,
  };
  global.SoftoraMailboxOwnerSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
