const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createMathijsVoiceTestGate, runMathijsVoiceTest, buildPcmWav, TEST_TURNS } = require('../../twilio-media-bridge/mathijs-voice-test');

function mockSocket() {
  const socket = new EventEmitter();
  socket.sent = [];
  socket.closed = false;
  socket.send = (value) => socket.sent.push(JSON.parse(value));
  socket.close = () => { socket.closed = true; };
  return socket;
}

test('a voice-test permit is disabled by default and can be consumed only once before expiry', () => {
  const now = () => 1000000;
  assert.equal(createMathijsVoiceTestGate({ now }).claim(), false);
  for (const expiresAt of ['invalid', new Date(999999).toISOString(), new Date(1600001).toISOString()]) {
    assert.equal(createMathijsVoiceTestGate({ enabled: 'true', expiresAt, now }).claim(), false);
  }
  const gate = createMathijsVoiceTestGate({ enabled: 'true', expiresAt: new Date(1100000).toISOString(), now });
  assert.equal(gate.claim(), true);
  assert.equal(gate.claim(), false);
});

test('one voice conversation returns three transcripts and valid mono PCM WAV audio', async () => {
  const socket = mockSocket();
  const result = runMathijsVoiceTest({ createSocket: () => socket });
  socket.emit('open');
  assert.equal(socket.sent[0].setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(socket.sent[0].setup.outputAudioTranscription, {});
  socket.emit('message', Buffer.from(JSON.stringify({ setupComplete: {} })));
  for (let index = 0; index < TEST_TURNS.length; index += 1) {
    assert.equal(socket.sent[index + 1].realtimeInput.text, TEST_TURNS[index]);
    socket.emit('message', Buffer.from(JSON.stringify({ serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(48).toString('base64') } }] },
      outputTranscription: { text: `Speech ${index}` }, turnComplete: true,
    } })));
  }
  const response = await result;
  assert.equal(response.turns.length, 3);
  assert.equal(response.turns[0].transcript, 'Speech 0');
  assert.equal(socket.closed, true);
  const wav = Buffer.from(response.wavBase64, 'base64');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 144);
});

test('provider errors close the one test without leaking provider error details or retrying', async () => {
  const socket = mockSocket();
  const result = runMathijsVoiceTest({ createSocket: () => socket });
  socket.emit('message', Buffer.from(JSON.stringify({ error: { message: 'sensitive provider detail' } })));
  await assert.rejects(result, /^Error: Gemini Live rejected the voice test\.$/);
  assert.equal(socket.closed, true);
  assert.equal(socket.sent.length, 0);
});

test('a test timeout closes the session and cannot leave a paid connection open', async () => {
  const socket = mockSocket();
  await assert.rejects(runMathijsVoiceTest({ createSocket: () => socket, timeoutMs: 5 }), /timed out/);
  assert.equal(socket.closed, true);
});

test('WAV headers describe the exact payload length', () => {
  const wav = buildPcmWav(Buffer.alloc(96));
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
});

test('the voice-test endpoint preserves debug authentication and a single-use gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../twilio-media-bridge/server.js'), 'utf8');
  assert.match(source, /app\.post\('\/debug\/mathijs-voice-test'[\s\S]*?!BRIDGE_DEBUG_TOKEN \|\| !isDebugRequestAuthorized\(req\)[\s\S]*?mathijsVoiceTestGate\.claim\(\)/);
});
