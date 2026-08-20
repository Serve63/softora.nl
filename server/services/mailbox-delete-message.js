const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  removeMailboxCampaignSnapshotMessage,
} = require('./mailbox-campaign-snapshot');

const MAX_CONVERSATION_MESSAGES = 100;
const MAILBOX_VISIBILITY_PROTOCOL = 'atomic-contact-v1';

function createMailboxVisibilityService(deps = {}) {
  const {
    getAccount,
    getProviderAccount = () => null,
    assertTargetAuthorized = async () => null,
    parseMessageReference,
    canUseMailboxIndex,
    mailboxIndexStore,
    mailboxOutreachScope = null,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;

  function createStatusError(message, status = 503) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function assertVisibilityProtocol(input = {}) {
    if (String(input.visibilityProtocol || '').trim() === MAILBOX_VISIBILITY_PROTOCOL) return;
    const error = createStatusError(
      'Deze mailboxweergave is verouderd. Vernieuw de pagina; er is niets gewijzigd.',
      409
    );
    error.code = 'MAILBOX_VISIBILITY_PROTOCOL_REQUIRED';
    throw error;
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

  function normalizeOutreachOwner(value) {
    const owner = String(value || '').trim().toLowerCase().replace('servé', 'serve');
    if (owner === 'serve' || owner === 'martijn') return owner;
    throw createStatusError('Kies eerst de juiste persoonlijke mailbox.', 400);
  }

  function normalizeContactEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createStatusError('Contactdossier heeft geen geldig e-mailadres.', 400);
    }
    return email;
  }

  function normalizeResolvedMessages(target, result) {
    const resolvedMessages = [];
    const resolvedKeys = new Set();
    const rows = Array.isArray(result?.data) && result.data.length ? result.data : [{}];
    rows.forEach((row) => {
      const accountEmail = String(
        row.account_email || row.accountEmail || target.account.email
      ).trim().toLowerCase();
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
    return resolvedMessages;
  }

  async function updateOutreachContactIndex(targets, input, hidden) {
    if (typeof mailboxIndexStore.setContactVisibility !== 'function') {
      throw createStatusError('Softora-contactdossiers kunnen nog niet atomisch worden bijgewerkt.');
    }
    if (typeof mailboxOutreachScope?.getScopedAccounts !== 'function') {
      throw createStatusError('Softora-mailboxscope is niet beschikbaar.');
    }
    const owner = normalizeOutreachOwner(input.owner);
    const contactEmail = normalizeContactEmail(input.contactEmail);
    const ownerAccounts = Array.from(new Set(
      mailboxOutreachScope.getScopedAccounts(owner)
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )).sort();
    if (!ownerAccounts.length) throw createStatusError('Persoonlijke mailboxscope is leeg.', 503);
    const allInternalAccounts = new Set(
      mailboxOutreachScope.getScopedAccounts('')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (allInternalAccounts.has(contactEmail)) {
      throw createStatusError('Een eigen mailbox kan geen contactdossier zijn.', 400);
    }
    const allowedAccounts = new Set(ownerAccounts);
    if (targets.some((target) => !allowedAccounts.has(target.account.email))) {
      throw createStatusError('Contactdossier valt buiten de gekozen persoonlijke mailbox.', 403);
    }
    for (const target of targets) await assertTargetAuthorized(target);
    const anchor = targets[0];
    const expectedMessageCount = hidden
      ? Math.max(1, Number(input.expectedMessageCount) || targets.length)
      : 0;
    if (expectedMessageCount > MAX_CONVERSATION_MESSAGES) {
      throw createStatusError(
        `Dit gesprek bevat meer dan ${MAX_CONVERSATION_MESSAGES} berichten en is daarom niet gedeeltelijk verborgen.`,
        413
      );
    }
    const result = await mailboxIndexStore.setContactVisibility({
      accountEmails: ownerAccounts,
      contactEmail,
      accountEmail: anchor.account.email,
      id: anchor.id,
      folder: anchor.messageRef.folder,
      uid: anchor.messageRef.uid,
      expectedMessageCount,
    }, hidden);
    if (result?.ok !== true) {
      const error = createStatusError(
        result?.error?.message || (hidden
          ? 'Contactdossier kon niet volledig in Softora worden verborgen.'
          : 'Contactdossier kon niet volledig in Softora worden hersteld.'),
        result?.unavailable ? 503 : 409
      );
      error.code = result?.error?.code || 'MAILBOX_CONTACT_VISIBILITY_UPDATE_FAILED';
      throw error;
    }
    return normalizeResolvedMessages(anchor, result);
  }

  async function updateIndex(targets, hidden, input = {}) {
    if (!canUseMailboxIndex()) {
      throw createStatusError('Softora-mailboxindex is niet beschikbaar; gesprek is niet verborgen.');
    }
    if (input.visibilityScope === 'outreach-contact') {
      return updateOutreachContactIndex(targets, input, hidden);
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
        normalizeResolvedMessages(target, result).forEach((row) => {
          const key = `${row.accountEmail}|${row.folder}|${row.uid || row.id}`;
          if (resolvedKeys.has(key)) return;
          resolvedKeys.add(key);
          resolvedMessages.push(row);
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
    assertVisibilityProtocol(input);
    const targets = normalizeTargets(input);
    const resolvedMessages = await updateIndex(targets, true, input);
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
    assertVisibilityProtocol(input);
    const targets = normalizeTargets(input);
    const resolvedMessages = await updateIndex(targets, false, input);
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
  MAILBOX_VISIBILITY_PROTOCOL,
  MAX_CONVERSATION_MESSAGES,
  createMailboxVisibilityService,
};
