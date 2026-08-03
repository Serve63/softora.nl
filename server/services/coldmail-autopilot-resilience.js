'use strict';

async function readUiStateWithRetry(options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 1));
  const getUiStateValues = options.getUiStateValues;
  const sleep = typeof options.sleep === 'function' ? options.sleep : async () => {};
  let state = null;
  let values = {};

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      state = await getUiStateValues(options.scope, options.readOptions || {});
    } catch (_) {
      state = null;
    }
    values = state && typeof state.values === 'object' ? state.values : {};
    const requiredKeyAvailable = !options.requireKey || Object.prototype.hasOwnProperty.call(values, options.key);
    if (state && typeof state.values === 'object' && requiredKeyAvailable) break;
    if (attempt < attempts) await sleep(150 * attempt);
  }

  return { state, values };
}

function createCriticalUiStateReader(options = {}) {
  return (scope, settings = {}) => readUiStateWithRetry({
    attempts: settings.attempts,
    getUiStateValues: options.getUiStateValues,
    key: settings.key,
    readOptions: {
      preferSupabaseRestRead: true,
      ignoreSupabaseRestFailureCooldown: true,
      suppressSupabaseRestFailureCooldown: true,
    },
    requireKey: Boolean(settings.requireKey),
    scope,
    sleep: options.sleep,
  });
}

function compactRepeatedReasons(entries, repeatedReasons = []) {
  const reasons = new Set(Array.isArray(repeatedReasons) ? repeatedReasons : []);
  return (Array.isArray(entries) ? entries : []).reduce((compacted, entry) => {
    const previous = compacted[compacted.length - 1];
    if (previous && previous.reason === entry.reason && reasons.has(entry.reason)) {
      compacted[compacted.length - 1] = entry;
    } else {
      compacted.push(entry);
    }
    return compacted;
  }, []);
}

function createAutopilotLogNormalizer(options = {}) {
  return (entries) => compactRepeatedReasons(
    (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: options.normalizeString(entry.at),
        ok: entry.ok !== false,
        skipped: Boolean(entry.skipped),
        reason: options.truncateText(options.normalizeString(entry.reason), 120),
        message: options.truncateText(options.normalizeString(entry.message), 240),
        sent: Math.max(0, Number(entry.sent || 0) || 0),
        senderEmail: options.normalizeEmailAddress(entry.senderEmail),
      }))
      .filter((entry) => entry.at),
    ['outside_safe_hours', 'outside_weekday_window']
  ).slice(-30);
}

function getDedicatedMailboxSyncResult() {
  return { ok: true, skipped: true, reason: 'dedicated_mailbox_sync_cron' };
}

function summarizeReplySync(value, options = {}) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    ok: value.ok !== false,
    skipped: Boolean(value.skipped),
    reason: options.truncateText(options.normalizeString(value.reason), 120),
  };
}

module.exports = {
  createAutopilotLogNormalizer,
  createCriticalUiStateReader,
  getDedicatedMailboxSyncResult,
  summarizeReplySync,
};
