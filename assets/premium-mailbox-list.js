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
    const listDate = mail.activityListDate || mail.listDate;
    const listTime = mail.activityTime || mail.time;
    const copyKind = mail.copyContext && mail.copyContext.evidenceKnown === true &&
      ['bcc', 'cc'].includes(String(mail.copyContext.kind || '').toLowerCase())
      ? String(mail.copyContext.kind).toUpperCase()
      : '';
    return `
    <div class="mail-item ${mail.unread ? 'unread' : ''} ${String(options.activeMail) === String(mail.id) ? 'active' : ''}" data-mailbox-received-at="${escapeHtml(activityAt)}">
      ${mail.unread ? '<div class="unread-dot"></div>' : ''}
      <button class="mail-item-open" type="button" data-mailbox-action="open-mail" data-mailbox-id="${escapeHtml(mail.id)}" aria-label="${escapeHtml(primaryText)} openen">
        <span class="mail-item-top">
          <span class="mail-from">${escapeHtml(primaryText)}${copyKind ? `<span class="mail-copy-badge">${escapeHtml(copyKind)}</span>` : ''}</span>
          <time class="mail-time" datetime="${escapeHtml(activityAt)}">
            ${listDate ? `<span class="mail-date-label">${escapeHtml(listDate)}</span>` : ''}
            <span class="mail-time-value">${escapeHtml(listTime)}</span>
          </time>
        </span>
      </button>
    </div>`;
  }

  const mailboxListApi = { renderItem };
  global.SoftoraMailboxList = mailboxListApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxListApi;
})(typeof window !== 'undefined' ? window : globalThis);
