const test = require('node:test');
const assert = require('node:assert/strict');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');
const { createPremiumHtmlPageAccessController } = require('../../server/security/premium-pages');

test('/mailbox resolves to the protected premium coldmail inbox page', () => {
  const slugMap = createKnownPrettyPageSlugToFile(new Set(['premium-mailbox.html']));
  const access = createPremiumHtmlPageAccessController();

  assert.equal(slugMap.get('mailbox'), 'premium-mailbox.html');
  assert.equal(access.isPremiumProtectedHtmlFile(slugMap.get('mailbox')), true);
});
