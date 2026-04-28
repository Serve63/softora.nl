const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const reviewPath = path.join(repoRoot, 'docs/codebase-priority-review.md');

test('codebase priority review keeps frontend DOM safety as the top priority', () => {
  const review = fs.readFileSync(reviewPath, 'utf8');

  assert.match(review, /P0: frontend DOM-veiligheid standaardiseren/);
  assert.match(review, /directe security-impact/);
  assert.match(review, /innerHTML/);
  assert.match(review, /centrale escape-helpers/);
});

test('codebase priority review keeps the largest frontend and backend refactor targets visible', () => {
  const review = fs.readFileSync(reviewPath, 'utf8');

  assert.match(review, /assets\/coldcalling-dashboard\.js/);
  assert.match(review, /premium-ai-coldmailing\.html/);
  assert.match(review, /premium-personeel-dashboard\.html/);
  assert.match(review, /server\/services\/ai-remote\.js/);
  assert.match(review, /server\/services\/coldmail-campaign\.js/);
});

test('codebase priority review keeps repository migration and security verification in the backlog', () => {
  const review = fs.readFileSync(reviewPath, 'utf8');

  assert.match(review, /repository-migratie verder afronden/);
  assert.match(review, /legacy UI-state/);
  assert.match(review, /verify:security/);
  assert.match(review, /dependency-audit/);
});
