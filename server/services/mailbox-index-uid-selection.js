const {
  classifyMailboxImapQuarantineRow,
} = require('./mailbox-imap-quarantine-policy');

function createMailboxIndexUidSelection({
  run,
  tableName,
  pageSize = 1000,
  normalizeEmail,
  normalizeFolder,
  normalizeString,
  now = () => new Date(),
} = {}) {
  async function listMessageUidSyncStateForAccount({
    accountEmail, folder = 'inbox', since = '', limit = 5000, signal,
  } = {}) {
    const normalizedAccount = normalizeEmail(accountEmail);
    if (!normalizedAccount) {
      return {
        indexedUids: [],
        deferredQuarantineUids: [],
        retryDueQuarantineUids: [],
      };
    }
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = Math.max(1, Math.min(10_000, Math.floor(Number(limit) || 5000)));
    const rows = [];
    for (let offset = 0; offset < safeLimit; offset += pageSize) {
      const currentPageSize = Math.min(pageSize, safeLimit - offset);
      const result = await run(
        `list-message-uids-for-account:${normalizedFolder}:${offset}`,
        (client) => {
          let query = client
            .from(tableName)
            .select('uid,payload')
            .eq('account_email', normalizedAccount)
            .eq('folder', normalizedFolder)
            .is('deleted_at', null)
            .order('uid', { ascending: false });
          if (normalizeString(since)) query = query.gte('date', normalizeString(since));
          return query.range(offset, offset + currentPageSize - 1);
        },
        { signal }
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);
      if (page.length < currentPageSize) break;
    }

    const nowMs = now().getTime();
    const stateByUid = new Map();
    rows.forEach((row) => {
      const uid = Number(row?.uid);
      if (!Number.isSafeInteger(uid) || uid <= 0) return;
      const state = classifyMailboxImapQuarantineRow(row, nowMs);
      const current = stateByUid.get(uid);
      if (
        !current ||
        state === 'retry_due' ||
        (state === 'retry_deferred' && current === 'indexed')
      ) stateByUid.set(uid, state);
    });
    const indexedUids = [];
    const deferredQuarantineUids = [];
    const retryDueQuarantineUids = [];
    stateByUid.forEach((state, uid) => {
      if (state === 'retry_due') retryDueQuarantineUids.push(uid);
      else {
        indexedUids.push(uid);
        if (state === 'retry_deferred') deferredQuarantineUids.push(uid);
      }
    });
    return { indexedUids, deferredQuarantineUids, retryDueQuarantineUids };
  }

  async function listMessageUidsForAccount(options = {}) {
    const state = await listMessageUidSyncStateForAccount(options);
    return state ? state.indexedUids : null;
  }

  return { listMessageUidSyncStateForAccount, listMessageUidsForAccount };
}

module.exports = { createMailboxIndexUidSelection };
