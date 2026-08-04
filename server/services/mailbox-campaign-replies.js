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
const CAMPAIGN_MESSAGE_SCAN_LIMIT = 250;
const CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT = 1000;
const CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT = 2000;
const CAMPAIGN_PARENT_MESSAGE_LOOKUP_LIMIT = 1000;
const CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE = 100;
const CAMPAIGN_UNREFERENCED_PARENT_WINDOW_MS = 15 * 60 * 1000;
const CAMPAIGN_SUBJECT_TERMS = Object.freeze([
  'Kleine vraag over jullie website',
  'Nieuw webdesign',
]);
const CAMPAIGN_INCOMING_FOLDERS = Object.freeze(['coldmail', 'inbox']);
const {
  getMailboxMessageDirection,
  getMessageSourceFolders,
  isSameMailboxIdentity,
  normalizeMessageProvenance,
} = require('./mailbox-message-provenance');
const {
  isAutomatedCampaignReply,
  normalizeClassifierText,
} = require('./mailbox-automated-reply');
const {
  getOutboundSenderIdentity,
} = require('./outbound-sender-identity');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getCampaignMailboxAccounts(owner) {
  const normalizedOwner = normalizeText(owner).toLowerCase().replace('servé', 'serve');
  if (!['serve', 'martijn'].includes(normalizedOwner)) return CAMPAIGN_MAILBOX_ACCOUNTS;
  return CAMPAIGN_MAILBOX_ACCOUNTS.filter(
    (accountEmail) => getOutboundSenderIdentity(accountEmail)?.profileKey === normalizedOwner
  );
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

function getCanonicalCampaignSubject(value) {
  const normalized = normalizeSubject(value);
  return CAMPAIGN_SUBJECT_TERMS
    .map((term) => normalizeSubject(term))
    .find((term) => normalized === term || normalized.endsWith(term)) || '';
}

function extractEmailAddresses(value) {
  const matches = normalizeText(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return Array.from(new Set(matches || []));
}

function getCampaignCounterpartyEmail(message) {
  const account = normalizeEmail(message && message.accountEmail);
  if (!account) return '';
  if (getMailboxMessageDirection(message) === 'sent') {
    const recipients = extractEmailAddresses(message && message.to)
      .filter((email) => !isSameMailboxIdentity(email, account));
    return recipients.length === 1 ? recipients[0] : '';
  }
  const sender = normalizeEmail(message && message.email);
  return sender && !isSameMailboxIdentity(sender, account) ? sender : '';
}

function getStableCampaignThreadKey(message) {
  const account = normalizeEmail(message && message.accountEmail);
  const counterparty = getCampaignCounterpartyEmail(message);
  const subject = getCanonicalCampaignSubject(message && message.subject);
  return account && counterparty && subject
    ? `${account}|${counterparty}|${subject}`
    : '';
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

function getMessageReferenceLookupValues(messages) {
  const values = new Set();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    [message && message.messageId, message && message.inReplyTo, message && message.references].forEach((rawValue) => {
      const source = normalizeText(rawValue);
      if (!source) return;
      const tokens = source.match(/<[^<>]+>/g) || source.split(/\s+/);
      tokens.forEach((token) => {
        const raw = normalizeText(token);
        const bare = raw.replace(/^<+|>+$/g, '');
        if (!bare) return;
        values.add(raw);
        values.add(bare);
        values.add(`<${bare}>`);
      });
    });
  });
  return Array.from(values).slice(0, CAMPAIGN_PARENT_MESSAGE_LOOKUP_LIMIT);
}

function getExactCrossAccountSentCopy(message, sentMessages) {
  const messageId = normalizeMessageId(message && message.messageId);
  const account = normalizeEmail(message && message.accountEmail);
  const sender = normalizeEmail(message && message.email);
  if (!messageId || !account || !sender) return null;
  return (Array.isArray(sentMessages) ? sentMessages : []).find((candidate) => (
    normalizeText(candidate && candidate.folder).toLowerCase() === 'sent' &&
    normalizeMessageId(candidate && candidate.messageId) === messageId &&
    normalizeEmail(candidate && candidate.accountEmail) !== account &&
    normalizeEmail(candidate && candidate.email) === sender
  )) || null;
}

function getExactCrossAccountCopyKind(conversation, sentCopy) {
  const copyAccountEmail = normalizeEmail(conversation && conversation.accountEmail);
  if (!copyAccountEmail || !sentCopy) return { kind: '', evidence: '' };
  if (extractEmailAddresses(sentCopy.bcc).includes(copyAccountEmail)) {
    return { kind: 'bcc', evidence: 'exact-bcc-recipient-and-cross-account-sent-message-id' };
  }
  if (extractEmailAddresses(sentCopy.cc).includes(copyAccountEmail)) {
    return { kind: 'cc', evidence: 'exact-cc-recipient-and-cross-account-sent-message-id' };
  }

  const sentDirectRecipients = new Set([
    ...extractEmailAddresses(sentCopy.to),
    ...extractEmailAddresses(sentCopy.cc),
  ]);
  const copiedDirectRecipients = new Set([
    ...extractEmailAddresses(conversation.to),
    ...extractEmailAddresses(conversation.cc),
  ]);
  const sentTargetRecipients = Array.from(sentDirectRecipients)
    .filter((email) => email !== normalizeEmail(sentCopy.accountEmail));
  const copiedTargetRecipients = Array.from(copiedDirectRecipients)
    .filter((email) => email !== copyAccountEmail);
  const hasExactStrippedBccProof = (
    conversation.recipientRoutingEvidenceKnown === true &&
    sentCopy.recipientRoutingEvidenceKnown === true &&
    sentTargetRecipients.length > 0 &&
    sentTargetRecipients.some((email) => copiedTargetRecipients.includes(email)) &&
    !sentDirectRecipients.has(copyAccountEmail) &&
    !copiedDirectRecipients.has(copyAccountEmail)
  );
  return hasExactStrippedBccProof
    ? { kind: 'bcc', evidence: 'exact-cross-account-message-id-with-stripped-bcc-header' }
    : { kind: '', evidence: '' };
}

function getExactMessageLineage(message, messages, maxDepth = 20) {
  const account = normalizeEmail(message && message.accountEmail);
  if (!account) return [];
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((candidate) => normalizeEmail(candidate && candidate.accountEmail) === account);
  const lineage = [];
  const seen = new Set();
  let current = message;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const referenceIds = getMessageReferenceIds(current);
    if (!referenceIds.length) break;
    const parent = candidates
      .filter((candidate) => (
        referenceIds.includes(normalizeMessageId(candidate && candidate.messageId)) &&
        parseMessageDate(candidate && candidate.date) < parseMessageDate(current && current.date)
      ))
      .sort((left, right) => parseMessageDate(right && right.date) - parseMessageDate(left && left.date))[0];
    if (!parent) break;
    const identity = getMessageIdentity(parent);
    if (!identity || seen.has(identity)) break;
    seen.add(identity);
    lineage.push(parent);
    current = parent;
  }
  return lineage.reverse();
}

function attachCrossAccountMailboxCopies(conversations, replies, sentMessages) {
  const allMessages = dedupeCampaignMessages([
    ...(Array.isArray(replies) ? replies : []),
    ...(Array.isArray(sentMessages) ? sentMessages : []),
  ]);
  const ancestorMessageIds = new Set();
  const enriched = (Array.isArray(conversations) ? conversations : []).map((conversation) => {
    const sentCopy = getExactCrossAccountSentCopy(conversation, sentMessages);
    if (!sentCopy) return conversation;
    const copyAccountEmail = normalizeEmail(conversation.accountEmail);
    const copyProof = getExactCrossAccountCopyKind(conversation, sentCopy);
    const copyKind = copyProof.kind;
    if (!copyKind) return conversation;
    const recipientEmail = extractEmailAddresses(sentCopy.to)
      .find((email) => email !== normalizeEmail(sentCopy.accountEmail)) || '';
    if (!recipientEmail || recipientEmail === normalizeEmail(conversation.accountEmail)) return conversation;
    const lineage = getExactMessageLineage(sentCopy, allMessages);
    lineage.forEach((message) => {
      const messageId = normalizeMessageId(message && message.messageId);
      if (messageId) ancestorMessageIds.add(messageId);
    });
    const recipientMessage = lineage.find((message) => (
      normalizeText(message && message.folder).toLowerCase() !== 'sent' &&
      normalizeEmail(message && message.email) === recipientEmail
    ));
    const rootMessageId = normalizeMessageId(conversation && conversation.messageId);
    const threadMessages = dedupeCampaignMessages([
      ...lineage,
      ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
    ])
      .filter((message) => normalizeMessageId(message && message.messageId) !== rootMessageId)
      .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
    return {
      ...conversation,
      copyContext: {
        evidenceKnown: true,
        kind: copyKind,
        sourceAccountEmail: normalizeEmail(sentCopy.accountEmail),
        sourceName: normalizeText(sentCopy.from),
        sourceEmail: normalizeEmail(sentCopy.email),
        recipientName: normalizeText(recipientMessage && recipientMessage.from),
        recipientEmail,
        copyAccountEmail,
        evidence: copyProof.evidence,
      },
      threadMessages,
    };
  });
  return enriched.filter((conversation) => (
    conversation.copyContext ||
    !ancestorMessageIds.has(normalizeMessageId(conversation && conversation.messageId))
  ));
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

function mergeCampaignConversationsByStableIdentity(conversations, sentMessages) {
  const sentByStableKey = new Map();
  dedupeCampaignMessages(sentMessages)
    .filter((message) => getMailboxMessageDirection(message) === 'sent')
    .forEach((message) => {
      const stableKey = getStableCampaignThreadKey(message);
      if (!stableKey) return;
      if (!sentByStableKey.has(stableKey)) sentByStableKey.set(stableKey, []);
      sentByStableKey.get(stableKey).push(message);
    });

  const groups = new Map();
  (Array.isArray(conversations) ? conversations : []).forEach((conversation, index) => {
    const stableKey = getStableCampaignThreadKey(conversation);
    const groupKey = stableKey
      ? `stable:${stableKey}`
      : `isolated:${conversation && conversation.conversationId || getMessageIdentity(conversation) || index}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { stableKey, conversations: [] });
    groups.get(groupKey).conversations.push(conversation);
  });

  return Array.from(groups.values()).map(({ stableKey, conversations: groupedConversations }) => {
    if (!stableKey) return groupedConversations[0];
    const stableSentMessages = sentByStableKey.get(stableKey) || [];
    const fallbackSentMessages = groupedConversations.length > 1 || stableSentMessages.length === 1
      ? stableSentMessages
      : [];
    const groupedMessages = groupedConversations.flatMap((conversation) => {
      const { threadMessages: nestedThreadMessages, ...rootMessage } = conversation || {};
      return [
        rootMessage,
        ...(Array.isArray(nestedThreadMessages)
          ? nestedThreadMessages.map((message) => {
              const { threadMessages: _nestedThreadMessages, ...flatMessage } = message || {};
              return flatMessage;
            })
          : []),
      ];
    });
    const groupedMessageIdentities = new Set(groupedMessages.map(getMessageIdentity).filter(Boolean));
    const messages = dedupeCampaignMessages([
      ...groupedMessages,
      ...fallbackSentMessages,
    ]);
    const primaryReply = messages
      .filter((message) => getMailboxMessageDirection(message) !== 'sent')
      .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left))[0] ||
      groupedConversations[0];
    const primaryIdentity = getMessageIdentity(primaryReply);
    const threadMessages = messages
      .filter((message) => getMessageIdentity(message) !== primaryIdentity)
      .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
    const latestActivity = [primaryReply, ...threadMessages]
      .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left))[0];
    const usedStableFallback = groupedConversations.length > 1 || fallbackSentMessages
      .some((message) => !groupedMessageIdentities.has(getMessageIdentity(message)));
    return {
      ...primaryReply,
      activityAt: normalizeText(latestActivity && (
        latestActivity.receivedAt ||
        latestActivity.internalDate ||
        latestActivity.date
      )),
      unread: messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .some((message) => Boolean(message && message.unread)),
      ...(usedStableFallback
        ? { threadCorrelationEvidence: 'exact-account-counterparty-campaign-subject' }
        : {}),
      threadMessages,
    };
  });
}

function isSentReplyForMessage(sentMessage, inboxMessage) {
  if (
    getMailboxMessageDirection(sentMessage) !== 'sent' ||
    normalizeEmail(sentMessage && sentMessage.accountEmail) !== normalizeEmail(inboxMessage && inboxMessage.accountEmail)
  ) {
    return false;
  }
  const sentAt = parseMessageDate(sentMessage && sentMessage.date);
  const inboxAt = parseMessageDate(inboxMessage && inboxMessage.date);
  if (!sentAt || !inboxAt || sentAt <= inboxAt) return false;

  return messageReferencesId(sentMessage, normalizeMessageId(inboxMessage && inboxMessage.messageId));
}

function attachSentThreadMessages(replies, sentMessages) {
  const sourceReplies = dedupeCampaignMessages(replies)
    .filter((message) => getMailboxMessageDirection(message) !== 'sent');
  const candidates = dedupeCampaignMessages(sentMessages)
    .filter((message) => getMailboxMessageDirection(message) === 'sent');
  const disjointSet = createConversationDisjointSet([...sourceReplies, ...candidates]);
  const replyGroups = new Map();

  sourceReplies.forEach((reply) => {
    const conversationId = getCampaignConversationId(reply, disjointSet);
    if (!conversationId) return;
    if (!replyGroups.has(conversationId)) replyGroups.set(conversationId, []);
    replyGroups.get(conversationId).push(reply);
  });

  const sentByConversation = new Map();
  candidates.forEach((message) => {
    const conversationId = getCampaignConversationId(message, disjointSet);
    if (!conversationId || !replyGroups.has(conversationId)) return;
    if (!sentByConversation.has(conversationId)) sentByConversation.set(conversationId, []);
    sentByConversation.get(conversationId).push(message);
  });

  const exactConversations = Array.from(replyGroups.entries())
    .map(([conversationId, groupedReplies]) => {
      const sortedReplies = groupedReplies
        .slice()
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const primaryReply = sortedReplies[0];
      const primaryIdentity = getMessageIdentity(primaryReply);
      const seen = new Set(primaryIdentity ? [primaryIdentity] : []);
      const exactSentMessages = sentByConversation.get(conversationId) || [];
      const strictUnreferencedParent = exactSentMessages.length
        ? null
        : getStrictUnreferencedCampaignParent(primaryReply, candidates);
      const threadMessages = dedupeCampaignMessages([
        ...sortedReplies.slice(1),
        ...exactSentMessages,
        ...(strictUnreferencedParent ? [strictUnreferencedParent] : []),
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
    });
  return mergeCampaignConversationsByStableIdentity(exactConversations, candidates)
    .sort((left, right) => getConversationTimestamp(right) - getConversationTimestamp(left));
}

function getStrictUnreferencedCampaignParent(reply, sentMessages) {
  if (!isAutomatedCampaignReply(reply) || getMessageReferenceIds(reply).length) return null;
  const account = normalizeEmail(reply && reply.accountEmail);
  const sender = normalizeEmail(reply && reply.email);
  const subject = getCanonicalCampaignSubject(reply && reply.subject);
  const replyAt = getMessageTimestamp(reply);
  if (!account || !sender || !subject || !replyAt) return null;

  const matches = (Array.isArray(sentMessages) ? sentMessages : [])
    .filter((message) => {
      if (getMailboxMessageDirection(message) !== 'sent') return false;
      if (normalizeEmail(message && message.accountEmail) !== account) return false;
      if (message && message.originalCampaignOutbound !== true) return false;
      if (getCanonicalCampaignSubject(message && message.subject) !== subject) return false;
      if (!extractEmailAddresses(message && message.to).includes(sender)) return false;
      const sentAt = getMessageTimestamp(message);
      return Boolean(
        sentAt &&
        sentAt < replyAt &&
        replyAt - sentAt <= CAMPAIGN_UNREFERENCED_PARENT_WINDOW_MS
      );
    })
    .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
  if (matches.length !== 1) return null;
  return {
    ...matches[0],
    threadCorrelationEvidence: 'exact-account-recipient-subject-nearby-auto-reply',
  };
}

function isCampaignReplySubject(message) {
  const subject = normalizeClassifierText(message && message.subject);
  return (
    subject.includes('kleine vraag over jullie website') ||
    subject.includes('nieuw webdesign')
  );
}

function dedupeCampaignMessages(messages) {
  const messagesByIdentity = new Map();
  (Array.isArray(messages) ? messages : []).forEach((rawMessage) => {
    const message = normalizeMessageProvenance(rawMessage);
    const messageId = normalizeMessageId(message && message.messageId);
    const account = normalizeEmail(message && message.accountEmail);
    const folder = normalizeText(message && message.folder).toLowerCase();
    const fallbackId = normalizeText(message && (message.uid || message.id));
    const key = messageId
      ? `${account}|message:${messageId}`
      : `${account}|folder:${folder}|item:${fallbackId}`;
    if (!key) return;
    const existing = messagesByIdentity.get(key);
    const sourceFolders = Array.from(new Set([
      ...(Array.isArray(existing?.sourceFolders) ? existing.sourceFolders : []),
      normalizeText(existing?.folder).toLowerCase(),
      ...(Array.isArray(message?.sourceFolders) ? message.sourceFolders : []),
      folder,
    ].filter(Boolean)));
    const existingDirection = getMailboxMessageDirection(existing);
    const candidateDirection = getMailboxMessageDirection(message);
    const preferCandidate = !existing ||
      (candidateDirection === 'sent' && existingDirection !== 'sent') ||
      (
        candidateDirection === existingDirection &&
        folder === 'coldmail' &&
        normalizeText(existing.storageFolder || existing.folder).toLowerCase() !== 'coldmail'
      );
    messagesByIdentity.set(key, normalizeMessageProvenance({
      ...(preferCandidate ? message : existing),
      sourceFolders,
    }));
  });
  return Array.from(messagesByIdentity.values());
}

function hasCampaignLabelProvenance(message) {
  return getMessageSourceFolders(message).includes('coldmail');
}

function isExternalCampaignMessage(message) {
  if (getMailboxMessageDirection(message) === 'sent') return false;
  const account = normalizeEmail(message && message.accountEmail);
  const sender = normalizeEmail(message && message.email);
  return Boolean(sender && (!account || !isSameMailboxIdentity(sender, account)));
}

function shouldShowCampaignMessage(message) {
  return hasCampaignLabelProvenance(message)
    ? isExternalCampaignMessage(message)
    : !isAutomatedCampaignReply(message);
}

async function listMessagesAcrossFolders({
  mailboxIndexStore,
  method,
  folders = CAMPAIGN_INCOMING_FOLDERS,
  options = {},
} = {}) {
  if (!mailboxIndexStore || typeof mailboxIndexStore[method] !== 'function') return [];
  const batches = await Promise.all(
    folders.map((folder) => mailboxIndexStore[method]({
      ...options,
      folder,
    }))
  );
  if (batches.some((batch) => !Array.isArray(batch))) return null;
  return dedupeCampaignMessages(batches.flat());
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

  async function listRepliesWithSnapshot({ limit = 100, owner = '', snapshotLimit = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(CAMPAIGN_REPLY_LIMIT, Number(limit) || 100));
    const safeSnapshotLimit = Math.max(
      0,
      Math.min(CAMPAIGN_REPLY_LIMIT, Number(snapshotLimit) || 0)
    );
    const selectedMailboxAccounts = getCampaignMailboxAccounts(owner);
    const campaignMailboxAccounts = safeSnapshotLimit
      ? CAMPAIGN_MAILBOX_ACCOUNTS
      : selectedMailboxAccounts;
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

    const recentMessages = await listMessagesAcrossFolders({
      mailboxIndexStore,
      method: 'listMessagesForAccounts',
      options: {
        accountEmails: campaignMailboxAccounts,
        limit: CAMPAIGN_MESSAGE_SCAN_LIMIT,
      },
    });
    const matchingMessages = typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
      ? await listMessagesAcrossFolders({
          mailboxIndexStore,
          method: 'listMatchingMessagesForAccounts',
          options: {
            accountEmails: campaignMailboxAccounts,
            subjectTerms: CAMPAIGN_SUBJECT_TERMS,
            limit: CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT,
          },
        })
      : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
        ? await listMessagesAcrossFolders({
            mailboxIndexStore,
            method: 'listAllMessagesForAccounts',
            options: {
              accountEmails: campaignMailboxAccounts,
              limit: CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT,
            },
          })
        : [];
    const messages = Array.isArray(recentMessages) && Array.isArray(matchingMessages)
      ? dedupeCampaignMessages([...recentMessages, ...matchingMessages])
      : null;
    if (!Array.isArray(messages)) {
      const error = new Error('Mailbox-index voor campagnereacties kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    if (!messages.length) return { messages: [], snapshotMessages: [] };

    const campaignMessages = dedupeCampaignMessages(
      messages
        .filter(shouldShowCampaignMessage)
        .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
    );
    if (!campaignMessages.length) return { messages: [], snapshotMessages: [] };

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
        if (
          !customer &&
          !isCampaignReplySubject(message) &&
          !hasCampaignLabelProvenance(message)
        ) {
          return null;
        }
        return buildCampaignReply(message, customer || null);
      })
      .filter(Boolean);

    const sentMessagesResult = await (
      typeof mailboxIndexStore.listMatchingMessagesForAccounts === 'function'
        ? mailboxIndexStore.listMatchingMessagesForAccounts({
            accountEmails: campaignMailboxAccounts,
            folder: 'sent',
            subjectTerms: CAMPAIGN_SUBJECT_TERMS,
            limit: CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
          })
        : typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
          ? mailboxIndexStore.listAllMessagesForAccounts({
              accountEmails: campaignMailboxAccounts,
              folder: 'sent',
              limit: CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
            })
          : mailboxIndexStore.listMessagesForAccounts({
              accountEmails: campaignMailboxAccounts,
              folder: 'sent',
              limit: CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
            })
    ).catch(() => []);
    const parentMessageIds = getMessageReferenceLookupValues(replies);
    const targetedParentMessagesResult = parentMessageIds.length &&
      typeof mailboxIndexStore.listMessagesByMessageIdsForAccounts === 'function'
      ? await mailboxIndexStore.listMessagesByMessageIdsForAccounts({
          accountEmails: campaignMailboxAccounts,
          folder: 'sent',
          messageIds: parentMessageIds,
        }).catch(() => [])
      : [];
    const sentMessages = dedupeCampaignMessages([
      ...(Array.isArray(sentMessagesResult) ? sentMessagesResult : []),
      ...(Array.isArray(targetedParentMessagesResult) ? targetedParentMessagesResult : []),
    ]);
    const allVisibleConversations = attachCrossAccountMailboxCopies(
      attachSentThreadMessages(replies, sentMessages),
      replies,
      sentMessages
    );
    const selectedAccountSet = new Set(selectedMailboxAccounts);
    const selectedConversations = allVisibleConversations
      .filter((conversation) => selectedAccountSet.has(normalizeEmail(conversation && conversation.accountEmail)))
      .slice(0, safeLimit);
    const snapshotConversations = safeSnapshotLimit
      ? allVisibleConversations.slice(0, safeSnapshotLimit)
      : [];

    async function hydrateVisibleConversations(conversations) {
      if (typeof mailboxIndexStore.hydrateMessageBodies !== 'function') return conversations;
      const hydratedMessages = [];
      for (let index = 0; index < conversations.length; index += CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE) {
        const batch = conversations.slice(index, index + CAMPAIGN_THREAD_HYDRATE_BATCH_SIZE);
        const hydrated = await mailboxIndexStore.hydrateMessageBodies({ messages: batch });
        hydratedMessages.push(...(Array.isArray(hydrated) ? hydrated : batch));
      }
      return hydratedMessages.filter(shouldShowCampaignMessage);
    }

    return {
      messages: await hydrateVisibleConversations(selectedConversations),
      snapshotMessages: await hydrateVisibleConversations(snapshotConversations),
    };
  }

  async function listReplies(options = {}) {
    const result = await listRepliesWithSnapshot(options);
    return result.messages;
  }

  return {
    listReplies,
    listRepliesWithSnapshot,
  };
}

module.exports = {
  CAMPAIGN_INCOMING_FOLDERS,
  CAMPAIGN_MAILBOX_ACCOUNTS,
  CAMPAIGN_MATCHING_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_PARENT_MESSAGE_LOOKUP_LIMIT,
  CAMPAIGN_REPLY_LIMIT,
  CAMPAIGN_SENT_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_SUBJECT_TERMS,
  attachSentThreadMessages,
  attachCrossAccountMailboxCopies,
  buildCampaignReply,
  createMailboxCampaignRepliesService,
  dedupeCampaignMessages,
  getStrictUnreferencedCampaignParent,
  getCampaignConversationId,
  getMessageReferenceIds,
  getMessageReferenceLookupValues,
  getExactCrossAccountSentCopy,
  getExactMessageLineage,
  getStableCampaignThreadKey,
  hasCampaignLabelProvenance,
  isAutomatedCampaignReply,
  isCampaignReplySubject,
  isExternalCampaignMessage,
  isSentReplyForMessage,
  isOwnMailboxCampaignCustomer,
  isWebdesignCampaignCustomer,
  listMessagesAcrossFolders,
  mergeCampaignConversationsByStableIdentity,
  normalizeOutreachStatus,
  shouldShowCampaignMessage,
};
