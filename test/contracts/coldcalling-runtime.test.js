const test = require('node:test');
const assert = require('node:assert/strict');

const { createColdcallingRuntime } = require('../../server/services/coldcalling-runtime');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'openai') return 'openai_realtime_1_5';
  return raw;
}

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRuntime(overrides = {}) {
  const upserts = [];
  const refreshedByCallId = new Map();
  const errors = [];
  const queued = [];

  const runtime = createColdcallingRuntime({
    normalizeString,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    getColdcallingStackLabel: (stack) =>
      stack === 'openai_realtime_1_5' ? 'OpenAI Realtime 1.5' : normalizeString(stack),
    resolveColdcallingProviderForCampaign:
      overrides.resolveColdcallingProviderForCampaign || ((campaign) => campaign.provider || 'retell'),
    buildRetellPayload:
      overrides.buildRetellPayload ||
      ((lead) => ({
        to_number: '+31612345678',
        lead,
      })),
    createRetellOutboundCall:
      overrides.createRetellOutboundCall ||
      (async () => ({
        endpoint: '/v2/create-phone-call',
        data: { call_id: 'call_retell', call_status: 'registered', start_timestamp: 1_700_000_000 },
      })),
    classifyRetellFailure: overrides.classifyRetellFailure || (() => ({ cause: 'credits', explanation: 'uitleg' })),
    toIsoFromUnixMilliseconds: overrides.toIsoFromUnixMilliseconds || (() => '2023-11-14T22:13:20.000Z'),
    upsertRecentCallUpdate:
      overrides.upsertRecentCallUpdate ||
      ((update) => {
        upserts.push(update);
        return refreshedByCallId.get(update.callId) || update;
      }),
    refreshCallUpdateFromRetellStatusApi:
      overrides.refreshCallUpdateFromRetellStatusApi ||
      (async (callId) => refreshedByCallId.get(callId) || null),
    waitForQueuedRuntimeStatePersist:
      overrides.waitForQueuedRuntimeStatePersist ||
      (async () => {
        queued.push('persist');
        return true;
      }),
    sleep: overrides.sleep || (async () => {}),
    buildTwilioOutboundPayload:
      overrides.buildTwilioOutboundPayload ||
      (() => ({
        To: '+31612345678',
      })),
    createTwilioOutboundCall:
      overrides.createTwilioOutboundCall ||
      (async () => ({
        endpoint: '/2010-04-01/Accounts/AC123/Calls.json',
        data: { sid: 'CA123', status: 'queued', date_created: '2026-04-16T19:00:00Z' },
      })),
    classifyTwilioFailure:
      overrides.classifyTwilioFailure || (() => ({ cause: 'invalid number', explanation: 'twilio uitleg' })),
    parseDateToIso: overrides.parseDateToIso || ((value) => normalizeString(value)),
    handleSequentialDispatchQueueWebhookProgress:
      overrides.handleSequentialDispatchQueueWebhookProgress || (() => {}),
    ensureRuleBasedInsightAndAppointment:
      overrides.ensureRuleBasedInsightAndAppointment || (() => {}),
    maybeAnalyzeCallUpdateWithAi: overrides.maybeAnalyzeCallUpdateWithAi || (async () => null),
    logger: overrides.logger || {
      error: (...args) => errors.push(args),
    },
  });

  return {
    runtime,
    upserts,
    refreshedByCallId,
    errors,
    queued,
  };
}

test('coldcalling runtime validateStartPayload normalizes campaign settings safely', () => {
  const { runtime } = createRuntime();

  const validated = runtime.validateStartPayload({
    campaign: {
      amount: '4',
      sector: 'Software',
      region: 'Nederland',
      minProjectValue: '1500',
      maxDiscountPct: '12',
      extraInstructions: 'Kort en duidelijk',
      dispatchMode: 'delay',
      dispatchDelaySeconds: '9',
      coldcallingStack: 'openai',
    },
    leads: [{ id: 1 }, { id: 2 }],
  });

  assert.equal(validated.error, undefined);
  assert.equal(validated.campaign.amount, 4);
  assert.equal(validated.campaign.dispatchMode, 'delay');
  assert.equal(validated.campaign.dispatchDelaySeconds, 9);
  assert.equal(validated.campaign.coldcallingStack, 'openai_realtime_1_5');
  assert.equal(validated.campaign.coldcallingStackLabel, 'OpenAI Realtime 1.5');
});

test('coldcalling runtime processRetellColdcallingLead returns dial-failed result after refresh', async () => {
  const context = createRuntime({
    refreshCallUpdateFromRetellStatusApi: async () => ({
      status: 'not_connected',
      endedReason: 'dial_failed',
      startedAt: '2026-04-16T19:00:00Z',
    }),
  });

  const result = await context.runtime.processRetellColdcallingLead(
    { name: 'Serve', company: 'Softora', phone: '0612345678', region: 'Utrecht' },
    { sector: 'Software', region: 'Randstad' },
    0
  );

  assert.equal(result.success, false);
  assert.equal(result.cause, 'dial failed');
  assert.equal(result.lead.phoneE164, '+31612345678');
  assert.equal(context.queued.length, 1);
  assert.equal(context.upserts.length, 1);
});

test('coldcalling runtime processColdcallingLead routes to twilio and preserves terminal failure shape', async () => {
  const { runtime } = createRuntime({
    resolveColdcallingProviderForCampaign: () => 'twilio',
    upsertRecentCallUpdate: (update) => ({
      ...update,
      status: 'failed',
      endedReason: 'busy',
    }),
  });

  const result = await runtime.processColdcallingLead(
    { name: 'Serve', company: 'Softora', phone: '0612345678', region: 'Utrecht' },
    { provider: 'twilio', sector: 'Software', region: 'Randstad' },
    1
  );

  assert.equal(result.success, false);
  assert.equal(result.cause, 'dial failed');
  assert.equal(result.details.status, 'failed');
  assert.equal(result.lead.phoneE164, '+31612345678');
});

test('coldcalling runtime triggerPostCallAutomation fans out and logs AI failures without throwing', async () => {
  const handled = [];
  const ensured = [];
  const context = createRuntime({
    handleSequentialDispatchQueueWebhookProgress: (callUpdate) => handled.push(callUpdate.callId),
    ensureRuleBasedInsightAndAppointment: (callUpdate) => ensured.push(callUpdate.callId),
    maybeAnalyzeCallUpdateWithAi: async () => {
      throw new Error('AI down');
    },
  });

  context.runtime.triggerPostCallAutomation({ callId: 'call_123' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(handled, ['call_123']);
  assert.deepEqual(ensured, ['call_123']);
  assert.equal(context.errors.length, 1);
  assert.match(String(context.errors[0][1] || ''), /call_123/);
});
