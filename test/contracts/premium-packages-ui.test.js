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
  assert.match(pageSource, /Losse oplevering mét CMS/);
  assert.match(pageSource, /Softora Volledig beheer/);
  assert.match(pageSource, /<div class="card-badge">Aanbevolen<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="card-badge">Flexibel<\/div>/);
  assert.match(pageSource, /id="tab-routes" class="tab-panel theme-routes active"/);
  assert.match(pageSource, /id="tab-bouwen" class="tab-panel theme-website"/);
  assert.match(pageSource, /id="tab-onderhoud" class="tab-panel theme-website"/);
  assert.doesNotMatch(pageSource, /id="tab-onderhoud" class="tab-panel theme-website active"/);
  assert.doesNotMatch(pageSource, /Maandelijks opzegbaar/);
  assert.equal((pageSource.match(/Jaarlijks opzegbaar/g) || []).length, 12);
  assert.match(pageSource, /\.onderhoud-card \.features-list::before\s*\{[\s\S]*content:\s*"Realistische taken";/);
  assert.match(scriptSource, /routes: \["routes"\]/);
  assert.match(scriptSource, /website: \["bouwen", "onderhoud"\]/);
  assert.match(scriptSource, /bedrijfssoftware: \["bedrijfssoftware", "bedrijfssoftware-onderhoud"\]/);
  assert.match(scriptSource, /voicesoftware: \["voice-software", "voice-software-onderhoud"\]/);
  assert.match(scriptSource, /chatbots: \["chatbots", "chatbots-onderhoud"\]/);
  assert.match(scriptSource, /event\.target\.closest\("\[data-package-tab\]"\)/);
  assert.match(scriptSource, /function switchTab\(name, tabEl\)/);
  assert.match(scriptSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/);
});

test('website onderhoudspakketten tonen vaste uren per maand met taakvoorbeelden zonder losse kaartintro', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-onderhoud"');
  const sectionEnd = pageSource.indexOf('<div id="tab-bedrijfssoftware"', sectionStart);
  const websiteMaintenanceSection = pageSource.slice(sectionStart, sectionEnd);

  assert.doesNotMatch(websiteMaintenanceSection, /5 uur per maand voor basisbeheer en kleine verbeteringen\./);
  assert.doesNotMatch(websiteMaintenanceSection, /10 uur per maand voor doorlopend beheer en zichtbare verbeteringen\./);
  assert.doesNotMatch(websiteMaintenanceSection, /15 uur per maand voor actief optimaliseren en sneller doorpakken\./);
  assert.doesNotMatch(websiteMaintenanceSection, /25 uur per maand voor intensief beheer, campagnes en doorontwikkeling\./);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€89<span class="price-suffix">\/mnd<\/span><\/div><span class="price-hours">· 1 uur\/mnd<\/span>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€199<span class="price-suffix">\/mnd<\/span><\/div><span class="price-hours">· 3 uur\/mnd<\/span>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€329<span class="price-suffix">\/mnd<\/span><\/div><span class="price-hours">· 5 uur\/mnd<\/span>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€649<span class="price-suffix">\/mnd<\/span><\/div><span class="price-hours">· 10 uur\/mnd<\/span>/);
  assert.match(websiteMaintenanceSection, /Updates, backups en monitoring/);
  assert.match(websiteMaintenanceSection, /Kleine tekst- en fotowijzigingen/);
  assert.match(websiteMaintenanceSection, /Nieuwe secties, acties of pagina-updates/);
  assert.match(websiteMaintenanceSection, /SEO, snelheid en conversie verbeteren/);
  assert.match(websiteMaintenanceSection, /Campagnepagina's, funnels en grotere uitbreidingen/);
  assert.doesNotMatch(websiteMaintenanceSection, /uur p\/m · Excl\. BTW/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Pro<\/div>/);
  assert.doesNotMatch(websiteMaintenanceSection, /Onbeperkte aanpassingen/);
});

test('website routes tonen aangescherpte oplevering en beheer voorwaarden', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-routes"');
  const sectionEnd = pageSource.indexOf('<div id="tab-bouwen"', sectionStart);
  const routesSection = pageSource.slice(sectionStart, sectionEnd);
  const route02Start = routesSection.indexOf('<div class="route-card"><div class="card-tier">Route 02');
  const route03Start = routesSection.indexOf('<div class="route-card featured">');
  const databaseNoteStart = routesSection.indexOf('<div class="database-hosting-note">');

  assert.match(
    routesSection,
    /Softora ontwikkelt en levert de website volledig gebruiksklaar op\. Na oplevering is het project afgerond en zijn wijzigingen uitgesloten, tenzij er aantoonbare gebreken vanuit Softora zijn\./
  );
  assert.match(
    routesSection,
    /Softora ontwikkelt de website met een eigen CMS-\/beheersysteem\. Minimaal €200 extra voor tekst- en fotobeheer\. Extra wijzigingsopties zijn mogelijk maar verhogen de prijs\./
  );
  assert.match(
    routesSection,
    /Elke database wordt gehost via Softora\.nl\. De kosten voor uitsluitend databasehosting bedragen €15 per maand\./
  );
  assert.ok(route02Start >= 0, 'Route 02 staat in de routes-sectie');
  assert.ok(route03Start > route02Start, 'Route 03 staat na Route 02');
  assert.ok(databaseNoteStart > route03Start, 'De databasehosting-melding staat onder de drie routekaarten');
  assert.doesNotMatch(routesSection.slice(route02Start, route03Start), /database-hosting-note/);
  assert.match(pageSource, /\.database-hosting-note \{ grid-column: 1 \/ -1;/);
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

test('pakketkaarten gebruiken interne Softora CTA labels', () => {
  const pageSource = readPage();
  const ctaLabels = Array.from(
    pageSource.matchAll(/<button class="card-cta(?![^"]*is-locked)[^"]*" type="button">([^<]+)<\/button>/g),
    (match) => match[1].trim()
  );

  assert.equal(ctaLabels.length, 29);
  assert.deepEqual([...new Set(ctaLabels)], ['Softora']);
  assert.equal((pageSource.match(/class="card-cta[^"]*is-locked/g) || []).length, 3);
  assert.match(pageSource, /€749,-/);
  assert.match(pageSource, /€1\.350,-/);
  assert.doesNotMatch(
    pageSource,
    />\s*(?:Pakket Aanvragen|Pakket aanvragen|Meer Informatie|Meer informatie|Selecteren|Offerte Aanvragen|Offerte aanvragen|Contact Opnemen|Contact opnemen)\s*</
  );
});
