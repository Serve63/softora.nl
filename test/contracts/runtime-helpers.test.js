const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeHelpers } = require('../../server/services/runtime-helpers');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function parseNumberSafe(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

test('runtime helpers resolve coldcalling providers and missing env vars', () => {
  const helpers = createRuntimeHelpers({
    env: {
      COLDCALLING_PROVIDER: 'twilio_media',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret',
      TWILIO_FROM_NUMBER: '+31600000000',
    },
    normalizeString,
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe,
  });

  assert.equal(helpers.isTwilioColdcallingConfigured(), true);
  assert.equal(helpers.isTwilioStatusApiConfigured(), true);
  assert.equal(helpers.getColdcallingProvider(), 'twilio');
  assert.deepEqual(helpers.getMissingEnvVars('twilio'), []);
  assert.equal(helpers.getColdcallingStackLabel('openai_realtime_1_5'), 'OpenAI Realtime 1.5');
  assert.equal(
    helpers.resolveColdcallingProviderForCampaign({ coldcallingStack: 'gemini_flash_3_1_live' }),
    'twilio'
  );
  assert.equal(helpers.inferCallProvider('call_123', 'twilio'), 'retell');
  assert.equal(helpers.inferCallProvider('CA1234567890abcdef1234567890abcdef', 'retell'), 'twilio');
});

test('runtime helpers accept regional Twilio API keys as a valid realtime calling setup', () => {
  const helpers = createRuntimeHelpers({
    env: {
      COLDCALLING_PROVIDER: 'twilio_media',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_API_KEY_SID: 'SK123',
      TWILIO_API_KEY_SECRET: 'secret',
      TWILIO_FROM_NUMBER: '+31600000000',
    },
    normalizeString,
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe,
  });

  assert.equal(helpers.isTwilioColdcallingConfigured(), true);
  assert.equal(helpers.isTwilioStatusApiConfigured(), true);
  assert.deepEqual(helpers.getMissingEnvVars('twilio'), []);
});

test('runtime helpers normalize booleans, dates, times and currency labels', () => {
  const helpers = createRuntimeHelpers({
    normalizeString,
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe,
  });

  assert.equal(helpers.toBooleanSafe('ja', false), true);
  assert.equal(helpers.toBooleanSafe('nee', true), false);
  assert.equal(helpers.normalizeDateYyyyMmDd('16/04/2026'), '2026-04-16');
  assert.equal(helpers.normalizeTimeHhMm('930'), '09:30');
  assert.equal(helpers.normalizeTimeHhMm('9:75'), '09:59');
  assert.match(helpers.formatEuroLabel('2500'), /2\.500/);
});

test('runtime helpers choose anthropic models and provider fallbacks from env', () => {
  const helpers = createRuntimeHelpers({
    env: {
      ANTHROPIC_API_KEY: 'anthropic-key',
      ANTHROPIC_MODEL: 'claude-sonnet',
      WEBSITE_ANTHROPIC_MODEL: 'claude-opus-site',
      ANTHROPIC_DOSSIER_MODEL: 'claude-dossier',
      ANTHROPIC_DOSSIER_MAX_TOKENS: '50000',
    },
    normalizeString,
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe,
    websiteAnthropicModel: '',
    anthropicModel: '',
    websiteGenerationProvider: '',
    dossierAnthropicModel: '',
  });

  assert.equal(helpers.getAnthropicApiKey(), 'anthropic-key');
  assert.equal(helpers.getWebsiteGenerationProvider(), 'anthropic');
  assert.equal(helpers.getWebsiteAnthropicModel(), 'claude-opus-site');
  assert.equal(helpers.getDossierAnthropicModel(), 'claude-dossier');
  assert.equal(helpers.getAnthropicDossierMaxTokens(), 24000);
});
