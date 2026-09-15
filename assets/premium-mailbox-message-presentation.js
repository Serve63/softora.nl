(function (global) {
  'use strict';

  const SENT_PREFIX_BOUNDARY_MARKERS = new Set([
    'reply-header',
    'forward-separator',
    'header-cluster',
    'sender-header',
  ]);

  // Display-only normalization. Never write these derived values back to a
  // mailbox, provider payload or canonical message body.
  const cleanLine = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim();
  const identityKey = (value) => cleanLine(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const addressKey = (value) => cleanLine(value).toLowerCase().replace(/(\d{4})\s*([a-z]{2})(?=\s|$)/g, '$1$2');
  const emailPattern = /^[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const disclaimerStart = /^(?:de informatie (?:verzonden|in dit)|de inhoud van dit (?:e-?mail|bericht)|dit e-?mailbericht (?:en|is|kan)|this (?:e-?mail|message|communication)(?: and|,| is| may)|confidentiality (?:notice|disclaimer)|disclaimer\s*:)/i;
  const legalContinuation = /(?:geadresseerd|bestemd|toestemming|kennisneming|toegestaan|vertrouwelijk|geheimhoud|afzender|e-?mailbericht|bijlagen|ontvanger|verspreid|aansprak|vernietig|verzocht|informeren|confidential|privileged|recipient|intended|disclos|unauthori[sz]ed|distribution|attachment|sender|delete|destroy|received.*error|liability|disseminat|copying|notify)/i;
  const registryLine = /^(?:k\.?v\.?k\.?\s*(?:(?:nr|nummer|number)\.?)?|btw\s*(?:(?:nr|nummer|number|id)\.?)?|vat\s*(?:number|no\.?|id)?|chamber of commerce\s*(?:number|no\.?)?)\s*:?\s*[a-z0-9][a-z0-9. /-]*$/i;
  const postcodeLine = /^\d{4}\s?[a-z]{2}\s+\p{L}/iu;
  const streetLine = /^(?:[\p{L}][\p{L} .'’/-]{1,85}\s+\d{1,5}[a-z]?(?:[-/]\d{1,5}[a-z]?)?|postbus\s+\d{1,7})$/iu;

  function safeWeb(value) {
    const raw = cleanLine(value);
    if (!raw || /[<>"\s]/.test(raw)) return null;
    try {
      const url = new URL(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(raw) ? `https://${raw}` : raw);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
  }

  function webKey(value) {
    const url = safeWeb(value);
    return url ? `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname}${url.search}${url.hash}` : '';
  }

  function normalizeContactLink(value) {
    let line = cleanLine(value).replace(/^([*_]{1,2})(.+)\1$/, '$2');
    const appendedMarkdown = /^([^<>\n]+?)\s*<\s*\[([^\[\]]+)\]\((https?:\/\/[^\s<>]+)\)\s*>$/i.exec(line);
    if (appendedMarkdown && webKey(appendedMarkdown[1]) && webKey(appendedMarkdown[1]) === webKey(appendedMarkdown[3]) &&
      webKey(appendedMarkdown[2]) === webKey(appendedMarkdown[3])) line = `[${appendedMarkdown[1].trim()}](${appendedMarkdown[3]})`;
    const wrappedMarkdown = /^<\s*(\[[^\[\]\n]+\]\(https?:\/\/[^\s<>]+\))\s*>$/i.exec(line);
    if (wrappedMarkdown) line = wrappedMarkdown[1];
    const appended = /^([^<>\n]+?)\s*<\s*(https?:\/\/[^\s<>]+)\s*>$/i.exec(line);
    if (appended && safeWeb(appended[2])) {
      const label = appended[1].trim();
      // A visible URL must not be replaced with a different destination.
      if (!safeWeb(label) || webKey(label) === webKey(appended[2])) {
        line = `[${label}](${appended[2].replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
      }
    }
    const angleUrl = /^<(https?:\/\/[^\s<>]+)>$/i.exec(line);
    if (angleUrl && safeWeb(angleUrl[1])) line = angleUrl[1];
    const email = /^(?:e(?:-?mail)?\s*[:.]?\s*)?([^\s<>]+@[^\s<>]+)(?:\s*<mailto:([^<>]+)>)?$/i.exec(line);
    if (email && emailPattern.test(email[1]) && (!email[2] || email[1].toLowerCase() === email[2].toLowerCase())) line = email[1];
    return line;
  }

  function phoneValue(value) {
    let line = cleanLine(value).replace(/^[📞☎☏]\uFE0F?\s*/u, 'Tel: ')
      .replace(/^\*?(tel(?:efoon)?|phone|mobiel|mobile|whatsapp|fax|[tmf])\*?(?:[.:]\s*|\s+)/i, '$1: ');
    const labelled = /^(tel(?:efoon)?|phone|mobiel|mobile|whatsapp|fax|[tmf]):\s*(.+)$/i.exec(line);
    const number = cleanLine(labelled ? labelled[2] : line);
    if (!/^(?:\+|00)?[\d().\s/-]+$/.test(number)) return null;
    const normalized = number.replace(/^(\+\d{1,3}|00\d{1,3})\s*\(0\)\s*/, '$1 ');
    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    if (!labelled && !/^(?:0[1-9]\d{8}|\+[1-9]\d{6,14}|00[1-9]\d{6,12})$/.test(normalized.replace(/[().\s/-]/g, ''))) return null;
    let key = normalized.startsWith('+') ? `+${digits}` : normalized.startsWith('00') ? `+${digits.slice(2)}` : digits;
    if (/^0[1-9]\d{8}$/.test(key)) key = `+31${key.slice(1)}`;
    const label = labelled && /^(?:m|mobiel|mobile)$/i.test(labelled[1]) ? 'Mobiel' : labelled && /^fax|f$/i.test(labelled[1]) ? 'Fax' : labelled && /^whatsapp$/i.test(labelled[1]) ? 'WhatsApp' : 'Tel';
    return { number: normalized, key, label };
  }

  function contactRows(values) {
    return values.flatMap((value) => String(value ?? '').replace(/\r\n?/g, '\n').split('\n'))
      .flatMap((value) => {
        let line = cleanLine(value).replace(/^([*_]{1,2})(.+)\1$/, '$2').replace(/^📍\s*/u, '');
        // Formatting stars belong to field labels, not to the following value.
        line = line.replace(/(^|[|·•]\s*)\*?(tel(?:efoon)?|phone|mobiel|mobile|whatsapp|fax|[tmefw])\*?(?:[.:]\s*|\s+)(?=\S)/gi, '$1$2: ');
        const parts = line.split(/\s*[|·•]\s*/);
        const split = parts.length > 1 && parts.every((part) => phoneValue(part) ||
          /^(?:e(?:-?mail)?|w(?:eb(?:site)?)?|adres|address)\s*:/i.test(part) ||
          emailPattern.test(part) || safeWeb(part) || streetLine.test(part) || postcodeLine.test(part));
        const rows = split ? parts : [line];
        return rows.flatMap((row) => {
          const address = /^(.+?)\s*,?\s+(\d{4}\s?[a-z]{2}\s+\p{L}.*)$/iu.exec(row);
          return address && streetLine.test(address[1].replace(/,$/, ''))
            ? [address[1].replace(/,$/, ''), address[2]] : [row];
        });
      }).map(normalizeContactLink).filter(Boolean);
  }

  function normalizeSignatureContact(contact = {}) {
    const source = { ...contact };
    const rows = contactRows([...(source.beforeLines || []), source.phone ? `Tel: ${source.phone}` : '',
      ...(source.addressLines || []), ...(source.preservedLines || [])]);
    const variants = new Map();
    for (const row of rows) {
      const heading = /^([\p{L}][\p{L} .'’&-]{2,60})\s+-\s+([^@<>]+)$/u.exec(row);
      if (heading && !/\d/.test(heading[2])) {
        const key = identityKey(heading[1]);
        if (!variants.has(key)) variants.set(key, new Set());
        variants.get(key).add(heading[2]);
      }
    }
    const kept = [];
    let inLegal = false;
    for (let index = 0; index < rows.length; index += 1) {
      let row = rows[index];
      const startsLegal = disclaimerStart.test(row) && legalContinuation.test(rows.slice(index, index + 4).join(' '));
      if (startsLegal || inLegal && legalContinuation.test(row)) {
        inLegal = !/(?:vernietigen|verwijderen|destroy (?:it|this message)|delete (?:it|this message))\.?$/i.test(row);
        continue;
      }
      inLegal = false;
      if (registryLine.test(row) || /^[-_=*\s]{3,}$/.test(row) || /^\[(?:cid:|image\d*\.(?:png|jpe?g|gif))/i.test(row)) continue;
      // Short advertising taglines immediately before a legal footer, never
      // instructions, availability, numbers or ordinary message paragraphs.
      if (/^(?:moderne?\b|kwaliteit\b|quality\b|vakmanschap\b|innovatie\b|innovation\b)/i.test(row) &&
        row.length < 120 && !/[\d@]/.test(row) && /\.\s+\p{L}.*\.$/u.test(row) &&
        !/\b(?:ik|wij|je|u|graag|bel|mail|stuur|afspraak|offerte|bereikbaar|geopend|gesloten)\b/i.test(row) &&
        rows.slice(index + 1, index + 3).some((next) => disclaimerStart.test(next))) continue;
      const heading = /^([\p{L}][\p{L} .'’&-]{2,60})\s+-\s+([^@<>]+)$/u.exec(row);
      if (heading) {
        const suffixes = variants.get(identityKey(heading[1]));
        if (suffixes?.size > 1 && [...suffixes].some((suffix) => /(?:v\.o\.f|b\.v\.|\bltd\b|\binc\b)/i.test(suffix))) row = heading[1];
      }
      kept.push(row);
    }
    const result = { ...source, phone: '', phoneHref: '', addressLines: [], beforeLines: [], preservedLines: [] };
    const seen = new Set();
    const knownAddresses = new Set((source.addressLines || []).map(addressKey));
    const add = (target, row, key) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      target.push(row);
    };
    for (let index = 0; index < kept.length; index += 1) {
      const row = kept[index];
      const phone = phoneValue(row);
      if (phone) {
        const key = `phone:${phone.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!result.phone) {
          result.phone = phone.number;
          result.phoneHref = `tel:${phone.key}`;
        } else result.preservedLines.push(`${phone.label}: ${phone.number}`);
        continue;
      }
      const address = row.replace(/^(?:adres|address|straat|street|postcode|plaats|city|land|country)\s*:\s*/i, '');
      const isAddress = knownAddresses.has(addressKey(address)) || postcodeLine.test(address) ||
        streetLine.test(address) && kept.slice(index + 1, index + 3).some((next) => postcodeLine.test(next));
      if (isAddress) {
        add(result.addressLines, address, `address:${addressKey(address)}`);
        continue;
      }
      const markdown = /^\[([^\[\]]+)\]\((https?:\/\/[^\s]+)\)$/.exec(row);
      const url = markdown ? markdown[2] : row.replace(/^(?:w(?:eb(?:site)?)?)\s*:\s*/i, '');
      const key = webKey(url) ? `web:${webKey(url)}` : emailPattern.test(row) ? `email:${row.toLowerCase()}` : `text:${cleanLine(row).toLowerCase()}`;
      add(result.beforeLines, row, key);
    }
    return result;
  }

  function senderNameMatches(line, message = {}) {
    const name = cleanLine(line).replace(/^([*_]{1,2})(.+)\1$/, '$2');
    if (!/^[\p{L}][\p{L} .'’-]{2,75}$/u.test(name) || name.split(' ').length < 2) return false;
    const key = identityKey(name);
    const values = [message.from, message.fromName, message.senderName, message.email, message.fromEmail, message.senderEmail];
    return values.some((value) => {
      const text = String(value || '');
      const label = text.replace(/<[^>]+>/g, '').replace(/\S+@\S+/g, '');
      if (identityKey(label) === key) return true;
      return (text.match(/[\w.+-]+@[a-z0-9.-]+/gi) || []).some((email) => {
        const [local, domain] = email.split('@');
        return identityKey(local) === key || identityKey(local + domain.split('.')[0]).startsWith(key);
      });
    });
  }

  function extractUnmarkedContact(body, message, quotedThread) {
    if (String(body || '').length > 500000) return null;
    const lines = String(body || '').split('\n');
    const segments = quotedThread?.findQuotedSegments?.(body)?.segments || [];
    const end = segments.length ? Math.min(...segments.map((segment) => segment.start)) : lines.length;
    for (let index = Math.max(1, end - 240); index < end; index += 1) {
      if (lines[index - 1].trim() || !senderNameMatches(lines[index], message)) continue;
      const tail = contactRows(lines.slice(index + 1, end));
      // Sender evidence plus actual contact information, not merely a name
      // mentioned in prose. Do not borrow a name from a quoted sender.
      if (!tail.some((line) => phoneValue(line) || postcodeLine.test(line) || safeWeb(line) ||
        /^\[[^\]]+\]\(https?:/.test(line))) continue;
      const contact = normalizeSignatureContact({ beforeLines: lines.slice(index, end), addressLines: [] });
      return { body: [...lines.slice(0, index), ...lines.slice(end)].join('\n').trim(), contact, signatureMatched: true };
    }
    return null;
  }

  function renderStackedContact(signature, contact) {
    const html = signature?.renderContactCard?.(contact) || '';
    const address = contact?.addressLines || [];
    if (!html || address.length < 2) return html;
    const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/=/g, '&#61;');
    const combined = address.map(escape).join(', ');
    return html.replace(`<dd class="detail-mail-contact-value">${combined}</dd>`,
      `<dd class="detail-mail-contact-value" aria-label="${combined}">${address.map(escape).join('<br>')}</dd>`);
  }

  function create(options = {}) {
    const quotedThread = options.quotedThread || global.SoftoraMailboxQuotedThread || (
      typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-quoted-thread.js') : null
    );
    const signature = options.signature || global.SoftoraMailboxSignature || (
      typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-signature.js') : null
    );
    function cleanPresentation(presentation) {
      const display = options.display || global.SoftoraMailboxDisplay || (
        typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-display.js') : null
      );
      return { ...presentation, body: display?.normalizePresentationText?.(presentation.body) ?? presentation.body };
    }

    function emptyContact() {
      return { phone: '', phoneHref: '', addressLines: [] };
    }

    function emptyPresentation() {
      return { body: '', contact: emptyContact(), signatureMatched: false };
    }

    function cleanClientFooter(value) {
      return typeof signature?.stripClientFooter === 'function' ? signature.stripClientFooter(value) : value;
    }

    function getSentAuthoredBody(value) {
      const parsed = options.splitQuotedReply(value);
      const firstSegment = Array.isArray(parsed && parsed.segments) ? parsed.segments[0] : null;
      if (!firstSegment || !SENT_PREFIX_BOUNDARY_MARKERS.has(firstSegment.marker)) {
        return String(parsed && parsed.authored || '').trim();
      }
      return String(parsed && parsed.authoredPrefix || '').trim();
    }

    function getProvenQuotedOutboundResult(value, mail, messageContext = mail) {
      const incomingTimestamp = options.getMessageTimestamp(messageContext);
      const result = quotedThread?.stripProvenQuotedOutbound?.(
        value,
        options.getProvenOutboundThreadMessages(mail, value),
        {
          directParentMessageIds: options.getDirectParentMessageIds(messageContext),
          directParentScopeProven: true,
          incomingAt: incomingTimestamp ? new Date(incomingTimestamp).toISOString() : '',
          stripReferenceAppendixWhenSingleMatch: true,
        }
      );
      return result && typeof result.body === 'string'
        ? result
        : { body: String(value || '').trim(), removed: [], matchedMessages: [] };
    }

    function stripProvenQuotedOutbound(value, mail, messageContext = mail) {
      return getProvenQuotedOutboundResult(value, mail, messageContext).body;
    }

    function getSourceSafeMessagePresentation(message, mail, bodyOverride, presentationOptions = {}) {
      const body = typeof bodyOverride === 'string'
        ? bodyOverride
        : String(message && message.body || '');
      if (!body) return emptyPresentation();
      if (
        options.isSentMessageByProvenance(message, mail && mail.accountEmail) ||
        message && message.copyContext && message.copyContext.evidenceKnown === true
      ) {
        return { body: cleanClientFooter(getSentAuthoredBody(body)), contact: emptyContact(), signatureMatched: false };
      }
      const hasMessageContext = Boolean(message && typeof message === 'object' && !Array.isArray(message));
      const parsedSignature = hasMessageContext
        ? signature?.parseIncoming?.(body, message)
        : null;
      const signatureMatched = Boolean(
        parsedSignature &&
        parsedSignature.matched === true &&
        Array.isArray(parsedSignature.bodyLines)
      );
      const bodyWithoutSignature = signatureMatched
        ? parsedSignature.bodyLines.join('\n').trim()
        : body;
      const provenBody = getProvenQuotedOutboundResult(bodyWithoutSignature, mail, message).body;
      const parsedDisplayBody = presentationOptions.stripDetectedQuotes === true &&
        typeof options.splitQuotedReply === 'function'
        ? options.splitQuotedReply(provenBody)
        : null;
      const displayBody = parsedDisplayBody && typeof parsedDisplayBody.authored === 'string'
        ? parsedDisplayBody.authored
        : provenBody;
      const cleanedBody = hasMessageContext ? cleanClientFooter(displayBody) : displayBody;
      const sourceSafeBody = hasMessageContext && presentationOptions.stripDetectedQuotes === true &&
        typeof signature?.formatBodyReferences === 'function'
        ? signature.formatBodyReferences(cleanedBody, body) : cleanedBody;
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return { body: sourceSafeBody, contact: emptyContact(), signatureMatched: false };
      }
      if (!signatureMatched) {
        return extractUnmarkedContact(sourceSafeBody, message, quotedThread) ||
          { body: sourceSafeBody, contact: emptyContact(), signatureMatched: false };
      }
      return {
        body: sourceSafeBody,
        contact: normalizeSignatureContact(parsedSignature.contact || emptyContact()),
        signatureMatched: true,
      };
    }

    function getSourceSafeMessageBody(message, mail, bodyOverride) {
      return getSourceSafeMessagePresentation(message, mail, bodyOverride).body;
    }

    function getThreadPresentation(message, mail, state = {}) {
      const presentation = state.loading
        ? emptyPresentation()
        : cleanPresentation(getSourceSafeMessagePresentation(message, mail, undefined, {
            stripDetectedQuotes: !state.sent,
          }));
      const contactHtml = !state.sent && !state.loading && !state.loadError
        ? renderStackedContact(signature, presentation.contact)
        : '';
      return { ...presentation, contactHtml };
    }

    function getRootPresentation(value, mail) {
      // Root cards hide embedded history just like incoming timeline cards.
      // Split before rendering, so quote appendices cannot escape the card
      // while the canonical parent message is still being hydrated.
      const presentation = cleanPresentation(getSourceSafeMessagePresentation(mail, mail, String(value || ''), {
        stripDetectedQuotes: Boolean(mail && typeof mail === 'object' && !Array.isArray(mail)),
      }));
      let contactInserted = false;
      return {
        ...presentation,
        appendContact(target) {
          const html = contactInserted ? '' : renderStackedContact(signature, presentation.contact);
          if (!html || !Array.isArray(target)) return false;
          target.push(html);
          contactInserted = true;
          return true;
        },
      };
    }

    function isDuplicateStructuredOwnQuote(section, mail, isReplyHeaderLine) {
      if (!section || section.type !== 'quote' || !Array.isArray(section.lines)) return false;
      const firstLine = String(section.lines[0] || '').trim();
      const hasReplyHeader = typeof isReplyHeaderLine === 'function' && isReplyHeaderLine(firstLine);
      return Boolean(options.findExactQuotedOutbound(
        (hasReplyHeader ? section.lines.slice(1) : section.lines).join('\n'),
        mail
      ));
    }

    return {
      emptyPresentation,
      getRootPresentation,
      getSourceSafeMessageBody,
      getSourceSafeMessagePresentation,
      getThreadPresentation,
      isDuplicateStructuredOwnQuote,
      stripProvenQuotedOutbound,
    };
  }

  const api = { create, normalizeSignatureContact };
  global.SoftoraMailboxMessagePresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
