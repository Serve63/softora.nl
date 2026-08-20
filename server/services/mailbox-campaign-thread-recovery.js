const quotedThread = require('../../assets/premium-mailbox-quoted-thread.js');
const QUOTED_PARENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function findStructuredQuoteStart(value) {
  const parsed = quotedThread.findQuotedSegments(value);
  const segment = parsed.segments[0] || null;
  return { lines: parsed.lines, index: segment ? segment.start : -1, segment };
}

function normalizeQuotedMatchText(value) {
  return quotedThread.normalizeMatchText(value);
}

function extractQuotedRecipientEmails(value, extractEmailAddresses) {
  const parsed = findStructuredQuoteStart(value);
  if (parsed.index < 0) return [];
  const fields = quotedThread.extractHeaderFields(parsed.segment.displayLines);
  return Array.from(new Set(fields.to.flatMap(extractEmailAddresses)));
}

function createMailboxCampaignThreadRecovery(helpers = {}) {
  const {
    dedupeCampaignMessages,
    extractEmailAddresses,
    getCanonicalCampaignSubject,
    getAccountOwner,
    getMailboxMessageDirection,
    getMessageIdentity,
    getMessageReferenceIds,
    getMessageTimestamp,
    normalizeEmail,
    normalizeMessageId,
    normalizeText,
    resolveConversationActivity,
  } = helpers;

  function accountsShareOwner(left, right) {
    if (typeof getAccountOwner !== 'function') return false;
    const leftOwner = normalizeText(getAccountOwner(normalizeEmail(left))).toLowerCase();
    const rightOwner = normalizeText(getAccountOwner(normalizeEmail(right))).toLowerCase();
    return Boolean(leftOwner && rightOwner && leftOwner === rightOwner);
  }

  function getQuotedMessageTimestamp(message) {
    const source = message && typeof message === 'object' ? message : {};
    for (const value of [source.receivedAt, source.internalDate, source.date, source.activityAt]) {
      const timestamp = Date.parse(value || '');
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return 0;
  }

  function extractQuotedSenderEmails(value) {
    const parsed = findStructuredQuoteStart(value);
    if (parsed.index < 0) return [];
    const fields = quotedThread.extractHeaderFields(parsed.segment.displayLines);
    return Array.from(new Set([
      parsed.segment.header,
      ...fields.from,
      ...fields.replyTo,
    ].flatMap(extractEmailAddresses)));
  }

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
      const evidence = messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .flatMap((message) => {
          const parsedQuote = findStructuredQuoteStart(message && message.body);
          const headerRecipients = extractQuotedRecipientEmails(message && message.body, extractEmailAddresses);
          const fallbackRecipient = normalizeEmail(conversation && conversation.email);
          const recipients = headerRecipients.length
            ? headerRecipients
            : parsedQuote.segment && parsedQuote.segment.marker === 'reply-header' && fallbackRecipient
              ? [fallbackRecipient]
              : [];
          const senderEmails = extractQuotedSenderEmails(message && message.body);
          const at = getQuotedMessageTimestamp(message);
          return recipients.map((recipientEmail) => ({ recipientEmail, senderEmails, at }));
        });
      return evidence.map(({ recipientEmail, senderEmails, at }) => ({
        accountEmail,
        canonicalSubject,
        recipientEmail,
        senderEmails,
        beforeAt: at ? new Date(at + QUOTED_PARENT_CLOCK_SKEW_MS).toISOString() : '',
      }));
    });
  }

  function isQuotedSentRecoveryCandidate(conversation) {
    const subject = String(conversation && conversation.subject || '').trim();
    const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
      ? conversation.threadMessages
      : [])];
    const alreadyHasOriginal = messages.some((message) => (
      getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
    ));
    if (alreadyHasOriginal) return false;

    const forwardedSubject = /(?:^|\s)(?:fwd?|doorgestuurd)\s*:/i.test(subject);
    const exactQuotedRecipient = messages
      .filter((message) => getMailboxMessageDirection(message) !== 'sent')
      .some((message) => {
        const body = normalizeText(message && message.body);
        const parsed = findStructuredQuoteStart(body);
        if (!body || parsed.index < 0) return false;
        return (
          extractQuotedRecipientEmails(body, extractEmailAddresses).length > 0 ||
          (parsed.segment.marker === 'reply-header' && Boolean(normalizeEmail(conversation && conversation.email)))
        );
      });
    return forwardedSubject || exactQuotedRecipient;
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
          const quotedRecipients = extractQuotedRecipientEmails(message && message.body, extractEmailAddresses);
          const fallbackRecipient = normalizeEmail(conversation && conversation.email);
          return {
            at: getQuotedMessageTimestamp(message),
            body: parsed.segment.text,
            recipients: quotedRecipients.length
              ? quotedRecipients
              : parsed.segment.marker === 'reply-header' && fallbackRecipient
                ? [fallbackRecipient]
                : [],
            senderEmails: extractQuotedSenderEmails(message && message.body),
          };
        })
        .filter(Boolean);
      if (!incomingEvidence.length) return conversation;

      const matches = dedupeCampaignMessages(candidateSentMessages)
        .filter((candidate) => (
          getMailboxMessageDirection(candidate) === 'sent' &&
          candidate && candidate.originalCampaignOutbound === true &&
          getCanonicalCampaignSubject(candidate.subject) === canonicalSubject
        ))
        .filter((candidate) => {
          const candidateAccount = normalizeEmail(candidate && candidate.accountEmail);
          const candidateBody = normalizeQuotedMatchText(candidate && candidate.body);
          if (candidateBody.length < 80) return false;
          const candidateRecipients = extractEmailAddresses(candidate && candidate.to);
          if (candidateRecipients.length !== 1) return false;
          const candidateAt = getQuotedMessageTimestamp(candidate);
          return incomingEvidence.some((evidence) => (
            (
              candidateAccount === accountEmail ||
              (
                accountsShareOwner(candidateAccount, accountEmail) &&
                evidence.senderEmails.includes(candidateAccount)
              )
            ) &&
            evidence.at > 0 &&
            candidateAt > 0 &&
            candidateAt <= evidence.at + QUOTED_PARENT_CLOCK_SKEW_MS &&
            evidence.recipients.includes(candidateRecipients[0]) &&
            normalizeQuotedMatchText(evidence.body).includes(candidateBody)
          ));
        });
      if (matches.length !== 1) return conversation;

      const candidate = {
        ...matches[0],
        threadCorrelationEvidence: normalizeEmail(matches[0] && matches[0].accountEmail) === accountEmail
          ? 'exact-account-subject-quoted-body-and-recipient'
          : 'same-owner-alias-subject-quoted-body-and-recipient',
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

  async function recoverQuotedOriginalSentMessages({
    conversations,
    selectedAccountEmails,
    limit,
    mailboxIndexStore,
  }) {
    const source = Array.isArray(conversations) ? conversations : [];
    const selectedAccounts = new Set((selectedAccountEmails || []).map(normalizeEmail));
    const safeLimit = Math.max(1, Number(limit) || 1);
    const hydrationCandidates = source
      .filter((conversation) => {
        const messages = [
          conversation,
          ...(Array.isArray(conversation && conversation.threadMessages)
            ? conversation.threadMessages
            : []),
        ];
        return selectedAccounts.has(normalizeEmail(conversation && conversation.accountEmail)) &&
          !messages.some((message) => (
            getMailboxMessageDirection(message) === 'sent' &&
            message && message.originalCampaignOutbound === true
          ));
      })
      .slice(0, safeLimit);
    const hydrated = hydrationCandidates.length &&
      mailboxIndexStore && typeof mailboxIndexStore.hydrateMessageBodies === 'function'
      ? await mailboxIndexStore.hydrateMessageBodies({ messages: hydrationCandidates })
      : hydrationCandidates;
    const recoveryCandidates = hydrated.filter(isQuotedSentRecoveryCandidate);
    const baseTargets = getQuotedSentRecoveryTargets(recoveryCandidates);
    const selectedAccountList = Array.from(selectedAccounts);
    const targets = baseTargets.flatMap((target) => {
      const exact = [target.accountEmail];
      const quotedAliases = selectedAccountList.filter((candidateAccount) => (
        candidateAccount !== target.accountEmail &&
        accountsShareOwner(candidateAccount, target.accountEmail) &&
        target.senderEmails.includes(candidateAccount)
      ));
      return [...exact, ...quotedAliases].map((accountEmail) => ({ ...target, accountEmail }));
    });
    const sentCandidates = targets.length &&
      mailboxIndexStore && typeof mailboxIndexStore.listSentCandidatesForQuotedReplies === 'function'
      ? await mailboxIndexStore.listSentCandidatesForQuotedReplies({
          targets,
          limitPerTarget: 10,
        }).catch(() => [])
      : [];
    const recovered = attachQuotedOriginalSentMessages(recoveryCandidates, sentCandidates);
    const hydratedByIdentity = new Map(hydrated.map((message) => [
      getMessageIdentity(message),
      message,
    ]));
    recovered.forEach((conversation) => {
      hydratedByIdentity.set(getMessageIdentity(conversation), conversation);
    });
    const recoveredByIdentity = new Map(recovered.map((conversation) => [
      getMessageIdentity(conversation),
      conversation,
    ]));
    return {
      conversations: source.map((conversation) => (
        recoveredByIdentity.get(getMessageIdentity(conversation)) || conversation
      )),
      hydratedByIdentity,
    };
  }

  return {
    attachQuotedOriginalSentMessages,
    attachTargetedUnthreadedSentMessages,
    buildAcceptedProvenanceMessage,
    canMergeProvenConversationSegments,
    getQuotedSentRecoveryTargets,
    isQuotedSentRecoveryCandidate,
    recoverQuotedOriginalSentMessages,
  };
}

module.exports = { createMailboxCampaignThreadRecovery };
