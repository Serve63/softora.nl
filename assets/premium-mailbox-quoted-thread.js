(function initSoftoraMailboxQuotedThread(global) {
  'use strict';

  const IGNORABLE_MATCH_LINE_PATTERNS = [
    /^\[image:\s*[^\]]+\]\s*$/i,
    /^hieronder zie je een korte indruk van de eerste versie op verschillende schermen\.?\s*$/i,
    /^geen webdesign willen ontvangen\?\s*laat het me weten!.*$/i,
  ];

  function normalizeLines(value) {
    return String(value || '').replace(/\r\n?/g, '\n').split('\n');
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
      segments.push(buildSegment(lines, index, end, marker, replyHeader));
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
    return {
      ...parsed,
      authored: removeSegments(value, parsed.segments),
      authoredPrefix: first ? parsed.lines.slice(0, first.start).join('\n').trim() : String(value || '').trim(),
      quoted: first ? parsed.lines.slice(first.start, first.end).join('\n').trim() : '',
      quotePayload: first ? first.quotePayload : '',
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
      if (valid && targetCount && hasCorrespondingMarker) {
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

  function findExactProvenOutbound(quotedValue, outboundMessages, options = {}) {
    const quotedText = normalizeMatchText(quotedValue);
    if (!quotedText) return null;
    const directParentMessageIds = new Set(
      (Array.isArray(options.directParentMessageIds) ? options.directParentMessageIds : [])
        .map(normalizeMessageId)
        .filter(Boolean)
    );
    const incomingTimestamp = Date.parse(options.incomingAt || options.beforeAt || '');
    const maxClockSkewMs = Math.max(0, Number(options.maxClockSkewMs) || 5 * 60 * 1000);
    const matches = (Array.isArray(outboundMessages) ? outboundMessages : [])
      .filter((message) => {
        if (Number.isFinite(incomingTimestamp)) {
          const candidateTimestamp = getMessageTimestamp(message);
          const exactDirectParent = directParentMessageIds.has(normalizeMessageId(message && message.messageId));
          if (!candidateTimestamp && !exactDirectParent) return false;
          if (candidateTimestamp && candidateTimestamp > incomingTimestamp + maxClockSkewMs) return false;
        }
        const bodyText = normalizeMatchText(message && (message.body || message.text || ''));
        const authoredText = normalizeMatchText(getAuthoredPrefix(
          message && (message.body || message.text || '')
        ));
        if (!bodyText) return false;
        if (quotedText === bodyText) return bodyText.length >= 8;
        return (
          (bodyText.length >= 80 && quotedText.includes(bodyText)) ||
          (authoredText.length >= 80 && quotedText.includes(authoredText))
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
      const match = findExactProvenOutbound(stripQuotedEnvelope(segment.text), outboundMessages, options);
      if (!match) return;
      removed.push(segment);
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
