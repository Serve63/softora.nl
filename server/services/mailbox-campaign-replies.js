const CAMPAIGN_MAILBOX_ACCOUNTS = Object.freeze([
  'serve@softora.nl',
  'servecreusen@softora.nl',
  'servec321@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'martijn@softora.nl',
  'martijnvandeven@softora.nl',
  'martijnven123@gmail.com',
  'contact.venvisuals@gmail.com',
]);

const CAMPAIGN_REPLY_LIMIT = 200;
const CAMPAIGN_MESSAGE_SCAN_LIMIT = 2000;
const CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT = 500;
const CAMPAIGN_THREAD_MESSAGE_LIMIT = 10;
const CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE = 10;
const CAMPAIGN_THREAD_FALLBACK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeMessageId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^<+|>+$/g, '');
}

function normalizeSubject(value) {
  return normalizeClassifierText(value)
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, '')
    .trim();
}

function extractEmailAddresses(value) {
  const matches = normalizeText(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return Array.from(new Set(matches || []));
}

function parseMessageDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageReferencesId(message, messageId) {
  if (!messageId) return false;
  const references = [
    message && message.inReplyTo,
    message && message.references,
  ].map((value) => normalizeText(value).toLowerCase());
  return references.some((value) => value
    .split(/\s+/)
    .map(normalizeMessageId)
    .includes(messageId));
}

function isSentReplyForMessage(sentMessage, inboxMessage) {
  if (
    normalizeText(sentMessage && sentMessage.folder).toLowerCase() !== 'sent' ||
    normalizeEmail(sentMessage && sentMessage.accountEmail) !== normalizeEmail(inboxMessage && inboxMessage.accountEmail)
  ) {
    return false;
  }
  const sentAt = parseMessageDate(sentMessage && sentMessage.date);
  const inboxAt = parseMessageDate(inboxMessage && inboxMessage.date);
  if (!sentAt || !inboxAt || sentAt <= inboxAt) return false;

  const inboxMessageId = normalizeMessageId(inboxMessage && inboxMessage.messageId);
  if (messageReferencesId(sentMessage, inboxMessageId)) return true;

  const senderEmail = normalizeEmail(inboxMessage && inboxMessage.email);
  const recipients = extractEmailAddresses(sentMessage && sentMessage.to);
  const sameSubject = normalizeSubject(sentMessage && sentMessage.subject) === normalizeSubject(inboxMessage && inboxMessage.subject);
  return Boolean(
    senderEmail &&
    recipients.includes(senderEmail) &&
    sameSubject &&
    sentAt - inboxAt <= CAMPAIGN_THREAD_FALLBACK_WINDOW_MS
  );
}

function attachSentThreadMessages(replies, sentMessages) {
  const sourceReplies = Array.isArray(replies) ? replies : [];
  const candidates = dedupeCampaignMessages(sentMessages)
    .filter((message) => normalizeText(message && message.folder).toLowerCase() === 'sent');
  const messagesByReply = new Map(sourceReplies.map((reply) => [reply, []]));
  const repliesByMessageId = new Map();
  const repliesByFallbackKey = new Map();
  sourceReplies.forEach((reply) => {
    const messageId = normalizeMessageId(reply && reply.messageId);
    if (messageId) {
      repliesByMessageId.set(`${normalizeEmail(reply && reply.accountEmail)}|${messageId}`, reply);
    }
    const fallbackKey = [
      normalizeEmail(reply && reply.accountEmail),
      normalizeEmail(reply && reply.email),
      normalizeSubject(reply && reply.subject),
    ].join('|');
    if (!repliesByFallbackKey.has(fallbackKey)) repliesByFallbackKey.set(fallbackKey, []);
    repliesByFallbackKey.get(fallbackKey).push(reply);
  });
  repliesByFallbackKey.forEach((repliesForKey) => {
    repliesForKey.sort((left, right) => parseMessageDate(right && right.date) - parseMessageDate(left && left.date));
  });
  candidates.forEach((message) => {
    const referenceIds = [
      message && message.inReplyTo,
      message && message.references,
    ]
      .flatMap((value) => normalizeText(value).toLowerCase().split(/\s+/))
      .map(normalizeMessageId)
      .filter(Boolean);
    const directReply = referenceIds
      .map((messageId) => repliesByMessageId.get(
        `${normalizeEmail(message && message.accountEmail)}|${messageId}`
      ))
      .find(Boolean);
    const recipients = extractEmailAddresses(message && message.to);
    const fallbackReplies = recipients.flatMap((recipient) => (
      repliesByFallbackKey.get([
        normalizeEmail(message && message.accountEmail),
        recipient,
        normalizeSubject(message && message.subject),
      ].join('|')) || []
    ));
    const reply = directReply || fallbackReplies.find((candidate) => isSentReplyForMessage(message, candidate));
    if (!reply) return;
    const threadMessages = messagesByReply.get(reply);
    threadMessages.push(message);
  });
  return sourceReplies.map((reply) => ({
    ...reply,
    threadMessages: messagesByReply.get(reply)
      .sort((left, right) => parseMessageDate(left && left.date) - parseMessageDate(right && right.date))
      .slice(-CAMPAIGN_THREAD_MESSAGE_LIMIT),
  }));
}

function normalizeClassifierText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isAutomatedCampaignReply(message) {
  const subject = normalizeClassifierText(message && message.subject);
  const content = normalizeClassifierText([
    message && message.preview,
    message && message.body,
  ].filter(Boolean).join(' '));

  const automatedSubjectPatterns = [
    /\bautomatisch antwoord\b/,
    /\bautomatic (?:reply|response)\b/,
    /\bauto[ -]?reply\b/,
    /\bout[ -]?of[ -]?office\b/,
    /\bafwezigheid(?:sbericht|melding)?\b/,
    /\breturned mail\b/,
    /\bundeliverable\b/,
    /\bmail delivery (?:failure|failed)\b/,
    /\bdelivery status notification\b/,
    /^email received\b/,
    /^bericht ontvangen\b/,
    /\buw mail is ontvangen\b/,
  ];
  const automatedContentPatterns = [
    /\bdit (?:bericht|e-mail|email) is automatisch gegenereerd\b/,
    /\bdit is een automatisch bericht\b/,
    /\bwe would like to acknowledge that we have received your request\b/,
    /\bis ons kantoor gesloten\b/,
    /\bop dit moment ben ik op vakantie\b/,
    /\bberichten worden (?:in deze periode )?niet gelezen\b/,
  ];

  return (
    automatedSubjectPatterns.some((pattern) => pattern.test(subject)) ||
    automatedContentPatterns.some((pattern) => pattern.test(content))
  );
}

function isCampaignReplySubject(message) {
  const subject = normalizeClassifierText(message && message.subject);
  return (
    subject.includes('kleine vraag over jullie website') ||
    subject.includes('nieuw webdesign')
  );
}

function dedupeCampaignMessages(messages) {
  const seen = new Set();
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    const messageId = normalizeMessageId(message && message.messageId);
    if (!messageId) return true;
    const key = `${normalizeEmail(message && message.accountEmail)}|${messageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeOutreachStatus(value) {
  const key = normalizeKey(value);
  if (['reactie_ontvangen', 'reply_received', 'action_required', 'actie_nodig'].includes(key)) {
    return 'reactie_ontvangen';
  }
  if (['interesse', 'interested', 'geinteresseerd'].includes(key)) return 'interesse';
  if (['geen_interesse', 'geblokkeerd', 'opt_out', 'unsubscribe'].includes(key)) {
    return 'geen_interesse';
  }
  if (['afgehaakt', 'lost', 'no_deal', 'geendeal'].includes(key)) return 'afgehaakt';
  if (['geen_gehoor', 'geengehoor', 'no_answer'].includes(key)) return 'geen_gehoor';
  if (['klant_geworden', 'klant', 'customer'].includes(key)) return 'klant_geworden';
  if (['benaderd', 'gemaild', 'sent', 'mailed'].includes(key)) return 'benaderd';
  return '';
}

function isWebdesignCampaignCustomer(customer) {
  if (!customer || typeof customer !== 'object') return false;
  return [
    customer.campaignType,
    customer.campaign_type,
    customer.outreachCampaignType,
    customer.outreach_campaign_type,
    customer.coldmailSpecialAction,
  ].some((value) => ['webdesign', 'website_design'].includes(normalizeKey(value)));
}

function isOwnMailboxCampaignCustomer(customer) {
  return (
    isWebdesignCampaignCustomer(customer) &&
    normalizeKey(customer && customer.lastColdmailProvider) !== 'instantly'
  );
}

function isDefinitiveOutreachCustomer(customer) {
  const definitive = ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'];
  const outreachStatus = normalizeOutreachStatus(customer && customer.outreachStatus);
  const databaseStatus = normalizeOutreachStatus(
    customer && (customer.databaseStatus || customer.status)
  );
  return definitive.includes(outreachStatus) || definitive.includes(databaseStatus);
}

function getCustomerCompany(customer, fallbackName, fallbackEmail) {
  return (
    normalizeText(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam)) ||
    normalizeText(fallbackName) ||
    normalizeEmail(fallbackEmail) ||
    'Onbekend bedrijf'
  );
}

function buildCampaignReply(message, customer) {
  const account = normalizeEmail(message && message.accountEmail);
  const email = normalizeEmail(message && message.email);
  const company = getCustomerCompany(customer, message && message.from, email);
  const customerId = normalizeText(customer && (customer.id || customer.customerId));
  const status = normalizeOutreachStatus(customer && customer.outreachStatus) || 'reactie_ontvangen';
  const actionRequired = !isDefinitiveOutreachCustomer(customer);
  return {
    ...message,
    mailboxId: normalizeText(message && message.id),
    accountEmail: account,
    campaign: {
      company,
      account,
      customerId,
      status,
      actionRequired,
    },
    outreach: actionRequired && customerId
      ? {
          customerId,
          company,
          email,
          status,
        }
      : null,
  };
}

function createMailboxCampaignRepliesService(deps = {}) {
  const {
    mailboxIndexStore = null,
    dataOpsStore = null,
  } = deps;

  async function listReplies({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(CAMPAIGN_REPLY_LIMIT, Number(limit) || 100));
    if (!mailboxIndexStore || typeof mailboxIndexStore.listMessagesForAccounts !== 'function') {
      const error = new Error('Mailbox-index voor campagnereacties is niet beschikbaar.');
      error.status = 503;
      throw error;
    }
    if (!dataOpsStore || typeof dataOpsStore.listCustomersByEmails !== 'function') {
      const error = new Error('Klantkoppeling voor campagnereacties is niet beschikbaar.');
      error.status = 503;
      throw error;
    }

    const messages = await mailboxIndexStore.listMessagesForAccounts({
      accountEmails: CAMPAIGN_MAILBOX_ACCOUNTS,
      folder: 'inbox',
      limit: CAMPAIGN_MESSAGE_SCAN_LIMIT,
    });
    if (!Array.isArray(messages)) {
      const error = new Error('Mailbox-index voor campagnereacties kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    if (!messages.length) return [];

    const campaignMessages = dedupeCampaignMessages(
      messages
        .filter((message) => !isAutomatedCampaignReply(message))
        .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
    );
    if (!campaignMessages.length) return [];

    const senderEmails = Array.from(
      new Set(campaignMessages.map((message) => normalizeEmail(message && message.email)).filter(Boolean))
    );
    const customers = await dataOpsStore.listCustomersByEmails({
      emails: senderEmails,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(customers)) {
      const error = new Error('Klantkoppeling voor campagnereacties kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }

    const campaignCustomerByEmail = new Map();
    customers.forEach((customer) => {
      const email = normalizeEmail(customer && (customer.email || customer.contactEmail));
      if (email && !campaignCustomerByEmail.has(email) && isOwnMailboxCampaignCustomer(customer)) {
        campaignCustomerByEmail.set(email, customer);
      }
    });

    let replies = campaignMessages
      .map((message) => {
        const customer = campaignCustomerByEmail.get(normalizeEmail(message && message.email));
        if (!customer && !isCampaignReplySubject(message)) return null;
        return buildCampaignReply(message, customer || null);
      })
      .filter(Boolean)
      .slice(0, safeLimit);

    const sentMessagesResult = await mailboxIndexStore.listMessagesForAccounts({
      accountEmails: CAMPAIGN_MAILBOX_ACCOUNTS,
      folder: 'sent',
      limit: CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
    }).catch(() => []);
    const sentMessages = Array.isArray(sentMessagesResult) ? sentMessagesResult : [];
    if (typeof mailboxIndexStore.hydrateMessageBodies !== 'function') {
      return attachSentThreadMessages(replies, sentMessages);
    }
    const hydratedReplies = await mailboxIndexStore.hydrateMessageBodies({ messages: replies });
    replies = (Array.isArray(hydratedReplies) ? hydratedReplies : replies)
      .filter((message) => !isAutomatedCampaignReply(message));
    const matchedSentMessages = dedupeCampaignMessages(
      replies.flatMap((reply) => sentMessages.filter((message) => isSentReplyForMessage(message, reply)))
    );
    const hydratedSentMessages = [];
    for (let index = 0; index < matchedSentMessages.length; index += CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE) {
      const batch = matchedSentMessages.slice(index, index + CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE);
      const hydrated = await mailboxIndexStore.hydrateMessageBodies({ messages: batch });
      hydratedSentMessages.push(...(Array.isArray(hydrated) ? hydrated : batch));
    }
    return attachSentThreadMessages(replies, hydratedSentMessages);
  }

  return {
    listReplies,
  };
}

module.exports = {
  CAMPAIGN_MAILBOX_ACCOUNTS,
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_REPLY_LIMIT,
  CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_THREAD_MESSAGE_LIMIT,
  attachSentThreadMessages,
  buildCampaignReply,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  isAutomatedCampaignReply,
  isCampaignReplySubject,
  isSentReplyForMessage,
  isOwnMailboxCampaignCustomer,
  isWebdesignCampaignCustomer,
  normalizeOutreachStatus,
};
