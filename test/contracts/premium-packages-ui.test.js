const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../../premium-pakketten.html');
const scriptPath = path.join(__dirname, '../../assets/premium-packages.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

test('premium pakketten gebruikt een asset voor tabgedrag', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /<script src="assets\/premium-packages\.js\?v=20260427a"><\/script>/);
  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.match(pageSource, /data-package-tab="routes"/);
  assert.match(pageSource, /data-package-tab="website"/);
  assert.match(pageSource, /data-package-tab="bedrijfssoftware"/);
  assert.match(pageSource, /data-package-tab="voicesoftware"/);
  assert.match(pageSource, /data-package-tab="chatbots"/);
  assert.match(pageSource, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(scriptSource, /var packageTabGroups = \{/);
  assert.match(pageSource, /Losse oplevering/);
  assert.match(pageSource, /Losse oplevering mét CRM/);
  assert.match(pageSource, /Softora Volledig beheer/);
  assert.match(pageSource, /<div class="card-badge">Aanbevolen<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="card-badge">Flexibel<\/div>/);
  assert.match(pageSource, /id="tab-routes" class="tab-panel theme-routes active"/);
  assert.match(pageSource, /id="tab-bouwen" class="tab-panel theme-website"/);
  assert.match(pageSource, /id="tab-onderhoud" class="tab-panel theme-website"/);
  assert.doesNotMatch(pageSource, /id="tab-onderhoud" class="tab-panel theme-website active"/);
  assert.match(scriptSource, /routes: \["routes"\]/);
  assert.match(scriptSource, /website: \["bouwen", "onderhoud"\]/);
  assert.match(scriptSource, /bedrijfssoftware: \["bedrijfssoftware", "bedrijfssoftware-onderhoud"\]/);
  assert.match(scriptSource, /voicesoftware: \["voice-software", "voice-software-onderhoud"\]/);
  assert.match(scriptSource, /chatbots: \["chatbots", "chatbots-onderhoud"\]/);
  assert.match(scriptSource, /event\.target\.closest\("\[data-package-tab\]"\)/);
  assert.match(scriptSource, /function switchTab\(name, tabEl\)/);
  assert.match(scriptSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/);
});

test('website onderhoudspakketten tonen vaste uren per maand met taakvoorbeelden', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-onderhoud"');
  const sectionEnd = pageSource.indexOf('<div id="tab-bedrijfssoftware"', sectionStart);
  const websiteMaintenanceSection = pageSource.slice(sectionStart, sectionEnd);

  assert.match(websiteMaintenanceSection, /<div class="card-name">Basis<\/div>[\s\S]*5 uur per maand voor basisbeheer/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Plus<\/div>[\s\S]*10 uur per maand voor doorlopend beheer/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Premium<\/div>[\s\S]*15 uur per maand voor actief optimaliseren/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Enterprise<\/div>[\s\S]*25 uur per maand voor intensief beheer/);
  assert.match(websiteMaintenanceSection, /Updates, backups en monitoring/);
  assert.match(websiteMaintenanceSection, /Kleine tekst- en fotowijzigingen/);
  assert.match(websiteMaintenanceSection, /Nieuwe secties, acties of pagina-updates/);
  assert.match(websiteMaintenanceSection, /SEO, snelheid en conversie verbeteren/);
  assert.match(websiteMaintenanceSection, /Campagnepagina's, funnels en grotere uitbreidingen/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Pro<\/div>/);
  assert.doesNotMatch(websiteMaintenanceSection, /Onbeperkte aanpassingen/);
});

test('website routes tonen aangescherpte oplevering en beheer voorwaarden', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-routes"');
  const sectionEnd = pageSource.indexOf('<div id="tab-bouwen"', sectionStart);
  const routesSection = pageSource.slice(sectionStart, sectionEnd);

  assert.match(
    routesSection,
    /Softora ontwikkelt en levert de website volledig gebruiksklaar op\. Na oplevering is het project afgerond en zijn wijzigingen uitgesloten, tenzij er aantoonbare gebreken vanuit Softora zijn\./
  );
  assert.match(
    routesSection,
    /Softora ontwikkelt de website met een eigen CRM-\/beheersysteem\. Minimaal €200 extra voor tekst- en fotobeheer\. Extra wijzigingsopties zijn mogelijk maar verhogen de prijs\./
  );
  assert.match(
    routesSection,
    /Softora ontwikkelt en beheert de website, inclusief monitoring, updates en beveiliging\. Wijzigingen voert Softora op aanvraag uit binnen het onderhoudspakket, zodat de klant technisch volledig wordt ontzorgd\./
  );
  assert.doesNotMatch(routesSection, /Softora maakt de website en levert hem volledig af/);
  assert.doesNotMatch(routesSection, /Wij bouwen de website met een eigen beheersysteem/);
  assert.doesNotMatch(routesSection, /Wij maken de website, houden hem in beheer/);
  assert.doesNotMatch(routesSection, /route-price-note/);
  assert.doesNotMatch(routesSection, /Geen maandbedrag via Softora/);
  assert.doesNotMatch(routesSection, /CRM vanaf €200 eenmalig/);
  assert.doesNotMatch(routesSection, /Minimaal €30 per maand/);
});
