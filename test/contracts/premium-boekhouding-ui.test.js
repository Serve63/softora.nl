const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../../premium-boekhouding.html');
const scriptPath = path.join(__dirname, '../../assets/premium-bookkeeping.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

test('premium boekhouding no longer shows ICP opgave rows', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script>\s*<script src="assets\/premium-bookkeeping\.js\?v=20260427a"><\/script>/);
  assert.match(scriptSource, /function aangiftes\(y\) \{/);
  assert.match(scriptSource, /naam: "BTW Aangifte"/);
  assert.match(scriptSource, /naam: "Inkomstenbelasting"/);
  assert.match(scriptSource, /document\.getElementById\("map-title"\)\.textContent = a\.naam;/);
  assert.match(scriptSource, /document\.getElementById\("map-period"\)\.textContent = a\.period \|\| "";/);
  assert.doesNotMatch(scriptSource, /document\.getElementById\("map-period"\)\.textContent = " - " \+ a\.period;/);
  assert.doesNotMatch(scriptSource, /naam: "ICP Opgave"/);
  assert.doesNotMatch(scriptSource, /cat: "Overige Opgaven"/);
});

test('premium boekhouding toont Softora bedrijfsgegevens rechtsboven in de header', () => {
  const pageSource = readPage();

  assert.match(pageSource, /class="bookkeeping-header"/);
  assert.match(pageSource, /class="company-tax-card" aria-label="Bedrijfsgegevens Softora"/);
  assert.match(pageSource, /KVK-nummer[\s\S]*93827504/);
  assert.match(pageSource, /Btw-identificatienummer[\s\S]*NL866541925B01/);
  assert.match(pageSource, /Omzetbelastingnummer[\s\S]*866541925B01/);
  assert.match(pageSource, /Aangiftetijdvak[\s\S]*kwartaal/);
  assert.match(pageSource, /\.bookkeeping-header\s*\{[\s\S]*justify-content:\s*space-between;/);
  assert.match(pageSource, /\.company-tax-card\s*\{[\s\S]*width:\s*min\(100%, 380px\);/);
});

test('premium boekhouding anchors deadlines to official upcoming ranges', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /var BTW_DEADLINE_COUNT = 35;/);
  assert.match(scriptSource, /var INCOME_TAX_DEADLINE_COUNT = 35;/);
  assert.match(scriptSource, /var BTW_START_YEAR = 2026;/);
  assert.match(scriptSource, /var INCOME_TAX_START_YEAR = 2025;/);
  assert.match(scriptSource, /function buildBtwAangiftes\(\)/);
  assert.match(scriptSource, /function buildIncomeTaxAangiftes\(\)/);
  assert.match(scriptSource, /year = clampYear\(year\);/);
  assert.match(scriptSource, /function changeYear\(delta\) \{\s*year = clampYear\(year \+ delta\);\s*renderList\(\);\s*\}/);
  assert.match(scriptSource, /return Number\(String\(a\.deadline\)\.slice\(0, 4\)\) === y;/);
});

test('premium boekhouding bewaart gedeelde invoer via Supabase ui-state', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /premium-ui-state-client\.js/);
  assert.match(scriptSource, /var REMOTE_UI_STATE_SCOPE = "premium_bookkeeping";/);
  assert.match(scriptSource, /getUiStateClient\(\)\.get\(REMOTE_UI_STATE_SCOPE\)/);
  assert.match(scriptSource, /getUiStateClient\(\)\.set\(REMOTE_UI_STATE_SCOPE/);
  assert.match(scriptSource, /source: "premium-boekhouding"/);
  assert.doesNotMatch(scriptSource, /fetchUiStateGet/);
  assert.doesNotMatch(scriptSource, /fetchUiStateSet/);
  assert.doesNotMatch(pageSource + scriptSource, /localStorage/);
  assert.doesNotMatch(pageSource + scriptSource, /sessionStorage/);
});

test('premium boekhouding houdt gedrag uit inline handlers', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(scriptSource, /onclick=/);
  assert.match(scriptSource, /data-bookkeeping-action=\\"open-map\\"/);
  assert.match(scriptSource, /data-bookkeeping-action=\\"toggle-check\\"/);
  assert.match(scriptSource, /data-bookkeeping-action=\\"open-file\\"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
});
