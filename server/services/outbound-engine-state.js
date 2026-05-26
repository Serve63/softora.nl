'use strict';

const {
  DEFAULT_REQUIRED_OPERATIONS,
  normaliseOutboundSnapshot,
} = require('./outbound-engine-control-plane');

const OUTBOUND_STATE_VERSION = 1;
const BLOCKED_LIVE_EVENT_TYPES = new Set([
  'mail_send_requested',
  'mail_send_started',
  'mail_send_completed',
  'smtp_transport_configured',
]);

function createOutboundEngineState(overrides = {}) {
  const snapshot = normaliseOutboundSnapshot(overrides);

  return {
    version: OUTBOUND_STATE_VERSION,
    mode: 'dry_run',
    liveSendingEnabled: false,
    domains: snapshot.domains,
    inboxes: snapshot.inboxes,
    campaigns: snapshot.campaigns,
    leads: snapshot.leads,
    suppressionList: snapshot.suppressionList,
    health: {
      inboxes: {},
      domains: {},
      ...(snapshot.health || {}),
    },
    emergencyPause: snapshot.emergencyPause,
    operations: {
      ...DEFAULT_REQUIRED_OPERATIONS,
      ...snapshot.operations,
    },
    auditLog: Array.isArray(overrides.auditLog) ? overrides.auditLog : [],
  };
}

function reduceOutboundEvents(events = [], initialState = {}) {
  return events.reduce((state, event) => applyOutboundEvent(state, event).state, createOutboundEngineState(initialState));
}

function applyOutboundEvent(currentState = {}, event = {}, options = {}) {
  const now = normaliseDate(options.now || event.createdAt);
  const state = createOutboundEngineState(currentState);
  const type = String(event.type || '').trim();

  if (!type) {
    return appendAudit(state, {
      type: 'event_rejected',
      accepted: false,
      reason: 'event_type_missing',
      createdAt: now.toISOString(),
    });
  }

  if (BLOCKED_LIVE_EVENT_TYPES.has(type)) {
    return appendAudit(state, {
      type: 'event_rejected',
      accepted: false,
      reason: 'live_sending_event_not_supported',
      originalType: type,
      createdAt: now.toISOString(),
    });
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};

  switch (type) {
    case 'domain_registered':
      return appendAudit({
        ...state,
        domains: upsertById(state.domains, normaliseDomain(payload)),
      }, acceptedAudit(type, payload, now));

    case 'inbox_registered':
      return appendAudit({
        ...state,
        inboxes: upsertByEmail(state.inboxes, normaliseInbox(payload)),
      }, acceptedAudit(type, payload, now));

    case 'campaign_saved':
      return appendAudit({
        ...state,
        campaigns: upsertById(state.campaigns, normaliseCampaign(payload)),
      }, acceptedAudit(type, payload, now));

    case 'lead_imported':
      return appendAudit({
        ...state,
        leads: upsertById(state.leads, normaliseLead(payload)),
      }, acceptedAudit(type, payload, now));

    case 'suppression_added':
      return appendAudit({
        ...state,
        suppressionList: addSuppression(state.suppressionList, payload),
      }, acceptedAudit(type, payload, now));

    case 'health_metric_recorded':
      return appendAudit({
        ...state,
        health: applyHealthMetric(state.health, payload),
      }, acceptedAudit(type, payload, now));

    case 'operation_connected':
      return appendAudit({
        ...state,
        operations: {
          ...state.operations,
          [payload.name]: payload.connected !== false,
        },
      }, acceptedAudit(type, payload, now));

    case 'emergency_pause_changed':
      return appendAudit({
        ...state,
        emergencyPause: {
          active: Boolean(payload.active),
          reason: payload.reason || null,
        },
      }, acceptedAudit(type, payload, now));

    default:
      return appendAudit(state, {
        type: 'event_rejected',
        accepted: false,
        reason: 'unknown_event_type',
        originalType: type,
        createdAt: now.toISOString(),
      });
  }
}

function normaliseDomain(payload) {
  const name = normaliseDomainName(payload.name || payload.domain);
  return {
    id: String(payload.id || name),
    name,
    status: payload.status || 'pending',
    spf: payload.spf || payload.spfStatus || 'missing',
    dkim: payload.dkim || payload.dkimStatus || 'missing',
    dmarc: payload.dmarc || payload.dmarcStatus || 'missing',
    createdAt: payload.createdAt || null,
  };
}

function normaliseInbox(payload) {
  return {
    email: normaliseEmail(payload.email),
    domainId: payload.domainId || normaliseDomainName(payload.domain),
    status: payload.status || 'pending',
    dailyLimit: Math.min(Number(payload.dailyLimit || 9), 9),
    rampUpStartedAt: payload.rampUpStartedAt || null,
    sentToday: Number(payload.sentToday || 0),
  };
}

function normaliseCampaign(payload) {
  return {
    id: String(payload.id || payload.name || `campaign_${Date.now()}`),
    status: payload.status || 'draft',
    subject: payload.subject || '',
    body: payload.body || '',
    landingPageUrl: payload.landingPageUrl || '',
    optOutUrl: payload.optOutUrl || payload.unsubscribeUrl || '',
    requiresLandingPage: payload.requiresLandingPage !== false,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  };
}

function normaliseLead(payload) {
  return {
    id: String(payload.id || payload.email || payload.website || `lead_${Date.now()}`),
    email: normaliseEmail(payload.email),
    companyName: payload.companyName || '',
    website: payload.website || payload.domain || '',
    source: payload.source || '',
    relevanceReason: payload.relevanceReason || '',
    optedOut: Boolean(payload.optedOut),
    suppressed: Boolean(payload.suppressed),
    bounced: Boolean(payload.bounced),
  };
}

function addSuppression(list, payload) {
  const entry = {
    email: payload.email ? normaliseEmail(payload.email) : undefined,
    domain: payload.domain ? normaliseDomainName(payload.domain) : undefined,
    leadId: payload.leadId ? String(payload.leadId) : undefined,
    reason: String(payload.reason || 'manual').trim().toLowerCase(),
    active: payload.active !== false,
    createdAt: payload.createdAt || null,
  };
  const key = suppressionKey(entry);
  const filtered = list.filter((item) => suppressionKey(item) !== key);
  return [...filtered, entry];
}

function applyHealthMetric(health, payload) {
  const scope = payload.scope === 'domain' ? 'domains' : 'inboxes';
  const key = scope === 'domains' ? normaliseDomainName(payload.key || payload.domain) : normaliseEmail(payload.key || payload.email);
  if (!key) return health;

  return {
    ...health,
    [scope]: {
      ...(health[scope] || {}),
      [key]: {
        ...((health[scope] || {})[key] || {}),
        ...payload.metrics,
        updatedAt: payload.updatedAt || null,
      },
    },
  };
}

function acceptedAudit(type, payload, now) {
  return {
    type,
    accepted: true,
    id: payload.id || payload.email || payload.name || payload.key || null,
    createdAt: now.toISOString(),
  };
}

function appendAudit(state, auditEntry) {
  return {
    state: {
      ...state,
      mode: 'dry_run',
      liveSendingEnabled: false,
      auditLog: [
        ...state.auditLog,
        auditEntry,
      ],
    },
    auditEntry,
  };
}

function upsertById(items, item) {
  const id = String(item.id || '');
  return [
    ...items.filter((existing) => String(existing.id || '') !== id),
    item,
  ];
}

function upsertByEmail(items, item) {
  const email = normaliseEmail(item.email);
  return [
    ...items.filter((existing) => normaliseEmail(existing.email) !== email),
    item,
  ];
}

function suppressionKey(entry) {
  if (typeof entry === 'string') return normaliseEmail(entry) || normaliseDomainName(entry);
  if (!entry || typeof entry !== 'object') return '';
  return normaliseEmail(entry.email) || normaliseDomainName(entry.domain) || String(entry.leadId || '');
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normaliseDomainName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

module.exports = {
  BLOCKED_LIVE_EVENT_TYPES,
  OUTBOUND_STATE_VERSION,
  applyOutboundEvent,
  createOutboundEngineState,
  reduceOutboundEvents,
};
