const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
} = require('../../server/services/public-seo');
const {
  SEO_CONTENT_COLLECTIONS,
  SEO_CONTENT_ITEMS,
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
} = require('../../server/services/seo-content');

const repoRoot = path.resolve(__dirname, '../..');

function assertHasOneSitewideWidget(html, pagePath) {
  assert.equal(
    (html.match(/data-softora-whatsapp-widget="sitewide"/g) || []).length,
    1,
    `${pagePath} moet exact één sitebrede WhatsApp-widget tonen.`
  );
  assert.equal(
    (html.match(/\/assets\/public-whatsapp-widget\.css\?v=20260826a/g) || []).length,
    1,
    `${pagePath} moet exact één gedeeld widget-stylesheet laden.`
  );
  assert.equal(
    (html.match(/\/assets\/public-conversion-tracking\.js\?v=20260601a/g) || []).length,
    1,
    `${pagePath} moet de WhatsApp-conversie exact één keer meten.`
  );
  assert.match(html, /href="https:\/\/wa\.me\/31643262792"/);
  assert.match(html, /aria-label="Open WhatsApp-chat met Softora|aria-label="Open WhatsApp chat met Softora/);
  assert.match(html, new RegExp(`data-softora-conversion-page="${pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
}

test('iedere publieke vaste Softora-pagina krijgt dezelfde WhatsApp-widget precies één keer', () => {
  for (const entry of INDEXABLE_PUBLIC_SEO_PAGES) {
    const source = fs.readFileSync(path.join(repoRoot, entry.fileName), 'utf8');
    const once = applyPublicSeoHeadDefaults(source, entry.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });
    const twice = applyPublicSeoHeadDefaults(once, entry.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });

    assertHasOneSitewideWidget(once, entry.path);
    assertHasOneSitewideWidget(twice, entry.path);
  }
});

test('iedere dynamische contentindex en ieder artikel krijgt de sitebrede WhatsApp-widget', () => {
  for (const collection of Object.values(SEO_CONTENT_COLLECTIONS)) {
    const html = buildSeoContentIndexHtml(collection.key, {
      siteOrigin: 'https://www.softora.nl',
      now: new Date('2026-08-26T12:00:00+02:00'),
    });
    assertHasOneSitewideWidget(html, collection.path);
  }

  for (const item of SEO_CONTENT_ITEMS) {
    const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
    assertHasOneSitewideWidget(html, `/${item.collection}/${item.slug}`);
  }
});

test('de sitebrede widget blijft buiten interne en beschermde pagina-rendering', () => {
  const privateHtml = '<!doctype html><html><head></head><body><main>Intern</main></body></html>';
  const rendered = applyPublicSeoHeadDefaults(privateHtml, 'premium-personeel-dashboard.html');

  assert.equal(rendered, privateHtml);
  assert.doesNotMatch(rendered, /public-whatsapp-widget|data-softora-whatsapp-widget/);
});

test('de gedeelde widgetstijl is mobiel, toegankelijk en vrij van cookie-overlap', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'assets/public-whatsapp-widget.css'), 'utf8');

  assert.match(css, /\.whatsapp-widget\s*\{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/);
  assert.match(css, /\.whatsapp-widget-btn\s*\{[\s\S]*width:\s*64px;[\s\S]*height:\s*64px;/);
  assert.match(css, /background:\s*linear-gradient\(145deg,\s*#30df6c 0%,\s*#19bf57 100%\)/);
  assert.match(css, /body:has\(\.softora-consent-settings\) \.whatsapp-widget\s*\{[\s\S]*bottom:/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*\.whatsapp-widget-label\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
