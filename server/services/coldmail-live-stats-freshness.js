function finiteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeMonotonicCurrentDayStats(payload, currentDayPayload, updatedAt) {
  const base = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  const fresh = currentDayPayload && currentDayPayload.stats && typeof currentDayPayload.stats === 'object'
    ? currentDayPayload.stats
    : {};
  if (!fresh.reliable || !fresh.dateKey || fresh.dateKey !== base.dateKey) return payload;
  const previousToday = finiteCount(base.centralGuardSentToday ?? base.systemSentToday ?? base.sentToday) || 0;
  const freshToday = finiteCount(fresh.centralGuardSentToday ?? fresh.systemSentToday ?? fresh.sentToday);
  if (freshToday === null) return payload;
  const previousTimestampModel = String(base.sentTimestampModel || '').trim();
  const freshTimestampModel = String(fresh.sentTimestampModel || '').trim();
  const timestampModelChanged = Boolean(
    freshTimestampModel && freshTimestampModel !== previousTimestampModel
  );
  const sentToday = timestampModelChanged ? freshToday : Math.max(previousToday, freshToday);
  const delta = timestampModelChanged ? 0 : Math.max(0, sentToday - previousToday);
  const freshLastSentAt = timestampModelChanged
    ? fresh.lastSuccessfulSendAt || ''
    : fresh.lastSuccessfulSendAt &&
        timestamp(fresh.lastSuccessfulSendAt) > timestamp(base.lastSuccessfulSendAt)
      ? fresh.lastSuccessfulSendAt
      : base.lastSuccessfulSendAt;
  const freshLastSenderEmail = timestampModelChanged
    ? fresh.lastSenderEmail || ''
    : freshLastSentAt === fresh.lastSuccessfulSendAt
      ? fresh.lastSenderEmail || base.lastSenderEmail
      : base.lastSenderEmail;
  const changed = timestampModelChanged || delta > 0 ||
    freshLastSentAt !== base.lastSuccessfulSendAt ||
    freshLastSenderEmail !== base.lastSenderEmail;
  if (!changed) return payload;
  const totalFields = ['centralGuardTotalSent', 'systemTotalSent', 'totalSent', 'webdesignTotalSent'];
  const stats = {
    ...base,
    sentToday,
    systemSentToday: sentToday,
    centralGuardSentToday: sentToday,
    webdesignSentToday: sentToday,
    sentTimestampModel: freshTimestampModel || previousTimestampModel,
    lastSuccessfulSendAt: freshLastSentAt,
    lastSenderEmail: freshLastSenderEmail,
    reliable: true,
    authoritativeStatsStale: false,
    updatedAt,
  };
  totalFields.forEach((field) => {
    const value = finiteCount(base[field]);
    if (value !== null) stats[field] = value + delta;
  });
  return { ...(payload || {}), ok: true, stats };
}

module.exports = { mergeMonotonicCurrentDayStats };
