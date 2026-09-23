const { amsterdamDateKey, buildReadModelVersion } = require('./readmodel-version-response');

const SENT_REGISTER_READ_MODEL = 'coldmail-sent-register';
const SENT_REGISTER_SOURCE_TABLE = 'softora_outbound_recipient_guards';

function buildSentRegisterFields(register) {
  const total = register.recipients.length;
  const today = Object.keys(register.todayRecipientCounts || {}).length;
  return {
    reliable: true, source: 'central-outbound-recipient-guard', authoritativeStatsReliable: true, authoritativeStatsStale: false,
    authoritativeStatsSource: 'central-outbound-recipient-guard',
    centralGuardStatsAvailable: true, centralGuardTotalSent: total,
    systemTotalSent: total, totalSent: total, webdesignTotalSent: total,
    centralGuardSentToday: today, systemSentToday: today, sentToday: today, webdesignSentToday: today,
    sentRegister: { source: 'central-outbound-recipient-guard', total, recipients: register.recipients },
  };
}

// The list and KPI are one read-only snapshot; never infer delivery from a customer status.
async function getColdmailStatsResponse(service, includeRecipients = false, timings = null, options = {}) {
  if (!includeRecipients) return service.getColdmailLiveStats();
  const { readTableVersions = null, requestedVersion = '', now = () => new Date() } = options;
  const timedRead = async (name, read) => {
    const startedAt = Date.now();
    try { return await read(); }
    finally { if (timings) timings[name] = Math.max(0, Date.now() - startedAt); }
  };
  const readRegisterVersion = async () => {
    if (typeof readTableVersions !== 'function') return '';
    const versions = await Promise.resolve(readTableVersions([SENT_REGISTER_SOURCE_TABLE])).catch(() => null);
    const tableVersion = versions && versions[SENT_REGISTER_SOURCE_TABLE];
    // "Today" counts change at midnight in Amsterdam without any table write.
    return tableVersion ? buildReadModelVersion([SENT_REGISTER_READ_MODEL, tableVersion, amsterdamDateKey(now())]) : '';
  };
  // The version is read before the register, so a browser copy can never be
  // stored under a version that is newer than its rows.
  const [payload, registerVersion] = await Promise.all([
    timedRead('live', () => service.getColdmailLiveStats()),
    timedRead('version', readRegisterVersion),
  ]);
  if (registerVersion && requestedVersion === registerVersion) {
    return { ...payload, stats: { ...payload.stats,
      readModel: { key: SENT_REGISTER_READ_MODEL, version: registerVersion, unchanged: true } } };
  }
  const register = await timedRead('register', () => service.getColdmailSentRegister());
  if (!register.available || !Array.isArray(register.recipients)) {
    throw new Error('Het verzendregister is tijdelijk niet beschikbaar.');
  }
  const fields = buildSentRegisterFields(register);
  return { ...payload, stats: { ...payload.stats, ...fields,
    ...(registerVersion ? { readModel: { key: SENT_REGISTER_READ_MODEL, version: registerVersion,
      unchanged: false, fields: Object.keys(fields) } } : {}),
  } };
}
module.exports = { getColdmailStatsResponse, SENT_REGISTER_READ_MODEL, SENT_REGISTER_SOURCE_TABLE };
