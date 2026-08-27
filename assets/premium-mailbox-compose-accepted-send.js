(function (global) {
  'use strict';

  function create(options = {}) {
    const acceptedSends = new Map();

    function normalize(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeMessageId(value) {
      return normalize(value).replace(/^<+|>+$/g, '');
    }

    function getMessageIdentity(message) {
      const providerMessageId = normalize(message?.providerMessageId);
      if (providerMessageId) return `provider:${providerMessageId}`;
      const messageId = normalizeMessageId(message?.messageId);
      if (messageId) return `message:${messageId}`;
      const sendIntentId = normalize(message?.softoraSendIntentId || message?.sendIntentId);
      if (sendIntentId) return `send-intent:${sendIntentId}`;
      return `local:${normalize(message?.id || message?.mailboxId)}`;
    }

    function getCanonicalMessageIdentities(message) {
      const identities = new Set();
      const providerMessageId = normalize(message?.providerMessageId);
      const messageId = normalizeMessageId(message?.messageId);
      const transportMessageId = normalizeMessageId(message?.transportMessageId);
      const sendIntentId = normalize(message?.softoraSendIntentId || message?.sendIntentId);
      if (providerMessageId) identities.add(`provider:${providerMessageId}`);
      if (messageId) identities.add(`message:${messageId}`);
      if (transportMessageId) identities.add(`transport:${transportMessageId}`);
      if (sendIntentId) identities.add(`send-intent:${sendIntentId}`);
      return identities;
    }

    function identitiesOverlap(left, right) {
      const first = left instanceof Set ? left : getCanonicalMessageIdentities(left);
      const second = right instanceof Set ? right : getCanonicalMessageIdentities(right);
      for (const identity of first) {
        if (second.has(identity)) return true;
      }
      return false;
    }

    function isSentMessage(message) {
      return normalize(message?.direction) === 'sent' ||
        normalize(message?.folder) === 'sent' ||
        normalize(message?.storageFolder) === 'sent';
    }

    function isLocalAcceptedFallback(message) {
      return message?.localAcceptedSendFallback === true &&
        message?.localAcceptedSend === true &&
        getCanonicalMessageIdentities(message).size === 0;
    }

    function recordMatchesMailScope(record, mail) {
      if (!record || !mail) return false;
      const recordAccount = normalize(record.accountEmail);
      const recordOwner = normalize(record.owner);
      const mailAccount = normalize(mail.accountEmail);
      const mailOwner = normalize(options.campaignInbox?.getMessageOwner?.(mail));
      if (!recordAccount || !recordOwner || !mailAccount || !mailOwner) return false;
      return recordAccount === mailAccount && recordOwner === mailOwner;
    }

    function candidateMatchesRecordScope(record, candidate) {
      if (!record || !candidate || !isSentMessage(candidate) || isLocalAcceptedFallback(candidate)) return false;
      return recordMatchesMailScope(record, candidate);
    }

    function isClientAcceptedForRecord(message, record) {
      if (message?.localAcceptedSend !== true) return false;
      const recordKey = String(record?.idempotencyKey || '').trim();
      const messageKey = String(message?.softoraClientSendIdempotencyKey || '').trim();
      return Boolean(recordKey && messageKey && recordKey === messageKey);
    }

    function isFallbackForRecord(message, record) {
      return isLocalAcceptedFallback(message) && isClientAcceptedForRecord(message, record);
    }

    function getConversationKeys(mail) {
      return new Set([
        mail?.id,
        mail?.mailboxId,
        mail?.conversationId,
        mail?.providerThreadId && `provider-thread:${normalize(mail.providerThreadId)}`,
        mail?.messageId && `message:${normalizeMessageId(mail.messageId)}`,
      ].map((value) => String(value || '').trim()).filter(Boolean));
    }

    function recordMatchesMail(record, mail) {
      if (!record || !mail) return false;
      if (!recordMatchesMailScope(record, mail)) return false;
      const sourceMailId = String(record.sourceMailId || '').trim();
      if (sourceMailId && sourceMailId === String(mail.id || '').trim()) return true;
      const keys = getConversationKeys(mail);
      return (Array.isArray(record.conversationKeys) ? record.conversationKeys : [])
        .some((key) => keys.has(String(key || '').trim()));
    }

    function findScopedMail(record, mails) {
      const matches = (Array.isArray(mails) ? mails : [])
        .filter((mail) => recordMatchesMail(record, mail));
      return matches.length === 1 ? matches[0] : null;
    }

    function reconcile(mail) {
      if (!mail) return mail;
      const records = Array.from(acceptedSends.values()).filter((record) => recordMatchesMail(record, mail));
      if (!records.length) return mail;
      let messages = Array.isArray(mail.threadMessages) ? mail.threadMessages.slice() : [];
      records
        .sort((left, right) => Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt))
        .forEach((record) => {
          const normalizedMessage = typeof options.normalizeAcceptedMessage === 'function'
            ? options.normalizeAcceptedMessage(record.message)
            : { ...record.message };
          record.message = normalizedMessage;
          const canonicalIdentities = getCanonicalMessageIdentities(normalizedMessage);
          const providerReplacement = canonicalIdentities.size
            ? [mail, ...messages].find((candidate) => (
                candidate?.localAcceptedSend !== true &&
                candidateMatchesRecordScope(record, candidate) &&
                identitiesOverlap(canonicalIdentities, candidate)
              ))
            : null;
          if (providerReplacement) {
            messages = messages.filter((message) => !isClientAcceptedForRecord(message, record));
          }
          const existingMessages = [mail, ...messages];
          const alreadyPresent = canonicalIdentities.size
            ? existingMessages.some((message) => (
                candidateMatchesRecordScope(record, message) &&
                identitiesOverlap(canonicalIdentities, message)
              ))
            : existingMessages.some((message) => (
                recordMatchesMailScope(record, message) &&
                isFallbackForRecord(message, record)
              ));
          if (!providerReplacement && !alreadyPresent) {
            messages.push(normalizedMessage);
          }
          const acceptedAt = String(record.acceptedAt || '');
          const outboundAt = String(
            normalizedMessage?.activityAt || normalizedMessage?.receivedAt || record.acceptedAt || ''
          );
          const currentActivityAt = String(mail.activityAt || mail.latestInboundAt || mail.receivedAt || '');
          mail.latestOutboundAt = outboundAt;
          if (!currentActivityAt || Date.parse(outboundAt) >= Date.parse(currentActivityAt)) {
            mail.activityAt = outboundAt;
            const activityWhen = options.formatMailDate?.(outboundAt);
            if (activityWhen) {
              mail.activityTime = activityWhen.time;
              mail.activityDate = activityWhen.date;
              mail.activityListDate = activityWhen.listDate;
            }
          }
          mail.unread = false;
          mail.replyDismissedAt = acceptedAt;
        });
      mail.threadMessages = messages.sort((left, right) => (
        Date.parse(String(right?.receivedAt || right?.date || '')) - Date.parse(String(left?.receivedAt || left?.date || ''))
      ));
      return mail;
    }

    function remember(record) {
      if (!record?.key) return;
      acceptedSends.set(record.key, record);
      options.onAcceptedSend?.(record);
    }

    return {
      findScopedMail,
      getConversationKeys,
      getMessageIdentity,
      reconcile,
      remember,
    };
  }

  const api = { create };
  global.SoftoraMailboxComposeAcceptedSend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
