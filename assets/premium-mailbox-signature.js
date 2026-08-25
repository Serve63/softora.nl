(function initSoftoraMailboxSignature(global) {
  'use strict';
  const SIGNOFF_PHRASES = new Set([
    'met vriendelijke groet',
    'met vriendelijke groeten',
    'vriendelijke groet',
    'vriendelijke groeten',
    'met hartelijke groet',
    'met hartelijke groeten',
    'hartelijke groet',
    'hartelijke groeten',
    'muzikale groet',
    'muzikale groeten',
    'groet',
    'groeten',
    'mvg',
    'hoogachtend',
    'kind regards',
    'with kind regards',
    'best regards',
    'warm regards',
    'regards',
    'sincerely',
    'yours sincerely',
    'cheers',
  ]);
  const FIELD_PATTERNS = [
    { key: 'phone', label: 'phone', pattern: /^(?:[-*•]\s*)?(?:phone|tel(?:efoon)?|mobiel|mobile|t)\.?\s*(?::\s*|\s+)(.*)$/i },
    { key: 'phone', label: 'm', requiresPhoneLikeValue: true, pattern: /^(?:[-*•]\s*)?m\.?\s*(?::\s*|\s+)(.*)$/i },
    { key: 'street', pattern: /^(?:[-*•]\s*)?(?:street|straat|address|adres)\s*:\s*(.*)$/i },
    { key: 'postcode', pattern: /^(?:[-*•]\s*)?(?:postcode|zip(?:\s+code)?|postal\s+code)\s*:\s*(.*)$/i },
    { key: 'city', pattern: /^(?:[-*•]\s*)?(?:city|plaats|stad)\s*:\s*(.*)$/i },
    { key: 'country', pattern: /^(?:[-*•]\s*)?(?:country|land)\s*:\s*(.*)$/i },
  ];
  let commonJsQuotedThread;
  function normalizeWhitespace(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .trim();
  }
  function normalizeBody(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');
  }
  function emptyContact() {
    return { phone: '', phoneHref: '', addressLines: [] };
  }
  function normalizeSignoffPart(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[.,!;:]+$/g, '')
      .trim();
  }
  function isStandaloneSignoff(value) {
    const line = normalizeWhitespace(value);
    if (!line || /^>/.test(line)) return false;
    if (line === '--') return true;
    const parts = line.split(/\s*(?:\/|\|)\s*/).filter(Boolean);
    return Boolean(parts.length && parts.every((part) => SIGNOFF_PHRASES.has(normalizeSignoffPart(part))));
  }
  function isStrongSignatureSeparator(value) {
    return normalizeWhitespace(value) === '--';
  }
  function getQuotedThreadApi() {
    if (global && global.SoftoraMailboxQuotedThread) return global.SoftoraMailboxQuotedThread;
    if (commonJsQuotedThread !== undefined) return commonJsQuotedThread;
    commonJsQuotedThread = null;
    if (typeof module !== 'undefined' && module.exports) {
      try {
        commonJsQuotedThread = require('./premium-mailbox-quoted-thread.js');
      } catch (_) {
        commonJsQuotedThread = null;
      }
    }
    return commonJsQuotedThread;
  }
  function findQuotedSegments(body) {
    const quotedThread = getQuotedThreadApi();
    if (quotedThread && typeof quotedThread.findQuotedSegments === 'function') {
      try {
        return (quotedThread.findQuotedSegments(body).segments || [])
          .map((segment) => ({
            start: Number(segment && segment.start),
            end: Number(segment && segment.end),
            marker: String(segment && segment.marker || ''),
            headerFields: segment && segment.headerFields && typeof segment.headerFields === 'object'
              ? segment.headerFields
              : {},
          }))
          .filter((segment) => (
            Number.isInteger(segment.start) &&
            Number.isInteger(segment.end) &&
            segment.start >= 0 &&
            segment.end > segment.start
          ));
      } catch (_) {
        // Fail open below when a host supplies an incompatible quote parser.
      }
    }
    return [];
  }

  function findDirectBodyEnd(body, lines, quotedSegments) {
    const starts = (Array.isArray(quotedSegments) ? quotedSegments : findQuotedSegments(body))
      .map((segment) => segment.start);
    if (starts.length) return Math.min(...starts);
    const fallbackIndex = lines.findIndex((line) => (
      /^\s*>/.test(String(line || '')) ||
      /^(?:-{2,}|_{2,})\s*(?:original message|oorspronkelijk(?:e)? bericht|forwarded message|doorgestuurd bericht)/i.test(normalizeWhitespace(line))
    ));
    return fallbackIndex >= 0 ? fallbackIndex : lines.length;
  }

  function normalizeIdentityText(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function extractEmails(value) {
    return (String(value == null ? '' : value).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .map((email) => email.toLowerCase());
  }

  function buildSenderEvidence(messageContext) {
    const context = messageContext && typeof messageContext === 'object' && !Array.isArray(messageContext)
      ? messageContext
      : {};
    const emailValues = [context.email, context.fromEmail, context.senderEmail, context.from];
    const emails = Array.from(new Set(emailValues.flatMap(extractEmails)));
    const names = Array.from(new Set([context.from, context.fromName, context.senderName]
      .map((value) => String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' '))
      .map(normalizeIdentityText)
      .filter((name) => name.split(' ').filter((part) => part.length >= 2).length >= 2)));
    return { emails, names };
  }

  function valueMatchesSenderEvidence(value, senderEvidence) {
    const valueEmails = extractEmails(value);
    if (senderEvidence.emails.some((email) => valueEmails.includes(email))) return true;
    const normalized = ` ${normalizeIdentityText(value)} `;
    return senderEvidence.names.some((name) => normalized.includes(` ${name} `));
  }

  function linesMatchSenderEvidence(lines, senderEvidence) {
    return valueMatchesSenderEvidence((Array.isArray(lines) ? lines : []).join('\n'), senderEvidence);
  }

  function isIgnorableFooterSenderHeader(segment, signatureStart, lines, senderEvidence) {
    if (!segment || segment.marker !== 'sender-header' || segment.start <= signatureStart) return false;
    if (!normalizeWhitespace(lines[segment.start - 1])) return false;
    const fromValues = Array.isArray(segment.headerFields && segment.headerFields.from)
      ? segment.headerFields.from
      : [];
    if (!fromValues.some((value) => valueMatchesSenderEvidence(value, senderEvidence))) return false;
    return linesMatchSenderEvidence(lines.slice(signatureStart + 1, segment.start), senderEvidence);
  }

  function findPostQuoteSignatureStart(lines, quotedSegments, messageContext) {
    const segments = (Array.isArray(quotedSegments) ? quotedSegments : [])
      .slice()
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const senderEvidence = buildSenderEvidence(messageContext);
    if (!segments.length || (!senderEvidence.emails.length && !senderEvidence.names.length)) return -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!isStrongSignatureSeparator(lines[index])) continue;
      if (!linesMatchSenderEvidence(lines.slice(index + 1), senderEvidence)) continue;
      const hasCompletedQuote = segments.some((segment) => segment.start < index && segment.end <= index);
      if (!hasCompletedQuote) continue;
      const hasLaterOrCoveringQuote = segments.some((segment) => (
        segment.end > index &&
        !isIgnorableFooterSenderHeader(segment, index, lines, senderEvidence)
      ));
      if (!hasLaterOrCoveringQuote) return index;
    }
    return -1;
  }

  function hasPostQuoteSignatureSeparator(lines, directBodyEnd) {
    const source = Array.isArray(lines) ? lines : [];
    if (!Number.isInteger(directBodyEnd) || directBodyEnd >= source.length) return false;
    return source.some((line, index) => (
      index > directBodyEnd &&
      isStrongSignatureSeparator(line) &&
      source.slice(index + 1).some((footerLine) => normalizeWhitespace(footerLine))
    ));
  }

  function matchField(value) {
    const line = normalizeWhitespace(value);
    for (const field of FIELD_PATTERNS) {
      const match = field.pattern.exec(line);
      if (match) {
        return {
          key: field.key,
          label: field.label || field.key,
          requiresPhoneLikeValue: field.requiresPhoneLikeValue === true,
          value: String(match[1] || ''),
        };
      }
    }
    return null;
  }

  function cleanFieldValue(value) {
    return normalizeWhitespace(value).replace(/\s*\[\d+\]\s*$/g, '').trim();
  }

  function readFieldValue(lines, index, inlineValue) {
    const inline = cleanFieldValue(inlineValue);
    if (inline) return inline;
    let nextIndex = index + 1;
    while (nextIndex < lines.length && !normalizeWhitespace(lines[nextIndex])) nextIndex += 1;
    if (nextIndex >= lines.length || matchField(lines[nextIndex]) || isStandaloneSignoff(lines[nextIndex])) return '';
    return cleanFieldValue(lines[nextIndex]);
  }

  function buildPhoneHref(value) {
    const phone = cleanFieldValue(value);
    if (!phone || !/^(?:\+|00)?[0-9().\s\/-]+$/.test(phone)) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return '';
    if (phone.startsWith('+')) return `tel:+${digits}`;
    if (phone.startsWith('00') && digits.length > 2) return `tel:+${digits.slice(2)}`;
    return `tel:${digits}`;
  }

  function appendUnique(lines, value) {
    const cleaned = cleanFieldValue(value);
    if (!cleaned) return;
    const key = cleaned.toLocaleLowerCase('nl-NL');
    if (!lines.some((line) => line.toLocaleLowerCase('nl-NL') === key)) lines.push(cleaned);
  }

  function extractCompactDutchAddress(signatureLines) {
    const pattern = /^([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’\- ]{1,80}\s+\d{1,5}[A-Za-z]?(?:[-/]\d{1,5}[A-Za-z]?)?)\s*\|\s*(\d{4})\s*([A-Za-z]{2})\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’\- ]{1,80})$/;
    for (let index = 1; index < signatureLines.length; index += 1) {
      const match = pattern.exec(normalizeWhitespace(signatureLines[index]));
      if (!match) continue;
      return {
        street: cleanFieldValue(match[1]),
        postcodeCity: `${match[2]} ${match[3].toUpperCase()} ${cleanFieldValue(match[4])}`,
      };
    }
    return { street: '', postcodeCity: '' };
  }

  function extractContact(signatureLines) {
    const values = { phone: '', street: '', postcode: '', city: '', country: '' };
    for (let index = 1; index < signatureLines.length; index += 1) {
      const field = matchField(signatureLines[index]);
      if (!field || values[field.key]) continue;
      const fieldValue = readFieldValue(signatureLines, index, field.value);
      if (field.key === 'phone' && field.requiresPhoneLikeValue && !buildPhoneHref(fieldValue)) continue;
      values[field.key] = fieldValue;
    }
    const compactAddress = extractCompactDutchAddress(signatureLines);
    const addressLines = [];
    appendUnique(addressLines, values.street || compactAddress.street);
    appendUnique(addressLines, [values.postcode, values.city].filter(Boolean).join(' ') || compactAddress.postcodeCity);
    appendUnique(addressLines, values.country);
    return {
      phone: cleanFieldValue(values.phone),
      phoneHref: buildPhoneHref(values.phone),
      addressLines,
    };
  }

  function trimOuterBlankLines(lines) {
    const result = Array.isArray(lines) ? lines.slice() : [];
    while (result.length && !normalizeWhitespace(result[0])) result.shift();
    while (result.length && !normalizeWhitespace(result[result.length - 1])) result.pop();
    return result;
  }

  function parseIncoming(body, messageContext) {
    const normalizedBody = normalizeBody(body);
    const lines = normalizedBody ? normalizedBody.split('\n') : [];
    const quotedSegments = findQuotedSegments(normalizedBody);
    const directBodyEnd = findDirectBodyEnd(normalizedBody, lines, quotedSegments);
    let signatureStart = -1;
    let signatureEnd = directBodyEnd;
    let postQuoteSignature = false;
    const postQuoteSignatureStart = findPostQuoteSignatureStart(lines, quotedSegments, messageContext);
    if (postQuoteSignatureStart >= 0) {
      signatureStart = postQuoteSignatureStart;
      signatureEnd = lines.length;
      postQuoteSignature = true;
    } else if (hasPostQuoteSignatureSeparator(lines, directBodyEnd)) {
      return { bodyLines: lines, contact: emptyContact(), matched: false };
    }
    for (let index = directBodyEnd - 1; signatureStart < 0 && index >= 0; index -= 1) {
      if (isStandaloneSignoff(lines[index])) {
        signatureStart = index;
        break;
      }
    }
    if (signatureStart < 0) {
      return { bodyLines: lines, contact: emptyContact(), matched: false };
    }
    const signatureLines = lines.slice(signatureStart, signatureEnd);
    return {
      bodyLines: trimOuterBlankLines(postQuoteSignature
        ? lines.slice(0, signatureStart)
        : [
            ...lines.slice(0, signatureStart),
            ...lines.slice(directBodyEnd),
          ]),
      contact: extractContact(signatureLines),
      matched: true,
    };
  }

  function escapeMarkup(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderContactCard(contact) {
    const source = contact && typeof contact === 'object' ? contact : {};
    const phone = cleanFieldValue(source.phone);
    const phoneHref = buildPhoneHref(phone);
    const addressLines = (Array.isArray(source.addressLines) ? source.addressLines : [])
      .map(cleanFieldValue)
      .filter(Boolean);
    if (!phone && !addressLines.length) return '';
    const escapeValue = (value) => escapeMarkup(value).replace(/=/g, '&#61;');
    const items = [];
    if (phone) {
      const phoneValue = phoneHref
        ? `<a class="detail-mail-contact-link" href="${escapeValue(phoneHref)}">${escapeValue(phone)}</a>`
        : `<span class="detail-mail-contact-value">${escapeValue(phone)}</span>`;
      items.push(`<div class="detail-mail-contact-item"><dt>Telefoon:</dt><dd>${phoneValue}</dd></div>`);
    }
    if (addressLines.length) {
      items.push(`<div class="detail-mail-contact-item"><dt>Adres:</dt><dd class="detail-mail-contact-value">${addressLines.map(escapeValue).join(', ')}</dd></div>`);
    }
    return `<address class="detail-mail-contact-card" aria-label="Contactgegevens uit handtekening"><dl class="detail-mail-contact-grid">${items.join('')}</dl></address>`;
  }

  const api = { parseIncoming, renderContactCard };
  if (global) global.SoftoraMailboxSignature = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
