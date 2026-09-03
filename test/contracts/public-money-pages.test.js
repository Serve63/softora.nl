const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INDEXABLE_PUBLIC_SEO_PAGES } = require('../../server/services/public-seo');

const root = path.join(__dirname, '../..');

function readPage(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function countVisibleWords(htmlRaw) {
  return String(htmlRaw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function getRegistryEntry(fileName) {
  return INDEXABLE_PUBLIC_SEO_PAGES.find((entry) => entry.fileName === fileName);
}

function getStructuredDataGraph(htmlRaw) {
  const match = String(htmlRaw || '').match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*data-softora-public-seo=["']structured-data["'][^>]*>([\s\S]*?)<\/script>/i
  );
  assert.ok(match, 'Pagina mist expliciete structured data.');
  const data = JSON.parse(match[1]);
  assert.equal(data['@context'], 'https://schema.org');
  return Array.isArray(data['@graph']) ? data['@graph'] : [];
}

const PUBLIC_ROADMAP_COPY_PATTERNS = [
  /De contentlaag krijgt straks/i,
  /Volgende contentblokken/i,
  /SEO-machine/i,
  /moeten niet los zweven/i,
  /pillar pages/i,
  /Tools en scans/i,
  /Kennis en verdieping/i,
  /Verder lezen per onderwerp/i,
  /Kennisbankuitleg/i,
  /Artikelen over kosten, keuzes/i,
  /Logische vervolgstappen/i,
];

test('public SEO pages do not expose internal roadmap copy', () => {
  for (const entry of INDEXABLE_PUBLIC_SEO_PAGES) {
    const source = readPage(entry.fileName);
    for (const pattern of PUBLIC_ROADMAP_COPY_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${entry.fileName} bevat interne roadmap-taal`);
    }
  }
});

test('diensten page uses customer-facing service guidance copy', () => {
  const source = readPage('diensten.html');

  assert.match(source, /<h1>Digitale diensten die verkeer omzetten in leads<\/h1>/);
  assert.match(source, /<h2>Snel zien welke digitale stap het meeste oplevert<\/h2>/);
  assert.match(source, /Waar we samen naar kijken/);
  assert.match(source, /Welke dienst levert het snelst merkbare waarde op/);
  assert.match(source, /href="\/website-laten-maken"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);
});

test('website money page is focused on SEO, leads and clean internal links', () => {
  const source = readPage('premium-websites.html');
  const entry = getRegistryEntry('premium-websites.html');

  assert.match(source, /<title>Website laten maken voor meer aanvragen \| Softora<\/title>/);
  assert.match(source, /<h1 class="hero-title">Een website <br><em>voor meer aanvragen<\/em><\/h1>/);
  assert.match(source, /SEO-vriendelijke website/);
  assert.match(source, /Conversiegerichte landingspagina's/);
  assert.match(source, /Contentstructuur/);
  assert.match(source, /Google Search Console/);
  assert.match(source, /Waar let je op bij een website laten maken\?/);
  assert.match(source, /Wat kost een website laten maken\?/);
  assert.match(source, /Welke pagina's heb je nodig\?/);
  assert.match(source, /Wat gebeurt er met nieuwe leads\?/);
  assert.match(source, /href="\/blog\/website-laten-maken-kosten-2026"/);
  assert.match(source, /href="\/blog\/website-laten-maken-mkb-paginas"/);
  assert.match(source, /href="\/kennisbank\/wat-is-een-conversiegerichte-website"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/pakketten"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/website-laten-maken-oisterwijk"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /Bedrijfsdashboards|Klantenportalen|Personeelssystemen/);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'Website laten maken voor meer aanvragen');
  assert.match(entry.description, /SEO-vriendelijke website/);
  assert.ok(entry.relatedLinks.includes('/website-laten-maken-oisterwijk'));
  assert.ok(entry.relatedLinks.includes('/blog/website-laten-maken-mkb-paginas'));
  assert.ok(entry.relatedLinks.includes('/kennisbank/wat-is-een-conversiegerichte-website'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/pakketten'));
});

test('bedrijfssoftware overtuigingspagina maakt tijdverlies en de maatwerkoplossing concreet', () => {
  const source = readPage('bedrijfssoftware.html');
  const entry = getRegistryEntry('premium-bedrijfssoftware.html');

  assert.match(source, /<title>Bedrijfssoftware die voor je werkt \| Softora<\/title>/);
  assert.match(
    source,
    /<meta name="description" content="Ontdek hoe maatwerksoftware administratieve taken, dubbel werk en onnodige omwegen binnen je bedrijf kan verminderen\./
  );
  assert.match(source, /<meta name="robots" content="noindex, follow">/);
  assert.match(source, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/bedrijfssoftware">/);
  assert.match(source, /<meta property="og:url" content="https:\/\/www\.softora\.nl\/bedrijfssoftware">/);
  assert.match(source, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(source, /Bedrijfssoftware op maat die <em>voor je werkt\.<\/em>/);
  assert.match(source, /administratieve taken en repetitieve taken/);
  assert.match(source, /tijd krijgt voor wat echt telt/);
  assert.match(source, /Meer tijd/);
  assert.match(source, /Minder handmatig werk/);
  assert.match(source, /Meer rust en overzicht/);
  assert.match(source, /class="proof proof-values"/);
  assert.match(source, /class="button button-phone" href="https:\/\/wa\.me\/31643262792"/);
  assert.match(source, />Contact<\/a>/);
  assert.match(source, /\.hero:after\{/);
  assert.match(source, /background-size:auto,28px 28px/);
  assert.match(source, /Werk dat simpel zou moeten zijn, voelt onnodig omslachtig/);
  assert.match(source, /Je voert dezelfde gegevens meerdere keren in/);
  assert.match(source, /Je houdt open taken zelf bij/);
  assert.match(source, /Je schakelt steeds tussen verschillende systemen/);
  assert.match(source, /Je controleert handmatig of alles goed gaat/);
  assert.match(source, /Niet alles tegelijk\. Eerst één proces slimmer maken/);
  assert.match(source, /class="approach-layout"/);
  assert.match(source, /We brengen je werkproces en systemen in kaart/);
  assert.match(source, /We bepalen welke knelpunten er zijn/);
  assert.match(source, /De oplossing wordt in de praktijk getest/);
  assert.doesNotMatch(source, /We beginnen niet met een standaardpakket of een lange lijst functies/);
  assert.match(source, /Tijd voor wat echt telt/);
  assert.match(source, /Minder repetitief werk/);
  assert.match(source, /Meer rust en overzicht/);
  assert.match(source, /Meer tijd om te ondernemen/);
  assert.match(source, /softora-time-that-matters\.webp/);
  assert.match(source, /<nav id="navbar">/);
  assert.match(source, /class="nav-start-btn"[^>]*>Start Project<\/a>/);
  assert.match(source, /<footer id="contact" class="footer">/);
  assert.match(source, /class="footer-personnel-link" href="\/personeel-login">Personeel<\/a>/);
  assert.doesNotMatch(source, /Wanneer is maatwerksoftware interessant\?/);
  assert.doesNotMatch(source, /id="voor-wie"/);
  assert.match(source, /Samen kijken welke taken slimmer en makkelijker kunnen/);
  assert.match(source, /Plan een gesprek/);
  assert.match(source, /Wat kost maatwerksoftware\?/);
  assert.match(source, /Moet ik al precies weten wat ik nodig heb\?/);
  assert.match(source, /Kunnen bestaande systemen gekoppeld worden\?/);
  assert.match(source, /Waar beginnen we\?/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/maatwerk-platform"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/kennisbank\/wat-is-offerte-automatisering"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/blog\/bedrijfssoftware-laten-maken-kosten"/);
  assert.match(source, /href="\/blog\/maatwerk-software-offerte-beoordelen"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.match(source, /\.problem-cards\{grid-template-columns:repeat\(2,1fr\)\}/);
  assert.match(source, /\.cards,\.problem-cards,\.faq-grid\{grid-template-columns:1fr\}/);
  assert.match(source, /min-height:44px/);
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(source, /class="strip/);
  assert.doesNotMatch(source, /Je bent ondernemer\. Geen menselijke koppeling\./);
  assert.doesNotMatch(source, /Website Tool|AI Website Generator/);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);
  assert.ok(source.indexOf('Herken je deze situaties?') < source.indexOf('Zo pakken we het aan'));
  assert.ok(source.indexOf('Zo pakken we het aan') < source.indexOf('Dit levert het op'));
  assert.ok(source.indexOf('Dit levert het op') < source.indexOf('Samen kijken wat makkelijker kan'));
  assert.ok(source.indexOf('Samen kijken wat makkelijker kan') < source.indexOf('Veelgestelde vragen'));
  assert.match(source, /data-step="01">Herken je deze situaties\?<\/div>/);
  assert.match(source, /data-step="04">Samen kijken wat makkelijker kan<\/div>/);

  assert.equal(entry.title, 'Bedrijfssoftware laten maken: aanpak voor MKB');
  assert.match(entry.description, /kernproces, de eerste versie, rollen, koppelingen en acceptatie/);
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
  assert.ok(entry.relatedLinks.includes('/kennisbank/wat-is-offerte-automatisering'));

  const graph = getStructuredDataGraph(source);
  const service = graph.find((item) => item['@type'] === 'Service');
  const faq = graph.find((item) => item['@type'] === 'FAQPage');
  const breadcrumb = graph.find((item) => item['@type'] === 'BreadcrumbList');

  assert.equal(service && service['@id'], 'https://www.softora.nl/bedrijfssoftware#service');
  assert.equal(service && service.serviceType, 'Bedrijfssoftware op maat voor MKB');
  assert.equal(faq && faq['@id'], 'https://www.softora.nl/bedrijfssoftware#faq');
  assert.deepEqual(
    faq.mainEntity.map((question) => question.name),
    [
      'Wat kost maatwerksoftware?',
      'Moet ik al precies weten wat ik nodig heb?',
      'Kunnen bestaande systemen gekoppeld worden?',
      'Waar beginnen we?',
    ]
  );
  assert.equal(breadcrumb && breadcrumb['@id'], 'https://www.softora.nl/bedrijfssoftware#breadcrumb');
});

test('crm money page is focused on pipeline, customers and AI follow-up', () => {
  const source = readPage('crm-systeem-op-maat.html');
  const entry = getRegistryEntry('crm-systeem-op-maat.html');

  assert.match(source, /<title>CRM op maat laten bouwen voor MKB \| Softora<\/title>/);
  assert.match(source, /<meta name="description" content="Laat een maatwerk CRM bouwen voor sales pipeline/);
  assert.match(source, /<meta name="robots" content="index, follow">/);
  assert.match(source, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/crm-systeem-op-maat">/);
  assert.match(source, /<meta property="og:url" content="https:\/\/www\.softora\.nl\/crm-systeem-op-maat">/);
  assert.match(source, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(source, /<h1>CRM op maat laten bouwen voor sales pipeline en offertes<\/h1>/);
  assert.match(source, /Leadpipeline/);
  assert.match(source, /Klantbeheer/);
  assert.match(source, /CRM offerte systeem/);
  assert.match(source, /Klantportaal laten maken/);
  assert.match(source, /Dashboard laten ontwikkelen/);
  assert.match(source, /Wanneer maatwerk CRM sterker is dan extra losse tools/);
  assert.match(source, /CRM systeem laten maken/);
  assert.match(source, /CRM laten bouwen met offertebeheer/);
  assert.match(source, /CRM software laten maken die kan meegroeien/);
  assert.match(source, /Reminders en taken/);
  assert.match(source, /AI-samenvattingen/);
  assert.match(source, /Dashboards/);
  assert.match(source, /CRM op maat laten bouwen begint met scherpe scope/);
  assert.match(source, /Wat bepaalt de kosten\?/);
  assert.match(source, /Hoe lang duurt een eerste versie\?/);
  assert.match(source, /Hoe blijft klantdata bruikbaar\?/);
  assert.match(source, /Blijft het knelpunt bij leads, offertes en klantopvolging/);
  assert.match(source, /planning, uitvoering, klantportaal, projectdata of andere afdelingen/);
  assert.match(source, /<a href="\/bedrijfssoftware-op-maat">bedrijfssoftware laat maken<\/a>/);
  assert.match(source, /CRM op maat of standaard CRM\?/);
  assert.match(source, /Wanneer kies je voor een CRM op maat\?/);
  assert.match(source, /Welke modules zijn logisch\?/);
  assert.match(source, /Wat bepaalt de kosten van CRM op maat\?/);
  assert.match(source, /Hoe lang duurt CRM software laten maken\?/);
  assert.match(source, /Moet alles meteen worden gebouwd\?/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/kennisbank\/wat-is-een-sales-pipeline-crm"/);
  assert.match(source, /href="\/kennisbank\/wat-is-crm-datakwaliteit"/);
  assert.match(source, /href="\/vergelijkingen\/crm-op-maat-vs-standaard-crm"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'CRM op maat laten bouwen voor MKB');
  assert.match(entry.description, /maatwerk CRM/);
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
  assert.equal(entry.lastmod, '2026-08-28');
  assert.equal(entry.growthEventKind, 'other_growth_action');

  const graph = getStructuredDataGraph(source);
  const service = graph.find((item) => item['@type'] === 'Service');
  const faq = graph.find((item) => item['@type'] === 'FAQPage');
  const breadcrumb = graph.find((item) => item['@type'] === 'BreadcrumbList');

  assert.equal(service && service['@id'], 'https://www.softora.nl/crm-systeem-op-maat#service');
  assert.equal(service && service.serviceType, 'CRM systeem op maat voor MKB');
  assert.equal(faq && faq['@id'], 'https://www.softora.nl/crm-systeem-op-maat#faq');
  assert.deepEqual(
    faq.mainEntity.map((question) => question.name),
    [
      'Wanneer kies je voor een CRM systeem op maat in plaats van standaard CRM?',
      'Welke CRM modules kan Softora bouwen?',
      'Wat bepaalt de kosten van CRM op maat laten bouwen?',
      'Hoe lang duurt een eerste CRM versie?',
      'Hoe blijft CRM data veilig en bruikbaar?',
      'Moet alles meteen in een CRM op maat?',
    ]
  );
  assert.equal(breadcrumb && breadcrumb['@id'], 'https://www.softora.nl/crm-systeem-op-maat#breadcrumb');
});

test('ai automation money page is focused on leads, CRM flows and safe handoff', () => {
  const source = readPage('ai-automatisering.html');
  const entry = getRegistryEntry('ai-automatisering.html');

  assert.match(source, /<title>AI automatisering laten maken voor MKB \| Softora<\/title>/);
  assert.match(
    source,
    /<meta name="description" content="Laat AI automatisering maken voor leadopvolging, processen automatiseren met AI/
  );
  assert.match(source, /<meta name="robots" content="index, follow">/);
  assert.match(source, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/ai-automatisering">/);
  assert.match(source, /<meta property="og:url" content="https:\/\/www\.softora\.nl\/ai-automatisering">/);
  assert.match(source, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(source, /<h1>AI automatisering voor leads, taken en opvolging<\/h1>/);
  assert.match(source, /Leadopvolging/);
  assert.match(source, /Intake en mailbox/);
  assert.match(source, /CRM-flows/);
  assert.match(source, /Rapportages/);
  assert.match(source, /Chatbot-overdracht/);
  assert.match(source, /voice-overdracht/);
  assert.match(source, /Menselijke controle/);
  assert.match(source, /Veilige AI grenzen/);
  assert.match(source, /Is dit proces klaar voor AI automatisering\?/);
  assert.match(source, /Controlepunten voor een eerste AI-workflow/);
  assert.match(source, /Acceptatievoorbeelden voor goed, fout en doorzetten naar een mens/);
  assert.match(source, /Test de workflow op echte uitzonderingen/);
  assert.match(source, /Nog niet live als/);
  assert.match(source, /Waar AI automatisering voor MKB direct verschil kan maken/);
  assert.match(source, /Wanneer is AI automatisering beter dan standaard software\?/);
  assert.match(source, /AI automatisering, CRM of chatbot\?/);
  assert.match(source, /Veelgestelde vragen over AI automatisering/);
  assert.match(source, /Kan AI automatisering koppelen met bestaande systemen\?/);
  assert.match(source, /Welke workflow is geschikt als eerste stap\?/);
  assert.match(source, /AI automatisering moet zichtbaar beter werken/);
  assert.match(source, /loading="eager" fetchpriority="high" decoding="async"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /href="\/ai-telefonist"/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(source, /href="\/blog\/ai-automatisering-leadopvolging"/);
  assert.match(source, /href="\/blog\/ai-automatisering-leadkwalificatie-mkb"/);
  assert.match(source, /href="\/blog\/ai-processen-automatiseren-zonder-controle-verliezen"/);
  assert.match(source, /href="\/kennisbank\/wat-is-leadkwalificatie"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.ok(countVisibleWords(source) >= 900, 'AI automatisering money page is nog te dun voor commerciële SEO.');
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'AI automatisering laten maken voor MKB');
  assert.equal(entry.lastmod, '2026-07-23');
  assert.match(entry.description, /leadopvolging, processen automatiseren met AI/);
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/blog/ai-automatisering-leadopvolging'));

  const graph = getStructuredDataGraph(source);
  const service = graph.find((item) => item['@type'] === 'Service');
  const faq = graph.find((item) => item['@type'] === 'FAQPage');
  const breadcrumb = graph.find((item) => item['@type'] === 'BreadcrumbList');

  assert.equal(service && service['@id'], 'https://www.softora.nl/ai-automatisering#service');
  assert.equal(service && service.serviceType, 'AI automatisering voor MKB');
  assert.equal(faq && faq['@id'], 'https://www.softora.nl/ai-automatisering#faq');
  assert.deepEqual(
    faq.mainEntity.map((question) => question.name),
    [
      'Waar begin je met AI automatisering?',
      'Kan AI automatisch klanten antwoorden?',
      'Moet mijn bedrijf al een CRM hebben?',
    ]
  );
  assert.equal(breadcrumb && breadcrumb['@id'], 'https://www.softora.nl/ai-automatisering#breadcrumb');
});

test('chatbot money page is focused on leads, support and clean follow-up', () => {
  const source = readPage('premium-chatbot.html');
  const entry = getRegistryEntry('premium-chatbot.html');

  assert.match(source, /<title>Chatbot laten maken voor leads en support \| Softora<\/title>/);
  assert.match(source, /<h1 class="hero-title">Chatbot <br><em>die leads opvangt<\/em><\/h1>/);
  assert.match(source, /Leadkwalificatie/);
  assert.match(source, /FAQ en support/);
  assert.match(source, /Offerte-intakebot/);
  assert.match(source, /AI kennisassistent/);
  assert.match(source, /Veilige AI grenzen/);
  assert.match(source, /href="\/website-laten-maken"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/ai-telefonist"/);
  assert.match(source, /href="\/blog\/chatbot-laten-maken-wanneer-zinvol"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(
    source,
    /Bedrijfsdashboards|Klantenportalen|Personeelssystemen|Personeel Dashboard|AI Website Generator|Offerte & Factuur Generator/
  );
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'Chatbot laten maken voor leads en support');
  assert.match(entry.description, /leads kwalificeert/);
  assert.ok(entry.relatedLinks.includes('/website-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-telefonist'));
});

test('ai telefonist money page answers comparison and follow-up intent', () => {
  const source = readPage('ai-telefonist.html');
  const entry = getRegistryEntry('ai-telefonist.html');

  assert.match(source, /<title>AI telefonist laten maken voor het MKB \| Softora<\/title>/);
  assert.match(source, /<meta name="description" content="Laat een AI telefonist maken door Softora/);
  assert.match(source, /Laat geen telefoontje meer zonder opvolging/);
  assert.match(source, /AI telefonist, voicemail of callcenter\?/);
  assert.match(source, /Wat moet een AI telefonist weten voordat hij opneemt\?/);
  assert.match(source, /Overdrachtsregels voor boze, gevoelige of onduidelijke gesprekken/);
  assert.match(source, /Bestemming van de samenvatting: CRM, mailbox, taak of dashboard/);
  assert.match(source, /Veelgestelde vragen over een AI telefonist/);
  assert.match(source, /Wat doet een AI telefonist na een gesprek\?/);
  assert.match(source, /Wanneer moet een mens het overnemen\?/);
  assert.match(source, /Past dit bij leadgeneratie voor MKB\?/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/kennisbank\/wat-is-een-ai-telefonist"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /€[0-9]|prijzen|goedkoper dan/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'AI telefonist laten maken voor het MKB');
  assert.match(entry.description, /leadkwalificatie, afspraakverzoeken en CRM-opvolging/);
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/kennisbank/wat-is-een-ai-telefonist'));
});

test('voicesoftware money page is focused on AI telefonie, intake and CRM follow-up', () => {
  const source = readPage('premium-voicesoftware.html');
  const entry = getRegistryEntry('premium-voicesoftware.html');

  assert.match(source, /<title>AI telefonie en voicesoftware op maat \| Softora<\/title>/);
  assert.match(
    source,
    /<meta name="description" content="Laat voicesoftware en AI telefonie op maat maken door Softora/
  );
  assert.match(source, /<h1 class="hero-title">Voicesoftware <br><em>die opvolging regelt<\/em><\/h1>/);
  assert.match(source, /AI telefonist/);
  assert.match(source, /Leadkwalificatie/);
  assert.match(source, /Afspraakintake/);
  assert.match(source, /Gesprekssamenvatting/);
  assert.match(source, /CRM-overdracht/);
  assert.match(source, /Veilige AI grenzen/);
  assert.match(source, /href="\/ai-telefonist"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'AI telefonie en voicesoftware op maat');
  assert.match(entry.description, /leadkwalificatie, afspraakintake, CRM-opvolging/);
  assert.ok(entry.relatedLinks.includes('/ai-telefonist'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
});

test('over softora page is customer-facing and explains the company clearly', () => {
  const source = readPage('premium-over-softora.html');
  const entry = getRegistryEntry('premium-over-softora.html');

  assert.match(source, /<title>Over Softora \| Websites, software en AI voor het MKB<\/title>/);
  assert.match(source, /\/assets\/seo-growth-pages\.css\?v=20260528a/);
  assert.match(source, /<h1>Digitale groei zonder ruis<\/h1>/);
  assert.match(source, /digitaal bouwbureau uit Oisterwijk/);
  assert.match(source, /meer aanvragen, slimmere processen en betere opvolging/);
  assert.match(source, /Van vindbaarheid naar opvolging/);
  assert.match(source, /Websites die aanvragen moeten opleveren/);
  assert.match(source, /Maatwerk software voor echte processen/);
  assert.match(source, /AI automatisering met menselijke controle/);
  assert.match(source, /softora-strategy-meeting\.jpg/);
  assert.match(source, /softora-website-wireframes\.jpg/);
  assert.match(source, /softora-crm-workflow\.jpg/);
  assert.match(source, /softora-chatbot-klantcontact\.jpg/);
  assert.match(source, /alt="Softora overleg over websites, software en AI automatisering"/);
  assert.match(source, /Martijn van de Ven/);
  assert.doesNotMatch(source, /Serv[eé]\s+Creusen/i);
  assert.match(source, /href="\/diensten"/);
  assert.match(source, /href="\/website-laten-maken"/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/blog"/);
  assert.match(source, /href="\/kennisbank"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /De contentlaag krijgt straks|Volgende contentblokken|SEO-machine/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'Over Softora | Websites, software en AI voor het MKB');
  assert.match(entry.description, /digitaal bouwbureau uit Oisterwijk/);
  assert.ok(entry.relatedLinks.includes('/website-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
});

test('packages page is focused on public sales routes and clean internal links', () => {
  const source = readPage('pakketten.html');
  const entry = getRegistryEntry('pakketten.html');

  assert.match(source, /<title>Softora pakketten voor websites, software en AI groei<\/title>/);
  assert.match(source, /<meta name="description" content="Bekijk Softora pakketten voor websites, bedrijfssoftware/);
  assert.match(source, /<h1>Pakketten voor bouwen, beheren en groeien<\/h1>/);
  assert.match(source, /Website route/);
  assert.match(source, /Software en CRM route/);
  assert.match(source, /AI groei route/);
  assert.match(source, /Doorontwikkelen/);
  assert.match(source, /href="\/website-laten-maken"/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /sidebar-link|premium-sidebar|personnel-theme/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);
  assert.doesNotMatch(source, /premium-personeel|premium-dashboard|admin-menu|admin-nav/i);

  assert.equal(entry.title, 'Softora pakketten voor websites, software en AI groei');
  assert.match(entry.description, /beheer en doorontwikkeling/);
  assert.ok(entry.relatedLinks.includes('/website-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
});
