const MAX_CONVERSATION_MESSAGES = 100;
const { resolveMailboxName } = require('./mailbox-sent-copy');
const {
  createMailboxUidValidityActionGuard,
} = require('./mailbox-uid-validity-action-guard');

function createMailboxVisibilityService(deps = {}) {
  const {
    getAccount,
    getProviderAccount = () => null,
    assertTargetAuthorized = async () => null,
    parseMessageReference,
    createClient,
    resolveMailboxName: resolveMailboxNameForAction = resolveMailboxName,
    canUseMailboxIndex,
    mailboxIndexStore,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;
  const uidValidityGuard = createMailboxUidValidityActionGuard({
    createClient,
    mailboxIndexStore,
    resolveMailboxName: resolveMailboxNameForAction,
  });

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
        : parseMessageReference({
            id,
            folder: source.folder,
            uid: source.uid,
            uidValidity: source.uidValidity,
          });
      if (requestedFolder === 'instantly' && !/^instantly:[^:\s]+$/.test(String(id || ''))) {
        throw createStatusError('Instantly-bericht niet gevonden.', 400);
      }
      const key = messageRef.uid > 0
        ? `${account.email}|${messageRef.folder}|${messageRef.uidValidity}|${messageRef.uid}`
        : `${account.email}|${messageRef.folder}|${id}`;
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
    for (const target of targets) await assertTargetAuthorized(target);
    await uidValidityGuard.withCurrentUidValidities(targets, async () => {
      const imapTargets = targets.filter((target) => target.messageRef.folder !== 'instantly');
      if (imapTargets.length && typeof mailboxIndexStore.getMessageForAction !== 'function') {
        throw createStatusError('Softora-mailboxindex kan de volledige actie niet vooraf valideren.');
      }
      for (const target of imapTargets) {
        const existing = await mailboxIndexStore.getMessageForAction({
          accountEmail: target.account.email,
          id: target.id,
          folder: target.messageRef.folder,
          uid: target.messageRef.uid,
          uidValidity: target.messageRef.uidValidity,
        });
        if (!existing) {
          const error = createStatusError('Het mailboxbericht bestaat niet meer in deze UIDVALIDITY-generatie.', 409);
          error.code = 'MAILBOX_UIDVALIDITY_STALE';
          throw error;
        }
      }
      const completed = [];
      try {
        for (const target of targets) {
          const result = await operation.call(mailboxIndexStore, {
            accountEmail: target.account.email,
            id: target.id,
            folder: target.messageRef.folder,
            uid: target.messageRef.uid,
            uidValidity: target.messageRef.uidValidity,
          });
          if (result?.ok !== true) {
            const error = createStatusError(
              result?.error?.message ||
                (hidden
                  ? 'Gesprek kon niet in Softora worden verborgen.'
                  : 'Gesprek kon niet in Softora worden hersteld.'),
              result?.error?.status || (result?.unavailable ? 503 : 404)
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
              uidValidity: target.messageRef.uidValidity,
            }).catch((rollbackError) => {
              logger.error('[Mailbox][VisibilityRollback]', rollbackError?.message || rollbackError);
            });
          }
        }
        throw error;
      }
    });
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
