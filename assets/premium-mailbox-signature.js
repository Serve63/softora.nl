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
    const parts = line.split(/\s*(?:\/|\||,)\s*/).filter(Boolean);
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
    return normalizeWhitespace(value);
  }

  function safeContactHref(value) {
    const source = String(value || '').trim();
    if (!source || /[<>"\s]/.test(source)) return '';
    try {
      const url = new URL(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(source) ? `https://${source}` : source);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href : '';
    } catch (_) { return ''; }
  }

  function signatureReferenceLinks(body) {
    const references = new Map();
    for (const line of normalizeBody(body).split('\n')) {
      const match = /^\s*\[(\d{1,3})\]\s*:?\s+((?!\[)\S+)\s*$/.exec(line);
      if (!match) continue;
      const href = safeContactHref(match[2]);
      // Conflicting definitions cannot prove which destination belongs to a label.
      if (references.has(match[1]) && references.get(match[1]) !== href) references.set(match[1], '');
      else if (!references.has(match[1])) references.set(match[1], href);
    }
    return references;
  }

  function resolveContactLink(value, references = new Map()) {
    const line = normalizeWhitespace(value);
    const markdown = /^(?:[A-Z][.:]?\s+)?\[([^\[\]]+)\]\(([^\s]+)\)$/i.exec(line);
    const numbered = /^([^\[\]]+?)\s+\[(\d{1,3})\]$/.exec(line);
    const annotated = /^([^\[\]]+?)\s+\[(https?:\/\/[^\s\]]+)\]$/i.exec(line);
    const raw = line.replace(/^(?:[-•]|(?:website|web|w|i|e(?:-?mail)?|from)[.:]?)\s+/i, '');
    const href = safeContactHref(markdown?.[2] || annotated?.[2] || (numbered && references.get(numbered[2])) || raw);
    const label = String(markdown?.[1] || annotated?.[1] || numbered?.[1] || raw)
      .replace(/^[-•]\s*/, '').replace(/^[*_]+|[*_]+$/g, '').trim();
    return { href, label };
  }

  function expandReferenceClusters(lines, references) {
    return lines.flatMap((line) => {
      if (!/^\s*(?:\[\d{1,3}\]\s*)+$/.test(line)) return [line];
      const markers = line.match(/\[\d{1,3}\]/g) || [];
      return markers.map((marker) => references.get(marker.slice(1, -1)) || marker);
    });
  }

  function removeOwnedReferenceDefinitions(lines, signatureStart, signatureEnd, references, quotedSegments) {
    const definition = (line) => /^\s*\[(\d{1,3})\]\s*:?\s+(?!\[)\S+\s*$/.exec(line);
    const signatureText = lines.slice(signatureStart, signatureEnd).filter((line) => !definition(line)).join('\n');
    const outsideText = lines.filter((line, index) => (
      (index < signatureStart || index >= signatureEnd) && !definition(line) &&
      !quotedSegments.some((segment) => index >= segment.start && index < segment.end)
    )).join('\n');
    const owned = new Set((signatureText.match(/\[\d{1,3}\]/g) || [])
      .filter((marker) => references.get(marker.slice(1, -1)) && !outsideText.includes(marker))
      .map((marker) => marker.slice(1, -1)));
    const removed = new Set();
    lines.forEach((line, index) => {
      if (owned.has(definition(line)?.[1]) && !quotedSegments.some((segment) => index >= segment.start && index < segment.end)) removed.add(index);
    });
    lines.forEach((line, index) => {
      if (!/^(?:Links|References|Referenties):?$/i.test(line.trim())) return;
      let end = index + 1;
      while (end < lines.length && (!lines[end].trim() || /^[-_=]+$/.test(lines[end].trim()) || definition(lines[end]))) end += 1;
      const definitions = lines.slice(index + 1, end).map((value, offset) => definition(value) ? index + offset + 1 : -1).filter((value) => value >= 0);
      if (definitions.length && definitions.every((value) => removed.has(value))) {
        for (let cursor = index; cursor < end; cursor += 1) removed.add(cursor);
      }
    });
    return removed;
  }

  function normalizeSignatureLines(lines, messageContext) {
    const evidence = buildSenderEvidence(messageContext);
    return stripClientFooter(lines.join('\n'), { signature: true }).split('\n').flatMap((value) => {
      let line = normalizeWhitespace(value);
      if (/^[-*_•\s]+$/.test(line)) return [];
      line = line.replace(/^\*+(?=\p{L})/u, '').replace(/\*+$/, '').trim();
      line = line.replace(/^[📞☎☏]\uFE0F?\s*/u, 'Tel: ').replace(/^📍\s*/u, '');
      // Only split an attached name when the actual sender identity supports it.
      const joined = /^(.+?)(?=(?:Tel(?:efoon)?|Phone|Mobiel|Mobile)\.?\s*:\s*(?:\+|\d))/i.exec(line);
      if (joined && valueMatchesSenderEvidence(joined[1], evidence)) {
        line = `${joined[1].trim()}\n${line.slice(joined[1].length)}`;
      }
      return line.split('\n').flatMap((part) => {
        const field = matchField(part);
        const website = /(?:https?:\/\/|www\.)\S+$/i.exec(part);
        if (field?.key === 'phone' && website && buildPhoneHref(part.slice(0, website.index).replace(/^[^:]+:\s*/, ''))) {
          return [part.slice(0, website.index).trim(), website[0]];
        }
        const phone = extractUnlabelledPhone(part, evidence);
        if (phone && part !== phone) return [part.slice(0, part.lastIndexOf(phone)).trim(), phone];
        return [part];
      });
    });
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
    for (let index = 0; index < signatureLines.length; index += 1) {
      const match = pattern.exec(normalizeWhitespace(signatureLines[index]));
      if (!match) continue;
      return {
        street: cleanFieldValue(match[1]),
        postcodeCity: `${match[2]} ${match[3].toUpperCase()} ${cleanFieldValue(match[4])}`,
      };
    }
    return { street: '', postcodeCity: '' };
  }

  function extractUnlabelledPhone(value, senderEvidence) {
    const line = cleanFieldValue(value);
    const match = /(?:^|\s)((?:\+|00|\(0|0)[\d().\s/-]+)$/.exec(line);
    if (!match || !buildPhoneHref(match[1])) return '';
    const prefix = line.slice(0, match.index).trim();
    if (prefix && !valueMatchesSenderEvidence(prefix, senderEvidence)) return '';
    const compact = match[1].replace(/[().\s/-]/g, '');
    // Unlabelled Dutch or international phone lines, never arbitrary company IDs or dates.
    return /^(?:0[1-9]\d{8}|\+[1-9]\d{6,14}|00[1-9]\d{6,12})$/.test(compact)
      ? cleanFieldValue(match[1])
      : '';
  }

  function numericText(value) {
    return (String(value || '').match(/\p{Nd}/gu) || []).join('');
  }

  function signaturePromotionLabel(value) {
    const line = normalizeWhitespace(value);
    const markdown = /^\[([^\[\]]+)\]\([^\s]+\)$/.exec(line);
    return (markdown ? markdown[1] : line).replace(/\s*\[\d{1,3}\]$/, '')
      .replace(/^[*_-]+|[*_]+$/g, '').trim();
  }

  function isSignatureSocialHeading(value) {
    return /^(?:volg (?:ons|mij)|follow (?:us|me))\s*:?[.!]?$/i.test(value);
  }

  function isSignaturePromotion(value, socialSection, references) {
    const label = signaturePromotionLabel(value);
    if (/^(?:maak (?:hier )?(?:je|uw|een) reservering|reserveer (?:hier|nu)|boek (?:hier|nu)|book (?:here|now)|make (?:a|your) reservation)\s*[.!:»›→]*$/i.test(label)) return true;
    const parts = normalizeWhitespace(value).split(/\s*[|·•]\s*/);
    return parts.every((part) => {
      const { href, label: linkLabel } = resolveContactLink(part, references);
      const plainUrl = Boolean(safeContactHref(part));
      if (href && /^(?:(?:www|m|mobile)\.)?(?:instagram\.com|facebook\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com)$/i.test(new URL(href).hostname) &&
        (plainUrl || /^@[\w.-]+$/.test(linkLabel) || /^(?:instagram|facebook|linkedin|twitter|x|youtube|tiktok|pinterest)(?:\s+.+)?$/i.test(linkLabel))) return true;
      if (plainUrl && /\/(?:bedrijfsfilm|company-video|corporate-video)(?:[-/]|$)/i.test(new URL(href).pathname)) return true;
      const profile = /^(?:instagram|facebook|linkedin|twitter|x|youtube|tiktok|pinterest)\s*:?\s+(.+)$/i.exec(signaturePromotionLabel(part));
      if (!profile) return false;
      return /^@[\w.-]+$/.test(profile[1]) || Boolean(safeContactHref(profile[1])) ||
        ((socialSection || parts.length > 1) && /^[\p{L}\d][\p{L}\p{N} .'’&_-]{0,90}$/u.test(profile[1]));
    });
  }

  function preserveUnrepresentedLines(signatureLines, contact, values, references) {
    const referenceLines = signatureLines;
    signatureLines = expandReferenceClusters(signatureLines, references);
    const beforeLines = [];
    const preservedLines = [];
    const representedValues = Object.values(values).filter(Boolean).map(cleanFieldValue);
    representedValues.push(...contact.addressLines);
    const linkedReferences = new Set(referenceLines.filter((line) => !/^\[\d+\]\s*:?\s+(?!\[)\S+\s*$/.test(line))
      .flatMap((line) => line.match(/\[\d{1,3}\]/g) || []).map((marker) => marker.slice(1, -1)).filter((id) => references.get(id)));
    let sawField = false;
    let socialSection = false;
    for (let index = 0; index < signatureLines.length; index += 1) {
      let line = normalizeWhitespace(signatureLines[index]);
      if (!line || isStandaloneSignoff(line)) continue;
      const referenceId = (value) => /^\s*\[(\d{1,3})\]\s*:?\s+\S+\s*$/.exec(value)?.[1];
      if (linkedReferences.has(referenceId(line))) continue;
      if (/^(?:Links|References|Referenties):?$/i.test(line)) {
        const tail = signatureLines.slice(index + 1).filter(Boolean);
        if (tail.length && tail.every((value) => linkedReferences.has(referenceId(value)))) continue;
      }
      const field = matchField(line);
      const compactAddress = extractCompactDutchAddress([line]);
      const represented = representedValues.includes(cleanFieldValue(line)) ||
        (field && (!field.value || representedValues.includes(cleanFieldValue(field.value)))) ||
        (compactAddress.street && contact.addressLines.includes(compactAddress.street) && contact.addressLines.includes(compactAddress.postcodeCity));
      if (represented) sawField = true;
      if (!represented) {
        const unresolved = /^([^\[\]]+?)\s+\[(\d{1,3})\]$/.exec(line);
        if (unresolved && !references.get(unresolved[2])) {
          const label = unresolved[1].replace(/^[-•]\s*/, '');
          if (safeContactHref(label) || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(label)) line = label;
        }
        if (isSignatureSocialHeading(signaturePromotionLabel(line))) {
          socialSection = true;
          continue;
        }
        const parts = line.split(/\s*[|·•]\s*/);
        const retained = parts.filter((part) => !isSignaturePromotion(part, socialSection || parts.length > 1, references));
        if (!retained.length) continue;
        if (retained.length !== parts.length) line = retained.join(' | ');
        socialSection = false;
        // Preserve all remaining information, including names, roles, extra phones,
        // unknown numbers and prose. Only exact represented values are deduplicated.
        const target = sawField || numericText(line.replace(/\[\d{1,3}\]/g, '')) ? preservedLines : beforeLines;
        if (![...beforeLines, ...preservedLines].includes(line)) target.push(line);
      }
    }
    return { beforeLines, preservedLines };
  }

  function extractContact(sourceLines, messageContext, references) {
    const signatureLines = normalizeSignatureLines(sourceLines, messageContext);
    const values = { phone: '', street: '', postcode: '', city: '', country: '' };
    for (let index = 0; index < signatureLines.length; index += 1) {
      const field = matchField(signatureLines[index]);
      if (!field || values[field.key]) continue;
      const fieldValue = readFieldValue(signatureLines, index, field.value);
      if (field.key === 'phone' && field.requiresPhoneLikeValue && !buildPhoneHref(fieldValue)) continue;
      values[field.key] = fieldValue;
    }
    if (!values.phone) {
      const senderEvidence = buildSenderEvidence(messageContext);
      values.phone = signatureLines
        .map((line) => extractUnlabelledPhone(line, senderEvidence)).find(Boolean) || '';
    }
    const compactAddress = extractCompactDutchAddress(signatureLines);
    const addressLines = [];
    appendUnique(addressLines, values.street || compactAddress.street);
    appendUnique(addressLines, [values.postcode, values.city].filter(Boolean).join(' ') || compactAddress.postcodeCity);
    appendUnique(addressLines, values.country);
    const contact = {
      phone: cleanFieldValue(values.phone),
      phoneHref: buildPhoneHref(values.phone),
      addressLines,
    };
    const { beforeLines, preservedLines } = preserveUnrepresentedLines(signatureLines, contact, values, references);
    if (beforeLines.length) contact.beforeLines = beforeLines;
    if (preservedLines.length) contact.preservedLines = preservedLines;
    const used = [...beforeLines, ...preservedLines].flatMap((line) => line.match(/\[\d{1,3}\]/g) || []);
    const linkReferences = used.filter((marker) => references.get(marker.slice(1, -1))).map((marker) => [marker.slice(1, -1), references.get(marker.slice(1, -1))]);
    if (linkReferences.length) contact.linkReferences = Object.fromEntries(linkReferences);
    return contact;
  }

  function trimOuterBlankLines(lines) {
    const result = Array.isArray(lines) ? lines.slice() : [];
    while (result.length && !normalizeWhitespace(result[0])) result.shift();
    while (result.length && !normalizeWhitespace(result[result.length - 1])) result.pop();
    return result;
  }

  function isClientPromotionLink(value) {
    const line = normalizeWhitespace(value);
    const urls = line.match(/https?:\/\/[^\s\[\]()<>]+/gi) || [];
    return urls.length > 0 && urls.every((url) => /^https:\/\/aka\.ms\/[a-z0-9]+\/?$/i.test(url)) &&
      !line.replace(/https?:\/\/[^\s\[\]()<>]+/gi, '').replace(/[\[\]()<>\s]/g, '');
  }

  function isAutomaticClientFooter(value) {
    const line = normalizeWhitespace(value);
    const outlook = /^(?:(?:verzonden (?:vanaf|vanuit)|sent from) outlook (?:voor|for)|get outlook for|download outlook voor) (?:android|ios|windows|mac)(.*)$/i.exec(line);
    if (outlook) return !outlook[1].trim() || isClientPromotionLink(outlook[1]);
    return /^(?:verzonden vanaf mijn|sent from my) (?:iphone|ipad|android|(?:samsung )?galaxy)\.?$/i.test(line);
  }

  function stripClientFooter(value, options = {}) {
    const body = normalizeBody(value);
    const lines = body.split('\n');
    // Keep quote boundaries and their source text intact. This also runs after
    // quote splitting, so an orphan Outlook separator cannot remain on screen.
    const end = options.signature === true ? lines.length : findDirectBodyEnd(body, lines);
    const references = signatureReferenceLinks(body);
    const isFooter = (line) => isAutomaticClientFooter(String(line).replace(/\[(\d{1,3})\]/g, (marker, id) => (
      references.get(id) && isClientPromotionLink(references.get(id)) ? `[${references.get(id)}]` : marker
    )));
    if (options.signature === true) {
      const removed = new Set();
      lines.forEach((line, index) => {
        if (!isFooter(line)) return;
        removed.add(index);
        removeOwnedReferenceDefinitions(lines, index, index + 1, references, []).forEach((owned) => removed.add(owned));
      });
      if (removed.size) return trimOuterBlankLines(lines.filter((_line, index) => !removed.has(index))).join('\n');
    }
    let index = end - 1;
    const skipSpacing = () => {
      while (index >= 0 && (!normalizeWhitespace(lines[index]) || /^\s*[-_=]{3,}\s*$/.test(lines[index]))) index -= 1;
    };
    skipSpacing();
    // A numeric link appendix may belong to the default footer itself.
    if (/^\s*\[\d{1,3}\]\s+https:\/\/aka\.ms\//i.test(lines[index] || '')) {
      while (index >= 0 && (!lines[index].trim() || /^[-_=]{3,}$/.test(lines[index].trim()) || /^(?:Links|References|Referenties):$/i.test(lines[index].trim()) || /^\s*\[\d{1,3}\]\s+https:\/\/aka\.ms\/[a-z0-9]+\/?\s*$/i.test(lines[index]))) index -= 1;
    }
    if (index >= 0 && isClientPromotionLink(lines[index])) {
      index -= 1;
      skipSpacing();
    }
    // A full, standalone default footer must terminate the authored text.
    // Ordinary mentions, custom links and any later meaningful text fail open.
    if (index < 0 || !isFooter(lines[index])) {
      const collapsed = /^(.*\S)[ \t]+((?:Verzonden vanaf mijn|Sent from my) (?:iPhone|iPad|Android|(?:Samsung )?Galaxy)\.?)$/i.exec(lines[index] || '');
      if (collapsed && !/[:"“”]$/.test(collapsed[1]) && !/^(?:>)/.test(collapsed[1])) {
        return trimOuterBlankLines([...lines.slice(0, index), collapsed[1], ...lines.slice(end)]).join('\n');
      }
      return String(value == null ? '' : value);
    }
    const footerMarkers = lines[index].match(/\[\d{1,3}\]/g) || [];
    const appendixMarkers = lines.slice(index + 1, end).flatMap((line) => /^\s*(\[\d{1,3}\])\s+\S+/.exec(line)?.[1] || []);
    if (appendixMarkers.some((marker) => !footerMarkers.includes(marker) || lines.slice(0, index).join('\n').includes(marker))) {
      return trimOuterBlankLines(lines.filter((_line, cursor) => cursor !== index)).join('\n');
    }
    return trimOuterBlankLines([...lines.slice(0, index), ...lines.slice(end)]).join('\n');
  }

  function parseIncoming(body, messageContext) {
    const senderEvidence = buildSenderEvidence(messageContext);
    const normalizedBody = normalizeBody(body).split('\n').flatMap((line) => {
      const split = /^(.+?[,!])\s+(.+)$/.exec(line);
      return split && isStandaloneSignoff(split[1]) && valueMatchesSenderEvidence(split[2], senderEvidence)
        ? [split[1], split[2]] : [line];
    }).join('\n');
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
      if (isStandaloneSignoff(lines[index]) || (/^grt\.?$/i.test(lines[index].trim()) && linesMatchSenderEvidence(lines.slice(index + 1, directBodyEnd), senderEvidence))) {
        signatureStart = index;
        break;
      }
    }
    if (signatureStart < 0) {
      signatureStart = lines.findIndex((line, index) => index < directBodyEnd && index > 0 &&
        !lines[index - 1].trim() && valueMatchesSenderEvidence(line, senderEvidence) &&
        lines.slice(index + 1, Math.min(directBodyEnd, index + 6)).some((value) => matchField(value) || safeContactHref(value)));
    }
    if (signatureStart < 0) {
      return { bodyLines: lines, contact: emptyContact(), matched: false };
    }
    const signatureLines = lines.slice(signatureStart, signatureEnd);
    const references = signatureReferenceLinks(normalizedBody);
    const removedDefinitions = removeOwnedReferenceDefinitions(lines, signatureStart, signatureEnd, references, quotedSegments);
    return {
      bodyLines: trimOuterBlankLines(lines.filter((_line, index) => (
        (index < signatureStart || index >= signatureEnd) && !removedDefinitions.has(index)
      ))),
      contact: extractContact(signatureLines, messageContext, references),
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
    const preservedLines = (Array.isArray(source.preservedLines) ? source.preservedLines : [])
      .map(normalizeWhitespace).filter(Boolean);
    const beforeLines = (Array.isArray(source.beforeLines) ? source.beforeLines : [])
      .map(normalizeWhitespace).filter(Boolean);
    if (!phone && !addressLines.length && !preservedLines.length && !beforeLines.length) return '';
    const escapeValue = (value) => escapeMarkup(value).replace(/=/g, '&#61;');
    function renderLine(line) {
      const link = resolveContactLink(line, new Map(Object.entries(source.linkReferences || {})));
      const raw = line.replace(/^(?:[-•]|(?:website|web|w|i|e(?:-?mail)?|from)[.:]?)\s+/i, '');
      const email = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(raw) ? raw : '';
      const href = link.href || (email ? `mailto:${email}` : '');
      const label = link.label;
      const content = href
        ? `<a class="detail-mail-contact-link" href="${escapeValue(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeValue(label)}</a>`
        : escapeValue(line);
      return `<div class="detail-mail-contact-value">${content}</div>`;
    }
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
    const preservedHtml = preservedLines.map(renderLine).join('');
    const fieldsHtml = items.length ? `<dl class="detail-mail-contact-grid">${items.join('')}</dl>` : '';
    return `<address class="detail-mail-contact-card" aria-label="Contactgegevens uit handtekening">${beforeLines.map(renderLine).join('')}${fieldsHtml}${preservedHtml}</address>`;
  }

  const api = { parseIncoming, renderContactCard, stripClientFooter };
  if (global) global.SoftoraMailboxSignature = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
