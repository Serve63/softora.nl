const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MATHIJS_PROFILE, MATHIJS_GREETING, MATHIJS_SYSTEM_PROMPT, MATHIJS_INITIAL_MESSAGE,
  resolveAssistantConversation,
} = require('../../twilio-media-bridge/assistant-profile');
const { createGeminiSessionSetupSender, GEMINI_38_MODEL } = require('../../twilio-media-bridge/gemini-session');
const { buildGeminiSetupPayload, buildGeminiInitialRealtimeInputPayload } = require('../../twilio-media-bridge/gemini-payload');

test('Mathijs greets with the requested name and transparently identifies as an AI assistant', () => {
  const settings = resolveAssistantConversation({
    profile: MATHIJS_PROFILE, systemPrompt: 'Old sales script', initialMessage: 'Coldcall opening', autoStart: false,
  });
  assert.equal(MATHIJS_GREETING, 'Hallo, met Mathijs van Softora.nl');
  assert.equal(settings.systemPrompt, MATHIJS_SYSTEM_PROMPT);
  assert.equal(settings.initialMessage, MATHIJS_INITIAL_MESSAGE);
  assert.equal(settings.autoStart, true);
  assert.ok(settings.initialMessage.includes(MATHIJS_GREETING));
  assert.match(settings.initialMessage, /Ik ben de AI-assistent/);
  assert.doesNotMatch(settings.systemPrompt, /Old sales script/);
});

test('unknown profiles and existing campaigns keep configured prompts and auto-start settings', () => {
  for (const profile of ['', 'caller supplied prompt', 'other']) {
    assert.deepEqual(resolveAssistantConversation({
      profile, systemPrompt: 'Campaign prompt', initialMessage: 'Campaign opening', autoStart: false,
    }), {
      profile: 'configured', systemPrompt: 'Campaign prompt', initialMessage: 'Campaign opening', autoStart: false,
    });
  }
});

for (const socketOpensFirst of [true, false]) {
  test(`Mathijs setup waits for the selected Twilio profile when socket opens ${socketOpensFirst ? 'first' : 'last'}`, () => {
    const sent = [];
    const socket = { readyState: socketOpensFirst ? 1 : 0, send: (value) => sent.push(JSON.parse(value)) };
    let conversation = resolveAssistantConversation({ systemPrompt: 'Campaign prompt' });
    const sendSetup = createGeminiSessionSetupSender({
      configuredModel: 'models/gemini-3.1-flash-live-preview',
      buildPayload: (model) => buildGeminiSetupPayload({ model, systemPrompt: conversation.systemPrompt }),
    });
    assert.equal(sendSetup({ socket, streamSid: '', stack: 'gemini_flash_3_8_live' }), false);
    conversation = resolveAssistantConversation({ profile: MATHIJS_PROFILE });
    socket.readyState = 1;
    assert.equal(sendSetup({ socket, streamSid: 'MZMathijs', stack: 'gemini_flash_3_8_live' }), true);
    assert.equal(sent[0].setup.model, GEMINI_38_MODEL);
    assert.equal(sent[0].setup.systemInstruction.parts[0].text, MATHIJS_SYSTEM_PROMPT);
    const opening = buildGeminiInitialRealtimeInputPayload(conversation.initialMessage);
    assert.equal(opening.realtimeInput.text, MATHIJS_INITIAL_MESSAGE);
    assert.equal(sendSetup({ socket, streamSid: 'MZMathijs', stack: 'gemini_flash_3_8_live' }), false);
    assert.equal(sent.length, 1);
    assert.equal(resolveAssistantConversation({ systemPrompt: 'Other campaign' }).systemPrompt, 'Other campaign');
  });
}

test('Mathijs public contact facts match the canonical company page', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../assets/juridisch/bedrijfsgegevens.html'), 'utf8');
  for (const fact of ['info@softora.nl', '93827504', 'NL866541925B01', 'Oisterwijk']) {
    assert.ok(page.includes(fact));
    assert.ok(MATHIJS_SYSTEM_PROMPT.includes(fact));
  }
  assert.ok(page.includes('06 4326 2792'));
  assert.ok(MATHIJS_SYSTEM_PROMPT.includes('06 4326 2792'));
});

test('Mathijs has explicit limits for private data, unimplemented actions and commercial promises', () => {
  assert.match(MATHIJS_SYSTEM_PROMPT, /geen toegang tot klantdossiers, facturen, actuele opdrachtstatus/);
  assert.match(MATHIJS_SYSTEM_PROMPT, /geen afspraken boeken, e-mails sturen, betalingen/);
  assert.match(MATHIJS_SYSTEM_PROMPT, /tickets of terugbelverzoeken opslaan/);
  assert.match(MATHIJS_SYSTEM_PROMPT, /Zeg nooit dat je een actie hebt uitgevoerd/);
  assert.match(MATHIJS_SYSTEM_PROMPT, /Noem geen vaste prijs/);
  assert.match(MATHIJS_SYSTEM_PROMPT, /Vraag nooit naar wachtwoorden, verificatiecodes/);
});

test('bridge uses the selected session profile for both setup and the first spoken turn', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../twilio-media-bridge/server.js'), 'utf8');
  assert.match(source, /buildGeminiSetupPayload\(model, conversation\.systemPrompt\)/);
  assert.match(source, /profile: customParameters\.assistant/);
  assert.match(source, /buildGeminiInitialRealtimeInputPayload\(conversation\.initialMessage\)/);
  assert.match(source, /conversation\.autoStart && conversation\.initialMessage && !autoStartSent/);
});
