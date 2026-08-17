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

  function getMessageIdentity(message) {
    return normalizeEmail(message?.messageId) || String(message?.messageKey || '').trim() || [
      normalizeEmail(message?.accountEmail),
      String(message?.providerMessageId || message?.mailboxId || message?.id || '').trim(),
    ].join('|');
  }

  function mergeContactTimeline(root, messages, contactEmail, totalCount) {
    const normalized = Array.isArray(messages) ? messages : [];
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
    root.externalContactEmail = contactEmail;
    root.contactTimelineLoaded = true;
    root.contactTimelineTotal = Number.isFinite(Number(totalCount)) && Number(totalCount) > 0
      ? Number(totalCount)
      : 1 + root.threadMessages.length;
    root.contactTimelineThreadCount = new Set(normalized.map((message) => message.technicalThreadKey).filter(Boolean)).size;
    return root;
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const input = documentRef?.getElementById?.('mailbox-search-input');
    const clearButton = documentRef?.getElementById?.('mailbox-search-clear');
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

    function setStatus(text, kind = '') {
      if (!status) return;
      status.textContent = String(text || '');
      status.hidden = !text;
      status.dataset.state = kind;
    }

    function setMoreVisible(visible) {
      if (moreButton) moreButton.hidden = !visible;
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
      setStatus(append ? 'Meer resultaten laden…' : 'Volledige mailbox doorzoeken…', 'loading');
      setMoreVisible(false);
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
        options.setMessages?.(Array.from(byIdentity.values()));
        if (!append) options.setActiveMail?.(null);
        nextCursor = String(data.nextCursor || '');
        totalCount = Math.max(0, Number(data.totalCount) || 0);
        options.renderList?.({ openLatest: false });
        setStatus(totalCount ? `${totalCount} gesprekken gevonden` : 'Geen resultaten gevonden.', totalCount ? 'ready' : 'empty');
        setMoreVisible(Boolean(nextCursor));
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || generation !== searchGeneration) return false;
        setStatus('Zoeken lukte tijdelijk niet. Probeer opnieuw.', 'error');
        setMoreVisible(Boolean(nextCursor));
        return false;
      }
    }

    function clearSearch({ restore = true } = {}) {
      searchGeneration += 1;
      searchController?.abort?.();
      searchController = null;
      if (debounceTimer) global.clearTimeout?.(debounceTimer);
      debounceTimer = 0;
      activeQuery = '';
      nextCursor = '';
      totalCount = 0;
      if (input) input.value = '';
      setStatus('');
      setMoreVisible(false);
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
      if (mail.contactTimelineLoaded && !append && !force) return true;
      const contactEmail = mail.externalContactEmail || resolveExternalContact(mail, options.getAccountEmails?.());
      if (!contactEmail) return false;
      const generation = ++timelineGeneration;
      timelineController?.abort?.();
      timelineController = typeof AbortController === 'function' ? new AbortController() : null;
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
        mergeContactTimeline(mail, rows, contactEmail, data.totalCount);
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
        if (clearButton) clearButton.hidden = !input.value;
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
      clearButton?.addEventListener?.('click', () => {
        clearSearch();
        input?.focus?.();
        clearButton.hidden = true;
      });
      moreButton?.addEventListener?.('click', () => void runSearch({ append: true }));
    }

    bind();
    return {
      clearSearch,
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
    mergeContactTimeline,
    renderSearchSnippet,
    renderTimelineSummary,
    resolveExternalContact,
  };
  global.SoftoraMailboxDiscovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
