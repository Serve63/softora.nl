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

  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
  assert.doesNotMatch(pageSource, /Barlow/);
  assert.match(pageSource, /\.page-title\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;/);
  assert.match(pageSource, /\.page-title\s*\{[\s\S]*font-size:\s*1\.8rem;/);
  assert.match(pageSource, /\.page-sub\s*\{[\s\S]*font-size:\s*0\.82rem;/);
  assert.match(pageSource, /\.header\s*\{[\s\S]*align-items:\s*center;/);
  assert.match(pageSource, /<div id="last-updated"><\/div>/);
  assert.match(pageSource, /#last-updated\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*font-size:\s*0\.72rem;/);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*padding:\s*3rem 3rem 1\.8rem;/);
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
  assert.match(pageSource, /function confirmDeleteModal\(\) \{[\s\S]*showToast\('✓ Post verwijderd'\);/s);
  assert.match(pageSource, /function editItem\(cat, id\) \{[\s\S]*edit-modal-overlay[\s\S]*document\.getElementById\('edit-naam'\)\.focus\(\);/s);
});

test('premium maandelijkse kosten toont coldcalling en coldmailing bovenaan met paarse stippelrand', () => {
  const pagePath = path.join(__dirname, '../../premium-maandelijkse-kosten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /naam:'Coldcalling', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.match(pageSource, /naam:'Coldmailing', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0\.00, status:'active', highlighted:true/);
  assert.match(pageSource, /\.cost-row\.cost-row-accent\s*\{[\s\S]*border:\s*1px dashed var\(--crimson\);[\s\S]*background:\s*rgba\(139, 34, 82, 0\.04\);/);
  assert.match(pageSource, /\.cost-amount-wrap\.is-static\s*\{[\s\S]*justify-content:\s*flex-end;/);
  assert.match(pageSource, /const rowClassName = item\.highlighted \? 'cost-row cost-row-accent' : 'cost-row';/);
  assert.match(pageSource, /const displayFreqLabel = item\.highlighted && item\.freq === 'maandelijks'[\s\S]*'Deze maand'[\s\S]*freqLabel\[item\.freq\] \|\| item\.freq \|\| '-';/);
  assert.match(pageSource, /const amountWrapClassName = item\.highlighted \? 'cost-amount-wrap is-static' : 'cost-amount-wrap';/);
  assert.match(pageSource, /const rowActionsMarkup = item\.highlighted \? '' : `[\s\S]*class="row-actions"[\s\S]*data-action="edit"[\s\S]*data-action="delete"/);
  assert.match(pageSource, /<div class="\$\{amountWrapClassName\}">[\s\S]*<div class="cost-amount">\$\{fmtEur\(item\.bedrag\)\}<\/div>[\s\S]*\$\{rowActionsMarkup\}/);
});
