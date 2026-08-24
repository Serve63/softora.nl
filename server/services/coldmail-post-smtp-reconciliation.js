const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const EVIDENCE_WINDOW_BEFORE_MS = 10 * 60 * 1000;
const EVIDENCE_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;

function text(value) {
  return String(value || '').trim();
}

function email(value) {
  const match = text(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match ? match[0] : '';
}

function emails(value) {
  return Array.from(new Set((String(value || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || []).map(email).filter(Boolean)));
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSubject(value) {
  return text(value).replace(/\s+/g, ' ').toLowerCase();
}

function messageSource(message) {
  return [
    message && message.subject,
    message && message.preview,
    message && message.body_text,
    message && message.payload ? JSON.stringify(message.payload) : '',
  ].map(text).filter(Boolean).join('\n');
}

function messageRecipients(message) {
  const payload = message && message.payload && typeof message.payload === 'object' ? message.payload : {};
  return emails([
    message && message.recipients_text,
    payload.to,
    payload.toDisplay,
    payload.recipients,
  ].join(' '));
}

function getPendingPayload(group) {
  return group && group.payload && typeof group.payload === 'object' ? group.payload : {};
}

function isReconciliationCandidate(group) {
  const payload = getPendingPayload(group);
  const status = text(group && group.status).toLowerCase();
  return text(group && group.source).toLowerCase() === 'softora-coldmail-pre-send' &&
    (status === 'reserved' || (status === 'sent' && payload.postSmtpReconciled === false));
}

function matchesSentEvidence(group, message) {
  const payload = getPendingPayload(group);
  const senderEmail = email(group && group.sender_email);
  const recipientEmail = email(group && group.recipient_email);
  if (text(message && message.folder).toLowerCase() !== 'sent') return false;
  if (!senderEmail || email(message && message.account_email) !== senderEmail) return false;
  if (!recipientEmail || !messageRecipients(message).includes(recipientEmail)) return false;
  const reservedAt = timestamp(group && (group.created_at || group.updated_at || group.last_seen_at));
  const sentAt = timestamp(message && (message.date || message.internal_date));
  if (!reservedAt || !sentAt || sentAt < reservedAt - EVIDENCE_WINDOW_BEFORE_MS || sentAt > reservedAt + EVIDENCE_WINDOW_AFTER_MS) {
    return false;
  }
  const expectedSubject = normalizeSubject(payload.expectedSubject);
  if (expectedSubject && normalizeSubject(message && message.subject) !== expectedSubject) return false;
  const reference = text(payload.reference);
  if (reference && !messageSource(message).includes(reference)) return false;
  if (!reference && !expectedSubject && !/kleine vraag over jullie website/i.test(text(message && message.subject))) return false;
  return true;
}

function evidenceFromMessage(group, message) {
  const payload = getPendingPayload(group);
  return {
    ...payload,
    reservationId: text(group && group.reservation_id),
    customerId: text(payload.customerId || (group && group.recipient_id)),
    bedrijf: text(payload.bedrijf || (group && group.recipient_company)),
    senderEmail: email(group && group.sender_email),
    recipientEmail: email(group && group.recipient_email),
    subject: text(message && message.subject),
    messageId: text(message && message.message_id),
    providerId: text(message && message.provider_id),
    sentAt: new Date(timestamp(message && (message.date || message.internal_date))).toISOString(),
    postSmtpEvidence: 'mailbox-sent-exact-recipient-sender-time',
  };
}

function buildGuardPayload(evidence, reconciled, at) {
  return {
    customerId: text(evidence && evidence.customerId),
    bedrijf: text(evidence && evidence.bedrijf),
    expectedSubject: text(evidence && (evidence.expectedSubject || evidence.subject)),
    reference: text(evidence && evidence.reference),
    durationDays: Number(evidence && evidence.durationDays) || 0,
    specialAction: text(evidence && evidence.specialAction),
    actor: text(evidence && evidence.actor),
    messageId: text(evidence && evidence.messageId),
    sendIntentId: text(evidence && evidence.sendIntentId),
    providerId: text(evidence && evidence.providerId),
    recipientEmail: email(evidence && evidence.recipientEmail),
    senderEmail: email(evidence && evidence.senderEmail),
    sentAt: text(evidence && evidence.sentAt),
    postSmtpEvidence: text(evidence && evidence.postSmtpEvidence) || 'smtp-accepted',
    postSmtpReconciled: reconciled,
    reconciledAt: reconciled ? at : '',
  };
}

function assertConfirmation(result) {
  if (result && result.ok === true && Number(result.count || 0) > 0) return result;
  const error = new Error('Centrale ontvanger-guard bevestigde de bewezen verzending niet.');
  error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
  throw error;
}

function createColdmailPostSmtpReconciliation(deps = {}) {
  const {
    outboundRecipientGuardStore,
    dataOpsStore,
    getSenderEmails = () => [],
    finalizeProvenance = async () => true,
    loadAcceptedProvenance = async () => null,
    finalizeEvidence = async () => true,
    now = () => new Date(),
    logger = console,
  } = deps;

  async function setGuardState(evidence, reconciled) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.confirmReservation !== 'function') {
      const error = new Error('Centrale ontvanger-guard is niet beschikbaar.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
      throw error;
    }
    const at = now().toISOString();
    try {
      return assertConfirmation(await outboundRecipientGuardStore.confirmReservation(evidence.reservationId, {
        status: 'sent',
        permanent: true,
        at: reconciled && evidence.sentAt ? evidence.sentAt : at,
        payload: buildGuardPayload(evidence, reconciled, at),
      }));
    } catch (cause) {
      const error = new Error('Centrale outbound duplicate-guard kon niet permanent worden bevestigd na SMTP-acceptatie; coldmailing gepauzeerd.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
      error.cause = cause;
      throw error;
    }
  }

  async function persistAcceptedSend(evidence = {}) {
    const normalized = {
      ...evidence,
      reservationId: text(evidence.reservationId),
      senderEmail: email(evidence.senderEmail),
      recipientEmail: email(evidence.recipientEmail),
      sentAt: text(evidence.sentAt) || now().toISOString(),
      postSmtpEvidence: text(evidence.postSmtpEvidence) || 'smtp-accepted',
    };
    await finalizeProvenance(normalized);
    await setGuardState(normalized, false);
    await finalizeEvidence(normalized);
    await setGuardState(normalized, true);
    return { ok: true, reconciled: true, evidence: normalized };
  }

  async function loadPendingGroups(maxRows) {
    if (!outboundRecipientGuardStore) return [];
    const options = {
      provider: 'softora',
      channel: 'coldmail',
      keyType: 'email',
      maxRows,
      updatedSince: new Date(now().getTime() - DEFAULT_LOOKBACK_MS).toISOString(),
    };
    const [reserved, sent] = await Promise.all([
      typeof outboundRecipientGuardStore.listReservedRecipientGroups === 'function'
        ? outboundRecipientGuardStore.listReservedRecipientGroups(options)
        : [],
      typeof outboundRecipientGuardStore.listSentRecipientGroups === 'function'
        ? outboundRecipientGuardStore.listSentRecipientGroups(options)
        : [],
    ]);
    return [...reserved, ...sent].filter(isReconciliationCandidate).slice(0, maxRows);
  }

  async function reconcilePending(options = {}) {
    const maxRows = Math.max(1, Math.min(250, Number(options.maxRows) || 100));
    const groups = await loadPendingGroups(maxRows);
    if (!groups.length) return { ok: true, checked: 0, reconciled: 0, unresolved: 0, errors: [] };
    const acceptedProvenanceByReservation = new Map();
    await Promise.all(groups.map(async (group) => {
      const reservationId = text(group && group.reservation_id);
      if (!reservationId) return;
      try {
        const evidence = await loadAcceptedProvenance({
          reservationId,
          senderEmail: email(group && group.sender_email),
          recipientEmail: email(group && group.recipient_email),
        });
        if (evidence) acceptedProvenanceByReservation.set(reservationId, evidence);
      } catch (error) {
        logger.warn('[Coldmail][accepted-provenance-read]', {
          reservationId,
          error: text(error && error.message),
        });
      }
    }));
    const needsMailboxEvidence = groups.some((group) => {
      const payload = getPendingPayload(group);
      return !acceptedProvenanceByReservation.has(text(group && group.reservation_id)) &&
        (text(group && group.status).toLowerCase() !== 'sent' || !payload.messageId);
    });
    const accountEmails = Array.from(new Set(getSenderEmails().map(email).filter(Boolean)));
    const messages = needsMailboxEvidence && dataOpsStore && typeof dataOpsStore.listMailboxMessages === 'function'
      ? await dataOpsStore.listMailboxMessages({
          accountEmails,
          folders: ['sent'],
          maxRows: 1000,
          bypassReadCache: true,
          bypassReadFailureCooldown: true,
          suppressReadFailureCooldown: true,
          suppressTransientReadFailureLog: true,
        })
      : null;
    const sentMessages = Array.isArray(messages) ? messages : [];
    const result = { ok: true, checked: groups.length, reconciled: 0, unresolved: 0, errors: [] };
    for (const group of groups) {
      try {
        const payload = getPendingPayload(group);
        const reservationId = text(group && group.reservation_id);
        let evidence = acceptedProvenanceByReservation.has(reservationId)
          ? { ...payload, ...acceptedProvenanceByReservation.get(reservationId), reservationId }
          : text(group && group.status).toLowerCase() === 'sent' && payload.messageId
          ? { ...payload, reservationId: text(group.reservation_id) }
          : null;
        if (!evidence) {
          const matches = sentMessages.filter((message) => matchesSentEvidence(group, message));
          if (matches.length !== 1) {
            result.unresolved += 1;
            continue;
          }
          evidence = evidenceFromMessage(group, matches[0]);
        }
        await persistAcceptedSend(evidence);
        result.reconciled += 1;
      } catch (error) {
        result.ok = false;
        result.errors.push({
          reservationId: text(group && group.reservation_id),
          error: text(error && error.message),
        });
        logger.warn('[Coldmail][post-smtp-reconcile]', result.errors[result.errors.length - 1]);
      }
    }
    return result;
  }

  return { persistAcceptedSend, reconcilePending };
}

module.exports = {
  buildGuardPayload,
  createColdmailPostSmtpReconciliation,
  evidenceFromMessage,
  isReconciliationCandidate,
  matchesSentEvidence,
};
