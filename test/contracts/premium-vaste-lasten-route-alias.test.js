const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveLegacyPrettyPageRedirect } = require('../../server/config/page-routing');

test('legacy slug premium-maandelijkse-kosten redirects naar premium-vaste-lasten', () => {
  assert.equal(resolveLegacyPrettyPageRedirect('premium-maandelijkse-kosten'), 'premium-vaste-lasten');
});
