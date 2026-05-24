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

test('page smoke: /ai-telefonist exposes the low-touch voice offer', async () => {
  const response = await fetch(`${serverRef.baseUrl}/ai-telefonist`, { cache: 'no-store' });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /AI-telefonist voor het MKB/);
  assert.match(html, /Start zonder gesprek/);
  assert.match(html, /€349 per maand/);
  assert.match(html, /250 klanten met gemiddeld €333 per maand/);
});

test('page smoke: /cinematic-office-demo serves the isolated cinematic prototype', async () => {
  const response = await fetch(`${serverRef.baseUrl}/cinematic-office-demo`, { cache: 'no-store' });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Softora Cinematic Office Demo/);
  assert.match(html, /assets\/cinematic-office-panorama-360\.png/);
  assert.match(html, /assets\/cinematic-office-demo\.css\?v=20260525e/);
  assert.match(html, /assets\/vendor\/motion-12\.39\.0\.js\?v=12\.39\.0/);
  assert.match(html, /assets\/cinematic-office-demo\.js\?v=20260525e/);
  assert.match(html, /class="scene-photo scene-photo-back"/);
  assert.match(html, /class="scene-photo scene-photo-main"/);
  assert.match(html, /class="scene-photo scene-photo-detail"/);
  assert.match(html, /class="light-sweep"/);
  assert.match(html, /class="focus-frame"/);
  assert.match(html, /class="letterbox letterbox-top"/);
  assert.match(html, /Los gebouwd\. Niks aan bestaande pagina's vast\./);
});

const repoRoot = path.resolve(__dirname, '..', '..');
const unifiedPersonnelThemeTargets = [
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-actieve-opdrachten.html',
  'premium-websitegenerator.html',
  'premium-personeel-dashboard.html',
];

const premiumSidebarThemeVersionTargets = [
  'premium-actieve-opdrachten.html',
  'premium-advertenties.html',
  'premium-analytics.html',
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-bevestigingsmails.html',
  'premium-boekhouding.html',
  'premium-database.html',
  'premium-instellingen-personeel.html',
  'premium-instellingen.html',
  'premium-kladblok.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-opdracht-dossier.html',
  'premium-pakketten.html',
  'premium-pdfs.html',
  'premium-personeel-agenda.html',
  'premium-personeel-dashboard.html',
  'premium-seo-crm-system.html',
  'premium-seo.html',
  'premium-socialmedia.html',
  'premium-vaste-lasten.html',
  'premium-wachtwoordenregister.html',
  'premium-websitegenerator.html',
  'premium-websitepreview.html',
  'premium-word.html',
];

for (const filePath of unifiedPersonnelThemeTargets) {
  test(`page smoke: ${filePath} uses unified personnel theme cache key`, () => {
    const html = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
    assert.match(
      html,
      /assets\/personnel-theme\.js\?v=[^"'\\s]+/,
      `Theme cache key mismatch for ${filePath}`
    );
  });
}

test('page smoke: premium sidebar pages pin the refreshed personnel theme script version', () => {
  for (const filePath of premiumSidebarThemeVersionTargets) {
    const html = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
    assert.match(
      html,
      /assets\/personnel-theme\.js\?v=20260427b/,
      `Nieuwe sidebar scriptversie ontbreekt voor ${filePath}`
    );
  }
});

test('page smoke: premium-website.html uses the current WhatsApp number', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-website.html'), 'utf8');
  assert.match(html, /https:\/\/wa\.me\/31643262792/, 'WhatsApp-link hoort naar het actuele nummer te wijzen.');
  assert.match(html, /Open WhatsApp chat met Softora op \+31 6 43 26 27 92/, 'WhatsApp-label mist het actuele nummer.');
});

test('page smoke: premium-website.html handles missing cursor elements safely', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-website.html'), 'utf8');
  assert.match(
    html,
    /safelySetStyle\(cursor, "display", "none"\);/,
    'Premium homepage moet cursor-elementen defensief wegzetten.'
  );
  assert.doesNotMatch(
    html,
    /cursor\\.style\\.display =/,
    'Cursorstijl mag niet meer direct zonder veiligheidsguard gezet worden.'
  );
  assert.doesNotMatch(
    html,
    /cursorDot\\.style\\.display =/,
    'Cursor-dot stijl mag niet meer direct zonder veiligheidsguard gezet worden.'
  );
});

test('page smoke: premium-pakketten.html shows the current Premium package price', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-pakketten.html'), 'utf8');
  assert.match(
    html,
    /<div class="card-name">Premium<\/div>[^]*?<div class="price-amount">€2\.495/,
    'Premium websitepakket hoort op €2.495 te staan.'
  );
  assert.match(
    html,
    /<div class="card-name">Flow<\/div>[^]*?<div class="price-amount">€2\.999/,
    'Flow pakketprijs hoort niet mee te wijzigen met het websitepakket.'
  );
});

test('page smoke: premium-website.html keeps mobile werkwijze background white', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-website.html'), 'utf8');
  assert.match(html, /\.ios-statusbar-fill/, 'iOS statusbar-fill klasse ontbreekt.');
  assert.match(html, /#werkwijze \{[^]*?background:\s*#ffffff !important;/, 'Werkwijze sectie moet mobile-compatibel wit zijn.');
  assert.match(html, /#werkwijze \.werkwijze-copy \{[^]*?background:\s*#ffffff !important;/, 'Werkwijze copy-kaart moet mobile wit zijn.');
  assert.match(html, /#werkwijze \.werkwijze-grid,/ , 'Werkwijze grid wit-regel hoort aanwezig te zijn.');
});

test('page smoke: premium-website.html routes non-widget CTA buttons to contact form on desktop', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-website.html'), 'utf8');
  assert.match(html, /const ctaLinks = Array\.from\(document\.querySelectorAll\('a\[href\^="https:\/\/wa\.me\/"\]/, 'CTA WA-links routing setup ontbreekt.');
  assert.match(html, /const desktopOnlyContactFormId = "#faq-contact-form";/, 'Desktop contact-form target id ontbreekt.');
  assert.match(html, /syncCtaLinksForViewport\(\);/, 'Desktop/mobile CTA sync aanroep ontbreekt.');
  assert.match(html, /window\.addEventListener\("resize", syncCtaLinksForViewport/, 'Resize-resync voor CTA routing ontbreekt.');
  assert.match(html, /\.filter\(function \(link\) {\s*return !link\.closest\(\"\.whatsapp-widget\"\);/s, 'WhatsApp widget mag niet mee-gewijzigd worden.');
});

test('page smoke: premium-personeel-login.html has a password visibility toggle', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-personeel-login.html'), 'utf8');
  assert.match(html, /id="passwordToggle"/, 'Wachtwoord-oogknop ontbreekt.');
  assert.match(html, /aria-label="Wachtwoord tonen"/, 'Wachtwoord-oogknop mist toegankelijk label.');
  assert.match(html, /function setupPasswordToggle\(\)/, 'Wachtwoord toggle-script ontbreekt.');
  assert.match(html, /password\.type = visible \? 'text' : 'password';/, 'Wachtwoordveld hoort zichtbaar/onzichtbaar te kunnen wisselen.');
  assert.match(html, /setupPasswordToggle\(\);/, 'Wachtwoord toggle wordt niet geinitialiseerd.');
});

test('page smoke: premium-ai-coldmailing.html promotes suppression after lead removal regardless of persistence state', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-ai-coldmailing.html'), 'utf8');
  assert.match(html, /promoteLeadRowSuppression\(lead\)/, 'Lead suppression promotion na verwijdering ontbreekt.');
  assert.doesNotMatch(
    html,
    /Leadverwijdering wordt nog verwerkt\. De lead blijft zichtbaar tot dit overal is opgeslagen\./,
    'Oude pending-rollback melding hoort niet meer voor te komen.'
  );
});

test('page smoke: premium-actieve-opdrachten.html shows openstaande leads as the primary tab label', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-actieve-opdrachten.html'), 'utf8');
  const script = fs.readFileSync(path.join(repoRoot, 'assets/premium-actieve-opdrachten.js'), 'utf8');
  const source = `${html}\n${script}`;
  assert.match(html, /data-order-filter="open_leads"/, 'Openstaande leads-tab hoort zichtbaar te zijn.');
  assert.match(html, />Openstaande leads<\/span>/, 'Primaire tab hoort Openstaande leads te tonen.');
  assert.match(html, />Openstaande opdrachten<\/span>/, 'Primaire tab hoort Openstaande opdrachten te tonen.');
  assert.match(source, /Geen openstaande leads\./, 'Lege-state hoort bij de openstaande leads-tab te passen.');
  assert.match(source, /Geen openstaande opdrachten\./, 'Lege-state hoort bij de nieuwe tablabel te passen.');
  assert.match(source, /let activeOrderFilter = 'open_leads';/, 'Standaardfilter hoort op openstaande leads te staan.');
});

test('page smoke: assets/personnel-theme.js persists sidebar counts across premium page loads', () => {
  const js = fs.readFileSync(path.join(repoRoot, 'assets/personnel-theme.js'), 'utf8');
  assert.match(js, /softora_sidebar_counts_v1/, 'Persistente sidebar-count cache ontbreekt.');
  assert.match(js, /paintSidebarCount\("active_orders", cachedActiveOrdersCount/, 'Actieve opdrachten hoort direct uit cache te kunnen schilderen.');
  assert.match(js, /paintSidebarCount\("agenda", cachedAgendaCount/, 'Agenda hoort direct uit cache te kunnen schilderen.');
  assert.match(js, /paintSidebarCount\("leads", cachedLeadCount/, 'Leads hoort direct uit cache te kunnen schilderen.');
});

test('page smoke: premium-bevestigingsmails.html shows the five coldmailing KPI labels', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-bevestigingsmails.html'), 'utf8');
  assert.match(html, />Totaal verzonden<\/div>/, 'Totaal verzonden ontbreekt.');
  assert.match(html, />Geopend<\/div>/, 'Geopend ontbreekt.');
  assert.doesNotMatch(html, />Gereageerd<\/div>/, 'Gereageerd hoort niet meer zichtbaar te zijn.');
  assert.match(html, />Interesse<\/div>/, 'Interesse ontbreekt.');
  assert.match(html, />Lead<\/div>/, 'Lead ontbreekt.');
  assert.match(html, />Conversie<\/div>/, 'Conversie ontbreekt.');
  assert.doesNotMatch(html, /<div class="zones-row">/, 'Zone-kaarten horen niet meer zichtbaar te zijn.');
  assert.doesNotMatch(html, /<div class="zone-card z1"/);
  assert.doesNotMatch(html, /<div class="zone-card z2"/);
  assert.doesNotMatch(html, /<div class="zone-card z4"/);
  assert.doesNotMatch(html, /<div class="zone-card z5"/);
  assert.doesNotMatch(html, /<div class="zone-card conv-card"/);
});

test('page smoke: premium-mailbox compose modal is centered and enlarged', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-mailbox.html'), 'utf8');
  assert.match(html, /\.compose-overlay \{[^}]*align-items:\s*center;/, 'Compose overlay moet verticaal gecentreerd staan.');
  assert.match(html, /\.compose-overlay \{[^}]*justify-content:\s*center;/, 'Compose overlay moet horizontaal gecentreerd staan.');
  assert.match(
    html,
    /\.compose-box \{[^}]*width:\s*min\(1040px, calc\(100vw - 28px\)\);/,
    'Compose box moet verbreed zijn.'
  );
  assert.match(
    html,
    /\.compose-box \{[^}]*min-height:\s*min\(90vh, 700px\);/,
    'Compose box moet groter in hoogte staan.'
  );
});
