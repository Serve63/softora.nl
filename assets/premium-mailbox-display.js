(function (global) {
  const SENDER_CTA_LINKS = Object.freeze({});
  const MAILBOX_TIME_ZONE = 'Europe/Amsterdam';

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function formatDetailSubject(value) {
    const subject = String(value || '').trim().replace(/^email received\s*-\s*/i, '').trim();
    return subject || '(Geen onderwerp)';
  }

  function normalizeComparableMailUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '');
      return `${host}${path}${parsed.search}${parsed.hash}`.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isLabelledUrlMatch(label, url) {
    if (/^deze link$/i.test(String(label || '').trim())) return true;
    const normalizedLabel = normalizeComparableMailUrl(label);
    return Boolean(normalizedLabel && normalizedLabel === normalizeComparableMailUrl(url));
  }

  function isGmailSignatureAssetUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim().replace(/^\[|\]$/g, ''));
      return /(^|\.)googleusercontent\.com$/i.test(parsed.hostname) && /^\/mail-sig\//i.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  }

  function collapseDuplicateAnnotations(line) {
    return String(line || '').replace(
      /\b([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})\s+\[(?:mailto:)?([^\]\s]+)\]/gi,
      (match, label, target) => normalizeEmail(label) === normalizeEmail(target) ? label : match
    );
  }

  function normalizeRepeatedLine(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function removeDuplicateSignatureLeadLines(lines) {
    const result = Array.isArray(lines) ? lines.slice() : [];
    for (let index = 0; index < result.length; index += 1) {
      if (String(result[index] || '').trim() !== '--') continue;
      let previousIndex = index - 1;
      while (previousIndex >= 0 && !String(result[previousIndex] || '').trim()) previousIndex -= 1;
      let nextIndex = index + 1;
      while (nextIndex < result.length && !String(result[nextIndex] || '').trim()) nextIndex += 1;
      const previous = normalizeRepeatedLine(result[previousIndex]);
      const next = normalizeRepeatedLine(result[nextIndex]);
      if (!previous || previous !== next) continue;
      result.splice(previousIndex, 1);
      index -= 1;
    }
    return result;
  }

  function expandCollapsedMailText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/^((?:Dag|Hoi|Hallo)\s+[^,\n]{1,80},)(?=\S)/i, '$1\n\n')
      .replace(/([.!?])(?=[A-Z\u00c0-\u00d6\u00d8-\u00de])/g, '$1\n\n')
      .replace(/\b(Met vriendelijke groet|Vriendelijke groet|Hartelijke groet|Groet|Kind regards|Best regards|Cheers)(,?)(?=[A-Z\u00c0-\u00d6\u00d8-\u00de])/g, '$1$2\n')
      .replace(/\s+(?=Verzonden vanaf mijn (?:Galaxy|iPhone|Android)\b)/gi, '\n');
  }

  function normalizeCollapsedReplyStructure(value) {
    const source = String(value || '').replace(/\u00a0/g, ' ');
    const separator = /-{5,}\s*(?:Oorspronkelijk bericht|Original message)\s*-{5,}/i;
    const match = separator.exec(source);
    if (!match) return source;

    const received = expandCollapsedMailText(source.slice(0, match.index)).trimEnd();
    let quoted = source.slice(match.index + match[0].length)
      .trimStart()
      .replace(/\s+(?=(?:Van|From|Datum|Date|Aan|To|Onderwerp|Subject):\s)/gi, '\n');
    quoted = quoted.replace(
      /((?:Onderwerp|Subject):[^\n]{0,200}?)\s+(?=(?:Goedendag|Goedemorgen|Goedemiddag|Goedenavond|Hoi|Hallo|Beste|Dear|Hello)\b)/i,
      '$1\n\n'
    );
    quoted = expandCollapsedMailText(quoted).trimStart();
    return [received, quoted].filter(Boolean).join('\n\n');
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
    collapseDuplicateAnnotations,
    formatDetailSubject,
    isSentMessage,
    isGmailSignatureAssetUrl,
    isLabelledUrlMatch,
    normalizeCollapsedReplyStructure,
    removeDuplicateSignatureLeadLines,
    getListPrimaryText,
    getDetailPrimaryText,
    getDetailSecondaryText,
    getAvatarText,
    getReplyToAddress,
    buildSearchText,
    formatMailDate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
