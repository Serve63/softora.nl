const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('opdrachtdossier ondersteunt spraakgestuurde website-bouwprompt rewrite', () => {
  const pageSource = fs.readFileSync(path.join(__dirname, '../../premium-opdracht-dossier.html'), 'utf8');
  const voiceSource = fs.readFileSync(
    path.join(__dirname, '../../assets/order-dossier-prompt-voice.js'),
    'utf8'
  );
  const aiRemoteSource = fs.readFileSync(path.join(__dirname, '../../server/services/ai-remote.js'), 'utf8');

  assert.match(pageSource, /assets\/order-dossier-prompt-voice\.js\?v=20260508a/);
  assert.match(pageSource, /id="opusPromptVoiceBtn"/);
  assert.match(pageSource, /Website-bouwprompt aanpassen met spraak/);
  assert.match(pageSource, /bindPromptVoiceControls\(baseData, layoutResponse\);/);
  assert.match(pageSource, /async onPromptUpdated\(promptText\)/);
  assert.match(pageSource, /persistDossierCache\(/);

  assert.match(voiceSource, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(voiceSource, /new MediaRecorder/);
  assert.match(voiceSource, /\/api\/ai\/notes-audio-to-text/);
  assert.match(voiceSource, /De transcriptie van de spraakopname is een wijzigingsinstructie/);
  assert.match(voiceSource, /Gebruik die instructie om de volledige website-bouwprompt opnieuw logisch/);
  assert.match(voiceSource, /Voeg de wijziging dus niet simpelweg onderaan toe/);
  assert.match(voiceSource, /onPromptUpdated\(rewrittenPrompt, result\)/);

  assert.match(aiRemoteSource, /truncateText\(normalizeString\(options\.context \|\| ''\), 18000\)/);
  assert.match(
    aiRemoteSource,
    /Als de context een bestaande website-bouwprompt bevat met een wijzigingsinstructie/
  );
});
