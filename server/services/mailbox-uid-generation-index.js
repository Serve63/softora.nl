'use strict';

const { deduplicateRowsByKey } = require('./mailbox-index-message-rows');
const { createMailboxSyncFinalizer } = require('./mailbox-sync-finalizer');
const { createMailboxUidValidityStore } = require('./mailbox-uid-validity');

function createMailboxUidGenerationIndex({
  runDurableWrite,
  buildSyncKey,
  buildMessageRow,
  normalizeEmail,
  normalizeFolder,
  normalizeString,
  now,
  messagesTable,
  pageSize = 1000,
} = {}) {
  function buildSyncCommitRows({
    accountEmail,
    folder = 'inbox',
    messages = [],
    uidValidity,
    generationId,
  } = {}) {
    const rows = deduplicateRowsByKey(
      (Array.isArray(messages) ? messages : [])
        .map((message, index) => buildMessageRow(message, accountEmail, folder, index, {
          uidValidity,
          generationId,
        }))
        .filter((row) => row.uid > 0),
      'message_key'
    ).sort((left, right) => left.uid - right.uid);
    return rows.map((row) => {
      const {
        message_key: _messageKey,
        account_email: _accountEmail,
        folder: _folder,
        uid_validity: _uidValidity,
        uid_generation_id: _uidGenerationId,
        ...databaseOwnedIdentityRemoved
      } = row;
      return databaseOwnedIdentityRemoved;
    });
  }

  async function listLegacyUidIdentities({
    accountEmail,
    folder = 'inbox',
    deadlineAtMs = null,
  } = {}) {
    const normalizedAccount = normalizeEmail(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (!normalizedAccount) return null;
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const deadline = Number(deadlineAtMs);
      if (Number.isFinite(deadline) && deadline > 0 && now().getTime() >= deadline) return null;
      const result = await runDurableWrite(
        `list-legacy-uid-identities:${normalizedFolder}:${offset}`,
        (client) => client
          .from(messagesTable)
          .select('uid,message_id')
          .eq('account_email', normalizedAccount)
          .eq('folder', normalizedFolder)
          .is('uid_validity', null)
          .is('uid_generation_id', null)
          .is('generation_superseded_at', null)
          .is('deleted_at', null)
          .order('uid', { ascending: true })
          .range(offset, offset + pageSize - 1),
        { deadlineAtMs }
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page.map((row) => ({
        uid: Number(row && row.uid) || 0,
        messageId: normalizeString(row && row.message_id),
      })));
      if (page.length < pageSize) break;
    }
    return rows;
  }

  const uidValidityStore = createMailboxUidValidityStore({
    runDurableWrite,
    buildSyncKey,
    normalizeString,
  });
  const syncFinalizer = createMailboxSyncFinalizer({
    runDurableWrite,
    buildSyncKey,
    normalizeString,
  });

  async function commitSyncPass(options = {}) {
    return syncFinalizer.commitSyncPass({
      ...options,
      rows: buildSyncCommitRows(options),
    });
  }

  async function commitTargetedSyncPass(options = {}) {
    return syncFinalizer.commitTargetedSyncPass({
      ...options,
      rows: buildSyncCommitRows(options),
    });
  }

  return {
    buildSyncCommitRows,
    commitSyncPass,
    commitTargetedSyncPass,
    failSync: syncFinalizer.failSync,
    listLegacyUidIdentities,
    ...uidValidityStore,
  };
}

module.exports = {
  createMailboxUidGenerationIndex,
};
