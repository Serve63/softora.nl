(function (global) {
  'use strict';

  const SEARCH_DEBOUNCE_MS = 280;
  const SEARCH_MIN_LENGTH = 2;
  const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function extractEmails(value) {
    return Array.from(new Set((String(value || '').match(EMAIL_PATTERN) || []).map(normalizeEmail)));
  }

  function resolveExternalContact(mail, accountEmails = []) {
    const own = new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean));
    const replyTo = extractEmails(mail?.replyTo);
    const sender = extractEmails(mail?.email);
    const recipients = extractEmails([
      mail?.to, mail?.toDisplay, mail?.cc, mail?.bcc, mail?.deliveredTo,
    ].filter(Boolean).join(' '));
    const outbound = String(mail?.folder || mail?.direction || '').toLowerCase() === 'sent';
    return (outbound ? [...recipients, ...replyTo, ...sender] : [...replyTo, ...sender, ...recipients])
      .find((email) => !own.has(email)) || '';
  }

  function getContactDossier(mail, options = {}) {
    const accounts = Array.isArray(options.accountEmails) ? options.accountEmails : [];
    const contactEmail = normalizeEmail(mail?.externalContactEmail) || resolveExternalContact(mail, accounts);
    const active = String(options.activeFolder || '').toLowerCase() === 'outreach' && Boolean(contactEmail);
    if (!active) return { active: false, contactEmail: '', title: String(options.fallbackTitle || '') };
    const campaignInbox = options.campaignInbox;
    const messages = [mail, ...(Array.isArray(mail?.threadMessages) ? mail.threadMessages : [])];
    const title = messages
      .filter((message) => normalizeEmail(message?.email) === contactEmail)
      .sort((left, right) => new Date(right?.date || 0).getTime() - new Date(left?.date || 0).getTime())
      .map((message) => String(message?.from || '').trim())
      .find((name) => name && normalizeEmail(name) !== contactEmail) || contactEmail || 'Contactdossier';
    const newMessageAction = campaignInbox?.sortMessagesNewestFirst?.(messages).reduce((selected, message) => {
      if (selected || resolveExternalContact(message, accounts) !== contactEmail) return selected;
      const action = campaignInbox.getConversationAction?.({ ...message, threadMessages: [] });
      return action?.kind === 'new-message' ? action : null;
    }, null) || null;
    return { active, contactEmail, title, newMessageAction };
  }

  function renderReplyMessageAction(message, campaignInbox, renderAction, mailId) {
    const action = campaignInbox?.getConversationAction?.({ ...message, threadMessages: [] });
    return action?.kind === 'reply' && typeof renderAction === 'function'
      ? renderAction(action, mailId)
      : '';
  }

  function getMessageIdentity(message) {
    return normalizeEmail(message?.messageId) || String(message?.messageKey || '').trim() || [
      normalizeEmail(message?.accountEmail),
      String(message?.providerMessageId || message?.mailboxId || message?.id || '').trim(),
    ].join('|');
  }

  function mergeContactTimeline(root, messages, contactEmail, totalCount, options = {}) {
    const normalizedContact = normalizeEmail(contactEmail);
    const accountEmails = Array.isArray(options.accountEmails) ? options.accountEmails : [];
    let rejectedCount = Math.max(0, Number(options.rejectedCountOffset) || 0);
    const normalized = (Array.isArray(messages) ? messages : []).filter((message) => {
      if (!accountEmails.length || getMessageIdentity(message) === getMessageIdentity(root)) return true;
      const matches = resolveExternalContact(message, accountEmails) === normalizedContact;
      if (!matches) rejectedCount += 1;
      return matches;
    });
    const rootIdentity = getMessageIdentity(root);
    const matchingRoot = normalized.find((message) => getMessageIdentity(message) === rootIdentity);
    if (matchingRoot) {
      root.technicalThreadKey = matchingRoot.technicalThreadKey;
      root.messageKey = matchingRoot.messageKey || root.messageKey;
    }
    const seen = new Set(rootIdentity ? [rootIdentity] : []);
    root.threadMessages = normalized.filter((message) => {
      const identity = getMessageIdentity(message);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    root.externalContactEmail = normalizedContact;
    root.contactTimelineLoaded = true;
    const reportedTotal = Number.isFinite(Number(totalCount)) && Number(totalCount) > 0
      ? Number(totalCount)
      : 1 + root.threadMessages.length;
    root.contactTimelineRejectedCount = rejectedCount;
    root.contactTimelineTotal = Math.max(1 + root.threadMessages.length, reportedTotal - rejectedCount);
    root.contactTimelineThreadCount = new Set(normalized.map((message) => message.technicalThreadKey).filter(Boolean)).size;
    return root;
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getSearchResultKey(message) {
    return [
      String(message?.owner || message?.canonicalOwner || '').trim().toLowerCase(),
      String(message?.provider || message?.providerKind || '').trim().toLowerCase(),
      normalizeEmail(message?.accountEmail || message?.providerAccountEmail),
      normalizeEmail(message?.externalContactEmail),
      String(message?.technicalThreadKey || message?.threadId || '').trim(),
      getMessageIdentity(message),
    ].join('|');
  }

  function renderSearchSnippet(match, query, escapeHtml) {
    if (!match || typeof escapeHtml !== 'function') return '';
    const snippet = String(match.snippet || '').trim();
    if (!snippet) return '';
    const needle = String(query || '').trim();
    if (!needle) return escapeHtml(snippet);
    const pieces = snippet.split(new RegExp(`(${escapeRegExp(needle)})`, 'ig'));
    return pieces.map((piece) => piece.toLowerCase() === needle.toLowerCase()
      ? `<mark>${escapeHtml(piece)}</mark>`
      : escapeHtml(piece)).join('');
  }

  function renderTimelineSummary(mail, escapeHtml) {
    if (!mail?.contactTimelineLoaded || typeof escapeHtml !== 'function') return '';
    const messages = Math.max(0, Number(mail.contactTimelineTotal) || 0);
    const threads = Math.max(0, Number(mail.contactTimelineThreadCount) || 0);
    const contact = String(mail.externalContactEmail || '').trim();
    const more = mail.contactTimelineNextCursor
      ? `<button type="button" data-mailbox-action="load-more-contact-timeline" data-mailbox-id="${escapeHtml(mail.id)}">Oudere berichten laden</button>`
      : '';
    return `<div class="mail-contact-summary" role="status"><strong>Contactdossier</strong><span>${escapeHtml(`${messages} berichten · ${threads} onderwerpen${contact ? ` · ${contact}` : ''}`)}</span>${more}</div>`;
  }

  function renderRootSentCardStart(mail, options = {}) {
    if (!options.contactDossierMode || options.isProvenMailboxCopy || options.rootIncoming) return '';
    const campaignInbox = options.campaignInbox;
    const rootOwner = campaignInbox?.getMessageOwner?.(mail);
    const ownerLabel = rootOwner ? campaignInbox?.getOwnerLabel?.(rootOwner) : '';
    const meta = [mail?.date, mail?.time, ownerLabel]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join(' · ');
    const escapeHtml = typeof options.escapeHtml === 'function' ? options.escapeHtml : String;
    return `<section class="detail-mail-section detail-mail-section-sent" data-mailbox-message-direction="sent" data-mailbox-root-message="true"><div class="detail-mail-section-label">Jouw bericht</div>${meta ? `<div class="detail-mail-quote-meta">${escapeHtml(meta)}</div>` : ''}`;
  }

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const input = documentRef?.getElementById?.('mailbox-search-input');
    const status = documentRef?.getElementById?.('mailbox-search-status');
    const moreButton = documentRef?.getElementById?.('mailbox-search-more');
    let debounceTimer = 0;
    let searchController = null;
    let timelineController = null;
    let searchGeneration = 0;
    let timelineGeneration = 0;
    let activeQuery = '';
    let nextCursor = '';
    let totalCount = 0;
    let snapshot = null;
    let searchLoading = false;
    let searchResultKeys = new Set();

    function setStatus(text, kind = '') {
      if (!status) return;
      status.textContent = String(text || '');
      status.hidden = !text;
      status.dataset.state = kind;
    }

    function setMoreState({ visible = false, loading = false } = {}) {
      if (!moreButton) return;
      moreButton.hidden = !visible;
      moreButton.disabled = loading;
      moreButton.setAttribute?.('aria-busy', loading ? 'true' : 'false');
      moreButton.textContent = loading ? 'Meer resultaten laden…' : 'Meer resultaten laden';
    }

    function captureSnapshot() {
      if (snapshot) return;
      const list = options.getListElement?.();
      const detailBody = documentRef?.querySelector?.('#mail-detail .detail-body');
      snapshot = {
        messages: options.getMessages?.().slice?.() || [],
        activeMail: options.getActiveMail?.() || null,
        listScrollTop: Number(list?.scrollTop) || 0,
        detailScrollTop: Number(detailBody?.scrollTop) || 0,
      };
    }

    function isSearchActive() {
      return Boolean(activeQuery);
    }

    async function runSearch({ append = false } = {}) {
      if (searchLoading && append) return false;
      const query = String(input?.value || '').replace(/\s+/g, ' ').trim();
      if (query.length < SEARCH_MIN_LENGTH) {
        if (activeQuery) clearSearch();
        else setStatus(query ? 'Typ nog één teken om te zoeken.' : '');
        return false;
      }
      if (!append) {
        captureSnapshot();
        activeQuery = query;
        nextCursor = '';
        totalCount = 0;
      }
      const generation = ++searchGeneration;
      searchController?.abort?.();
      searchController = typeof AbortController === 'function' ? new AbortController() : null;
      searchLoading = true;
      setStatus(append ? 'Meer resultaten laden…' : 'Volledige mailbox doorzoeken…', 'loading');
      setMoreState({ visible: append && Boolean(nextCursor), loading: append });
      try {
        const params = new URLSearchParams({ q: query, owner: options.getOwner?.() || 'both', limit: '20' });
        if (append && nextCursor) params.set('cursor', nextCursor);
        const response = await fetchImpl(`/api/mailbox/search?${params}`, {
          credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
          ...(searchController ? { signal: searchController.signal } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (generation !== searchGeneration || query !== String(input?.value || '').replace(/\s+/g, ' ').trim()) return false;
        if (!response.ok || data?.ok !== true) throw new Error(data?.error || 'Zoeken mislukt.');
        const incoming = (Array.isArray(data.messages) ? data.messages : []).map((message) => {
          const normalized = options.normalizeMessage?.(message) || message;
          normalized.searchMatch = message.searchMatch || null;
          normalized.searchQuery = query;
          normalized.externalContactEmail = message.externalContactEmail || normalized.externalContactEmail || '';
          normalized.technicalThreadKey = message.technicalThreadKey || normalized.technicalThreadKey || '';
          return normalized;
        });
        const existing = append ? (options.getMessages?.() || []) : [];
        const byIdentity = new Map(existing.map((message) => [getMessageIdentity(message), message]));
        incoming.forEach((message) => byIdentity.set(getMessageIdentity(message), message));
        const resultMessages = Array.from(byIdentity.values());
        resultMessages.forEach((message) => { message.searchResultKey = getSearchResultKey(message); });
        searchResultKeys = new Set(resultMessages.map(getSearchResultKey));
        options.setMessages?.(resultMessages);
        if (!append) {
          options.setActiveMail?.(null);
          options.resetDetail?.();
        }
        nextCursor = String(data.nextCursor || '');
        totalCount = Math.max(0, Number(data.totalCount) || 0);
        options.renderList?.({ openLatest: false });
        setStatus(totalCount ? `${totalCount} gesprekken gevonden` : 'Geen resultaten gevonden.', totalCount ? 'ready' : 'empty');
        setMoreState({ visible: Boolean(nextCursor) });
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || generation !== searchGeneration) return false;
        setStatus('Zoeken lukte tijdelijk niet. Probeer opnieuw.', 'error');
        setMoreState({ visible: Boolean(nextCursor) });
        return false;
      } finally {
        if (generation === searchGeneration) {
          searchLoading = false;
          if (moreButton?.disabled) setMoreState({ visible: Boolean(nextCursor) });
        }
      }
    }

    function clearSearch({ restore = true } = {}) {
      searchGeneration += 1;
      searchController?.abort?.();
      searchController = null;
      searchLoading = false;
      if (debounceTimer) global.clearTimeout?.(debounceTimer);
      debounceTimer = 0;
      activeQuery = '';
      nextCursor = '';
      totalCount = 0;
      searchResultKeys = new Set();
      if (input) input.value = '';
      setStatus('');
      setMoreState();
      if (restore && snapshot) {
        const saved = snapshot;
        snapshot = null;
        options.setMessages?.(saved.messages);
        options.setActiveMail?.(saved.activeMail);
        options.renderList?.({ openLatest: false });
        const list = options.getListElement?.();
        if (list) list.scrollTop = saved.listScrollTop;
        if (saved.activeMail) {
          options.openMail?.(saved.activeMail, { skipContactTimeline: true, skipReadPersist: true });
          const detailBody = documentRef?.querySelector?.('#mail-detail .detail-body');
          if (detailBody) detailBody.scrollTop = saved.detailScrollTop;
        }
      } else {
        snapshot = null;
      }
      return true;
    }

    async function loadContactTimeline(mail, { append = false, force = false } = {}) {
      if (!mail || options.getActiveMail?.() !== mail.id) return false;
      if (mail.contactTimelineLoading && !append) return false;
      if (mail.contactTimelineLoaded && !mail.contactTimelineNeedsRefresh && !append && !force) return true;
      const contactEmail = mail.externalContactEmail || resolveExternalContact(mail, options.getAccountEmails?.());
      if (!contactEmail) return false;
      const generation = ++timelineGeneration;
      timelineController?.abort?.();
      timelineController = typeof AbortController === 'function' ? new AbortController() : null;
      mail.contactTimelineLoading = true;
      try {
        const params = new URLSearchParams({ contact: contactEmail, owner: options.getOwner?.() || 'both', limit: '50' });
        if (append && mail.contactTimelineNextCursor) params.set('cursor', mail.contactTimelineNextCursor);
        const response = await fetchImpl(`/api/mailbox/contact-timeline?${params}`, {
          credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
          ...(timelineController ? { signal: timelineController.signal } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (generation !== timelineGeneration || options.getActiveMail?.() !== mail.id) return false;
        if (!response.ok || data?.ok !== true) throw new Error(data?.error || 'Contacthistorie laden mislukt.');
        const incoming = (Array.isArray(data.messages) ? data.messages : []).map((message) => options.normalizeMessage?.(message) || message);
        const prior = append && mail.contactTimelineLoaded ? [mail, ...(mail.threadMessages || [])] : [];
        const rows = [...prior, ...incoming];
        mergeContactTimeline(mail, rows, contactEmail, data.totalCount, {
          accountEmails: options.getAccountEmails?.(),
          rejectedCountOffset: append ? mail.contactTimelineRejectedCount : 0,
        });
        mail.contactTimelineNeedsRefresh = false;
        mail.contactTimelineError = '';
        mail.contactTimelineNextCursor = String(data.nextCursor || '');
        options.openMail?.(mail.id, {
          skipBodyFetch: true,
          skipContactTimeline: true,
          skipReadPersist: true,
        });
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || generation !== timelineGeneration) return false;
        mail.contactTimelineError = 'Contacthistorie wordt bij de volgende poging opnieuw geladen.';
        return false;
      } finally {
        mail.contactTimelineLoading = false;
      }
    }

    function resetForScopeChange() {
      clearSearch({ restore: false });
      timelineGeneration += 1;
      timelineController?.abort?.();
      timelineController = null;
    }

    function bind() {
      input?.addEventListener?.('input', () => {
        if (debounceTimer) global.clearTimeout?.(debounceTimer);
        debounceTimer = global.setTimeout?.(() => void runSearch(), SEARCH_DEBOUNCE_MS) || 0;
      });
      input?.addEventListener?.('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          clearSearch();
          input.focus?.();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (debounceTimer) global.clearTimeout?.(debounceTimer);
          void runSearch();
        }
      });
      moreButton?.addEventListener?.('click', () => void runSearch({ append: true }));
    }

    bind();
    return {
      clearSearch,
      canOpenResult: (mail) => !isSearchActive() || searchResultKeys.has(getSearchResultKey(mail)),
      isSearchActive,
      loadContactTimeline,
      loadMoreContactTimeline: (mail) => loadContactTimeline(mail, { append: true }),
      refreshActiveTimeline: (mail) => loadContactTimeline(mail, { force: true }),
      resetForScopeChange,
      runSearch,
    };
  }

  const api = {
    SEARCH_DEBOUNCE_MS,
    SEARCH_MIN_LENGTH,
    create,
    extractEmails,
    getContactDossier,
    getSearchResultKey,
    mergeContactTimeline,
    renderRootSentCardStart,
    renderSearchSnippet,
    renderReplyMessageAction,
    renderTimelineSummary,
    resolveExternalContact,
  };
  global.SoftoraMailboxDiscovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
