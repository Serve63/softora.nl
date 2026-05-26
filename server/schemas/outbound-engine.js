'use strict';

const LIVE_SENDING_EVENT_TYPES = new Set([
  'mail_send_requested',
  'mail_send_started',
  'mail_send_completed',
  'smtp_transport_configured',
]);

const DEFAULT_PROTECTED_DOMAINS = Object.freeze(['softora.nl']);

function validateOutboundDomainInput(body = {}, options = {}) {
  const protectedDomains = normaliseProtectedDomains(options.protectedDomains);
  const name = normaliseDomainName(body.name || body.domain);
  const errors = [];

  if (!name) errors.push('domain_name_missing');
  if (protectedDomains.includes(name)) errors.push('protected_domain_not_allowed');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      id: truncateText(body.id || name, 120),
      name,
      status: normaliseStatus(body.status, ['pending', 'active', 'paused'], 'pending'),
      spf: normaliseAuthStatus(body.spf || body.spfStatus),
      dkim: normaliseAuthStatus(body.dkim || body.dkimStatus),
      dmarc: normaliseAuthStatus(body.dmarc || body.dmarcStatus),
      createdAt: normaliseOptionalDate(body.createdAt),
    },
  };
}

function validateOutboundInboxInput(body = {}, options = {}) {
  const protectedDomains = normaliseProtectedDomains(options.protectedDomains);
  const email = normaliseEmail(body.email);
  const domain = normaliseDomainName(body.domain || emailDomain(email));
  const domainId = truncateText(body.domainId || domain, 120);
  const errors = [];

  if (!email || !email.includes('@')) errors.push('inbox_email_invalid');
  if (!domainId) errors.push('inbox_domain_missing');
  if (protectedDomains.includes(domain)) errors.push('protected_sender_domain');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      email,
      domainId,
      domain,
      status: normaliseStatus(body.status, ['pending', 'active', 'paused'], 'pending'),
      dailyLimit: clampInteger(body.dailyLimit, 1, 9, 9),
      rampUpStartedAt: normaliseOptionalDate(body.rampUpStartedAt),
      sentToday: clampInteger(body.sentToday || body.alreadySentToday, 0, 10000, 0),
    },
  };
}

function validateOutboundCampaignInput(body = {}) {
  const status = normaliseStatus(body.status, ['draft', 'approved', 'paused', 'archived'], 'draft');
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const errors = [];

  if (!hasText(body.subject)) errors.push('campaign_subject_missing');
  if (!hasText(body.body)) errors.push('campaign_body_missing');
  if (!hasText(body.optOutUrl || body.unsubscribeUrl)) errors.push('campaign_opt_out_missing');
  if (body.requiresLandingPage !== false && !hasText(body.landingPageUrl)) {
    errors.push('campaign_landing_page_missing');
  }
  if (status === 'approved' && attachments.length > 0) {
    errors.push('attachments_not_allowed_for_approved_scale_campaign');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      id: truncateText(body.id || body.name || '', 120),
      status,
      subject: truncateText(body.subject, 300),
      body: truncateText(body.body, 20000),
      landingPageUrl: truncateText(body.landingPageUrl, 1000),
      optOutUrl: truncateText(body.optOutUrl || body.unsubscribeUrl, 1000),
      requiresLandingPage: body.requiresLandingPage !== false,
      attachments,
    },
  };
}

function validateOutboundLeadInput(body = {}) {
  const email = normaliseEmail(body.email);
  const website = normaliseDomainName(body.website || body.domain);
  const errors = [];

  if (!email || !email.includes('@')) errors.push('lead_email_missing');
  if (!hasText(body.companyName)) errors.push('company_name_missing');
  if (!website && !hasText(body.source)) errors.push('lead_source_missing');
  if (!hasText(body.relevanceReason)) errors.push('relevance_reason_missing');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      id: truncateText(body.id || email || website, 160),
      email,
      companyName: truncateText(body.companyName, 180),
      website,
      source: truncateText(body.source, 500),
      relevanceReason: truncateText(body.relevanceReason, 2000),
      optedOut: normaliseBoolean(body.optedOut),
      suppressed: normaliseBoolean(body.suppressed),
      bounced: normaliseBoolean(body.bounced),
    },
  };
}

function validateOutboundSuppressionInput(body = {}) {
  const email = normaliseEmail(body.email);
  const domain = normaliseDomainName(body.domain);
  const leadId = truncateText(body.leadId, 160);
  const errors = [];

  if (!email && !domain && !leadId) errors.push('suppression_target_missing');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      email: email || undefined,
      domain: domain || undefined,
      leadId: leadId || undefined,
      reason: normaliseReason(body.reason || body.type),
      active: body.active !== false,
      source: truncateText(body.source, 120),
      createdAt: normaliseOptionalDate(body.createdAt),
    },
  };
}

function validateOutboundEventInput(req = {}) {
  const body = req.body || req;
  const type = truncateText(body.type, 120);
  const errors = [];

  if (!type) errors.push('event_type_missing');
  if (LIVE_SENDING_EVENT_TYPES.has(type)) errors.push('live_sending_event_not_allowed');
  if (!body.payload || typeof body.payload !== 'object') errors.push('event_payload_missing');

  return {
    ok: errors.length === 0,
    errors,
    body: {
      type,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      createdAt: normaliseOptionalDate(body.createdAt),
    },
  };
}

function normaliseProtectedDomains(value) {
  return [
    ...new Set([
      ...DEFAULT_PROTECTED_DOMAINS,
      ...((Array.isArray(value) ? value : []).map(normaliseDomainName)),
    ]),
  ];
}

function normaliseStatus(value, allowed, fallback) {
  const status = String(value || '').trim().toLowerCase();
  return allowed.includes(status) ? status : fallback;
}

function normaliseAuthStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['pass', 'fail', 'missing', 'pending'].includes(status)) return status;
  return 'missing';
}

function normaliseReason(value) {
  const reason = String(value || 'manual').trim().toLowerCase();
  if (['manual', 'unsubscribe', 'bounce', 'complaint', 'legal', 'reply_negative'].includes(reason)) {
    return reason;
  }
  return 'manual';
}

function normaliseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
  return false;
}

function normaliseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function truncateText(value, maxLength = 0) {
  const text = String(value || '').trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailDomain(email) {
  const normalised = normaliseEmail(email);
  const atIndex = normalised.lastIndexOf('@');
  return atIndex >= 0 ? normalised.slice(atIndex + 1) : '';
}

function normaliseDomainName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  DEFAULT_PROTECTED_DOMAINS,
  LIVE_SENDING_EVENT_TYPES,
  validateOutboundCampaignInput,
  validateOutboundDomainInput,
  validateOutboundEventInput,
  validateOutboundInboxInput,
  validateOutboundLeadInput,
  validateOutboundSuppressionInput,
};
