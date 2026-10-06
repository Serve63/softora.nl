const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGeminiSetupPayload } = require('../../twilio-media-bridge/gemini-payload');
const {
  GEMINI_38_MODEL,
  createGeminiSessionSetupSender,
  resolveGeminiSessionModel,
} = require('../../twilio-media-bridge/gemini-session');
const { normalizeColdcallingStack } = require('../../server/services/runtime-primitives');
const { createRuntimeHelpers } = require('../../server/services/runtime-helpers');

const oldModel = 'models/gemini-3.1-flash-live-preview';
const aliases = ['gemini_flash_3_8_live', 'gemini_3_8_live', 'gemini-3.8-live', 'gemini 3.8 live', 'gemini flash 3.8 live'];

test('Gemini 3.8 uses an explicit stack while legacy campaigns keep their provider', () => {
  const helpers = createRuntimeHelpers({ normalizeColdcallingStack });
  for (const alias of aliases) {
    const stack = normalizeColdcallingStack(alias);
    assert.equal(stack, 'gemini_flash_3_8_live');
    assert.equal(helpers.resolveColdcallingProviderForCampaign({ coldcallingStack: stack }), 'twilio');
    assert.equal(helpers.getColdcallingStackLabel(stack), 'Gemini 3.8 Live');
    assert.equal(resolveGeminiSessionModel(stack, oldModel), GEMINI_38_MODEL);
  }
  assert.equal(normalizeColdcallingStack('gemini'), 'gemini_flash_3_1_live');
  assert.equal(resolveGeminiSessionModel('gemini_flash_3_1_live', oldModel), oldModel);
  assert.equal(resolveGeminiSessionModel('arbitrary-model', oldModel), oldModel);
});

for (const socketOpensFirst of [true, false]) {
  test(`Gemini setup selects the Twilio start model when socket opens ${socketOpensFirst ? 'first' : 'last'}`, () => {
    const sent = [];
    const models = [];
    const socket = { readyState: socketOpensFirst ? 1 : 0, send: (value) => sent.push(JSON.parse(value)) };
    const sendSetup = createGeminiSessionSetupSender({
      configuredModel: oldModel,
      buildPayload: (model) => buildGeminiSetupPayload({ model, voiceName: 'Puck' }),
      onSetup: (model) => models.push(model),
    });
    assert.equal(sendSetup({ socket, streamSid: socketOpensFirst ? '' : 'MZtest', stack: 'gemini_flash_3_8_live' }), false);
    assert.equal(sent.length, 0);
    socket.readyState = 1;
    assert.equal(sendSetup({ socket, streamSid: 'MZtest', stack: 'gemini_flash_3_8_live' }), true);
    assert.equal(sent[0].setup.model, GEMINI_38_MODEL);
    assert.deepEqual(sent[0].setup.generationConfig.responseModalities, ['AUDIO']);
    assert.deepEqual(models, [GEMINI_38_MODEL]);
    assert.equal(sendSetup({ socket, streamSid: 'MZtest', stack: 'gemini_flash_3_1_live' }), false);
    assert.equal(sent.length, 1);
  });
}

test('separate Gemini sessions preserve legacy models and do not configure closed sockets', () => {
  const sent = [];
  const sendSetup = createGeminiSessionSetupSender({
    configuredModel: oldModel,
    buildPayload: (model) => buildGeminiSetupPayload({ model }),
  });
  for (const readyState of [0, 2, 3]) {
    assert.equal(sendSetup({ socket: { readyState }, streamSid: 'MZtest', stack: 'gemini_flash_3_1_live' }), false);
  }
  assert.equal(sendSetup({ socket: null, streamSid: 'MZtest', stack: 'gemini_flash_3_1_live' }), false);
  sendSetup({ socket: { readyState: 1, send: (value) => sent.push(JSON.parse(value)) }, streamSid: 'MZtest', stack: 'gemini_flash_3_1_live' });
  assert.equal(sent[0].setup.model, oldModel);
});

test('coldcall dashboard keeps Gemini 3.8 selected when collecting campaign data', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../assets/coldcalling-dashboard.js'), 'utf8');
  // Check the UI contract without executing source read from the filesystem.
  assert.match(source, /if \(\['gemini_flash_3_8_live'[^\n]+\.includes\(raw\)\) return 'gemini_flash_3_8_live';/);
  assert.match(source, /if \(normalized === 'gemini_flash_3_8_live'\) return 'Gemini 3\.8 Live';/);
  assert.match(source, /const coldcallingStack = normalizeColdcallingStack\(byId\('coldcallingStack'\)\?\.value/);
  const page = fs.readFileSync(path.join(__dirname, '../../premium-ai-lead-generator.html'), 'utf8');
  assert.match(page, /<option value="gemini_flash_3_8_live">Gemini 3\.8 Live<\/option>/);
  assert.match(page, /<option value="gemini_flash_3_1_live">Gemini 3\.1 Live<\/option>/);
});

test('bridge wires session setup after stack selection and keeps debug authentication', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../twilio-media-bridge/server.js'), 'utf8');
  assert.match(source, /sessionSummary\.stack = requestedStack;[\s\S]*?sendGeminiSetup\(\{ socket: geminiWs, streamSid, stack \}\);/);
  assert.match(source, /geminiWs\.on\('open',[\s\S]*?sendGeminiSetup\(\{ socket: geminiWs, streamSid, stack \}\);/);
  assert.match(source, /probeGeminiSetup\(timeoutMs, req\.query\?\.stack\)/);
});
