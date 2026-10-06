(function initSoftoraMailboxQuotedThread(global) {
  'use strict';

  const IGNORABLE_MATCH_LINE_PATTERNS = [
    /^\[image:\s*[^\]]+\]\s*$/i,
    /^[-_=]{2,}\s*$/,
    /^hieronder zie je een korte indruk van de eerste versie op verschillende schermen\.?\s*$/i,
    /^geen webdesign willen ontvangen\?\s*laat het me weten!.*$/i,
  ];

  const COLLAPSED_FORWARD_SEPARATOR_PATTERN = /(?:-{2,}|_{2,})[ \t]*(?:original message|oorspronkelijk(?:e)? bericht|forwarded message|doorgestuurd bericht)[ \t]*(?:-{2,}|_{2,})/gi;

  function hasCollapsedForwardHeaderEvidence(value) {
    const headerWindow = String(value || '').slice(0, 1600);
    if (!/^[ \t]*(?:van|from|afzender|sender):\s*\S/i.test(headerWindow)) return false;
    const supportingFields = [
      /(?:^|\s)(?:verzonden|verstuurd|sent|datum|date):\s*\S/i,
      /(?:^|\s)(?:aan|to|ontvanger|recipient):\s*\S/i,
      /(?:^|\s)(?:onderwerp|subject):\s*\S/i,
    ];
    return supportingFields.filter((pattern) => pattern.test(headerWindow)).length >= 2;
  }

  function normalizeLines(value) {
    const normalized = String(value || '').replace(/\r\n?/g, '\n');
    return normalized.replace(
      COLLAPSED_FORWARD_SEPARATOR_PATTERN,
      (separator, offset, source) => {
        const suffix = source.slice(offset + separator.length);
        if (!hasCollapsedForwardHeaderEvidence(suffix)) return separator;
        const before = source[offset - 1] || '';
        const after = source[offset + separator.length] || '';
        return `${before && before !== '\n' ? '\n' : ''}${separator.trim()}${after && after !== '\n' ? '\n' : ''}`;
      }
    ).split('\n');
  }

  function cleanHeaderLine(value) {
    return String(value || '')
      .replace(/^\s*(?:>\s*)+/, '')
      .trim()
      .replace(/^\*{1,2}([^*\n]{1,40}:)\*{1,2}\s*/, '$1 ')
      .trim();
  }

  const REPLY_MONTH_PATTERN = /\b(?:jan(?:uari|uary)?|feb(?:ruari|ruary)?|mrt|maa?rt|mar(?:ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|aug(?:ustus)?|sep(?:tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b/i;
  const REPLY_WEEKDAY_PATTERN = /\b(?:ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?\b/i;
  const REPLY_NUMERIC_DATE_PATTERN = /(?:\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\b|\b\d{1,2}:\d{2}\b)/;
  const WRAPPED_GMAIL_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;
  const WRAPPED_GMAIL_TIME_PATTERN = /\b\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?\b/i;
  const WRAPPED_GMAIL_NUMERIC_DATE_PATTERN = /(?:\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b)/;

  function hasReplyDateEvidence(value, language) {
    const core = String(value || '').trim();
    if (REPLY_NUMERIC_DATE_PATTERN.test(core) || REPLY_MONTH_PATTERN.test(core)) return true;
    if (!REPLY_WEEKDAY_PATTERN.test(core)) return false;
    return language === 'op' || core.includes(',');
  }

  function isPlausibleReplyAuthor(value) {
    const author = String(value || '').trim();
    if (!author || author.length > 160 || author.split(/\s+/).length > 16) return false;
    if (/^(?:ik|wij|we|jij|je|u|hij|zij|ze|i|you|he|she|they)$/i.test(author)) return false;
    if (/^(?:volgens|omdat|toen|hier|daar|deze|dit|dat|ons|onze|mijn|jouw|uw|according|because|when|here|there|this|that|our|my|your)\b/i.test(author)) return false;
    return /(?:[a-z\u00c0-\u024f]{2}|@)/i.test(author);
  }

  function isPlausibleReverseReplyHeaderCore(value) {
    const core = cleanHeaderLine(value);
    const match = /^(.+?)\s+(schreef\s+op|wrote\s+on)\s+(.+)$/i.exec(core);
    if (!match || !isPlausibleReplyAuthor(match[1])) return false;
    const datePart = String(match[3] || '').trim();
    return REPLY_NUMERIC_DATE_PATTERN.test(datePart) || REPLY_MONTH_PATTERN.test(datePart);
  }

  function isPlausibleReplyHeaderCore(value) {
    const core = cleanHeaderLine(value);
    if (isPlausibleReverseReplyHeaderCore(core)) return true;
    const language = /^op\s+/i.test(core) ? 'op' : /^on\s+/i.test(core) ? 'on' : '';
    if (!language || !hasReplyDateEvidence(core, language)) return false;

    if (language === 'on') {
      const match = /^on\s+(.+?)\bwrote(?:\s+[^:\n]+)?$/i.exec(core);
      if (!match) return false;
      return !/\b(?:i|we|you|he|she|they)\s*$/i.test(String(match[1] || '').trim());
    }

    const wroteMatch = /^op\s+.+?\bschreef(?:\s+([^:\n]+))?$/i.exec(core);
    if (wroteMatch) {
      const authorAfterVerb = String(wroteMatch[1] || '').trim();
      return !/^(?:ik|wij|we|jij|je|u|hij|zij|ze)$/i.test(authorAfterVerb);
    }
    const hasWrittenMatch = /^op\s+.+?\bheeft\s+(.+?)\s+(?:het\s+volgende\s+)?geschreven$/i.exec(core);
    if (!hasWrittenMatch) return false;
    return !/^(?:ik|wij|we|jij|je|u|hij|zij|ze)$/i.test(String(hasWrittenMatch[1] || '').trim());
  }

  function parseReplyHeaderLine(value) {
    const line = cleanHeaderLine(value);
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== ':') continue;
      if (/\d/.test(line[index - 1] || '') && /\d/.test(line[index + 1] || '')) continue;
      const core = line.slice(0, index).trim();
      if (!isPlausibleReverseReplyHeaderCore(core)) continue;
      return {
        header: `${core}:`,
        remainder: line.slice(index + 1).trim(),
      };
    }
    const colonPatterns = [
      /^(op\s+.+?\bheeft\s+.+?\s+(?:het\s+volgende\s+)?geschreven)\s*:\s*(.*)$/i,
      /^(op\s+.+?\bschreef(?:\s+[^:\n]+?)?)\s*:\s*(.*)$/i,
      /^(on\s+.+?\bwrote)\s*:\s*(.*)$/i,
    ];
    for (const pattern of colonPatterns) {
      const match = pattern.exec(line);
      if (match && isPlausibleReplyHeaderCore(match[1])) {
        return {
          header: `${String(match[1] || '').trim()}:`,
          remainder: String(match[2] || '').trim(),
        };
      }
    }
    const colonlessPatterns = [
      /^op\s+.+?\bheeft\s+.+?\s+(?:het\s+volgende\s+)?geschreven$/i,
      /^op\s+.+?\bschreef(?:\s+[^:\n]+)?$/i,
      /^on\s+.+?\bwrote(?:\s+[^:\n]+)?$/i,
      /^.+?\s+schreef\s+op\s+.+$/i,
      /^.+?\s+wrote\s+on\s+.+$/i,
    ];
    if (
      !colonlessPatterns.some((pattern) => pattern.test(line)) ||
      !isPlausibleReplyHeaderCore(line)
    ) return null;
    return { header: line, remainder: '' };
  }

  function isReplyHeaderLine(value) {
    return Boolean(parseReplyHeaderLine(value));
  }

  function isForwardSeparatorLine(value) {
    const line = cleanHeaderLine(value);
    return (
      /^(?:-{2,}|_{2,})\s*(?:original message|oorspronkelijk(?:e)? bericht|forwarded message|doorgestuurd bericht)\s*(?:-{2,}|_{2,})?$/i.test(line) ||
      /^(?:begin|start)\s+(?:doorgestuurd|forwarded)\s+bericht\s*:?$/i.test(line)
    );
  }

  const HEADER_PATTERNS = Object.freeze({
    from: /^(?:van|from|afzender|sender):\s*(?:\S|$)/i,
    sent: /^(?:verzonden|verstuurd|sent|datum|date):\s*(?:\S|$)/i,
    to: /^(?:aan|to|ontvanger|recipient):\s*(?:\S|$)/i,
    subject: /^(?:onderwerp|subject):\s*(?:\S|$)/i,
    replyTo: /^(?:antwoord[ -]?aan|reply-to):\s*(?:\S|$)/i,
  });

  const HEADER_LABEL_PATTERN = /^(van|from|afzender|sender|verzonden|verstuurd|sent|datum|date|aan|to|ontvanger|recipient|onderwerp|subject|antwoord[ -]?aan|reply-to):\s*(.*)$/i;

  function normalizeHeaderField(value) {
    const label = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (['van', 'from', 'afzender', 'sender'].includes(label)) return 'from';
    if (['verzonden', 'verstuurd', 'sent', 'datum', 'date'].includes(label)) return 'sent';
    if (['aan', 'to', 'ontvanger', 'recipient'].includes(label)) return 'to';
    if (['onderwerp', 'subject'].includes(label)) return 'subject';
    if (['antwoord aan', 'antwoord-aan', 'reply-to'].includes(label)) return 'replyTo';
    return '';
  }

  function extractHeaderFields(value) {
    const lines = Array.isArray(value) ? value.map(String) : normalizeLines(value);
    const fields = { from: [], sent: [], to: [], subject: [], replyTo: [] };
    for (let index = 0; index < lines.length; index += 1) {
      const line = cleanHeaderLine(lines[index]);
      const match = HEADER_LABEL_PATTERN.exec(line);
      if (!match) continue;
      const field = normalizeHeaderField(match[1]);
      if (!field) continue;
      let fieldValue = String(match[2] || '').trim();
      if (!fieldValue) {
        let nextIndex = index + 1;
        while (nextIndex < lines.length && !cleanHeaderLine(lines[nextIndex])) nextIndex += 1;
        const nextLine = cleanHeaderLine(lines[nextIndex]);
        if (nextLine && !HEADER_LABEL_PATTERN.test(nextLine)) {
          fieldValue = nextLine;
          index = nextIndex;
        }
      }
      if (fieldValue && !fields[field].includes(fieldValue)) fields[field].push(fieldValue);
    }
    return fields;
  }

  function isHeaderClusterAt(lines, startIndex) {
    const firstLine = cleanHeaderLine(lines[startIndex]);
    if (!firstLine || !HEADER_PATTERNS.from.test(firstLine)) return false;
    const windowLines = lines
      .slice(startIndex, startIndex + 10)
      .map(cleanHeaderLine)
      .filter(Boolean);
    const matchedFields = ['sent', 'to', 'subject']
      .filter((field) => windowLines.some((line) => HEADER_PATTERNS[field].test(line)));
    return matchedFields.length >= 2;
  }

  function isStandaloneSenderQuoteLine(value) {
    const line = cleanHeaderLine(value);
    const match = /^(?:van|from):\s*(.+)$/i.exec(line);
    return Boolean(match && /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(match[1]));
  }

  function isQuotePrefixedLine(value) {
    return /^\s*>/.test(String(value || ''));
  }

  function stripOneQuotePrefix(value) {
    return String(value || '').replace(/^\s*>\s?/, '');
  }

  function buildSegment(lines, start, end, marker, replyHeader) {
    const rawLines = lines.slice(start, end);
    const displayLines = replyHeader
      ? [
          replyHeader.header,
          ...(replyHeader.remainder ? [replyHeader.remainder] : []),
          ...rawLines.slice(1).map(stripOneQuotePrefix),
        ]
      : rawLines.map(stripOneQuotePrefix);
    const quotePayloadLines = replyHeader ? displayLines.slice(1) : displayLines.slice();
    return {
      start,
      end,
      marker,
      header: replyHeader ? replyHeader.header : '',
      headerRemainder: replyHeader ? replyHeader.remainder : '',
      headerFields: extractHeaderFields(displayLines),
      rawText: rawLines.join('\n').trim(),
      text: displayLines.join('\n').trim(),
      quotePayload: quotePayloadLines.join('\n').trim(),
      displayLines,
    };
  }

  function findQuotedSegments(value) {
    const lines = normalizeLines(value);
    const segments = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const replyHeader = parseReplyHeaderLine(line);
      const gmailHeader = Boolean(replyHeader);
      const forwardSeparator = isForwardSeparatorLine(line);
      const headerCluster = isHeaderClusterAt(lines, index);
      const standaloneSender = isStandaloneSenderQuoteLine(line);
      const quotedLine = isQuotePrefixedLine(line);
      if (!gmailHeader && !forwardSeparator && !headerCluster && !standaloneSender && !quotedLine) continue;

      let end = lines.length;
      if (gmailHeader || quotedLine) {
        let cursor = gmailHeader ? index + 1 : index;
        while (cursor < lines.length && !String(lines[cursor] || '').trim()) cursor += 1;
        if (cursor < lines.length && isQuotePrefixedLine(lines[cursor])) {
          let sawQuotedLine = false;
          for (; cursor < lines.length; cursor += 1) {
            const current = String(lines[cursor] || '');
            if (isQuotePrefixedLine(current)) {
              sawQuotedLine = true;
              continue;
            }
            if (!current.trim()) continue;
            if (sawQuotedLine) {
              end = cursor;
              break;
            }
          }
        }
      }

      const marker = gmailHeader
        ? 'reply-header'
        : forwardSeparator
          ? 'forward-separator'
          : headerCluster
            ? 'header-cluster'
            : standaloneSender
              ? 'sender-header'
              : 'quote-prefix';
      let start = index;
      // Outlook's rule introduces its header cluster, even without the words
      // "Original message". Include it only when that following cluster proves
      // the boundary; ordinary authored separators remain untouched.
      if (headerCluster && !replyHeader) {
        let previous = index - 1;
        while (previous >= 0 && !lines[previous].trim()) previous -= 1;
        if (/^\s*[-_=]{3,}\s*$/.test(lines[previous] || '')) start = previous;
      }
      segments.push(buildSegment(lines, start, end, marker, replyHeader));
      index = Math.max(index, end - 1);
    }
    return { lines, segments };
  }

  function removeSegments(value, segments) {
    const parsed = findQuotedSegments(value);
    const removed = Array.isArray(segments) ? segments : parsed.segments;
    if (!removed.length) return String(value || '').trim();
    return parsed.lines
      .filter((_line, index) => !removed.some((segment) => index >= segment.start && index < segment.end))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function splitQuotedThread(value) {
    const parsed = findQuotedSegments(value);
    const first = parsed.segments[0] || null;
    const lastSegmentEnd = parsed.segments.length
      ? Math.max(...parsed.segments.map((segment) => segment.end))
      : 0;
    const referenceAppendix = parsed.segments.length
      ? findTrailingReferenceAppendix(parsed.lines, lastSegmentEnd, parsed.segments)
      : null;
    const removed = referenceAppendix
      ? [...parsed.segments, { ...referenceAppendix, marker: 'reference-appendix' }]
      : parsed.segments;
    return {
      ...parsed,
      authored: removeSegments(value, removed),
      authoredPrefix: first ? parsed.lines.slice(0, first.start).join('\n').trim() : String(value || '').trim(),
      quoted: first ? parsed.lines.slice(first.start, first.end).join('\n').trim() : '',
      quotePayload: first ? first.quotePayload : '',
      removedReferenceAppendix: Boolean(referenceAppendix),
    };
  }

  function stripQuotedEnvelope(value) {
    const parsed = findQuotedSegments(value);
    const first = parsed.segments[0];
    if (!first) return String(value || '').trim();
    if (first.marker === 'reply-header') return first.quotePayload;
    const lines = first.displayLines.slice();
    while (lines.length && !String(lines[0] || '').trim()) lines.shift();
    if (lines.length && isForwardSeparatorLine(lines[0])) lines.shift();
    while (lines.length) {
      while (lines.length && !String(lines[0] || '').trim()) lines.shift();
      const match = HEADER_LABEL_PATTERN.exec(cleanHeaderLine(lines[0]));
      if (!match) break;
      const hasInlineValue = Boolean(String(match[2] || '').trim());
      lines.shift();
      if (!hasInlineValue) {
        while (lines.length && !String(lines[0] || '').trim()) lines.shift();
        if (lines.length && !HEADER_LABEL_PATTERN.test(cleanHeaderLine(lines[0]))) lines.shift();
      }
    }
    while (lines.length && !String(lines[0] || '').trim()) lines.shift();
    return lines.join('\n').trim();
  }

  function getProvenWrappedGmailHeaderStart(lines, segment) {
    // Keep this out of the general reply-header parser: neighbouring authored
    // lines may resemble a wrapped header. The caller uses this wider range
    // only after the quoted payload has one existing, proven outbound match.
    if (!segment || segment.marker !== 'quote-prefix' || !Number.isInteger(segment.start)) {
      return segment && Number.isInteger(segment.start) ? segment.start : 0;
    }
    const source = Array.isArray(lines) ? lines : [];
    const originalStart = segment.start;
    if (!isQuotePrefixedLine(source[originalStart])) return originalStart;

    let wroteIndex = originalStart - 1;
    let skippedBlankLines = 0;
    while (wroteIndex >= 0 && !cleanHeaderLine(source[wroteIndex])) {
      skippedBlankLines += 1;
      if (skippedBlankLines > 1) return originalStart;
      wroteIndex -= 1;
    }
    const introIndex = wroteIndex - 1;
    if (introIndex < 0) return originalStart;
    if (isQuotePrefixedLine(source[introIndex]) || isQuotePrefixedLine(source[wroteIndex])) {
      return originalStart;
    }

    const intro = cleanHeaderLine(source[introIndex]);
    const wrote = cleanHeaderLine(source[wroteIndex]);
    if (!/^on\s+/i.test(intro) || !/^wrote\s*:\s*$/i.test(wrote)) return originalStart;
    if (!WRAPPED_GMAIL_YEAR_PATTERN.test(intro) || !WRAPPED_GMAIL_TIME_PATTERN.test(intro)) {
      return originalStart;
    }
    if (!REPLY_MONTH_PATTERN.test(intro) && !WRAPPED_GMAIL_NUMERIC_DATE_PATTERN.test(intro)) {
      return originalStart;
    }

    const parsedHeader = parseReplyHeaderLine(`${intro} ${wrote}`);
    if (!parsedHeader || parsedHeader.remainder) return originalStart;
    return introIndex;
  }

  function normalizeMatchText(value) {
    return normalizeLines(value)
      .map((line) => String(line || '')
        .replace(/^\s*(?:>\s*)+/, '')
        .replace(/\s+>\s+/g, ' ')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F]/gu, ' ')
        .trim())
      .filter((line) => (
        line && !IGNORABLE_MATCH_LINE_PATTERNS.some((pattern) => pattern.test(line))
      ))
      .join(' ')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // Clients swap typographic and straight quotes ("zo’n" is quoted as "zo'n").
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      // Mail clients rewrite links: "[label](url)" in a quote is the same text
      // as "label [url]" or "label url" in the sent copy.
      .replace(/\[([^\]\n]*)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/gi, ' $1 ')
      .replace(/\[\s*\d+\s*\]/g, ' ')
      .replace(/\[(https?:\/\/[^\]\s]+)\]/gi, ' ')
      .replace(/<?https?:\/\/[^\s>]+>?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function messageIdentity(message) {
    const account = String(message && message.accountEmail || '').trim().toLowerCase();
    const messageId = String(message && message.messageId || '').trim().toLowerCase();
    const id = String(message && (message.id || message.mailboxId || '') || '').trim().toLowerCase();
    return `${account}|${messageId || id}`;
  }

  function findTrailingReferenceAppendix(lines, minimumStart, evidenceSegments = []) {
    const source = Array.isArray(lines) ? lines : [];
    const startAt = Math.max(0, Number(minimumStart) || 0);
    const evidenceText = (Array.isArray(evidenceSegments) ? evidenceSegments : [])
      .map((segment) => source.slice(segment.start, segment.end).join('\n'))
      .join('\n');
    for (let index = source.length - 1; index >= startAt; index -= 1) {
      const heading = String(source[index] || '').trim();
      if (!/^(?:links|references|referenties):$/i.test(heading)) continue;
      let targetCount = 0;
      let valid = true;
      const referenceNumbers = [];
      for (let cursor = index + 1; cursor < source.length; cursor += 1) {
        const line = String(source[cursor] || '').trim();
        if (!line) continue;
        if (/^[-_=]{2,}$/.test(line)) continue;
        const numbered = /^(?:\[(\d+)\]|(\d+)[.)])\s+(.+)$/.exec(line);
        if (!numbered) { valid = false; break; }
        const target = String(numbered[3] || '').trim();
        const markdownTarget = /^\[((?:https?:\/\/|mailto:)[^\]\s]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/i.exec(target);
        const plainTarget = /^(?:<?https?:\/\/\S+>?|mailto:\S+)$/i.test(target);
        if (!plainTarget && !(markdownTarget && markdownTarget[1] === markdownTarget[2])) {
          valid = false;
          break;
        }
        referenceNumbers.push(numbered[1] || numbered[2]);
        targetCount += 1;
      }
      const hasCorrespondingMarker = referenceNumbers.some((number) => (
        new RegExp(`\\[\\s*${number}\\s*\\]`).test(evidenceText)
      ));
      const authoredText = source.slice(0, index).filter((_line, lineIndex) => (
        !evidenceSegments.some((segment) => lineIndex >= segment.start && lineIndex < segment.end)
      )).join('\n');
      const hasAuthoredReference = referenceNumbers.some((number) => (
        new RegExp(`\\[\\s*${number}\\s*\\]`).test(authoredText)
      ));
      if (valid && targetCount && hasCorrespondingMarker && !hasAuthoredReference) {
        return { start: index, end: source.length };
      }
    }
    return null;
  }

  function normalizeMessageId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^<+|>+$/g, '');
  }

  function getAuthoredPrefix(value) {
    return splitQuotedThread(value).authoredPrefix;
  }

  function getMessageTimestamp(message) {
    const source = message && typeof message === 'object' ? message : {};
    for (const value of [source.receivedAt, source.internalDate, source.date, source.activityAt]) {
      const timestamp = Date.parse(value || '');
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return 0;
  }

  const EXCERPT_MONTHS = [
    ['jan', 'januari', 'january'], ['feb', 'februari', 'february'], ['mrt', 'maart', 'mar', 'march'],
    ['apr', 'april'], ['mei', 'may'], ['jun', 'juni', 'june'], ['jul', 'juli', 'july'],
    ['aug', 'augustus', 'august'], ['sep', 'sept', 'september'], ['okt', 'oktober', 'oct', 'october'],
    ['nov', 'november'], ['dec', 'december'],
  ];

  function matchesExcerptHeader(header, message, options) {
    if (!isReplyHeaderLine(header)) return false;
    const emails = String(header || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    const sender = String(message && (message.email || message.accountEmail) || '').trim().toLowerCase();
    if (emails.length !== 1 || !sender || emails[0] !== sender) return false;
    const date = /\b(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\b/i.exec(header);
    const reverseDate = date ? null : /\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(header);
    const monthName = (date ? date[2] : reverseDate?.[1] || '').toLowerCase();
    const month = EXCERPT_MONTHS.findIndex((names) => names.includes(monthName)) + 1;
    const day = Number(date ? date[1] : reverseDate?.[2]);
    const year = Number(date ? date[3] : reverseDate?.[3]);
    const time = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?\b/i.exec(header);
    const timestamp = getMessageTimestamp(message);
    if (!month || !day || !year || !time || !timestamp) return false;
    const hour = time[3] ? Number(time[1]) % 12 + (time[3].toLowerCase() === 'p' ? 12 : 0) : Number(time[1]);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: options.headerTimeZone || 'Europe/Amsterdam', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(timestamp));
    const sent = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return sent.year === year && sent.month === month && sent.day === day &&
      sent.hour === hour && sent.minute === Number(time[2]);
  }

  // A quote header proves our own sent copy when it names that copy's sender
  // (address, or display name when the client shows no address) and the exact
  // sending minute. Formats: 2026-10-06 16:33, 07-09-2026 17:24, 6 okt 2026,
  // "do., jul. 23, 2026 om 10:13".
  function parseQuoteHeaderMinute(text) {
    const source = String(text || '');
    let year = 0, month = 0, day = 0, index = -1;
    const monthOf = (name) => EXCERPT_MONTHS.findIndex((names) => names.includes(String(name || '').toLowerCase().replace(/\./g, ''))) + 1;
    let match = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(source);
    if (match) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); index = match.index + match[0].length; }
    if (!match && (match = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(source))) {
      day = Number(match[1]); month = Number(match[2]); year = Number(match[3]); index = match.index + match[0].length;
    }
    if (!match && (match = /\b(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})\b/i.exec(source)) && monthOf(match[2])) {
      day = Number(match[1]); month = monthOf(match[2]); year = Number(match[3]); index = match.index + match[0].length;
    } else if (month === 0 && (match = /\b([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(source)) && monthOf(match[1])) {
      month = monthOf(match[1]); day = Number(match[2]); year = Number(match[3]); index = match.index + match[0].length;
    }
    if (!year || !month || !day || index < 0) return null;
    const time = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?\b/i.exec(source.slice(index));
    if (!time) return null;
    const hour = time[3] ? Number(time[1]) % 12 + (time[3].toLowerCase() === 'p' ? 12 : 0) : Number(time[1]);
    return { year, month, day, hour, minute: Number(time[2]) };
  }

  function quoteHeaderProvesSentCopy(headerText, message, options = {}) {
    const header = parseQuoteHeaderMinute(headerText);
    const timestamp = getMessageTimestamp(message);
    if (!header || !timestamp) return false;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: options.headerTimeZone || 'Europe/Amsterdam', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(timestamp));
    const sent = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    if (sent.year !== header.year || sent.month !== header.month || sent.day !== header.day ||
      sent.hour !== header.hour || sent.minute !== header.minute) return false;
    const senderEmails = [message && message.email, message && message.accountEmail,
      ...(String(message && message.from || '').toLowerCase().match(HEADER_EMAIL_PATTERN) || [])];
    // Display name only: the part before the address ("Martijn van de Ven <m@x.nl>").
    const senderName = String(message && message.from || '').split('<')[0].replace(/"/g, '');
    return headerNamesSender(headerText, senderEmails, [senderName]);
  }

  // The sender, not just any address: forward headers also list the recipient
  // ("Van: Servé Creusen Datum: … Aan: info@klant.nl"). An own address anywhere
  // counts; otherwise our name counts unless it is bound to another address.
  const HEADER_EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
  function headerNamesSender(headerText, emails, names) {
    const own = new Set((Array.isArray(emails) ? emails : [])
      .map((value) => String(value || '').trim().toLowerCase()).filter((value) => value.includes('@')));
    const lowered = String(headerText || '').toLowerCase();
    if ((lowered.match(HEADER_EMAIL_PATTERN) || []).some((email) => own.has(email))) return true;
    const header = normalizeMatchText(headerText);
    return (Array.isArray(names) ? names : []).some((value) => {
      const name = normalizeMatchText(value);
      if (name.length < 3 || name.includes('@')) return false;
      let index = header.indexOf(name);
      while (index >= 0) {
        const bound = /^\s*[<("]?\s*([^\s<>()"]+@[^\s<>()"]+)/.exec(header.slice(index + name.length));
        if (!bound || own.has(bound[1].replace(/[>),.;:]+$/, ''))) return true;
        index = header.indexOf(name, index + 1);
      }
      return false;
    });
  }

  // Letters and digits only, with the links compared exactly: clients insert
  // ">" mid-sentence, rewrap lines, swap quotes and break link markup, but a
  // changed word, link or attachment is never the same message.
  function lettersOnly(value) {
    // Clients also write the euro sign out as "EUR".
    return normalizeMatchText(value).replace(/€/g, 'eur').replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // Our own original cold email, quoted after it left the conversation (no
  // sent copy to compare). The header must name one of our senders and the
  // quote must carry at least two fixed sentences of the campaign template.
  const OWN_CAMPAIGN_TEMPLATE_SIGNALS = [
    /\bafgelopen week kwam ik (?:jullie|je|uw) website\b/,
    /\b(?:uit|vanuit) enthousiasme\b.{0,180}\b(?:fris|nieuw)\s+webdesign\b/,
    /\bik heb\b.{0,100}\b(?:fris|nieuw)\s+webdesign\b.{0,80}\bgemaakt\b/,
    /\bik ben oprecht benieuwd wat (?:je|jullie|u) ervan vind/,
    /\b(?:ontwerp|webdesign)\b.{0,100}\b(?:bijlage|online preview)\b/,
  ];

  function isOwnCampaignTemplateQuote(headerText, quotedValue, options = {}) {
    const senders = (Array.isArray(options.ownSenders) ? options.ownSenders : [])
      .map((value) => String(value || '').trim()).filter((value) => value.length >= 3);
    const ownHeader = headerNamesSender(headerText, senders.filter((value) => value.includes('@')),
      senders.filter((value) => !value.includes('@')));
    if (!ownHeader) return false;
    const quoted = normalizeMatchText(getAuthoredPrefix(quotedValue));
    return OWN_CAMPAIGN_TEMPLATE_SIGNALS.filter((pattern) => pattern.test(quoted)).length >= 2;
  }

  function linksOf(value) {
    return (String(value || '').match(/https?:\/\/[^\s<>()\[\]"']+/g) || [])
      .map((url) => url.replace(/[.,;:!?]+$/, ''));
  }

  function matchesHeaderProvenCopy(quotedValue, message, options) {
    if (!options.quoteHeaderText || !quoteHeaderProvesSentCopy(options.quoteHeaderText, message, options)) return false;
    const quoted = getAuthoredPrefix(quotedValue);
    const sent = getAuthoredPrefix(message && (message.body || message.text || ''));
    const sentLetters = lettersOnly(sent);
    const quotedLetters = lettersOnly(quoted);
    // The header already proves sender and minute, so a client that cuts the
    // greeting or signature still quotes our mail. Nothing may be added to it.
    if (sentLetters.length < 40 || quotedLetters.length < 40 || !sentLetters.includes(quotedLetters)) return false;
    const sentLinks = linksOf(sent);
    return linksOf(quoted).every((url) => sentLinks.includes(url));
  }

  function containsLiteralExcerpt(quotedValue, message) {
    // Selected-text replies need the reverse comparison. Preserve URLs and
    // punctuation here: altered quotes and personal additions are never copies.
    const literal = (value) => String(value || '').replace(/^\s*(?:>\s*)+/gm, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    const excerpt = literal(quotedValue);
    if (excerpt.length < 16 || excerpt.split(/\s+/).length < 3) return false;
    const sent = literal(getAuthoredPrefix(message && (message.body || message.text || '')));
    const index = sent.indexOf(excerpt);
    if (index < 0) return false;
    return !/[\p{L}\p{N}]/u.test(sent[index - 1] || '') &&
      !/[\p{L}\p{N}]/u.test(sent[index + excerpt.length] || '');
  }

  function matchesDomainJoinedCopy(quotedValue, message) {
    // Apple Mail can drop the space after a domain wrapped in an inline span.
    // Compare the complete original text; tolerate only those source-proven
    // domain boundaries, preserving links, punctuation and all other words.
    const linkText = (value) => String(value || '')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/gi, '$1 $2')
      .replace(/(?:\[(https?:\/\/[^\]\s]+)\]|<(https?:\/\/[^>\s]+)>)/gi, '$1$2');
    const source = getAuthoredPrefix(message && (message.body || message.text || ''));
    // Check destinations before Unicode/space normalization. URL paths and
    // queries are case-sensitive, and joining text can change the hostname.
    const sourceUrls = linkText(source).match(/https?:\/\/[^\s<>]+/gi) || [];
    const quotedUrls = linkText(quotedValue).match(/https?:\/\/[^\s<>]+/gi) || [];
    if (sourceUrls.length !== quotedUrls.length || sourceUrls.some((url, i) => url !== quotedUrls[i])) return false;
    const literal = (value) => linkText(value)
      .replace(/^\s*(?:>\s*)+/gm, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .normalize('NFKC').replace(/\s+/g, ' ').trim();
    let quoted = literal(quotedValue);
    let sent = literal(source);
    if (sent.length < 80) return false;

    // A client may append attachment names to its quote. Only the original
    // sent message's attachment metadata can prove that such a suffix is noise.
    const filenames = new Set((Array.isArray(message?.attachments) ? message.attachments : [])
      .map((attachment) => literal(attachment?.filename)).filter(Boolean));
    while (filenames.size) {
      const suffix = /\s*<([^<>]+)>$/.exec(quoted);
      if (!suffix || !filenames.has(suffix[1])) break;
      quoted = quoted.slice(0, suffix.index).trimEnd();
    }

    const domains = new Set(Array.from(sent.matchAll(
      /(?<![a-z0-9@._-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63})\s+(?=[\p{L}\p{N}])/giu
    ), (match) => match[1]));
    if (!domains.size) return false;
    for (const domain of domains) {
      const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundary = new RegExp(`(?<![a-z0-9@._-])${escaped}\\s+(?=[\\p{L}\\p{N}])`, 'gu');
      sent = sent.replace(boundary, domain);
      quoted = quoted.replace(boundary, domain);
    }
    return quoted === sent;
  }


  function findExactProvenOutbound(quotedValue, outboundMessages, options = {}) {
    const quotedText = normalizeMatchText(quotedValue);
    if (!quotedText) return null;
    // Some clients glue the greeting onto the collapsed header line; the
    // complete segment then still contains the complete sent message.
    const rawQuotedText = options.rawQuotedValue ? normalizeMatchText(options.rawQuotedValue) : '';
    const quoteContains = (candidate) => quotedText.includes(candidate) || Boolean(rawQuotedText && rawQuotedText.includes(candidate));
    const directParentMessageIds = new Set(
      (Array.isArray(options.directParentMessageIds) ? options.directParentMessageIds : [])
        .map(normalizeMessageId)
        .filter(Boolean)
    );
    const incomingTimestamp = Date.parse(options.incomingAt || options.beforeAt || '');
    const maxClockSkewMs = Math.max(0, Number(options.maxClockSkewMs) || 5 * 60 * 1000);
    const matches = (Array.isArray(outboundMessages) ? outboundMessages : [])
      .filter((message) => {
        const exactDirectParent = directParentMessageIds.has(
          normalizeMessageId(message && message.messageId)
        );
        if (Number.isFinite(incomingTimestamp)) {
          const candidateTimestamp = getMessageTimestamp(message);
          if (!candidateTimestamp && !exactDirectParent) return false;
          const allowedClockSkewMs = exactDirectParent ? maxClockSkewMs : 0;
          if (candidateTimestamp && candidateTimestamp > incomingTimestamp + allowedClockSkewMs) return false;
        }
        const bodyText = normalizeMatchText(message && (message.body || message.text || ''));
        const authoredText = normalizeMatchText(getAuthoredPrefix(
          message && (message.body || message.text || '')
        ));
        if (!bodyText) return false;
        if (options.quoteHeader && matchesExcerptHeader(options.quoteHeader, message, options) &&
          (containsLiteralExcerpt(quotedValue, message) || matchesDomainJoinedCopy(quotedValue, message))) return true;
        const exactScopedDirectParent = options.directParentScopeProven === true &&
          exactDirectParent;
        if (quotedText === bodyText) return bodyText.length >= 8 || exactScopedDirectParent;
        const containsScopedDirectParentText = (candidateText) => Boolean(
          candidateText && (
            candidateText.length >= 8
              ? quotedText.includes(candidateText)
              : quotedText === candidateText || quotedText.startsWith(`${candidateText} `)
          )
        );
        if (matchesHeaderProvenCopy(quotedValue, message, options)) return true;
        return (
          (bodyText.length >= 80 && quoteContains(bodyText)) ||
          (authoredText.length >= 80 && quoteContains(authoredText)) ||
          (exactScopedDirectParent && containsScopedDirectParentText(bodyText)) ||
          (exactScopedDirectParent && containsScopedDirectParentText(authoredText))
        );
      });
    const unique = new Map();
    matches.forEach((message) => {
      const identity = messageIdentity(message);
      if (identity && !unique.has(identity)) unique.set(identity, message);
    });
    if (unique.size === 1) return Array.from(unique.values())[0];

    // A quoted reply can contain the direct parent plus older nested messages.
    // Text matching alone then produces multiple valid candidates. Prefer only
    // an exact RFC Message-ID from the current message's In-Reply-To header;
    // references/subject/date are deliberately not used as a guess.
    if (!directParentMessageIds.size) return null;
    const directParents = Array.from(unique.values()).filter((message) => (
      directParentMessageIds.has(normalizeMessageId(message && message.messageId))
    ));
    return directParents.length === 1 ? directParents[0] : null;
  }

  function stripProvenQuotedOutbound(value, outboundMessages, options = {}) {
    const parsed = findQuotedSegments(value);
    if (!parsed.segments.length) return { body: String(value || '').trim(), removed: [], matchedMessages: [] };
    const removed = [];
    const matchedMessages = [];
    parsed.segments.forEach((segment) => {
      const quoteHeaderText = [segment.header, ...String(segment.text || '').split('\n').slice(0, 4)].join('\n');
      const quotedValue = stripQuotedEnvelope(segment.text);
      const match = findExactProvenOutbound(quotedValue, outboundMessages, {
        ...options, quoteHeader: segment.header, rawQuotedValue: segment.text, quoteHeaderText,
      });
      if (!match) {
        if (isOwnCampaignTemplateQuote(quoteHeaderText, quotedValue, options)) removed.push(segment);
        return;
      }
      const expandedStart = getProvenWrappedGmailHeaderStart(parsed.lines, segment);
      removed.push(expandedStart < segment.start ? { ...segment, start: expandedStart } : segment);
      matchedMessages.push(match);
    });
    if (!removed.length) return { body: String(value || '').trim(), removed: [], matchedMessages: [] };

    const uniqueMatches = new Map();
    matchedMessages.forEach((message) => {
      const identity = messageIdentity(message);
      if (identity && !uniqueMatches.has(identity)) uniqueMatches.set(identity, message);
    });
    const lastRemovedEnd = Math.max(...removed.map((segment) => segment.end));
    const referenceAppendix = options.stripReferenceAppendixWhenSingleMatch === true && uniqueMatches.size === 1
      ? findTrailingReferenceAppendix(parsed.lines, lastRemovedEnd, removed)
      : null;

    const kept = parsed.lines.filter((_line, index) => (
      !removed.some((segment) => index >= segment.start && index < segment.end) &&
      !(referenceAppendix && index >= referenceAppendix.start && index < referenceAppendix.end)
    ));
    return {
      body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      removed,
      matchedMessages,
      removedReferenceAppendix: Boolean(referenceAppendix),
    };
  }

  const api = {
    cleanHeaderLine,
    extractHeaderFields,
    findExactProvenOutbound,
    findQuotedSegments,
    getAuthoredPrefix,
    isForwardSeparatorLine,
    isHeaderClusterAt,
    isReplyHeaderLine,
    isStandaloneSenderQuoteLine,
    normalizeMatchText,
    parseReplyHeaderLine,
    removeSegments,
    splitQuotedThread,
    stripQuotedEnvelope,
    stripProvenQuotedOutbound,
  };
  if (typeof window !== 'undefined') global.SoftoraMailboxQuotedThread = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
