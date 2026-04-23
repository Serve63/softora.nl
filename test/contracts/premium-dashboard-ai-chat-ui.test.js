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

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /class="topbar-right dashboard-topbar-right"/);
  assert.match(pageSource, /id="aiManagementDropdown"/);
  assert.match(
    pageSource,
    /<span class="ai-management-status-dot ai-management-status-dot--green" id="aiManagementStatusDot"[^>]*><\/span>/
  );
  assert.match(pageSource, /id="aiManagementLabel">PERSONEEL BEHEER<\/span>/);
  assert.match(
    pageSource,
    /data-ai-management-value="software"[\s\S]*aria-checked="false"[\s\S]*ai-management-status-dot--red[\s\S]*AI BEHEER/
  );
  assert.match(
    pageSource,
    /data-ai-management-value="personnel"[\s\S]*aria-checked="true"[\s\S]*ai-management-status-dot--green[\s\S]*PERSONEEL BEHEER/
  );
  assert.match(pageSource, /class="dashboard-topbar-controls"/);
  assert.match(pageSource, /class="topbar-date"/);
  assert.match(pageSource, /id="dashboardPeriodDropdown"/);
  assert.match(pageSource, /\.ai-management-status-dot--red \{/);
  assert.match(pageSource, /const initialAiManagementMode =/);
  assert.match(pageSource, /const AI_MANAGEMENT_STATUS = \{/);
  assert.match(pageSource, /window\.SoftoraDashboardAiManagement = \{/);
  assert.match(pageSource, /window\.SoftoraAiManagement &&/);
  assert.match(pageSource, /let aiManagementMode = initialAiManagementMode === 'software' \? 'software' : 'personnel';/);
  assert.match(pageSource, /aiManagementMode: managementContext\.mode/);
  assert.match(pageSource, /softora-ai-management-change/);
});
