const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium maandelijkse kosten gebruikt dashboard-typografie en verbergt legacy kostenblokken', () => {
  const pagePath = path.join(__dirname, '../../premium-maandelijkse-kosten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /Software & Tools/);
  assert.doesNotMatch(pageSource, /Marketing & SEO/);
  assert.doesNotMatch(pageSource, /Overig/);
  assert.doesNotMatch(pageSource, /Adobe Creative Cloud/);
  assert.doesNotMatch(pageSource, /Google Workspace/);
  assert.doesNotMatch(pageSource, /Boekhoudpakket/);
  assert.match(pageSource, /'Totale kosten:'/);
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
  assert.match(pageSource, /\.monthly-costs-spinner\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*animation:\s*monthly-costs-spin/);
  assert.match(pageSource, /@keyframes monthly-costs-spin/);
  assert.match(
    pageSource,
    /<div class="monthly-costs-boot-shell is-booting" id="monthly-costs-boot-shell" aria-busy="true">/
  );
  assert.match(pageSource, /<div class="monthly-costs-stage" id="monthly-costs-stage">/);
  assert.match(
    pageSource,
    /getElementById\('monthly-costs-boot-loader'\)[\s\S]*classList\.toggle\('is-hidden', !isBooting\)/
  );
  assert.match(pageSource, /\.totaal-amount\s*\{[\s\S]*font-size:\s*2\.62rem;/);
  assert.match(pageSource, /\.category-title\s*\{[\s\S]*font-size:\s*0\.92rem;/);
  assert.match(pageSource, /\.cost-name\s*\{\s*font-size:\s*0\.92rem;/);
  assert.match(pageSource, /\.cost-amount\s*\{[\s\S]*font-size:\s*1\.5rem;/);
  assert.match(pageSource, /\.add-inputs input, \.add-inputs select\s*\{[\s\S]*font-size:\s*0\.86rem;/);
});

test('premium maandelijkse kosten gebruikt modals en delegated acties voor bewerken en verwijderen', () => {
  const pagePath = path.join(__dirname, '../../premium-maandelijkse-kosten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<div class="confirm-modal-overlay" id="delete-modal-overlay" aria-hidden="true">/);
  assert.match(pageSource, /<button class="btn-modal btn-modal-save" id="delete-modal-confirm" type="button">Verwijderen<\/button>/);
  assert.match(pageSource, /\.confirm-modal-overlay\s*\{[\s\S]*z-index:\s*1210;/);
  assert.match(pageSource, /\.confirm-modal-text\s*\{[\s\S]*line-height:\s*1\.7;/);
  assert.match(pageSource, /function escapeHtml\(value\) \{/);
  assert.match(pageSource, /function resolveCategoryName\(categoryKey\) \{/);
  assert.match(pageSource, /data-action="edit" data-cat-key="\$\{escapeHtml\(key\)\}" data-item-id="\$\{item\.id\}"/);
  assert.match(pageSource, /data-action="delete" data-cat-key="\$\{escapeHtml\(key\)\}" data-item-id="\$\{item\.id\}"/);
  assert.match(pageSource, /data-action="add" data-cat-key="\$\{escapeHtml\(key\)\}"/);
  assert.doesNotMatch(pageSource, /onclick="editItem\(/);
  assert.doesNotMatch(pageSource, /onclick="deleteItem\(/);
  assert.doesNotMatch(pageSource, /onclick="addItem\(/);
  assert.match(pageSource, /document\.getElementById\('categories-wrap'\)\.addEventListener\('click', \(event\) => \{/);
  assert.match(pageSource, /const button = event\.target\.closest\('\[data-action\]'\);/);
  assert.match(pageSource, /if \(action === 'edit' && id > 0\) \{/);
  assert.match(pageSource, /if \(action === 'delete' && id > 0\) \{/);
  assert.match(pageSource, /function deleteItem\(cat, id\) \{[\s\S]*delete-modal-overlay[\s\S]*delete-modal-confirm/s);
  assert.match(pageSource, /async function confirmDeleteModal\(\) \{[\s\S]*showToast\('✓ Post verwijderd'\);/s);
  assert.match(pageSource, /function editItem\(cat, id\) \{[\s\S]*edit-modal-overlay[\s\S]*document\.getElementById\('edit-naam'\)\.focus\(\);/s);
});

test('premium maandelijkse kosten toont coldcalling en coldmailing bovenaan met paarse stippelrand', () => {
  const pagePath = path.join(__dirname, '../../premium-maandelijkse-kosten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /naam:'Coldcalling', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.match(pageSource, /naam:'Coldmailing', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.doesNotMatch(pageSource, /naam:'Hostinger VPS'/);
  assert.doesNotMatch(pageSource, /naam:'softora\.nl domein'/);
  assert.doesNotMatch(pageSource, /naam:'TransIP backup'/);
  assert.match(pageSource, /window\.softoraMonthlyCostsData = data;/);
  assert.match(pageSource, /window\.softoraMonthlyCostsRender = render;/);
  assert.match(pageSource, /<script src="assets\/premium-monthly-costs-dynamic\.js\?v=20260417a" defer><\/script>/);
  assert.match(pageSource, /\.cost-row\.cost-row-accent\s*\{[\s\S]*border:\s*1px dashed var\(--crimson\);[\s\S]*background:\s*rgba\(139, 34, 82, 0\.04\);/);
  assert.match(pageSource, /const categoryHeaderMarkup = cat === 'Totale kosten:' \? '' : `[\s\S]*class="category-header"[\s\S]*category-title[\s\S]*category-total/);
  assert.match(pageSource, /block\.innerHTML = `[\s\S]*\$\{categoryHeaderMarkup\}[\s\S]*<div class="cost-row head">/);
  assert.match(pageSource, /const visibleItems = monthlyCostsBootstrapDone \? items : \[\];/);
  assert.match(pageSource, /const loadingRowsMarkup = !monthlyCostsBootstrapDone \? `[\s\S]*Kosten laden\.\.\.[\s\S]*actuele coldcalling-kosten worden opgehaald/);
  assert.match(pageSource, /const addRowMarkup = monthlyCostsBootstrapDone \? `[\s\S]*\+ Toevoegen/);
  assert.match(pageSource, /\.cost-amount-wrap\.is-static\s*\{[\s\S]*justify-content:\s*flex-end;/);
  assert.match(pageSource, /const rowClassName = item\.highlighted \? 'cost-row cost-row-accent' : 'cost-row';/);
  assert.match(pageSource, /const displayFreqLabel = item\.highlighted && item\.freq === 'maandelijks'[\s\S]*'Deze maand'[\s\S]*freqLabel\[item\.freq\] \|\| item\.freq \|\| '-';/);
  assert.match(pageSource, /const amountWrapClassName = item\.highlighted \? 'cost-amount-wrap is-static' : 'cost-amount-wrap';/);
  assert.match(pageSource, /const rowActionsMarkup = item\.highlighted \? '' : `[\s\S]*class="row-actions"[\s\S]*data-action="edit"[\s\S]*data-action="delete"/);
  assert.match(pageSource, /<div class="\$\{amountWrapClassName\}">[\s\S]*<div class="cost-amount">\$\{fmtEur\(item\.bedrag\)\}<\/div>[\s\S]*\$\{rowActionsMarkup\}/);
});

test('premium maandelijkse kosten bewaart bewerkbare posten via supabase ui-state', () => {
  const pagePath = path.join(__dirname, '../../premium-maandelijkse-kosten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /const MONTHLY_COSTS_REMOTE_SCOPE = 'premium_monthly_costs';/);
  assert.match(pageSource, /const MONTHLY_COSTS_REMOTE_KEY = 'monthly_cost_entries_v1';/);
  assert.match(pageSource, /async function fetchUiStateGetWithFallback\(scope\) \{/);
  assert.match(pageSource, /async function fetchUiStateSetWithFallback\(scope, body\) \{/);
  assert.match(pageSource, /async function persistMonthlyCostEntries\(actor = 'browser'\) \{/);
  assert.match(pageSource, /async function ensureMonthlyCostEntriesLoaded\(\) \{/);
  assert.match(pageSource, /async function bootstrapMonthlyCostsPage\(\) \{/);
  assert.match(pageSource, /let monthlyCostsBootstrapDone = false;/);
  assert.match(pageSource, /function setTotalsLoading\(\) \{/);
  assert.match(pageSource, /function setMonthlyCostsStageBooting\(isBooting\) \{[\s\S]*getElementById\('monthly-costs-boot-shell'\)/);
  assert.match(pageSource, /if \(!monthlyCostsBootstrapDone\) \{\s*setTotalsLoading\(\);/);
  assert.match(pageSource, /\[MONTHLY_COSTS_REMOTE_KEY\]: JSON\.stringify\(editableItems\),/);
  assert.match(pageSource, /await ensureMonthlyCostEntriesLoaded\(\);/);
  assert.match(pageSource, /await window\.refreshMonthlyColdcallingCosts\(\);/);
  assert.match(pageSource, /const parsedEntries = JSON\.parse\(serializedEntries\);/);
  assert.match(pageSource, /setMonthlyCostsStageBooting\(true\);/);
  assert.match(pageSource, /setMonthlyCostsStageBooting\(false\);/);
  assert.match(pageSource, /return persistMonthlyCostEntries\('browser_add'\)/);
  assert.match(pageSource, /await persistMonthlyCostEntries\('browser_delete'\);/);
  assert.match(pageSource, /await persistMonthlyCostEntries\('browser_edit'\);/);
  assert.match(pageSource, /void bootstrapMonthlyCostsPage\(\);/);
});

test('premium maandelijkse kosten laadt dynamische coldcalling kosten van deze maand', () => {
  const scriptPath = path.join(__dirname, '../../assets/premium-monthly-costs-dynamic.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  assert.match(scriptSource, /const COST_SUMMARY_ENDPOINT = '\/api\/coldcalling\/cost-summary\?scope=month';/);
  assert.match(scriptSource, /async function fetchMonthlyCostSummary\(\)/);
  assert.match(scriptSource, /function applyColdcallingCost\(amountEur\)/);
  assert.match(scriptSource, /normalizeSearchText\(item && item\.naam\) === 'coldcalling'/);
  assert.match(scriptSource, /const summary = await fetchMonthlyCostSummary\(\);/);
  assert.match(scriptSource, /const amountEur = Number\(summary\.costEur \|\| 0\) \|\| 0;/);
  assert.match(scriptSource, /window\.refreshMonthlyColdcallingCosts = refreshMonthlyColdcallingCosts;/);
  assert.match(
    scriptSource,
    /window\.setInterval\(function \(\) \{\s*void refreshMonthlyColdcallingCosts\(\);\s*\}, POLL_INTERVAL_MS\);/
  );
});
