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

function extractQuotedOriginalBody(rawMessages = [], options = {}) {
  const expectedSender = email(options.accountEmail);
  for (const rawMessage of Array.isArray(rawMessages) ? rawMessages : []) {
    const body = getRawMessageBody(rawMessage);
    if (!body) continue;
    const lines = body.split(/\r?\n/);
    const quoteIndex = lines.findIndex((line) => {
      const normalized = text(line).replace(/^>\s*/, '');
      return QUOTED_REPLY_HEADER_PATTERN.test(normalized) &&
        (!expectedSender || email(extractEmail(normalized)) === expectedSender);
    });
    if (quoteIndex < 0) continue;
    const quotedBody = lines
      .slice(quoteIndex + 1)
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .join('\n')
      .trim();
    if (quotedBody) return quotedBody;
  }
  return '';
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
  const identityMatches = Boolean(
    customerId &&
    expectedCampaignId &&
    customerCampaignId === expectedCampaignId &&
    expectedRecipient &&
    customerRecipient === expectedRecipient &&
    expectedSender &&
    customerSender === expectedSender &&
    customerLeadId &&
    (!expectedLeadId || customerLeadId === expectedLeadId) &&
    exactPublicUrl
  );
  if (!identityMatches) {
    return { evidenceKnown: true, available: false, reason: 'customer-identity-mismatch' };
  }

  const providerBody = getRawMessageBody(rawMessage);
  const quotedBody = extractQuotedOriginalBody(rawMessages, { accountEmail: expectedSender });
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
    reason: 'exact-customer-and-delivered-quote-source',
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
};
