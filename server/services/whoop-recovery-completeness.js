function isCompleteRecoveryRecord(record) {
  return record?.source_type === 'recovery' && ['SCORED', 'UNSCORABLE'].includes(record.score_state);
}

function addIsoDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isIsoDay(value) {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

function latestContiguousRecoveryDay(records, previousCompleteDay = '', options = {}) {
  const completeDays = new Set((records || [])
    .filter(isCompleteRecoveryRecord)
    .map((record) => String(record.local_day || ''))
    .filter(Boolean));
  const mainSleepDays = new Set((records || [])
    .filter((record) => record?.source_type === 'sleep' && record?.summary?.nap !== true)
    .map((record) => String(record.local_day || ''))
    .filter(Boolean));
  const targetDay = isIsoDay(options.targetDay) ? String(options.targetDay) : '';
  const startDay = isIsoDay(options.startDay) ? String(options.startDay) : '';
  const allowHistoricalNoSleepGaps = options.allowHistoricalNoSleepGaps === true && Boolean(targetDay);
  if (completeDays.size === 0 && !allowHistoricalNoSleepGaps) return String(previousCompleteDay || '');

  let latest = String(previousCompleteDay || '');
  if (!latest && options.allowBootstrap !== true) return '';
  let cursor = latest ? addIsoDay(latest, 1) : (startDay || [...completeDays].sort()[0]);
  while (cursor) {
    const hasCompleteRecovery = completeDays.has(cursor);
    const isHistoricalNoSleepDay = allowHistoricalNoSleepGaps
      && cursor < targetDay
      && !mainSleepDays.has(cursor);
    if (!hasCompleteRecovery && !isHistoricalNoSleepDay) break;
    latest = cursor;
    if (targetDay && cursor >= targetDay) break;
    cursor = addIsoDay(cursor, 1);
  }
  return latest;
}

function boundedBackfillStartDay(value, targetDay) {
  const candidate = String(value || '');
  if (!isIsoDay(candidate)) return '';
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

function recoveryProgressOptions(mode, startDay, targetDay) {
  const isBackfill = mode === 'backfill';
  return {
    allowBootstrap: isBackfill,
    allowHistoricalNoSleepGaps: isBackfill,
    startDay,
    targetDay,
  };
}

module.exports = {
  isCompleteRecoveryRecord,
  latestContiguousRecoveryDay,
  queuedSyncOptions,
  recoveryProgressOptions,
};
