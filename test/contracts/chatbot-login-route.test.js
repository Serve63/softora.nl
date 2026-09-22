const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
test('chatbot login uses isolated existing production authentication without local demo links', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(route => route.source === '/chatbot-login' && route.destination === '/assets/chatbot-login/index.html'));
  const html = fs.readFileSync(path.join(root, 'assets/chatbot-login/index.html'), 'utf8');
  assert.match(html, /https:\/\/softora-chatbot-platform.vercel.app\/app/);
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost|design=|<input/);
  assert.match(html, /title="Softora chatbot inloggen"/);
});
