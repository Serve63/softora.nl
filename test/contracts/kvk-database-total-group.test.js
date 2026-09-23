const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '../..');

function readPage() {
  return fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
}

function readMetricsCss() {
  return fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.css'), 'utf8');
}

test('kvk inventory and research totals keep their own ordered panels', () => {
  const html = readPage();
  const inventory = html.slice(html.indexOf('<section class="inventory"'), html.indexOf('<section class="research-details"'));
  const research = html.slice(html.indexOf('<section class="research-details"'), html.indexOf('<section class="planning-details"'));
  for (const id of ['companies-usable', 'companies-with-website', 'companies-without-website']) {
    assert.ok(inventory.includes(`id="${id}"`), `voorraad bevat ${id}`);
    assert.ok(!research.includes(`id="${id}"`), `onderzoek bevat ${id} niet`);
  }
  for (const id of ['companies-total', 'companies-treated', 'companies-successful-found', 'companies-control-room', 'companies-declared-unusable']) {
    assert.ok(research.includes(`id="${id}"`), `onderzoek bevat ${id}`);
    assert.ok(!inventory.includes(`id="${id}"`), `voorraad bevat ${id} niet`);
  }
});

test('kvk totaalgroep gebruikt paars, vier kolommen en hetzelfde responsieve gedrag', () => {
  const css = readMetricsCss();
  assert.match(css, /\.stat-total-group\s*\{[^}]*grid-column:\s*span 4/);
  assert.match(css, /\.stat-total-group\s*\{[^}]*repeat\(4/);
  assert.match(css, /\.stat-total-group\s*\{[^}]*142,\s*47,\s*95/);
  assert.match(css, /\.stat-total-group-label\s*\{[^}]*color:\s*var\(--accent\)/);
});

test('kvk totaalgroep geeft elke kaart dezelfde paarse rand als de groene kaarten', () => {
  const css = readMetricsCss();
  assert.match(
    css,
    /\.stat-total-group > \.stat-card\s*\{\s*border-color:\s*rgba\(142,\s*47,\s*95,\s*0\.72\);?\s*\}/
  );
  assert.match(
    readPage(),
    /kvk-database-metrics\.css\?v=20260917-control-orange/
  );
});

test('kvk database gives the control room card its own orange border', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.css'), 'utf8');

  assert.match(html, /class="stat-card stat-card-control-room stat-card-decision stat-card-directory kvk-stat-card-enhanced"/);
  assert.match(
    css,
    /\.stat-card-control-room\s*\{\s*border-color:\s*rgba\(196,\s*106,\s*34,\s*0\.72\);?\s*\}/
  );
});
