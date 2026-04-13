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
