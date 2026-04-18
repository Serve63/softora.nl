const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildGeminiInitialClientContentPayload,
  buildGeminiSetupPayload,
  extractInlineAudioParts,
  parsePcmRateFromMime,
} = require('../../twilio-media-bridge/gemini-payload');

test('parsePcmRateFromMime reads rate= from mime string', () => {
  assert.equal(parsePcmRateFromMime('audio/pcm;rate=16000'), 16000);
  assert.equal(parsePcmRateFromMime('audio/L16; rate=8000'), 8000);
  assert.equal(parsePcmRateFromMime('audio/pcm'), 24000);
});

test('extractInlineAudioParts supports camelCase server JSON', () => {
  const parts = extractInlineAudioParts({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA' } }],
      },
    },
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].data, 'AAA');
  assert.equal(parts[0].mimeType, 'audio/pcm;rate=24000');
});

test('extractInlineAudioParts supports snake_case server JSON', () => {
  const parts = extractInlineAudioParts({
    server_content: {
      model_turn: {
        parts: [{ inline_data: { mime_type: 'audio/pcm;rate=24000', data: 'BBB' } }],
      },
    },
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].data, 'BBB');
  assert.equal(parts[0].mimeType, 'audio/pcm;rate=24000');
});

test('buildGeminiSetupPayload can seed initial client history for an auto-start turn', () => {
  const payload = buildGeminiSetupPayload({
    model: 'models/gemini-3.1-flash-live-preview',
    voiceName: 'Iapetus',
    systemPrompt: 'Bel prospects kort en natuurlijk.',
    seedInitialHistory: true,
  });

  assert.equal(payload.setup.model, 'models/gemini-3.1-flash-live-preview');
  assert.equal(payload.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Iapetus');
  assert.deepEqual(payload.setup.systemInstruction, {
    parts: [{ text: 'Bel prospects kort en natuurlijk.' }],
  });
  assert.deepEqual(payload.setup.historyConfig, {
    initialHistoryInClientContent: true,
  });
});

test('buildGeminiInitialClientContentPayload builds a first user turn for auto-start', () => {
  assert.deepEqual(buildGeminiInitialClientContentPayload('  Begin nu het gesprek.  '), {
    clientContent: {
      turns: [{ role: 'user', parts: [{ text: 'Begin nu het gesprek.' }] }],
      turnComplete: true,
    },
  });
  assert.equal(buildGeminiInitialClientContentPayload('   '), null);
});

test('twilio media bridge defaults target the current Gemini Live model without requiring a custom prompt', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../twilio-media-bridge/server.js'),
    'utf8'
  );

  assert.match(source, /DEFAULT_GEMINI_MODEL = 'gemini-3\.1-flash-live-preview'/);
  assert.match(source, /GEMINI_REQUIRE_CUSTOM_PROMPT \|\| 'false'/);
  assert.match(source, /GEMINI_AUTO_START \|\| 'true'/);
  assert.match(source, /DEFAULT_INITIAL_MESSAGE = 'De call is nu verbonden\. Begin direct met het gesprek\.'/);
  assert.match(source, /gemini-live-2\.5-flash-preview', DEFAULT_GEMINI_MODEL/);
});
