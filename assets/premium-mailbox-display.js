(function (global) {
  const SENDER_CTA_LINKS = Object.freeze({});
  const MAILBOX_TIME_ZONE = 'Europe/Amsterdam';

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

  function getAmsterdamDayNumber(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: MAILBOX_TIME_ZONE,
      year: 'numeric',
    }).formatToParts(value).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = Number(part.value);
      return result;
    }, {});
    return Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
  }

  function formatMailDate(value, nowValue) {
    const date = value ? new Date(value) : new Date();
    const now = nowValue ? new Date(nowValue) : new Date();
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) return { date: '', listDate: '', time: '' };
    const dayDifference = getAmsterdamDayNumber(now) - getAmsterdamDayNumber(date);
    const listDate = dayDifference === 0
      ? ''
      : dayDifference === 1
        ? 'Gisteren'
        : dayDifference === 2
          ? 'Eergisteren'
          : date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: MAILBOX_TIME_ZONE });
    return {
      date: listDate || 'Vandaag',
      listDate,
      time: date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: MAILBOX_TIME_ZONE }),
    };
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
    formatMailDate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
