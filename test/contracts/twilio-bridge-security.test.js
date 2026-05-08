const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridgeSourcePath = path.join(__dirname, '../../twilio-media-bridge/server.js');

function readBridgeSource() {
  return fs.readFileSync(bridgeSourcePath, 'utf8');
}

test('twilio media bridge public health stays minimal', () => {
  const source = readBridgeSource();
  const healthRoute = source.match(/app\.get\('\/healthz'[\s\S]+?\n\}\);/);
  assert.ok(healthRoute, 'healthz route should exist');
  assert.match(healthRoute[0], /service:\s*'twilio-media-bridge'/);
  assert.match(healthRoute[0], /geminiConfigured:/);
  assert.doesNotMatch(healthRoute[0], /requestedModel|modelAliasApplied|voice|latencyTuning|prompt|fingerprint|autoStart|ambient/);
});

test('twilio media bridge debug routes fail closed in production without token', () => {
  const source = readBridgeSource();
  assert.match(source, /const IS_PRODUCTION =/);
  assert.match(source, /if \(!BRIDGE_DEBUG_TOKEN\) return !IS_PRODUCTION;/);
});

test('twilio media bridge requires media token for websocket upgrades in production', () => {
  const source = readBridgeSource();
  assert.match(source, /const BRIDGE_MEDIA_TOKEN =/);
  assert.match(source, /function isMediaRequestAuthorized\(request, url\)/);
  assert.match(source, /if \(!BRIDGE_MEDIA_TOKEN\) return !IS_PRODUCTION;/);
  assert.match(source, /url\.searchParams\.get\('token'\)/);
  assert.match(source, /x-bridge-media-token/);
  assert.match(source, /if \(!isMediaRequestAuthorized\(request, url\)\)/);
  assert.match(source, /HTTP\/1\.1 401 Unauthorized/);
  assert.match(source, /crypto\.timingSafeEqual/);
});
