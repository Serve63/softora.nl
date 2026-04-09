const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium dashboard chat presenteert Ruben Nijhuis als centrale assistent', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<span>Ruben Nijhuis<\/span>/);
  assert.match(pageSource, /<strong>Ruben Nijhuis<\/strong>/);
  assert.doesNotMatch(pageSource, /Je Softora-collega voor context, keuzes en overzicht in de software\./);
  assert.match(pageSource, /placeholder="Vraag het aan Ruben Nijhuis\.\.\."/);
  assert.match(pageSource, /const CHAT_ENDPOINTS = \['\/api\/ai\/ruben-chat', '\/api\/ai\/dashboard-chat', '\/api\/ai-dashboard-chat'\];/);
  assert.match(pageSource, /bubble\.textContent = 'Ruben Nijhuis denkt na\.\.\.';/);
  assert.match(pageSource, /formatStatus\('Ruben Nijhuis verwerkt je vraag\.\.\.', ''\);/);
  assert.doesNotMatch(pageSource, /Bijgewerkt met de nieuwste dashboarddata\./);
  assert.match(pageSource, /function renderAssistantMarkdown\(content\) \{/);
  assert.match(pageSource, /function renderMessageBubbleContent\(bubble, item\) \{/);
  assert.match(pageSource, /bubble\.innerHTML = renderAssistantMarkdown\(item\.content\);/);
  assert.match(pageSource, /Hoi, ik ben Ruben Nijhuis\./);
});
