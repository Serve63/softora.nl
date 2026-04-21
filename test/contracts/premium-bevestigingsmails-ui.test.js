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
  assert.match(pageSource, /<div class="panel-zone-label">Zone 1<\/div>/);
  assert.match(pageSource, /<div class="panel-zone-title">Mail verstuurd<\/div>/);
  assert.match(pageSource, /<div class="panel-zone-label">Zone 4<\/div>/);
  assert.match(pageSource, /<div class="panel-zone-title">Afspraak ingepland<\/div>/);
  assert.match(pageSource, /<div class="generator-grid">[\s\S]*?<div class="panel-zone-strip"[\s\S]*?<\/div>\s*<div class="panel"/);
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

  assert.match(pageSource, /<span class="topbar-select-label">Geschatte coldcalling kosten<\/span>/);
  assert.match(pageSource, /<div class="topbar-cost-group" data-retell-cost-root>/);
  assert.match(pageSource, /<div class="topbar-cost-value" data-retell-cost-value>€0,00<\/div>/);
  assert.match(pageSource, /<script src="assets\/retell-cost-widget\.js\?v=20260417a" defer><\/script>/);
  assert.doesNotMatch(pageSource, /topbar-cost-dot/);
  assert.doesNotMatch(pageSource, /data-retell-cost-meta/);
  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
});

test('premium bevestigingsmails is directly accessible without coming-soon lock styling', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const themePath = path.join(__dirname, '../../assets/personnel-theme.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const themeSource = fs.readFileSync(themePath, 'utf8');
  const comingSoonKeysMatch = themeSource.match(
    /const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[([\s\S]*?)\]\);/
  );

  assert.doesNotMatch(pageSource, /content-lock-overlay/);
  assert.doesNotMatch(pageSource, /unlockContentArea\(/);
  assert.doesNotMatch(pageSource, /Binnenkort beschikbaar/);
  assert.ok(comingSoonKeysMatch);
  assert.doesNotMatch(comingSoonKeysMatch[1], /"coldmailing"/);
  assert.match(themeSource, /key: "coldmailing"/);
});

test('premium bevestigingsmails renders the zone cards as a separate strip above the settings panel', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /\.generator-grid\s*\{[\s\S]*gap:\s*1\.25rem;/);
  assert.match(pageSource, /\.generator-grid > \.panel-zone-strip\s*\{[\s\S]*padding:\s*0;/);
  assert.doesNotMatch(pageSource, /\.generator-grid > \.panel\s*\{[\s\S]*border-top:\s*none;/);
});

test('premium bevestigingsmails gebruikt Campagne afronden als eindlabel van de tijdlijn', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /'Campagne afronden'/);
  assert.doesNotMatch(pageSource, /Terug naar overzicht/);
});
