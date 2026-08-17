function createColdmailHistoricalOutboundGuard(deps = {}) {
  const {
    dataOpsStore,
    getConfiguredSenderEmails,
    getAllowedSenderEmails,
    getRowEmail,
    getRowCompany,
    isTestRecipientRow,
    normalizeEmailAddress,
    normalizeContactStatus,
    normalizeString,
  } = deps;

  function guardUnavailable(message) {
    const error = new Error(message);
    error.code = 'COLDMAIL_HISTORICAL_MAILBOX_GUARD_UNAVAILABLE';
    error.status = 503;
    return error;
  }

  function hasPriorOutboundMailSignal(row) {
    if (!row || typeof row !== 'object') return false;
    if (normalizeContactStatus(row.outreachStatus, row) === 'gemaild') return true;
    if (normalizeString(row.lastColdmailSentAt || row.lastMailSentAt || row.outreachSentAt || row.outreach_sent_at)) {
      return true;
    }
    if (normalizeString(row.coldmailSentMessageId || row.outreachMessageId || row.sentMessageId || row.messageId)) {
      return true;
    }
    if (Number(row.coldmailOpenCount || row.outreachOpenCount || 0) > 0) return true;
    if (row.coldmailOpened === true || row.outreachOpened === true) return true;
    return (Array.isArray(row.hist) ? row.hist : []).some((entry) => {
      const text = normalizeString([
        entry && entry.type,
        entry && entry.status,
        entry && entry.label,
        entry && entry.source,
        entry && entry.subject,
        entry && entry.preview,
        entry && entry.messageKey,
      ].join(' ')).toLowerCase();
      return /\b(gemaild|mail verstuurd|coldmail|cold mailing|instantly|email sent|email opened|open tracking)\b/.test(text);
    });
  }

  async function getBlock(item) {
    const row = item && item.row;
    const email = getRowEmail(row);
    if (!email || isTestRecipientRow(row, email)) return null;
    if (
      !dataOpsStore ||
      typeof dataOpsStore.getHistoricalOutboundMailboxCoverageStatus !== 'function' ||
      typeof dataOpsStore.listHistoricalOutboundMailboxMessagesByRecipientEmails !== 'function'
    ) {
      throw guardUnavailable('Historische mailbox duplicate-guard ontbreekt; coldmail niet verzonden.');
    }
    const configuredAccounts = getConfiguredSenderEmails();
    const coverage = await dataOpsStore.getHistoricalOutboundMailboxCoverageStatus({
      accountEmails: configuredAccounts.length ? configuredAccounts : getAllowedSenderEmails(),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    if (!coverage || coverage.ok !== true) {
      throw guardUnavailable(
        'Historische mailbox-index is niet volledig of actueel; coldmail niet verzonden.'
      );
    }
    const messages = await dataOpsStore.listHistoricalOutboundMailboxMessagesByRecipientEmails({
      recipientEmails: [email],
      folders: ['sent', 'coldmail', 'instantly'],
    });
    if (!Array.isArray(messages)) {
      throw guardUnavailable(
        'Historische mailbox kon niet veilig worden gecontroleerd; coldmail niet verzonden.'
      );
    }
    const historicalMessage = messages[0];
    if (!historicalMessage) return null;
    const sender = normalizeEmailAddress(
      historicalMessage.sender_email || historicalMessage.account_email
    );
    return {
      id: item && item.id,
      bedrijf: getRowCompany(row),
      email,
      code: 'COLDMAIL_RECIPIENT_RECENTLY_SENT',
      error: sender
        ? `Dit bedrijf/e-mailadres is al eerder gemaild via ${sender}.`
        : 'Dit bedrijf/e-mailadres is al eerder gemaild.',
    };
  }

  return { getBlock, hasPriorOutboundMailSignal };
}

module.exports = {
  createColdmailHistoricalOutboundGuard,
};
