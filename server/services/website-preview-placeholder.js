// A webdesign built from a maintenance, "coming soon" or parked-domain page redesigns that
// placeholder instead of the business (e.g. an invented "Aan het Water" brand for a builder).
const STRONG_PLACEHOLDER_PATTERNS = [
  /ondergaat (?:momenteel )?(?:ingeroosterd |gepland |tijdelijk )?onderhoud/i,
  /\b(?:deze )?(?:website|site|webshop) is (?:momenteel |tijdelijk )?(?:in onderhoud|offline|in aanbouw|under construction)/i,
  /\b(?:this|deze) (?:domain|domeinnaam|domein) (?:name )?(?:is |may be )?(?:for sale|te koop|geregistreerd|registered|parked)/i,
  /\baccount (?:has been )?suspended\b/i,
];
// Ordinary sites can say "coming soon" or offer "gepland onderhoud"; these only count in the
// page title/heading or on a page that has almost no other text.
const WEAK_PLACEHOLDER_PATTERNS = [
  /\bgepland onderhoud\b|\bunder maintenance\b|\bmaintenance mode\b/i,
  /\bunder construction\b|\bcoming soon\b|\bwebsite in aanbouw\b/i,
  /\bbinnenkort (?:online|beschikbaar|live)\b/i,
];
const SHORT_PAGE_TEXT_LENGTH = 400;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findSignal(patterns, text) {
  const match = text ? patterns.map((pattern) => text.match(pattern)).find(Boolean) : null;
  return match ? match[0].slice(0, 80) : '';
}

function detectPlaceholderWebsiteScan(scan = {}) {
  const heading = [scan.title, scan.h1].map(normalizeText).filter(Boolean).join(' | ');
  const body = normalizeText(scan.bodyTextSample);
  const all = [heading, normalizeText(scan.metaDescription), body].filter(Boolean).join(' | ');
  const signal = findSignal(STRONG_PLACEHOLDER_PATTERNS, all) ||
    findSignal(WEAK_PLACEHOLDER_PATTERNS, body.length < SHORT_PAGE_TEXT_LENGTH ? all : heading);
  return { placeholder: Boolean(signal), signal };
}

function buildPlaceholderWebsiteError(signal) {
  const error = new Error(
    `Deze website lijkt in onderhoud, in aanbouw of geparkeerd ("${signal}"). Er is geen webdesign gemaakt; probeer het later opnieuw.`
  );
  error.status = 422; // Not retryable: a paid generation would only redesign the placeholder.
  error.code = 'WEBDESIGN_PLACEHOLDER_WEBSITE';
  return error;
}

module.exports = { detectPlaceholderWebsiteScan, buildPlaceholderWebsiteError };
