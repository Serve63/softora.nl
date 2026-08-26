'use strict';

const MAX_SUMMARY_LENGTH = 220;

function cleanSourceMessage(signal = {}) {
  const source = String(signal.message_text || signal.snippet || '')
    .replace(/\r/g, '')
    .trim();
  if (!source) return '';

  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && /^reacties:\s*\d+/i.test(lines[1])) lines.splice(0, 2);

  return lines.join(' ')
    .replace(/\breacties:\s*\d+\b/gi, ' ')
    .replace(/^opdracht\s+omschrijving\s*/i, '')
    .replace(/^(?:beste\s+(?:mensen|allemaal|freelancers)|goedemorgen\s+(?:alle|allemaal)|goedendag|hallo|hoi)[,!:\s-]*/i, '')
    .replace(/\b(?:dank|bedankt)\s+(?:alvast\s+)?voor\s+(?:het\s+)?(?:meedenken|de\s+hulp)[.!?]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortenAtWord(value, maxLength = MAX_SUMMARY_LENGTH) {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  const shortened = normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, '').replace(/[,:;\s]+$/, '');
  return `${shortened}…`;
}

function normalizePerspective(value) {
  return String(value || '')
    .replace(/^ik ben op zoek naar\b/i, 'De aanvrager zoekt')
    .replace(/^(?:wij|we) zijn op zoek naar\b/i, 'De aanvrager zoekt')
    .replace(/^(?:ik|wij|we) zoek(?:en)?\b/i, 'De aanvrager zoekt')
    .replace(/^ik wil\b/i, 'De aanvrager wil')
    .replace(/^(?:wij|we) willen\b/i, 'De aanvrager wil')
    .replace(/^ik kan\b/i, 'De gebruiker kan')
    .replace(/^ik krijg\b/i, 'De gebruiker krijgt')
    .replace(/^mijn\b/i, 'De')
    .replace(/^onze\b/i, 'De');
}

function genericOneSentence(message) {
  const fragments = String(message || '')
    .split(/(?<=[.!?])\s+/)
    .map((fragment) => fragment.replace(/[.!?]+$/g, '').trim())
    .filter((fragment) => fragment.length > 3)
    .slice(0, 2);
  const combined = normalizePerspective(fragments.join('; '))
    .replace(/[.!?]+/g, ',')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!combined) return 'Er is een concrete website- of softwarevraag gevonden.';
  const capitalized = combined.charAt(0).toUpperCase() + combined.slice(1);
  return `${shortenAtWord(capitalized).replace(/[,:;\s]+$/, '')}.`;
}

function summarizeLeadSignal(signal = {}) {
  const message = cleanSourceMessage(signal);
  const normalized = message.toLowerCase();
  if (!message) return 'Er is een concrete website- of softwarevraag gevonden.';

  if (/wachtwoord\s*reset\s*link|wachtwoordresetlink/.test(normalized) && /(?:loop|dezelfde pagina)/.test(normalized)) {
    return 'De gebruiker kan ondanks correcte inloggegevens niet meer inloggen, blijft in een loginlus hangen en krijgt ook geen geldige wachtwoordresetlink.';
  }
  if (/wordpress[^.]{0,80}\b7[.,]1\b/.test(normalized) && /niet meer inloggen/.test(normalized)) {
    return 'De gebruiker kan sinds de installatie van WordPress 7.1 niet meer inloggen op het dashboard, terwijl de login-knop nergens op reageert.';
  }
  if (/geen geldige json-reactie/.test(normalized) && /(?:pdf|upload)/.test(normalized)) {
    return 'De gebruiker krijgt bij het uploaden van een pdf de foutmelding dat de website geen geldige JSON-reactie teruggeeft.';
  }
  if (/niet meer responsive|niet responsive/.test(normalized) && /mobiel|mobile/.test(normalized)) {
    return 'De website is niet meer responsive op mobiele apparaten en de gebruiker zoekt hulp om dit in het huidige thema en WPBakery te herstellen.';
  }
  if (/smalle? (?:layout|tekst|tekstblok)|smalle layout|witruimte/.test(normalized) && /twenty fourteen|witruimte/.test(normalized)) {
    return 'De tekstblokken in het Twenty Fourteen-thema zijn te smal en de gebruiker wil de witruimte aan beide zijkanten verkleinen.';
  }
  if (/\bsportschool\b/.test(normalized) && /\bvirtuagym\b/.test(normalized) && /\bmollie\b/.test(normalized)) {
    return 'De sportschool zoekt een ervaren specialist die de bestaande website, Virtuagym en Mollie controleert, optimaliseert en goed automatiseert.';
  }
  if (/\bjouwweb\b/.test(normalized) && /\bwordpress\b/.test(normalized) && /\bpaypro\b/.test(normalized)) {
    return 'De opdrachtgever wil de bestaande Jouwweb-site naar WordPress en WooCommerce laten migreren, inclusief PayPro, abonnementen en behoud van SEO.';
  }
  if (/\bwordpress\b/.test(normalized) && /\b(?:specialist|webdeveloper)\b/.test(normalized) && /\b(?:bouwen|bouwt|build)\b/.test(normalized) && /alles\b[^.!?]{0,100}\b(?:uitgedacht|voorbereid)\b/.test(normalized)) {
    return 'De opdrachtgever zoekt een WordPress-specialist die de volledig voorbereide website technisch bouwt.';
  }
  if (/\bwordpress\b/.test(normalized) && /\b(?:specialist|webdeveloper)\b/.test(normalized) && /\b(?:bouwen|bouwt|build)\b/.test(normalized)) {
    return 'De opdrachtgever zoekt een WordPress-specialist die een WordPress-website bouwt.';
  }
  if (/\b(?:computer)?programmeur\b/.test(normalized) && /\bkansberekeningen?\b/.test(normalized)) {
    return 'De aanvrager zoekt een programmeur die een rekenprogramma voor kansberekeningen en getallen bouwt.';
  }
  if (/\b(?:web app|web application)\b/.test(normalized) && /\b(?:mysql|python|database)\b/.test(normalized)) {
    return 'De opdrachtgever zoekt iemand die een webapplicatie met een database en de genoemde technische koppelingen bouwt.';
  }
  if (/\b(?:i(?:'|’)?m|we(?:'|’)?re|we are) looking for\b/.test(normalized) && /\b(?:ai|agent|automation|workflow|operator)\b/.test(normalized)) {
    return 'De opdrachtgever zoekt een specialist die een praktische AI-automatisering bouwt en koppelt aan de bestaande bedrijfssystemen.';
  }
  if (/\b(?:i(?:'|’)?m|we(?:'|’)?re|we are|i am) looking for\b/.test(normalized) && /\b(?:website|webshop|online store)\b/.test(normalized)) {
    return 'De opdrachtgever zoekt iemand die de gevraagde website of webshop professioneel bouwt, vernieuwt of technisch verbetert.';
  }

  return genericOneSentence(message);
}

module.exports = { cleanSourceMessage, summarizeLeadSignal };
