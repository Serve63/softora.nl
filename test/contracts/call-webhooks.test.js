const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createCallWebhookRuntime } = require('../../server/services/call-webhooks');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'openai') return 'openai_realtime_1_5';
  return raw;
}

function createReq(overrides = {}) {
  const headers = Object.fromEntries(
    Object.entries(overrides.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    body: overrides.body || {},
    query: overrides.query || {},
    rawBody: overrides.rawBody,
    originalUrl: overrides.originalUrl || '/api/test',
    url: overrides.url || overrides.originalUrl || '/api/test',
    path: overrides.path || '/api/test',
    secure: Boolean(overrides.secure),
    get(name) {
      return headers[String(name || '').toLowerCase()] || '';
    },
  };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    jsonBody: null,
    textBody: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
    send(payload) {
      this.textBody = String(payload);
      return this;
    },
  };
}

function createRuntime(overrides = {}) {
  const auditEvents = [];
  const upserts = [];
  const automationCalls = [];
  const recentWebhookEvents = [];

  const runtime = createCallWebhookRuntime({
    env: {
      RETELL_API_KEY: 'retell-key',
      WEBHOOK_SECRET: '',
      TWILIO_WEBHOOK_SECRET: 'twilio-secret',
      TWILIO_ALLOWED_CALLERS: '',
      ...overrides.env,
    },
    normalizeString,
    normalizeColdcallingStack,
    normalizeAbsoluteHttpUrl: (value) => normalizeString(value).replace(/\/+$/, ''),
    getEffectivePublicBaseUrl: overrides.getEffectivePublicBaseUrl || (() => 'https://softora.test'),
    isSecureHttpRequest: (req) => Boolean(req.secure),
    appendQueryParamsToUrl: (url, params) => {
      const parsed = new URL(url);
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        parsed.searchParams.set(key, String(value));
      });
      return parsed.toString();
    },
    escapeHtml: (value) => normalizeString(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
    getClientIpFromRequest: () => '127.0.0.1',
    getRequestPathname: (req) => req.path || '/api/test',
    getRequestOriginFromHeaders: () => 'https://softora.test',
    appendSecurityAuditEvent: (event) => auditEvents.push(event),
    getColdcallingStackLabel: (stack) =>
      stack === 'openai_realtime_1_5' ? 'OpenAI Realtime 1.5' : normalizeString(stack),
    getTwilioMediaWsUrlForStack: overrides.getTwilioMediaWsUrlForStack || (() => 'wss://media.softora.test/ws'),
    buildTwilioStatusCallbackUrl:
      overrides.buildTwilioStatusCallbackUrl || (() => 'https://softora.test/api/twilio/status'),
    upsertRecentCallUpdate: (update) => {
      upserts.push(update);
      return overrides.upsertRecentCallUpdateResult || update;
    },
    extractCallUpdateFromTwilioPayload:
      overrides.extractCallUpdateFromTwilioPayload || ((payload, options = {}) => ({ callId: payload.CallSid, stack: options.stack })),
    extractCallUpdateFromRetellPayload:
      overrides.extractCallUpdateFromRetellPayload || ((payload) => ({ callId: payload.call?.call_id || 'call_retell' })),
    triggerPostCallAutomation: (callUpdate) => automationCalls.push(callUpdate),
    waitForQueuedRuntimeStatePersist: async () => true,
    recentWebhookEvents,
    verboseCallWebhookLogs: Boolean(overrides.verboseCallWebhookLogs),
    timingSafeEqualStrings: (left, right) => left === right,
    logger: { log() {}, error() {} },
  });

  return { runtime, auditEvents, upserts, automationCalls, recentWebhookEvents };
}

test('call webhooks verify retell signatures against raw webhook payloads', () => {
  const { runtime } = createRuntime();
  const rawBody = JSON.stringify({ event: 'call_ended', call: { call_id: 'call_123' } });
  const timestamp = Date.now();
  const digest = crypto.createHmac('sha256', 'retell-key').update(`${rawBody}${timestamp}`).digest('hex');
  const req = createReq({
    rawBody,
    body: JSON.parse(rawBody),
    headers: {
      'x-retell-signature': `v=${timestamp},d=${digest}`,
    },
  });

  assert.equal(runtime.isRetellWebhookAuthorized(req), true);
  assert.deepEqual(runtime.parseRetellSignatureHeader(`v=${timestamp},d=${digest}`), {
    timestamp,
    digest,
  });
});

test('call webhooks handle inbound twilio voice selection and start an inbound call update', () => {
  const context = createRuntime();
  const req = createReq({
    path: '/api/twilio/voice',
    body: {
      CallSid: 'CA123',
      From: '+31612345678',
      To: '+31880000000',
      CallerName: 'Serve',
      stack: 'openai',
    },
    headers: {
      'x-webhook-secret': 'twilio-secret',
    },
  });
  const res = createRes();

  context.runtime.handleTwilioInboundVoice(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/xml');
  assert.match(res.textBody, /<Stream url="wss:\/\/media\.softora\.test\/ws"/);
  assert.match(res.textBody, /<Parameter name="stack" value="openai_realtime_1_5" \/>/);
  assert.match(res.textBody, /<Parameter name="callSid" value="CA123" \/>/);
  assert.match(res.textBody, /<Parameter name="to" value="\+31880000000" \/>/);
  assert.match(res.textBody, /<Parameter name="from" value="\+31612345678" \/>/);
  assert.equal(context.upserts.length, 1);
  assert.equal(context.upserts[0].callId, 'CA123');
  assert.equal(context.upserts[0].stack, 'openai_realtime_1_5');
});

test('call webhooks reject unauthorized twilio status callbacks and emit an audit event', async () => {
  const context = createRuntime();
  const req = createReq({
    path: '/api/twilio/status',
    body: { CallSid: 'CA123', CallStatus: 'completed' },
  });
  const res = createRes();

  await context.runtime.handleTwilioStatusWebhook(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.jsonBody?.ok, false);
  assert.equal(context.auditEvents.length, 1);
  assert.equal(context.upserts.length, 0);
});

test('call webhooks store retell webhook events and trigger post-call automation', async () => {
  const context = createRuntime();
  const req = createReq({
    path: '/api/retell/webhook',
    body: {
      event: 'call_ended',
      call: {
        call_id: 'call_retell',
        call_status: 'completed',
        disconnection_reason: 'completed',
      },
    },
  });
  const res = createRes();

  await context.runtime.handleRetellWebhook(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody?.ok, true);
  assert.equal(context.recentWebhookEvents.length, 1);
  assert.equal(context.recentWebhookEvents[0].callId, 'call_retell');
  assert.equal(context.automationCalls.length, 1);
  assert.equal(context.automationCalls[0].callId, 'call_retell');
});
