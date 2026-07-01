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

  assert.match(pageSource, /<script src="assets\/premium-packages\.js\?v=20260701a"><\/script>/);
  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(pageSource, /data-package-tab="routes"/);
  assert.match(pageSource, /data-package-tab="website"/);
  assert.match(pageSource, /data-package-tab="bedrijfssoftware"/);
  assert.match(pageSource, /data-package-tab="voicesoftware"/);
  assert.match(pageSource, /data-package-tab="chatbots"/);
  assert.equal((pageSource.match(/class="tab [^"]*is-locked/g) || []).length, 3);
  assert.equal((pageSource.match(/class="tab-lock"/g) || []).length, 3);
  assert.match(pageSource, /data-package-tab="bedrijfssoftware"[^>]*data-package-tab-locked="true"[^>]*disabled[^>]*aria-disabled="true"/);
  assert.match(pageSource, /data-package-tab="voicesoftware"[^>]*data-package-tab-locked="true"[^>]*disabled[^>]*aria-disabled="true"/);
  assert.match(pageSource, /data-package-tab="chatbots"[^>]*data-package-tab-locked="true"[^>]*disabled[^>]*aria-disabled="true"/);
  assert.match(pageSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(scriptSource, /var packageTabGroups = \{/);
  assert.match(scriptSource, /var lockedPackageTabs = \{/);
  assert.match(scriptSource, /bedrijfssoftware: true/);
  assert.match(scriptSource, /voicesoftware: true/);
  assert.match(scriptSource, /chatbots: true/);
  assert.match(scriptSource, /function isLockedPackageTab\(name, tabEl\)/);
  assert.match(scriptSource, /if \(isLockedPackageTab\(name, tabEl\)\) return false;/);
  assert.doesNotMatch(pageSource, />Richtlijnen<\/button>/);
  assert.match(pageSource, /Website Richtlijnen/);
  assert.match(pageSource, /Kies de richtlijn die past bij jouw project/);
  assert.match(pageSource, /Richtlijn 1/);
  assert.match(pageSource, /One Page Website/);
  assert.match(pageSource, /Richtlijn 2/);
  assert.match(pageSource, /Website met pagina's &amp; tooltjes/);
  assert.match(pageSource, /Richtlijn 3/);
  assert.match(pageSource, /Website met veel pagina's/);
  assert.match(pageSource, /Richtlijn 4/);
  assert.match(pageSource, /Bedrijfssoftware op maat/);
  assert.doesNotMatch(pageSource, /<div class="card-badge">Flexibel<\/div>/);
  assert.doesNotMatch(pageSource, /id="tab-routes"/);
  assert.match(pageSource, /id="tab-bouwen" class="tab-panel theme-website active"/);
  assert.match(pageSource, /id="tab-onderhoud" class="tab-panel theme-website active"/);
  assert.doesNotMatch(pageSource, /Maandelijks opzegbaar/);
  assert.equal((pageSource.match(/Jaarlijks opzegbaar/g) || []).length, 9);
  assert.match(pageSource, /\.onderhoud-card \.features-list::before\s*\{[\s\S]*content:\s*"Realistische taken";/);
  assert.match(pageSource, /\.card-cta\s*\{[\s\S]*margin-top:\s*auto;/);
  assert.match(pageSource, /\.card\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/);
  assert.match(pageSource, /\.onderhoud-card\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/);
  assert.doesNotMatch(scriptSource, /routes: \["routes"\]/);
  assert.match(scriptSource, /website: \["bouwen", "onderhoud"\]/);
  assert.match(scriptSource, /bedrijfssoftware: \["bedrijfssoftware", "bedrijfssoftware-onderhoud"\]/);
  assert.match(scriptSource, /voicesoftware: \["voice-software", "voice-software-onderhoud"\]/);
  assert.match(scriptSource, /chatbots: \["chatbots", "chatbots-onderhoud"\]/);
  assert.match(scriptSource, /event\.target\.closest\("\[data-package-tab\]"\)/);
  assert.match(scriptSource, /function switchTab\(name, tabEl\)/);
  assert.match(scriptSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/);
});

test('website onderhoudspakketten tonen de aangeleverde foto-prijzen en taken', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-onderhoud"');
  const sectionEnd = pageSource.indexOf('<div id="tab-bedrijfssoftware"', sectionStart);
  const websiteMaintenanceSection = pageSource.slice(sectionStart, sectionEnd);

  assert.doesNotMatch(websiteMaintenanceSection, /5 uur per maand voor basisbeheer en kleine verbeteringen\./);
  assert.doesNotMatch(websiteMaintenanceSection, /10 uur per maand voor doorlopend beheer en zichtbare verbeteringen\./);
  assert.doesNotMatch(websiteMaintenanceSection, /15 uur per maand voor actief optimaliseren en sneller doorpakken\./);
  assert.doesNotMatch(websiteMaintenanceSection, /25 uur per maand voor intensief beheer, campagnes en doorontwikkeling\./);
  assert.match(websiteMaintenanceSection, /<div class="section-title">Website Onderhoud Pakketten<\/div>/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Onderhoud<\/div>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€37,95<span class="price-suffix">\/mnd<\/span><\/div>/);
  assert.match(websiteMaintenanceSection, /Technisch onderhoud van de website/);
  assert.match(websiteMaintenanceSection, /Updates en controle van de website/);
  assert.match(websiteMaintenanceSection, /Basiscontrole op veiligheid en werking/);
  assert.match(websiteMaintenanceSection, /Monitoring zodat alles goed blijft draaien/);
  assert.match(websiteMaintenanceSection, /<div class="card-badge">Aanbevolen<\/div>/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Onderhoud \+ Wijzigingen<\/div>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€74,95<span class="price-suffix">\/mnd<\/span><\/div>/);
  assert.match(websiteMaintenanceSection, /Alles uit pakket 1 inbegrepen/);
  assert.match(websiteMaintenanceSection, /Tekstwijzigingen op de website/);
  assert.match(websiteMaintenanceSection, /Afbeeldingen vervangen of toevoegen/);
  assert.match(websiteMaintenanceSection, /Aanpassingen aan bestaande pagina's/);
  assert.match(websiteMaintenanceSection, /Extra support bij vragen of verbeteringen/);
  assert.match(websiteMaintenanceSection, /<div class="card-name">Continue Aanpassingen<\/div>/);
  assert.match(websiteMaintenanceSection, /<div class="price-amount">€497,-<span class="price-suffix">\/mnd<\/span><\/div>/);
  assert.match(websiteMaintenanceSection, /Alles uit pakket 2 inbegrepen/);
  assert.match(websiteMaintenanceSection, /Onbeperkte tekstwijzigingen/);
  assert.match(websiteMaintenanceSection, /Onbeperkte aanpassingen op de website/);
  assert.match(websiteMaintenanceSection, /Nieuwe pagina's toevoegen/);
  assert.match(websiteMaintenanceSection, /Prioriteit en snelle doorlooptijd/);
  assert.match(websiteMaintenanceSection, /Proactieve optimalisaties en verbeteringen/);
  assert.doesNotMatch(websiteMaintenanceSection, /€89<span class="price-suffix">\/mnd/);
  assert.doesNotMatch(websiteMaintenanceSection, /€199<span class="price-suffix">\/mnd/);
  assert.doesNotMatch(websiteMaintenanceSection, /€329<span class="price-suffix">\/mnd/);
  assert.doesNotMatch(websiteMaintenanceSection, /€649<span class="price-suffix">\/mnd/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Basis<\/div>/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Plus<\/div>/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Enterprise<\/div>/);
  assert.doesNotMatch(websiteMaintenanceSection, /uur p\/m · Excl\. BTW/);
  assert.doesNotMatch(websiteMaintenanceSection, /<div class="card-name">Pro<\/div>/);
});

test('website richtlijnen tonen de vier keuzes van de Softora richtprijskaart', () => {
  const pageSource = readPage();
  const sectionStart = pageSource.indexOf('<div id="tab-bouwen"');
  const sectionEnd = pageSource.indexOf('<div id="tab-onderhoud"', sectionStart);
  const guidelinesSection = pageSource.slice(sectionStart, sectionEnd);

  assert.equal((guidelinesSection.match(/class="route-card guideline-card"/g) || []).length, 4);
  assert.match(guidelinesSection, /<div class="section-title">Website Richtlijnen<\/div>/);
  assert.match(guidelinesSection, /Elke website is maatwerk en wordt volledig afgestemd op jouw doelen\./);
  assert.match(guidelinesSection, /<div class="guideline-number">01<\/div>[\s\S]*<div class="card-tier">Richtlijn 1<\/div>[\s\S]*<div class="route-title">One Page Website<\/div>[\s\S]*<div class="price-amount">€850,-<\/div>/);
  assert.match(guidelinesSection, /<div class="guideline-number">02<\/div>[\s\S]*<div class="card-tier">Richtlijn 2<\/div>[\s\S]*<div class="route-title">Website met pagina's &amp; tooltjes<\/div>[\s\S]*<div class="price-amount">€1\.350,-<\/div>/);
  assert.match(guidelinesSection, /<div class="guideline-number">03<\/div>[\s\S]*<div class="card-tier">Richtlijn 3<\/div>[\s\S]*<div class="route-title">Website met veel pagina's<\/div>[\s\S]*<div class="price-amount">€2\.250,-<\/div>/);
  assert.match(guidelinesSection, /<div class="guideline-number">04<\/div>[\s\S]*<div class="card-tier">Richtlijn 4<\/div>[\s\S]*<div class="route-title">Bedrijfssoftware op maat<\/div>[\s\S]*<div class="price-amount">€3\.500,-<\/div>/);
  assert.equal((guidelinesSection.match(/Richtprijs excl\. BTW/g) || []).length, 4);
  assert.doesNotMatch(guidelinesSection, /Losse oplevering/);
  assert.doesNotMatch(guidelinesSection, /Losse oplevering mét CMS/);
  assert.doesNotMatch(guidelinesSection, /Softora Volledig beheer/);
  assert.doesNotMatch(guidelinesSection, /database-hosting-note/);
  assert.doesNotMatch(pageSource, /Website Bouw Pakketten/);
  assert.doesNotMatch(pageSource, /<div class="card-tier">Pakket 01<\/div>[\s\S]*<div class="card-name">Starter<\/div>/);
});

test('pakketkaarten gebruiken interne Softora CTA labels', () => {
  const pageSource = readPage();
  const websiteBuildStart = pageSource.indexOf('<div id="tab-bouwen"');
  const websiteBuildEnd = pageSource.indexOf('<div id="tab-onderhoud"', websiteBuildStart);
  const websiteBuildSection = pageSource.slice(websiteBuildStart, websiteBuildEnd);
  const ctaLabels = Array.from(
    pageSource.matchAll(/<button class="card-cta(?![^"]*is-locked)[^"]*" type="button">([^<]+)<\/button>/g),
    (match) => match[1].trim()
  );

  assert.equal(ctaLabels.length, 27);
  assert.deepEqual([...new Set(ctaLabels)], ['Softora']);
  assert.equal((pageSource.match(/class="card-cta[^"]*is-locked/g) || []).length, 0);
  assert.equal((websiteBuildSection.match(/<button class="card-cta[^"]*" type="button">Softora<\/button>/g) || []).length, 0);
  assert.doesNotMatch(websiteBuildSection, /is-locked/);
  assert.doesNotMatch(websiteBuildSection, /disabled/);
  assert.doesNotMatch(pageSource, />Tijdelijk vergrendeld</);
  assert.doesNotMatch(websiteBuildSection, /€749,-/);
  assert.match(websiteBuildSection, /€1\.350,-/);
  assert.doesNotMatch(
    pageSource,
    />\s*(?:Pakket Aanvragen|Pakket aanvragen|Meer Informatie|Meer informatie|Selecteren|Offerte Aanvragen|Offerte aanvragen|Contact Opnemen|Contact opnemen)\s*</
  );
});
