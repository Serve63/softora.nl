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

  return { attachTargetedUnthreadedSentMessages, buildAcceptedProvenanceMessage, canMergeProvenConversationSegments };
}

module.exports = { createMailboxCampaignThreadRecovery };
