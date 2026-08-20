const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  removeMailboxCampaignSnapshotMessage,
} = require('./mailbox-campaign-snapshot');

const MAX_CONVERSATION_MESSAGES = 100;

function createMailboxVisibilityService(deps = {}) {
  const {
    getAccount,
    getProviderAccount = () => null,
    assertTargetAuthorized = async () => null,
    parseMessageReference,
    canUseMailboxIndex,
    mailboxIndexStore,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;

  function createStatusError(message, status = 503) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function normalizeTargets(input = {}) {
    const supplied = Array.isArray(input.messages) && input.messages.length
      ? input.messages
      : [input];
    if (supplied.length > MAX_CONVERSATION_MESSAGES) {
      throw createStatusError(
        `Dit gesprek bevat meer dan ${MAX_CONVERSATION_MESSAGES} geladen berichten en is daarom niet gedeeltelijk verborgen.`,
        413
      );
    }
    const targets = [];
    const seen = new Set();
    supplied.forEach((source) => {
      const requestedAccount = source.account || source.accountEmail || input.accountEmail;
      const requestedFolder = String(source.folder || input.folder || '').trim().toLowerCase();
      const account = requestedFolder === 'instantly'
        ? getProviderAccount(requestedAccount)
        : getAccount(requestedAccount);
      if (!account) throw createStatusError('Mailbox-account niet gevonden.', 404);
      const id = source.id || source.messageId;
      const messageRef = requestedFolder === 'instantly'
        ? { folder: 'instantly', uid: 0 }
        : parseMessageReference({ id, folder: source.folder, uid: source.uid });
      if (requestedFolder === 'instantly' && !/^instantly:[^:\s]+$/.test(String(id || ''))) {
        throw createStatusError('Instantly-bericht niet gevonden.', 400);
      }
      const key = `${account.email}|${messageRef.folder}|${messageRef.uid || id}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({
        account,
        id: id || `${messageRef.folder}:${messageRef.uid}`,
        messageRef,
        owner: source.owner || input.owner,
        providerThreadId: source.providerThreadId || '',
      });
    });
    if (!targets.length) throw createStatusError('Geen geldig Softora-gesprek gekozen.', 400);
    return targets;
  }

  async function updateIndex(targets, hidden) {
    if (!canUseMailboxIndex()) {
      throw createStatusError('Softora-mailboxindex is niet beschikbaar; gesprek is niet verborgen.');
    }
    const operation = hidden
      ? mailboxIndexStore.markMessageDeleted
      : mailboxIndexStore.restoreMessage;
    if (typeof operation !== 'function') {
      throw createStatusError('Softora-mailboxweergave kan deze actie nog niet duurzaam opslaan.');
    }
    const completed = [];
    const resolvedMessages = [];
    const resolvedKeys = new Set();
    try {
      for (const target of targets) {
        await assertTargetAuthorized(target);
        const result = await operation.call(mailboxIndexStore, {
          accountEmail: target.account.email,
          id: target.id,
          folder: target.messageRef.folder,
          uid: target.messageRef.uid,
        });
        if (result?.ok !== true) {
          const error = createStatusError(
            result?.error?.message ||
              (hidden
                ? 'Gesprek kon niet in Softora worden verborgen.'
                : 'Gesprek kon niet in Softora worden hersteld.'),
            result?.unavailable ? 503 : 404
          );
          error.code = result?.error?.code || 'MAILBOX_VISIBILITY_UPDATE_FAILED';
          throw error;
        }
        completed.push(target);
        const rows = Array.isArray(result.data) && result.data.length ? result.data : [{}];
        rows.forEach((row) => {
          const accountEmail = String(row.account_email || row.accountEmail || target.account.email).trim().toLowerCase();
          const folder = String(row.folder || target.messageRef.folder).trim().toLowerCase();
          const uid = Number(row.uid || target.messageRef.uid) || 0;
          const id = String(row.provider_id || row.id || target.id).trim();
          const key = `${accountEmail}|${folder}|${uid || id}`;
          if (!accountEmail || (!uid && !id) || resolvedKeys.has(key)) return;
          resolvedKeys.add(key);
          resolvedMessages.push({
            account: accountEmail,
            accountEmail,
            folder,
            uid,
            id,
            messageId: String(row.message_id || row.messageId || '').trim(),
            messageKey: String(row.message_key || row.messageKey || '').trim(),
          });
        });
      }
    } catch (error) {
      const rollback = hidden
        ? mailboxIndexStore.restoreMessage
        : mailboxIndexStore.markMessageDeleted;
      if (typeof rollback === 'function') {
        for (const target of completed.reverse()) {
          await rollback.call(mailboxIndexStore, {
            accountEmail: target.account.email,
            id: target.id,
            folder: target.messageRef.folder,
            uid: target.messageRef.uid,
          }).catch((rollbackError) => {
            logger.error('[Mailbox][VisibilityRollback]', rollbackError?.message || rollbackError);
          });
        }
      }
      throw error;
    }
    return resolvedMessages;
  }

  async function removeTargetsFromCampaignSnapshot(targets) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') return false;
    try {
      const current = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
      const rawValue = current?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY] || '';
      let serialized = rawValue;
      let changed = false;
      targets.forEach((target) => {
        const accountEmail = String(
          target?.accountEmail || target?.account?.email || target?.account || ''
        ).trim().toLowerCase();
        const folder = String(
          target?.folder || target?.messageRef?.folder || 'inbox'
        ).trim().toLowerCase();
        const uid = Number(target?.uid || target?.messageRef?.uid) || 0;
        const result = removeMailboxCampaignSnapshotMessage(serialized, {
          accountEmail,
          folder,
          id: target.id,
          uid,
          messageId: target.messageId,
          messageKey: target.messageKey,
        });
        serialized = result.serialized;
        changed = changed || result.changed;
      });
      if (!changed) return false;
      await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serialized },
        {
          source: 'mailbox-view-hide',
          actor: String(
            targets[0]?.accountEmail || targets[0]?.account?.email || targets[0]?.account || ''
          ).trim().toLowerCase(),
        }
      );
      return true;
    } catch (error) {
      logger.warn('[Mailbox][HideSnapshot]', error?.message || error);
      return false;
    }
  }

  async function hideConversation(input) {
    const targets = normalizeTargets(input);
    const resolvedMessages = await updateIndex(targets, true);
    const snapshotUpdated = await removeTargetsFromCampaignSnapshot(resolvedMessages);
    return {
      hidden: true,
      sourceMailboxMutated: false,
      messageCount: targets.length,
      resolvedMessageCount: resolvedMessages.length,
      resolvedMessages,
      snapshotUpdated,
    };
  }

  async function restoreConversation(input) {
    const targets = normalizeTargets(input);
    const resolvedMessages = await updateIndex(targets, false);
    return {
      restored: true,
      sourceMailboxMutated: false,
      messageCount: targets.length,
      resolvedMessageCount: resolvedMessages.length,
      resolvedMessages,
    };
  }

  return {
    hideConversation,
    restoreConversation,
  };
}

module.exports = {
  MAX_CONVERSATION_MESSAGES,
  createMailboxVisibilityService,
};
