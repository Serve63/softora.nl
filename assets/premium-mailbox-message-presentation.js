(function (global) {
  'use strict';

  const SENT_PREFIX_BOUNDARY_MARKERS = new Set([
    'reply-header',
    'forward-separator',
    'header-cluster',
    'sender-header',
  ]);

  function create(options = {}) {
    const quotedThread = options.quotedThread || global.SoftoraMailboxQuotedThread || (
      typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-quoted-thread.js') : null
    );
    const signature = options.signature || global.SoftoraMailboxSignature || (
      typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-signature.js') : null
    );

    function emptyContact() {
      return { phone: '', phoneHref: '', addressLines: [] };
    }

    function emptyPresentation() {
      return { body: '', contact: emptyContact(), signatureMatched: false };
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

    function getSourceSafeMessagePresentation(message, mail, bodyOverride) {
      const body = typeof bodyOverride === 'string'
        ? bodyOverride
        : String(message && message.body || '');
      if (!body) return emptyPresentation();
      if (
        options.isSentMessageByProvenance(message, mail && mail.accountEmail) ||
        message && message.copyContext && message.copyContext.evidenceKnown === true
      ) {
        return { body: getSentAuthoredBody(body), contact: emptyContact(), signatureMatched: false };
      }
      const sourceSafeBody = getProvenQuotedOutboundResult(body, mail, message).body;
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return { body: sourceSafeBody, contact: emptyContact(), signatureMatched: false };
      }
      const parsedSignature = signature?.parseIncoming?.(sourceSafeBody);
      if (!parsedSignature || parsedSignature.matched !== true || !Array.isArray(parsedSignature.bodyLines)) {
        return { body: sourceSafeBody, contact: emptyContact(), signatureMatched: false };
      }
      return {
        body: parsedSignature.bodyLines.join('\n').trim(),
        contact: parsedSignature.contact || emptyContact(),
        signatureMatched: true,
      };
    }

    function getSourceSafeMessageBody(message, mail, bodyOverride) {
      return getSourceSafeMessagePresentation(message, mail, bodyOverride).body;
    }

    function getThreadPresentation(message, mail, state = {}) {
      const presentation = state.loading ? emptyPresentation() : getSourceSafeMessagePresentation(message, mail);
      const contactHtml = !state.sent && !state.loading && !state.loadError
        ? signature?.renderContactCard?.(presentation.contact, state.escapeHtml) || ''
        : '';
      return { ...presentation, contactHtml };
    }

    function getRootPresentation(value, mail) {
      const presentation = getSourceSafeMessagePresentation(mail, mail, String(value || ''));
      let contactInserted = false;
      return {
        ...presentation,
        appendContact(target) {
          const html = contactInserted ? '' : signature?.renderContactCard?.(presentation.contact) || '';
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

  const api = { create };
  global.SoftoraMailboxMessagePresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
