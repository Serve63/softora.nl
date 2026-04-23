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
  assert.match(
    pageSource,
    /class="dashboard-lead-legend-strip"[\s\S]*class="lead-type-legend"[\s\S]*Bedrijfssoftware[\s\S]*Voicesoftware[\s\S]*Chatbots/s
  );
});

test('premium dashboard toont AI beheer dropdown boven de datumfilters', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /class="topbar-right dashboard-topbar-right"[\s\S]*id="aiManagementDropdown"[\s\S]*id="aiManagementStatusDot"[\s\S]*id="aiManagementLabel">AI BEHEER<\/span>[\s\S]*data-ai-management-value="software"[\s\S]*ai-management-status-dot--green[\s\S]*AI BEHEER[\s\S]*data-ai-management-value="personnel"[\s\S]*ai-management-status-dot--orange[\s\S]*PERSONEEL BEHEER[\s\S]*class="dashboard-topbar-controls"[\s\S]*class="topbar-date"[\s\S]*id="dashboardPeriodDropdown"/
  );
  assert.match(pageSource, /\.ai-management-status-dot--red \{/);
  assert.match(pageSource, /const AI_MANAGEMENT_STATUS = \{/);
  assert.match(pageSource, /window\.SoftoraDashboardAiManagement = \{/);
  assert.match(pageSource, /aiManagementMode: managementContext\.mode/);
});
