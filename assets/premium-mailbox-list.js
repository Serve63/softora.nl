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
    const isActive = String(options.activeMail) === String(mail.id);
    const activityAt = mail.activityAt || mail.receivedAt || '';
    const listDate = mail.activityListDate || mail.listDate;
    const listTime = mail.activityTime || mail.time;
    return `
    <div class="mail-item ${mail.unread ? 'unread' : ''} ${isActive ? 'active' : ''}" data-mailbox-received-at="${escapeHtml(activityAt)}">
      ${mail.unread ? '<div class="unread-dot"></div>' : ''}
      <button class="mail-item-open" type="button" data-mailbox-action="open-mail" data-mailbox-id="${escapeHtml(mail.id)}" aria-label="${escapeHtml(primaryText)} openen">
        <span class="mail-item-top">
          <span class="mail-from">${escapeHtml(primaryText)}</span>
          <time class="mail-time" datetime="${escapeHtml(activityAt)}">
            ${listDate ? `<span class="mail-date-label">${escapeHtml(listDate)}</span>` : ''}
            <span class="mail-time-value">${escapeHtml(listTime)}</span>
          </time>
        </span>
      </button>
      ${isActive ? `
        <button class="mail-item-delete" type="button" data-mailbox-action="delete-mail" data-mailbox-id="${escapeHtml(mail.id)}" aria-label="Mail verwijderen" title="Mail verwijderen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
        </button>` : ''}
    </div>`;
  }

  const mailboxListApi = { renderItem };
  global.SoftoraMailboxList = mailboxListApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxListApi;
})(typeof window !== 'undefined' ? window : globalThis);
