// Compact display evidence only; confirmed contact fields keep their own meaning.
function httpUrl(value) {
  const text = String(value || '').trim().slice(0, 1500);
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? text : '';
  } catch { return ''; }
}

function directoryDossier(row) {
  const dossier = row?.research_dossier;
  if (row?.unusable_reason !== 'identity_unconfirmed' || dossier?.identity_status !== 'unconfirmed'
      || !Array.isArray(dossier.possible_matches)) return {};
  const possibleMatches = dossier.possible_matches.slice(0, 5).flatMap((match) => {
    if (!match || typeof match !== 'object') return [];
    const text = (key) => String(match[key] || '').trim().slice(0, 1500);
    const source = httpUrl(match.bron_url);
    if (!source || !text('onzekerheid')) return [];
    const phoneSource = httpUrl(match.telefoon_bron_url);
    const emailSource = httpUrl(match.email_bron_url);
    return [{
      bedrijfsnaam: text('bedrijfsnaam'), adres: text('adres'),
      telefoonnummer: phoneSource ? text('telefoonnummer') : '', telefoon_bron_url: phoneSource,
      email: emailSource ? text('email') : '', email_bron_url: emailSource,
      website: httpUrl(match.website), bron_url: source, onzekerheid: text('onzekerheid'),
    }];
  });
  return possibleMatches.length ? { identity_status: 'unconfirmed', possible_matches: possibleMatches } : {};
}

module.exports = { directoryDossier };
