const { parseProviderHtml } = require('./mailbox-provider-rich-body');

const SOFTORA_SOURCE_HTML_KEYS = Object.freeze([
  'softora_instantly_email_html',
]);
const SOFTORA_SOURCE_TEXT_KEYS = Object.freeze([
  'softora_instantly_email_text',
  'softora_instantly_email_body',
  'softora_mail_body',
]);
const QUOTED_REPLY_HEADER_PATTERN = /^(?:op\s.+\sschreef\s.+:|op\s.+\sheeft\s.+\shet\svolgende\sgeschreven:|on\s.+\swrote:)/i;
const OUTLOOK_FROM_HEADER_PATTERN = /^(?:van|from):\s*(.+)$/i;
const OUTLOOK_SUBJECT_HEADER_PATTERN = /^(?:onderwerp|subject):/i;

function text(value) {
  return String(value || '').trim();
}

function email(value) {
  return text(value).toLowerCase();
}

function extractEmail(value) {
  const match = text(value).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? email(match[0]) : '';
}

function extractLeadId(rawMessage = {}) {
  return text(
    rawMessage.lead_id ||
    rawMessage.instantly_lead_id ||
    rawMessage.lead?.id ||
    rawMessage.lead?.lead_id
  );
}

function extractInstantlyItem(data) {
  for (const candidate of [data?.email, data?.data, data]) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      text(candidate.id || candidate.email_id || candidate.uuid)
    ) {
      return candidate;
    }
  }
  return null;
}

async function hydrateIndexedThreadMessageEvidence(options = {}) {
  const rawMessages = Array.isArray(options.rawMessages) ? [...options.rawMessages] : [];
  const indexedMessages = Array.isArray(options.indexedMessages) ? options.indexedMessages : [];
  const threadId = text(options.threadId);
  const accountEmail = email(options.accountEmail);
  const apiRequest = options.apiRequest;
  const exactIndexedMessages = indexedMessages.filter((message) => (
    text(message?.providerThreadId) === threadId &&
    email(message?.providerAccountEmail || message?.accountEmail) === accountEmail
  ));
  const needsExactOriginalAudit = exactIndexedMessages.some((message) => (
    message?.originalCampaignOutbound === true &&
    (
      message?.providerBodyHtmlEvidenceKnown !== true ||
      message?.providerOriginalBodyEvidenceKnown !== true
    )
  ));
  const exactProviderMessagesUnavailable = new Set();
  const rawMessageIds = new Set(
    rawMessages.map((message) => text(message?.id || message?.email_id || message?.uuid)).filter(Boolean)
  );
  for (const indexedMessage of needsExactOriginalAudit ? exactIndexedMessages : []) {
    const providerMessageId = text(
      indexedMessage?.providerMessageId ||
      String(indexedMessage?.id || '').replace(/^instantly:/, '')
    );
    if (!providerMessageId || rawMessageIds.has(providerMessageId)) continue;
    try {
      const exactData = await apiRequest(`emails/${encodeURIComponent(providerMessageId)}`);
      const exactMessage = extractInstantlyItem(exactData);
      const exactMessageId = text(exactMessage?.id || exactMessage?.email_id || exactMessage?.uuid);
      if (!exactMessage || exactMessageId !== providerMessageId) {
        exactProviderMessagesUnavailable.add(providerMessageId);
        continue;
      }
      rawMessages.push(exactMessage);
      rawMessageIds.add(providerMessageId);
    } catch (error) {
      if (Number(error?.providerStatus) !== 404) throw error;
      exactProviderMessagesUnavailable.add(providerMessageId);
    }
  }
  return { exactIndexedMessages, exactProviderMessagesUnavailable, rawMessages };
}

function unwrapLead(value) {
  const source = value && typeof value === 'object' ? value : {};
  for (const candidate of [source.lead, source.data?.lead, source.data, source]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return {};
}

function extractVariables(lead = {}) {
  for (const candidate of [
    lead.custom_variables,
    lead.customVariables,
    lead.payload,
    lead.variables,
  ]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return lead;
}

function readFirst(source, keys) {
  for (const key of keys) {
    const value = text(source && source[key]);
    if (value) return value;
  }
  return '';
}

function canonicalizeComparableBody(value) {
  return String(value || '')
    .replace(/\[https?:\/\/[^\]]+\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/geen webdesign willen ontvangen[^\n]*/gi, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyMatchesProviderCopy(providerBody, sourceBody) {
  const provider = canonicalizeComparableBody(providerBody);
  const source = canonicalizeComparableBody(sourceBody);
  if (provider.length < 80 || source.length < 80) return false;
  if (provider === source || source.includes(provider) || provider.includes(source)) return true;
  const sourceTokens = new Set(source.split(' ').filter((token) => token.length > 2));
  const providerTokens = provider.split(' ').filter((token) => token.length > 2);
  if (providerTokens.length < 12) return false;
  const matchingTokens = providerTokens.filter((token) => sourceTokens.has(token)).length;
  return matchingTokens / providerTokens.length >= 0.9;
}

function getRawMessageBody(rawMessage = {}) {
  const html = text(rawMessage.body?.html || rawMessage.body_html || rawMessage.email_html);
  return parseProviderHtml(html).body || text(
    rawMessage.body?.text || rawMessage.body_text || rawMessage.email_text
  );
}

function stripQuotePrefix(value) {
  return String(value || '').replace(/^\s*>\s?/, '').trim();
}

function getProviderFirstLine(providerBody) {
  return text(providerBody)
    .split(/\r?\n/)
    .map(text)
    .find(Boolean) || '';
}

function isProviderBodyStartLine(line, providerBody) {
  const firstProviderLine = getProviderFirstLine(providerBody);
  return Boolean(
    firstProviderLine &&
    canonicalizeComparableBody(stripQuotePrefix(line)) ===
      canonicalizeComparableBody(firstProviderLine)
  );
}

function findProviderBodyStart(lines, providerBody) {
  const firstProviderLine = getProviderFirstLine(providerBody);
  if (!firstProviderLine) return 0;
  const index = lines.findIndex((line) => isProviderBodyStartLine(line, providerBody));
  return index >= 0 ? index : 0;
}

function extractQuotedOriginalBodyEvidence(rawMessages = [], options = {}) {
  const expectedSender = email(options.accountEmail);
  const providerBody = text(options.providerBody);
  const sourceMessageId = text(options.sourceMessageId);
  for (const rawMessage of Array.isArray(rawMessages) ? rawMessages : []) {
    if (
      sourceMessageId &&
      sourceMessageId === text(rawMessage.id || rawMessage.email_id || rawMessage.uuid)
    ) {
      continue;
    }
    const body = getRawMessageBody(rawMessage);
    if (!body) continue;
    const lines = body.split(/\r?\n/);
    const quoteIndex = lines.findIndex((line) => {
      const normalized = stripQuotePrefix(line);
      return QUOTED_REPLY_HEADER_PATTERN.test(normalized) &&
        (!expectedSender || email(extractEmail(normalized)) === expectedSender);
    });
    if (quoteIndex >= 0) {
      const quotedLines = lines.slice(quoteIndex + 1);
      const startIndex = findProviderBodyStart(quotedLines, providerBody);
      const quotedBody = quotedLines
        .slice(startIndex)
        .map((line) => line.replace(/^\s*>\s?/, ''))
        .join('\n')
        .trim();
      if (quotedBody) {
        return {
          body: quotedBody,
          senderEmail: expectedSender,
          source: 'standard-reply-header',
        };
      }
    }

    const outlookFromIndex = lines.findIndex((line) => {
      const match = stripQuotePrefix(line).match(OUTLOOK_FROM_HEADER_PATTERN);
      return match && (!expectedSender || email(extractEmail(match[1])) === expectedSender);
    });
    if (outlookFromIndex < 0) continue;
    const subjectOffset = lines
      .slice(outlookFromIndex + 1, outlookFromIndex + 12)
      .findIndex((line) => OUTLOOK_SUBJECT_HEADER_PATTERN.test(stripQuotePrefix(line)));
    if (subjectOffset < 0) continue;
    const quotedLines = lines.slice(outlookFromIndex + subjectOffset + 2);
    const startIndex = findProviderBodyStart(quotedLines, providerBody);
    const quotedBody = quotedLines
      .slice(startIndex)
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .join('\n')
      .trim();
    if (quotedBody) {
      return {
        body: quotedBody,
        senderEmail: expectedSender,
        source: 'outlook-original-message-header',
      };
    }
  }

  if (providerBody) {
    for (const rawMessage of Array.isArray(rawMessages) ? rawMessages : []) {
      if (
        sourceMessageId &&
        sourceMessageId === text(rawMessage.id || rawMessage.email_id || rawMessage.uuid)
      ) {
        continue;
      }
      const body = getRawMessageBody(rawMessage);
      if (!body) continue;
      const lines = body.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!isProviderBodyStartLine(lines[index], providerBody)) continue;
        const candidate = lines
          .slice(index)
          .map((line) => line.replace(/^\s*>\s?/, ''))
          .join('\n')
          .trim();
        if (!bodyMatchesProviderCopy(providerBody, candidate)) continue;
        return {
          body: candidate,
          senderEmail: '',
          source: 'exact-thread-content-match',
        };
      }
    }
  }
  return { body: '', senderEmail: '', source: '' };
}

function extractQuotedOriginalBody(rawMessages = [], options = {}) {
  return extractQuotedOriginalBodyEvidence(rawMessages, options).body;
}

function normalizeExactWebdesignUrl(value, expectedCustomerId) {
  try {
    const url = new URL(text(value));
    const hostname = url.hostname.toLowerCase();
    if (!['softora.nl', 'www.softora.nl'].includes(hostname)) return '';
    if (!url.pathname.startsWith('/webdesign/')) return '';
    if (expectedCustomerId && url.searchParams.get('cid') !== expectedCustomerId) return '';
    if (!url.searchParams.get('sender')) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function insertExactWebdesignUrl(body, exactUrl) {
  const marker = `hier [${exactUrl}]`;
  if (body.includes(marker)) return body;
  const exactCta = /(\bwebdesign\s+)hier(\s+bekijken\b)/i;
  if (!exactCta.test(body)) return '';
  return body.replace(exactCta, `$1${marker}$2`);
}

function buildCustomerQuotedMessageSource(rawMessage = {}, rawMessages = [], customer = {}, options = {}) {
  const expectedCampaignId = text(rawMessage.campaign_id);
  const expectedRecipient = email(options.recipientEmail);
  const expectedSender = email(options.accountEmail);
  const expectedLeadId = extractLeadId(rawMessage);
  const customerId = text(customer.id || customer.customer_id);
  const customerRecipient = email(customer.email || customer.contactEmail);
  const customerCampaignId = text(
    customer.instantlyCampaignId ||
    customer.lastColdmailCampaignId
  );
  const customerSender = email(
    customer.instantlyActualSenderEmail ||
    customer.lastColdmailSenderEmail ||
    customer.instantlySenderEmail
  );
  const customerLeadId = text(
    customer.instantlyLeadId ||
    customer.lastColdmailLeadId
  );
  const exactPublicUrl = normalizeExactWebdesignUrl(
    customer.instantlyPublicPreviewUrl,
    customerId
  );
  const providerBody = getRawMessageBody(rawMessage);
  const quotedEvidence = extractQuotedOriginalBodyEvidence(rawMessages, {
    accountEmail: expectedSender,
    providerBody,
    sourceMessageId: text(rawMessage.id || rawMessage.email_id || rawMessage.uuid),
  });
  const sameOwnerAccountEmails = new Set(
    (Array.isArray(options.sameOwnerAccountEmails) ? options.sameOwnerAccountEmails : [])
      .map(email)
      .filter(Boolean)
  );
  const senderMatches = customerSender === expectedSender || (
    sameOwnerAccountEmails.has(customerSender) &&
    sameOwnerAccountEmails.has(expectedSender) &&
    quotedEvidence.senderEmail === expectedSender
  );
  const identityMatches = Boolean(
    customerId &&
    expectedCampaignId &&
    customerCampaignId === expectedCampaignId &&
    expectedRecipient &&
    customerRecipient === expectedRecipient &&
    expectedSender &&
    senderMatches &&
    customerLeadId &&
    (!expectedLeadId || customerLeadId === expectedLeadId) &&
    exactPublicUrl
  );
  if (!identityMatches) {
    return { evidenceKnown: true, available: false, reason: 'customer-identity-mismatch' };
  }

  const quotedBody = quotedEvidence.body;
  if (!quotedBody || !bodyMatchesProviderCopy(providerBody, quotedBody)) {
    return { evidenceKnown: true, available: false, reason: 'quoted-content-mismatch' };
  }
  const sourceBody = insertExactWebdesignUrl(quotedBody, exactPublicUrl);
  if (!sourceBody) {
    return { evidenceKnown: true, available: false, reason: 'quoted-link-marker-missing' };
  }

  return {
    evidenceKnown: true,
    available: true,
    body: sourceBody,
    webdesignLinkEvidenceKnown: true,
    webdesignLinkUrl: exactPublicUrl,
    reason: `exact-customer-and-delivered-quote-source:${quotedEvidence.source}`,
  };
}

function buildOriginalMessageSource(rawMessage = {}, rawLead = {}, options = {}) {
  const lead = unwrapLead(rawLead);
  const variables = extractVariables(lead);
  const expectedLeadId = extractLeadId(rawMessage);
  const actualLeadId = text(lead.id || lead.lead_id || lead.instantly_lead_id);
  const expectedCampaignId = text(rawMessage.campaign_id);
  const actualCampaignId = text(lead.campaign || lead.campaign_id || lead.campaign_uuid);
  const expectedRecipient = email(options.recipientEmail);
  const actualRecipient = email(lead.email || lead.email_address || lead.contact || variables.email);
  const expectedSender = email(options.accountEmail);
  const actualSender = email(
    variables.softora_sender_email ||
    lead.email_account ||
    lead.eaccount
  );
  const expectedSubject = text(rawMessage.subject || rawMessage.email_subject);
  const actualSubject = text(variables.softora_subject || lead.subject);

  const identityMatches = Boolean(
    actualLeadId &&
    (!expectedLeadId || actualLeadId === expectedLeadId) &&
    expectedCampaignId &&
    actualCampaignId === expectedCampaignId &&
    expectedRecipient &&
    actualRecipient === expectedRecipient &&
    expectedSender &&
    actualSender === expectedSender &&
    expectedSubject &&
    actualSubject === expectedSubject
  );
  if (!identityMatches) {
    return { evidenceKnown: true, available: false, reason: 'identity-mismatch' };
  }

  const sourceHtml = readFirst(variables, SOFTORA_SOURCE_HTML_KEYS);
  const parsedSource = parseProviderHtml(sourceHtml);
  const sourceBody = parsedSource.body || readFirst(variables, SOFTORA_SOURCE_TEXT_KEYS);
  const providerHtml = text(rawMessage.body?.html || rawMessage.body_html || rawMessage.email_html);
  const providerBody = parseProviderHtml(providerHtml).body || text(
    rawMessage.body?.text || rawMessage.body_text || rawMessage.email_text
  );
  const exactPublicUrl = text(variables.softora_webdesign_public_url);
  if (
    !sourceBody ||
    !bodyMatchesProviderCopy(providerBody, sourceBody) ||
    !parsedSource.webdesignLinkEvidenceKnown ||
    !exactPublicUrl ||
    parsedSource.webdesignLinkUrl !== exactPublicUrl
  ) {
    return { evidenceKnown: true, available: false, reason: 'content-mismatch' };
  }

  return {
    evidenceKnown: true,
    available: true,
    body: sourceBody,
    webdesignLinkEvidenceKnown: true,
    webdesignLinkUrl: exactPublicUrl,
    reason: 'exact-lead-source',
  };
}

module.exports = {
  bodyMatchesProviderCopy,
  buildCustomerQuotedMessageSource,
  buildOriginalMessageSource,
  canonicalizeComparableBody,
  extractQuotedOriginalBody,
  extractLeadId,
  hydrateIndexedThreadMessageEvidence,
};
