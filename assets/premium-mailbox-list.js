(function (global) {
  function renderItem(mail, options = {}) {
    const escapeHtml = options.escapeHtml;
    const display = options.display;
    if (typeof escapeHtml !== 'function' || !display || typeof display.getListPrimaryText !== 'function') {
      return '';
    }
    const displayOptions = options.displayOptions || {};
    const primaryText = display.getListPrimaryText(mail, {
      ...displayOptions,
      account: mail.accountEmail || displayOptions.account,
    });
    const activityAt = mail.activityAt || mail.receivedAt || '';
    const activityWhen = Number.isFinite(Date.parse(activityAt)) && typeof display.formatMailDate === 'function'
      ? display.formatMailDate(activityAt)
      : null;
    const listDate = activityWhen ? activityWhen.listDate : Object.prototype.hasOwnProperty.call(mail, 'activityListDate')
      ? mail.activityListDate
      : mail.listDate;
    const listTime = activityWhen ? activityWhen.time : mail.activityTime || mail.time;
    const copyKind = mail.copyContext && mail.copyContext.evidenceKnown === true &&
      ['bcc', 'cc'].includes(String(mail.copyContext.kind || '').toLowerCase())
      ? String(mail.copyContext.kind).toUpperCase()
      : '';
    const isInstantly = String(mail && mail.provider || '').trim().toLowerCase() === 'instantly';
    const conversationAction = global.SoftoraMailboxCampaignInbox &&
      typeof global.SoftoraMailboxCampaignInbox.getConversationAction === 'function'
      ? global.SoftoraMailboxCampaignInbox.getConversationAction(mail)
      : null;
    const needsReply = global.SoftoraMailboxCampaignInbox?.needsConversationReply?.(mail, conversationAction)
      ?? (conversationAction?.kind === 'reply' && !conversationAction.message?.replyDismissedAt);
    const searchMatch = mail && mail.searchMatch;
    const searchSnippet = searchMatch && global.SoftoraMailboxDiscovery?.renderSearchSnippet?.(
      searchMatch, mail.searchQuery, escapeHtml
    );
    const badges = copyKind ? `<span class="mail-copy-badge">${escapeHtml(copyKind)}</span>` : '';
    const cornerLabel = needsReply
      ? isInstantly ? 'Instantly · wacht op jouw antwoord' : 'Wacht op jouw antwoord'
      : '';
    const cornerClass = isInstantly ? 'mail-provider-corner-instantly' : 'mail-reply-corner';
    return `
    <div class="mail-item ${mail.unread ? 'unread' : ''} ${needsReply ? 'needs-reply' : ''} ${String(options.activeMail) === String(mail.id) ? 'active' : ''}" data-mailbox-received-at="${escapeHtml(activityAt)}">
      ${mail.unread ? '<div class="unread-dot"></div>' : ''}
      ${cornerLabel ? `<span class="${cornerClass}" role="img" aria-label="${escapeHtml(cornerLabel)}" title="${escapeHtml(cornerLabel)}"></span>` : ''}
      <button class="mail-item-open" type="button" data-mailbox-action="open-mail" data-mailbox-id="${escapeHtml(mail.id)}" aria-label="${escapeHtml(primaryText)} openen">
        <span class="mail-item-content">
          <span class="mail-item-top">
            <span class="mail-from">${escapeHtml(primaryText)}${badges}</span>
            <time class="mail-time" datetime="${escapeHtml(activityAt)}">
              ${listDate ? `<span class="mail-date-label">${escapeHtml(listDate)}</span>` : ''}
              <span class="mail-time-value">${escapeHtml(listTime)}</span>
            </time>
          </span>
          ${searchSnippet ? `<span class="mail-search-snippet"><strong>${escapeHtml(searchMatch.field || 'match')}</strong> · ${searchSnippet}</span>` : ''}
        </span>
      </button>
    </div>`;
  }

  // Opening an existing row only changes selection. Rebuilding every hydrated
  // conversation here turns a cache hit into hundreds of milliseconds of work.
  function selectItem(documentRef, id) {
    const rows = Array.from(documentRef?.getElementById?.('mail-items')?.querySelectorAll?.('[data-mailbox-action="open-mail"]') || []);
    const key = String(id || '');
    if (!rows.some((row) => row.getAttribute('data-mailbox-id') === key)) return false;
    rows.forEach((row) => row.closest('.mail-item')?.classList.toggle('active', row.getAttribute('data-mailbox-id') === key));
    return true;
  }

  const mailboxListApi = { renderItem, selectItem };
  global.SoftoraMailboxList = mailboxListApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxListApi;
})(typeof window !== 'undefined' ? window : globalThis);
