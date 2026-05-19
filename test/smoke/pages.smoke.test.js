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

test('page smoke: /premium-website serves the homepage without redirecting back to root', async () => {
  const response = await fetch(`${serverRef.baseUrl}/premium-website`, {
    cache: 'no-store',
    redirect: 'manual',
  });
  const html = await response.text();

  assert.equal(response.status, 200, '/premium-website');
  assert.equal(response.headers.get('location'), null, '/premium-website mag geen redirect-loop starten.');
  assert.match(html, /<!DOCTYPE html>/i, '/premium-website moet HTML serveren.');
  assert.match(html, /Websites die overtuigen/, 'Homepage-marker ontbreekt op /premium-website.');
});

const publicSeoLegacyRedirectTargets = [
  { from: '/premium-bedrijfssoftware', to: '/bedrijfssoftware-op-maat' },
  { from: '/premium-voicesoftware', to: '/voicesoftware-op-maat' },
  { from: '/premium-chatbot', to: '/chatbot-laten-maken' },
  { from: '/premium-websites', to: '/website-laten-maken' },
  { from: '/premium-pakketten', to: '/pakketten' },
  { from: '/premium-over-softora', to: '/over-softora' },
  { from: '/premium-algemene-voorwaarden', to: '/algemene-voorwaarden' },
  { from: '/premium-privacy-policy', to: '/privacybeleid' },
];

for (const target of publicSeoLegacyRedirectTargets) {
  test(`page smoke: ${target.from} redirects to clean SEO URL`, async () => {
    const response = await fetch(`${serverRef.baseUrl}${target.from}`, {
      cache: 'no-store',
      redirect: 'manual',
    });
    const location = response.headers.get('location') || '';

    assert.equal(response.status, 301, target.from);
    assert.ok(
      location === target.to || location === `${serverRef.baseUrl}${target.to}`,
      `Redirect voor ${target.from} ging naar ${location}`
    );
  });
}

test('page smoke: /premium-blog redirects to the public blog foundation', async () => {
  const response = await fetch(`${serverRef.baseUrl}/premium-blog`, {
    cache: 'no-store',
    redirect: 'manual',
  });
  const location = response.headers.get('location') || '';

  assert.equal(response.status, 301, '/premium-blog');
  assert.ok(location === '/blog' || location === `${serverRef.baseUrl}/blog`, `Redirect ging naar ${location}`);
});

test('page smoke: public blog article is crawlable HTML', async () => {
  const response = await fetch(`${serverRef.baseUrl}/blog/ai-automatisering-mkb-waar-beginnen`, {
    cache: 'no-store',
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /AI automatisering voor het MKB: waar begin je\?/);
  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/blog\/ai-automatisering-mkb-waar-beginnen">/);
  assert.match(html, /data-softora-public-seo="structured-data"/);
});

test('page smoke: public kennisbank article is crawlable HTML', async () => {
  const response = await fetch(`${serverRef.baseUrl}/kennisbank/wat-is-bedrijfssoftware-op-maat`, {
    cache: 'no-store',
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /Wat is bedrijfssoftware op maat\?/);
  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/kennisbank\/wat-is-bedrijfssoftware-op-maat">/);
  assert.match(html, /data-softora-public-seo="structured-data"/);
});

test('page smoke: /favicon.ico serves the Softora favicon', async () => {
  const response = await fetch(`${serverRef.baseUrl}/favicon.ico`, { cache: 'no-store' });
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200, '/favicon.ico');
  assert.ok(response.url.endsWith('/assets/softora-favicon-round.png?v=20260513a'));
  assert.match(response.headers.get('content-type') || '', /^image\/png\b/);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
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
      /assets\/personnel-theme\.js\?v=20260519b/,
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

test('page smoke: premium-ai-coldmailing.html keeps personal assignment filter off the leads page', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-ai-coldmailing.html'), 'utf8');
  assert.doesNotMatch(html, /assets\/premium-personal-assignment-filter\.css/, 'Persoonlijke toewijzingsstijl hoort niet op leads.');
  assert.doesNotMatch(html, /assets\/premium-personal-assignment-filter\.js/, 'Persoonlijke toewijzingsscript hoort niet op leads.');
  assert.doesNotMatch(html, /onlyMyAssignmentsLeadsToggle/, 'Leads-toggle hoort weg te zijn.');
  assert.doesNotMatch(html, /Enkel mijn toewijzingen bekijken/, 'Leads-toggle label hoort weg te zijn.');
  assert.doesNotMatch(html, /assets\/premium-personal-assignment-pages\.js/, 'Leads pagina-asset voor persoonlijke toewijzingen hoort weg te zijn.');
});

test('page smoke: premium-actieve-opdrachten.html shows openstaande leads as the primary tab label', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-actieve-opdrachten.html'), 'utf8');
  const script = fs.readFileSync(path.join(repoRoot, 'assets/premium-actieve-opdrachten.js'), 'utf8');
  const assignmentFilterScript = fs.readFileSync(path.join(repoRoot, 'assets/premium-personal-assignment-filter.js'), 'utf8');
  const assignmentPagesScript = fs.readFileSync(path.join(repoRoot, 'assets/premium-personal-assignment-pages.js'), 'utf8');
  const openLeadsScript = fs.readFileSync(path.join(repoRoot, 'assets/premium-active-order-open-leads.js'), 'utf8');
  const manualLeadsScript = fs.readFileSync(path.join(repoRoot, 'assets/premium-active-order-manual-open-leads.js'), 'utf8');
  const source = `${html}\n${assignmentFilterScript}\n${script}\n${openLeadsScript}\n${manualLeadsScript}\n${assignmentPagesScript}`;
  assert.doesNotMatch(html, /data-order-filter="open"/, 'Openstaande opdrachten-tab hoort niet meer zichtbaar te zijn.');
  assert.match(html, /data-order-filter="open_leads"/, 'Openstaande leads-tab hoort zichtbaar te zijn.');
  assert.match(html, /assets\/premium-personal-assignment-filter\.css\?v=20260511a/, 'Persoonlijke toewijzingsstijl ontbreekt op opdrachten.');
  assert.match(html, /assets\/premium-personal-assignment-filter\.js\?v=20260510a/, 'Persoonlijke toewijzingsscript ontbreekt op opdrachten.');
  assert.match(html, /id="onlyMyAssignmentsToggle" data-only-my-assignments-toggle type="checkbox"/, 'Opdrachten-toggle ontbreekt.');
  assert.match(html, /assets\/premium-active-order-open-leads\.js\?v=20260518a/, 'Openstaande leads asset ontbreekt.');
  assert.match(html, /assets\/premium-active-order-manual-open-leads\.js\?v=20260519a/, 'Handmatige openstaande leads asset ontbreekt.');
  assert.match(html, /assets\/premium-personal-assignment-pages\.js\?v=20260510a/, 'Opdrachten pagina-asset voor persoonlijke toewijzingen ontbreekt.');
  assert.match(manualLeadsScript, /overlay\.id = 'createChoiceModal';/, 'Keuzemodal voor aanmaken ontbreekt.');
  assert.match(manualLeadsScript, /form\.id = 'createOpenLeadForm';/, 'Handmatige openstaande-lead form ontbreekt.');
  assert.match(html, /<button class="topbar-btn magnetic" type="button" id="createOrderBtn">[\s\S]*?Aanmaken[\s\S]*?<\/button>/, 'Aanmaken-knop hoort neutraal te zijn.');
  const createButtonHtml = html.match(/<button class="topbar-btn magnetic" type="button" id="createOrderBtn">[\s\S]*?<\/button>/)?.[0] || '';
  assert.doesNotMatch(createButtonHtml, /<svg\b/, 'Aanmaken-knop hoort geen plus-icoon meer te tonen.');
  assert.doesNotMatch(createButtonHtml, /Aanmaken[\s\S]*Aanmaken/, 'Aanmaken-knop mag het label niet dubbel tonen.');
  assert.match(manualLeadsScript, /button\.replaceChildren\(document\.createTextNode\('Aanmaken'\)\);/, 'Script moet het label naar één enkele tekst resetten.');
  assert.doesNotMatch(createButtonHtml, /Actieve Opdracht Aanmaken/, 'Topknop mag niet meer alleen actieve opdracht noemen.');
  assert.match(html, />Openstaande leads<\/span>/, 'Primaire tab hoort Openstaande leads te tonen.');
  assert.doesNotMatch(source, /href = '\/premium-leads';/, 'Openstaande leads mag niet naar de leads-pagina linken.');
  assert.match(html, />Openstaande opdrachten<\/span>/, 'Primaire tab hoort Openstaande opdrachten te tonen.');
  assert.match(source, /Geen openstaande leads\./, 'Lege-state hoort bij de openstaande leads-tab te passen.');
  assert.match(source, /Geen openstaande opdrachten\./, 'Lege-state hoort bij de nieuwe tablabel te passen.');
  assert.match(source, /Geen openstaande opdrachten aan jou toegewezen\./, 'Persoonlijke lege-state voor opdrachten ontbreekt.');
  assert.match(source, /let activeOrderFilter = 'open_leads';/, 'Standaardfilter hoort op openstaande leads te staan.');
  assert.match(source, /card\.dataset\.orderFilterGroup = 'open_leads';/, 'Openstaande lead-kaarten horen onder de open-leads filter te vallen.');
  assert.match(manualLeadsScript, /softora_manual_open_leads_v1/, 'Handmatige openstaande leads moeten persistent zijn.');
  assert.match(manualLeadsScript, /openCreateModal,/, 'Openstaande lead aanmaken moet vanaf de keuzeknop open kunnen.');
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

test('page smoke: /papertrader serves the papertrading demo', async () => {
  const response = await fetch(`${serverRef.baseUrl}/papertrader`, { cache: 'no-store' });
  const html = await response.text();
  const script = fs.readFileSync(path.join(repoRoot, 'assets/papertrader.js'), 'utf8');

  assert.equal(response.status, 200, '/papertrader');
  assert.match(html, /<!DOCTYPE html>/i, '/papertrader moet HTML serveren.');
  assert.match(html, /Softora PaperTrader/, 'PaperTrader titel ontbreekt.');
  assert.match(html, /assets\/papertrader\.css\?v=20260505e/, 'PaperTrader stylesheet ontbreekt.');
  assert.match(html, /assets\/papertrader\.js\?v=20260505e/, 'PaperTrader script ontbreekt.');
  assert.doesNotMatch(script, /localStorage|sessionStorage/, 'PaperTrader mag geen browser-opslag gebruiken.');
  assert.match(script, /api\.coingecko\.com\/api\/v3\/coins\//, 'PaperTrader moet echte CoinGecko-marktdata gebruiken.');
  assert.match(script, /COST_PER_TURNOVER/, 'PaperTrader moet kosten/slippage in de backtest meenemen.');
  assert.match(script, /START_EQUITY = 1/, 'PaperTrader hoort de een-euro missie expliciet te testen.');
  assert.match(script, /MAX_ALLOCATION = 0\.5/, 'PaperTrader moet kapitaal beschermen met een maximale allocatie.');
  assert.match(script, /MIN_EDGE_SCORE_TO_TRADE/, 'PaperTrader moet een minimale edge-score bewaken voordat traden interessant is.');
});
