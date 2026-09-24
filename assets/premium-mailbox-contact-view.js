(function (global) {
  'use strict';

  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim()
    .replace(/^([*_]{1,2})(.+)\1$/, '$2');
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/=/g, '&#61;');
  const street = /^(?:[\p{L}][\p{L} .'’/-]{1,85}\s+\d{1,5}[a-z]?(?:[-/]\d{1,5}[a-z]?)?|postbus\s+\d{1,7})$/iu;
  const postcode = /^\d{4}\s?[a-z]{2}\s+\p{L}/iu;
  const contactField = /^(?:tel(?:efoon)?|phone|mobiel|mobile|whatsapp|fax|adres|address|straat|street|postcode|plaats|city|land|country|[tmefwi])\s*[.:]/i;
  const postscriptStart = /^(?:p\.?s\.?\s*[:.]?\s+|n\.?b\.?\s*:\s*)/i;
  const noteStart = /^(?:p\.?s\.?\s*[:.]?\s+|n\.?b\.?\s*:\s*|(?:kun|kan|wil|zou) (?:je|jij|u|jullie)\b|(?:bel|mail|stuur) (?:mij|me|ons|de|het)\b|graag\b|(?:ik|wij|we) (?:kom|komen|zal|zullen|heb|hebben|wil|willen|hoor|horen|ontvang|ontvangen|bespreek|bespreken)\b|please (?:call|send|let me know)\b)/i;

  function phone(value) {
    let raw = clean(value).replace(/^[📞☎☏]\uFE0F?\s*/u, 'Tel: ');
    const link = /^\[([^\]]+)\]\(tel:([+\d(). /-]+)\)$/i.exec(raw);
    if (link) raw = `Tel: ${link[2]}`;
    const labelled = /^(?:\*?(?:tel(?:efoon)?|phone|mobiel|mobile|whatsapp|fax|internationaal|international|[tmf])\*?(?:[.:]\s*|\s+))(.+)$/i.exec(raw);
    raw = clean(labelled ? labelled[1] : raw).replace(/^\[([+\d(). /-]+)\]$/, '$1');
    const extension = /\s+(?:toestel|ext(?:ension)?\.?)\s*:?\s*(\d{1,6})$/i.exec(raw);
    if (extension) raw = raw.slice(0, extension.index).trim();
    raw = raw.replace(/^(\+\d{1,3}|00\d{1,3})\s*\(0\)\s*/, '$1 ');
    if (!/^(?:\+|00)?[\d(). /-]+$/.test(raw)) return null;
    let digits = raw.replace(/[(). /-]/g, '');
    if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
    if (!/^(?:0[1-9]\d{8}|\+[1-9]\d{6,14})$/.test(digits) &&
      !(labelled && /^\d{7,15}$/.test(digits))) return null;
    const key = /^0[1-9]\d{8}$/.test(digits) ? `+31${digits.slice(1)}` : digits;
    const local = /^\+31[1-9]\d{8}$/.test(digits) ? `0${digits.slice(3)}` : digits;
    const display = /^06\d{8}$/.test(local) ? local.match(/.{2}/g).join(' ') : raw;
    return { key: `${key}${extension ? `;ext=${extension[1]}` : ''}`,
      href: `tel:${local}${extension ? `;ext=${extension[1]}` : ''}`,
      text: `${display}${extension ? ` (toestel ${extension[1]})` : ''}` };
  }

  function rows(values) {
    return values.flatMap((value) => String(value ?? '').split(/\r?\n/)).flatMap((value) =>
      clean(value).replace(/^📍\s*/u, '').split(/\s*[|·•]\s*/)).map(clean).filter(Boolean);
  }

  function contactDetails(source = {}) {
    const lines = rows([source.phone ? `Tel: ${source.phone}` : '', ...(source.beforeLines || []),
      ...(source.preservedLines || []), ...(source.addressLines || [])]);
    const phones = [];
    const addresses = [];
    const seenPhones = new Set();
    const seenAddresses = new Set();
    const addAddress = (line) => {
      const stripped = clean(line).replace(/^(?:adres|address|straat|street|postcode|plaats|city|land|country)\s*:\s*/i, '');
      const value = global.SoftoraMailboxAiPresentation?.formatAddressLine?.(stripped) ?? stripped;
      const key = value.toLowerCase().replace(/(\d{4})\s*([a-z]{2})\b/g, '$1$2');
      if (value && !seenAddresses.has(key)) { seenAddresses.add(key); addresses.push(value); }
    };
    (source.addressLines || []).forEach(addAddress);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const number = phone(line);
      if (number && !seenPhones.has(number.key)) { seenPhones.add(number.key); phones.push(number); }
      const address = line.replace(/^(?:adres|address|straat|street)\s*:\s*/i, '');
      if (street.test(address) && postcode.test(lines[index + 1] || '')) {
        addAddress(address);
        addAddress(lines[index + 1]);
      }
    }
    return { phones, addresses };
  }

  function authoredNotes(signatureLines = []) {
    const kept = [];
    let continuing = false;
    let postscript = false;
    for (let index = 0; index < signatureLines.length; index += 1) {
      const line = clean(signatureLines[index]);
      // Only recover personal additions inside an already proven signature.
      // Standalone contact fields, signoffs and automatic footers stay outside
      // the authored message, even after a postscript.
      const startsNote = noteStart.test(line);
      const address = street.test(line) && (!postscript || postcode.test(clean(signatureLines[index + 1])));
      const standaloneLink = /^(?:https?:\/\/|www\.|\S+@\S+)/i.test(line);
      const boundary = !line || !startsNote && (contactField.test(line) || phone(line) || address || postcode.test(line) ||
        standaloneLink && !postscript ||
        /^(?:[>_=-]{2,}|(?:met )?vriendelijke groet|groet(?:en)?\b|kind regards|best regards|verzonden vanaf|sent from|volg ons|follow us|de informatie|this e-?mail|print deze)/i.test(line));
      if (boundary) {
        if (continuing && kept.length) kept.push('');
        continuing = false;
        postscript = false;
        continue;
      }
      if (startsNote || continuing) {
        kept.push(line);
        postscript = postscript || postscriptStart.test(line);
        continuing = postscript || !/[.!?]["'”’)]?$/.test(line);
      }
    }
    return kept.join('\n').trim();
  }

  function renderContactDetails(source) {
    const { phones, addresses } = contactDetails(source);
    if (!phones.length && !addresses.length) return '';
    const fields = [];
    if (phones.length) fields.push(`<div class="detail-mail-contact-item"><dt>Telefoon:</dt><dd>${phones.map((item) =>
      `<div><a class="detail-mail-contact-link" href="${escape(item.href)}">${escape(item.text)}</a></div>`).join('')}</dd></div>`);
    if (addresses.length) fields.push(`<div class="detail-mail-contact-item"><dt>Adres:</dt><dd class="detail-mail-contact-value detail-mail-contact-address" aria-label="${escape(addresses.join(', '))}">${addresses.map((line) => `<div>${escape(line)}</div>`).join('')}</dd></div>`);
    return `<address class="detail-mail-contact-card" aria-label="Contactgegevens uit handtekening"><dl class="detail-mail-contact-grid">${fields.join('')}</dl></address>`;
  }

  const api = { authoredNotes, contactDetails, renderContactDetails };
  global.SoftoraMailboxContactView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
