/**
 * `premium-*.html` files that require an authenticated admin session.
 * These files stay behind the normale premium login, but are additionally
 * blocked for non-admin accounts.
 */
const PREMIUM_ADMIN_ONLY_HTML_FILE_NAMES = Object.freeze([
  'premium-instellingen.html',
  'premium-wachtwoordenregister.html',
]);

function createPremiumAdminOnlyHtmlFilesSet() {
  return new Set(PREMIUM_ADMIN_ONLY_HTML_FILE_NAMES);
}

module.exports = {
  PREMIUM_ADMIN_ONLY_HTML_FILE_NAMES,
  createPremiumAdminOnlyHtmlFilesSet,
};
