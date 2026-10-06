const { MATHIJS_SYSTEM_PROMPT, MATHIJS_INITIAL_MESSAGE } = require('./assistant-profile');
const { GEMINI_38_MODEL } = require('./gemini-session');
const {
  buildGeminiSetupPayload, buildGeminiInitialRealtimeInputPayload, extractInlineAudioParts,
} = require('./gemini-payload');

const TEST_TURNS = Object.freeze([
  MATHIJS_INITIAL_MESSAGE,
  'Wat doet Softora en wat kost een nieuwe website bij jullie?',
  'Kun jij mijn factuur nakijken en meteen een afspraak voor morgen boeken?',
]);
const SAMPLE_RATE = 24000;
const MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * 90;

function createMathijsVoiceTestGate({ enabled = '', expiresAt = '', now = Date.now } = {}) {
  let used = false;
  const expires = Date.parse(expiresAt);
  return {
    claim() {
      const time = now();
      if (used || enabled !== 'true' || !Number.isFinite(expires) || expires <= time || expires > time + 10 * 60 * 1000) {
        return false;
      }
      used = true;
      return true;
    },
  };
}

function buildPcmWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function runMathijsVoiceTest({ createSocket, voiceName = 'Puck', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let index = 0;
    let transcript = '';
    let audioBytes = 0;
    let setupReceived = false;
    const turns = [];
    const audio = [];
    const socket = createSocket();
    const timer = setTimeout(() => finish(new Error('Mathijs voice test timed out.')),
      Math.max(1, Math.min(90000, Number(timeoutMs) || 90000)));

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) return reject(error);
      resolve({
        ok: true, model: GEMINI_38_MODEL, turns,
        audioSeconds: audioBytes / (SAMPLE_RATE * 2),
        wavBase64: buildPcmWav(Buffer.concat(audio)).toString('base64'),
      });
    }
    function sendTurn() {
      socket.send(JSON.stringify(buildGeminiInitialRealtimeInputPayload(TEST_TURNS[index])));
    }
    socket.on('open', () => {
      if (finished) return;
      socket.send(JSON.stringify(buildGeminiSetupPayload({
        model: GEMINI_38_MODEL, voiceName, systemPrompt: MATHIJS_SYSTEM_PROMPT,
        outputAudioTranscription: true,
      })));
    });
    socket.on('message', (chunk) => {
      if (finished) return;
      let msg;
      try { msg = JSON.parse(chunk.toString()); } catch { return; }
      if (msg.error) return finish(new Error('Gemini Live rejected the voice test.'));
      if (msg.setupComplete && !setupReceived) { setupReceived = true; sendTurn(); return; }
      if (!setupReceived) return;
      const content = msg.serverContent || msg.server_content || {};
      for (const part of extractInlineAudioParts(msg)) {
        if (!/^audio\/pcm(?:;rate=24000)?$/i.test(part.mimeType)) {
          return finish(new Error('Unexpected Gemini audio format.'));
        }
        const pcm = Buffer.from(part.data, 'base64');
        audioBytes += pcm.length;
        if (audioBytes > MAX_AUDIO_BYTES || pcm.length % 2) {
          return finish(new Error('Mathijs voice test audio limit reached.'));
        }
        audio.push(pcm);
      }
      transcript += String((content.outputTranscription || content.output_transcription)?.text || '');
      if (content.turnComplete || content.turn_complete) {
        if (!transcript.trim() || !audioBytes) return finish(new Error('Mathijs voice test returned no speech or transcript.'));
        turns.push({ prompt: TEST_TURNS[index], transcript: transcript.trim() });
        transcript = '';
        index += 1;
        if (index === TEST_TURNS.length) return finish();
        sendTurn();
      }
    });
    socket.on('error', () => finish(new Error('Gemini Live connection failed.')));
    socket.on('close', () => finish(new Error('Gemini Live closed before the voice test finished.')));
  });
}

module.exports = { TEST_TURNS, createMathijsVoiceTestGate, buildPcmWav, runMathijsVoiceTest };
