const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createKnownPrettyPageSlugToFile,
  resolveLegacyPrettyPageRedirect,
} = require('../../server/config/page-routing');

test('Winnen is de canonieke route voor de Live Momentum pagina', () => {
  const prettyPages = createKnownPrettyPageSlugToFile(new Set(['live-momentum.html']));

  assert.equal(prettyPages.get('winnen'), 'live-momentum.html');
  assert.equal(resolveLegacyPrettyPageRedirect('live-momentum'), 'winnen');
});
