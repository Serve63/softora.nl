const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  computeInt16Rms,
  createSpeechTurnState,
} = require('../../twilio-media-bridge/audio-turn-state');
const {
  buildGeminiInitialClientContentPayload,
  buildGeminiInitialRealtimeInputPayload,
  buildGeminiSetupPayload,
  extractInlineAudioParts,
  parsePcmRateFromMime,
} = require('../../twilio-media-bridge/gemini-payload');

test('parsePcmRateFromMime reads rate= from mime string', () => {
  assert.equal(parsePcmRateFromMime('audio/pcm;rate=16000'), 16000);
  assert.equal(parsePcmRateFromMime('audio/L16; rate=8000'), 8000);
  assert.equal(parsePcmRateFromMime('audio/pcm'), 24000);
});

test('computeInt16Rms distinguishes silence from voiced audio', () => {
  assert.equal(computeInt16Rms(new Int16Array([0, 0, 0, 0])), 0);
  assert.ok(computeInt16Rms(new Int16Array([2500, -2500, 2500, -2500])) > 1000);
});

test('speech turn state detects speech start and end from PCM frames', () => {
  const turns = createSpeechTurnState({
    rmsThreshold: 800,
    startFrames: 2,
    endSilenceMs: 300,
  });
  const voiced = new Int16Array([2200, -2200, 2200, -2200]);
  const silent = new Int16Array([0, 0, 0, 0]);

  const frame1 = turns.processPcmFrame(voiced, 0);
  assert.equal(frame1.speechStarted, false);
  assert.equal(frame1.speechActive, false);

  const frame2 = turns.processPcmFrame(voiced, 20);
  assert.equal(frame2.speechStarted, true);
  assert.equal(frame2.speechActive, true);

  const frame3 = turns.processPcmFrame(silent, 200);
  assert.equal(frame3.speechEnded, false);
  assert.equal(frame3.speechActive, true);

  const frame4 = turns.processPcmFrame(silent, 360);
  assert.equal(frame4.speechEnded, true);
  assert.equal(frame4.speechActive, false);
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
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        silenceDurationMs: 250,
      },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
  });

  assert.equal(payload.setup.model, 'models/gemini-3.1-flash-live-preview');
  assert.equal(payload.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Iapetus');
  assert.deepEqual(payload.setup.systemInstruction, {
    parts: [{ text: 'Bel prospects kort en natuurlijk.' }],
  });
  assert.deepEqual(payload.setup.historyConfig, {
    initialHistoryInClientContent: true,
  });
  assert.deepEqual(payload.setup.realtimeInputConfig, {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
      silenceDurationMs: 250,
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
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

test('buildGeminiInitialRealtimeInputPayload builds a direct text kick-off for auto-start', () => {
  assert.deepEqual(buildGeminiInitialRealtimeInputPayload('  Begin nu het gesprek.  '), {
    realtimeInput: {
      text: 'Begin nu het gesprek.',
    },
  });
  assert.equal(buildGeminiInitialRealtimeInputPayload('   '), null);
});

test('twilio media bridge defaults target the current Gemini Live model without requiring a custom prompt', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../twilio-media-bridge/server.js'),
    'utf8'
  );

  assert.match(source, /DEFAULT_GEMINI_MODEL = 'gemini-3\.1-flash-live-preview'/);
  assert.match(source, /GEMINI_REQUIRE_CUSTOM_PROMPT \|\| 'false'/);
  assert.match(source, /GEMINI_AUTO_START \|\| 'true'/);
  assert.match(source, /GEMINI_VAD_START_SENSITIVITY \|\| 'START_SENSITIVITY_LOW'/);
  assert.match(source, /activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'/);
  assert.match(source, /CALLER_SPEECH_RMS_THRESHOLD \|\| 1200/);
  assert.match(source, /CALLER_SPEECH_START_FRAMES \|\| 4/);
  assert.match(source, /CALLER_BARGE_IN_SUPPRESSION_MS \|\| 220/);
  assert.match(source, /GEMINI_PLAYBACK_ACTIVE_WINDOW_MS \|\| 900/);
  assert.match(source, /event: 'clear'/);
  assert.match(source, /serverInterruptedCount/);
  assert.match(source, /DEFAULT_INITIAL_MESSAGE = 'De call is nu verbonden\. Begin direct met het gesprek\.'/);
  assert.match(source, /gemini-live-2\.5-flash-preview', DEFAULT_GEMINI_MODEL/);
});
