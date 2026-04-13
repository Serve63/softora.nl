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
  assert.match(pageSource, /id="statCalled"/);
  assert.match(pageSource, /id="statBooked"/);
  assert.match(pageSource, /id="statInterested"/);
  assert.match(pageSource, /id="statConversion"/);
  assert.doesNotMatch(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
});
