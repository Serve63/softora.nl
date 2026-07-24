const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  removeMailboxCampaignSnapshotMessage,
} = require('./mailbox-campaign-snapshot');

const MAX_CONVERSATION_MESSAGES = 100;

function createMailboxVisibilityService(deps = {}) {
  const {
    getAccount,
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
    const targets = [];
    const seen = new Set();
    supplied.slice(0, MAX_CONVERSATION_MESSAGES).forEach((source) => {
      const account = getAccount(source.account || source.accountEmail || input.accountEmail);
      if (!account) throw createStatusError('Mailbox-account niet gevonden.', 404);
      const messageRef = parseMessageReference({
        id: source.id || source.messageId,
        folder: source.folder,
        uid: source.uid,
      });
      const key = `${account.email}|${messageRef.folder}|${messageRef.uid}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({
        account,
        id: source.id || source.messageId || `${messageRef.folder}:${messageRef.uid}`,
        messageRef,
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
    try {
      for (const target of targets) {
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
  }

  async function removeTargetsFromCampaignSnapshot(targets) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') return false;
    try {
      const current = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
      const rawValue = current?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY] || '';
      let serialized = rawValue;
      let changed = false;
      targets.forEach((target) => {
        const result = removeMailboxCampaignSnapshotMessage(serialized, {
          accountEmail: target.account.email,
          folder: target.messageRef.folder,
          id: target.id,
          uid: target.messageRef.uid,
        });
        serialized = result.serialized;
        changed = changed || result.changed;
      });
      if (!changed) return false;
      await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serialized },
        { source: 'mailbox-view-hide', actor: targets[0].account.email }
      );
      return true;
    } catch (error) {
      logger.warn('[Mailbox][HideSnapshot]', error?.message || error);
      return false;
    }
  }

  async function hideConversation(input) {
    const targets = normalizeTargets(input);
    await updateIndex(targets, true);
    const snapshotUpdated = await removeTargetsFromCampaignSnapshot(targets);
    return {
      hidden: true,
      sourceMailboxMutated: false,
      messageCount: targets.length,
      snapshotUpdated,
    };
  }

  async function restoreConversation(input) {
    const targets = normalizeTargets(input);
    await updateIndex(targets, false);
    return {
      restored: true,
      sourceMailboxMutated: false,
      messageCount: targets.length,
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
