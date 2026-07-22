const crypto = require('node:crypto');

const { createRevenueProofRepository } = require('../repositories/revenue-proof');
const {
  buildBunqPaymentEvents,
  validateAutomationEventInput,
} = require('../schemas/revenue-proof');

const DEFAULT_TARGET_EUR = 2500;
const DEFAULT_REQUIRED_MONTHS = 3;
const DEFAULT_TIME_ZONE = 'Europe/Amsterdam';
const REQUIRED_CHAIN_KINDS = Object.freeze([
  'lead_qualified',
  'lead_cost',
  'proposal_sent',
  'contract_accepted',
  'cash_in',
  'delivery_cost',
  'delivery_accepted',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function isEnabled(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(normalizeString(value));
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(normalizeString(actual));
  const right = Buffer.from(normalizeString(expected));
  return Boolean(
    left.length &&
    right.length &&
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function extractWebhookToken(req) {
  return normalizeString(
    req?.get?.('x-softora-bunq-webhook-secret') ||
    req?.headers?.['x-softora-bunq-webhook-secret'] ||
    req?.query?.token
  );
}

function ipv4ToNumber(value) {
  const parts = normalizeString(value).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((total, part) => ((total << 8) | part) >>> 0, 0);
}

function isTrustedBunqIpv4(value) {
  const ipNumber = ipv4ToNumber(value);
  const network = ipv4ToNumber('185.40.108.0');
  if (ipNumber === null || network === null) return false;
  const mask = 0xfffffc00;
  return (ipNumber & mask) === (network & mask);
}

function getYearMonth(date, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

function previousMonthKeys(now, count, timeZone = DEFAULT_TIME_ZONE) {
  const currentKey = getYearMonth(now, timeZone);
  const match = currentKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const currentYear = Number(match[1]);
  const currentMonth = Number(match[2]);
  const keys = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const date = new Date(Date.UTC(currentYear, currentMonth - 1 - offset, 15, 12));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys.reverse();
}

function resolveContributionSign(eventKind) {
  if (eventKind === 'cash_in') return 1;
  if (eventKind === 'lead_cost' || eventKind === 'delivery_cost' || eventKind === 'refund') return -1;
  return 0;
}

function buildOrderChainStatus(events = []) {
  const grouped = new Map();
  events.forEach((event) => {
    const orderId = normalizeString(event.orderId);
    if (!orderId) return;
    if (!grouped.has(orderId)) grouped.set(orderId, []);
    grouped.get(orderId).push(event);
  });

  return Array.from(grouped.entries()).map(([orderId, orderEvents]) => {
    const kinds = new Set(orderEvents.map((event) => event.eventKind));
    const missingKinds = REQUIRED_CHAIN_KINDS.filter((kind) => !kinds.has(kind));
    const weakEvidence = orderEvents.filter((event) => (
      !event.autonomous ||
      !normalizeString(event.automationRunId) ||
      !/^[a-f0-9]{64}$/.test(normalizeString(event.evidenceHash).toLowerCase())
    ));
    return {
      orderId,
      complete: missingKinds.length === 0 && weakEvidence.length === 0,
      missingKinds,
      weakEvidenceKinds: Array.from(new Set(weakEvidence.map((event) => event.eventKind))),
      cashInEur: Math.round(orderEvents
        .filter((event) => event.eventKind === 'cash_in')
        .reduce((sum, event) => sum + (Number(event.amountEur) || 0), 0) * 100) / 100,
    };
  });
}

function buildRevenueProofStatus(events = [], options = {}) {
  const targetEur = Math.max(1, Number(options.targetEur) || DEFAULT_TARGET_EUR);
  const requiredMonths = Math.max(1, Math.min(12, Number(options.requiredMonths) || DEFAULT_REQUIRED_MONTHS));
  const timeZone = normalizeString(options.timeZone) || DEFAULT_TIME_ZONE;
  const now = options.now instanceof Date ? options.now : new Date();
  const proofMonthKeys = previousMonthKeys(now, requiredMonths, timeZone);
  const monthly = new Map();

  events.forEach((event) => {
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) return;
    const month = getYearMonth(occurredAt, timeZone);
    if (!month) return;
    if (!monthly.has(month)) {
      monthly.set(month, { month, cashInEur: 0, costsEur: 0, contributionEur: 0, cashOrderIds: new Set() });
    }
    const row = monthly.get(month);
    const amount = Number(event.amountEur) || 0;
    const sign = resolveContributionSign(event.eventKind);
    if (sign > 0) {
      row.cashInEur += amount;
      row.cashOrderIds.add(event.orderId);
    } else if (sign < 0) {
      row.costsEur += amount;
    }
    row.contributionEur += sign * amount;
  });

  const chainRows = buildOrderChainStatus(events);
  const chainByOrder = new Map(chainRows.map((row) => [row.orderId, row]));
  const months = proofMonthKeys.map((month) => {
    const source = monthly.get(month) || {
      month,
      cashInEur: 0,
      costsEur: 0,
      contributionEur: 0,
      cashOrderIds: new Set(),
    };
    const cashOrderIds = Array.from(source.cashOrderIds);
    const incompleteOrderIds = cashOrderIds.filter((orderId) => !chainByOrder.get(orderId)?.complete);
    const contributionEur = Math.round(source.contributionEur * 100) / 100;
    return {
      month,
      cashInEur: Math.round(source.cashInEur * 100) / 100,
      costsEur: Math.round(source.costsEur * 100) / 100,
      contributionEur,
      cashOrderIds,
      incompleteOrderIds,
      targetMet: contributionEur >= targetEur,
      autonomousChainsComplete: cashOrderIds.length > 0 && incompleteOrderIds.length === 0,
    };
  });
  const proven = months.length === requiredMonths && months.every((month) => (
    month.targetMet && month.autonomousChainsComplete
  ));

  return {
    proven,
    targetEur,
    requiredConsecutiveCompletedMonths: requiredMonths,
    timeZone,
    months,
    chains: chainRows,
    eventCount: events.length,
    reasons: proven
      ? []
      : months.flatMap((month) => {
          const reasons = [];
          if (!month.targetMet) reasons.push(`${month.month}: bijdrage onder €${targetEur}.`);
          if (!month.autonomousChainsComplete) reasons.push(`${month.month}: autonome bewijsketen onvolledig.`);
          return reasons;
        }),
  };
}

function createRevenueProofService(options = {}) {
  const repository = options.repository || createRevenueProofRepository({
    getSupabaseClient: options.getSupabaseClient,
  });
  const enabled = isEnabled(options.enabled);
  const webhookSecret = normalizeString(options.webhookSecret);
  const requireTrustedBunqIp = options.requireTrustedBunqIp === undefined
    ? true
    : isEnabled(options.requireTrustedBunqIp);
  const getClientIpFromRequest = typeof options.getClientIpFromRequest === 'function'
    ? options.getClientIpFromRequest
    : (req) => normalizeString(req?.ip || req?.socket?.remoteAddress);

  function configStatus() {
    return {
      enabled,
      repositoryConfigured: Boolean(repository.configured),
      webhookSecretConfigured: Boolean(webhookSecret),
      requireTrustedBunqIp,
    };
  }

  async function bunqWebhookResponse(req, res) {
    if (!enabled || !webhookSecret || !repository.configured) {
      return res.status(503).json({ ok: false, error: 'Revenue-proof webhook is uitgeschakeld.' });
    }
    if (!safeTokenEqual(extractWebhookToken(req), webhookSecret)) {
      return res.status(401).json({ ok: false, error: 'Revenue-proof webhook geweigerd.' });
    }
    const clientIp = getClientIpFromRequest(req);
    if (requireTrustedBunqIp && !isTrustedBunqIpv4(clientIp)) {
      return res.status(403).json({ ok: false, error: 'Revenue-proof bron geweigerd.' });
    }

    const parsed = buildBunqPaymentEvents(req.body, {
      orderReferencePrefix: options.orderReferencePrefix,
      now: options.now,
    });
    await repository.appendEvents(parsed.events);
    return res.status(202).json({
      ok: true,
      accepted: parsed.events.length,
      ignored: parsed.ignored.length,
    });
  }

  async function automationEventResponse(req, res) {
    if (!enabled || !repository.configured) {
      return res.status(503).json({ ok: false, error: 'Revenue-proof opslag is uitgeschakeld.' });
    }
    const validation = validateAutomationEventInput(req.body, { now: options.now });
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: 'Ongeldig revenue-proof event.', details: validation.errors });
    }
    const stored = await repository.appendEvents([validation.event]);
    return res.status(stored.length ? 201 : 200).json({
      ok: true,
      eventKey: validation.event.eventKey,
      stored: stored.length > 0,
    });
  }

  async function statusResponse(_req, res) {
    if (!enabled || !repository.configured) {
      return res.status(200).json({ ok: true, configured: configStatus(), proof: null });
    }
    const events = await repository.listEvents({ limit: 5000 });
    const proof = buildRevenueProofStatus(events, {
      targetEur: options.targetEur,
      requiredMonths: options.requiredMonths,
      timeZone: options.timeZone,
      now: typeof options.now === 'function' ? options.now() : options.now,
    });
    return res.status(200).json({ ok: true, configured: configStatus(), proof });
  }

  return {
    automationEventResponse,
    bunqWebhookResponse,
    buildStatus: (events, statusOptions = {}) => buildRevenueProofStatus(events, {
      targetEur: options.targetEur,
      requiredMonths: options.requiredMonths,
      timeZone: options.timeZone,
      ...statusOptions,
    }),
    configStatus,
    repository,
    statusResponse,
  };
}

module.exports = {
  DEFAULT_REQUIRED_MONTHS,
  DEFAULT_TARGET_EUR,
  DEFAULT_TIME_ZONE,
  REQUIRED_CHAIN_KINDS,
  buildOrderChainStatus,
  buildRevenueProofStatus,
  createRevenueProofService,
  extractWebhookToken,
  getYearMonth,
  ipv4ToNumber,
  isTrustedBunqIpv4,
  previousMonthKeys,
  safeTokenEqual,
};
