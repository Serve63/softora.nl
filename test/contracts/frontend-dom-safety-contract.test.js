const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const contractPath = path.join(repoRoot, 'docs/frontend-dom-safety-contract.md');

test('frontend DOM safety contract defines safe defaults for dynamic rendering', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /textContent/);
  assert.match(contract, /document\.createElement/);
  assert.match(contract, /replaceChildren/);
  assert.match(contract, /escapeHtml/);
  assert.match(contract, /Nieuwe `innerHTML`-rendering met ruwe externe data is niet toegestaan/);
});

test('frontend DOM safety contract treats risky data sources as unsafe by default', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /gebruikersinvoer/);
  assert.match(contract, /API-responses/);
  assert.match(contract, /AI-output/);
  assert.match(contract, /e-mailinhoud/);
  assert.match(contract, /lead- en klantvelden/);
  assert.match(contract, /data uit browser storage/);
});

test('frontend DOM safety contract keeps large frontend refactors incremental', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /assets\/coldcalling-dashboard\.js/);
  assert.match(contract, /kleine renderhelpers/);
  assert.match(contract, /gerichte contracttests/);
  assert.match(contract, /Vermijd brede gedragswijzigingen/);
});
