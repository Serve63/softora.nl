const crypto = require('node:crypto');

const AUDIT_FOLDERS = Object.freeze(['inbox', 'coldmail', 'sent']);
const MESSAGE_ID_PATTERN = /<[^<>\s]+>/g;

function normalizeMessageId(value) {
  return String(value || '').trim().toLowerCase();
}

function extractMessageIds(...values) {
  return Array.from(new Set(values.flatMap((value) => {
    const text = Array.isArray(value) ? value.join(' ') : String(value || '');
    const bracketed = text.match(MESSAGE_ID_PATTERN);
    return (bracketed && bracketed.length ? bracketed : text.split(/\s+/))
      .map(normalizeMessageId)
      .filter(Boolean);
  })));
}

function extractEmails(value) {
  return Array.from(new Set((String(value || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [])));
}

function messageHasParticipant(message, participantEmail) {
  const participant = String(participantEmail || '').trim().toLowerCase();
  if (!participant) return false;
  return [message?.email, message?.from, message?.to, message?.cc, message?.bcc, message?.deliveredTo]
    .flatMap(extractEmails)
    .includes(participant);
}

function getMessageIdentityValues(message) {
  return extractMessageIds(message?.messageId, message?.inReplyTo, message?.references);
}

function selectConnectedMessages(messages, participantEmail, seedMessageIds = []) {
  const source = Array.isArray(messages) ? messages : [];
  const connectedIds = new Set(seedMessageIds.map(normalizeMessageId).filter(Boolean));
  const selected = new Set();
  if (!connectedIds.size) return [];

  let changed = true;
  while (changed) {
    changed = false;
    source.forEach((message, index) => {
      if (selected.has(index)) return;
      const identities = getMessageIdentityValues(message);
      if (!identities.some((identity) => connectedIds.has(identity))) return;
      selected.add(index);
      identities.forEach((identity) => connectedIds.add(identity));
      changed = true;
    });
  }
  const result = Array.from(selected).sort((left, right) => left - right).map((index) => source[index]);
  return result.some((message) => messageHasParticipant(message, participantEmail)) ? result : [];
}

function getDirection(message, accountEmail) {
  const account = String(accountEmail || '').trim().toLowerCase();
  if (String(message?.folder || '').trim().toLowerCase() === 'sent') return 'outbound';
  return extractEmails(message?.email).includes(account) ? 'outbound' : 'inbound';
}

function toSafeInventory(messages, { accountEmail, provider }) {
  const byIdentity = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const messageId = String(message?.messageId || '').trim();
    const normalizedMessageId = normalizeMessageId(messageId);
    const folder = String(message?.folder || '').trim().toLowerCase();
    const uid = Number(message?.uid) || 0;
    const identity = normalizedMessageId || `${folder}:${uid}`;
    if (!identity) continue;
    const current = byIdentity.get(identity) || {
      provider,
      accountEmail,
      direction: getDirection(message, accountEmail),
      messageId,
      parentMessageIds: extractMessageIds(message?.inReplyTo, message?.references),
      timestamp: String(message?.date || ''),
      hasBody: Boolean(message?.hasBody ?? message?.body),
      bodyTruncated: Boolean(message?.bodyTruncated),
      copies: [],
    };
    current.hasBody = current.hasBody || Boolean(message?.hasBody ?? message?.body);
    current.bodyTruncated = current.bodyTruncated || Boolean(message?.bodyTruncated);
    current.copies.push({ folder, uid });
    byIdentity.set(identity, current);
  }
  return Array.from(byIdentity.values())
    .map((message) => ({
      ...message,
      copies: message.copies.sort((left, right) => left.folder.localeCompare(right.folder) || left.uid - right.uid),
    }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.messageId.localeCompare(right.messageId));
}

function compareInventories(indexInventory, providerInventory) {
  const indexIds = new Set(indexInventory.map((message) => normalizeMessageId(message.messageId)).filter(Boolean));
  const providerIds = new Set(providerInventory.map((message) => normalizeMessageId(message.messageId)).filter(Boolean));
  return {
    matches: indexIds.size > 0 && indexIds.size === providerIds.size && [...indexIds].every((messageId) => providerIds.has(messageId)),
    missingInIndex: providerInventory.filter((message) => message.messageId && !indexIds.has(normalizeMessageId(message.messageId))).map((message) => message.messageId),
    missingInProvider: indexInventory.filter((message) => message.messageId && !providerIds.has(normalizeMessageId(message.messageId))).map((message) => message.messageId),
  };
}

function createMailboxProviderThreadAuditService({
  assertReadableAccount,
  fetchMessagesFromImap,
  isValidEmail,
  logger = console,
  mailboxIndexStore,
} = {}) {
  async function listIndexedMessages(accountEmail) {
    if (!mailboxIndexStore || typeof mailboxIndexStore.listMessagesForAccounts !== 'function') {
      const error = new Error('Mailboxindex is niet beschikbaar voor provideraudit.');
      error.status = 503;
      throw error;
    }
    const folders = await Promise.all(AUDIT_FOLDERS.map(async (folder) => {
      const messages = await mailboxIndexStore.listMessagesForAccounts({ accountEmails: [accountEmail], folder, limit: 2000 });
      if (!Array.isArray(messages)) {
        const error = new Error(`Mailboxindex kon map ${folder} niet lezen.`);
        error.status = 503;
        throw error;
      }
      return messages;
    }));
    return folders.flat();
  }

  async function auditProviderThread({ accountEmail, participantEmail, anchorMessageId }) {
    const account = assertReadableAccount(accountEmail);
    const participant = String(participantEmail || '').trim().toLowerCase();
    const anchor = normalizeMessageId(anchorMessageId);
    if (!isValidEmail(participant)) {
      const error = new Error('Geef één geldig extern e-mailadres op voor de provideraudit.');
      error.status = 400;
      throw error;
    }
    if (!anchor || !extractMessageIds(anchor).includes(anchor)) {
      const error = new Error('Geef het exacte Message-ID van één bericht uit de conversatie op.');
      error.status = 400;
      throw error;
    }

    const indexedSource = await listIndexedMessages(account.email);
    const indexedMessages = selectConnectedMessages(indexedSource, participant, [anchor]);
    if (!indexedMessages.length) {
      const error = new Error('Het ankerbericht hoort niet bij deze mailbox en deelnemer of staat niet in de mailboxindex.');
      error.status = 404;
      error.code = 'MAILBOX_PROVIDER_THREAD_ANCHOR_NOT_FOUND';
      throw error;
    }
    const seedMessageIds = Array.from(new Set(indexedMessages.flatMap(getMessageIdentityValues)));
    const providerFolders = [];
    for (const folder of AUDIT_FOLDERS) {
      const messages = await fetchMessagesFromImap({
        account,
        folder,
        limit: 100,
        threadReferenceIds: seedMessageIds,
        threadRecipientTerms: [participant],
        prioritizeTargetedUids: true,
        logImapOperation: true,
      });
      providerFolders.push(...messages);
    }
    const providerMessages = selectConnectedMessages(providerFolders, participant, seedMessageIds);
    const indexInventory = toSafeInventory(indexedMessages, { accountEmail: account.email, provider: 'softora-index' });
    const providerInventory = toSafeInventory(providerMessages, { accountEmail: account.email, provider: 'imap-live' });
    const comparison = compareInventories(indexInventory, providerInventory);
    const correlationId = crypto.randomUUID();
    logger.info?.('[Mailbox][ProviderThreadAudit]', {
      correlationId,
      accountHash: crypto.createHash('sha256').update(account.email).digest('hex').slice(0, 16),
      participantHash: crypto.createHash('sha256').update(participant).digest('hex').slice(0, 16),
      anchorHash: crypto.createHash('sha256').update(anchor).digest('hex').slice(0, 16),
      indexUnique: indexInventory.length,
      providerUnique: providerInventory.length,
      matches: comparison.matches,
    });
    return {
      correlationId,
      accountEmail: account.email,
      participantHash: crypto.createHash('sha256').update(participant).digest('hex'),
      folders: AUDIT_FOLDERS.slice(),
      counts: {
        indexCopies: indexedMessages.length,
        indexUnique: indexInventory.length,
        providerCopies: providerMessages.length,
        providerUnique: providerInventory.length,
      },
      comparison,
      indexInventory,
      providerInventory,
    };
  }

  async function providerThreadAuditResponse(req, res) {
    try {
      const result = await auditProviderThread({
        accountEmail: req.body?.account,
        participantEmail: req.body?.participant,
        anchorMessageId: req.body?.anchorMessageId,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error?.('[Mailbox][ProviderThreadAudit]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Gerichte providercontrole mislukt',
        code: error.code || 'MAILBOX_PROVIDER_THREAD_AUDIT_FAILED',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return { auditProviderThread, providerThreadAuditResponse };
}

module.exports = {
  AUDIT_FOLDERS,
  compareInventories,
  createMailboxProviderThreadAuditService,
  extractMessageIds,
  messageHasParticipant,
  selectConnectedMessages,
  toSafeInventory,
};
