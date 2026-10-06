'use strict';

// Een Instantly-antwoord waarvan de provider-aanroep afbrak (bijv. timeout) blijft anders
// voor altijd 'unknown' en blokkeert elk nieuw antwoord in die thread. We kijken daarom in
// de Instantly-thread zelf: staat het antwoord er, dan is het verzonden; staat het er na
// een ruime wachttijd aantoonbaar niet, dan is er niets verzonden.
const INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS = 10 * 60 * 1000;
const INSTANTLY_UNKNOWN_REPLY_CLOCK_SKEW_MS = 2 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSubject(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
}

function parseTimeMs(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUnknownInstantlyReply(intent) {
  return intent?.status === 'unknown'
    && intent?.provider === 'instantly'
    && intent?.mode === 'reply'
    && Boolean(normalizeText(intent?.providerThreadId))
    && Boolean(normalizeText(intent?.accountEmail));
}

function findMatchingSentReply(messages, intent, dispatchStartedMs) {
  const accountEmail = normalizeText(intent.accountEmail).toLowerCase();
  const replyTarget = normalizeText(intent.replyTargetMessageId);
  const subject = normalizeSubject(intent.subject);
  return messages.find((message) => (
    message?.direction === 'sent'
    && message.originalCampaignOutbound !== true
    && normalizeText(message.accountEmail).toLowerCase() === accountEmail
    && normalizeText(message.providerThreadId) === normalizeText(intent.providerThreadId)
    && normalizeText(message.providerMessageId) !== replyTarget
    && normalizeSubject(message.subject) === subject
    && parseTimeMs(message.receivedAt || message.date)
      >= dispatchStartedMs - INSTANTLY_UNKNOWN_REPLY_CLOCK_SKEW_MS
  )) || null;
}

function createInstantlyUnknownReplyReconciler({
  instantlyMailboxService,
  mailboxSendProvenanceStore,
  now = () => new Date(),
  logger = console,
} = {}) {
  return async function reconcileUnknownInstantlyReply(intent) {
    if (!isUnknownInstantlyReply(intent)) return intent;
    if (typeof instantlyMailboxService?.listThreadMessages !== 'function'
      || typeof mailboxSendProvenanceStore?.accept !== 'function'
      || typeof mailboxSendProvenanceStore?.resolveUnknownAsNotSent !== 'function') return intent;
    const dispatchStartedMs = parseTimeMs(intent.dispatchStartedAt)
      || parseTimeMs(intent.updatedAt) || parseTimeMs(intent.createdAt);
    if (!dispatchStartedMs) return intent;
    try {
      const messages = await instantlyMailboxService.listThreadMessages({
        threadId: intent.providerThreadId,
        accountEmail: intent.accountEmail,
      });
      if (!Array.isArray(messages)) return intent;
      const sent = findMatchingSentReply(messages, intent, dispatchStartedMs);
      if (sent) {
        const providerMessageId = normalizeText(sent.providerMessageId);
        return await mailboxSendProvenanceStore.accept(intent.intentId, {
          messageId: normalizeText(sent.messageId) || providerMessageId,
          providerMessageId,
          providerThreadId: normalizeText(sent.providerThreadId),
          acceptedAt: normalizeText(sent.receivedAt) || now().toISOString(),
        });
      }
      if (now().getTime() - dispatchStartedMs < INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS) return intent;
      return await mailboxSendProvenanceStore.resolveUnknownAsNotSent(
        intent.intentId,
        'Instantly-thread bevat dit antwoord niet; er is niets verzonden.'
      );
    } catch (error) {
      logger.warn?.('[MailboxSendProvenance][InstantlyUnknownReconcile]', error?.message || error);
      return intent;
    }
  };
}

module.exports = {
  INSTANTLY_UNKNOWN_REPLY_NOT_SENT_AFTER_MS,
  createInstantlyUnknownReplyReconciler,
  findMatchingSentReply,
};
