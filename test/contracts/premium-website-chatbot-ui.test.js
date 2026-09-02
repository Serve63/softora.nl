const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homepagePath = path.join(__dirname, '../../premium-website.html');
const scriptPath = path.join(__dirname, '../../assets/premium-website-chatbot.js');
const stylesheetPath = path.join(__dirname, '../../assets/premium-website-chatbot.css');

test('homepage chatbotkaart opent de verdiepende chatbotpagina', () => {
  const source = fs.readFileSync(homepagePath, 'utf8');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(
    source,
    /<a class="tilt-card fade-up"[^>]*href="\/chatbot-laten-maken"[^>]*>[\s\S]*?<h3>Chatbot<\/h3>/
  );
  assert.doesNotMatch(source, /class="tilt-card fade-up chatbot-trigger"/);
  assert.match(script, /document\.body\.insertAdjacentHTML\(/);
  assert.match(script, /class="softora-chatbot"[\s\S]*id="softora-chatbot"[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*hidden>/);
  assert.match(script, /id="softora-chatbot-title">Waar kan ik je mee helpen\?<\/h2>/);
  assert.match(script, /id="softora-chatbot-form"[\s\S]*id="softora-chatbot-input"/);
  assert.match(source, /<link rel="stylesheet" href="\/assets\/premium-website-chatbot\.css\?v=20260818a"[^>]*>/);
  assert.match(source, /<script src="\/assets\/premium-website-chatbot\.js\?v=20260818a" defer><\/script>/);
});

test('homepage chatbot voert een lokale chatflow uit zonder externe AI-aanvraag', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const stylesheet = fs.readFileSync(stylesheetPath, 'utf8');

  assert.match(script, /addEventListener\("click", openChatbot\)/);
  assert.match(script, /addEventListener\("submit", function \(event\)/);
  assert.match(script, /responseRules/);
  assert.match(script, /dialog\.hidden = false/);
  assert.match(script, /dialog\.hidden = true/);
  assert.match(script, /Escape/);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
  assert.match(stylesheet, /\.softora-chatbot\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(stylesheet, /@media \(max-width: 600px\)[\s\S]*\.softora-chatbot-panel/);
});
