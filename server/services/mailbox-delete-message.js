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
    const targets = [];
    const seen = new Set();
    supplied.slice(0, MAX_CONVERSATION_MESSAGES).forEach((source) => {
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

  async function hideConversation(input) {
    const targets = normalizeTargets(input);
    await updateIndex(targets, true);
    return {
      hidden: true,
      sourceMailboxMutated: false,
      messageCount: targets.length,
      snapshotUpdated: false,
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
