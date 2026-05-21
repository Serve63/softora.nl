const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readMonthlyCostsSources() {
  const pagePath = path.join(__dirname, '../../premium-vaste-lasten.html');
  const scriptPath = path.join(__dirname, '../../assets/premium-vaste-lasten.js');
  const coverageScriptPath = path.join(__dirname, '../../assets/premium-customer-cost-coverage.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  const coverageScriptSource = fs.readFileSync(coverageScriptPath, 'utf8');
  return {
    pageSource,
    scriptSource,
    coverageScriptSource,
    combinedSource: `${pageSource}\n${scriptSource}\n${coverageScriptSource}`,
  };
}

test('premium terugkerende kosten gebruikt dashboard-typografie en verbergt legacy kostenblokken', () => {
  const { pageSource, combinedSource } = readMonthlyCostsSources();

  assert.doesNotMatch(pageSource, /Software & Tools/);
  assert.doesNotMatch(pageSource, /Marketing & SEO/);
  assert.doesNotMatch(pageSource, /Overig/);
  assert.doesNotMatch(pageSource, /Adobe Creative Cloud/);
  assert.doesNotMatch(pageSource, /Google Workspace/);
  assert.doesNotMatch(pageSource, /Boekhoudpakket/);
  assert.match(combinedSource, /'Totale kosten:'/);
  assert.doesNotMatch(pageSource, /'Hosting & Domeinen':/);

  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
  assert.doesNotMatch(pageSource, /Barlow/);
  assert.match(pageSource, /\.page-title\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;/);
  assert.match(pageSource, /\.page-title\s*\{[\s\S]*font-size:\s*1\.8rem;/);
  assert.match(pageSource, /\.page-sub\s*\{[\s\S]*font-size:\s*0\.82rem;/);
  assert.match(pageSource, /\.monthly-costs-boot-shell\s*\{[\s\S]*transition:\s*opacity 0\.16s ease;/);
  assert.match(pageSource, /\.monthly-costs-boot-shell\.is-booting\s*\{[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;/);
  assert.match(pageSource, /\.monthly-costs-stage\s*\{[\s\S]*min-height:\s*420px;/);
  assert.match(pageSource, /\.header\s*\{[\s\S]*align-items:\s*center;/);
  assert.match(pageSource, /<div id="last-updated"><\/div>/);
  assert.match(pageSource, /#last-updated\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*font-size:\s*0\.72rem;/);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*padding:\s*3rem 3rem 1\.8rem;/);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*position:\s*relative;/);
  assert.match(pageSource, /<main class="main-content">[\s\S]*id="monthly-costs-boot-loader"/);
  assert.match(pageSource, /id="monthly-costs-boot-loader"/);
  assert.match(pageSource, /\.monthly-costs-boot-loader\s*\{[\s\S]*position:\s*fixed;[\s\S]*left:\s*280px;[\s\S]*min-height:\s*100dvh;/);
  assert.match(pageSource, /@media \(max-width: 1100px\) \{[\s\S]*\.monthly-costs-boot-loader\s*\{[\s\S]*left:\s*0;/);
  assert.match(pageSource, /<div class="monthly-costs-spinner"[^>]*>[\s\S]*softora-dossier-loader__orbit--outer/);
  const themePath = path.join(__dirname, '../../assets/personnel-theme.css');
  const themeSource = fs.readFileSync(themePath, 'utf8');
  assert.match(themeSource, /@import url\('softora-dossier-loader\.css'\)/);
  const loaderPath = path.join(__dirname, '../../assets/softora-dossier-loader.css');
  const loaderSource = fs.readFileSync(loaderPath, 'utf8');
  assert.match(loaderSource, /@keyframes softora-dossier-loader-spin/);
  assert.match(loaderSource, /\.monthly-costs-spinner/);
  assert.match(
    pageSource,
    /<div class="monthly-costs-boot-shell is-booting" id="monthly-costs-boot-shell" aria-busy="true">/
  );
  assert.match(pageSource, /<div class="monthly-costs-stage" id="monthly-costs-stage">/);
  assert.match(pageSource, /<script src="assets\/premium-vaste-lasten\.js\?v=20260518b"><\/script>/);
  assert.doesNotMatch(pageSource, /let data = \{/);
  assert.match(
    combinedSource,
    /getElementById\('monthly-costs-boot-loader'\)[\s\S]*classList\.toggle\('is-hidden', !isBooting\)/
  );
  assert.match(pageSource, /\.totaal-amount\s*\{[\s\S]*font-size:\s*2\.62rem;/);
  assert.match(pageSource, /\.category-title\s*\{[\s\S]*font-size:\s*0\.92rem;/);
  assert.match(pageSource, /\.cost-name\s*\{\s*font-size:\s*0\.92rem;/);
  assert.match(pageSource, /\.cost-amount\s*\{[\s\S]*font-size:\s*1\.5rem;/);
  assert.match(pageSource, /\.add-inputs input, \.add-inputs select\s*\{[\s\S]*font-size:\s*0\.86rem;/);
});

test('premium terugkerende kosten gebruikt modals en delegated acties voor bewerken en verwijderen', () => {
  const { pageSource, scriptSource, combinedSource } = readMonthlyCostsSources();

  assert.match(pageSource, /<div class="confirm-modal-overlay" id="delete-modal-overlay" aria-hidden="true">/);
  assert.match(pageSource, /<button class="btn-modal btn-modal-save" id="delete-modal-confirm" type="button">Verwijderen<\/button>/);
  assert.match(pageSource, /\.confirm-modal-overlay\s*\{[\s\S]*z-index:\s*1210;/);
  assert.match(pageSource, /\.confirm-modal-text\s*\{[\s\S]*line-height:\s*1\.7;/);
  assert.doesNotMatch(scriptSource, /\.innerHTML\s*=/);
  assert.match(combinedSource, /function appendCostTextElement\(parent, tagName, className, text\) \{/);
  assert.match(combinedSource, /function createCostActionButton\(action, key, itemId, className, title\) \{/);
  assert.match(combinedSource, /function resolveCategoryName\(categoryKey\) \{/);
  assert.match(combinedSource, /button\.dataset\.action = action;/);
  assert.match(combinedSource, /button\.dataset\.catKey = key;/);
  assert.match(combinedSource, /button\.dataset\.itemId = String\(itemId\);/);
  assert.match(combinedSource, /button\.dataset\.action = 'add';/);
  assert.match(combinedSource, /button\.dataset\.catKey = key;/);
  assert.doesNotMatch(pageSource, /onclick="editItem\(/);
  assert.doesNotMatch(pageSource, /onclick="deleteItem\(/);
  assert.doesNotMatch(pageSource, /onclick="addItem\(/);
  assert.match(combinedSource, /document\.getElementById\('categories-wrap'\)\.addEventListener\('click', \(event\) => \{/);
  assert.match(combinedSource, /const button = event\.target\.closest\('\[data-action\]'\);/);
  assert.match(combinedSource, /if \(action === 'edit' && id > 0\) \{/);
  assert.match(combinedSource, /if \(action === 'delete' && id > 0\) \{/);
  assert.match(combinedSource, /function deleteItem\(cat, id\) \{[\s\S]*delete-modal-overlay[\s\S]*delete-modal-confirm/s);
  assert.match(combinedSource, /async function confirmDeleteModal\(\) \{[\s\S]*showToast\('✓ Post verwijderd'\);/s);
  assert.match(combinedSource, /function editItem\(cat, id\) \{[\s\S]*edit-modal-overlay[\s\S]*document\.getElementById\('edit-naam'\)\.focus\(\);/s);
});

test('premium terugkerende kosten toont dynamische posten bovenaan met paarse stippelrand', () => {
  const { pageSource, combinedSource } = readMonthlyCostsSources();

  assert.match(combinedSource, /naam:'Coldcalling', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.doesNotMatch(combinedSource, /naam:'Coldmailing', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.match(combinedSource, /naam:'API kosten', note:'OpenAI kosten laden\.\.\.', freq:'maandelijks', bedrag:null, amountLabel:'\.\.\.', status:'loading', highlighted:true/);
  assert.match(combinedSource, /let nextId = 4;/);
  assert.doesNotMatch(pageSource, /naam:'Hostinger VPS'/);
  assert.doesNotMatch(pageSource, /naam:'softora\.nl domein'/);
  assert.doesNotMatch(pageSource, /naam:'TransIP backup'/);
  assert.match(combinedSource, /window\.softoraMonthlyCostsData = data;/);
  assert.match(combinedSource, /window\.softoraMonthlyCostsRender = render;/);
  assert.match(pageSource, /<script src="assets\/premium-vaste-lasten\.js\?v=20260518b"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-monthly-costs-dynamic\.js\?v=20260521d" defer><\/script>/);
  assert.match(pageSource, /\.cost-row\.cost-row-accent\s*\{[\s\S]*border:\s*1px dashed var\(--crimson\);[\s\S]*background:\s*rgba\(139, 34, 82, 0\.04\);/);
  assert.match(combinedSource, /function createCategoryHeader\(cat, catTotal\) \{/);
  assert.match(combinedSource, /appendCostTextElement\(header, 'div', 'category-title', cat\);/);
  assert.match(combinedSource, /appendCostTextElement\(total, 'span', '', '\/mnd'\);/);
  assert.match(combinedSource, /function createCostRowsHead\(\) \{/);
  assert.match(combinedSource, /const visibleItems = monthlyCostsBootstrapDone \? sortMonthlyCostItemsForDisplay\(items\) : \[\];/);
  assert.match(combinedSource, /function sortMonthlyCostItemsForDisplay\(items\) \{/);
  assert.match(combinedSource, /const pinnedTopItems = source\.filter\(\(item\) => item && item\.highlighted\)\.slice\(0, 2\);/);
  assert.match(combinedSource, /function createLoadingCostRow\(\) \{[\s\S]*Kosten laden\.\.\.[\s\S]*actuele verbruikskosten worden opgehaald/);
  assert.match(combinedSource, /function createAddCostRow\(key\) \{[\s\S]*button\.textContent = '\+ Toevoegen';/);
  assert.match(pageSource, /\.cost-amount-wrap\.is-static\s*\{[\s\S]*justify-content:\s*flex-end;/);
  assert.match(combinedSource, /function createCostItemRow\(item, key\) \{/);
  assert.match(combinedSource, /row\.className = item\.highlighted \? 'cost-row cost-row-accent' : 'cost-row';/);
  assert.match(combinedSource, /const displayFreqLabel = item\.highlighted && item\.freq === 'maandelijks'[\s\S]*'Deze maand'[\s\S]*freqLabel\[item\.freq\] \|\| item\.freq \|\| '-';/);
  assert.match(combinedSource, /amountWrap\.className = item\.highlighted \? 'cost-amount-wrap is-static' : 'cost-amount-wrap';/);
  assert.match(combinedSource, /appendCostTextElement\(amountWrap, 'div', 'cost-amount', formatCostItemAmount\(item\)\);/);
  assert.match(combinedSource, /createCostActionButton\('edit', key, item\.id, 'btn-edit', 'Bewerken'\)/);
  assert.match(combinedSource, /createCostActionButton\('delete', key, item\.id, 'btn-del', 'Verwijderen'\)/);
});

test('premium terugkerende kosten bewaart bewerkbare posten via supabase ui-state', () => {
  const { combinedSource } = readMonthlyCostsSources();

  assert.match(combinedSource, /const MONTHLY_COSTS_REMOTE_SCOPE = 'premium_monthly_costs';/);
  assert.match(combinedSource, /const MONTHLY_COSTS_REMOTE_KEY = 'monthly_cost_entries_v1';/);
  assert.match(combinedSource, /async function fetchUiStateGetWithFallback\(scope\) \{/);
  assert.match(combinedSource, /async function fetchUiStateSetWithFallback\(scope, body\) \{/);
  assert.match(combinedSource, /async function persistMonthlyCostEntries\(actor = 'browser'\) \{/);
  assert.match(combinedSource, /async function ensureMonthlyCostEntriesLoaded\(\) \{/);
  assert.match(combinedSource, /async function bootstrapMonthlyCostsPage\(\) \{/);
  assert.match(combinedSource, /let monthlyCostsBootstrapDone = false;/);
  assert.match(combinedSource, /function setTotalsLoading\(\) \{/);
  assert.match(combinedSource, /const MONTHLY_COSTS_BOOT_MIN_VISIBLE_MS = 1000;/);
  assert.match(combinedSource, /function applyMonthlyCostsStageBooting\(isBooting\) \{[\s\S]*getElementById\('monthly-costs-boot-shell'\)/);
  assert.match(combinedSource, /function setMonthlyCostsStageBooting\(isBooting\) \{[\s\S]*MONTHLY_COSTS_BOOT_MIN_VISIBLE_MS - elapsedMs/);
  assert.match(combinedSource, /if \(!monthlyCostsBootstrapDone\) \{\s*setTotalsLoading\(\);/);
  assert.match(combinedSource, /\[MONTHLY_COSTS_REMOTE_KEY\]: JSON\.stringify\(editableItems\),/);
  assert.match(combinedSource, /await ensureMonthlyCostEntriesLoaded\(\);/);
  assert.match(combinedSource, /const refreshTasks = \[\];/);
  assert.match(combinedSource, /refreshTasks\.push\(window\.refreshMonthlyColdcallingCosts\(\)\);/);
  assert.match(combinedSource, /refreshTasks\.push\(window\.refreshMonthlyApiCosts\(\)\);/);
  assert.match(combinedSource, /refreshTasks\.push\(window\.refreshMonthlySupabaseCosts\(\)\);/);
  assert.match(combinedSource, /void Promise\.allSettled\(refreshTasks\)\.then/);
  assert.match(combinedSource, /const parsedEntries = JSON\.parse\(serializedEntries\);/);
  assert.match(combinedSource, /setMonthlyCostsStageBooting\(true\);/);
  assert.match(combinedSource, /setMonthlyCostsStageBooting\(false\);/);
  assert.match(combinedSource, /return persistMonthlyCostEntries\('browser_add'\)/);
  assert.match(combinedSource, /await persistMonthlyCostEntries\('browser_delete'\);/);
  assert.match(combinedSource, /await persistMonthlyCostEntries\('browser_edit'\);/);
  assert.match(combinedSource, /void bootstrapMonthlyCostsPage\(\);/);
});

test('premium terugkerende kosten bevat klantkosten-check voor betaalde kosten per klant', () => {
  const { pageSource, scriptSource, coverageScriptSource } = readMonthlyCostsSources();

  assert.match(pageSource, /<section class="coverage-panel" id="customer-cost-coverage"/);
  assert.match(pageSource, /Worden alle kosten betaald\?/);
  assert.match(pageSource, /id="coverage-cost-description"/);
  assert.match(pageSource, /id="coverage-cost-amount"/);
  assert.match(pageSource, /id="coverage-revenue-amount"/);
  assert.match(pageSource, /id="coverage-term"/);
  assert.match(pageSource, /<option value="maandelijks_opzegbaar">Maandelijks opzegbaar<\/option>/);
  assert.ok(
    pageSource.indexOf('<div id="categories-wrap"></div>') < pageSource.indexOf('<section class="coverage-panel"'),
    'Klantkosten-check hoort onder de postenlijst te staan'
  );
  assert.match(pageSource, /assets\/premium-database-import\.js\?v=20260427c/);
  assert.match(pageSource, /assets\/premium-customer-cost-coverage\.js\?v=20260516a/);

  assert.match(scriptSource, /window\.softoraMonthlyCostsHelpers = \{/);
  assert.match(scriptSource, /fetchUiStateGetWithFallback,/);
  assert.match(scriptSource, /fetchUiStateSetWithFallback,/);
  assert.match(coverageScriptSource, /const CUSTOMER_COST_COVERAGE_KEY = 'customer_cost_coverage_v1';/);
  assert.match(coverageScriptSource, /const CUSTOMER_DB_SCOPE = 'premium_customers_database';/);
  assert.match(coverageScriptSource, /const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';/);
  assert.match(coverageScriptSource, /readChunkedStateValue\(values, CUSTOMER_DB_KEY\)/);
  assert.match(coverageScriptSource, /amountToMonthly\(amount, frequency\)/);
  assert.match(coverageScriptSource, /record\.costFrequency === 'jaarlijks' && record\.customerTerm === 'maandelijks_opzegbaar'/);
  assert.match(coverageScriptSource, /Maandelijkse inkomsten/);
  assert.doesNotMatch(coverageScriptSource, /Terugkerende inkomsten/);
  assert.match(coverageScriptSource, /fmtEur\(amountToMonthly\(record\.revenueAmount, record\.revenueFrequency\)\)/);
  assert.match(coverageScriptSource, /nodes\.revenueAmount\.value = record\.revenueAmount \? String\(record\.revenueAmount\) : '0';/);
  assert.match(coverageScriptSource, /\[CUSTOMER_COST_COVERAGE_KEY\]: JSON\.stringify\(records\)/);
  assert.match(coverageScriptSource, /source: 'premium-customer-cost-coverage'/);
  assert.doesNotMatch(coverageScriptSource, /localStorage|sessionStorage|indexedDB/);
});

test('premium terugkerende kosten laadt dynamische coldcalling kosten van deze maand', () => {
  const scriptPath = path.join(__dirname, '../../assets/premium-monthly-costs-dynamic.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  assert.match(scriptSource, /const COST_SUMMARY_ENDPOINT = '\/api\/coldcalling\/cost-summary\?scope=month';/);
  assert.match(scriptSource, /const API_COST_SUMMARY_ENDPOINT = '\/api\/api-cost-summary\?scope=month';/);
  assert.match(scriptSource, /const SUPABASE_COST_SUMMARY_ENDPOINT = '\/api\/supabase\/cost-summary';/);
  assert.match(scriptSource, /const API_COST_POLL_INTERVAL_MS = 60 \* 1000;/);
  assert.match(scriptSource, /const BILLING_POLL_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(scriptSource, /async function fetchMonthlyCostSummary\(\)/);
  assert.match(scriptSource, /async function fetchApiCostSummary\(\)/);
  assert.match(scriptSource, /async function fetchSupabaseCostSummary\(\)/);
  assert.match(scriptSource, /function applyColdcallingCost\(amountEur, note\)/);
  assert.match(scriptSource, /function buildColdcallingCostNote\(summary\)/);
  assert.match(scriptSource, /normalizeSearchText\(item && item\.naam\) === 'coldcalling'/);
  assert.match(scriptSource, /const summary = await fetchMonthlyCostSummary\(\);/);
  assert.match(scriptSource, /const amountEur = Number\(summary\.costEur \|\| 0\) \|\| 0;/);
  assert.match(scriptSource, /window\.refreshMonthlyColdcallingCosts = refreshMonthlyColdcallingCosts;/);
  assert.match(scriptSource, /const API_COST_NOTE = 'OpenAI API kosten deze maand live';/);
  assert.match(scriptSource, /Live schatting · OpenAI loopt achter/);
  assert.match(scriptSource, /Live schatting organisatiebreed · OpenAI loopt achter/);
  assert.match(scriptSource, /Softora ledger live schatting/);
  assert.match(scriptSource, /const API_COST_UNAVAILABLE_NOTE = 'OpenAI kosten konden niet worden opgehaald';/);
  assert.match(scriptSource, /const API_COST_LOGIN_NOTE = 'Log opnieuw in om OpenAI kosten op te halen';/);
  assert.match(scriptSource, /const API_COST_ADMIN_NOTE = 'Alleen Full Acces kan OpenAI kosten bekijken';/);
  assert.match(scriptSource, /const BILLING_RETRY_INTERVAL_MS = 10000;/);
  assert.match(scriptSource, /const BILLING_RETRY_MAX_ATTEMPTS = 18;/);
  assert.match(scriptSource, /function scheduleApiCostRetry\(error\)/);
  assert.match(scriptSource, /if \(isPremiumAuthCostError\(statusCode, payload\)\) return false;/);
  assert.match(scriptSource, /const SUPABASE_COST_NOTE = 'Supabase kosten live bijgewerkt';/);
  assert.match(scriptSource, /function applyApiCostSnapshot\(snapshot\)/);
  assert.match(scriptSource, /function buildApiCostUnavailableNote\(error\)/);
  assert.match(scriptSource, /OpenAI Admin Key ontbreekt op Render/);
  assert.match(scriptSource, /OpenAI factuur-API fout/);
  assert.match(scriptSource, /payload\.upstreamStatus \|\| payload\.upstream_status/);
  assert.match(scriptSource, /function applyApiCostUnavailable\(error\)/);
  assert.match(scriptSource, /function applySupabaseCostSnapshot\(payload\)/);
  assert.match(scriptSource, /function applySupabaseCostUnavailable\(error\)/);
  assert.match(scriptSource, /normalizeSearchText\(item && item\.naam\) === 'api kosten'/);
  assert.match(scriptSource, /normalizeSearchText\(item && item\.naam\) === 'supabase'/);
  assert.doesNotMatch(scriptSource, /softora_api_cost_events_v1/);
  assert.doesNotMatch(scriptSource, /premium_api_costs/);
  assert.doesNotMatch(scriptSource, /function applyApiCost\(amountEur, note\)/);
  assert.doesNotMatch(scriptSource, /function buildApiCostNote\(summary\)/);
  assert.doesNotMatch(scriptSource, /OpenAI factuur:/);
  assert.match(scriptSource, /const summary = await fetchApiCostSummary\(\);/);
  assert.match(scriptSource, /const normalized = normalizeOpenAiCostPayload\(summary\);/);
  assert.match(scriptSource, /error\.status = response\.status;/);
  assert.match(scriptSource, /applyApiCostUnavailable\(error\);/);
  assert.match(scriptSource, /const summary = await fetchSupabaseCostSummary\(\);/);
  assert.match(scriptSource, /applySupabaseCostUnavailable\(error\);/);
  assert.match(scriptSource, /window\.refreshMonthlyApiCosts = refreshMonthlyApiCosts;/);
  assert.match(scriptSource, /window\.refreshMonthlySupabaseCosts = refreshMonthlySupabaseCosts;/);
  assert.match(scriptSource, /let coldcallingRefreshPromise = null;/);
  assert.match(scriptSource, /let apiCostRefreshPromise = null;/);
  assert.match(scriptSource, /let supabaseCostRefreshPromise = null;/);
  assert.match(scriptSource, /let apiCostPollTimer = null;/);
  assert.match(scriptSource, /let billingPollTimer = null;/);
  assert.match(scriptSource, /const hasApiCostItem = Boolean\(resolveApiCostItem\(\)\);/);
  assert.match(scriptSource, /const hasSupabaseCostItem = Boolean\(resolveSupabaseCostItem\(\)\);/);
  assert.match(
    scriptSource,
    /pollTimer = window\.setInterval\(function \(\) \{\s*void refreshMonthlyColdcallingCosts\(\);\s*\}, POLL_INTERVAL_MS\);/
  );
  assert.match(
    scriptSource,
    /apiCostPollTimer = window\.setInterval\(function \(\) \{\s*void refreshMonthlyApiCosts\(\);\s*\}, API_COST_POLL_INTERVAL_MS\);/
  );
  assert.match(
    scriptSource,
    /billingPollTimer = window\.setInterval\(function \(\) \{\s*void refreshMonthlySupabaseCosts\(\);\s*\}, BILLING_POLL_INTERVAL_MS\);/
  );
  assert.match(scriptSource, /url\.searchParams\.set\('_', String\(Date\.now\(\)\)\);/);
});
