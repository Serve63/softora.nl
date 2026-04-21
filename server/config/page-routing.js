const fs = require('fs');

const defaultLegacyPrettyPageRedirectEntries = Object.freeze([
  ['personeel-dashboard', 'premium-personeel-dashboard'],
  ['personeel-agenda', 'premium-personeel-agenda'],
  ['personeel-login', 'premium-personeel-login'],
  ['actieve-opdrachten', 'premium-actieve-opdrachten'],
  ['ai-coldmailing', 'premium-ai-coldmailing'],
  ['premium-ai-coldmailing', 'premium-leads'],
  ['ai-lead-generator', 'premium-ai-lead-generator'],
  ['seo-crm-system', 'premium-seo-crm-system'],
  ['opdracht-preview', 'premium-opdracht-preview'],
  ['premium-maandelijkse-kosten', 'premium-vaste-lasten'],
]);

const legacyPrettyPageRedirects = new Map(defaultLegacyPrettyPageRedirectEntries);

function getKnownHtmlPageFiles(rootDir, logger = console) {
  try {
    return new Set(
      fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry && entry.isFile() && /\.html$/i.test(entry.name))
        .map((entry) => entry.name)
    );
  } catch (error) {
    logger.warn('[Startup] Kon HTML-pagina lijst niet lezen:', error?.message || error);
    return new Set(['index.html']);
  }
}

function createKnownPrettyPageSlugToFile(knownHtmlPageFiles) {
  const map = new Map(
    Array.from(knownHtmlPageFiles)
      .filter((file) => /\.html$/i.test(file))
      .map((file) => [file.replace(/\.html$/i, ''), file])
  );
  if (map.has('premium-ai-coldmailing')) {
    map.set('premium-leads', map.get('premium-ai-coldmailing'));
  }
  // Zelfde coldmailing-UI als /premium-bevestigingsmails, aparte URL voor legacy/bookmarks.
  if (map.has('premium-bevestigingsmails')) {
    map.set('premium-ai-lead-generator', map.get('premium-bevestigingsmails'));
  }
  return map;
}

function toPrettyPagePathFromHtmlFile(fileName) {
  const base = String(fileName || '').replace(/\.html$/i, '');
  if (!base || base === 'index') return '/';
  return `/${base}`;
}

function resolveLegacyPrettyPageRedirect(slug) {
  const normalizedSlug = String(slug || '')
    .trim()
    .toLowerCase();
  if (!normalizedSlug) return '';
  return legacyPrettyPageRedirects.get(normalizedSlug) || '';
}

module.exports = {
  createKnownPrettyPageSlugToFile,
  defaultLegacyPrettyPageRedirectEntries,
  getKnownHtmlPageFiles,
  legacyPrettyPageRedirects,
  resolveLegacyPrettyPageRedirect,
  toPrettyPagePathFromHtmlFile,
};
