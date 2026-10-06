'use strict';

const { getOutboundSenderIdentity } = require('./outbound-sender-identity');
const CONTACT_FORM_ACCOUNT = 'info@softora.nl';
const CONTACT_FORM_SUBJECT = 'Nieuwe contactaanvraag via Softora.nl - ';
const normalize = (value) => String(value || '').trim().toLowerCase();
const messageId = (value) => normalize(value).replace(/^<+|>+$/g, '');
const references = (mail) => (String(`${mail.inReplyTo || ''} ${mail.references || ''}`).match(/<[^<>]+>|[^\s,<>]+@[^\s,<>]+/g) || []).map(messageId);
const email = (value) => normalize(value).match(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/)?.[0] || '';
const time = (mail) => Date.parse(mail.date || '') || 0;

// The shared service inbox is a mailbox sender, never a coldmail sender.
function getMailboxSenderIdentity(account) {
  return getOutboundSenderIdentity(account) || (normalize(account) === CONTACT_FORM_ACCOUNT
    ? { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' } : null);
}

function isContactFormRequest(mail) {
  return normalize(mail.accountEmail) === CONTACT_FORM_ACCOUNT && mail.folder !== 'sent' &&
    String(mail.subject || '').startsWith(CONTACT_FORM_SUBJECT) &&
    Boolean(email(mail.replyTo)) && email(mail.replyTo) !== CONTACT_FORM_ACCOUNT &&
    !references(mail).length;
}

function uniqueMessages(messages) {
  const result = new Map();
  for (const mail of messages) {
    const key = messageId(mail.messageId) || mail.messageKey || `${mail.accountEmail}|${mail.id}`;
    if (!result.has(key)) result.set(key, mail);
  }
  return [...result.values()];
}

function buildContactFormConversations(messages) {
  const source = uniqueMessages(messages).filter((mail) => normalize(mail.accountEmail) === CONTACT_FORM_ACCOUNT);
  return source.filter(isContactFormRequest).map((root) => {
    const contact = email(root.replyTo);
    const ids = new Set([messageId(root.messageId)].filter(Boolean));
    const thread = [];
    for (let depth = 0; depth < 20; depth += 1) {
      const next = source.filter((mail) => mail !== root && !thread.includes(mail) &&
        references(mail).some((id) => ids.has(id)) &&
        (normalize(mail.email) === contact || email(mail.replyTo) === contact ||
          (mail.folder === 'sent' && (normalize(mail.to).match(/[^\s<>",;]+@[^\s<>",;]+/g) || []).includes(contact))));
      if (!next.length) break;
      next.forEach((mail) => { thread.push(mail); if (messageId(mail.messageId)) ids.add(messageId(mail.messageId)); });
    }
    const activityAt = [root, ...thread].sort((a, b) => time(b) - time(a))[0].date;
    const conversationId = `contact-form:${messageId(root.messageId) || root.messageKey || root.id}`;
    return { ...root, from: String(root.subject).slice(CONTACT_FORM_SUBJECT.length).trim() || contact,
      email: contact, externalContactEmail: contact, contactFormSource: true, direction: 'received', conversationId, activityAt,
      threadMessages: thread.sort((a, b) => time(b) - time(a)).map((mail) => ({ ...mail, conversationId, contactFormSource: true })),
    };
  }).sort((a, b) => Date.parse(b.activityAt || '') - Date.parse(a.activityAt || ''));
}

function createMailboxContactFormService({ mailboxIndexStore, enrichMessages = async (messages) => messages, logger = console } = {}) {
  async function list({ query = '', limit = 200, cursor = '' } = {}) {
    const q = normalize(query);
    if (q.length > 160 || (q && q.length < 2)) throw Object.assign(new Error('Gebruik 2 tot 160 tekens om te zoeken.'), { status: 400 });
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 4000) throw Object.assign(new Error('Ongeldige paginering.'), { status: 400 });
    const roots = await mailboxIndexStore.listMatchingMessagesForAccounts({
      accountEmails: [CONTACT_FORM_ACCOUNT], folder: 'inbox', subjectTerms: [CONTACT_FORM_SUBJECT], limit: 4000, priorityRead: true,
    });
    if (!Array.isArray(roots)) throw Object.assign(new Error('De formuliermailbox is tijdelijk niet beschikbaar.'), { status: 503 });
    const seeds = roots.filter(isContactFormRequest);
    let messages = buildContactFormConversations(seeds);
    let pendingIds = seeds.map((mail) => messageId(mail.messageId)).filter(Boolean);
    const visitedIds = new Set(pendingIds);
    let source = seeds;
    // Some replies contain only In-Reply-To, so walk each proven reply chain.
    for (let depth = 0; pendingIds.length && depth < 20; depth += 1) {
      const batches = Array.from({ length: Math.ceil(pendingIds.length / 2000) }, (_, i) => pendingIds.slice(i * 2000, (i + 1) * 2000));
      const descendants = await Promise.all(batches.flatMap((messageIds) => ['inbox', 'sent', 'allmail'].map((folder) =>
        mailboxIndexStore.listMessagesReferencingMessageIdsForAccounts({ accountEmails: [CONTACT_FORM_ACCOUNT], folder, messageIds, priorityRead: true })
      )));
      if (descendants.some((rows) => !Array.isArray(rows))) throw Object.assign(new Error('De formuliergesprekken zijn tijdelijk niet beschikbaar.'), { status: 503 });
      source = uniqueMessages([...source, ...descendants.flat()]);
      messages = buildContactFormConversations(source);
      pendingIds = [...new Set(messages.flatMap((mail) => mail.threadMessages).map((mail) => messageId(mail.messageId)).filter((id) => id && !visitedIds.has(id)))];
      pendingIds.forEach((id) => visitedIds.add(id));
    }
    if (q) {
      const hydrated = await mailboxIndexStore.hydrateMessageBodies({ messages: uniqueMessages(messages.flatMap((mail) => [mail, ...mail.threadMessages])) });
      const bodies = new Map(hydrated.map((mail) => [messageId(mail.messageId) || mail.messageKey, mail.body || '']));
      messages = messages.filter((mail) => [mail, ...mail.threadMessages].some((entry) => normalize([
        mail.from, mail.externalContactEmail, entry.subject, entry.preview, bodies.get(messageId(entry.messageId) || entry.messageKey),
      ].join(' ')).includes(q)));
    }
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 200));
    return { ok: true, messages: await enrichMessages(messages.slice(offset, offset + safeLimit)), totalCount: messages.length,
      nextCursor: offset + safeLimit < messages.length ? String(offset + safeLimit) : null,
      sync: { indexed: true, source: 'contact-form-index', stale: false, warming: false, refreshRecommended: false },
    };
  }
  async function response(req, res) {
    try { return res.status(200).json(await list({ query: req.query?.q, limit: req.query?.limit, cursor: req.query?.cursor })); }
    catch (error) { logger.error('[Mailbox][ContactForm]', error?.message); return res.status(error.status || 500).json({ ok: false, error: error.status === 400 ? error.message : 'Contactformulier laden mislukt. Probeer opnieuw.' }); }
  }
  return { list, response };
}

module.exports = { CONTACT_FORM_ACCOUNT, CONTACT_FORM_SUBJECT, buildContactFormConversations, createMailboxContactFormService, getMailboxSenderIdentity, isContactFormRequest };
