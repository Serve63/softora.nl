'use strict';

const {
  validateOutboundLeadInput,
} = require('../schemas/outbound-engine');
const {
  isLeadEligible,
} = require('./outbound-engine');

function prepareOutboundLeadImport(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const now = normaliseDate(input.now);
  const sourceName = String(input.sourceName || 'manual_import').trim();
  const suppressionSet = buildSuppressionSet(input.suppressionList);
  const seenLeadKeys = buildExistingLeadSet(input.existingLeads);
  const accepted = [];
  const rejected = [];
  const events = [];

  rows.forEach((row, index) => {
    const validation = validateOutboundLeadInput({
      ...row,
      source: row && row.source ? row.source : sourceName,
    });
    const eligibility = validation.ok
      ? isLeadEligible(validation.value, suppressionSet, seenLeadKeys)
      : { ok: false, reasons: [] };
    const reasons = [...validation.errors, ...eligibility.reasons];

    if (reasons.length > 0) {
      rejected.push({
        index,
        row,
        reasons: uniqueStrings(reasons),
      });
      return;
    }

    const lead = {
      ...validation.value,
      source: validation.value.source || sourceName,
      importedAt: now.toISOString(),
    };

    accepted.push(lead);
    events.push({
      type: 'lead_imported',
      createdAt: now.toISOString(),
      payload: lead,
    });
  });

  return {
    ok: rejected.length === 0,
    dryRun: true,
    canSendRealMail: false,
    accepted,
    rejected,
    events,
    summary: {
      requestedRows: rows.length,
      acceptedRows: accepted.length,
      rejectedRows: rejected.length,
      canSendRealMail: false,
    },
  };
}

function buildSuppressionSet(entries = []) {
  const set = new Set();
  if (!Array.isArray(entries)) return set;

  for (const entry of entries) {
    if (typeof entry === 'string') {
      set.add(normaliseEmail(entry) || normaliseDomainName(entry));
      continue;
    }

    if (!entry || typeof entry !== 'object' || entry.active === false) continue;
    if (entry.email) set.add(normaliseEmail(entry.email));
    if (entry.domain) set.add(normaliseDomainName(entry.domain));
    if (entry.leadId) set.add(String(entry.leadId));
  }

  return set;
}

function buildExistingLeadSet(leads = []) {
  const set = new Set();
  if (!Array.isArray(leads)) return set;

  for (const lead of leads) {
    if (!lead || typeof lead !== 'object') continue;
    const email = normaliseEmail(lead.email);
    const website = normaliseDomainName(lead.website || lead.domain);
    const key = email || website || String(lead.id || '');
    if (key) set.add(key);
  }

  return set;
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

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  buildExistingLeadSet,
  buildSuppressionSet,
  prepareOutboundLeadImport,
};
