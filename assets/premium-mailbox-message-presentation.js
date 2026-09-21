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
  const disclaimerStart = /^(?:de informatie (?:verzonden|in (?:dit|deze))|de inhoud van (?:dit|deze) (?:e-?mail|bericht)|(?:dit|deze) e-?mail(?:bericht)? (?:en|is|kan)|this (?:e-?mail|message|communication)(?: and|,| is| may)|confidentiality (?:notice|disclaimer)|disclaimer\s*:)/i;
  const legalEvidence = /(?:vertrouwelijk|geheimhoud|bestemd voor de geadresseerde|niet voor u bestemd|niet toegestaan|geen recht(?:en)?|geen aansprakelijkheid|confidential|privileged|intended (?:solely|only)|received.*error|unauthori[sz]ed|prohibited|not permitted|no liability|please (?:notify (?:the sender|us)|delete (?:this|it)|destroy (?:this|it)))/i;
  const legalSentenceStart = /^(?:(?:indien|als) (?:dit|deze|u|de (?:lezer|ontvanger))|kennisneming door|(?:door ons|wij) wordt|aan (?:de inhoud van )?(?:dit|deze)|if you (?:have )?received|(?:any|unauthori[sz]ed) (?:use|disclos|distribut|copy|disseminat)|please (?:notify|delete|destroy)|we (?:accept|assume) no liability)/i;
  const printNotice = /^(?:print (?:deze|dit) (?:e-?mail(?:bericht)?|bericht) (?:alleen|uitsluitend) (?:indien|als|wanneer) (?:het|dit|dat) (?:echt )?noodzakelijk is|(?:please )?consider (?:the environment|your environmental responsibility) before printing (?:this (?:e-?mail|message))|(?:please )?only print this (?:e-?mail|message) if necessary)[.!]?$/i;
  const footerActions = /^(?:beantwoorden\s*(?:[|·]\s*)?doorsturen|reply\s*(?:[|·]\s*)?forward)$/i;
  const registryLine = /^(?:k\.?v\.?k\.?\s*(?:(?:nr|nummer|number)\.?)?|btw\s*(?:(?:nr|nummer|number|id)\.?)?|vat\s*(?:number|no\.?|id)?|chamber of commerce\s*(?:number|no\.?)?)\s*:?\s*[a-z0-9][a-z0-9. /-]*$/i;
  const postcodeLine = /^\d{4}\s?[a-z]{2}\s+\p{L}/iu;
  const streetLine = /^(?:[\p{L}][\p{L} .'’/-]{1,85}\s+\d{1,5}[a-z]?(?:[-/]\d{1,5}[a-z]?)?|postbus\s+\d{1,7})$/iu;
  const contactView = global.SoftoraMailboxContactView || (
    typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-contact-view.js') : null
  );

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

  function cleanFooterRows(sourceRows) {
    const rows = sourceRows.slice();
    const kept = [];
    let inLegal = false;
    const protectedRow = (row) => phoneValue(row) || streetLine.test(row) || postcodeLine.test(row) ||
      emailPattern.test(row) || safeWeb(row) || /^\[[^\]]+\]\((?:https?:|mailto:)/i.test(row) ||
      /^(?:tel(?:efoon)?|phone|mobiel|mobile|fax|adres|address|postcode|plaats|city|land|country|[tmefwi])\s*:/i.test(row) ||
      /^(?:p\.?s\.?\s*[:.]?|nb\s*:|let op\b|note\s*:|bereikbaar\b|aanwezig\b|graag\b|bel\b|mail\b|stuur\b|please (?:call|send|contact)\b)/i.test(row);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (footerActions.test(row)) continue;
      if (/^(?:beantwoorden|reply)$/i.test(row) && /^(?:doorsturen|forward)$/i.test(rows[index + 1] || '')) {
        index += 1;
        continue;
      }
      // Recognize whole sentences across provider line wraps. A continuation
      // such as "ontleend." need not contain another legal keyword. Never
      // consume a contact field or a personal note to complete a notice.
      const preview = rows.slice(index, index + 4).join(' ').replace(/\s+/g, ' ');
      const startsLegal = disclaimerStart.test(preview);
      const continuesLegal = inLegal && legalSentenceStart.test(preview);
      const startsPrint = /^(?:print (?:dit|deze)|(?:please )?(?:consider|only print))\b/i.test(preview);
      if (!protectedRow(row) && (startsLegal || continuesLegal || startsPrint)) {
        let end = index;
        let candidate = row;
        let sentenceEnd = /[.!?](?=\s|$)/.exec(candidate);
        while (!sentenceEnd && end + 1 < rows.length && end - index < 24 && candidate.length < 4000) {
          const next = rows[end + 1];
          if (protectedRow(next) || footerActions.test(next) || /^[-_=*\s]{3,}$/.test(next)) break;
          // Unpunctuated boilerplate may precede another name or a new note.
          if (/^\p{Lu}/u.test(next) && !disclaimerStart.test(next) && !legalSentenceStart.test(next)) break;
          candidate += `\n${next}`;
          end += 1;
          sentenceEnd = /[.!?](?=\s|$)/.exec(candidate);
        }
        const stop = sentenceEnd ? sentenceEnd.index + 1 : candidate.length;
        const sentence = candidate.slice(0, stop).replace(/\s+/g, ' ').trim();
        if (printNotice.test(sentence) || (startsLegal || continuesLegal) && legalEvidence.test(sentence)) {
          inLegal = !printNotice.test(sentence);
          const rest = candidate.slice(stop).trim();
          index = end;
          if (rest) {
            rows[index] = rest;
            index -= 1;
          }
          continue;
        }
      }
      inLegal = false;
      kept.push(row);
    }
    return kept;
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
    for (let index = 0; index < rows.length; index += 1) {
      let row = rows[index];
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
    const cleanRows = cleanFooterRows(kept);
    for (let index = 0; index < cleanRows.length; index += 1) {
      const row = cleanRows[index];
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
        streetLine.test(address) && cleanRows.slice(index + 1, index + 3).some((next) => postcodeLine.test(next));
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
      // Parse the RFC-style display-name prefix, never strip arbitrary HTML.
      const label = text.split('<', 1)[0].replace(/\S+@\S+/g, '');
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
      return { body: [...lines.slice(0, index), ...lines.slice(end)].join('\n').trim(), contact,
        signatureLines: lines.slice(index, end), signatureMatched: true };
    }
    return null;
  }

  function renderStackedContact(originalContact) {
    // Keep the public contact object source-compatible; normalize only the view.
    return contactView?.renderContactDetails(normalizeSignatureContact(originalContact || {})) || '';
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
      // Inspect the original sender-proven footer before the legacy parser
      // drops its legal context or leaves the full name outside the contact.
      const unmarkedCandidate = hasMessageContext
        ? extractUnmarkedContact(body, message, quotedThread)
        : null;
      const legacySignatureMatched = Boolean(
        parsedSignature &&
        parsedSignature.matched === true &&
        Array.isArray(parsedSignature.bodyLines)
      );
      // Respect a complete existing signature, including embedded authors,
      // unusual signoffs and reference ownership. Extend only when the legacy
      // parser demonstrably left the same sender-proven name in the body.
      const candidateName = unmarkedCandidate?.contact?.beforeLines?.[0] || '';
      const candidateKey = identityKey(candidateName);
      const legacyContactNames = [...(parsedSignature?.contact?.beforeLines || []),
        ...(parsedSignature?.contact?.preservedLines || [])];
      const omittedName = candidateKey && legacySignatureMatched &&
        parsedSignature.bodyLines.some((line) => identityKey(line) === candidateKey) &&
        !legacyContactNames.some((line) => identityKey(line) === candidateKey);
      const unmarkedSignature = unmarkedCandidate && (!legacySignatureMatched || omittedName)
        ? unmarkedCandidate : null;
      const signatureMatched = Boolean(unmarkedSignature || legacySignatureMatched);
      const bodyWithoutSignature = unmarkedSignature
        ? unmarkedSignature.body
        : legacySignatureMatched ? parsedSignature.bodyLines.join('\n').trim() : body;
      const provenBody = getProvenQuotedOutboundResult(bodyWithoutSignature, mail, message).body;
      const parsedDisplayBody = presentationOptions.stripDetectedQuotes === true &&
        typeof options.splitQuotedReply === 'function'
        ? options.splitQuotedReply(provenBody)
        : null;
      const displayBody = parsedDisplayBody && typeof parsedDisplayBody.authored === 'string'
        ? parsedDisplayBody.authored
        : provenBody;
      const noteLines = unmarkedSignature?.signatureLines || parsedSignature?.signatureLines || [];
      const notes = signatureMatched ? contactView?.authoredNotes(noteLines) || '' : '';
      const authoredBody = [displayBody, notes].filter(Boolean).join('\n\n');
      const cleanedBody = hasMessageContext ? cleanClientFooter(authoredBody) : authoredBody;
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
        contact: unmarkedSignature
          ? { ...(parsedSignature?.contact || {}), ...unmarkedSignature.contact }
          : parsedSignature.contact || emptyContact(),
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
        ? renderStackedContact(presentation.contact)
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
          const html = contactInserted ? '' : renderStackedContact(presentation.contact);
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
