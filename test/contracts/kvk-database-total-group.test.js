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

test('kvk totalen staan samen in een paarse groep met label', () => {
  const html = readPage();
  const openIndex = html.indexOf('<div class="stat-total-group"');
  assert.ok(openIndex >= 0, 'totaalgroep aanwezig');
  assert.match(
    html,
    /<p id="stat-total-group-label" class="stat-total-group-label">Alles bij elkaar<\/p>/
  );
  const closeIndex = html.indexOf(
    '<article class="stat-card stat-card-control-room',
    openIndex
  );
  assert.ok(closeIndex > openIndex, 'totaalgroep sluit voor de controlekamer');
  const group = html.slice(openIndex, closeIndex);
  for (const id of [
    'companies-total-card',
    'companies-treated-open',
    'companies-successful-found-open',
    'companies-declared-unusable-open',
  ]) {
    assert.ok(group.includes(id), `totaalgroep bevat ${id}`);
  }
  assert.ok(!group.includes('companies-control-room-open'), 'controlekamer blijft buiten de groep');
});

test('kvk totaalgroep gebruikt paars, vier kolommen en hetzelfde responsieve gedrag', () => {
  const css = readMetricsCss();
  assert.match(css, /\.stat-total-group\s*\{[^}]*grid-column:\s*span 4/);
  assert.match(css, /\.stat-total-group\s*\{[^}]*repeat\(4/);
  assert.match(css, /\.stat-total-group\s*\{[^}]*142,\s*47,\s*95/);
  assert.match(css, /\.stat-total-group-label\s*\{[^}]*color:\s*var\(--accent\)/);
});
