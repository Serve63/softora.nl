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

test('premium dashboard telt alleen databaseklanten als totale klanten', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /function normalizePremiumDashboardCustomerDatabaseStatus\(item\)/);
  assert.match(pageSource, /const databaseStatus = normalizePremiumDashboardCustomerDatabaseStatus\(item\);/);
  assert.match(pageSource, /databaseStatus,/);
  assert.match(pageSource, /\.filter\(\(customer\) => customer\.databaseStatus === 'klant'\)/);
  assert.match(pageSource, /totalClientsEl\.textContent = String\(hasCustomerDatabase \? customers\.length : uniqueClients\.size\);/);
});

test('premium dashboard opent AI beheer configuratie met doel en toegestane middelen', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="aiManagementConfigModal" role="dialog" aria-modal="true"/);
  assert.match(pageSource, /<label class="ai-management-config-label" for="aiManagementGoalInput">Doel:<\/label>/);
  assert.match(pageSource, /id="aiManagementGoalInput" placeholder="Ben specifiek\. AI doet letterlijk wat je zegt\."/);
  assert.match(pageSource, /goal: '',/);
  assert.match(pageSource, /goal: normalizeDashboardString\(raw\.goal\),/);
  assert.doesNotMatch(pageSource, /Meer kwalitatieve afspraken en klanten binnenhalen\./);
  assert.match(pageSource, /data-ai-config-channel="coldcalling"/);
  assert.match(pageSource, /data-ai-config-channel="coldmailing"/);
  assert.match(pageSource, /data-ai-config-channel="ads_trustoo"/);
  assert.match(pageSource, /data-ai-config-channel="ads_pinterest"/);
  assert.match(pageSource, /data-ai-config-channel="ads_facebook"/);
  assert.match(pageSource, /data-ai-config-channel="ads_twitter"/);
  assert.match(pageSource, /data-ai-config-channel="ads_google"/);
  assert.match(pageSource, /data-ai-config-channel="ads_linkedin"/);
  assert.match(pageSource, /data-ai-config-toggle="databaseDynamic"/);
  assert.match(pageSource, /data-ai-config-toggle="agendaDynamic"/);
  assert.match(pageSource, /<div class="ai-management-config-label">Afspraken plannen<\/div>/);
  assert.match(pageSource, /data-ai-schedule-day="monday"/);
  assert.match(pageSource, /data-ai-schedule-day="friday"/);
  assert.match(pageSource, /data-ai-schedule-day="sunday"/);
  assert.match(pageSource, /id="aiManagementScheduleStart" value="08:30"/);
  assert.match(pageSource, /id="aiManagementScheduleEnd" value="17:00"/);
  assert.match(pageSource, /const AI_MANAGEMENT_CONFIG_SCOPE = 'premium_dashboard_ai_management';/);
  assert.match(pageSource, /const AI_MANAGEMENT_CONFIG_KEY = 'softora_dashboard_ai_management_config_v1';/);
  assert.match(pageSource, /scheduleDays: \['monday', 'tuesday', 'wednesday', 'thursday', 'friday'\]/);
  assert.match(pageSource, /scheduleStart: '08:30'/);
  assert.match(pageSource, /scheduleEnd: '17:00'/);
  assert.match(pageSource, /function normalizeDashboardTime\(value, fallback\)/);
  assert.match(pageSource, /const aiManagementScheduleDayInputs = Array\.from\(document\.querySelectorAll\('\[data-ai-schedule-day\]'\)\);/);
  assert.match(pageSource, /aiManagementScheduleStartInput\.value = config\.scheduleStart;/);
  assert.match(pageSource, /aiManagementScheduleEndInput\.value = config\.scheduleEnd;/);
  assert.match(pageSource, /scheduleDays,/);
  assert.match(pageSource, /scheduleStart: aiManagementScheduleStartInput \? aiManagementScheduleStartInput\.value : DEFAULT_AI_MANAGEMENT_CONFIG\.scheduleStart/);
  assert.match(pageSource, /scheduleEnd: aiManagementScheduleEndInput \? aiManagementScheduleEndInput\.value : DEFAULT_AI_MANAGEMENT_CONFIG\.scheduleEnd/);
  assert.match(pageSource, /afspraken plannen op \$\{safeConfig\.scheduleDays\.map\(getAiManagementScheduleDayLabel\)\.join\(', '\)\} tussen \$\{safeConfig\.scheduleStart\} en \$\{safeConfig\.scheduleEnd\}/);
  assert.match(pageSource, /async function hydrateAiManagementConfigFromServer\(\)/);
  assert.match(pageSource, /async function fetchPremiumUiStateSet\(scope, values\)/);
  assert.match(pageSource, /function openAiManagementConfigModal\(\)/);
  assert.match(pageSource, /function saveAiManagementConfigFromForm\(\)/);
  assert.match(pageSource, /if \(normalizeAiManagementMode\(nextMode\) === 'software'\) \{/);
  assert.match(pageSource, /openAiManagementConfigModal\(\);/);
  assert.match(pageSource, /config: normalizeAiManagementConfig\(aiManagementConfig\)/);
});
