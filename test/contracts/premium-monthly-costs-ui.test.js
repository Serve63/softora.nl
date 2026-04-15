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
