const QUOTED_MATCH_IGNORABLE_LINE_PATTERNS = [
  /^\[image:\s*[^\]]+\]\s*$/i,
  /^hieronder zie je een korte indruk van de eerste versie op verschillende schermen\.?\s*$/i,
];

function cleanQuotedHeaderLine(value) {
  return String(value || '')
    .replace(/^\s*(?:>\s*)+/, '')
    .trim()
    .replace(/^\*{1,2}([^*\n]{1,40}:)\*{1,2}\s*/, '$1 ')
    .trim();
}

function findStructuredQuoteStart(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const headerPatterns = {
    from: /^(?:van|from):\s*\S/i,
    sent: /^(?:verzonden|sent|datum|date):\s*\S/i,
    to: /^(?:aan|to):\s*\S/i,
    subject: /^(?:onderwerp|subject):\s*\S/i,
  };
  function isHeaderClusterAt(index) {
    const windowLines = lines.slice(index, index + 10).map(cleanQuotedHeaderLine).filter(Boolean);
    if (!windowLines.length || !headerPatterns.from.test(windowLines[0])) return false;
    return ['sent', 'to', 'subject']
      .filter((field) => windowLines.some((line) => headerPatterns[field].test(line)))
      .length >= 2;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanQuotedHeaderLine(lines[index]);
    if (
      /^(?:op\s.+\b(?:schreef(?:\s+[^:\n]+)?|heeft\s+.+\s+geschreven)\s*:?)$/i.test(line) ||
      /^(?:on\s.+\bwrote\s*:?)$/i.test(line) ||
      /^(?:begin|start)\s+(?:doorgestuurd|forwarded)\s+bericht\s*:?$/i.test(line) ||
      /^(?:-{2,}|_{2,})\s*(?:original message|oorspronkelijk bericht|forwarded message|doorgestuurd bericht)/i.test(line) ||
      isHeaderClusterAt(index)
    ) return { lines, index };
  }
  return { lines, index: -1 };
}

function normalizeQuotedMatchText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => String(line || '')
      .replace(/^\s*(?:>\s*)+/, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .trim())
    .filter((line) => line && !QUOTED_MATCH_IGNORABLE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[(https?:\/\/[^\]\s]+)\]/gi, ' ')
    .replace(/<?https?:\/\/[^\s>]+>?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractQuotedRecipientEmails(value, extractEmailAddresses) {
  const parsed = findStructuredQuoteStart(value);
  if (parsed.index < 0) return [];
  return Array.from(new Set(parsed.lines
    .slice(parsed.index)
    .map(cleanQuotedHeaderLine)
    .filter((line) => /^(?:aan|to):\s*/i.test(line))
    .flatMap((line) => extractEmailAddresses(line))));
}

function createMailboxCampaignThreadRecovery(helpers = {}) {
  const {
    dedupeCampaignMessages,
    extractEmailAddresses,
    getCanonicalCampaignSubject,
    getMailboxMessageDirection,
    getMessageIdentity,
    getMessageReferenceIds,
    getMessageTimestamp,
    normalizeEmail,
    normalizeMessageId,
    normalizeText,
    resolveConversationActivity,
  } = helpers;

  function canMergeProvenConversationSegments(groupedConversations) {
    if (groupedConversations.length < 2) return true;
    const segments = groupedConversations
      .map((conversation) => [
        conversation,
        ...(Array.isArray(conversation && conversation.threadMessages) ? conversation.threadMessages : []),
      ].sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right)))
      .sort((left, right) => getMessageTimestamp(left[0]) - getMessageTimestamp(right[0]));
    if (segments.some((segment) => (
      !segment.some((message) => getMailboxMessageDirection(message) === 'sent') ||
      !segment.some((message) => getMailboxMessageDirection(message) !== 'sent')
    ))) return false;
    for (let index = 1; index < segments.length; index += 1) {
      const previousLast = segments[index - 1][segments[index - 1].length - 1];
      const currentFirst = segments[index][0];
      if (
        getMessageTimestamp(previousLast) >= getMessageTimestamp(currentFirst) ||
        getMailboxMessageDirection(previousLast) === 'sent' ||
        getMailboxMessageDirection(currentFirst) !== 'sent'
      ) return false;
    }
    return true;
  }

  function buildAcceptedProvenanceMessage(intent = {}) {
    const acceptedAt = normalizeText(intent.acceptedAt || intent.updatedAt || intent.createdAt);
    const messageId = normalizeText(intent.messageId || intent.providerMessageId);
    return {
      id: `accepted-sent:${messageId || intent.intentId}`,
      mailboxId: `accepted-sent:${messageId || intent.intentId}`,
      folder: 'sent',
      storageFolder: intent.provider === 'instantly' ? 'instantly' : 'sent',
      direction: 'sent',
      accountEmail: normalizeEmail(intent.accountEmail),
      from: normalizeText(intent.senderName || intent.accountEmail),
      email: normalizeEmail(intent.accountEmail),
      to: normalizeEmail(intent.recipientEmail),
      toDisplay: normalizeEmail(intent.recipientEmail),
      cc: normalizeText(intent.cc), bcc: normalizeText(intent.bcc),
      recipientRoutingEvidenceKnown: true,
      subject: normalizeText(intent.subject), preview: normalizeText(intent.body), body: normalizeText(intent.body),
      date: acceptedAt, receivedAt: acceptedAt, activityAt: acceptedAt,
      messageId,
      inReplyTo: normalizeText(intent.replyTargetMessageId),
      references: normalizeText(intent.references),
      conversationId: normalizeText(intent.conversationId),
      softoraConversationId: normalizeText(intent.conversationId),
      softoraSendIntentId: normalizeText(intent.intentId),
      softoraSendMode: normalizeText(intent.mode),
      softoraReplyTargetMessageId: normalizeText(intent.replyTargetMessageId),
      softoraThreadProvenanceKnown: true,
      provider: normalizeText(intent.provider),
      providerMessageId: normalizeText(intent.providerMessageId),
      providerThreadId: normalizeText(intent.providerThreadId),
      providerOwner: normalizeText(intent.owner),
      hasBody: true, bodyLoaded: true, bodyTruncated: false, unread: false, localAcceptedSend: true,
    };
  }

  function attachTargetedUnthreadedSentMessages(conversations, targetedRows) {
    const groups = new Map();
    (Array.isArray(targetedRows) ? targetedRows : []).forEach((row) => {
      const conversationId = normalizeText(row && row.targetConversationId);
      if (!conversationId || !row.message) return;
      if (!groups.has(conversationId)) groups.set(conversationId, []);
      groups.get(conversationId).push(row.message);
    });
    return (Array.isArray(conversations) ? conversations : []).map((conversation) => {
      const candidates = dedupeCampaignMessages(groups.get(normalizeText(conversation && conversation.conversationId)) || []);
      if (candidates.length !== 1) return conversation;
      const candidate = candidates[0];
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages) ? conversation.threadMessages : [])];
      const inboundMessages = messages.filter((message) => getMailboxMessageDirection(message) !== 'sent');
      const latestInboundAt = Math.max(0, ...inboundMessages.map(getMessageTimestamp));
      const counterparty = normalizeEmail(conversation && conversation.email);
      const candidateMessageId = normalizeMessageId(candidate && candidate.messageId);
      const exact = (
        getMailboxMessageDirection(candidate) === 'sent' &&
        normalizeEmail(candidate && candidate.accountEmail) === normalizeEmail(conversation && conversation.accountEmail) &&
        extractEmailAddresses(candidate && candidate.to).includes(counterparty) &&
        getCanonicalCampaignSubject(candidate && candidate.subject) === getCanonicalCampaignSubject(conversation && conversation.subject) &&
        getMessageTimestamp(candidate) > latestInboundAt &&
        !normalizeText(candidate && candidate.inReplyTo) &&
        !normalizeText(candidate && candidate.references) &&
        !normalizeText(candidate && candidate.providerThreadId) &&
        !messages.some((message) => candidateMessageId && getMessageReferenceIds(message).includes(candidateMessageId))
      );
      if (!exact) return conversation;
      const primaryIdentity = getMessageIdentity(conversation);
      const threadMessages = dedupeCampaignMessages([
        ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
        { ...candidate, threadCorrelationEvidence: 'unique-account-counterparty-subject-later-sent' },
      ])
        .filter((message) => getMessageIdentity(message) !== primaryIdentity)
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const activity = resolveConversationActivity({ ...conversation, threadMessages });
      return { ...conversation, latestInboundAt: activity.latestInboundAt, latestOutboundAt: activity.latestOutboundAt, threadMessages };
    });
  }

  function getQuotedSentRecoveryTargets(conversations) {
    return (Array.isArray(conversations) ? conversations : []).flatMap((conversation) => {
      const accountEmail = normalizeEmail(conversation && conversation.accountEmail);
      const canonicalSubject = getCanonicalCampaignSubject(conversation && conversation.subject);
      if (!accountEmail || !canonicalSubject) return [];
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
        ? conversation.threadMessages
        : [])];
      const alreadyHasOriginal = messages.some((message) => (
        getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
      ));
      if (alreadyHasOriginal) return [];
      const recipientEmails = Array.from(new Set(messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .flatMap((message) => extractQuotedRecipientEmails(message && message.body, extractEmailAddresses))));
      return recipientEmails.map((recipientEmail) => ({ accountEmail, canonicalSubject, recipientEmail }));
    });
  }

  function isQuotedSentRecoveryCandidate(conversation) {
    const subject = String(conversation && conversation.subject || '').trim();
    if (!/(?:^|\s)(?:fwd?|doorgestuurd)\s*:/i.test(subject)) return false;
    const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
      ? conversation.threadMessages
      : [])];
    return !messages.some((message) => (
      getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
    ));
  }

  function attachQuotedOriginalSentMessages(conversations, candidateSentMessages) {
    return (Array.isArray(conversations) ? conversations : []).map((conversation) => {
      const accountEmail = normalizeEmail(conversation && conversation.accountEmail);
      const canonicalSubject = getCanonicalCampaignSubject(conversation && conversation.subject);
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
        ? conversation.threadMessages
        : [])];
      if (
        !accountEmail ||
        !canonicalSubject ||
        messages.some((message) => (
          getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
        ))
      ) return conversation;

      const incomingEvidence = messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .map((message) => {
          const parsed = findStructuredQuoteStart(message && message.body);
          if (parsed.index < 0) return null;
          return {
            at: getMessageTimestamp(message),
            body: parsed.lines.slice(parsed.index).join('\n'),
            recipients: extractQuotedRecipientEmails(message && message.body, extractEmailAddresses),
          };
        })
        .filter(Boolean);
      if (!incomingEvidence.length) return conversation;

      const matches = dedupeCampaignMessages(candidateSentMessages)
        .filter((candidate) => (
          getMailboxMessageDirection(candidate) === 'sent' &&
          candidate && candidate.originalCampaignOutbound === true &&
          normalizeEmail(candidate.accountEmail) === accountEmail &&
          getCanonicalCampaignSubject(candidate.subject) === canonicalSubject
        ))
        .filter((candidate) => {
          const candidateBody = normalizeQuotedMatchText(candidate && candidate.body);
          if (candidateBody.length < 80) return false;
          const candidateRecipients = extractEmailAddresses(candidate && candidate.to);
          if (candidateRecipients.length !== 1) return false;
          return incomingEvidence.some((evidence) => (
            evidence.at > getMessageTimestamp(candidate) &&
            evidence.recipients.includes(candidateRecipients[0]) &&
            normalizeQuotedMatchText(evidence.body).includes(candidateBody)
          ));
        });
      if (matches.length !== 1) return conversation;

      const candidate = {
        ...matches[0],
        threadCorrelationEvidence: 'exact-account-subject-quoted-body-and-recipient',
      };
      const primaryIdentity = getMessageIdentity(conversation);
      const threadMessages = dedupeCampaignMessages([
        ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
        candidate,
      ])
        .filter((message) => getMessageIdentity(message) !== primaryIdentity)
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const activity = resolveConversationActivity({ ...conversation, threadMessages });
      return {
        ...conversation,
        latestInboundAt: activity.latestInboundAt,
        latestOutboundAt: activity.latestOutboundAt,
        threadMessages,
      };
    });
  }

  return {
    attachQuotedOriginalSentMessages,
    attachTargetedUnthreadedSentMessages,
    buildAcceptedProvenanceMessage,
    canMergeProvenConversationSegments,
    getQuotedSentRecoveryTargets,
    isQuotedSentRecoveryCandidate,
  };
}

module.exports = { createMailboxCampaignThreadRecovery };
