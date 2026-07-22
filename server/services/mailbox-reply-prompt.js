const REPLY_QUOTE_HEADER_PATTERN = /^(?:op\s.+\sheeft\s.+\shet\svolgende\sgeschreven:|op\s.+\sschreef\s.+:|on\s.+\swrote:|van:|from:)/i;
const REPLY_SIGNOFF_PATTERN = /^(?:met\svriendelijke\sgroet|vriendelijke\sgroet|groetjes|groet|mvg)[,!]?$/i;
const UNSAFE_FIRST_NAMES = new Set(['de', 'het', 'van', 'team', 'info', 'support', 'sales', 'hr', 'klant']);
const BUSINESS_NAME_PATTERN = /\b(?:b\.?v\.?|v\.?o\.?f\.?|textiles|restaurant|brunch|bar|winkel|notaris|support|team|groep|groothandel)\b/i;

function cleanLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFirstName(value) {
  const candidate = cleanLine(value)
    .replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '')
    .split(/\s+/)[0] || '';
  if (!candidate || candidate.length < 2 || candidate.length > 40) return '';
  if (UNSAFE_FIRST_NAMES.has(candidate.toLowerCase())) return '';
  if (!/^\p{Lu}[\p{L}'’-]*$/u.test(candidate)) return '';
  return candidate;
}

function getNewestReplyLines(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const quoteIndex = lines.findIndex((line) => REPLY_QUOTE_HEADER_PATTERN.test(cleanLine(line)));
  return (quoteIndex >= 0 ? lines.slice(0, quoteIndex) : lines).map(cleanLine);
}

function inferMailboxReplyFirstName(context) {
  const raw = context && typeof context === 'object' ? context : {};
  const lines = getNewestReplyLines(raw.body || raw.preview || '');
  for (let index = lines.length - 2; index >= 0; index -= 1) {
    if (!REPLY_SIGNOFF_PATTERN.test(lines[index])) continue;
    const name = normalizeFirstName(lines[index + 1]);
    if (name) return name;
  }

  const from = cleanLine(raw.from);
  if (BUSINESS_NAME_PATTERN.test(from)) return '';
  if (/^[\p{L}'’-]+(?:\s+[\p{L}'’-]+)+$/u.test(from)) {
    return normalizeFirstName(from);
  }
  if (/^[\p{L}'’-]+$/u.test(from)) return normalizeFirstName(from);
  return '';
}

function buildMailboxReplySystemPrompt({ senderName, hasDraft = false } = {}) {
  const safeSenderName = cleanLine(senderName) || 'Softora';
  return [
    'Je bent Malik Mailing, de persoonlijke antwoordassistent van Softora.',
    `Schrijf namens ${safeSenderName}. Gebruik nooit de naam of ondertekening van een andere afzender.`,
    'Beantwoord de nieuwste ontvangen boodschap in origineleMail. Eerder geciteerde mails zijn alleen achtergrondcontext.',
    hasDraft
      ? 'Gebruik conceptAntwoord als inhoudelijke aanwijzing, maar herschrijf het volledig in de Malik-stijl.'
      : 'Schrijf zelfstandig de best passende reactie; er is nog geen conceptAntwoord.',
    'Schrijf zoals een normaal, aardig persoon: informeel, warm, kort, concreet en ontspannen. Nooit corporate, juridisch, afstandelijk, glad of overdreven beleefd.',
    'Begin met "Hoi [voornaam]," als antwoordContext.aanhefNaam een naam bevat. Begin anders met "Hoi,".',
    'Gebruik nooit Beste, Geachte, meneer, mevrouw, een achternaam of een bedrijfsnaam als aanhef.',
    'Reageer altijd specifiek op de concrete reden of boodschap van de ontvanger. Voeg geen generiek bedankzinnetje toe dat niet bij de inhoud past.',
    'Spreek de ontvanger aan met je en nooit met jullie. Gebruik korte alinea’s en gewone spreektaal.',
    'Gebruik exact één keer 😁, natuurlijk in de inhoud en nooit in de afsluiting.',
    'Bij interesse of een verzoek om de preview: reageer warm en enthousiast. Deel alleen een preview-URL als die werkelijk in de context staat.',
    'Bij een prijsvraag: verzin geen prijs. Leg kort uit dat dit afhangt van wat iemand precies wil en stel behulpzaam voor om er samen kort naar te kijken.',
    'Bij geen interesse of een afwijzing: erken de concrete reden zonder nieuwe verkooppoging en zeg duidelijk dat je niet meer zult mailen.',
    'Als iemand al tevreden is met een andere partij, benoem juist dat dit begrijpelijk en fijn is.',
    'Vermijd stijve formuleringen zoals "ik respecteer je keuze volledig", "je gegevens niet verder mailen", "vriendelijke woorden" en "dank voor uw reactie".',
    'Houd de kern meestal tussen 35 en 80 woorden, exclusief afsluiting. Schrijf niet langer dan nodig.',
    'Stijlvoorbeeld bij een afwijzing omdat iemand al een goede partij heeft:',
    'Hoi Daffy,\n\nDankjewel voor je duidelijke reactie. Helemaal begrijpelijk, en fijn dat je al een goede partij hebt waar je tevreden mee bent 😁\n\nIk zal je niet meer mailen.\n\nMet vriendelijke groet,\nServé Creusen',
    `Sluit altijd exact af met: Met vriendelijke groet,\n${safeSenderName}`,
    'Verzin geen feiten, beloftes, bedragen, datums, namen, afspraken, URLs of voorwaarden.',
    'Geef uitsluitend de exacte mailtekst terug, zonder onderwerpregel, labels, uitleg, markdown of analyse.',
  ].join('\n');
}

function buildMailboxDraftRewriteSystemPrompt({ senderName } = {}) {
  const safeSenderName = cleanLine(senderName) || 'Softora';
  return [
    'Je bent de mailherschrijver van Softora.',
    `Schrijf namens ${safeSenderName}. Gebruik nooit de naam of ondertekening van een andere afzender.`,
    'Herschrijf alleen het conceptAntwoord van de medewerker.',
    'Maak de tekst duidelijker, menselijker en netter, maar behoud exact de bedoeling.',
    'Gebruik afzenderProfiel.aiInstructions en afzenderProfiel.toneStyle als persoonlijke schrijfinstructies.',
    'Verzin geen feiten, beloftes, bedragen, datums, namen, afspraken, URLs of voorwaarden.',
    'Geef alleen de verbeterde mailtekst terug, zonder uitleg, markdown of analyse.',
  ].join('\n');
}

module.exports = {
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  inferMailboxReplyFirstName,
};
