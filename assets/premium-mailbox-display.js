(function (global) {
  function isSentMessage(mail, options) {
    return String(mail && (mail.folder || (options && options.activeFolder)) || '').toLowerCase() === 'sent';
  }

  function getRecipientText(mail) {
    return String(mail && (mail.to || mail.email) || '').trim() || 'onbekende ontvanger';
  }

  function getListPrimaryText(mail, options) {
    if (isSentMessage(mail, options)) return 'Aan: ' + getRecipientText(mail);
    return String(mail && mail.from || '').trim() || 'Onbekend';
  }

  function getDetailPrimaryText(mail, options) {
    if (isSentMessage(mail, options)) return 'Aan: ' + getRecipientText(mail);
    return String(mail && mail.from || '').trim() || 'Onbekend';
  }

  function getDetailSecondaryText(mail, options) {
    if (isSentMessage(mail, options)) {
      const sender = String(mail && mail.email || (options && options.account) || '').trim();
      return sender ? 'Van: ' + sender : '';
    }
    return String(mail && mail.email || '').trim();
  }

  function getAvatarText(mail, options) {
    return isSentMessage(mail, options) ? getRecipientText(mail) : getListPrimaryText(mail, options);
  }

  function getReplyToAddress(mail, options) {
    return isSentMessage(mail, options)
      ? String(mail && mail.to || '').trim()
      : String(mail && mail.email || '').trim();
  }

  function buildSearchText(mail, options) {
    return [
      getListPrimaryText(mail, options),
      mail && mail.from,
      mail && mail.email,
      mail && mail.to,
      mail && mail.subject,
      mail && mail.preview,
    ].join(' ').toLowerCase();
  }

  global.SoftoraMailboxDisplay = {
    isSentMessage,
    getListPrimaryText,
    getDetailPrimaryText,
    getDetailSecondaryText,
    getAvatarText,
    getReplyToAddress,
    buildSearchText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
