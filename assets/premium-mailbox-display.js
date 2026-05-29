(function (global) {
  const SENDER_CTA_LINKS = Object.freeze({});

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

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

  function getSenderCtaLink(options) {
    const mail = options && options.mail;
    const candidates = [
      options && options.senderEmail,
      mail && mail.email,
      options && options.account,
    ];
    for (const candidate of candidates) {
      const email = normalizeEmail(candidate);
      if (SENDER_CTA_LINKS[email]) return SENDER_CTA_LINKS[email];
    }
    return null;
  }

  function applySenderCtaLinks(html, text, options, helpers) {
    const cta = getSenderCtaLink(options);
    const escapeHtml = helpers && helpers.escapeHtml;
    const isSafeUrl = helpers && helpers.isSafeUrl;
    if (!cta || !String(text || '').includes(cta.text) || typeof escapeHtml !== 'function' || !isSafeUrl(cta.url)) {
      return html;
    }
    const label = escapeHtml(cta.text);
    const link = `<a href="${escapeHtml(cta.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return String(html || '').split(label).join(link);
  }

  global.SoftoraMailboxDisplay = {
    applySenderCtaLinks,
    isSentMessage,
    getListPrimaryText,
    getDetailPrimaryText,
    getDetailSecondaryText,
    getAvatarText,
    getReplyToAddress,
    buildSearchText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
