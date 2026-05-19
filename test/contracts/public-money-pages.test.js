const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INDEXABLE_PUBLIC_SEO_PAGES } = require('../../server/services/public-seo');

const root = path.join(__dirname, '../..');

function readPage(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function getRegistryEntry(fileName) {
  return INDEXABLE_PUBLIC_SEO_PAGES.find((entry) => entry.fileName === fileName);
}

test('website money page is focused on SEO, leads and clean internal links', () => {
  const source = readPage('premium-websites.html');
  const entry = getRegistryEntry('premium-websites.html');

  assert.match(source, /<title>Website laten maken voor meer aanvragen \| Softora<\/title>/);
  assert.match(source, /<h1 class="hero-title">Een website<br><em>voor meer aanvragen<\/em><\/h1>/);
  assert.match(source, /SEO-vriendelijke website/);
  assert.match(source, /Conversiegerichte landingspagina's/);
  assert.match(source, /Contentstructuur/);
  assert.match(source, /Google Search Console/);
  assert.match(source, /href="\/blog\/website-laten-maken-kosten-2026"/);
  assert.match(source, /href="\/kennisbank"/);
  assert.match(source, /href="\/pakketten"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.doesNotMatch(source, /Bedrijfsdashboards|Klantenportalen|Personeelssystemen/);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'Website laten maken voor meer aanvragen');
  assert.match(entry.description, /SEO-vriendelijke website/);
  assert.ok(entry.relatedLinks.includes('/website-laten-maken-oisterwijk'));
  assert.ok(entry.relatedLinks.includes('/pakketten'));
});

test('bedrijfssoftware money page is focused on CRM, workflows and automation', () => {
  const source = readPage('premium-bedrijfssoftware.html');
  const entry = getRegistryEntry('premium-bedrijfssoftware.html');

  assert.match(source, /<title>Bedrijfssoftware op maat laten maken \| Softora<\/title>/);
  assert.match(source, /Bedrijfssoftware <em>op maat<\/em>/);
  assert.match(source, /CRM en klantbeheer/);
  assert.match(source, /Interne workflowtools/);
  assert.match(source, /AI automatisering/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.doesNotMatch(source, /Website Tool|AI Website Generator/);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'Bedrijfssoftware op maat laten maken');
  assert.match(entry.description, /CRM, dashboards, klantbeheer/);
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
});

test('crm money page is focused on pipeline, customers and AI follow-up', () => {
  const source = readPage('crm-systeem-op-maat.html');
  const entry = getRegistryEntry('crm-systeem-op-maat.html');

  assert.match(source, /<title>CRM systeem op maat laten maken \| Softora<\/title>/);
  assert.match(source, /<meta name="description" content="Laat een CRM systeem op maat maken door Softora/);
  assert.match(source, /<h1>CRM systeem voor leads, klanten en opvolging<\/h1>/);
  assert.match(source, /Leadpipeline/);
  assert.match(source, /Klantbeheer/);
  assert.match(source, /Offerteflow/);
  assert.match(source, /Reminders en taken/);
  assert.match(source, /AI-samenvattingen/);
  assert.match(source, /Dashboards/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/ai-automatisering"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'CRM systeem op maat laten maken');
  assert.match(entry.description, /leadpipeline, klantbeheer, offertes, dashboards/);
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/ai-automatisering'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
});

test('ai automation money page is focused on leads, CRM flows and safe handoff', () => {
  const source = readPage('ai-automatisering.html');
  const entry = getRegistryEntry('ai-automatisering.html');

  assert.match(source, /<title>AI automatisering laten maken voor MKB \| Softora<\/title>/);
  assert.match(
    source,
    /<meta name="description" content="Laat AI automatisering maken door Softora voor leadopvolging/
  );
  assert.match(source, /<h1>AI automatisering voor leads, taken en opvolging<\/h1>/);
  assert.match(source, /Leadopvolging/);
  assert.match(source, /Intake en mailbox/);
  assert.match(source, /CRM-flows/);
  assert.match(source, /Rapportages/);
  assert.match(source, /Chatbot-overdracht/);
  assert.match(source, /voice-overdracht/);
  assert.match(source, /Menselijke controle/);
  assert.match(source, /Veilige AI grenzen/);
  assert.match(source, /href="\/crm-systeem-op-maat"/);
  assert.match(source, /href="\/chatbot-laten-maken"/);
  assert.match(source, /href="\/voicesoftware-op-maat"/);
  assert.match(source, /href="\/ai-telefonist"/);
  assert.match(source, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(source, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(source, /href="\/kennisbank\/wat-is-bedrijfssoftware-op-maat"/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /overlay|login-box|Binnenkort beschikbaar|toegangscode/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);

  assert.equal(entry.title, 'AI automatisering laten maken voor MKB');
  assert.match(entry.description, /leadopvolging, intake, mailbox, CRM-flows/);
  assert.ok(entry.relatedLinks.includes('/crm-systeem-op-maat'));
  assert.ok(entry.relatedLinks.includes('/chatbot-laten-maken'));
  assert.ok(entry.relatedLinks.includes('/voicesoftware-op-maat'));
  assert.ok(entry.relatedLinks.includes('/bedrijfssoftware-op-maat'));
});

test('chatbot money page is focused on leads, support and clean follow-up', () => {
  const source = readPage('premium-chatbot.html');
  const entry = getRegistryEntry('premium-chatbot.html');

  assert.match(source, /<title>Chatbot laten maken voor leads en support \| Softora<\/title>/);
  assert.match(source, /<h1 class="hero-title">Chatbot<br><em>die leads opvangt<\/em><\/h1>/);
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

test('voicesoftware money page is focused on AI telefonie, intake and CRM follow-up', () => {
  const source = readPage('premium-voicesoftware.html');
  const entry = getRegistryEntry('premium-voicesoftware.html');

  assert.match(source, /<title>AI telefonie en voicesoftware op maat \| Softora<\/title>/);
  assert.match(
    source,
    /<meta name="description" content="Laat voicesoftware en AI telefonie op maat maken door Softora/
  );
  assert.match(source, /<h1 class="hero-title">Voicesoftware<br><em>die opvolging regelt<\/em><\/h1>/);
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
