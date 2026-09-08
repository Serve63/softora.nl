const { summarizeMailboxBounceStats } = require('./coldmail-bounce-stats');
const { MAX_EXACT_RECIPIENT_EMAIL_FILTERS } = require('./outbound-recipient-guard-store');

async function loadMatchedColdmailBounceStats(candidates, { store, summarizeSentGroups, ...summaryOptions }) {
  const unavailable = (reason) => ({ available: false, reliable: false, unavailableReason: reason });
  if (!candidates || candidates.available !== true) return unavailable(candidates && candidates.unavailableReason || 'mailbox_bounce_read_failed');
  const preliminary = summarizeMailboxBounceStats(candidates.messages, summaryOptions);
  const recipientEmails = preliminary.bounceRecords.map((record) => record.email);
  const sentRecipientCounts = {};
  try {
    // Match only these bounce recipients. The all-mail KPI's rolling scan limit
    // cannot remove historical delivery proof from the lifetime bounce count.
    for (let offset = 0; offset < recipientEmails.length; offset += MAX_EXACT_RECIPIENT_EMAIL_FILTERS) {
      if (!store || typeof store.listSentRecipientGroups !== 'function') return unavailable('bounce_recipient_proof_unavailable');
      const groups = await store.listSentRecipientGroups({
        provider: 'softora', channel: 'coldmail', keyType: 'email',
        recipientEmails: recipientEmails.slice(offset, offset + MAX_EXACT_RECIPIENT_EMAIL_FILTERS),
      });
      if (!Array.isArray(groups)) return unavailable('bounce_recipient_proof_incomplete');
      Object.assign(sentRecipientCounts, summarizeSentGroups(groups).recipientCounts);
    }
    return { ...summarizeMailboxBounceStats(candidates.messages, {
      ...summaryOptions, sentRecipientCounts, requireSentRecipientMatch: true,
    }), available: true, reliable: true, unavailableReason: '' };
  } catch (_) {
    return unavailable('bounce_recipient_proof_read_failed');
  }
}

module.exports = { loadMatchedColdmailBounceStats };
