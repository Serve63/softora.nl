/**
 * `premium-*.html` files that are public (no personeel-login).
 * All other `premium-*.html` files require auth — see server/security/premium-pages.js.
 */
const PREMIUM_PUBLIC_HTML_FILE_NAMES = Object.freeze([
  'premium-website.html',
  'premium-personeel-login.html',
  'premium-bedrijfssoftware.html',
  'premium-voicesoftware.html',
  'premium-chatbot.html',
  'premium-websites.html',
  'premium-blog.html',
  'premium-algemene-voorwaarden.html',
  'premium-privacy-policy.html',
  'premium-over-softora.html',
  'premium-pakketten.html',
  'premium-seo.html',
  'premium-bevestigingsmails.html',
]);

function createPremiumPublicHtmlFilesSet() {
  return new Set(PREMIUM_PUBLIC_HTML_FILE_NAMES);
}

module.exports = {
  PREMIUM_PUBLIC_HTML_FILE_NAMES,
  createPremiumPublicHtmlFilesSet,
};
