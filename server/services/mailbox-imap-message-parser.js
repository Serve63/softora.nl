const MAILBOX_IMAP_PARSE_TIMEOUT_MS = 2500;
const MAILBOX_IMAP_QUARANTINE_TTL_MS = 15 * 60 * 1000;
const MAILBOX_IMAP_SOURCE_MAX_BYTES = 15 * 1024 * 1024;

function createParseError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getSourceBytes(source) {
  if (Buffer.isBuffer(source)) return source.length;
  if (typeof source === 'string') return Buffer.byteLength(source);
  return Number(source?.length) || 0;
}

function attachMailboxSyncReadHealth(messages, health = {}) {
  const source = Array.isArray(messages) ? messages : [];
  Object.defineProperty(source, 'syncReadHealth', { value: Object.freeze({ ...health }) });
  return source;
}

function attachMailboxSyncReadResult(messages, {
  selectedUids = [], parseFailures = [], folderMissing = false,
} = {}) {
  const selectionHealth = selectedUids.syncSelectionHealth || {};
  return attachMailboxSyncReadHealth(messages, {
    parseFailures,
    selectedCount: selectedUids.length,
    folderMissing,
    ...selectionHealth,
    selectionTruncated: selectionHealth.truncated === true,
  });
}

function createMailboxImapMessageParser({
  parseMailSource,
  normalizeString,
  sanitizeDisplayText,
  buildBodyImages,
  toClientMessage,
  logger = console,
  now = () => Date.now(),
} = {}) {
  const quarantine = new Map();

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : createParseError('Mailbox-map is geannuleerd.', 'MAILBOX_SYNC_FOLDER_TIMEOUT');
  }

  async function parseWithDeadline(source, { signal, deadlineAt = 0 } = {}) {
    throwIfAborted(signal);
    const remainingMs = Number(deadlineAt) > 0
      ? Math.max(1, Number(deadlineAt) - now())
      : MAILBOX_IMAP_PARSE_TIMEOUT_MS;
    const timeoutMs = Math.min(MAILBOX_IMAP_PARSE_TIMEOUT_MS, remainingMs);
    let timer = null;
    let abortHandler = null;
    const stops = [new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(createParseError(
        'Mailboxbericht kon niet tijdig worden geparseerd.',
        'MAILBOX_MESSAGE_PARSE_TIMEOUT'
      )), timeoutMs);
    })];
    if (signal) stops.push(new Promise((_resolve, reject) => {
      abortHandler = () => reject(signal.reason instanceof Error
        ? signal.reason
        : createParseError('Mailbox-map is geannuleerd.', 'MAILBOX_SYNC_FOLDER_TIMEOUT'));
      signal.addEventListener('abort', abortHandler, { once: true });
    }));
    try {
      return await Promise.race([Promise.resolve().then(() => parseMailSource(source)), ...stops]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abortHandler) signal.removeEventListener('abort', abortHandler);
    }
  }

  function recordFailure(key, uid, error) {
    const code = String(error?.code || 'MAILBOX_MESSAGE_PARSE_FAILED').slice(0, 120);
    const reason = String(error?.message || error || 'Onbekende parsefout').slice(0, 240);
    quarantine.set(key, { code, reason, until: now() + MAILBOX_IMAP_QUARANTINE_TTL_MS });
    logger.warn?.('[Mailbox][ImapMessageQuarantined]', { uid, code, reason });
    return { ok: false, uid, code, reason, quarantined: true };
  }

  async function parseMessage({ message, account, folder, signal, deadlineAt = 0 } = {}) {
    throwIfAborted(signal);
    const uid = Number(message?.uid) || 0;
    const key = `${String(account?.email || '').toLowerCase()}|${folder}|${uid}`;
    const cached = quarantine.get(key);
    if (cached && cached.until > now()) {
      return { ok: false, uid, code: cached.code, reason: cached.reason, quarantined: true, cached: true };
    }
    quarantine.delete(key);
    if (getSourceBytes(message?.source) > MAILBOX_IMAP_SOURCE_MAX_BYTES) {
      return recordFailure(key, uid, createParseError(
        'Mailboxbericht is groter dan de veilige MIME-parselimiet.',
        'MAILBOX_MESSAGE_SOURCE_TOO_LARGE'
      ));
    }
    try {
      const parsed = await parseWithDeadline(message?.source, { signal, deadlineAt });
      throwIfAborted(signal);
      const text = sanitizeDisplayText(normalizeString(parsed?.text || parsed?.html || ''));
      const primaryBodyImages = buildBodyImages(parsed);
      return {
        ok: true,
        uid,
        message: toClientMessage(parsed, message, folder, account, { text, primaryBodyImages }),
      };
    } catch (error) {
      if (signal?.aborted || /^MAILBOX_SYNC_/.test(String(error?.code || ''))) throw error;
      return recordFailure(key, uid, error);
    }
  }

  return { parseMessage };
}

module.exports = {
  MAILBOX_IMAP_PARSE_TIMEOUT_MS,
  MAILBOX_IMAP_SOURCE_MAX_BYTES,
  attachMailboxSyncReadHealth,
  attachMailboxSyncReadResult,
  createMailboxImapMessageParser,
};
