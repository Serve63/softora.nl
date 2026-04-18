const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCallProviderRecordingHelpers,
} = require('../../server/services/call-provider-recordings');
const {
  normalizeColdcallingStack,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
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
  return createCallProviderRecordingHelpers({
    env: {
      TWILIO_API_BASE_URL: 'https://twilio.example',
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
    parseIntSafe,
    parseNumberSafe,
  });
}

test('call provider recording helpers expose twilio auth, urls and preferred recording selection', async () => {
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

  assert.match(helpers.getTwilioBasicAuthorizationHeader(), /^Basic /);
  assert.equal(
    helpers.buildTwilioApiUrl('/2010-04-01/Calls.json').toString(),
    'https://twilio.example/2010-04-01/Calls.json'
  );

  const result = await helpers.fetchTwilioRecordingsByCallId('CA1234567890abcdef1234567890abcdef');
  assert.equal(result.recordings.length, 1);
  assert.match(capturedAuthHeader, /^Basic /);

  assert.deepEqual(helpers.getTwilioStackEnvSuffixes('openai'), [
    'OPENAI_REALTIME_1_5',
    'OPENAI_REALTIME',
    'OPENAI',
  ]);
  assert.equal(helpers.getTwilioMediaWsUrlForStack('openai'), 'wss://openai.example/media');
  assert.equal(helpers.getTwilioFromNumberForStack('openai'), '+31611111111');
});

test('call provider recording helpers prefer regional Twilio API keys when configured', () => {
  const helpers = createHelpers({
    env: {
      TWILIO_API_KEY_SID: 'SKregional123',
      TWILIO_API_KEY_SECRET: 'regional-secret',
      TWILIO_AUTH_TOKEN: '',
    },
  });

  const decoded = Buffer.from(
    helpers.getTwilioBasicAuthorizationHeader().replace(/^Basic\s+/i, ''),
    'base64'
  ).toString('utf8');

  assert.equal(decoded, 'SKregional123:regional-secret');
});

test('call provider recording helpers normalize references and resolve preferred proxy urls', () => {
  const helpers = createHelpers();

  assert.equal(
    helpers.extractTwilioRecordingSidFromUrl(
      'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1234567890abcdef1234567890abcdef'
    ),
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
  assert.equal(
    helpers.resolvePreferredRecordingUrl({
      provider: 'twilio',
      callId: 'CA123',
      recordingUrl: 'https://api.twilio.com/Recordings/RE1',
    }),
    '/api/coldcalling/recording-proxy?callId=CA123'
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
  assert.equal(helpers.isTerminalColdcallingStatus('completed', ''), true);
  assert.equal(helpers.toIsoFromUnixMilliseconds(1_700_000_000), '2023-11-14T22:13:20.000Z');
});
