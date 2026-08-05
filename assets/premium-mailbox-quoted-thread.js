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

  function isReplyHeaderLine(value) {
    const line = cleanHeaderLine(value);
    return (
      /^(?:op\s.+\b(?:schreef(?:\s+[^:\n]+)?|heeft\s+.+\s+geschreven)\s*:?)$/i.test(line) ||
      /^(?:on\s.+\bwrote\s*:?)$/i.test(line)
    );
  }

  function isForwardSeparatorLine(value) {
    const line = cleanHeaderLine(value);
    return (
      /^(?:-{2,}|_{2,})\s*(?:original message|oorspronkelijk bericht|forwarded message|doorgestuurd bericht)\s*(?:-{2,}|_{2,})?$/i.test(line) ||
      /^(?:begin|start)\s+(?:doorgestuurd|forwarded)\s+bericht\s*:?$/i.test(line)
    );
  }

  const HEADER_PATTERNS = Object.freeze({
    from: /^(?:van|from):\s*\S/i,
    sent: /^(?:verzonden|sent|datum|date):\s*\S/i,
    to: /^(?:aan|to):\s*\S/i,
    subject: /^(?:onderwerp|subject):\s*\S/i,
  });

  function isHeaderClusterAt(lines, startIndex) {
    const windowLines = lines
      .slice(startIndex, startIndex + 10)
      .map(cleanHeaderLine)
      .filter(Boolean);
    if (!windowLines.length || !HEADER_PATTERNS.from.test(windowLines[0])) return false;
    const matchedFields = ['sent', 'to', 'subject']
      .filter((field) => windowLines.some((line) => HEADER_PATTERNS[field].test(line)));
    return matchedFields.length >= 2;
  }

  function isQuotePrefixedLine(value) {
    return /^\s*>/.test(String(value || ''));
  }

  function findQuotedSegments(value) {
    const lines = normalizeLines(value);
    const segments = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const gmailHeader = isReplyHeaderLine(line);
      const forwardSeparator = isForwardSeparatorLine(line);
      const headerCluster = isHeaderClusterAt(lines, index);
      const quotedLine = isQuotePrefixedLine(line);
      if (!gmailHeader && !forwardSeparator && !headerCluster && !quotedLine) continue;

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

      segments.push({
        start: index,
        end,
        text: lines.slice(index, end).join('\n').trim(),
      });
      index = Math.max(index, end - 1);
    }
    return { lines, segments };
  }

  function normalizeMatchText(value) {
    return normalizeLines(value)
      .map((line) => String(line || '')
        .replace(/^\s*(?:>\s*)+/, '')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .trim())
      .filter((line) => (
        line && !IGNORABLE_MATCH_LINE_PATTERNS.some((pattern) => pattern.test(line))
      ))
      .join(' ')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
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

  function normalizeMessageId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^<+|>+$/g, '');
  }

  function getAuthoredPrefix(value) {
    const parsed = findQuotedSegments(value);
    const firstQuotedStart = parsed.segments.length
      ? Math.min(...parsed.segments.map((segment) => segment.start))
      : -1;
    return firstQuotedStart > 0
      ? parsed.lines.slice(0, firstQuotedStart).join('\n').trim()
      : String(value || '').trim();
  }

  function findExactProvenOutbound(quotedValue, outboundMessages, options = {}) {
    const quotedText = normalizeMatchText(quotedValue);
    if (!quotedText) return null;
    const matches = (Array.isArray(outboundMessages) ? outboundMessages : [])
      .filter((message) => {
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
    const directParentMessageIds = new Set(
      (Array.isArray(options.directParentMessageIds) ? options.directParentMessageIds : [])
        .map(normalizeMessageId)
        .filter(Boolean)
    );
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
      const match = findExactProvenOutbound(segment.text, outboundMessages, options);
      if (!match) return;
      removed.push(segment);
      matchedMessages.push(match);
    });
    if (!removed.length) return { body: String(value || '').trim(), removed: [], matchedMessages: [] };

    const kept = parsed.lines.filter((_line, index) => !removed.some((segment) => (
      index >= segment.start && index < segment.end
    )));
    return {
      body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      removed,
      matchedMessages,
    };
  }

  const api = {
    cleanHeaderLine,
    findExactProvenOutbound,
    findQuotedSegments,
    getAuthoredPrefix,
    isForwardSeparatorLine,
    isHeaderClusterAt,
    isReplyHeaderLine,
    normalizeMatchText,
    stripProvenQuotedOutbound,
  };
  global.SoftoraMailboxQuotedThread = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
