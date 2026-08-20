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
    { key: 'phone', pattern: /^(?:[-*•]\s*)?(?:phone|tel(?:efoon)?|mobiel|mobile|t)\.?\s*(?::\s*|\s+)(.*)$/i },
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
  function findDirectBodyEnd(body, lines) {
    const quotedThread = getQuotedThreadApi();
    if (quotedThread && typeof quotedThread.findQuotedSegments === 'function') {
      try {
        const segments = quotedThread.findQuotedSegments(body).segments || [];
        const starts = segments
          .map((segment) => Number(segment && segment.start))
          .filter((start) => Number.isInteger(start) && start >= 0);
        if (starts.length) return Math.min(...starts);
      } catch (_) {
        // Fail open below when a host supplies an incompatible quote parser.
      }
    }
    const fallbackIndex = lines.findIndex((line) => (
      /^\s*>/.test(String(line || '')) ||
      /^(?:-{2,}|_{2,})\s*(?:original message|oorspronkelijk(?:e)? bericht|forwarded message|doorgestuurd bericht)/i.test(normalizeWhitespace(line))
    ));
    return fallbackIndex >= 0 ? fallbackIndex : lines.length;
  }

  function matchField(value) {
    const line = normalizeWhitespace(value);
    for (const field of FIELD_PATTERNS) {
      const match = field.pattern.exec(line);
      if (match) return { key: field.key, value: String(match[1] || '') };
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

  function extractContact(signatureLines) {
    const values = { phone: '', street: '', postcode: '', city: '', country: '' };
    for (let index = 1; index < signatureLines.length; index += 1) {
      const field = matchField(signatureLines[index]);
      if (!field || values[field.key]) continue;
      values[field.key] = readFieldValue(signatureLines, index, field.value);
    }
    const addressLines = [];
    appendUnique(addressLines, values.street);
    appendUnique(addressLines, [values.postcode, values.city].filter(Boolean).join(' '));
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

  function parseIncoming(body) {
    const normalizedBody = normalizeBody(body);
    const lines = normalizedBody ? normalizedBody.split('\n') : [];
    const directBodyEnd = findDirectBodyEnd(normalizedBody, lines);
    let signatureStart = -1;
    for (let index = directBodyEnd - 1; index >= 0; index -= 1) {
      if (isStandaloneSignoff(lines[index])) {
        signatureStart = index;
        break;
      }
    }
    if (signatureStart < 0) {
      return { bodyLines: lines, contact: emptyContact(), matched: false };
    }
    const signatureLines = lines.slice(signatureStart, directBodyEnd);
    return {
      bodyLines: trimOuterBlankLines([
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
      items.push(`<div class="detail-mail-contact-item"><dt>Telefoon</dt><dd>${phoneValue}</dd></div>`);
    }
    if (addressLines.length) {
      items.push(`<div class="detail-mail-contact-item"><dt>Adres</dt><dd class="detail-mail-contact-value">${addressLines.map(escapeValue).join('<br>')}</dd></div>`);
    }
    return `<address class="detail-mail-contact-card" aria-label="Contactgegevens uit handtekening"><span class="detail-mail-contact-title">Contactgegevens</span><dl class="detail-mail-contact-grid">${items.join('')}</dl></address>`;
  }

  const api = { parseIncoming, renderContactCard };
  if (global) global.SoftoraMailboxSignature = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
