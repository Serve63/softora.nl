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
const CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT = 2000;
const CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE = 100;
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

function getMessageTimestamp(message) {
  return parseMessageDate(message && (
    message.receivedAt ||
    message.internalDate ||
    message.date
  ));
}

function getConversationTimestamp(message) {
  return parseMessageDate(message && message.activityAt) || getMessageTimestamp(message);
}

function messageReferencesId(message, messageId) {
  if (!messageId) return false;
  return getMessageReferenceIds(message).includes(messageId);
}

function getMessageReferenceIds(message) {
  return Array.from(new Set([
    message && message.references,
    message && message.inReplyTo,
  ]
    .flatMap((value) => normalizeText(value).toLowerCase().split(/\s+/))
    .map(normalizeMessageId)
    .filter(Boolean)));
}

function getMessageIdentity(message) {
  const account = normalizeEmail(message && message.accountEmail);
  const messageId = normalizeMessageId(message && message.messageId);
  if (account && messageId) return `${account}|message:${messageId}`;
  const mailboxId = normalizeText(message && (message.mailboxId || message.id));
  return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
}

function createConversationDisjointSet(messages) {
  const parents = new Map();

  function find(value) {
    const key = normalizeText(value);
    if (!key) return '';
    if (!parents.has(key)) parents.set(key, key);
    const parent = parents.get(key);
    if (parent === key) return key;
    const root = find(parent);
    parents.set(key, root);
    return root;
  }

  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (!leftRoot || !rightRoot || leftRoot === rightRoot) return;
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    const child = root === leftRoot ? rightRoot : leftRoot;
    parents.set(child, root);
  }

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const account = normalizeEmail(message && message.accountEmail);
    if (!account) return;
    const messageId = normalizeMessageId(message && message.messageId);
    const referenceIds = getMessageReferenceIds(message);
    const nodes = [messageId, ...referenceIds]
      .filter(Boolean)
      .map((value) => `${account}|${value}`);
    if (!nodes.length) return;
    nodes.forEach((node) => find(node));
    nodes.slice(1).forEach((node) => union(nodes[0], node));
  });

  return { find };
}

function getCampaignConversationId(message, disjointSet) {
  const account = normalizeEmail(message && message.accountEmail);
  if (!account) return getMessageIdentity(message);
  const messageId = normalizeMessageId(message && message.messageId);
  const referenceIds = getMessageReferenceIds(message);
  const node = [messageId, ...referenceIds].find(Boolean);
  if (node) {
    const resolved = disjointSet && typeof disjointSet.find === 'function'
      ? disjointSet.find(`${account}|${node}`)
      : `${account}|${referenceIds[0] || messageId}`;
    return resolved ? `conversation:${resolved}` : '';
  }
  const mailboxId = normalizeText(message && (message.mailboxId || message.id));
  if (mailboxId) return `conversation:${account}|mailbox:${mailboxId}`;
  return [
    'conversation',
    account,
    normalizeEmail(message && message.email),
    normalizeSubject(message && message.subject),
  ].join(':');
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

function getCampaignContactEmail(message) {
  const folder = normalizeText(message && message.folder).toLowerCase();
  const account = normalizeEmail(message && message.accountEmail);
  if (folder !== 'sent') return normalizeEmail(message && message.email);
  return extractEmailAddresses(message && message.to)
    .find((email) => email && email !== account) || '';
}

function getContactConversationId(message, contactEmail = getCampaignContactEmail(message)) {
  const account = normalizeEmail(message && message.accountEmail);
  const contact = normalizeEmail(contactEmail);
  return account && contact ? `conversation:${account}|contact:${contact}` : '';
}

function attachSentThreadMessages(replies, sentMessages) {
  const sourceReplies = dedupeCampaignMessages(replies)
    .filter((message) => normalizeText(message && message.folder).toLowerCase() !== 'sent');
  const candidates = dedupeCampaignMessages(sentMessages)
    .filter((message) => normalizeText(message && message.folder).toLowerCase() === 'sent');
  const replyGroups = new Map();

  sourceReplies.forEach((reply) => {
    const conversationId = getContactConversationId(reply);
    if (!conversationId) return;
    if (!replyGroups.has(conversationId)) replyGroups.set(conversationId, []);
    replyGroups.get(conversationId).push(reply);
  });

  const sentByConversation = new Map();
  candidates.forEach((message) => {
    const account = normalizeEmail(message && message.accountEmail);
    const recipients = extractEmailAddresses(message && message.to);
    recipients.forEach((contactEmail) => {
      const conversationId = getContactConversationId(
        { ...message, accountEmail: account },
        contactEmail
      );
      if (!conversationId || !replyGroups.has(conversationId)) return;
      if (!sentByConversation.has(conversationId)) sentByConversation.set(conversationId, []);
      sentByConversation.get(conversationId).push(message);
    });
  });

  return Array.from(replyGroups.entries())
    .map(([conversationId, groupedReplies]) => {
      const sortedReplies = groupedReplies
        .slice()
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const primaryReply = sortedReplies[0];
      const primaryIdentity = getMessageIdentity(primaryReply);
      const seen = new Set(primaryIdentity ? [primaryIdentity] : []);
      const threadMessages = dedupeCampaignMessages([
        ...sortedReplies.slice(1),
        ...(sentByConversation.get(conversationId) || []),
      ])
        .filter((message) => {
          const identity = getMessageIdentity(message);
          if (!identity) return true;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        })
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const latestActivity = [primaryReply, ...threadMessages]
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left))[0];
      return {
        ...primaryReply,
        conversationId,
        activityAt: normalizeText(latestActivity && (
          latestActivity.receivedAt ||
          latestActivity.internalDate ||
          latestActivity.date
        )),
        unread: sortedReplies.some((reply) => Boolean(reply && reply.unread)),
        threadMessages,
      };
    })
    .sort((left, right) => getConversationTimestamp(right) - getConversationTimestamp(left));
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
    /\bautomatische (?:e-?mail|mail|reactie|ontvangstbevestiging)\b/,
    /\bontvangstbevestiging\b/,
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
    /\bdit is (?:een )?automatisch(?:e)? (?:e-?mail|mail|bericht|antwoord|reactie|ontvangstbevestiging)\b/,
    /\bthis is an automated (?:e-?mail|mail|message|reply|response)\b/,
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

    const hasCompleteAccountHistory = typeof mailboxIndexStore.listAllMessagesForAccounts === 'function';
    const listMessagesForAccounts = hasCompleteAccountHistory
      ? mailboxIndexStore.listAllMessagesForAccounts.bind(mailboxIndexStore)
      : mailboxIndexStore.listMessagesForAccounts.bind(mailboxIndexStore);
    const messages = await listMessagesForAccounts({
      accountEmails: CAMPAIGN_MAILBOX_ACCOUNTS,
      folder: 'inbox',
      ...(hasCompleteAccountHistory ? {} : { limit: CAMPAIGN_MESSAGE_SCAN_LIMIT }),
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

    const replies = campaignMessages
      .map((message) => {
        const customer = campaignCustomerByEmail.get(normalizeEmail(message && message.email));
        if (!customer && !isCampaignReplySubject(message)) return null;
        return buildCampaignReply(message, customer || null);
      })
      .filter(Boolean);

    const sentMessagesResult = await listMessagesForAccounts({
      accountEmails: CAMPAIGN_MAILBOX_ACCOUNTS,
      folder: 'sent',
      ...(hasCompleteAccountHistory ? {} : { limit: CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT }),
    }).catch(() => []);
    const sentMessages = Array.isArray(sentMessagesResult) ? sentMessagesResult : [];
    const candidateConversationLimit = Math.min(CAMPAIGN_REPLY_LIMIT, safeLimit * 2);
    const candidateConversations = attachSentThreadMessages(replies, sentMessages)
      .slice(0, candidateConversationLimit);
    if (typeof mailboxIndexStore.hydrateMessageBodies !== 'function') {
      return candidateConversations.slice(0, safeLimit);
    }
    const selectedMessages = dedupeCampaignMessages(
      candidateConversations.flatMap((conversation) => [
        conversation,
        ...(Array.isArray(conversation && conversation.threadMessages) ? conversation.threadMessages : []),
      ])
    );
    const hydratedMessages = [];
    for (let index = 0; index < selectedMessages.length; index += CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE) {
      const batch = selectedMessages.slice(index, index + CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE);
      const hydrated = await mailboxIndexStore.hydrateMessageBodies({ messages: batch });
      hydratedMessages.push(...(Array.isArray(hydrated) ? hydrated : batch));
    }
    const hydratedReplies = hydratedMessages.filter((message) => (
      normalizeText(message && message.folder).toLowerCase() !== 'sent' &&
      !isAutomatedCampaignReply(message)
    ));
    const hydratedSentMessages = hydratedMessages.filter((message) => (
      normalizeText(message && message.folder).toLowerCase() === 'sent'
    ));
    return attachSentThreadMessages(hydratedReplies, hydratedSentMessages).slice(0, safeLimit);
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
  attachSentThreadMessages,
  buildCampaignReply,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  getCampaignConversationId,
  getMessageReferenceIds,
  isAutomatedCampaignReply,
  isCampaignReplySubject,
  isSentReplyForMessage,
  isOwnMailboxCampaignCustomer,
  isWebdesignCampaignCustomer,
  normalizeOutreachStatus,
};
