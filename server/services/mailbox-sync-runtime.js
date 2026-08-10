const crypto = require('crypto');

const MAILBOX_SYNC_FAST_FOLDER_TIMEOUT_MS = 10_000;
const MAILBOX_SYNC_FAST_RUN_TIMEOUT_MS = 22_000;
const MAILBOX_SYNC_CRON_FOLDER_TIMEOUT_MS = 25_000;
const MAILBOX_SYNC_CRON_RUN_TIMEOUT_MS = 300_000;
const MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS = 25_000;
const MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MAILBOX_IMAP_CONNECTION_TIMEOUT_MS = 8_000;
const MAILBOX_IMAP_GREETING_TIMEOUT_MS = 8_000;
const MAILBOX_IMAP_SOCKET_TIMEOUT_MS = 15_000;

function createMailboxSyncRunId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function getMailboxSyncDeadlineError(code = 'MAILBOX_SYNC_RUN_TIMEOUT') {
  const folderTimeout = code === 'MAILBOX_SYNC_FOLDER_TIMEOUT';
  const error = new Error(folderTimeout ? 'Mailbox-map deadline verstreken.' : 'Mailbox-sync deadline verstreken.');
  error.code = code;
  error.status = 504;
  error.timedOut = true;
  return error;
}

function getAbortReason(signal, fallbackCode) {
  if (signal && signal.aborted && signal.reason instanceof Error) return signal.reason;
  return getMailboxSyncDeadlineError(fallbackCode);
}

function createDeadlineController({ deadlineAt, parentSignal, timeoutCode } = {}) {
  const controller = new AbortController();
  const absoluteDeadline = Number(deadlineAt) || Date.now();
  const abortFromParent = () => controller.abort(getAbortReason(parentSignal, 'MAILBOX_SYNC_RUN_TIMEOUT'));
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const remainingMs = Math.max(0, absoluteDeadline - Date.now());
  const timeoutId = remainingMs > 0
    ? setTimeout(() => controller.abort(getMailboxSyncDeadlineError(timeoutCode)), remainingMs)
    : null;
  if (!remainingMs && !controller.signal.aborted) {
    controller.abort(getMailboxSyncDeadlineError(timeoutCode));
  }
  return {
    deadlineAt: absoluteDeadline,
    signal: controller.signal,
    cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    },
  };
}

function summarizeMailboxSyncResults(results = []) {
  const source = Array.isArray(results) ? results : [];
  const summary = {
    total: source.length,
    succeeded: source.filter((result) => result && result.complete === true).length,
    locked: source.filter((result) => result && result.reason === 'locked').length,
    failed: source.filter((result) => result && result.ok === false).length,
    timedOut: source.filter((result) => result && result.timedOut === true).length,
    skipped: source.filter((result) => result && result.skipped === true).length,
  };
  const complete = summary.total > 0 && summary.failed === 0 && summary.locked === 0 && source.every((result) => result?.complete === true);
  const freshnessConfirmed = complete && source.every((result) => result?.freshnessConfirmed === true);
  const accepted = summary.total > 0 && summary.locked === summary.total;
  let statusCode = 200;
  if (accepted) statusCode = 202;
  else if (summary.succeeded > 0 && !complete) statusCode = 207;
  else if (summary.succeeded === 0 && summary.timedOut > 0) statusCode = 504;
  else if (summary.succeeded === 0 && summary.failed > 0) statusCode = 503;
  else if (!complete) statusCode = 207;
  return {
    ok: summary.failed === 0,
    complete,
    freshnessConfirmed,
    accepted,
    statusCode,
    summary,
  };
}

function getMailboxSyncResponseStatus(result = {}) {
  const explicitStatus = Number(result?.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 200 && explicitStatus <= 599) {
    return explicitStatus;
  }
  if (result?.accepted === true) return 202;
  if (result?.ok === false) return 503;
  if (result?.complete === false || result?.freshnessConfirmed === false) return 207;
  return 200;
}

function createMailboxSyncStateStore({
  run,
  normalizeEmail,
  normalizeFolder,
  normalizeString,
  truncateText,
  now,
  tableName,
  defaultLockTtlMs = 90_000,
} = {}) {
  const buildSyncKey = (accountEmail, folder) => `${normalizeEmail(accountEmail)}|${normalizeFolder(folder)}`;
  const isoNow = () => now().toISOString();

  async function acquireSyncLock({ accountEmail, folder = 'inbox', force = false, lockTtlMs = defaultLockTtlMs, signal }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const lockToken = createMailboxSyncRunId();
    const result = await run('acquire-sync-lock', (client) => client.rpc('softora_claim_mailbox_sync_lock', {
      p_sync_key: syncKey,
      p_account_email: normalizeEmail(accountEmail),
      p_folder: normalizeFolder(folder),
      p_lock_token: lockToken,
      p_lock_ttl_seconds: Math.max(10, Math.min(300, Math.ceil((Number(lockTtlMs) || defaultLockTtlMs) / 1000))),
      p_force: force === true,
    }), { signal, mutation: true });
    if (!result.ok) return { ok: false, locked: false, syncKey, error: result.error };
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (row?.acquired === true && normalizeString(row.claimed_lock_token) === lockToken) {
      return { ok: true, locked: false, syncKey, lockToken, lockExpiresAt: row.lock_expires_at || null };
    }
    if (row?.locked === true) {
      const lockExpiresAt = normalizeString(row.lock_expires_at) || null;
      return {
        ok: false,
        locked: true,
        syncKey,
        lockExpiresAt,
        lockReason: lockExpiresAt ? 'active_target' : 'global_capacity',
      };
    }
    const error = new Error('Mailbox-lockclaim gaf geen geldige uitkomst.');
    error.code = 'MAILBOX_SYNC_LOCK_CLAIM_FAILED';
    return { ok: false, locked: false, syncKey, error };
  }

  async function finishSync({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    messageCount = 0,
    lastUid = 0,
    error = '',
    warning = '',
    syncedThroughAt = '',
    signal,
  }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const normalizedLockToken = normalizeString(lockToken);
    if (!normalizedLockToken) {
      const missingError = new Error('Mailbox-locktoken ontbreekt bij afronding.');
      missingError.code = 'MAILBOX_SYNC_LOCK_LOST';
      return { ok: false, lockLost: true, error: missingError };
    }
    const failed = Boolean(normalizeString(error));
    const finishedAt = isoNow();
    const requestedSyncedThroughMs = Date.parse(normalizeString(syncedThroughAt));
    const finishedAtMs = Date.parse(finishedAt);
    const lastSyncedAt = Number.isFinite(requestedSyncedThroughMs)
      ? new Date(Math.min(requestedSyncedThroughMs, finishedAtMs)).toISOString()
      : finishedAt;
    const safeLastUid = Math.max(0, Number(lastUid) || 0);
    const patch = failed
      ? {
          status: 'error',
          last_error: truncateText(normalizeString(error), 1000),
          lock_token: null,
          lock_expires_at: null,
          updated_at: finishedAt,
        }
      : {
          status: 'ok',
          last_error: truncateText(normalizeString(warning), 1000) || null,
          message_count: Math.max(0, Number(messageCount) || 0),
          ...(safeLastUid > 0 ? { last_uid: safeLastUid } : {}),
          last_synced_at: lastSyncedAt,
          lock_token: null,
          lock_expires_at: null,
          updated_at: finishedAt,
        };
    const result = await run('finish-sync', (client) => client
      .from(tableName)
      .update(patch)
      .eq('sync_key', syncKey)
      .eq('lock_token', normalizedLockToken)
      .select('sync_key'), { signal, mutation: true });
    if (!result.ok) return result;
    if (Array.isArray(result.data) && result.data.length === 1) return result;
    const lockLostError = new Error('Mailbox-lock is verlopen of door een andere run overgenomen.');
    lockLostError.code = 'MAILBOX_SYNC_LOCK_LOST';
    return { ok: false, lockLost: true, data: result.data, error: lockLostError };
  }

  async function releaseSyncLock({ accountEmail, folder = 'inbox', lockToken = '', status = 'idle', lastError = '', signal }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const normalizedLockToken = normalizeString(lockToken);
    if (!normalizedLockToken) {
      const missingError = new Error('Mailbox-locktoken ontbreekt bij vrijgave.');
      missingError.code = 'MAILBOX_SYNC_LOCK_LOST';
      return { ok: false, lockLost: true, error: missingError };
    }
    const releasedAt = isoNow();
    const releaseStatus = ['ok', 'error'].includes(normalizeString(status).toLowerCase())
      ? normalizeString(status).toLowerCase()
      : 'idle';
    const result = await run('release-sync-lock', (client) => client
      .from(tableName)
      .update({
        status: releaseStatus,
        lock_token: null,
        lock_expires_at: null,
        last_error: releaseStatus === 'error' ? truncateText(normalizeString(lastError), 1000) || null : null,
        updated_at: releasedAt,
      })
      .eq('sync_key', syncKey)
      .eq('lock_token', normalizedLockToken)
      .select('sync_key'), { signal, mutation: true });
    if (result.ok && Array.isArray(result.data) && result.data.length === 1) return result;
    if (!result.ok) return result;
    const lockLostError = new Error('Mailbox-lock is verlopen of door een andere run overgenomen.');
    lockLostError.code = 'MAILBOX_SYNC_LOCK_LOST';
    return { ok: false, lockLost: true, data: result.data, error: lockLostError };
  }

  async function checkpointSync({
    accountEmail,
    folder = 'inbox',
    lockToken = '',
    expectedRevision = 0,
    outcome = 'checkpoint',
    cursor = '',
    minTimestamp = '',
    messageCount = 0,
    signal,
  } = {}) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const normalizedLockToken = normalizeString(lockToken);
    if (!normalizedLockToken) {
      const missingError = new Error('Mailbox-locktoken ontbreekt bij checkpoint.');
      missingError.code = 'MAILBOX_SYNC_LOCK_LOST';
      return { ok: false, lockLost: true, error: missingError };
    }
    const result = await run('checkpoint-sync', (client) => client.rpc(
      'softora_checkpoint_mailbox_sync',
      {
        p_sync_key: syncKey,
        p_lock_token: normalizedLockToken,
        p_expected_revision: Math.max(0, Number(expectedRevision) || 0),
        p_outcome: normalizeString(outcome).toLowerCase(),
        p_cursor: normalizeString(cursor) || null,
        p_min_timestamp: normalizeString(minTimestamp) || null,
        p_message_count: Math.max(0, Number(messageCount) || 0),
      }
    ), { signal, mutation: true });
    if (!result.ok) return result;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (row?.applied === true && row?.lock_lost !== true) {
      return {
        ok: true,
        continuationCursor: normalizeString(row.continuation_cursor),
        continuationMinTimestamp: normalizeString(row.continuation_min_timestamp),
        continuationRevision: Math.max(0, Number(row.continuation_revision) || 0),
        completed: row.completed === true,
      };
    }
    const lockLostError = new Error('Mailbox-checkpoint verloor zijn lease of CAS-revisie.');
    lockLostError.code = 'MAILBOX_SYNC_LOCK_LOST';
    return { ok: false, lockLost: true, data: result.data, error: lockLostError };
  }

  return { acquireSyncLock, buildSyncKey, checkpointSync, finishSync, releaseSyncLock };
}

module.exports = {
  MAILBOX_IMAP_CONNECTION_TIMEOUT_MS,
  MAILBOX_IMAP_GREETING_TIMEOUT_MS,
  MAILBOX_IMAP_SOCKET_TIMEOUT_MS,
  MAILBOX_SYNC_CRON_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_CRON_RUN_TIMEOUT_MS,
  MAILBOX_SYNC_DEFAULT_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_DEFAULT_RUN_TIMEOUT_MS,
  MAILBOX_SYNC_FAST_FOLDER_TIMEOUT_MS,
  MAILBOX_SYNC_FAST_RUN_TIMEOUT_MS,
  createDeadlineController,
  createMailboxSyncRunId,
  createMailboxSyncStateStore,
  getAbortReason,
  getMailboxSyncResponseStatus,
  getMailboxSyncDeadlineError,
  summarizeMailboxSyncResults,
};
