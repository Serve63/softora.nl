const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('../testlib/server-process');
const { pageSmokeTargets } = require('../../server/routes/manifest');

let serverRef = null;

test.before(async () => {
  serverRef = await startTestServer();
});

test.after(async () => {
  if (serverRef) {
    await serverRef.stop();
  }
});

for (const target of pageSmokeTargets) {
  test(`page smoke: ${target.path}`, async () => {
    const response = await fetch(`${serverRef.baseUrl}${target.path}`, { cache: 'no-store' });
    const html = await response.text();
    assert.equal(response.status, 200, target.path);
    assert.match(html, /<!DOCTYPE html>/i, target.path);
    const matchesPrimaryMarker = html.includes(target.marker);
    const matchesLoginFallback = target.allowLoginFallback && html.includes('Softora | Personeel Login');
    assert.ok(
      matchesPrimaryMarker || matchesLoginFallback,
      `Marker ontbreekt voor ${target.path}: ${target.marker}`
    );
  });
}

const repoRoot = path.resolve(__dirname, '..', '..');
const unifiedPersonnelThemeTargets = [
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-actieve-opdrachten.html',
  'premium-websitegenerator.html',
  'premium-personeel-dashboard.html',
];

for (const filePath of unifiedPersonnelThemeTargets) {
  test(`page smoke: ${filePath} uses unified personnel theme cache key`, () => {
    const html = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
    assert.match(
      html,
      /assets\/personnel-theme\.js\?v=20260413d/,
      `Theme cache key mismatch for ${filePath}`
    );
  });
}

test('page smoke: premium-ai-coldmailing.html keeps pending lead removals visible until shared persist completes', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-ai-coldmailing.html'), 'utf8');
  assert.match(html, /removeLeadResult\?\.persistencePending/, 'Pending removal branch ontbreekt.');
  assert.match(
    html,
    /Leadverwijdering wordt nog verwerkt\. De lead blijft zichtbaar tot dit overal is opgeslagen\./,
    'Pending removal status ontbreekt.'
  );
});

test('page smoke: premium-actieve-opdrachten.html defaults to in behandeling without an open tab', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-actieve-opdrachten.html'), 'utf8');
  assert.doesNotMatch(html, /data-order-filter="open"/, 'Openstaande opdrachten-tab hoort niet meer zichtbaar te zijn.');
  assert.match(html, /let activeOrderFilter = 'in_progress';/, 'Standaardfilter hoort op in behandeling te staan.');
});
