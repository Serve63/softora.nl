const test = require('node:test');
const assert = require('node:assert/strict');

const { createCallProviderHelpers } = require('../../server/services/call-provider-helpers');
const {
  normalizeColdcallingStack,
  normalizeNlPhoneToE164,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
  truncateText,
} = require('../../server/services/runtime-primitives');

function appendQueryParamsToUrl(url, params = {}) {
  const parsed = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    parsed.searchParams.set(key, String(value));
  });
  return parsed.toString();
}

function normalizeAbsoluteHttpUrl(value) {
  const raw = normalizeString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
}

function createHelpers(overrides = {}) {
  return createCallProviderHelpers({
    env: {
      RETELL_API_BASE_URL: 'https://retell.example/v2',
      RETELL_API_KEY: 'retell-token',
      TWILIO_API_BASE_URL: 'https://twilio.example',
      RETELL_FROM_NUMBER: '+31600000000',
      RETELL_AGENT_ID: 'agent_123',
      RETELL_AGENT_VERSION: '2',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token-xyz',
      TWILIO_FROM_NUMBER: '+31600000000',
      TWILIO_FROM_NUMBER_OPENAI_REALTIME_1_5: '+31611111111',
      TWILIO_MEDIA_WS_URL: 'wss://default.example/media',
      TWILIO_MEDIA_WS_URL_OPENAI_REALTIME_1_5: 'wss://openai.example/media',
      TWILIO_WEBHOOK_SECRET: 'secret-123',
      TWILIO_DIAL_TIMEOUT_SECONDS: '45',
      ...overrides.env,
    },
    retellApiBaseUrl: 'https://retell.example/v2',
    twilioApiBaseUrl: 'https://twilio.example',
    defaultTwilioMediaWsUrl: 'wss://default.example/media',
    fetchJsonWithTimeout: overrides.fetchJsonWithTimeout || (async () => ({
      response: { ok: true, status: 200 },
      data: { recordings: [] },
    })),
    getEffectivePublicBaseUrl: (_req, overrideValue = '') => overrideValue || 'https://softora.test',
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeString,
    normalizeColdcallingStack,
    normalizeNlPhoneToE164,
    parseIntSafe,
    parseNumberSafe,
    truncateText,
    getColdcallingStackLabel: (stack) => {
      if (stack === 'openai_realtime_1_5') return 'OpenAI Realtime 1.5';
      if (stack === 'gemini_flash_3_1_live') return 'Gemini 3.1 Live';
      return 'Retell AI';
    },
    extractRetellTranscriptText: (call) => normalizeString(call?.transcript || ''),
  });
}

test('call provider helpers classify failures and build provider urls', async () => {
  let capturedAuthHeader = '';
  const helpers = createHelpers({
    fetchJsonWithTimeout: async (_url, options) => {
      capturedAuthHeader = options?.headers?.Authorization || '';
      return {
        response: { ok: true, status: 200 },
        data: { recordings: [{ sid: 'RE1234567890abcdef1234567890abcdef' }] },
      };
    },
  });

  assert.equal(helpers.classifyRetellFailure({ status: 402, message: 'payment required' }).cause, 'credits');
  assert.equal(
    helpers.classifyTwilioFailure({ status: 401, message: 'invalid credentials' }).cause,
    'wrong twilio credentials'
  );
  assert.equal(
    helpers.buildRetellApiUrl('/calls', { page: 2 }).toString(),
    'https://retell.example/v2/calls?page=2'
  );
  assert.equal(helpers.buildTwilioApiUrl('/2010-04-01/Calls.json').toString(), 'https://twilio.example/2010-04-01/Calls.json');
  assert.match(helpers.getTwilioBasicAuthorizationHeader(), /^Basic /);

  const result = await helpers.fetchTwilioRecordingsByCallId('CA1234567890abcdef1234567890abcdef');
  assert.equal(result.recordings.length, 1);
  assert.match(capturedAuthHeader, /^Basic /);
});

test('call provider helpers execute outbound and status api calls with provider-specific auth', async () => {
  const calls = [];
  const helpers = createHelpers({
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({
        url: url.toString(),
        method: options?.method || 'GET',
        auth: options?.headers?.Authorization || '',
        body: options?.body || '',
      });
      return {
        response: { ok: true, status: 200 },
        data: { ok: true, sid: 'CA999', call_id: 'call_999' },
      };
    },
  });

  await helpers.createRetellOutboundCall({ to_number: '+31612345678' });
  await helpers.fetchRetellCallStatusById('call_999');
  await helpers.createTwilioOutboundCall({ To: '+31612345678', StatusCallbackEvent: ['answered'] });
  await helpers.fetchTwilioCallStatusById('CA999');

  assert.equal(calls[0].url, 'https://retell.example/v2/v2/create-phone-call');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].auth, 'Bearer retell-token');
  assert.match(calls[0].body, /to_number/);

  assert.equal(calls[1].url, 'https://retell.example/v2/v2/get-call/call_999');
  assert.equal(calls[1].method, 'GET');

  assert.equal(calls[2].url, 'https://twilio.example/2010-04-01/Accounts/AC123/Calls.json');
  assert.equal(calls[2].method, 'POST');
  assert.match(calls[2].auth, /^Basic /);
  assert.match(calls[2].body, /StatusCallbackEvent=answered/);

  assert.equal(calls[3].url, 'https://twilio.example/2010-04-01/Accounts/AC123/Calls/CA999.json');
  assert.equal(calls[3].method, 'GET');
  assert.match(calls[3].auth, /^Basic /);
});

test('call provider helpers normalize recording references and choose preferred recordings', () => {
  const helpers = createHelpers();

  assert.equal(
    helpers.extractTwilioRecordingSidFromUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1234567890abcdef1234567890abcdef'),
    'RE1234567890abcdef1234567890abcdef'
  );
  assert.equal(
    helpers.extractCallIdFromRecordingUrl('/api/coldcalling/recording-proxy?callId=CAabc'),
    'CAabc'
  );
  assert.equal(
    helpers.normalizeRecordingReference('/api/coldcalling/recording-proxy?callId=CAabc&foo=bar'),
    '/api/coldcalling/recording-proxy?callId=CAabc'
  );

  const preferred = helpers.choosePreferredTwilioRecording(
    [
      { sid: 'RE1', status: 'processing', duration: 12, date_updated: '2026-04-16T18:00:00Z' },
      { sid: 'RE2', status: 'completed', duration: 42, date_updated: '2026-04-16T18:01:00Z' },
      { sid: 'RE3', status: 'completed', duration: 8, date_updated: '2026-04-16T18:02:00Z' },
    ],
    'RE3'
  );
  assert.equal(preferred?.sid, 'RE2');

  assert.equal(
    helpers.resolvePreferredRecordingUrl({
      provider: 'twilio',
      callId: 'CA123',
      recordingUrl: 'https://api.twilio.com/Recordings/RE1',
    }),
    '/api/coldcalling/recording-proxy?callId=CA123'
  );
});

test('call provider helpers build outbound payloads and stack-specific urls', () => {
  const helpers = createHelpers();

  assert.deepEqual(helpers.getTwilioStackEnvSuffixes('openai'), [
    'OPENAI_REALTIME_1_5',
    'OPENAI_REALTIME',
    'OPENAI',
  ]);
  assert.equal(helpers.getTwilioMediaWsUrlForStack('openai'), 'wss://openai.example/media');
  assert.equal(helpers.getTwilioFromNumberForStack('openai'), '+31611111111');

  const twimlUrl = helpers.buildTwilioOutboundTwimlUrl('openai', {});
  const statusUrl = helpers.buildTwilioStatusCallbackUrl('openai', {});
  assert.match(twimlUrl, /stack=openai_realtime_1_5/);
  assert.match(statusUrl, /secret=secret-123/);

  const retellPayload = helpers.buildRetellPayload(
    { name: 'Serve', company: 'Softora', phone: '06 12 34 56 78', branche: 'AI', region: 'NL' },
    { sector: 'Software', region: 'Randstad' }
  );
  assert.equal(retellPayload.to_number, '+31612345678');
  assert.equal(retellPayload.override_agent_id, 'agent_123');
  assert.equal(retellPayload.override_agent_version, 2);
  assert.equal(retellPayload.retell_llm_dynamic_variables.company, 'Softora');

  const twilioPayload = helpers.buildTwilioOutboundPayload(
    { phone: '06 12 34 56 78' },
    { coldcallingStack: 'openai', publicBaseUrl: 'https://demo.softora.test' }
  );
  assert.equal(twilioPayload.To, '+31612345678');
  assert.equal(twilioPayload.From, '+31611111111');
  assert.match(twilioPayload.Url, /stack=openai_realtime_1_5/);
  assert.equal(twilioPayload.Timeout, '45');
});

test('call provider helpers extract stable retell and twilio call updates', () => {
  const helpers = createHelpers();

  const retellUpdate = helpers.extractCallUpdateFromRetellPayload({
    event: 'call_ended',
    call: {
      call_id: 'call_123',
      call_status: 'completed',
      to_number: '+31612345678',
      duration_ms: 45000,
      start_timestamp: 1_700_000_000,
      end_timestamp: 1_700_000_045,
      disconnection_reason: 'completed',
      transcript: 'Klant wil graag een demo ontvangen.',
      metadata: {
        leadCompany: 'Softora',
        leadName: 'Serve',
        leadRegion: 'Utrecht',
      },
    },
  });

  assert.equal(retellUpdate.callId, 'call_123');
  assert.equal(retellUpdate.provider, 'retell');
  assert.equal(retellUpdate.durationSeconds, 45);
  assert.match(retellUpdate.transcriptSnippet, /Klant wil graag/);

  const twilioUpdate = helpers.extractCallUpdateFromTwilioPayload(
    {
      CallSid: 'CA1234567890abcdef1234567890abcdef',
      CallStatus: 'completed',
      To: '+31612345678',
      Direction: 'outbound-api',
      RecordingUrl:
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE1234567890abcdef1234567890abcdef',
      StartTime: '2026-04-16T18:00:00Z',
      EndTime: '2026-04-16T18:00:45Z',
      CallDuration: '45',
    },
    { stack: 'openai' }
  );

  assert.equal(twilioUpdate.callId, 'CA1234567890abcdef1234567890abcdef');
  assert.equal(twilioUpdate.provider, 'twilio');
  assert.equal(twilioUpdate.stack, 'openai_realtime_1_5');
  assert.equal(twilioUpdate.stackLabel, 'OpenAI Realtime 1.5');
  assert.equal(twilioUpdate.recordingSid, 'RE1234567890abcdef1234567890abcdef');
  assert.equal(
    twilioUpdate.recordingUrlProxy,
    '/api/coldcalling/recording-proxy?callId=CA1234567890abcdef1234567890abcdef'
  );
});

test('call provider helpers wrap call-status responses and recording urls consistently', () => {
  const helpers = createHelpers();

  const retellStatus = helpers.extractCallUpdateFromRetellCallStatusResponse('call_x', {
    call_id: 'call_x',
    call_status: 'completed',
    start_timestamp: 1_700_000_000,
    end_timestamp: 1_700_000_060,
    metadata: { leadCompany: 'Softora' },
  });
  assert.equal(retellStatus.messageType, 'retell.call_status_fetch');
  assert.equal(retellStatus.callId, 'call_x');

  const twilioStatus = helpers.extractCallUpdateFromTwilioCallStatusResponse(
    'CA999',
    {
      sid: 'CA999',
      status: 'queued',
      direction: 'outbound-api',
      to: '+31612345678',
      from: '+31600000000',
    },
    { stack: 'gemini' }
  );
  assert.equal(twilioStatus.messageType, 'twilio.call_status_fetch');
  assert.equal(twilioStatus.stackLabel, 'Gemini 3.1 Live');
  assert.equal(helpers.isTerminalColdcallingStatus('completed', ''), true);
  assert.equal(helpers.toIsoFromUnixMilliseconds(1_700_000_000), '2023-11-14T22:13:20.000Z');
  assert.match(
    helpers.buildTwilioRecordingMediaUrl('RE1234567890abcdef1234567890abcdef')?.toString() || '',
    /Recordings\/RE1234567890abcdef1234567890abcdef\.mp3$/
  );
});
