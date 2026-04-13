const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createKnownPrettyPageSlugToFile,
  resolveLegacyPrettyPageRedirect,
} = require('../../server/config/page-routing');

test('premium leads exposes a clean pretty route and redirects the old slug', () => {
  const knownPages = new Set(['premium-ai-coldmailing.html', 'premium-ai-lead-generator.html']);
  const slugMap = createKnownPrettyPageSlugToFile(knownPages);

  assert.equal(slugMap.get('premium-leads'), 'premium-ai-coldmailing.html');
  assert.equal(resolveLegacyPrettyPageRedirect('premium-ai-coldmailing'), 'premium-leads');
});

test('premium sidebar navigation normalizes old leads links to the clean route', () => {
  const root = path.join(__dirname, '../..');
  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');

  assert.match(themeSource, /if \(href === "\/premium-ai-coldmailing"\) return "\/premium-leads";/);
  assert.match(themeSource, /href: "\/premium-leads",\s*label: "Leads"/);
  assert.match(
    themeSource,
    /if \(p\.indexOf\("\/premium-leads"\) === 0 \|\| p\.indexOf\("\/premium-ai-coldmailing"\) === 0\) return "leads";/
  );
});
