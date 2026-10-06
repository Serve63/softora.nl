const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { mulaw } = require('alawmulaw');
const { loadAmbientLoopBuffer, mixPcmFrame, OUTPUT_FRAME_BYTES } = require('../../twilio-media-bridge/ambient-audio');
const { computeInt16Rms } = require('../../twilio-media-bridge/audio-turn-state');

const bridgeDir = path.join(__dirname, '../../twilio-media-bridge');
const assetPath = path.join(bridgeDir, 'assets/callcenter-dnlburnett-335711-8k.raw');
function samples(buffer) {
  return Int16Array.from({ length: buffer.length / 2 }, (_, i) => buffer.readInt16LE(i * 2));
}

test('licensed callcenter loop is audible, frame-aligned and has bounded peaks and a smooth join', () => {
  const loop = loadAmbientLoopBuffer({ filePath: assetPath });
  assert.equal(loop.enabled, true);
  assert.ok(loop.durationMs >= 60000 && loop.durationMs <= 120000);
  assert.equal(loop.bytes % OUTPUT_FRAME_BYTES, 0);
  const pcm = samples(loop.buffer);
  const rms = computeInt16Rms(pcm);
  assert.ok(rms > 1500 && rms < 3000, `unexpected background RMS ${rms}`);
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  assert.ok(peak <= 12000, 'background transients must retain voice headroom');
  assert.ok(Math.abs(pcm[0] - pcm[pcm.length - 1]) < 400, 'loop boundary must not click');
});

test('callcenter level drops during speech and the voice remains dominant without changing frame timing', () => {
  const background = fs.readFileSync(assetPath);
  const quietState = { ambientPosition: 0, geminiIsSpeaking: false };
  const speechState = { ambientPosition: 0, geminiIsSpeaking: true };
  const options = { ambientBuffer: background, ambientNoiseLevel: 0.18, ambientDuckLevel: 0.08 };
  const quiet = mixPcmFrame(null, quietState, options);
  const ducked = mixPcmFrame(null, speechState, options);
  assert.equal(quiet.length, OUTPUT_FRAME_BYTES);
  assert.equal(ducked.length, OUTPUT_FRAME_BYTES);
  assert.equal(quietState.ambientPosition, speechState.ambientPosition);
  assert.ok(computeInt16Rms(samples(ducked)) < computeInt16Rms(samples(quiet)) * 0.5);
  const voice = Buffer.alloc(OUTPUT_FRAME_BYTES);
  for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(3000, i);
  const mixed = mixPcmFrame(voice, { ambientPosition: 0, geminiIsSpeaking: true }, options);
  assert.ok(computeInt16Rms(samples(mixed)) > computeInt16Rms(samples(ducked)) * 8);
});

test('callcenter distribution keeps the author, source and commercial-compatible licence attribution', () => {
  const credit = fs.readFileSync(path.join(bridgeDir, 'assets/CALLCENTER-LICENSE.txt'), 'utf8');
  assert.match(credit, /dnlburnett/);
  assert.match(credit, /https:\/\/freesound\.org\/people\/dnlburnett\/sounds\/335711\//);
  assert.match(credit, /CC BY 4\.0/);
  assert.match(credit, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(credit, /Softora adaptation/);
});

async function unusedPort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}

test('real local bridge streams the bundled callcenter as Twilio audio without calling Gemini or Twilio', { timeout: 10000 }, async (t) => {
  const port = await unusedPort();
  const mediaToken = crypto.randomBytes(16).toString('hex');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: bridgeDir,
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'production',
      GEMINI_API_KEY: '', GOOGLE_API_KEY: '', AMBIENT_ONLY_MODE: 'true',
      AMBIENT_ENABLED: 'true', AMBIENT_ASSET_PATH: assetPath,
      AMBIENT_NOISE_LEVEL: '0.18', AMBIENT_DUCK_LEVEL: '0.08',
      BRIDGE_MEDIA_TOKEN: mediaToken, BRIDGE_DEBUG_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let client;
  t.after(() => { client?.terminate(); child.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`local bridge did not start: ${stderr}`)), 5000);
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`local bridge exited with ${code}: ${stderr}`)); });
    child.stdout.on('data', (data) => {
      stdout += data;
      if (stdout.includes(`[Bridge] listening on :${port}`)) { clearTimeout(timer); resolve(); }
    });
  });
  const frames = await new Promise((resolve, reject) => {
    const received = [];
    const timer = setTimeout(() => reject(new Error('local bridge produced no callcenter frames')), 3000);
    client = new WebSocket(`ws://127.0.0.1:${port}/twilio-media`, { headers: { 'x-bridge-media-token': mediaToken } });
    client.once('error', (error) => { clearTimeout(timer); reject(error); });
    client.once('open', () => client.send(JSON.stringify({
      event: 'start', start: { streamSid: 'MZ-local-ambience', customParameters: { stack: 'gemini_flash_3_8_live', assistant: 'softora_mathijs' } },
    })));
    client.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event !== 'media') return;
      assert.equal(message.streamSid, 'MZ-local-ambience');
      received.push(Buffer.from(message.media.payload, 'base64'));
      if (received.length === 10) {
        clearTimeout(timer);
        client.send(JSON.stringify({ event: 'stop' }));
        resolve(received);
      }
    });
  });
  assert.ok(frames.every((frame) => frame.length === 160), 'output must stay in 20 ms, 8 kHz mulaw frames');
  const decoded = mulaw.decode(Uint8Array.from(Buffer.concat(frames)));
  assert.ok(computeInt16Rms(decoded) > 10, 'the selected real-world ambience must reach the phone output');
});
