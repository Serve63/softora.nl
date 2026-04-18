const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  OUTPUT_FRAME_BYTES,
  loadAmbientLoopBuffer,
  mixPcmFrame,
  shouldForwardToGeminiPcmFrame,
  splitPcmBufferIntoFrames,
} = require('../../twilio-media-bridge/ambient-audio');
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

test('ambient helpers split PCM into fixed 20ms frames and zero-pad the tail', () => {
  const frameAndHalf = Buffer.alloc(OUTPUT_FRAME_BYTES + OUTPUT_FRAME_BYTES / 2, 1);
  const frames = splitPcmBufferIntoFrames(frameAndHalf);

  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, OUTPUT_FRAME_BYTES);
  assert.equal(frames[1].length, OUTPUT_FRAME_BYTES);
  assert.equal(frames[1].subarray(OUTPUT_FRAME_BYTES / 2).equals(Buffer.alloc(OUTPUT_FRAME_BYTES / 2)), true);
});

test('ambient helpers keep even byte offsets when looping raw PCM ambience', () => {
  const ambient = Buffer.alloc(OUTPUT_FRAME_BYTES * 2);
  for (let i = 0; i < ambient.length; i += 2) ambient.writeInt16LE(i, i);
  const voice = Buffer.alloc(OUTPUT_FRAME_BYTES);
  const state = { ambientPosition: 1, geminiIsSpeaking: false };

  const mixed = mixPcmFrame(voice, state, {
    ambientBuffer: ambient,
    ambientNoiseLevel: 0.1,
    ambientDuckLevel: 0.05,
  });

  assert.equal(mixed.length, OUTPUT_FRAME_BYTES);
  assert.equal(state.ambientPosition % 2, 0);
});

test('ambient helpers only forward frames above the configured noise gate threshold', () => {
  assert.equal(shouldForwardToGeminiPcmFrame(new Int16Array([0, 0, 0, 0]), 400), false);
  assert.equal(shouldForwardToGeminiPcmFrame(new Int16Array([1200, -1200, 1200, -1200]), 400), true);
});

test('ambient loader trims odd byte tails and reports metadata', async (t) => {
  const tempDir = await fs.promises.mkdtemp(path.join(__dirname, 'ambient-'));
  const rawPath = path.join(tempDir, 'office-8k.raw');
  await fs.promises.writeFile(rawPath, Buffer.alloc(OUTPUT_FRAME_BYTES + 1, 7));
  t.after(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const result = loadAmbientLoopBuffer({ enabled: true, filePath: rawPath });
  assert.equal(result.enabled, true);
  assert.equal(result.bytes % 2, 0);
  assert.equal(result.reason, 'loaded');
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
  assert.match(source, /function resampleInt16/);
  assert.match(source, /event: 'mark'/);
  assert.match(source, /twilioMarkSentCount/);
  assert.match(source, /twilioMarkAckCount/);
  assert.match(source, /event: 'clear'/);
  assert.match(source, /serverInterruptedCount/);
  assert.match(source, /AMBIENT_ENABLED \|\| 'true'/);
  assert.match(source, /AMBIENT_NOISE_LEVEL \|\| 0\.22/);
  assert.match(source, /AMBIENT_DUCK_LEVEL \|\| 0\.1/);
  assert.match(source, /INPUT_AUDIO_FLUSH_DELAY_MS \|\| 900/);
  assert.match(source, /NOISE_GATE_RMS \|\| 120/);
  assert.match(source, /audioStreamEnd: true/);
  assert.match(source, /scheduleInputAudioFlush\(\)/);
  assert.match(source, /DEFAULT_INITIAL_MESSAGE =/);
  assert.match(source, /gemini-live-2\.5-flash-preview', DEFAULT_GEMINI_MODEL/);
});
