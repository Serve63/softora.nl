const MAILBOX_UIDVALIDITY_MAX = 4_294_967_295;

function normalizeMailboxUidValidity(value) {
  let normalized;
  try {
    normalized = Number(value);
  } catch (_) {
    return 0;
  }
  return Number.isSafeInteger(normalized)
    && normalized > 0
    && normalized <= MAILBOX_UIDVALIDITY_MAX
    ? normalized
    : 0;
}

function createMailboxUidValidityError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireMailboxUidValidity(value) {
  const uidValidity = normalizeMailboxUidValidity(value);
  if (!uidValidity) {
    throw createMailboxUidValidityError(
      'MAILBOX_UIDVALIDITY_REQUIRED',
      'De mailboxactie mist de exacte UIDVALIDITY-generatie; ververs de mailbox en probeer opnieuw.'
    );
  }
  return uidValidity;
}

function assertMailboxClientUidValidity(client, requestedValue) {
  const requested = requireMailboxUidValidity(requestedValue);
  const current = normalizeMailboxUidValidity(client?.mailbox?.uidValidity);
  if (!current) {
    throw createMailboxUidValidityError(
      'MAILBOX_UIDVALIDITY_UNAVAILABLE',
      'De actuele UIDVALIDITY-generatie kon niet veilig worden vastgesteld.',
      503
    );
  }
  if (current !== requested) {
    const error = createMailboxUidValidityError(
      'MAILBOX_UIDVALIDITY_STALE',
      'Dit mailboxbericht hoort bij een verouderde UIDVALIDITY-generatie; ververs de mailbox.'
    );
    error.requestedUidValidity = requested;
    error.currentUidValidity = current;
    throw error;
  }
  return current;
}

function buildMailboxGenerationMessageKey(accountEmail, folder, uid, uidValidity) {
  const normalizedEmail = String(accountEmail || '').trim().toLowerCase();
  const normalizedFolder = String(folder || 'inbox').trim().toLowerCase() || 'inbox';
  const normalizedUid = Number(uid) || 0;
  const generation = normalizeMailboxUidValidity(uidValidity);
  return generation
    ? `${normalizedEmail}|${normalizedFolder}|uv:${generation}|${normalizedUid}`
    : `${normalizedEmail}|${normalizedFolder}|${normalizedUid}`;
}

function resolveMailboxBatchUidValidity(messages = [], requestedValue = 0) {
  const source = Array.isArray(messages) ? messages : [];
  const requested = normalizeMailboxUidValidity(requestedValue);
  const generations = new Set(source
    .map((message) => normalizeMailboxUidValidity(message?.uidValidity))
    .filter(Boolean));
  if (
    generations.size > 1
    || (requested && Array.from(generations).some((generation) => generation !== requested))
  ) {
    const error = new Error('Mailboxbatch bevat tegenstrijdige UIDVALIDITY-generaties.');
    error.code = 'MAILBOX_SYNC_UIDVALIDITY_BATCH_MISMATCH';
    return { ok: false, uidValidity: 0, error };
  }
  return { ok: true, uidValidity: requested || Array.from(generations)[0] || 0 };
}

module.exports = {
  MAILBOX_UIDVALIDITY_MAX,
  assertMailboxClientUidValidity,
  buildMailboxGenerationMessageKey,
  createMailboxUidValidityError,
  normalizeMailboxUidValidity,
  requireMailboxUidValidity,
  resolveMailboxBatchUidValidity,
};
