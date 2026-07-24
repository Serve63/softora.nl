(function (global) {
  'use strict';

  let rewriteUsed = false;

  function getRewriteButton(documentRef = global.document) {
    return documentRef?.querySelector?.('[data-mailbox-action="rewrite-compose"]') || null;
  }

  function reset(isSuggestedReply = false, documentRef = global.document) {
    rewriteUsed = false;
    const button = getRewriteButton(documentRef);
    if (!button) return;
    button.hidden = false;
    button.disabled = false;
    button.textContent = isSuggestedReply ? 'Voorgestelde reactie' : 'Verwoord dit beter';
  }

  function complete(button) {
    rewriteUsed = true;
    if (button) button.hidden = true;
  }

  function finish(button, fallbackLabel) {
    if (!button) return;
    button.disabled = rewriteUsed;
    if (!rewriteUsed) button.textContent = fallbackLabel;
  }

  function getMessageTimestamp(message) {
    const timestamp = Date.parse(String(message && (message.receivedAt || message.internalDate || message.date) || ''));
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }

  function getOriginalSentMail(mail) {
    const sentMessages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => String(message && message.folder || '').trim().toLowerCase() === 'sent')
      .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
    const original = sentMessages.find((message) => message && message.originalCampaignOutbound === true)
      || sentMessages[0];
    if (!original) return null;
    return {
      id: original.id || original.mailboxId || '',
      from: original.from || '',
      email: original.email || '',
      to: original.to || '',
      subject: original.subject || '',
      preview: original.preview || '',
      body: original.body || original.preview || '',
      date: original.date || original.receivedAt || '',
      folder: 'sent',
    };
  }

  function buildReplyContext(mail, options = {}) {
    if (!mail) return null;
    const getAccount = typeof options.getAccount === 'function' ? options.getAccount : () => '';
    return {
      id: mail.id,
      from: mail.from,
      email: mail.email,
      subject: mail.subject,
      preview: mail.preview,
      body: mail.body,
      date: mail.date,
      time: mail.time,
      folder: mail.folder || options.activeFolder || 'inbox',
      accountEmail: getAccount(mail, options.fallbackAccount),
      originalSentMail: getOriginalSentMail(mail),
    };
  }

  const api = {
    buildReplyContext,
    complete,
    finish,
    getOriginalSentMail,
    isUsed: () => rewriteUsed,
    reset,
  };
  global.SoftoraMailboxCompose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
