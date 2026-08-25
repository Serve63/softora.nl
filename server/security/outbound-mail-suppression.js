function normalizeText(value) {
  return String(value || '').trim();
}

function createSuppressionError(message, code, status, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (cause) error.cause = cause;
  return error;
}

async function assertOutboundRecipientsNotSuppressed({
  outboundRecipientGuardStore,
  identities,
  channel = 'outbound-mail',
} = {}) {
  const targets = (Array.isArray(identities) ? identities : [identities])
    .filter((identity) => identity && typeof identity === 'object');
  if (!targets.length) {
    throw createSuppressionError(
      'De ontvangeridentiteit ontbreekt; verzending is veilig gestopt.',
      'OUTBOUND_SUPPRESSION_IDENTITY_REQUIRED',
      503
    );
  }
  if (
    !outboundRecipientGuardStore ||
    typeof outboundRecipientGuardStore.findRecipientSuppressionConflict !== 'function'
  ) {
    throw createSuppressionError(
      'De permanente blokkadelijst is niet beschikbaar; verzending is veilig gestopt.',
      'OUTBOUND_SUPPRESSION_GUARD_UNAVAILABLE',
      503
    );
  }

  let result;
  try {
    result = await outboundRecipientGuardStore.findRecipientSuppressionConflict(targets);
  } catch (cause) {
    throw createSuppressionError(
      'De permanente blokkadelijst kon niet worden gecontroleerd; verzending is veilig gestopt.',
      'OUTBOUND_SUPPRESSION_GUARD_FAILED',
      503,
      cause
    );
  }
  if (!result || result.ok !== true) {
    throw createSuppressionError(
      'De permanente blokkadelijst kon niet worden bevestigd; verzending is veilig gestopt.',
      'OUTBOUND_SUPPRESSION_GUARD_UNAVAILABLE',
      503
    );
  }
  if (result.conflict) {
    const target = normalizeText(
      result.conflict.recipient_company ||
      result.conflict.recipient_email ||
      result.conflict.recipient_domain ||
      'deze ontvanger'
    );
    const error = createSuppressionError(
      `Verzending geblokkeerd: ${target} staat op de permanente blokkadelijst.`,
      'OUTBOUND_RECIPIENT_SUPPRESSED',
      409
    );
    error.channel = normalizeText(channel);
    error.guardKey = normalizeText(result.conflict.guard_key);
    throw error;
  }
  return { ok: true };
}

module.exports = { assertOutboundRecipientsNotSuppressed };
