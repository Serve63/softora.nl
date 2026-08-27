const crypto = require('crypto');
const { getOutboundSenderIdentity } = require('./outbound-sender-identity');

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const PERSONAL_OWNERS = new Set(['serve', 'martijn']);
const AGGREGATE_OWNERS = new Set(['both', 'all']);
const REPLY_IDENTITY_VERSION = 1;

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
  const {
    mailboxIndexStore = null,
    instantlyMailboxService = null,
    getOwnerIdentity = getOutboundSenderIdentity,
    randomUUID = crypto.randomUUID,
  } = deps;

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

  function requestedOwnerMatches(owner, requestedOwner) {
    const requested = normalizeText(requestedOwner).toLowerCase();
    return !requested || AGGREGATE_OWNERS.has(requested) || requested === owner;
  }

  function normalizeReplyIdentity(body = {}, fallbackProvider = 'smtp') {
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const source = body.replyIdentity && typeof body.replyIdentity === 'object'
      ? body.replyIdentity
      : context.replyIdentity && typeof context.replyIdentity === 'object'
        ? context.replyIdentity
        : {};
    const provider = normalizeText(source.provider || context.provider || body.provider || fallbackProvider || 'smtp').toLowerCase();
    const accountEmail = normalizeEmail(
      source.accountEmail || source.providerAccountEmail || context.providerAccountEmail || context.accountEmail || body.account
    );
    return {
      version: REPLY_IDENTITY_VERSION,
      provider,
      owner: normalizeText(source.owner || context.providerOwner || body.owner).toLowerCase(),
      accountEmail,
      providerAccountEmail: normalizeEmail(source.providerAccountEmail || context.providerAccountEmail || accountEmail),
      providerMessageId: normalizeText(source.providerMessageId || context.providerMessageId || body.providerMessageId),
      providerThreadId: normalizeText(source.providerThreadId || context.providerThreadId || body.providerThreadId),
      sourceMessageId: normalizeMessageId(source.sourceMessageId || context.messageId),
      conversationId: normalizeText(source.conversationId || context.conversationId).slice(0, 2000),
    };
  }

  async function resolveReplyIdentity({ body = {}, accountEmail, recipientEmail, provider = 'smtp', mode = 'reply' } = {}) {
    const normalizedMode = normalizeText(mode || body.mode || 'reply').toLowerCase();
    const identity = normalizeReplyIdentity(body, provider);
    if (normalizedMode !== 'reply') {
      const account = normalizeEmail(accountEmail || body.account);
      const resolved = resolveOwner(account, body.owner);
      return {
        ...identity,
        provider: 'smtp',
        owner: resolved.owner,
        senderName: resolved.senderName,
        accountEmail: account,
        providerAccountEmail: '',
        providerMessageId: '',
        providerThreadId: '',
      };
    }
    if (identity.provider === 'instantly') {
      const owner = identity.owner;
      const providerAccountEmail = identity.providerAccountEmail || identity.accountEmail;
      if (!PERSONAL_OWNERS.has(owner) || !requestedOwnerMatches(owner, body.owner)) {
        throw inputError('De Instantly-afzenderidentiteit hoort niet bij de geselecteerde mailbox.', 'INSTANTLY_REPLY_IDENTITY_MISMATCH', 403);
      }
      if (!providerAccountEmail || !identity.providerMessageId || !identity.providerThreadId) {
        throw inputError('De Instantly-threadidentiteit is onvolledig; open het bericht opnieuw.', 'INSTANTLY_REPLY_IDENTITY_MISMATCH', 403);
      }
      const configuredAccounts = instantlyMailboxService?.getConfiguredAccounts?.(owner) || [];
      if (!configuredAccounts.some((account) => normalizeEmail(account?.email) === providerAccountEmail)) {
        throw inputError('Het Instantly-afzenderaccount hoort niet bij de geselecteerde mailbox.', 'INSTANTLY_REPLY_IDENTITY_MISMATCH', 403);
      }
      if (typeof instantlyMailboxService?.assertStoredMessageOwnership !== 'function') {
        throw inputError('De duurzame Instantly-threadcontrole ontbreekt.', 'INSTANTLY_REPLY_IDENTITY_UNAVAILABLE', 503);
      }
      const stored = await instantlyMailboxService.assertStoredMessageOwnership({
        owner,
        accountEmail: providerAccountEmail,
        providerMessageId: identity.providerMessageId,
        providerThreadId: identity.providerThreadId,
      });
      const recipient = normalizeEmail(recipientEmail);
      if (recipient && normalizeEmail(stored?.email) && normalizeEmail(stored.email) !== recipient) {
        throw inputError('De ontvanger wijkt af van het bewezen Instantly-bericht.', 'INSTANTLY_REPLY_RECIPIENT_MISMATCH', 409);
      }
      return {
        ...identity,
        owner,
        senderName: owner === 'martijn' ? 'Martijn van de Ven' : 'Servé Creusen',
        accountEmail: providerAccountEmail,
        providerAccountEmail,
      };
    }
    const account = identity.accountEmail || normalizeEmail(accountEmail || body.account);
    const resolved = resolveOwner(account, body.owner);
    return {
      ...identity,
      provider: 'smtp',
      owner: resolved.owner,
      senderName: resolved.senderName,
      accountEmail: account,
      providerAccountEmail: '',
      providerMessageId: '',
      providerThreadId: '',
    };
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
    const recipient = normalizeEmail(recipientEmail);
    const replyIdentity = await resolveReplyIdentity({ body, accountEmail, recipientEmail, provider, mode });
    const account = replyIdentity.accountEmail;
    const { owner, senderName } = replyIdentity;
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const conversationId = normalizeText(replyIdentity.conversationId || context.conversationId).slice(0, 2000);
    const idempotencyKey = normalizeText(body.idempotencyKey).slice(0, 240);
    if (!idempotencyKey) throw inputError('Een veilige verzend-ID ontbreekt.', 'MAILBOX_SEND_IDEMPOTENCY_REQUIRED');
    const base = baseContext({ account, recipient, owner, senderName, mode, conversationId, idempotencyKey, provider });
    if (mode === 'new-message') {
      return { ...base, providerThreadId: '', replyTargetMessageId: '', references: '' };
    }
    if (!conversationId) {
      throw inputError('De gekozen conversatie mist een exacte thread-ID.', 'MAILBOX_REPLY_CONVERSATION_REQUIRED', 409);
    }
    if (replyIdentity.provider === 'instantly') {
      const providerMessageId = replyIdentity.providerMessageId;
      const providerThreadId = replyIdentity.providerThreadId;
      if (!providerMessageId || !providerThreadId) {
        throw inputError('De exacte Instantly-thread ontbreekt.', 'INSTANTLY_REPLY_THREAD_REQUIRED', 409);
      }
      return { ...base, provider: 'instantly', providerThreadId, replyTargetMessageId: providerMessageId, references: providerMessageId };
    }
    const hasProofReader = mailboxIndexStore && (
      typeof mailboxIndexStore.getMessageForReplyProof === 'function' ||
      typeof mailboxIndexStore.getMessage === 'function'
    );
    if (!hasProofReader) {
      throw inputError('De mailbox-index is niet beschikbaar om het replydoel te bewijzen.', 'MAILBOX_REPLY_TARGET_UNAVAILABLE', 503);
    }
    const folder = normalizeText(context.folder || 'inbox').toLowerCase();
    const id = normalizeText(context.id || context.uid);
    if (!id || folder === 'sent') {
      throw inputError('Selecteer een echt ontvangen bericht om te beantwoorden.', 'MAILBOX_REPLY_TARGET_INVALID', 409);
    }
    const proofReader = typeof mailboxIndexStore.getMessageForReplyProof === 'function'
      ? mailboxIndexStore.getMessageForReplyProof.bind(mailboxIndexStore)
      : mailboxIndexStore.getMessage.bind(mailboxIndexStore);
    let stored = null;
    try {
      stored = await proofReader({ accountEmail: account, folder, id });
    } catch (_) {
      throw inputError(
        'Het exacte mailboxbericht kon tijdelijk niet worden gecontroleerd; probeer opnieuw.',
        'MAILBOX_REPLY_TARGET_UNAVAILABLE',
        503
      );
    }
    const storedMessageId = normalizeMessageId(stored && stored.messageId);
    const clientMessageId = normalizeMessageId(replyIdentity.sourceMessageId || context.messageId);
    const storedReplyTarget = normalizeEmail(stored && (stored.replyTo || stored.email));
    const targetMismatch = !stored || !storedMessageId || (clientMessageId && clientMessageId !== storedMessageId) ||
      normalizeEmail(stored.accountEmail) !== account || storedReplyTarget !== recipient;
    if (targetMismatch) {
      throw inputError('Het antwoorddoel wijkt af van het bewezen mailboxbericht.', 'MAILBOX_REPLY_TARGET_MISMATCH', 409);
    }
    const references = Array.from(new Set([
      ...parseReferences(stored.references), ...parseReferences(stored.inReplyTo), storedMessageId,
    ])).join(' ');
    return { ...base, provider: 'smtp', providerThreadId: '', replyTargetMessageId: storedMessageId, references };
  }

  function resolveAttachmentCleanupBinding({ body = {}, accountEmail, recipientEmail, provider = 'smtp' } = {}) {
    const mode = normalizeText(body.mode || 'new-message').toLowerCase();
    if (!['reply', 'new-message'].includes(mode)) {
      throw inputError('Ongeldige verzendmodus.', 'MAILBOX_SEND_MODE_INVALID');
    }
    const idempotencyKey = normalizeText(body.idempotencyKey).slice(0, 240);
    if (!idempotencyKey) {
      throw inputError('Een veilige verzend-ID ontbreekt.', 'MAILBOX_SEND_IDEMPOTENCY_REQUIRED');
    }
    const recipient = normalizeEmail(recipientEmail || body.to);
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const replyIdentity = normalizeReplyIdentity(body, provider);
    if (mode === 'reply' && replyIdentity.provider === 'instantly') {
      throw inputError(
        'Instantly ondersteunt geen bijlagen bij antwoorden.',
        'INSTANTLY_ATTACHMENTS_UNSUPPORTED'
      );
    }
    const account = mode === 'reply'
      ? normalizeEmail(replyIdentity.accountEmail || accountEmail || body.account)
      : normalizeEmail(accountEmail || body.account);
    const resolved = resolveOwner(account, body.owner);
    const conversationId = normalizeText(
      mode === 'reply' ? replyIdentity.conversationId || context.conversationId : context.conversationId
    ).slice(0, 2000);
    const replyTargetMessageId = mode === 'reply'
      ? normalizeMessageId(replyIdentity.sourceMessageId || context.messageId)
      : '';
    if (mode === 'reply' && (!conversationId || !replyTargetMessageId)) {
      throw inputError(
        'De reply mist de lokaal gebonden cleanupcontext.',
        'MAILBOX_ATTACHMENT_CLEANUP_CONTEXT_INVALID',
        409
      );
    }
    return {
      accountEmail: account,
      recipientEmail: recipient,
      owner: resolved.owner,
      senderName: resolved.senderName,
      mode,
      conversationId,
      idempotencyKey,
      provider: 'smtp',
      providerThreadId: '',
      replyTargetMessageId,
      references: mode === 'reply'
        ? parseReferences(context.references).concat(replyTargetMessageId).filter(Boolean).join(' ')
        : '',
    };
  }

  return {
    normalizeReplyIdentity,
    resolve,
    resolveAttachmentCleanupBinding,
    resolveReplyIdentity,
  };
}

module.exports = {
  REPLY_IDENTITY_VERSION,
  createMailboxComposeThreadContext,
  createPlannedMessageId,
  normalizeMessageId,
  parseReferences,
};
