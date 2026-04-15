const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium bevestigingsmails mirrors lead-generator shell without coldcalling dashboard bootstrap', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
  assert.match(pageSource, /Geen coldcalling-dashboard/);
  assert.match(
    pageSource,
    /<a href="\/premium-bevestigingsmails" class="sidebar-link magnetic active" data-sidebar-key="coldmailing"/
  );
  assert.match(pageSource, /<div class="generator-grid">/);
  assert.match(pageSource, /<span class="panel-title">Coldmailing Instellingen<\/span>/);
  assert.match(pageSource, /<button class="launch-btn magnetic" id="launchBtn" onclick="toggleCampaign\(\)">/);
  assert.match(pageSource, /id="statSent"/);
  assert.match(pageSource, /id="statOpened"/);
  assert.match(pageSource, /id="statInterested"/);
  assert.match(pageSource, /id="statLead"/);
  assert.match(pageSource, /id="statConversion"/);
  assert.match(pageSource, />Lead<\/div>/);
  assert.doesNotMatch(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
});

test('premium bevestigingsmails shows the shared Retell cost counter without loading the coldcalling dashboard asset', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<span class="topbar-select-label">Totale kosten coldcalling<\/span>/);
  assert.match(pageSource, /<div class="topbar-cost-group" data-retell-cost-root>/);
  assert.match(pageSource, /<div class="topbar-cost-value" data-retell-cost-value>€0,00<\/div>/);
  assert.match(pageSource, /<script src="assets\/retell-cost-widget\.js\?v=20260415b" defer><\/script>/);
  assert.doesNotMatch(pageSource, /topbar-cost-dot/);
  assert.doesNotMatch(pageSource, /data-retell-cost-meta/);
  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
});
