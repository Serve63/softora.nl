const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSeoContentArticleHtml, getSeoContentItem } = require('../../server/services/seo-content');

test('internal-link guide sends contextual and related links to active canonical destinations', () => {
  const item = getSeoContentItem('blog', 'wat-is-interne-linkstructuur');
  const html = buildSeoContentArticleHtml(item);
  const body = html.match(/<article class="artikel-body">([\s\S]*?)<\/article>/)[1];
  for (const path of ['/crm-systeem-op-maat', '/ai-automatisering', '/kennisbank/website-migratie-zonder-seo-verlies']) {
    assert.ok(!body.includes(`href="${path}"`), `article body still links to ${path}`);
    assert.ok(!(item.relatedLinks || []).some(link => link.href === path), `related links still point to ${path}`);
  }
  assert.match(body, /href="\/bedrijfssoftware-op-maat"[^>]*>CRM op maat<\/a>/);
  assert.match(body, /href="\/blog\/ai-processen-automatiseren-zonder-controle-verliezen"[^>]*>AI-automatisering voor een controleerbare workflow<\/a>/);
  assert.match(body, /href="\/blog\/website-migratie-zonder-seo-verlies"/);
  assert.ok(item.relatedLinks.some(link => link.href === '/blog/wat-is-een-crm-systeem'));
  assert.equal(item.publishedAt, '2026-06-01');
  assert.equal(item.updatedAt, '2026-10-07');
  assert.match(html, /"dateModified":"2026-10-07"/);
});
