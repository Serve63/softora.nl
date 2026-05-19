const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

const growthPages = [
  {
    file: 'diensten.html',
    path: '/diensten',
    h1: 'Softora diensten',
    links: ['/website-laten-maken', '/ai-automatisering', '/crm-systeem-op-maat'],
  },
  {
    file: 'website-laten-maken.html',
    path: '/website-laten-maken',
    h1: 'Website laten maken',
    links: ['/ai-automatisering', '/crm-systeem-op-maat', '/premium-websites'],
  },
  {
    file: 'ai-automatisering.html',
    path: '/ai-automatisering',
    h1: 'AI automatisering',
    links: ['/crm-systeem-op-maat', '/chatbot-laten-maken', '/ai-telefonist'],
  },
  {
    file: 'bedrijfssoftware-op-maat.html',
    path: '/bedrijfssoftware-op-maat',
    h1: 'Bedrijfssoftware op maat',
    links: ['/crm-systeem-op-maat', '/maatwerk-platform', '/ai-automatisering'],
  },
  {
    file: 'crm-systeem-op-maat.html',
    path: '/crm-systeem-op-maat',
    h1: 'CRM systeem op maat',
    links: ['/website-laten-maken', '/ai-automatisering', '/ai-telefonist'],
  },
  {
    file: 'chatbot-laten-maken.html',
    path: '/chatbot-laten-maken',
    h1: 'Chatbot laten maken',
    links: ['/crm-systeem-op-maat', '/website-laten-maken', '/premium-chatbot'],
  },
];

test('seo growth plan documents targets, clusters and publishing cadence', () => {
  const plan = fs.readFileSync(path.join(repoRoot, 'docs/growth/seo-growth-plan-2026.md'), 'utf8');

  assert.match(plan, /10\.000 organische bezoekers per maand/);
  assert.match(plan, /25\.000 organische bezoekers per maand/);
  assert.match(plan, /Zoekwoordclusters/);
  assert.match(plan, /Google Search Console/);
  assert.match(plan, /Eerste bouwbatch/);
});

for (const page of growthPages) {
  test(`seo growth page ${page.path} has indexable service content and internal links`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page.file), 'utf8');

    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /<html lang="nl">/);
    assert.match(html, /<meta name="description" content="[^"]{110,170}">/);
    assert.match(html, new RegExp(`<h1>${page.h1}</h1>`));
    assert.match(html, /<img class="seo-growth-hero-image"[^>]+alt="[^"]{20,}"/);
    assert.match(html, /mailto:info@softora\.nl/);
    assert.match(html, /\/assets\/seo-growth-pages\.css\?v=20260519a/);
    assert.doesNotMatch(html, /noindex/i);

    for (const link of page.links) {
      assert.match(html, new RegExp(`href="${link}"`), `${page.file} mist interne link naar ${link}`);
    }
  });
}
