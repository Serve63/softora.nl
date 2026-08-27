(function (global) {
  'use strict';

  function refresh(options = {}) {
    const messages = Array.isArray(options.mails) ? options.mails : [];
    let changed = false;
    messages.forEach((mail) => {
      const before = Array.isArray(mail.threadMessages) ? mail.threadMessages.length : 0;
      options.controller?.reconcile?.(mail);
      if ((Array.isArray(mail.threadMessages) ? mail.threadMessages.length : 0) !== before) changed = true;
    });
    if (options.onlyWhenChanged && !changed) return false;
    options.renderList?.({ openLatest: false });
    const activeMail = options.getActiveMail?.();
    if (activeMail) options.openMail?.(activeMail, {
      skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true,
      preserveVisibleDetail: true,
    });
    return changed;
  }

  function reconcileMessage(mail, options = {}) {
    if (!mail) return mail;
    const accepted = options.skipAccepted ? mail : (options.composeController?.reconcile?.(mail) || mail);
    return options.readController?.reconcile?.(accepted) || accepted;
  }

  function completeAcceptedSend(options = {}) {
    const record = options.record && typeof options.record === 'object' ? options.record : {};
    const mail = options.composeController?.findAcceptedMail?.(record, options.mails) || null;
    if (!mail) return { changed: false, handledPromise: null, mail: null };
    let handledPromise = null;
    if (record.mode === 'reply' && record.replyTarget && options.readController?.dismissReplyTarget) {
      handledPromise = options.readController.dismissReplyTarget(mail, record.replyTarget, { render() {} });
    }
    const scopedId = String(mail.id || '');
    const scopedIdIsUnique = scopedId && (Array.isArray(options.mails) ? options.mails : [])
      .filter((candidate) => String(candidate?.id || '') === scopedId).length === 1;
    const changed = refresh({
      ...options,
      mails: [mail],
      openMail: scopedIdIsUnique ? options.openMail : undefined,
      controller: options.composeController,
      onlyWhenChanged: false,
    });
    return { changed, handledPromise, mail };
  }

  function normalizeMessageState(message, when, formatMailDate) {
    const source = message && typeof message === 'object' ? message : {};
    const latestInboundAt = source.latestInboundAt || source.receivedAt || source.date || '';
    const latestOutboundAt = source.latestOutboundAt || '';
    const activityAt = [source.activityAt, latestInboundAt, latestOutboundAt]
      .filter((value) => Number.isFinite(Date.parse(value || '')))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || latestInboundAt;
    const activityWhen = formatMailDate(activityAt);
    return {
      autoSubmitted: source.autoSubmitted || '', precedence: source.precedence || '',
      autoResponseSuppress: source.autoResponseSuppress || '', automatedReplyEvidence: source.automatedReplyEvidence === true,
      time: when.time, date: when.date, listDate: when.listDate,
      activityAt, latestInboundAt, latestOutboundAt,
      activityTime: activityWhen.time, activityDate: activityWhen.date, activityListDate: activityWhen.listDate,
      readAt: String(source.readAt || ''),
    };
  }

  function markReadOnOpen(options = {}) {
    const mail = options.mail;
    if (!mail?.unread || options.skipReadPersist) return false;
    void options.readController?.markRead?.(mail, { render() {
      options.renderList?.({ openLatest: false });
      if (!mail.readPending && String(options.getActiveMail?.()) === String(mail.id)) {
        options.openMail?.(mail.id, {
          skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true,
          preserveVisibleDetail: true,
        });
      }
    } });
    return true;
  }

  function getReadState(mail, campaignInbox) {
    const conversationAction = campaignInbox?.getConversationAction?.(mail);
    const replyTarget = conversationAction?.kind === 'reply' ? (conversationAction.message || mail) : mail;
    return {
      conversationAction, replyTarget,
      replyHandled: !conversationAction || conversationAction.kind !== 'reply' || Boolean(replyTarget.replyDismissedAt),
      readPending: Boolean(mail?.readPending || replyTarget?.readPending || replyTarget?.replyDismissPending),
      readError: String(replyTarget?.readError || mail?.readError || ''),
    };
  }

  function renderReadTools(state, id, escapeHtml) {
    const html = typeof escapeHtml === 'function' ? escapeHtml : String;
    const source = state && typeof state === 'object' ? state : {};
    const handled = Boolean(source.replyHandled);
    const pending = Boolean(source.readPending);
    const readError = String(source.readError || '');
    const safeId = html(id);
    return `${readError ? `<button class="detail-read-retry" type="button" data-mailbox-action="retry-read" data-mailbox-id="${safeId}">Niet opgeslagen · opnieuw</button>` : pending ? '<span class="detail-read-pending" role="status">Wordt opgeslagen…</span>' : ''}
      <button class="detail-mark-read ${handled ? 'is-complete' : ''} ${pending ? 'is-pending' : ''}" type="button" data-mailbox-action="mark-read" data-mailbox-id="${safeId}" aria-label="${pending ? 'Gelezen status wordt opgeslagen' : handled ? 'Gesprek vraagt geen antwoord' : 'Als gelezen afhandelen'}" title="${pending ? 'Gelezen status wordt opgeslagen' : handled ? 'Geen antwoord nodig' : 'Als gelezen afhandelen'}" aria-pressed="${handled ? 'true' : 'false'}" aria-busy="${pending ? 'true' : 'false'}" ${(handled || pending) ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/><path d="m9 13.5 2 2 4-4"/></svg>
      </button>`;
  }

  async function retryRead(options = {}) {
    const mail = options.mail;
    if (!mail) return { ok: false };
    const state = getReadState(mail, options.campaignInbox);
    const render = () => {
      options.renderList?.({ openLatest: false });
      if (String(options.getActiveMail?.()) === String(mail.id)) {
        options.openMail?.(mail.id, {
          skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true,
          preserveVisibleDetail: true,
        });
      }
    };
    if (state.conversationAction?.kind === 'reply' && state.replyTarget?.readError) {
      return options.dismissReply?.(mail, { render });
    }
    return options.readController?.markRead?.(mail, { render });
  }

  async function handleReadAction(action, options = {}) {
    const mail = options.mail;
    if (!mail) return { ok: false };
    if (action === 'mark-read') {
      const requestedMailId = String(mail.id || '');
      const activeMailIdAtRequest = String(options.getActiveMail?.() || '');
      return options.dismissReply?.(mail, { render() {
        options.renderList?.({ openLatest: false });
        if (!requestedMailId || requestedMailId !== activeMailIdAtRequest || String(options.getActiveMail?.() || '') !== activeMailIdAtRequest) return;
        options.openMail?.(mail.id, {
          skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true,
          preserveVisibleDetail: true,
        });
      } });
    }
    return retryRead(options);
  }

  const api = { completeAcceptedSend, getReadState, handleReadAction, markReadOnOpen, normalizeMessageState, reconcileMessage, refresh, renderReadTools, retryRead };
  global.SoftoraMailboxUiState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
