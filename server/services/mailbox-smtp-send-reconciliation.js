const { createMailboxRecipientFingerprint } = require('./mailbox-send-provenance-store');

const text = (value) => String(value || '').trim();
const email = (value) => text(value).toLowerCase();
const messageId = (value) => text(value).replace(/^<+|>+$/g, '');

function addresses(value) {
  const result = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'object') return visit(item.address || item.email || item.value);
    (String(item).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .forEach((address) => result.push(address.toLowerCase()));
  };
  visit(value);
  return Array.from(new Set(result)).sort().join(',');
}

async function prepareSmtpSendReconciliation({
  store, accountEmail, releaseOutboundGuard, logger = console,
}) {
  const state = { checked: false, degraded: false, intents: [], reapedUndispatched: 0 };
  if (!store) return state;
  if (typeof store.listReconcileRequired !== 'function') return { ...state, degraded: true };
  try {
    const expired = typeof store.listExpiredUndispatched === 'function' &&
      typeof store.abandonUndispatched === 'function'
      ? await store.listExpiredUndispatched({ accountEmails: [accountEmail], limit: 25 })
      : [];
    for (const intent of expired) {
      const abandoned = await store.abandonUndispatched(intent.intentId);
      if (!abandoned?.abandoned) continue;
      state.reapedUndispatched += 1;
      if (intent.outboundGuardRequired) {
        if (typeof releaseOutboundGuard !== 'function') {
          state.degraded = true;
          continue;
        }
        try {
          await releaseOutboundGuard(intent.intentId);
        } catch (error) {
          state.degraded = true;
          logger.error('[Mailbox][SmtpUndispatchedGuardRelease]', error?.message || error);
        }
      }
    }
    state.intents = await store.listReconcileRequired({
      accountEmails: [accountEmail], provider: 'smtp', limit: 25,
    });
    state.checked = true;
  } catch (error) {
    state.degraded = true;
    logger.error('[Mailbox][SmtpReconcileList]', error?.message || error);
  }
  return state;
}

function findExactSmtpSentReconciliation(intent = {}, messages = []) {
  const intentAt = Date.parse(intent.createdAt);
  const recipientFingerprint = createMailboxRecipientFingerprint({
    to: intent.recipientEmail, cc: intent.cc, bcc: intent.bcc,
  });
  const candidates = (Array.isArray(messages) ? messages : []).filter((candidate) => {
    const sentAt = Date.parse(candidate.date || candidate.receivedAt);
    return Boolean(
      text(candidate.folder).toLowerCase() === 'sent' &&
      email(candidate.accountEmail) === email(intent.accountEmail) &&
      text(candidate.softoraSendIntentId) === text(intent.intentId) &&
      text(candidate.softoraRecipientFingerprint) === recipientFingerprint &&
      Boolean(text(intent.payloadFingerprint)) &&
      text(candidate.softoraPayloadFingerprint) === text(intent.payloadFingerprint) &&
      text(candidate.softoraSendMode).toLowerCase() === text(intent.mode).toLowerCase() &&
      text(candidate.softoraConversationId) === text(intent.conversationId) &&
      text(candidate.softoraReplyTargetMessageId) === text(intent.replyTargetMessageId) &&
      addresses(candidate.to) === email(intent.recipientEmail) && addresses(candidate.cc) === addresses(intent.cc) &&
      text(candidate.subject) === text(intent.subject) &&
      Number.isFinite(intentAt) && Number.isFinite(sentAt) &&
      sentAt >= intentAt - 120_000 && sentAt <= intentAt + 15 * 60_000
    );
  });
  const unique = Array.from(new Map(candidates.map((candidate) => [
    [messageId(candidate.messageId), text(candidate.softoraSendIntentId),
      text(candidate.softoraRecipientFingerprint), text(candidate.softoraPayloadFingerprint),
      text(candidate.subject)].join('|'), candidate,
  ])).values());
  return unique.length === 1 && messageId(unique[0].messageId) === messageId(intent.messageId)
    ? unique[0] : null;
}

async function reconcileSmtpSendIntents({ state, messages, store, confirmOutboundGuard, logger = console }) {
  let intents = state.intents.slice();
  let degraded = state.degraded;
  let reconciled = 0;
  for (const intent of intents.slice()) {
    const match = findExactSmtpSentReconciliation(intent, messages);
    if (!match) continue;
    let guardPending = Boolean(intent.outboundGuardRequired && (
      intent.status !== 'accepted' || intent.outboundGuardReconcileRequired
    ));
    if (guardPending && typeof confirmOutboundGuard === 'function') {
      try {
        await confirmOutboundGuard(intent.intentId, {
          messageId: match.messageId, email: intent.recipientEmail, subject: intent.subject,
        });
        guardPending = false;
      } catch (error) {
        degraded = true;
        logger.error('[Mailbox][SmtpReconcileGuard]', error?.message || error);
      }
    }
    try {
      await store.accept(intent.intentId, {
        messageId: match.messageId, acceptedAt: match.date || match.receivedAt,
        accepted: intent.accepted, rejected: intent.rejected,
        storageDegraded: guardPending, reconcileRequired: guardPending,
        outboundGuardReconcileRequired: guardPending, sentReconcileRequired: false,
      });
      if (!guardPending) {
        intents = intents.filter((candidate) => candidate.intentId !== intent.intentId);
        reconciled += 1;
      }
    } catch (error) {
      degraded = true;
      logger.error('[Mailbox][SmtpReconcileAccept]', error?.message || error);
    }
  }
  return { checked: state.checked, degraded, intents, reconciled };
}

function smtpReconciliationHealth(state) {
  const remaining = state.checked ? state.intents.length : null;
  return {
    smtpReconciliationChecked: state.checked,
    smtpReconciliationDegraded: state.degraded || Number(remaining) > 0,
    remainingSmtpReconcileCount: remaining,
    ...(Number(state.reapedUndispatched) > 0
      ? { reapedUndispatchedSendCount: Number(state.reapedUndispatched) } : {}),
  };
}

module.exports = {
  findExactSmtpSentReconciliation, prepareSmtpSendReconciliation,
  reconcileSmtpSendIntents, smtpReconciliationHealth,
};
