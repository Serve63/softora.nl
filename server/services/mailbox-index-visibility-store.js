'use strict';

function createMailboxIndexVisibilityStore(deps = {}) {
  const {
    runDurableWrite,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
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
    markMessageDeleted: (input) => setMessageVisibility(input, true),
    restoreMessage: (input) => setMessageVisibility(input, false),
    setContactVisibility,
  };
}

module.exports = { createMailboxIndexVisibilityStore };
