const {
  createMailboxUidValidityError,
  requireMailboxUidValidity,
} = require('./mailbox-uid-validity');

function resolveMailboxMessageActionReference(input = {}, helpers = {}) {
  const normalizeString = helpers.normalizeString || ((value) => String(value || '').trim());
  const normalizeEmail = helpers.normalizeEmail || ((value) => normalizeString(value).toLowerCase());
  const normalizeFolder = helpers.normalizeFolder || ((value) => normalizeString(value || 'inbox').toLowerCase() || 'inbox');
  const folder = normalizeFolder(input.folder);
  const id = normalizeString(input.id);
  const uid = folder === 'instantly'
    ? 0
    : Number(input.uid || id.match(/:(\d+)$/)?.[1] || 0);
  if (folder !== 'instantly' && (!Number.isSafeInteger(uid) || uid <= 0)) {
    const error = new Error('Mailboxbericht niet gevonden.');
    error.code = 'MAILBOX_MESSAGE_REFERENCE_INVALID';
    error.status = 400;
    throw error;
  }
  if (folder === 'instantly' && !id) {
    const error = new Error('Instantly-bericht niet gevonden.');
    error.code = 'MAILBOX_MESSAGE_REFERENCE_INVALID';
    error.status = 400;
    throw error;
  }
  return {
    accountEmail: normalizeEmail(input.accountEmail),
    folder,
    id,
    uid,
    uidValidity: folder === 'instantly' ? 0 : requireMailboxUidValidity(input.uidValidity),
  };
}

function applyMailboxMessageActionReference(query, reference, options = {}) {
  let scoped = query
    .eq('account_email', reference.accountEmail)
    .eq('folder', reference.folder);
  if (reference.uid > 0) {
    scoped = scoped
      .eq('uid_validity', reference.uidValidity)
      .eq('uid', reference.uid)
      .is('generation_superseded_at', null);
  } else {
    scoped = scoped.eq('provider_id', reference.id);
  }
  if (options.activeOnly === true) scoped = scoped.is('deleted_at', null);
  return scoped;
}

function createMailboxActionNotFoundResult(
  reference,
  message,
  providerCode = 'MAILBOX_INDEX_MESSAGE_NOT_FOUND'
) {
  const error = reference.uid > 0
    ? createMailboxUidValidityError(
        'MAILBOX_UIDVALIDITY_STALE',
        'Het mailboxbericht bestaat niet meer in deze UIDVALIDITY-generatie.'
      )
    : new Error(message);
  if (!error.code) error.code = providerCode;
  return { ok: false, unavailable: false, data: [], error };
}

module.exports = {
  applyMailboxMessageActionReference,
  createMailboxActionNotFoundResult,
  resolveMailboxMessageActionReference,
};
