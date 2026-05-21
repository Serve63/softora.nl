'use strict';

const crypto = require('node:crypto');

const {
  validateOutboundSuppressionInput,
} = require('../schemas/outbound-engine');

function createOutboundOptOutRecord(input = {}) {
  const now = normaliseDate(input.now);
  const validation = validateOutboundSuppressionInput({
    ...input,
    reason: input.reason || 'unsubscribe',
    source: input.source || 'opt_out',
    createdAt: now.toISOString(),
  });

  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      canSendRealMail: false,
      event: null,
      record: null,
    };
  }

  const record = {
    ...validation.value,
    fingerprint: createSuppressionFingerprint(validation.value),
  };

  return {
    ok: true,
    canSendRealMail: false,
    record,
    event: {
      type: 'suppression_added',
      createdAt: now.toISOString(),
      payload: record,
    },
  };
}

function createSuppressionFingerprint(record = {}) {
  const target = [
    record.email || '',
    record.domain || '',
    record.leadId || '',
    record.reason || '',
  ].join('|');

  return crypto.createHash('sha256').update(target).digest('hex').slice(0, 24);
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

module.exports = {
  createOutboundOptOutRecord,
  createSuppressionFingerprint,
};
