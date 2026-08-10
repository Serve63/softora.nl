function createMailboxWebdesignOutboundGuard(deps = {}) {
  const {
    buildError,
    normalizeEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
    outboundRecipientGuardStore,
  } = deps;

  function buildConflictError(identity, conflict) {
    const sender = normalizeEmail(conflict && conflict.sender_email);
    const provider = normalizeString(conflict && conflict.provider).toLowerCase();
    const target = normalizeEmail(identity && identity.recipientEmail)
      || normalizeString(identity && identity.recipientCompany)
      || 'deze ontvanger';
    const source = provider === 'instantly'
      ? 'Instantly'
      : sender || 'de centrale outbound duplicate-guard';
    return buildError(
      `Webdesignmail geblokkeerd: ${target} is al eerder vastgezet via ${source}.`,
      'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFLICT',
      409,
      { conflict }
    );
  }

  function isCompleteReservation(result) {
    const actualCount = Number(result && result.count);
    const expectedCount = Number(result && result.expectedCount);
    if (!result || result.ok !== true || !Number.isFinite(actualCount) || actualCount <= 0) return false;
    return !(Number.isFinite(expectedCount) && expectedCount > 0 && actualCount < expectedCount);
  }

  async function reserve(identity, { accountEmail, subject, reservationId } = {}) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.reserveRecipients !== 'function') {
      throw buildError(
        'Centrale outbound duplicate-guard ontbreekt; webdesignmail niet verzonden.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_UNAVAILABLE',
        503
      );
    }
    const reservation = await outboundRecipientGuardStore.reserveRecipients([identity], {
      provider: 'softora', channel: 'mailbox', senderEmail: accountEmail,
      source: 'softora-mailbox-webdesign-pre-send', actor: 'premium-mailbox-send',
      status: 'reserved', permanent: true, reservationId,
      payload: { subject, manualMailboxSend: true },
    });
    if (reservation && reservation.conflict) throw buildConflictError(identity, reservation.conflict);
    if (!isCompleteReservation(reservation)) {
      throw buildError(
        'Centrale outbound duplicate-guard kon niet reserveren; webdesignmail niet verzonden.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_FAILED',
        502
      );
    }
    return reservation;
  }

  async function confirm(reservationId, sentItem = {}) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.confirmReservation !== 'function') {
      throw buildError(
        'Centrale outbound duplicate-guard kan niet permanent worden bevestigd na SMTP-acceptatie.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFIRM_FAILED',
        502
      );
    }
    if (!reservationId) {
      throw buildError(
        'Centrale outbound duplicate-guard mist een reservering na SMTP-acceptatie.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFIRM_FAILED',
        502
      );
    }
    const confirmation = await outboundRecipientGuardStore.confirmReservation(reservationId, {
      status: 'sent', permanent: true,
      payload: {
        messageId: sentItem.messageId, email: sentItem.email,
        subject: sentItem.subject, manualMailboxSend: true,
      },
    });
    if (!confirmation || confirmation.ok !== true || Number(confirmation.count || 0) <= 0) {
      throw buildError(
        'Centrale outbound duplicate-guard bevestigde geen bestaande reservering na SMTP-acceptatie.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFIRM_FAILED',
        502
      );
    }
  }

  async function release(reservationId) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.releaseReservation !== 'function') {
      throw buildError(
        'Centrale outbound duplicate-guard kan niet veilig worden vrijgegeven.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_RELEASE_FAILED',
        503
      );
    }
    const result = await outboundRecipientGuardStore.releaseReservation(reservationId);
    if (!result || result.ok !== true) {
      throw buildError(
        'Centrale outbound duplicate-guard gaf de reservering niet vrij.',
        'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_RELEASE_FAILED',
        503
      );
    }
  }

  return { confirm, release, reserve };
}

module.exports = { createMailboxWebdesignOutboundGuard };
