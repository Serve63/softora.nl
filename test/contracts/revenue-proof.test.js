const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBunqPaymentEvents,
  validateAutomationEventInput,
} = require('../../server/schemas/revenue-proof');
const {
  buildRevenueProofStatus,
  createRevenueProofService,
  isTrustedBunqIpv4,
  previousMonthKeys,
} = require('../../server/services/revenue-proof');

const HASH = 'a'.repeat(64);

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest({ body = {}, token = 'secret', ip = '185.40.108.42' } = {}) {
  return {
    body,
    ip,
    query: {},
    headers: { 'x-softora-bunq-webhook-secret': token },
    get(name) {
      return this.headers[String(name || '').toLowerCase()] || '';
    },
  };
}

function buildBunqPayload({
  id = 123,
  value = '4950.00',
  description = 'Factuur SOFTORA-order_1',
  created = '2026-06-10T09:00:00.000Z',
} = {}) {
  return {
    NotificationUrl: [{
      Payment: {
        id,
        created,
        amount: { value, currency: 'EUR' },
        description,
        counterparty_alias: {
          display_name: 'Voorbeeld B.V.',
          iban: 'NL02BUNQ1234567890',
        },
      },
    }],
  };
}

function event({ kind, orderId, occurredAt, amountEur = null, source = 'softora' }) {
  return {
    eventKey: `${orderId}:${kind}`,
    eventKind: kind,
    orderId,
    amountEur,
    source,
    externalEventId: `${orderId}-${kind}`,
    automationRunId: kind === 'cash_in' ? 'bunq-received-payment-webhook' : `run-${orderId}`,
    evidenceHash: HASH,
    autonomous: true,
    occurredAt,
    metadata: {},
  };
}

function completeOrderEvents(orderId, month) {
  const occurredAt = `${month}-10T09:00:00.000Z`;
  return [
    event({ kind: 'lead_qualified', orderId, occurredAt, source: 'offerti' }),
    event({ kind: 'proposal_sent', orderId, occurredAt, source: 'offerti' }),
    event({ kind: 'contract_accepted', orderId, occurredAt, source: 'gmail' }),
    event({ kind: 'cash_in', orderId, occurredAt, amountEur: 4950, source: 'bunq' }),
    event({ kind: 'lead_cost', orderId, occurredAt, amountEur: 468, source: 'offerti' }),
    event({ kind: 'delivery_cost', orderId, occurredAt, amountEur: 350 }),
    event({ kind: 'delivery_accepted', orderId, occurredAt, source: 'gmail' }),
  ];
}

test('automation event validation only accepts autonomous non-bank evidence', () => {
  const valid = validateAutomationEventInput({
    eventKind: 'lead_cost',
    orderId: 'order_1',
    amountEur: 39,
    source: 'offerti',
    externalEventId: 'request-159602',
    automationRunId: 'codex:2026-07-22:01',
    evidenceHash: HASH,
    occurredAt: '2026-07-22T09:00:00.000Z',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.event.amountEur, 39);
  assert.equal(valid.event.autonomous, true);

  const forgedCash = validateAutomationEventInput({
    ...valid.event,
    eventKind: 'cash_in',
  });
  assert.equal(forgedCash.ok, false);
  assert.match(forgedCash.errors.join(' '), /eventKind/);
});

test('bunq parser records positive euro payments only with a Softora order reference', () => {
  const parsed = buildBunqPaymentEvents(buildBunqPayload(), {
    orderReferencePrefix: 'SOFTORA',
    now: () => new Date('2026-06-10T09:01:00.000Z'),
  });
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].orderId, 'order_1');
  assert.equal(parsed.events[0].amountEur, 4950);
  assert.equal(parsed.events[0].metadata.iban, 'NL02...7890');
  assert.equal(parsed.events[0].evidenceHash.length, 64);

  const missingReference = buildBunqPaymentEvents(buildBunqPayload({
    description: 'Factuur zonder referentie',
  }));
  assert.equal(missingReference.events.length, 0);
  assert.equal(missingReference.ignored[0].reason, 'geen-softora-orderreferentie');

  const outgoing = buildBunqPaymentEvents(buildBunqPayload({ value: '-10.00' }));
  assert.equal(outgoing.events.length, 0);
  assert.equal(outgoing.ignored[0].reason, 'geen-positieve-eur-betaling');

  const invalidDate = buildBunqPaymentEvents(buildBunqPayload({ created: 'geen-datum' }));
  assert.equal(invalidDate.events.length, 0);
  assert.equal(invalidDate.ignored[0].reason, 'ongeldige-betaaldatum');
});

test('zero delivery cost is explicit evidence while omitted costs keep proof incomplete', () => {
  const zeroCost = validateAutomationEventInput({
    eventKind: 'delivery_cost',
    orderId: 'order_1',
    amountEur: 0,
    source: 'softora',
    externalEventId: 'delivery-cost-order-1',
    automationRunId: 'codex:2026-07-22:01',
    evidenceHash: HASH,
    occurredAt: '2026-07-22T09:00:00.000Z',
  });
  assert.equal(zeroCost.ok, true);

  const events = completeOrderEvents('juni', '2026-06')
    .filter((entry) => entry.eventKind !== 'lead_cost');
  const proof = buildRevenueProofStatus(events, {
    now: new Date('2026-07-22T12:00:00.000Z'),
    targetEur: 1,
    requiredMonths: 1,
  });
  assert.equal(proof.proven, false);
  assert.deepEqual(proof.chains[0].missingKinds, ['lead_cost']);
});

test('three completed months only prove the target with complete autonomous chains', () => {
  const events = [
    ...completeOrderEvents('april', '2026-04'),
    ...completeOrderEvents('mei', '2026-05'),
    ...completeOrderEvents('juni', '2026-06'),
  ];
  const proof = buildRevenueProofStatus(events, {
    now: new Date('2026-07-22T12:00:00.000Z'),
    targetEur: 2500,
    requiredMonths: 3,
    timeZone: 'Europe/Amsterdam',
  });
  assert.deepEqual(previousMonthKeys(new Date('2026-07-22T12:00:00.000Z'), 3), [
    '2026-04',
    '2026-05',
    '2026-06',
  ]);
  assert.equal(proof.proven, true);
  assert.deepEqual(proof.months.map((month) => month.contributionEur), [4132, 4132, 4132]);

  const withoutDelivery = events.filter((entry) => !(
    entry.orderId === 'juni' && entry.eventKind === 'delivery_accepted'
  ));
  const failedProof = buildRevenueProofStatus(withoutDelivery, {
    now: new Date('2026-07-22T12:00:00.000Z'),
    targetEur: 2500,
    requiredMonths: 3,
  });
  assert.equal(failedProof.proven, false);
  assert.deepEqual(failedProof.months[2].incompleteOrderIds, ['juni']);
});

test('manual or weak evidence can never complete an autonomous order chain', () => {
  const events = completeOrderEvents('juni', '2026-06');
  const proposal = events.find((entry) => entry.eventKind === 'proposal_sent');
  proposal.autonomous = false;
  proposal.automationRunId = '';
  const proof = buildRevenueProofStatus(events, {
    now: new Date('2026-07-22T12:00:00.000Z'),
    targetEur: 1,
    requiredMonths: 1,
  });
  assert.equal(proof.proven, false);
  assert.deepEqual(proof.chains[0].weakEvidenceKinds, ['proposal_sent']);
});

test('bunq webhook requires both the secret and the documented bunq source range', async () => {
  const stored = [];
  const repository = {
    configured: true,
    async appendEvents(events) {
      stored.push(...events);
      return events;
    },
    async listEvents() {
      return stored;
    },
  };
  const service = createRevenueProofService({
    enabled: true,
    webhookSecret: 'secret',
    requireTrustedBunqIp: true,
    getClientIpFromRequest: (req) => req.ip,
    repository,
    now: () => new Date('2026-06-10T09:01:00.000Z'),
  });

  const unauthorized = createResponse();
  await service.bunqWebhookResponse(createRequest({ token: 'wrong', body: buildBunqPayload() }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const wrongSource = createResponse();
  await service.bunqWebhookResponse(createRequest({ ip: '203.0.113.10', body: buildBunqPayload() }), wrongSource);
  assert.equal(wrongSource.statusCode, 403);

  const accepted = createResponse();
  await service.bunqWebhookResponse(createRequest({ body: buildBunqPayload() }), accepted);
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.body, { ok: true, accepted: 1, ignored: 0 });
  assert.equal(stored.length, 1);
  assert.equal(isTrustedBunqIpv4('185.40.111.255'), true);
  assert.equal(isTrustedBunqIpv4('185.40.112.0'), false);
});

test('disabled proof service fails closed without touching storage', async () => {
  let writes = 0;
  const service = createRevenueProofService({
    enabled: false,
    webhookSecret: 'secret',
    repository: {
      configured: true,
      async appendEvents() { writes += 1; },
      async listEvents() { return []; },
    },
  });
  const res = createResponse();
  await service.bunqWebhookResponse(createRequest({ body: buildBunqPayload() }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(writes, 0);
});
