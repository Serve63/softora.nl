function createMailboxStateMutationStore(deps = {}) {
  const {
    run,
    runDurableWrite,
    tableName,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    durableClientTimeoutMs,
    durableQueryTimeoutMs,
    isoNow,
  } = deps;

  function normalizeTarget({ accountEmail, folder = 'inbox', id = '', uid = 0 }) {
    const normalizedFolder = normalizeFolder(folder);
    const normalizedId = normalizeString(id);
    const parsedUid = normalizedFolder === 'instantly'
      ? 0
      : Number(uid || normalizedId.match(/:(\d+)$/)?.[1] || 0);
    return {
      accountEmail: normalizeEmail(accountEmail),
      folder: normalizedFolder,
      id: normalizedId,
      uid: Number.isSafeInteger(parsedUid) && parsedUid > 0 ? parsedUid : 0,
    };
  }

  async function applyStateMutation(input = {}) {
    const target = normalizeTarget(input);
    const result = await runDurableWrite('apply-state-mutation', (client) => client.rpc(
      'softora_apply_mailbox_state_mutation',
      {
        p_account_email: target.accountEmail,
        p_folder: target.folder,
        p_uid: target.uid,
        p_provider_id: target.id,
        p_mutation_key: normalizeString(input.mutationKey),
        p_revision: Number(input.revision) || 0,
        p_unread: input.unread === true,
        p_dismiss_reply: input.dismissReply === true,
      }
    ));
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!result.ok || row) return { ...result, row };
    const error = new Error('Mailboxbericht ontbreekt in de duurzame index.');
    error.code = 'MAILBOX_INDEX_MESSAGE_NOT_FOUND';
    return { ok: false, unavailable: false, data: result.data, row: null, error };
  }

  async function markMessageRead(input = {}) {
    const target = normalizeTarget(input);
    const readAt = isoNow();
    const result = await run('mark-message-read', (client) => {
      const query = client.from(tableName)
        .update({ unread: false, softora_read_at: readAt, updated_at: readAt })
        .eq('account_email', target.accountEmail).eq('folder', target.folder).is('deleted_at', null);
      return target.uid > 0 ? query.eq('uid', target.uid) : query.eq('provider_id', target.id);
    });
    return { ...result, readAt: result.ok ? readAt : '' };
  }

  async function markMessageReplyDismissed(input = {}) {
    const target = normalizeTarget(input);
    const dismissedAt = isoNow();
    const result = await run('mark-message-reply-dismissed', (client) => {
      const query = client.from(tableName)
        .update({ unread: false, softora_read_at: dismissedAt, reply_dismissed_at: dismissedAt, updated_at: dismissedAt })
        .eq('account_email', target.accountEmail).eq('folder', target.folder).is('deleted_at', null);
      return (target.uid > 0 ? query.eq('uid', target.uid) : query.eq('provider_id', target.id))
        .select('message_key,reply_dismissed_at');
    });
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) return { ...result, dismissedAt };
    const error = new Error('Mailboxbericht ontbreekt in de duurzame index.');
    error.code = 'MAILBOX_INDEX_MESSAGE_NOT_FOUND';
    return { ok: false, unavailable: false, data: result.data, error, dismissedAt: '' };
  }

  async function getStateMutationStatus(input = {}) {
    const target = normalizeTarget(input);
    const result = await run('state-mutation-status', (client) => {
      const query = client
        .from(tableName)
        .select('message_key,state_revision,state_mutation_key,state_mutation_at,unread,softora_read_at,reply_dismissed_at')
        .eq('account_email', target.accountEmail)
        .eq('folder', target.folder)
        .is('deleted_at', null)
        .limit(1);
      return target.uid > 0 ? query.eq('uid', target.uid) : query.eq('provider_id', target.id);
    }, {
      bypassFailureCooldown: true,
      suppressFailureCooldown: true,
      clientOptions: {
        timeoutMs: durableClientTimeoutMs,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      },
      queryTimeoutMs: durableQueryTimeoutMs,
    });
    return { ...result, row: Array.isArray(result.data) ? result.data[0] || null : null };
  }

  return { applyStateMutation, getStateMutationStatus, markMessageRead, markMessageReplyDismissed };
}

module.exports = { createMailboxStateMutationStore };
