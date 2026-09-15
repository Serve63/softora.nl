const DUTCH_PROVINCE_PATTERN =
  '(?:N\\.?\\s?Br\\.?|N\\.?B\\.?|Noord[-\\s]?Brabant|Z\\.?H\\.?|Zuid[-\\s]?Holland|N\\.?H\\.?|Noord[-\\s]?Holland|Gld\\.?|Gelderland|Lb\\.?|Limburg|Ov\\.?|Overijssel|Dr\\.?|Drenthe|Fr\\.?|Friesland|Gr\\.?|Groningen|Fl\\.?|Flevoland|Ze\\.?|Zeeland|Ut\\.?|Utrecht)';

const DUTCH_PROVINCE_LABEL = new RegExp(`^${DUTCH_PROVINCE_PATTERN}$`, 'i');
const AMBIGUOUS_CITY_PROVINCE_LABEL = /^(?:Groningen|Utrecht|Zeeland)$/i;
const STREET_ADDRESS_PATTERN =
  /(straat|weg|laan|plein|pad|dijk|hof|kade|markt|singel|steeg|gracht|boulevard|baan|akker|plantsoen|park)\b/i;

function defaultNormalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function isDutchProvinceLabel(value, normalizeString = defaultNormalizeString) {
  return DUTCH_PROVINCE_LABEL.test(normalizeString(value));
}

function isUnambiguousDutchProvinceLabel(value, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  return isDutchProvinceLabel(text, normalizeString) && !AMBIGUOUS_CITY_PROVINCE_LABEL.test(text);
}

function cleanPlaceLabel(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .replace(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g, '')
    .replace(new RegExp(`\\s*\\(${DUTCH_PROVINCE_PATTERN}\\)\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s+${DUTCH_PROVINCE_PATTERN}\\s*$`, 'i'), '')
    .replace(/\b(Nederland|The Netherlands)\b/gi, '')
    .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeStreetAddress(value, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  return /\d/.test(text) && STREET_ADDRESS_PATTERN.test(text);
}

function extractPlaceFromAddress(value, options = {}) {
  const normalizeString = options.normalizeString || defaultNormalizeString;
  const findKnownPlaceLabel =
    typeof options.findKnownPlaceLabel === 'function' ? options.findKnownPlaceLabel : () => '';
  const text = normalizeString(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
  if (!text) return '';

  const postalMatch = text.match(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b\s+([A-Za-zÀ-ÿ'’.\- ]{2,})$/);
  if (postalMatch) {
    const postalPlace = cleanPlaceLabel(postalMatch[1], normalizeString);
    return isUnambiguousDutchProvinceLabel(postalPlace, normalizeString) ? '' : postalPlace;
  }

  const rawParts = text.split(/[,\n;|]/).map(normalizeString).filter(Boolean);
  for (let index = rawParts.length - 1; index >= 0; index -= 1) {
    const rawPart = rawParts[index];
    if (isDutchProvinceLabel(rawPart, normalizeString)) {
      if (rawParts.length > 1 || isUnambiguousDutchProvinceLabel(rawPart, normalizeString)) continue;
    }
    const candidate = cleanPlaceLabel(rawPart, normalizeString);
    if (!candidate || looksLikeStreetAddress(candidate, normalizeString) || /^\d+$/.test(candidate)) continue;
    if (isUnambiguousDutchProvinceLabel(candidate, normalizeString)) continue;
    return candidate;
  }

  const cleaned = cleanPlaceLabel(text, normalizeString);
  if (!cleaned || isUnambiguousDutchProvinceLabel(cleaned, normalizeString)) return '';
  if (!looksLikeStreetAddress(cleaned, normalizeString)) return cleaned;

  const knownPlace = cleanPlaceLabel(findKnownPlaceLabel(cleaned), normalizeString);
  if (knownPlace && !isUnambiguousDutchProvinceLabel(knownPlace, normalizeString)) return knownPlace;

  const trailingPlace = cleaned.match(/\b\d+[A-Za-z]?(?:[-/]\d+)?\s+([A-Za-zÀ-ÿ'’.\- ]{2,})$/);
  if (!trailingPlace) return '';
  const candidate = cleanPlaceLabel(trailingPlace[1], normalizeString);
  return candidate && !isUnambiguousDutchProvinceLabel(candidate, normalizeString) ? candidate : '';
}

function resolveRecipientPlace(row = {}, options = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const candidates = [
    source.plaats,
    source.city,
    source.gemeente,
    source.locality,
    source.town,
    source.village,
    source.stad,
    source.adres,
    source.address,
    source.location,
  ];
  return candidates.map((value) => extractPlaceFromAddress(value, options)).find(Boolean) || '';
}

function normalizePinnedRecipientLocationLines(text, city, options = {}) {
  const normalizeString = options.normalizeString || defaultNormalizeString;
  const resolvedCity = extractPlaceFromAddress(city, options) || 'uw regio';
  return String(text == null ? '' : text)
    .split(/\r?\n/)
    .map((line) => {
      const match = String(line).match(/^(\s*📍\s*)(.*?)(\s*)$/u);
      if (!match || !isDutchProvinceLabel(match[2], normalizeString)) return line;
      if (normalizeString(match[2]).toLowerCase() === normalizeString(resolvedCity).toLowerCase()) return line;
      return `${match[1]}${resolvedCity}${match[3]}`;
    })
    .join('\n');
}

module.exports = {
  cleanPlaceLabel,
  extractPlaceFromAddress,
  isDutchProvinceLabel,
  isUnambiguousDutchProvinceLabel,
  looksLikeStreetAddress,
  normalizePinnedRecipientLocationLines,
  resolveRecipientPlace,
};
