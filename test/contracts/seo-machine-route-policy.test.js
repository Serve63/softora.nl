const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEO_AUTOMATION_EXCLUDED_PATHS,
  SEO_AUTOMATION_MONEY_PAGE_ALTERNATIVES,
  isSeoAutomationExcludedPath,
  normalizeSeoAutomationPath,
} = require('../../server/services/seo-machine-route-policy');
const { SEO_CONTENT_ITEMS } = require('../../server/services/seo-content');
const { INDEXABLE_PUBLIC_SEO_PAGES } = require('../../server/services/public-seo');

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

test('SEO route policy protects exactly the four short product routes', () => {
  assert.deepEqual(SEO_AUTOMATION_EXCLUDED_PATHS, [
    '/website',
    '/bedrijfssoftware',
    '/voicesoftware',
    '/chatbot',
  ]);
  assert.equal(isSeoAutomationExcludedPath('/website/'), true);
  assert.equal(isSeoAutomationExcludedPath('https://www.softora.nl/chatbot?bron=gsc'), true);
  assert.equal(isSeoAutomationExcludedPath('/website-laten-maken'), false);
  assert.equal(isSeoAutomationExcludedPath('https://example.nl/website'), false);
  assert.equal(normalizeSeoAutomationPath('https://softora.nl/voicesoftware/'), '/voicesoftware');
});

test('SEO route policy keeps the active money-page alternatives explicit', () => {
  assert.deepEqual(SEO_AUTOMATION_MONEY_PAGE_ALTERNATIVES, {
    '/website': '/website-laten-maken',
    '/bedrijfssoftware': '/bedrijfssoftware-op-maat',
    '/voicesoftware': '/voicesoftware-op-maat',
    '/chatbot': '/chatbot-laten-maken',
  });
});

test('current public SEO inventory and content never reference an excluded route', () => {
  const values = collectStrings([INDEXABLE_PUBLIC_SEO_PAGES, SEO_CONTENT_ITEMS]);
  assert.deepEqual(values.filter(isSeoAutomationExcludedPath), []);
});
