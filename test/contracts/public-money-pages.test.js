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
