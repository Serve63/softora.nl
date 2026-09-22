// Shared by the real page router and the architecture inventory. First existing file wins.
const PAGE_ALIASES = Object.freeze({
  'premium-leads': ['premium-ai-coldmailing.html'],
  'kvk-database': ['premium-kvk-database-shell.html', 'premium-kvk-database.html'],
  'kvk-database-bedrijven': ['premium-kvk-company-directory-shell.html'],
  'lead-radar': ['premium-lead-radar-shell.html'],
  logboek: ['sportschool.html'],
  mailbox: ['premium-mailbox.html'],
  winnen: ['live-momentum.html'],
});

function applyPlatformAliases(map, files) {
  const known = new Set(files);
  for (const [slug, candidates] of Object.entries(PAGE_ALIASES)) {
    const file = candidates.find((candidate) => known.has(candidate));
    if (file) map.set(slug, file);
  }
  return map;
}

module.exports = { PAGE_ALIASES, applyPlatformAliases };
