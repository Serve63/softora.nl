const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter, once } = require('node:events');
const Module = require('node:module');
const http = require('node:http');
const WebSocket = require('ws');
const { createMathijsCallTestGate, MAX_CALL_MS } = require('../../twilio-media-bridge/mathijs-call-test');
const token = 'a'.repeat(64);
const digest = crypto.createHash('sha256').update(token).digest('hex');
const time = 1000000;
const permit = { enabled: 'true', tokenSha256: digest, expiresAt: new Date(time + 60000).toISOString(), to: '+31612345678', now: () => time };

test('call-test capability fails closed for missing, expired, oversized or incorrect permits', () => {
  assert.equal(createMathijsCallTestGate().claim(token), null);
  for (const change of [
    { enabled: 'false' }, { tokenSha256: '' }, { tokenSha256: 'invalid' }, { to: '+31201234567' },
    { expiresAt: 'invalid' }, { expiresAt: new Date(time).toISOString() },
    { expiresAt: new Date(time + 600001).toISOString() },
  ]) assert.equal(createMathijsCallTestGate({ ...permit, ...change }).claim(token), null);
  const gate = createMathijsCallTestGate(permit);
  assert.equal(gate.claim('b'.repeat(64)), null);
  assert.equal(gate.claim('short'), null);
  assert.ok(gate.claim(token), 'invalid attempts must not consume the genuine permit');
  assert.equal(gate.claim(token), null, 'one process may admit only one test');
});

test('call scope binds the actual Twilio call and exact permitted mobile number', () => {
  const session = createMathijsCallTestGate(permit).claim(token);
  assert.equal(session.matchesStart({ callSid: 'CA' + '0'.repeat(32) }, { to: '+31612345678' }), true);
  assert.equal(session.matchesStart({ callSid: 'CA' + '0'.repeat(32) }, { to: '+31687654321' }), false);
  assert.equal(session.matchesStart({}, { to: '+31612345678' }), false);
});

test('test timer is hard-capped at 90 seconds and cleanup disarms it', () => {
  const session = createMathijsCallTestGate(permit).claim(token);
  let callback; let duration; let cleared;
  const reasons = [];
  const disarm = session.armStop(reason => reasons.push(reason), {
    setTimer: (fn, ms) => { callback = fn; duration = ms; return 123; },
    clearTimer: id => { cleared = id; },
  });
  assert.equal(duration, MAX_CALL_MS);
  assert.equal(duration, 90000);
  callback();
  assert.deepEqual(reasons, ['test-time-limit']);
  disarm();
  assert.equal(cleared, 123);
});

test('reported usage and response count stop the test before unbounded conversations', () => {
  const session = createMathijsCallTestGate(permit).claim(token);
  assert.equal(session.maxOutputTokens, 256);
  assert.equal(session.observeUsage({ usageMetadata: { totalTokenCount: 4500 } }), '');
  assert.equal(session.observeUsage({ usageMetadata: { totalTokenCount: 3500 } }), 'test-token-limit');
  const turns = createMathijsCallTestGate(permit).claim(token);
  for (let i = 0; i < 5; i++) assert.equal(turns.observeUsage({ serverContent: { turnComplete: true } }), '');
  assert.equal(turns.observeUsage({ serverContent: { turnComplete: true } }), 'test-turn-limit');
  const invalid = createMathijsCallTestGate(permit).claim(token);
  assert.equal(invalid.observeUsage({ usageMetadata: { totalTokenCount: -1 } }), 'test-invalid-usage');
});

async function unusedPort() {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

// Real local media sockets, with the Google WebSocket dependency replaced before evaluation.
// No provider endpoint is contacted, even though the test exercises the live-session branch.
test('isolated media test uses Iapetus and Mathijs 3.8, stops on usage and leaves ordinary calls ambient-only', { timeout: 10000 }, async t => {
  const port = await unusedPort();
  const providers = [];
  let server; let wss;
  class OfflineGemini extends EventEmitter {
    static OPEN = WebSocket.OPEN;
    static CONNECTING = WebSocket.CONNECTING;
    static Server = class extends WebSocket.Server {
      constructor(options) { super(options); wss = this; }
    };
    constructor() {
      super(); this.readyState = WebSocket.CONNECTING; this.sent = []; providers.push(this);
      setImmediate(() => { if (this.readyState === WebSocket.CONNECTING) { this.readyState = WebSocket.OPEN; this.emit('open'); } });
    }
    send(data) {
      const msg = JSON.parse(data); this.sent.push(msg);
      if (msg.setup) setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ setupComplete: {} }))));
    }
    close() { this.readyState = WebSocket.CLOSED; this.emit('close', 1000, Buffer.from('offline')); }
  }
  const filename = path.resolve(__dirname, '../../twilio-media-bridge/server.js');
  const originalLoad = Module._load;
  const originalEnv = process.env;
  const originalCache = require.cache[filename];
  process.env = {
    PORT: String(port), NODE_ENV: 'production', GEMINI_API_KEY: 'offline-provider-stub', GEMINI_VOICE: 'Iapetus',
    AMBIENT_ONLY_MODE: 'true', BRIDGE_MEDIA_TOKEN: 'local-media-token',
    AMBIENT_ASSET_PATH: path.resolve(__dirname, '../../twilio-media-bridge/assets/callcenter-dnlburnett-335711-8k.raw'),
    MATHIJS_CALL_TEST_ENABLED: 'true', MATHIJS_CALL_TEST_TOKEN_SHA256: digest,
    MATHIJS_CALL_TEST_EXPIRES_AT: new Date(Date.now() + 60000).toISOString(), MATHIJS_CALL_TEST_TO: '+31612345678',
  };
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === 'dotenv') return { config() {} };
      if (request === 'ws') return OfflineGemini;
      if (request === 'http') return { ...http, createServer(...args) { server = http.createServer(...args); return server; } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[filename];
    require(filename);
  } finally {
    Module._load = originalLoad;
    process.env = originalEnv;
    delete require.cache[filename];
    if (originalCache) require.cache[filename] = originalCache;
  }
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  if (!server.listening) await once(server, 'listening');
  const normal = new WebSocket(`ws://127.0.0.1:${port}/twilio-media`, { headers: { 'x-bridge-media-token': 'local-media-token' } });
  clients.push(normal); await once(normal, 'open');
  const normalFrame = once(normal, 'message');
  normal.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ-ambient', customParameters: { assistant: 'softora_mathijs', stack: 'gemini_flash_3_8_live' } } }));
  assert.equal(JSON.parse((await normalFrame)[0]).event, 'media');
  assert.equal(providers.length, 0, 'ordinary sessions must not reach even the offline Google stub');
  normal.close(); await once(normal, 'close');
  const client = new WebSocket(`ws://127.0.0.1:${port}/twilio-mathijs-test/${token}`);
  clients.push(client); await once(client, 'open');
  client.send(JSON.stringify({ event: 'start', start: {
    callSid: 'CA' + '0'.repeat(32), streamSid: 'MZ-private-test',
    customParameters: { to: '+31612345678', assistant: 'other', stack: 'retell_ai' },
  } }));
  for (let i = 0; i < 100 && !providers[0]?.sent.some(msg => msg.setup); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(providers.length, 1);
  const setup = providers[0].sent.find(msg => msg.setup).setup;
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Iapetus');
  assert.equal(setup.generationConfig.maxOutputTokens, 256);
  assert.match(setup.systemInstruction.parts[0].text, /Mathijs/);
  const closed = once(client, 'close');
  providers[0].emit('message', Buffer.from(JSON.stringify({ usageMetadata: { totalTokenCount: 8000 } })));
  const [code, reason] = await closed;
  assert.equal(code, 1000); assert.equal(reason.toString(), 'test-token-limit');
  assert.equal(providers[0].readyState, WebSocket.CLOSED);
  const repeat = new WebSocket(`ws://127.0.0.1:${port}/twilio-mathijs-test/${token}`); clients.push(repeat);
  const response = await new Promise((resolve, reject) => {
    repeat.once('unexpected-response', (_req, res) => { res.resume(); repeat.terminate(); resolve(res.statusCode); });
    repeat.once('error', () => {}); repeat.once('open', () => reject(new Error('spent test permit admitted again')));
  });
  assert.equal(response, 401); assert.equal(providers.length, 1);
});
