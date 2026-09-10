// The list and KPI are one read-only snapshot; never infer delivery from a customer status.
async function getColdmailStatsResponse(service, includeRecipients = false) {
  if (!includeRecipients) return service.getColdmailLiveStats();
  const [payload, register] = await Promise.all([
    service.getColdmailLiveStats(), service.getColdmailSentRegister(),
  ]);
  if (!register.available || !Array.isArray(register.recipients)) {
    throw new Error('Het verzendregister is tijdelijk niet beschikbaar.');
  }
  const total = register.recipients.length;
  const today = Object.keys(register.todayRecipientCounts || {}).length;
  return { ...payload, stats: { ...payload.stats,
    reliable: true, source: 'central-outbound-recipient-guard', authoritativeStatsReliable: true, authoritativeStatsStale: false,
    authoritativeStatsSource: 'central-outbound-recipient-guard',
    centralGuardStatsAvailable: true, centralGuardTotalSent: total,
    systemTotalSent: total, totalSent: total, webdesignTotalSent: total,
    centralGuardSentToday: today, systemSentToday: today, sentToday: today, webdesignSentToday: today,
    sentRegister: { source: 'central-outbound-recipient-guard', total, recipients: register.recipients },
  } };
}
module.exports = { getColdmailStatsResponse };
