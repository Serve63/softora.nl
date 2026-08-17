function isCompleteRecoveryRecord(record) {
  return record?.source_type === 'recovery' && ['SCORED', 'UNSCORABLE'].includes(record.score_state);
}

function addIsoDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function latestContiguousRecoveryDay(records, previousCompleteDay = '', options = {}) {
  const completeDays = new Set((records || [])
    .filter(isCompleteRecoveryRecord)
    .map((record) => String(record.local_day || ''))
    .filter(Boolean));
  if (completeDays.size === 0) return String(previousCompleteDay || '');

  let latest = String(previousCompleteDay || '');
  if (!latest && options.allowBootstrap !== true) return '';
  let cursor = latest ? addIsoDay(latest, 1) : [...completeDays].sort()[0];
  while (completeDays.has(cursor)) {
    latest = cursor;
    cursor = addIsoDay(cursor, 1);
  }
  return latest;
}

function boundedBackfillStartDay(value, targetDay) {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) return '';
  if (candidate < addIsoDay(targetDay, -89) || candidate > targetDay) return '';
  return candidate;
}

function queuedSyncOptions(event, targetDay) {
  if (event?.event_type !== 'internal.backfill') return { mode: 'webhook', targetDay };
  const startDay = boundedBackfillStartDay(event.resource_id, targetDay);
  return {
    mode: 'backfill',
    targetDay,
    ...(startDay ? { startDay, resetProgress: true } : {}),
  };
}

module.exports = { isCompleteRecoveryRecord, latestContiguousRecoveryDay, queuedSyncOptions };
