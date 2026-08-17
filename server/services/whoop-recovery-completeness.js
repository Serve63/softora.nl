function isCompleteRecoveryRecord(record) {
  return record?.source_type === 'recovery' && ['SCORED', 'UNSCORABLE'].includes(record.score_state);
}

function addIsoDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function latestContiguousRecoveryDay(records, previousCompleteDay = '') {
  const completeDays = new Set((records || [])
    .filter(isCompleteRecoveryRecord)
    .map((record) => String(record.local_day || ''))
    .filter(Boolean));
  if (completeDays.size === 0) return String(previousCompleteDay || '');

  let latest = String(previousCompleteDay || '');
  let cursor = latest ? addIsoDay(latest, 1) : [...completeDays].sort()[0];
  while (completeDays.has(cursor)) {
    latest = cursor;
    cursor = addIsoDay(cursor, 1);
  }
  return latest;
}

module.exports = { isCompleteRecoveryRecord, latestContiguousRecoveryDay };
