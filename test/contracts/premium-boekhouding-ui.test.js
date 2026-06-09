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

  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260605a"><\/script>\s*<script src="assets\/premium-bookkeeping\.js\?v=20260427a"><\/script>/);
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
  assert.match(pageSource, /Aangiftetijdvak[\s\S]*Kwartaal/);
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
  assert.doesNotMatch(scriptSource, /data-bookkeeping-action=\\"open-map\\"/);
  assert.doesNotMatch(scriptSource, /aangifte-row[\s\S]{0,140}role=\\"button\\" tabindex=\\"0\\"/);
  assert.doesNotMatch(scriptSource, /case "open-map":/);
  assert.match(scriptSource, /data-bookkeeping-action=\\"toggle-check\\"/);
  assert.match(scriptSource, /data-bookkeeping-action=\\"open-file\\"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
});

test('premium boekhouding houdt aangiftebalken passief en deadline-kleuren neutraal', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const rowCss = pageSource.match(/\.aangifte-row\s*\{[\s\S]*?\}/);

  assert.ok(rowCss, 'Aangifte-rij styling moet aanwezig zijn');
  assert.match(rowCss[0], /grid-template-columns:\s*40px 1fr 100px 160px 110px;/);
  assert.doesNotMatch(rowCss[0], /cursor:\s*pointer;/);
  assert.doesNotMatch(pageSource, /\.aangifte-row:hover/);
  assert.doesNotMatch(pageSource, /\.aangifte-row\.urgent/);
  assert.doesNotMatch(pageSource, /\.aangifte-row\.soon/);
  assert.doesNotMatch(pageSource, /\.arrow-cell/);
  assert.match(pageSource, /\.badge-urgent,\s*[\s\S]*\.badge-soon,\s*[\s\S]*\.badge-future\s*\{[\s\S]*color:\s*var\(--light\);/);

  assert.match(scriptSource, /if \(days < 0\) return \{ cls: "badge-urgent", txt: "Verlopen" \};/);
  assert.match(scriptSource, /return \{ cls: "badge-future", txt: "Nog " \+ days \+ " dagen" \};/);
  assert.match(scriptSource, /function rowClass\(id, deadline\) \{\s*var e = entry\(id\);\s*if \(e\.checked\) return "done";\s*return "";\s*\}/);
  assert.match(scriptSource, /return "<div class=\\"aangifte-row " \+ escapeHtml\(rowClass\(a\.id, a\.deadline\)\) \+ "\\">"/);
  assert.match(scriptSource, /"<div class=\\"dl-date\\">" \+ escapeHtml\(fmtDate\(a\.deadline\)\) \+ "<\/div>"/);
  assert.doesNotMatch(scriptSource, /var dlColor/);
  assert.doesNotMatch(scriptSource, /style=\\"color:/);
});
