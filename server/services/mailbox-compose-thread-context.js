const crypto = require('crypto');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

function normalizeMessageId(value) {
  const text = normalizeText(value);
  return !text || (text.startsWith('<') && text.endsWith('>')) ? text : `<${text.replace(/[<>]/g, '')}>`;
}

function parseReferences(value) {
  const source = Array.isArray(value) ? value.join(' ') : normalizeText(value);
  return Array.from(new Set((source.match(/<[^<>\s]+>/g) || []).map(normalizeMessageId).filter(Boolean)));
}

function createPlannedMessageId(accountEmail, randomUUID = crypto.randomUUID) {
  const domain = normalizeEmail(accountEmail).split('@')[1]?.replace(/[^a-z0-9.-]/g, '') || 'softora.nl';
  return `<softora-${randomUUID()}@${domain}>`;
}

function createMailboxComposeThreadContext(deps = {}) {
  const { mailboxIndexStore = null, getOwnerIdentity = getOutboundSenderIdentity, randomUUID = crypto.randomUUID } = deps;

  function inputError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function resolveOwner(accountEmail, requestedOwner) {
    const identity = getOwnerIdentity(accountEmail);
    const owner = normalizeText(identity && identity.profileKey).toLowerCase();
    const requested = normalizeText(requestedOwner).toLowerCase();
    const aggregateSelection = requested === 'both' || requested === 'all';
    if (!owner || (requested && !aggregateSelection && requested !== owner)) {
      throw inputError('Het gekozen afzenderaccount hoort niet bij de geselecteerde mailbox.', 'MAILBOX_SEND_OWNER_MISMATCH', 403);
    }
    return { owner, senderName: normalizeText(identity && identity.name) || normalizeEmail(accountEmail) };
  }

  function baseContext({ account, recipient, owner, senderName, mode, conversationId, idempotencyKey, provider }) {
    return {
      accountEmail: account, recipientEmail: recipient, owner, senderName, mode, conversationId, idempotencyKey,
      intentId: `send:${randomUUID()}`, messageId: createPlannedMessageId(account, randomUUID),
      provider: normalizeText(provider || 'smtp').toLowerCase(),
    };
  }

  async function resolve({ body = {}, accountEmail, recipientEmail, provider = 'smtp' } = {}) {
    const mode = normalizeText(body.mode || 'new-message').toLowerCase();
    if (!['reply', 'new-message'].includes(mode)) throw inputError('Ongeldige verzendmodus.', 'MAILBOX_SEND_MODE_INVALID');
    const account = normalizeEmail(accountEmail);
    const recipient = normalizeEmail(recipientEmail);
    const { owner, senderName } = resolveOwner(account, body.owner);
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const conversationId = normalizeText(context.conversationId).slice(0, 2000);
    const idempotencyKey = normalizeText(body.idempotencyKey).slice(0, 240);
    if (!idempotencyKey) throw inputError('Een veilige verzend-ID ontbreekt.', 'MAILBOX_SEND_IDEMPOTENCY_REQUIRED');
    const base = baseContext({ account, recipient, owner, senderName, mode, conversationId, idempotencyKey, provider });
    if (mode === 'new-message') {
      return { ...base, providerThreadId: '', replyTargetMessageId: '', references: '' };
    }
    if (!conversationId) {
      throw inputError('De gekozen conversatie mist een exacte thread-ID.', 'MAILBOX_REPLY_CONVERSATION_REQUIRED', 409);
    }
    if (normalizeText(provider).toLowerCase() === 'instantly') {
      const providerMessageId = normalizeText(body.providerMessageId);
      const providerThreadId = normalizeText(body.providerThreadId);
      if (!providerMessageId || !providerThreadId) {
        throw inputError('De exacte Instantly-thread ontbreekt.', 'INSTANTLY_REPLY_THREAD_REQUIRED', 409);
      }
      return { ...base, provider: 'instantly', providerThreadId, replyTargetMessageId: providerMessageId, references: providerMessageId };
    }
    if (!mailboxIndexStore || typeof mailboxIndexStore.getMessage !== 'function') {
      throw inputError('De mailbox-index is niet beschikbaar om het replydoel te bewijzen.', 'MAILBOX_REPLY_TARGET_UNAVAILABLE', 503);
    }
    const folder = normalizeText(context.folder || 'inbox').toLowerCase();
    const id = normalizeText(context.id || context.uid);
    if (!id || folder === 'sent') {
      throw inputError('Selecteer een echt ontvangen bericht om te beantwoorden.', 'MAILBOX_REPLY_TARGET_INVALID', 409);
    }
    const stored = await mailboxIndexStore.getMessage({ accountEmail: account, folder, id });
    const storedMessageId = normalizeMessageId(stored && stored.messageId);
    const clientMessageId = normalizeMessageId(context.messageId);
    const targetMismatch = !stored || !storedMessageId || (clientMessageId && clientMessageId !== storedMessageId) ||
      normalizeEmail(stored.accountEmail) !== account || normalizeEmail(stored.email) !== recipient;
    if (targetMismatch) {
      throw inputError('Het antwoorddoel wijkt af van het bewezen mailboxbericht.', 'MAILBOX_REPLY_TARGET_MISMATCH', 409);
    }
    const references = Array.from(new Set([
      ...parseReferences(stored.references), ...parseReferences(stored.inReplyTo), storedMessageId,
    ])).join(' ');
    return { ...base, provider: 'smtp', providerThreadId: '', replyTargetMessageId: storedMessageId, references };
  }

  return { resolve };
}

module.exports = { createMailboxComposeThreadContext, createPlannedMessageId, normalizeMessageId, parseReferences };
