const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';

const SEO_AUTOMATION_EXCLUDED_PATHS = Object.freeze([
  '/website',
  '/bedrijfssoftware',
  '/voicesoftware',
  '/chatbot',
]);

const SEO_AUTOMATION_MONEY_PAGE_ALTERNATIVES = Object.freeze({
  '/website': '/website-laten-maken',
  '/bedrijfssoftware': '/bedrijfssoftware-op-maat',
  '/voicesoftware': '/voicesoftware-op-maat',
  '/chatbot': '/chatbot-laten-maken',
});

const EXCLUDED_PATH_SET = new Set(SEO_AUTOMATION_EXCLUDED_PATHS);

function normalizeSeoAutomationPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/') && !/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw, DEFAULT_SITE_ORIGIN);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (!['softora.nl', 'www.softora.nl'].includes(parsed.hostname.toLowerCase())) return '';
    return parsed.pathname.replace(/\/+$/g, '') || '/';
  } catch (_) {
    return '';
  }
}

function isSeoAutomationExcludedPath(value) {
  return EXCLUDED_PATH_SET.has(normalizeSeoAutomationPath(value));
}

module.exports = {
  SEO_AUTOMATION_EXCLUDED_PATHS,
  SEO_AUTOMATION_MONEY_PAGE_ALTERNATIVES,
  isSeoAutomationExcludedPath,
  normalizeSeoAutomationPath,
};
