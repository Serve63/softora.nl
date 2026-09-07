'use strict';

function createMailboxIndexVisibilityStore(deps = {}) {
  const {
    run,
    runDurableWrite,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
  } = deps;

  async function listMessageStatesByKeys({ messageKeys = [], deadlineAtMs = Date.now() + 2500 } = {}) {
    const keys = Array.from(new Set(messageKeys.map(normalizeString).filter(Boolean)));
    if (!keys.length) return [];
    if (keys.length > 2000 || typeof run !== 'function') return null;
    const rows = [];
    // Short primary-key batches avoid URL/header limits and full-history scans.
    // Three reads at a time share one deadline; a failed read never means empty.
    for (let offset = 0; offset < keys.length; offset += 150) {
      const remainingMs = Math.min(1500, deadlineAtMs - Date.now());
      if (remainingMs < 250) return null;
      const batches = [0, 50, 100].map((start) => keys.slice(offset + start, Math.min(offset + start + 50, keys.length)))
        .filter((batch) => batch.length);
      const results = await Promise.all(batches.map((batch) => run('snapshot-message-states', (client) => client
        .from('softora_mailbox_messages')
        .select('message_key,account_email,unread,softora_read_at,reply_dismissed_at,state_revision,state_mutation_key,state_mutation_at,starred')
        .in('message_key', batch)
        .is('deleted_at', null)
        .is('generation_superseded_at', null), {
        bypassFailureCooldown: true,
        suppressFailureCooldown: true,
        queryTimeoutMs: remainingMs,
        clientOptions: { timeoutMs: remainingMs, ignoreFailureCooldown: true, suppressFailureCooldown: true },
      })));
      if (results.some((result) => !result.ok || !Array.isArray(result.data))) return null;
      rows.push(...results.flatMap((result) => result.data));
    }
    return rows;
  }

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

  async function setMessageVisibility(input, hidden) {
    const target = normalizeTarget(input);
    const result = await runDurableWrite(hidden ? 'mark-message-deleted' : 'restore-message', (client) =>
      client.rpc('softora_set_mailbox_message_visibility', {
        p_account_email: target.accountEmail,
        p_folder: target.folder,
        p_uid: target.uid,
        p_provider_id: target.id,
        p_hidden: Boolean(hidden),
      })
    );
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) return result;
    const error = new Error(hidden
      ? 'Mailboxbericht ontbreekt in de duurzame index.'
      : 'Verborgen Softora-mailboxbericht is niet gevonden.');
    error.code = hidden
      ? 'MAILBOX_INDEX_MESSAGE_NOT_FOUND'
      : 'MAILBOX_INDEX_HIDDEN_MESSAGE_NOT_FOUND';
    return { ok: false, unavailable: false, data: [], error };
  }

  async function setContactVisibility(input, hidden) {
    const target = normalizeTarget(input);
    const ownerAccounts = Array.from(new Set(
      (Array.isArray(input.accountEmails) ? input.accountEmails : [])
        .map(normalizeEmail)
        .filter(Boolean)
    )).sort();
    const result = await runDurableWrite(hidden ? 'hide-contact-dossier' : 'restore-contact-dossier', (client) =>
      client.rpc('softora_set_mailbox_contact_visibility', {
        p_owner_accounts: ownerAccounts,
        p_contact_email: normalizeEmail(input.contactEmail),
        p_anchor_account_email: target.accountEmail,
        p_anchor_folder: target.folder,
        p_anchor_uid: target.uid,
        p_anchor_provider_id: target.id,
        p_expected_message_count: Math.max(0, Number(input.expectedMessageCount) || 0),
        p_hidden: Boolean(hidden),
      })
    );
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) return result;
    const error = new Error(hidden
      ? 'Contactdossier ontbreekt of veranderde in de duurzame mailboxindex.'
      : 'Verborgen Softora-contactdossier is niet gevonden.');
    error.code = hidden
      ? 'MAILBOX_INDEX_CONTACT_NOT_FOUND'
      : 'MAILBOX_INDEX_HIDDEN_CONTACT_NOT_FOUND';
    return { ok: false, unavailable: false, data: [], error };
  }

  return {
    listMessageStatesByKeys,
    markMessageDeleted: (input) => setMessageVisibility(input, true),
    restoreMessage: (input) => setMessageVisibility(input, false),
    setContactVisibility,
  };
}

module.exports = { createMailboxIndexVisibilityStore };
