const crypto = require('node:crypto');

const MONETARY_EVENT_KINDS = new Set([
  'lead_cost',
  'delivery_cost',
  'refund',
]);
const MILESTONE_EVENT_KINDS = new Set([
  'lead_qualified',
  'proposal_sent',
  'contract_accepted',
  'delivery_accepted',
]);
const ALLOWED_AUTOMATION_SOURCES = new Set([
  'offerti',
  'gmail',
  'softora',
  'vercel',
  'supabase',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function truncate(value, maxLength) {
  return normalizeString(value).slice(0, maxLength);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(normalizeString(value).toLowerCase());
}

function normalizeOccurredAt(value, now = () => new Date()) {
  const parsed = value ? new Date(value) : now();
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString();
}

function normalizeOrderId(value) {
  const orderId = truncate(value, 120);
  return /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(orderId) ? orderId : '';
}

function normalizeExternalEventId(value) {
  const externalEventId = truncate(value, 200);
  return /^[a-z0-9][a-z0-9:._/-]{0,199}$/i.test(externalEventId)
    ? externalEventId
    : '';
}

function normalizeAutomationRunId(value) {
  const automationRunId = truncate(value, 160);
  return /^[a-z0-9][a-z0-9:._-]{0,159}$/i.test(automationRunId)
    ? automationRunId
    : '';
}

function buildEventKey(source, eventKind, externalEventId) {
  return crypto
    .createHash('sha256')
    .update(`${source}:${eventKind}:${externalEventId}`)
    .digest('hex');
}

function validateAutomationEventInput(input = {}, options = {}) {
  const eventKind = normalizeString(input.eventKind).toLowerCase();
  const source = normalizeString(input.source).toLowerCase();
  const orderId = normalizeOrderId(input.orderId);
  const externalEventId = normalizeExternalEventId(input.externalEventId);
  const automationRunId = normalizeAutomationRunId(input.automationRunId);
  const evidenceHash = normalizeString(input.evidenceHash).toLowerCase();
  const occurredAt = normalizeOccurredAt(input.occurredAt, options.now);
  const errors = [];

  if (!MONETARY_EVENT_KINDS.has(eventKind) && !MILESTONE_EVENT_KINDS.has(eventKind)) {
    errors.push('eventKind is niet toegestaan.');
  }
  if (!ALLOWED_AUTOMATION_SOURCES.has(source)) errors.push('source is niet toegestaan.');
  if (!orderId) errors.push('orderId is ongeldig.');
  if (!externalEventId) errors.push('externalEventId is ongeldig.');
  if (!automationRunId) errors.push('automationRunId is verplicht.');
  if (!isSha256(evidenceHash)) errors.push('evidenceHash moet een SHA-256 hash zijn.');
  if (!occurredAt) errors.push('occurredAt is ongeldig.');

  let amountEur = null;
  if (MONETARY_EVENT_KINDS.has(eventKind)) {
    amountEur = Number(input.amountEur);
    const minimumAmount = eventKind === 'lead_cost' || eventKind === 'delivery_cost' ? 0 : Number.EPSILON;
    if (!Number.isFinite(amountEur) || amountEur < minimumAmount || amountEur > 1_000_000) {
      errors.push('amountEur heeft een ongeldige of onbegrensde waarde.');
    } else {
      amountEur = Math.round(amountEur * 100) / 100;
    }
  } else if (input.amountEur !== null && input.amountEur !== undefined && input.amountEur !== '') {
    errors.push('amountEur hoort niet bij dit eventKind.');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    event: {
      eventKey: buildEventKey(source, eventKind, externalEventId),
      eventKind,
      orderId,
      amountEur,
      source,
      externalEventId,
      automationRunId,
      evidenceHash,
      autonomous: true,
      occurredAt,
      metadata: {},
    },
  };
}

function extractPaymentObjects(payload) {
  const notifications = Array.isArray(payload?.NotificationUrl)
    ? payload.NotificationUrl
    : payload?.NotificationUrl && typeof payload.NotificationUrl === 'object'
      ? [payload.NotificationUrl]
      : [];
  return notifications
    .map((entry) => entry && (entry.Payment || entry.payment))
    .filter((entry) => entry && typeof entry === 'object');
}

function maskIban(value) {
  const iban = normalizeString(value).replace(/\s+/g, '').toUpperCase();
  if (iban.length < 8) return '';
  return `${iban.slice(0, 4)}...${iban.slice(-4)}`;
}

function buildBunqPaymentEvents(payload, options = {}) {
  const prefix = normalizeString(options.orderReferencePrefix || 'SOFTORA')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 40) || 'SOFTORA';
  const referencePattern = new RegExp(`\\b${prefix}-([a-z0-9][a-z0-9_-]{0,119})\\b`, 'i');
  const receivedAt = normalizeOccurredAt('', options.now);
  const events = [];
  const ignored = [];

  extractPaymentObjects(payload).forEach((payment) => {
    const externalEventId = normalizeExternalEventId(payment.id);
    const amount = Number(payment?.amount?.value);
    const currency = normalizeString(payment?.amount?.currency).toUpperCase();
    const description = truncate(payment.description, 500);
    const referenceMatch = description.match(referencePattern);
    const orderId = normalizeOrderId(referenceMatch && referenceMatch[1]);
    const occurredAt = normalizeOccurredAt(payment.created || payment.updated, options.now);

    if (!externalEventId || !Number.isFinite(amount) || amount <= 0 || currency !== 'EUR') {
      ignored.push({ externalEventId, reason: 'geen-positieve-eur-betaling' });
      return;
    }
    if (!occurredAt) {
      ignored.push({ externalEventId, reason: 'ongeldige-betaaldatum' });
      return;
    }
    if (!orderId) {
      ignored.push({ externalEventId, reason: 'geen-softora-orderreferentie' });
      return;
    }

    const paymentEvidence = {
      id: externalEventId,
      amount: Math.round(amount * 100) / 100,
      currency,
      description,
      created: occurredAt,
      counterparty: truncate(
        payment?.counterparty_alias?.display_name || payment?.alias?.display_name,
        160
      ),
      iban: maskIban(payment?.counterparty_alias?.iban || payment?.alias?.iban),
    };
    const evidenceHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(paymentEvidence))
      .digest('hex');

    events.push({
      eventKey: buildEventKey('bunq', 'cash_in', externalEventId),
      eventKind: 'cash_in',
      orderId,
      amountEur: paymentEvidence.amount,
      source: 'bunq',
      externalEventId,
      automationRunId: 'bunq-received-payment-webhook',
      evidenceHash,
      autonomous: true,
      occurredAt,
      metadata: {
        currency,
        description,
        counterparty: paymentEvidence.counterparty,
        iban: paymentEvidence.iban,
        receivedAt,
      },
    });
  });

  return { events, ignored };
}

module.exports = {
  ALLOWED_AUTOMATION_SOURCES,
  MILESTONE_EVENT_KINDS,
  MONETARY_EVENT_KINDS,
  buildBunqPaymentEvents,
  buildEventKey,
  extractPaymentObjects,
  isSha256,
  maskIban,
  normalizeOrderId,
  validateAutomationEventInput,
};
