const quotedThread = require('../../assets/premium-mailbox-quoted-thread.js');
const { isOriginalCampaignOutboundMessage } = require('./mailbox-image-ownership');
const { isExactSoftoraWebdesignUrl } = require('./mailbox-provider-rich-body');
const { OUTBOUND_SENDER_IDENTITIES } = require('./outbound-sender-identity');
const { normalizeMailboxAttachmentsMetadata } = require('./mailbox-send-provenance-store');
const QUOTED_PARENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const LEGACY_GUARD_LOOKUP_BATCH_SIZE = 100;
const RECOVERY_HYDRATION_BATCH_SIZE = 20;
const LEGACY_QUOTED_TIME_ZONE = 'Europe/Amsterdam';

const LEGACY_MONTH_NUMBERS = Object.freeze({
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, maart: 3, mrt: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
});

function findStructuredQuoteStart(value) {
  const parsed = quotedThread.findQuotedSegments(value);
  const segment = parsed.segments[0] || null;
  return { lines: parsed.lines, index: segment ? segment.start : -1, segment };
}

function normalizeQuotedMatchText(value) {
  return quotedThread.normalizeMatchText(value);
}

function extractQuotedRecipientEmails(value, extractEmailAddresses) {
  const parsed = findStructuredQuoteStart(value);
  if (parsed.index < 0) return [];
  const fields = quotedThread.extractHeaderFields(parsed.segment.displayLines);
  return Array.from(new Set(fields.to.flatMap(extractEmailAddresses)));
}

function createMailboxCampaignThreadRecovery(helpers = {}) {
  const {
    dedupeCampaignMessages,
    extractEmailAddresses,
    getCanonicalCampaignSubject,
    getAccountDisplayName,
    getAccountOwner,
    getMailboxMessageDirection,
    getMessageIdentity,
    getMessageReferenceIds,
    getMessageTimestamp,
    normalizeEmail,
    normalizeMessageId,
    normalizeText,
    resolveConversationActivity,
  } = helpers;

  function accountsShareOwner(left, right) {
    if (typeof getAccountOwner !== 'function') return false;
    const leftOwner = normalizeText(getAccountOwner(normalizeEmail(left))).toLowerCase();
    const rightOwner = normalizeText(getAccountOwner(normalizeEmail(right))).toLowerCase();
    return Boolean(leftOwner && rightOwner && leftOwner === rightOwner);
  }

  function getQuotedMessageTimestamp(message) {
    const source = message && typeof message === 'object' ? message : {};
    for (const value of [source.receivedAt, source.internalDate, source.date, source.activityAt]) {
      const timestamp = Date.parse(value || '');
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return 0;
  }

  function extractQuotedSenderEmails(value) {
    const parsed = findStructuredQuoteStart(value);
    if (parsed.index < 0) return [];
    const fields = quotedThread.extractHeaderFields(parsed.segment.displayLines);
    return Array.from(new Set([
      parsed.segment.header,
      ...fields.from,
      ...fields.replyTo,
    ].flatMap(extractEmailAddresses)));
  }

  function getDirectParentIds(message) {
    const source = normalizeText(message && message.inReplyTo).toLowerCase();
    if (!source) return [];
    return Array.from(new Set(
      (source.match(/<[^<>]+>/g) || source.split(/[,\s]+/))
        .map(normalizeMessageId)
        .filter(Boolean)
    ));
  }

  function getConsistentValue(source, keys, normalizer) {
    const values = Array.from(new Set(keys
      .map((key) => source && source[key])
      .map(normalizer)
      .filter(Boolean)));
    return values.length === 1 ? values[0] : '';
  }

  function normalizeTimestamp(value) {
    const timestamp = Date.parse(normalizeText(value));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
  }

  function getLegacyCustomerEvidence(customer) {
    if (!customer || typeof customer !== 'object') return null;
    const messageId = getConsistentValue(
      customer,
      ['coldmailSentMessageId', 'outreachMessageId'],
      normalizeMessageId
    );
    const senderEmail = getConsistentValue(
      customer,
      ['lastColdmailSenderEmail', 'sentFromEmail', 'sent_from_email', 'outreachSentFromEmail'],
      normalizeEmail
    );
    const recipientEmail = getConsistentValue(
      customer,
      ['email', 'contactEmail'],
      normalizeEmail
    );
    const sentAt = getConsistentValue(
      customer,
      ['outreachSentAt', 'outreach_sent_at'],
      normalizeTimestamp
    );
    const customerId = getConsistentValue(
      customer,
      ['id', 'customerId'],
      normalizeText
    );
    if (!messageId || !senderEmail || !recipientEmail || !sentAt || !customerId) return null;
    return { customer, customerId, messageId, recipientEmail, senderEmail, sentAt };
  }

  function getLegacyGuardEvidence(group) {
    const source = group && typeof group === 'object' ? group : {};
    const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
    if (
      normalizeText(source.status).toLowerCase() !== 'sent' ||
      source.permanent !== true ||
      normalizeText(source.key_type).toLowerCase() !== 'email' ||
      !normalizeEmail(source.key_value) ||
      payload.postSmtpReconciled !== true
    ) return null;
    const senderEmail = getConsistentValue(
      { row: source.sender_email, payload: payload.senderEmail },
      ['row', 'payload'],
      normalizeEmail
    );
    const recipientEmail = getConsistentValue(
      {
        key: source.key_value,
        row: source.recipient_email,
        payload: payload.recipientEmail,
      },
      ['key', 'row', 'payload'],
      normalizeEmail
    );
    const customerId = getConsistentValue(
      { row: source.recipient_id, payload: payload.customerId },
      ['row', 'payload'],
      normalizeText
    );
    const messageId = normalizeMessageId(payload.messageId);
    const sentAt = normalizeTimestamp(payload.sentAt);
    const subject = normalizeText(payload.expectedSubject);
    const canonicalSubject = getCanonicalCampaignSubject(subject);
    if (
      !senderEmail || !recipientEmail || !customerId || !messageId ||
      !sentAt || !canonicalSubject
    ) return null;
    return {
      canonicalSubject,
      customerId,
      group: source,
      messageId,
      recipientEmail,
      senderEmail,
      sentAt,
      subject,
    };
  }

  function getEffectiveQuotedSegments(value) {
    const parsed = quotedThread.findQuotedSegments(value);
    return parsed.segments.map((segment) => {
      if (segment.marker !== 'quote-prefix' || !Number.isInteger(segment.start)) return segment;

      let wroteIndex = segment.start - 1;
      let skippedBlankLines = 0;
      while (wroteIndex >= 0 && !quotedThread.cleanHeaderLine(parsed.lines[wroteIndex])) {
        skippedBlankLines += 1;
        if (skippedBlankLines > 1) return segment;
        wroteIndex -= 1;
      }
      const introIndex = wroteIndex - 1;
      if (introIndex < 0) return segment;
      const intro = quotedThread.cleanHeaderLine(parsed.lines[introIndex]);
      const wrote = quotedThread.cleanHeaderLine(parsed.lines[wroteIndex]);
      if (!/^wrote\s*:\s*$/i.test(wrote)) return segment;
      const combinedHeader = `${intro} ${wrote}`;
      const replyHeader = quotedThread.parseReplyHeaderLine(combinedHeader);
      if (!replyHeader || replyHeader.remainder) return segment;
      const reparsed = quotedThread.findQuotedSegments(
        `${combinedHeader}\n${segment.rawText}`
      );
      if (
        reparsed.segments.length !== 1 ||
        reparsed.segments[0].marker !== 'reply-header'
      ) return segment;
      return reparsed.segments[0];
    });
  }

  function getEffectiveQuotedSegment(value, requireUnique = false) {
    const segments = getEffectiveQuotedSegments(value);
    if (!segments.length || (requireUnique && segments.length !== 1)) return null;
    return segments[0];
  }

  function normalizeLegacyMonth(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/\.$/, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeLocalTimestampParts(parts) {
    const year = Number(parts && parts.year);
    const month = Number(parts && parts.month);
    const day = Number(parts && parts.day);
    const hour = Number(parts && parts.hour);
    const minute = Number(parts && parts.minute);
    if (
      year < 1900 || year > 2100 || month < 1 || month > 12 ||
      day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59
    ) return null;
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) return null;
    return { year, month, day, hour, minute };
  }

  function parseLegacyLocalTimestamp(value) {
    const source = normalizeText(value).replace(/[\u00a0\u202f]/g, ' ');
    const numeric = /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})\b/.exec(source) ||
      /\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})\s+(\d{1,2}):(\d{2})\b/.exec(source);
    if (numeric) {
      const yearFirst = numeric[1].length === 4;
      return normalizeLocalTimestampParts({
        year: yearFirst ? numeric[1] : numeric[3], month: numeric[2],
        day: yearFirst ? numeric[3] : numeric[1], hour: numeric[4], minute: numeric[5],
      });
    }
    const english = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?\s*,?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),\s*((?:19|20)\d{2})\s+(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?\b/i.exec(source);
    if (english) {
      let hour = Number(english[4]);
      const meridiem = normalizeText(english[6]).toLowerCase();
      if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        if (meridiem === 'a' && hour === 12) hour = 0;
        if (meridiem === 'p' && hour !== 12) hour += 12;
      }
      return normalizeLocalTimestampParts({
        year: english[3],
        month: LEGACY_MONTH_NUMBERS[normalizeLegacyMonth(english[1])],
        day: english[2],
        hour,
        minute: english[5],
      });
    }

    const dutch = /\b(\d{1,2})\s+(jan(?:uari)?|feb(?:ruari)?|mrt|maa?rt|mar(?:ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|aug(?:ustus|ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+((?:19|20)\d{2})(?:\s+(?:om|at))?\s+(\d{1,2}):(\d{2})\b/i.exec(source);
    if (!dutch) return null;
    return normalizeLocalTimestampParts({
      year: dutch[3],
      month: LEGACY_MONTH_NUMBERS[normalizeLegacyMonth(dutch[2])],
      day: dutch[1],
      hour: dutch[4],
      minute: dutch[5],
    });
  }

  function parseMonthFirstZonedTimestamp(value) {
    const source = normalizeText(value).replace(/[\u00a0\u202f]/g, ' ');
    const match = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?\s*,?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),\s*((?:19|20)\d{2})\s+(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?\s+([a-z]{2,10}|[+-][^\s,;)]*)(?=\s|$|[),;])/i.exec(source);
    if (!match) return null;

    let hour = Number(match[4]);
    const meridiem = normalizeText(match[6]).toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return { absoluteMs: null };
      if (meridiem === 'a' && hour === 12) hour = 0;
      if (meridiem === 'p' && hour !== 12) hour += 12;
    }
    const parts = normalizeLocalTimestampParts({
      year: match[3],
      month: LEGACY_MONTH_NUMBERS[normalizeLegacyMonth(match[1])],
      day: match[2],
      hour,
      minute: match[5],
    });
    if (!parts) return { absoluteMs: null };

    const rawZone = normalizeText(match[7]);
    const zone = rawZone.toUpperCase();
    let offsetMinutes = 0;
    if (zone === 'CET') offsetMinutes = 60;
    else if (zone === 'CEST') offsetMinutes = 120;
    else if (zone !== 'UTC' && zone !== 'GMT') {
      if (!zone.startsWith('+') && !zone.startsWith('-')) {
        return rawZone === rawZone.toUpperCase() ? { absoluteMs: null } : null;
      }
      const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
      if (!offset) return { absoluteMs: null };
      const offsetHour = Number(offset[2]);
      const offsetMinute = Number(offset[3]);
      if (offsetHour > 23 || offsetMinute > 59) return { absoluteMs: null };
      offsetMinutes = (offset[1] === '+' ? 1 : -1) * ((offsetHour * 60) + offsetMinute);
    }
    return {
      absoluteMs: Date.UTC(
        parts.year, parts.month - 1, parts.day, parts.hour, parts.minute
      ) - (offsetMinutes * 60 * 1000),
    };
  }

  function parseQuotedTimestampEvidence(value) {
    const source = normalizeText(value).replace(/[\u00a0\u202f]/g, ' ');
    const monthFirstZoned = parseMonthFirstZonedTimestamp(source);
    if (monthFirstZoned) return monthFirstZoned;
    const absoluteMatch = source.match(
      /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})\b/i
    );
    if (absoluteMatch) {
      const absoluteMs = Date.parse(absoluteMatch[0]);
      if (Number.isFinite(absoluteMs)) return { absoluteMs };
    }
    const zonedRfcMatch = source.match(
      /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?,?\s+\d{1,2}\s+[a-z]{3,9}\s+(?:19|20)\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|UTC|GMT)\b/i
    );
    if (zonedRfcMatch) {
      const absoluteMs = Date.parse(zonedRfcMatch[0]);
      if (Number.isFinite(absoluteMs)) return { absoluteMs };
    }
    const localParts = parseLegacyLocalTimestamp(source);
    return localParts ? { localParts } : null;
  }

  function getAmsterdamTimestampParts(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LEGACY_QUOTED_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return normalizeLocalTimestampParts(values);
  }

  function hasMatchingQuotedTimestamp(segment, sentAt) {
    const fields = segment && segment.headerFields && typeof segment.headerFields === 'object'
      ? segment.headerFields
      : {};
    const candidates = [
      ...(Array.isArray(fields.sent) ? fields.sent : []),
      segment && segment.header,
    ].map(parseQuotedTimestampEvidence).filter(Boolean);
    if (!candidates.length) return false;
    const sentAtMs = Date.parse(sentAt || '');
    const sentLocalParts = getAmsterdamTimestampParts(sentAt);
    if (!Number.isFinite(sentAtMs) || !sentLocalParts) return false;
    return candidates.every((candidate) => {
      if (Number.isFinite(candidate.absoluteMs)) {
        return Math.abs(candidate.absoluteMs - sentAtMs) <= QUOTED_PARENT_CLOCK_SKEW_MS;
      }
      return ['year', 'month', 'day', 'hour', 'minute'].every(
        (key) => candidate.localParts && candidate.localParts[key] === sentLocalParts[key]
      );
    });
  }

  function getLegacyInboundEvidence(conversation) {
    const conversationAccount = normalizeEmail(conversation && conversation.accountEmail);
    const conversationRecipient = normalizeEmail(conversation && conversation.email);
    const canonicalSubject = getCanonicalCampaignSubject(conversation && conversation.subject);
    if (!conversationAccount || !conversationRecipient || !canonicalSubject) return null;
    const messages = [
      conversation,
      ...(Array.isArray(conversation && conversation.threadMessages)
        ? conversation.threadMessages
        : []),
    ];
    const evidence = messages
      .filter((message) => getMailboxMessageDirection(message) !== 'sent')
      .map((message) => {
        const messageAccount = normalizeEmail(message && message.accountEmail);
        const messageRecipient = normalizeEmail(message && message.email);
        const parentIds = getDirectParentIds(message);
        const segment = getEffectiveQuotedSegment(message && message.body, true);
        if (
          messageAccount !== conversationAccount ||
          messageRecipient !== conversationRecipient ||
          getCanonicalCampaignSubject(message && message.subject) !== canonicalSubject ||
          parentIds.length !== 1 ||
          !segment
        ) return null;
        const body = quotedThread.stripQuotedEnvelope(segment.text);
        const normalizedBody = normalizeQuotedMatchText(body);
        if (
          normalizedBody.length < 80 ||
          !isOriginalCampaignOutboundMessage({ folder: 'sent', subject: canonicalSubject, body })
        ) return null;
        const headerSubjects = Array.isArray(segment.headerFields && segment.headerFields.subject)
          ? segment.headerFields.subject.map(getCanonicalCampaignSubject)
          : [];
        if (headerSubjects.some((subject) => subject !== canonicalSubject)) return null;
        const quotedRecipients = extractQuotedRecipientEmails(segment.text, extractEmailAddresses);
        const recipients = quotedRecipients.length
          ? quotedRecipients
          : segment.marker === 'reply-header'
            ? [conversationRecipient]
            : [];
        if (recipients.length !== 1 || recipients[0] !== conversationRecipient) return null;
        const receivedAt = getQuotedMessageTimestamp(message);
        if (!receivedAt) return null;
        return {
          body,
          canonicalSubject,
          conversationAccount,
          normalizedBody,
          parentMessageId: parentIds[0],
          quoteSegment: segment,
          recipientEmail: conversationRecipient,
          receivedAt,
          senderEmails: extractQuotedSenderEmails(segment.text),
        };
      })
      .filter(Boolean);
    if (!evidence.length) return null;
    const proofKeys = new Set(evidence.map((item) => [
      item.conversationAccount, item.canonicalSubject, item.parentMessageId, item.recipientEmail,
    ].join('|')));
    if (proofKeys.size !== 1) return null;
    const selected = evidence.slice().sort((left, right) => (
      left.normalizedBody.length - right.normalizedBody.length
    ))[0];
    if (evidence.some((item) => !item.normalizedBody.includes(selected.normalizedBody))) return null;
    return {
      ...selected,
      quoteSegments: evidence.map((item) => item.quoteSegment),
      receivedAt: Math.min(...evidence.map((item) => item.receivedAt)),
      senderEmails: Array.from(new Set(evidence.flatMap((item) => item.senderEmails))),
    };
  }

  function getLegacyWebdesignLink(body) {
    const candidates = normalizeText(body).match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (const candidate of candidates) {
      const cleanUrl = candidate.replace(/[\]\[),.;!?]+$/g, '');
      if (isExactSoftoraWebdesignUrl(cleanUrl)) return cleanUrl;
    }
    return '';
  }

  function normalizeSignatureLine(value) {
    return normalizeText(value)
      .replace(/^\*{1,2}|\*{1,2}$/g, '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function isStandaloneSignatureSignoff(value) {
    return /^(?:met\s+vriendelijke\s+groet(?:en)?|vriendelijke\s+groet(?:en)?|hartelijke\s+groet(?:en)?|groetjes|groeten|groet|mvg)[,.;!:]?$/.test(value);
  }

  function hasSignatureOwnerLine(lines, ownerName) {
    const normalizedName = normalizeSignatureLine(ownerName);
    if (!normalizedName) return false;
    return lines.some((line) => {
      if (line === normalizedName) return true;
      if (!line.startsWith(normalizedName)) return false;
      return /^\s*(?:[|/·•,:;]|[-–—])\s*\S/.test(line.slice(normalizedName.length));
    });
  }

  function getQuotedSignatureOwners(body) {
    const normalizedLines = String(body || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => normalizeSignatureLine(line.replace(/^\s*(?:>\s*)+/, '')));
    let signoffIndex = -1;
    normalizedLines.forEach((line, index) => {
      if (isStandaloneSignatureSignoff(line)) signoffIndex = index;
    });
    const lines = (signoffIndex >= 0
      ? normalizedLines.slice(signoffIndex + 1)
      : normalizedLines.filter(Boolean).slice(-12)
    ).filter(Boolean);
    const owners = new Set();
    Object.values(OUTBOUND_SENDER_IDENTITIES).forEach((identity) => {
      if (hasSignatureOwnerLine(lines, identity && identity.name)) {
        owners.add(normalizeText(identity && identity.profileKey).toLowerCase());
      }
    });
    return Array.from(owners).filter(Boolean);
  }

  function getExplicitQuotedSenderOwners(senderEmails) {
    const owners = new Set();
    let hasUnknownSender = false;
    (Array.isArray(senderEmails) ? senderEmails : []).forEach((senderEmail) => {
      const identity = OUTBOUND_SENDER_IDENTITIES[normalizeEmail(senderEmail)];
      if (identity && identity.profileKey) owners.add(identity.profileKey);
      else hasUnknownSender = true;
    });
    return { hasUnknownSender, owners: Array.from(owners) };
  }

  function attachLegacyMissingOutboundRoots(
    conversations,
    customerRows,
    guardGroups,
    knownSentMessages,
    storedSentMessageIds,
    legacyEvidenceComplete
  ) {
    if (legacyEvidenceComplete !== true) return Array.isArray(conversations) ? conversations : [];
    const customers = Array.isArray(customerRows) ? customerRows : [];
    const guards = (Array.isArray(guardGroups) ? guardGroups : [])
      .map(getLegacyGuardEvidence)
      .filter(Boolean);
    const knownSent = dedupeCampaignMessages(knownSentMessages)
      .filter((message) => getMailboxMessageDirection(message) === 'sent');
    const knownStoredSentIds = new Set(
      (Array.isArray(storedSentMessageIds) ? storedSentMessageIds : [])
        .map(normalizeMessageId)
        .filter(Boolean)
    );
    return (Array.isArray(conversations) ? conversations : []).map((conversation) => {
      const inbound = getLegacyInboundEvidence(conversation);
      if (!inbound) return conversation;
      const messages = [
        conversation,
        ...(Array.isArray(conversation && conversation.threadMessages)
          ? conversation.threadMessages
          : []),
      ];
      if (knownStoredSentIds.has(inbound.parentMessageId) || [...messages, ...knownSent].some((message) => (
        getMailboxMessageDirection(message) === 'sent' &&
        normalizeMessageId(message && message.messageId) === inbound.parentMessageId
      ))) return conversation;

      const recipientCustomers = customers.filter((customer) => (
        normalizeEmail(customer && (customer.email || customer.contactEmail)) === inbound.recipientEmail
      ));
      if (recipientCustomers.length !== 1) return conversation;
      const customer = getLegacyCustomerEvidence(recipientCustomers[0]);
      const customerOwner = customer && typeof getAccountOwner === 'function'
        ? normalizeText(getAccountOwner(customer.senderEmail)).toLowerCase()
        : '';
      const quotedSenderEvidence = getExplicitQuotedSenderOwners(inbound.senderEmails);
      const quotedSignatureOwners = getQuotedSignatureOwners(inbound.body);
      if (
        !customer ||
        !customerOwner ||
        customer.messageId !== inbound.parentMessageId ||
        customer.recipientEmail !== inbound.recipientEmail ||
        Date.parse(customer.sentAt) >= inbound.receivedAt ||
        !(inbound.quoteSegments || [inbound.quoteSegment]).every(
          (segment) => hasMatchingQuotedTimestamp(segment, customer.sentAt)
        ) ||
        quotedSenderEvidence.hasUnknownSender ||
        quotedSenderEvidence.owners.some((owner) => owner !== customerOwner) ||
        quotedSignatureOwners.some((owner) => owner !== customerOwner) ||
        (
          customer.senderEmail !== inbound.conversationAccount &&
          !(
            accountsShareOwner(customer.senderEmail, inbound.conversationAccount) &&
            inbound.senderEmails.includes(customer.senderEmail)
          )
        )
      ) return conversation;

      const matchingGuards = guards.filter((guard) => (
        guard.customerId === customer.customerId &&
        guard.messageId === customer.messageId &&
        guard.senderEmail === customer.senderEmail &&
        guard.recipientEmail === customer.recipientEmail &&
        guard.sentAt === customer.sentAt &&
        guard.canonicalSubject === inbound.canonicalSubject
      ));
      if (matchingGuards.length !== 1) return conversation;

      const guard = matchingGuards[0];
      const webdesignLinkUrl = getLegacyWebdesignLink(inbound.body);
      const candidate = {
        id: '', mailboxId: '', uid: 0,
        folder: 'sent', storageFolder: 'sent', direction: 'sent',
        accountEmail: customer.senderEmail,
        from: normalizeText(
          typeof getAccountDisplayName === 'function'
            ? getAccountDisplayName(customer.senderEmail)
            : ''
        ) || customer.senderEmail,
        email: customer.senderEmail,
        to: customer.recipientEmail,
        toDisplay: customer.recipientEmail,
        recipientRoutingEvidenceKnown: true,
        subject: guard.subject,
        preview: inbound.body,
        body: inbound.body,
        date: customer.sentAt,
        receivedAt: customer.sentAt,
        activityAt: customer.sentAt,
        messageId: `<${customer.messageId}>`,
        inReplyTo: '', references: '',
        originalCampaignOutbound: true,
        hasBody: true, bodyLoaded: true, bodyTruncated: false,
        bodyImageEvidenceKnown: false, embeddedImageCount: 0,
        webdesignLinkEvidenceKnown: Boolean(webdesignLinkUrl), webdesignLinkUrl,
        attachmentEvidenceKnown: false, attachments: [], unread: false,
        providerMessageIdHydrationEligible: true,
        legacyAcceptedRoot: true,
        threadCorrelationEvidence: 'exact-in-reply-to-customer-guard-structured-quote',
      };
      const primaryIdentity = getMessageIdentity(conversation);
      const threadMessages = dedupeCampaignMessages([
        ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
        candidate,
      ])
        .filter((message) => getMessageIdentity(message) !== primaryIdentity)
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const activity = resolveConversationActivity({ ...conversation, threadMessages });
      return {
        ...conversation,
        latestInboundAt: activity.latestInboundAt,
        latestOutboundAt: activity.latestOutboundAt,
        threadMessages,
      };
    });
  }

  function getLegacyParentMessageIds(conversations) {
    return Array.from(new Set(
      (Array.isArray(conversations) ? conversations : [])
        .map((conversation) => getLegacyInboundEvidence(conversation)?.parentMessageId)
        .filter(Boolean)
    ));
  }

  function getMessageIdLookupValues(messageIds) {
    const values = new Set();
    (Array.isArray(messageIds) ? messageIds : []).forEach((messageId) => {
      const bare = normalizeMessageId(messageId);
      if (!bare) return;
      values.add(bare);
      values.add(`<${bare}>`);
    });
    return Array.from(values);
  }

  async function listLegacyCustomers(conversations, dataOpsStore) {
    const emails = Array.from(new Set(
      (Array.isArray(conversations) ? conversations : [])
        .map((conversation) => getLegacyInboundEvidence(conversation)?.recipientEmail)
        .filter(Boolean)
    ));
    if (!emails.length) return { complete: true, customers: [] };
    if (!dataOpsStore || typeof dataOpsStore.listUniqueCustomersByEmails !== 'function') {
      return { complete: false, customers: [] };
    }
    try {
      const customers = await dataOpsStore.listUniqueCustomersByEmails({
        emails,
        bypassReadCache: true,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
      });
      return Array.isArray(customers)
        ? { complete: true, customers }
        : { complete: false, customers: [] };
    } catch (_error) {
      return { complete: false, customers: [] };
    }
  }

  async function listLegacyStoredSentMessageIds(
    conversations,
    selectedAccountEmails,
    mailboxIndexStore
  ) {
    const parentMessageIds = getLegacyParentMessageIds(conversations);
    if (!parentMessageIds.length) return { complete: true, messageIds: [] };
    if (
      !mailboxIndexStore ||
      typeof mailboxIndexStore.listStoredMessageIdsByMessageIdsForAccounts !== 'function'
    ) return { complete: false, messageIds: [] };
    try {
      const messageIds = await mailboxIndexStore.listStoredMessageIdsByMessageIdsForAccounts({
        accountEmails: selectedAccountEmails,
        folder: 'sent',
        messageIds: getMessageIdLookupValues(parentMessageIds),
        priorityRead: true,
      });
      return Array.isArray(messageIds)
        ? { complete: true, messageIds }
        : { complete: false, messageIds: [] };
    } catch (_error) {
      return { complete: false, messageIds: [] };
    }
  }

  async function listLegacyAcceptedSentMessages(
    conversations,
    selectedAccountEmails,
    mailboxSendProvenanceStore
  ) {
    const parentMessageIds = getLegacyParentMessageIds(conversations);
    if (!parentMessageIds.length) return { complete: true, messages: [] };
    if (
      !mailboxSendProvenanceStore ||
      typeof mailboxSendProvenanceStore.isAvailable !== 'function' ||
      mailboxSendProvenanceStore.isAvailable() !== true ||
      typeof mailboxSendProvenanceStore.listAcceptedMessagesByMessageIds !== 'function'
    ) return { complete: false, messages: [] };
    try {
      const expectedParentIds = new Set(parentMessageIds.map(normalizeMessageId));
      const selectedAccounts = new Set(
        (Array.isArray(selectedAccountEmails) ? selectedAccountEmails : [])
          .map(normalizeEmail)
          .filter(Boolean)
      );
      const intents = await mailboxSendProvenanceStore.listAcceptedMessagesByMessageIds({
        accountEmails: selectedAccountEmails,
        messageIds: getMessageIdLookupValues(parentMessageIds),
        maxRows: parentMessageIds.length + 1,
      });
      if (!Array.isArray(intents) || intents.length > parentMessageIds.length) {
        return { complete: false, messages: [] };
      }
      const byMessageId = new Map();
      intents.forEach((intent) => {
        const messageId = normalizeMessageId(intent && intent.messageId);
        const accountEmail = normalizeEmail(intent && intent.accountEmail);
        if (!messageId || !expectedParentIds.has(messageId) || !selectedAccounts.has(accountEmail)) {
          return;
        }
        if (!byMessageId.has(messageId)) byMessageId.set(messageId, []);
        byMessageId.get(messageId).push(intent);
      });
      if (
        Array.from(byMessageId.values()).reduce((sum, group) => sum + group.length, 0) !== intents.length ||
        Array.from(byMessageId.values()).some((group) => group.length !== 1)
      ) {
        return { complete: false, messages: [] };
      }
      const messages = Array.from(byMessageId.values()).map(([intent]) => {
        const message = buildAcceptedProvenanceMessage(intent);
        return {
          ...message,
          originalCampaignOutbound: isOriginalCampaignOutboundMessage(message),
        };
      });
      return { complete: true, messages };
    } catch (_error) {
      return { complete: false, messages: [] };
    }
  }

  async function listLegacySentGuardGroups(conversations, outboundRecipientGuardStore) {
    if (
      !outboundRecipientGuardStore ||
      typeof outboundRecipientGuardStore.listSentRecipientGroups !== 'function'
    ) return [];
    const recipients = Array.from(new Set(
      (Array.isArray(conversations) ? conversations : [])
        .map((conversation) => getLegacyInboundEvidence(conversation)?.recipientEmail)
        .filter(Boolean)
    ));
    const groups = [];
    try {
      for (let index = 0; index < recipients.length; index += LEGACY_GUARD_LOOKUP_BATCH_SIZE) {
        const batch = recipients.slice(index, index + LEGACY_GUARD_LOOKUP_BATCH_SIZE);
        const result = await outboundRecipientGuardStore.listSentRecipientGroups({
          provider: 'softora',
          channel: 'coldmail',
          keyType: 'email',
          recipientEmails: batch,
          maxRows: batch.length + 1,
        });
        if (!Array.isArray(result)) return [];
        if (result.length > batch.length) return [];
        groups.push(...result);
      }
    } catch (_error) {
      return [];
    }
    return groups;
  }

  function canMergeProvenConversationSegments(groupedConversations) {
    if (groupedConversations.length < 2) return true;
    const segments = groupedConversations
      .map((conversation) => [
        conversation,
        ...(Array.isArray(conversation && conversation.threadMessages) ? conversation.threadMessages : []),
      ].sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right)))
      .sort((left, right) => getMessageTimestamp(left[0]) - getMessageTimestamp(right[0]));
    if (segments.some((segment) => (
      !segment.some((message) => getMailboxMessageDirection(message) === 'sent') ||
      !segment.some((message) => getMailboxMessageDirection(message) !== 'sent')
    ))) return false;
    for (let index = 1; index < segments.length; index += 1) {
      const previousLast = segments[index - 1][segments[index - 1].length - 1];
      const currentFirst = segments[index][0];
      if (
        getMessageTimestamp(previousLast) >= getMessageTimestamp(currentFirst) ||
        getMailboxMessageDirection(previousLast) === 'sent' ||
        getMailboxMessageDirection(currentFirst) !== 'sent'
      ) return false;
    }
    return true;
  }

  function buildAcceptedProvenanceMessage(intent = {}) {
    const acceptedAt = normalizeText(intent.acceptedAt || intent.updatedAt || intent.createdAt);
    const messageId = normalizeText(intent.messageId || intent.providerMessageId);
    const durableAttachments = normalizeMailboxAttachmentsMetadata(intent.attachmentsMetadata);
    const attachmentEvidenceKnown = durableAttachments !== null;
    return {
      id: `accepted-sent:${messageId || intent.intentId}`,
      mailboxId: `accepted-sent:${messageId || intent.intentId}`,
      folder: 'sent',
      storageFolder: intent.provider === 'instantly' ? 'instantly' : 'sent',
      direction: 'sent',
      accountEmail: normalizeEmail(intent.accountEmail),
      from: normalizeText(intent.senderName || intent.accountEmail),
      email: normalizeEmail(intent.accountEmail),
      to: normalizeEmail(intent.recipientEmail),
      toDisplay: normalizeEmail(intent.recipientEmail),
      cc: normalizeText(intent.cc), bcc: normalizeText(intent.bcc),
      recipientRoutingEvidenceKnown: true,
      subject: normalizeText(intent.subject), preview: normalizeText(intent.body), body: normalizeText(intent.body),
      date: acceptedAt, receivedAt: acceptedAt, activityAt: acceptedAt,
      messageId,
      inReplyTo: normalizeText(intent.replyTargetMessageId),
      references: normalizeText(intent.references),
      conversationId: normalizeText(intent.conversationId),
      softoraConversationId: normalizeText(intent.conversationId),
      softoraSendIntentId: normalizeText(intent.intentId),
      softoraSendMode: normalizeText(intent.mode),
      softoraReplyTargetMessageId: normalizeText(intent.replyTargetMessageId),
      softoraThreadProvenanceKnown: true,
      provider: normalizeText(intent.provider),
      providerMessageId: normalizeText(intent.providerMessageId),
      providerThreadId: normalizeText(intent.providerThreadId),
      providerOwner: normalizeText(intent.owner),
      hasBody: true, bodyLoaded: true, bodyTruncated: false,
      bodyImageEvidenceKnown: false, embeddedImageCount: 0,
      webdesignLinkEvidenceKnown: false, webdesignLinkUrl: '',
      attachmentEvidenceKnown,
      attachments: attachmentEvidenceKnown ? durableAttachments : [],
      providerMessageIdHydrationEligible: true,
      unread: false, localAcceptedSend: true,
    };
  }

  function attachTargetedUnthreadedSentMessages(conversations, targetedRows) {
    const groups = new Map();
    (Array.isArray(targetedRows) ? targetedRows : []).forEach((row) => {
      const conversationId = normalizeText(row && row.targetConversationId);
      if (!conversationId || !row.message) return;
      if (!groups.has(conversationId)) groups.set(conversationId, []);
      groups.get(conversationId).push(row.message);
    });
    return (Array.isArray(conversations) ? conversations : []).map((conversation) => {
      const candidates = dedupeCampaignMessages(groups.get(normalizeText(conversation && conversation.conversationId)) || []);
      if (candidates.length !== 1) return conversation;
      const candidate = candidates[0];
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages) ? conversation.threadMessages : [])];
      const inboundMessages = messages.filter((message) => getMailboxMessageDirection(message) !== 'sent');
      const latestInboundAt = Math.max(0, ...inboundMessages.map(getMessageTimestamp));
      const counterparty = normalizeEmail(conversation && conversation.email);
      const candidateMessageId = normalizeMessageId(candidate && candidate.messageId);
      const exact = (
        getMailboxMessageDirection(candidate) === 'sent' &&
        normalizeEmail(candidate && candidate.accountEmail) === normalizeEmail(conversation && conversation.accountEmail) &&
        extractEmailAddresses(candidate && candidate.to).includes(counterparty) &&
        getCanonicalCampaignSubject(candidate && candidate.subject) === getCanonicalCampaignSubject(conversation && conversation.subject) &&
        getMessageTimestamp(candidate) > latestInboundAt &&
        !normalizeText(candidate && candidate.inReplyTo) &&
        !normalizeText(candidate && candidate.references) &&
        !normalizeText(candidate && candidate.providerThreadId) &&
        !messages.some((message) => candidateMessageId && getMessageReferenceIds(message).includes(candidateMessageId))
      );
      if (!exact) return conversation;
      const primaryIdentity = getMessageIdentity(conversation);
      const threadMessages = dedupeCampaignMessages([
        ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
        { ...candidate, threadCorrelationEvidence: 'unique-account-counterparty-subject-later-sent' },
      ])
        .filter((message) => getMessageIdentity(message) !== primaryIdentity)
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const activity = resolveConversationActivity({ ...conversation, threadMessages });
      return { ...conversation, latestInboundAt: activity.latestInboundAt, latestOutboundAt: activity.latestOutboundAt, threadMessages };
    });
  }

  function getQuotedSentRecoveryTargets(conversations) {
    return (Array.isArray(conversations) ? conversations : []).flatMap((conversation) => {
      const accountEmail = normalizeEmail(conversation && conversation.accountEmail);
      const canonicalSubject = getCanonicalCampaignSubject(conversation && conversation.subject);
      if (!accountEmail || !canonicalSubject) return [];
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
        ? conversation.threadMessages
        : [])];
      const alreadyHasOriginal = messages.some((message) => (
        getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
      ));
      if (alreadyHasOriginal) return [];
      const evidence = messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .flatMap((message) => getEffectiveQuotedSegments(message && message.body)
          .flatMap((segment) => {
            const headerRecipients = extractQuotedRecipientEmails(segment.text, extractEmailAddresses);
            const fallbackRecipient = normalizeEmail(conversation && conversation.email);
            const recipients = headerRecipients.length
              ? headerRecipients
              : segment.marker === 'reply-header' && fallbackRecipient
                ? [fallbackRecipient]
                : [];
            const senderEmails = extractQuotedSenderEmails(segment.text);
            const at = getQuotedMessageTimestamp(message);
            return recipients.map((recipientEmail) => ({ recipientEmail, senderEmails, at }));
          }));
      return evidence.map(({ recipientEmail, senderEmails, at }) => ({
        accountEmail,
        canonicalSubject,
        recipientEmail,
        senderEmails,
        beforeAt: at ? new Date(at + QUOTED_PARENT_CLOCK_SKEW_MS).toISOString() : '',
      }));
    });
  }

  function isQuotedSentRecoveryCandidate(conversation) {
    const subject = String(conversation && conversation.subject || '').trim();
    const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
      ? conversation.threadMessages
      : [])];
    const alreadyHasOriginal = messages.some((message) => (
      getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
    ));
    if (alreadyHasOriginal) return false;

    const forwardedSubject = /(?:^|\s)(?:fwd?|doorgestuurd)\s*:/i.test(subject);
    const exactQuotedRecipient = messages
      .filter((message) => getMailboxMessageDirection(message) !== 'sent')
      .some((message) => {
        const body = normalizeText(message && message.body);
        const segments = getEffectiveQuotedSegments(body);
        if (!body || !segments.length) return false;
        return segments.some((segment) => (
          extractQuotedRecipientEmails(segment.text, extractEmailAddresses).length > 0 ||
          (segment.marker === 'reply-header' && Boolean(normalizeEmail(conversation && conversation.email)))
        ));
      });
    return forwardedSubject || exactQuotedRecipient;
  }

  function attachQuotedOriginalSentMessages(conversations, candidateSentMessages) {
    return (Array.isArray(conversations) ? conversations : []).map((conversation) => {
      const accountEmail = normalizeEmail(conversation && conversation.accountEmail);
      const canonicalSubject = getCanonicalCampaignSubject(conversation && conversation.subject);
      const messages = [conversation, ...(Array.isArray(conversation && conversation.threadMessages)
        ? conversation.threadMessages
        : [])];
      if (
        !accountEmail ||
        !canonicalSubject ||
        messages.some((message) => (
          getMailboxMessageDirection(message) === 'sent' && message && message.originalCampaignOutbound === true
        ))
      ) return conversation;

      const incomingEvidence = messages
        .filter((message) => getMailboxMessageDirection(message) !== 'sent')
        .flatMap((message) => getEffectiveQuotedSegments(message && message.body).map((segment) => {
          const quotedRecipients = extractQuotedRecipientEmails(segment.text, extractEmailAddresses);
          const fallbackRecipient = normalizeEmail(conversation && conversation.email);
          return {
            at: getQuotedMessageTimestamp(message),
            body: segment.text,
            recipients: quotedRecipients.length
              ? quotedRecipients
              : segment.marker === 'reply-header' && fallbackRecipient
                ? [fallbackRecipient]
                : [],
            senderEmails: extractQuotedSenderEmails(segment.text),
          };
        }))
        .filter(Boolean);
      if (!incomingEvidence.length) return conversation;

      const matches = dedupeCampaignMessages(candidateSentMessages)
        .filter((candidate) => (
          getMailboxMessageDirection(candidate) === 'sent' &&
          candidate && candidate.originalCampaignOutbound === true &&
          getCanonicalCampaignSubject(candidate.subject) === canonicalSubject
        ))
        .filter((candidate) => {
          const candidateAccount = normalizeEmail(candidate && candidate.accountEmail);
          const candidateBody = normalizeQuotedMatchText(candidate && candidate.body);
          if (candidateBody.length < 80) return false;
          const candidateRecipients = extractEmailAddresses(candidate && candidate.to);
          if (candidateRecipients.length !== 1) return false;
          const candidateAt = getQuotedMessageTimestamp(candidate);
          return incomingEvidence.some((evidence) => (
            (
              candidateAccount === accountEmail ||
              (
                accountsShareOwner(candidateAccount, accountEmail) &&
                evidence.senderEmails.includes(candidateAccount)
              )
            ) &&
            evidence.at > 0 &&
            candidateAt > 0 &&
            candidateAt <= evidence.at + QUOTED_PARENT_CLOCK_SKEW_MS &&
            evidence.recipients.includes(candidateRecipients[0]) &&
            normalizeQuotedMatchText(evidence.body).includes(candidateBody)
          ));
        });
      if (matches.length !== 1) return conversation;

      const candidate = {
        ...matches[0],
        threadCorrelationEvidence: normalizeEmail(matches[0] && matches[0].accountEmail) === accountEmail
          ? 'exact-account-subject-quoted-body-and-recipient'
          : 'same-owner-alias-subject-quoted-body-and-recipient',
      };
      const primaryIdentity = getMessageIdentity(conversation);
      const threadMessages = dedupeCampaignMessages([
        ...(Array.isArray(conversation.threadMessages) ? conversation.threadMessages : []),
        candidate,
      ])
        .filter((message) => getMessageIdentity(message) !== primaryIdentity)
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const activity = resolveConversationActivity({ ...conversation, threadMessages });
      return {
        ...conversation,
        latestInboundAt: activity.latestInboundAt,
        latestOutboundAt: activity.latestOutboundAt,
        threadMessages,
      };
    });
  }

  async function recoverQuotedOriginalSentMessages({
    conversations,
    selectedAccountEmails,
    limit,
    mailboxIndexStore,
    dataOpsStore,
    mailboxSendProvenanceStore,
    outboundRecipientGuardStore,
    knownSentMessages,
  }) {
    const source = Array.isArray(conversations) ? conversations : [];
    const selectedAccounts = new Set((selectedAccountEmails || []).map(normalizeEmail));
    const safeLimit = Math.max(1, Number(limit) || 1);
    const hydrationCandidates = source
      .filter((conversation) => {
        const messages = [
          conversation,
          ...(Array.isArray(conversation && conversation.threadMessages)
            ? conversation.threadMessages
            : []),
        ];
        return selectedAccounts.has(normalizeEmail(conversation && conversation.accountEmail)) &&
          !messages.some((message) => (
            getMailboxMessageDirection(message) === 'sent' &&
            message && message.originalCampaignOutbound === true
          ));
      })
      .slice(0, safeLimit);
    const hydrated = [];
    if (mailboxIndexStore && typeof mailboxIndexStore.hydrateMessageBodies === 'function') {
      for (let index = 0; index < hydrationCandidates.length; index += RECOVERY_HYDRATION_BATCH_SIZE) {
        const batch = hydrationCandidates.slice(index, index + RECOVERY_HYDRATION_BATCH_SIZE);
        const result = await mailboxIndexStore.hydrateMessageBodies({ messages: batch });
        hydrated.push(...(Array.isArray(result) ? result : batch));
      }
    } else {
      hydrated.push(...hydrationCandidates);
    }
    const recoveryCandidates = hydrated.filter(isQuotedSentRecoveryCandidate);
    const baseTargets = getQuotedSentRecoveryTargets(recoveryCandidates);
    const selectedAccountList = Array.from(selectedAccounts);
    const targets = baseTargets.flatMap((target) => {
      const exact = [target.accountEmail];
      const quotedAliases = selectedAccountList.filter((candidateAccount) => (
        candidateAccount !== target.accountEmail &&
        accountsShareOwner(candidateAccount, target.accountEmail) &&
        target.senderEmails.includes(candidateAccount)
      ));
      return [...exact, ...quotedAliases].map((accountEmail) => ({ ...target, accountEmail }));
    });
    const sentCandidates = await (targets.length &&
      mailboxIndexStore && typeof mailboxIndexStore.listSentCandidatesForQuotedReplies === 'function'
      ? mailboxIndexStore.listSentCandidatesForQuotedReplies({ targets, limitPerTarget: 10 }).catch(() => [])
      : Promise.resolve([]));
    const recoveredFromSent = attachQuotedOriginalSentMessages(recoveryCandidates, sentCandidates);
    const legacyCandidates = recoveredFromSent.filter(isQuotedSentRecoveryCandidate);
    let fullyRecovered = recoveredFromSent;
    if (legacyCandidates.length) {
      const [legacyCustomers, storedSentEvidence, acceptedSentEvidence] = await Promise.all([
        listLegacyCustomers(legacyCandidates, dataOpsStore),
        listLegacyStoredSentMessageIds(
          legacyCandidates,
          selectedAccountList,
          mailboxIndexStore
        ),
        listLegacyAcceptedSentMessages(
          legacyCandidates,
          selectedAccountList,
          mailboxSendProvenanceStore
        ),
      ]);
      const recovered = attachQuotedOriginalSentMessages(recoveredFromSent, acceptedSentEvidence.messages);
      const fallbackCandidates = recovered.filter(isQuotedSentRecoveryCandidate);
      const legacyEvidenceComplete = legacyCustomers.complete === true &&
        storedSentEvidence.complete === true && acceptedSentEvidence.complete === true;
      const legacyGuardGroups = legacyEvidenceComplete && fallbackCandidates.length
        ? await listLegacySentGuardGroups(fallbackCandidates, outboundRecipientGuardStore) : [];
      fullyRecovered = attachLegacyMissingOutboundRoots(
        recovered, legacyCustomers.customers, legacyGuardGroups,
        [...(Array.isArray(knownSentMessages) ? knownSentMessages : []),
          ...sentCandidates, ...acceptedSentEvidence.messages],
        storedSentEvidence.messageIds, legacyEvidenceComplete
      );
    }
    const hydratedByIdentity = new Map(hydrated.map((message) => [
      getMessageIdentity(message),
      message,
    ]));
    fullyRecovered.forEach((conversation) => {
      hydratedByIdentity.set(getMessageIdentity(conversation), conversation);
    });
    const recoveredByIdentity = new Map(fullyRecovered.map((conversation) => [
      getMessageIdentity(conversation),
      conversation,
    ]));
    return {
      conversations: source.map((conversation) => (
        recoveredByIdentity.get(getMessageIdentity(conversation)) || conversation
      )),
      hydratedByIdentity,
    };
  }

  return {
    attachQuotedOriginalSentMessages,
    attachLegacyMissingOutboundRoots,
    attachTargetedUnthreadedSentMessages,
    buildAcceptedProvenanceMessage,
    canMergeProvenConversationSegments,
    getQuotedSentRecoveryTargets,
    isQuotedSentRecoveryCandidate,
    recoverQuotedOriginalSentMessages,
  };
}

module.exports = { createMailboxCampaignThreadRecovery };
