const path = require('path');
const zlib = require('zlib');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const MAX_IMPORT_COLS = 50;
const MAX_REAL_BUSINESS_ROWS = 100;
const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.businessStatus',
  'places.types',
  'nextPageToken',
].join(',');
const DEFAULT_REAL_BUSINESS_QUERY = 'bedrijven in Noord-Brabant';
const REAL_BUSINESS_CATEGORY_PREFIXES = [
  'bedrijven',
  'winkels',
  'restaurants',
  'kappers',
  'bouwbedrijven',
  'fysiotherapiepraktijken',
  'accountants',
  'makelaars',
  'installateurs',
  'tandartsen',
  'webdesign bureaus',
  'zorgpraktijken',
];

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createServiceError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeImportKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function decodeXml(value) {
  return normalizeString(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function getExtension(fileName) {
  return path.extname(normalizeString(fileName)).toLowerCase();
}

function inferExtensionFromContentType(contentType) {
  const normalized = normalizeString(contentType).toLowerCase();
  if (normalized.includes('spreadsheetml.sheet') || normalized.includes('application/vnd.ms-excel')) {
    return '.xlsx';
  }
  if (normalized.includes('tab-separated-values')) return '.tsv';
  if (normalized.includes('csv') || normalized.includes('text/plain')) return '.csv';
  return '';
}

function decodeUploadBuffer(dataBase64) {
  const raw = normalizeString(dataBase64).replace(/^data:[^,]+,/, '');
  if (!raw) {
    throw new Error('Geen bestandsdata ontvangen.');
  }

  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) {
    throw new Error('Het bestand is leeg.');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Het bestand is te groot. Gebruik maximaal 5 MB.');
  }
  return buffer;
}

function scoreDelimitedSeparators(line) {
  const scores = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && Object.prototype.hasOwnProperty.call(scores, char)) {
      scores[char] += 1;
    }
  }

  return scores;
}

function detectDelimitedSeparator(text, preferred = '') {
  if (preferred === '\t') return '\t';
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .find((line) => normalizeString(line));
  if (!firstLine) return preferred || ',';

  const scores = scoreDelimitedSeparators(firstLine);
  const best = Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
  return best && best[1] > 0 ? best[0] : preferred || ',';
}

function trimTrailingEmptyCells(row) {
  const next = row.slice(0, MAX_IMPORT_COLS);
  while (next.length && !normalizeString(next[next.length - 1])) {
    next.pop();
  }
  return next;
}

function parseDelimitedRows(raw, preferredSeparator = '') {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const separator = detectDelimitedSeparator(text, preferredSeparator);
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      const trimmedRow = trimTrailingEmptyCells(row);
      if (trimmedRow.some((cell) => normalizeString(cell))) {
        rows.push(trimmedRow);
      }
      if (rows.length >= MAX_IMPORT_ROWS) return rows;
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  const trimmedRow = trimTrailingEmptyCells(row);
  if (trimmedRow.some((cell) => normalizeString(cell))) {
    rows.push(trimmedRow);
  }

  return rows.slice(0, MAX_IMPORT_ROWS);
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0x10000 - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('Het Excel-bestand kon niet worden gelezen.');
}

function inflateZipEntry(buffer, entry) {
  const localOffset = entry.localOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('Het Excel-bestand is ongeldig.');
  }

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error('Dit Excel-bestand gebruikt een niet-ondersteund ZIP-formaat.');
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Het Excel-bestand is ongeldig.');
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    entries.set(name, {
      method,
      compressedSize,
      localOffset,
      data: () => inflateZipEntry(buffer, { method, compressedSize, localOffset }),
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getZipText(entries, name) {
  const entry = entries.get(name);
  return entry ? entry.data().toString('utf8') : '';
}

function parseXmlAttributes(tag) {
  const attrs = {};
  String(tag || '').replace(/([:\w.-]+)="([^"]*)"/g, (_match, name, value) => {
    attrs[name] = decodeXml(value);
    return '';
  });
  return attrs;
}

function extractTextNodes(xml) {
  const values = [];
  String(xml || '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_match, value) => {
    values.push(decodeXml(value));
    return '';
  });
  return values;
}

function parseSharedStrings(xml) {
  const values = [];
  String(xml || '').replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_match, itemXml) => {
    values.push(extractTextNodes(itemXml).join(''));
    return '';
  });
  return values;
}

function resolveZipTarget(baseDir, target) {
  const normalizedTarget = normalizeString(target).replace(/\\/g, '/');
  if (!normalizedTarget) return '';
  if (normalizedTarget.startsWith('/')) return normalizedTarget.slice(1);
  return path.posix.normalize(`${baseDir}/${normalizedTarget}`).replace(/^(\.\.\/)+/, '');
}

function shouldSkipWorksheetName(name) {
  return normalizeImportKey(name) === 'database';
}

function parseWorkbookRelationships(relsXml) {
  const relationships = new Map();
  String(relsXml || '').replace(/<Relationship\b[^>]*>/g, (tag) => {
    const attrs = parseXmlAttributes(tag);
    if (attrs.Id && attrs.Target) {
      relationships.set(attrs.Id, attrs.Target);
    }
    return '';
  });
  return relationships;
}

function listWorkbookWorksheets(entries) {
  const workbookXml = getZipText(entries, 'xl/workbook.xml');
  const relsXml = getZipText(entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml) {
    return [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }];
  }

  const relationships = parseWorkbookRelationships(relsXml);
  const worksheets = [];
  workbookXml.replace(/<sheet\b[^>]*>/g, (tag) => {
    const attrs = parseXmlAttributes(tag);
    const relationshipId = attrs['r:id'];
    const fallbackIndex = worksheets.length + 1;
    const target = relationshipId ? relationships.get(relationshipId) : '';
    worksheets.push({
      name: normalizeString(attrs.name) || `Sheet${fallbackIndex}`,
      path: resolveZipTarget('xl', target) || `xl/worksheets/sheet${fallbackIndex}.xml`,
    });
    return '';
  });

  return worksheets.length ? worksheets : [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }];
}

function columnIndexFromRef(reference) {
  const letters = normalizeString(reference).match(/^[A-Z]+/i)?.[0] || '';
  if (!letters) return 0;
  return letters
    .toUpperCase()
    .split('')
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function readCellValue(cellXml, attrs, sharedStrings) {
  if (attrs.t === 'inlineStr') {
    return extractTextNodes(cellXml).join('');
  }

  const valueMatch = String(cellXml || '').match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const rawValue = valueMatch ? decodeXml(valueMatch[1]) : '';
  if (attrs.t === 's') {
    return sharedStrings[Number(rawValue)] || '';
  }
  if (attrs.t === 'b') {
    return rawValue === '1' ? 'TRUE' : 'FALSE';
  }
  return rawValue;
}

function parseWorksheetRows(sheetXml, sharedStrings) {
  const rows = [];
  String(sheetXml || '').replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_rowMatch, rowXml) => {
    const row = [];
    String(rowXml || '').replace(/<c\b[^>]*>[\s\S]*?<\/c>/g, (cellXml) => {
      const tagMatch = cellXml.match(/<c\b[^>]*>/);
      const attrs = parseXmlAttributes(tagMatch ? tagMatch[0] : '');
      const columnIndex = columnIndexFromRef(attrs.r);
      if (columnIndex >= MAX_IMPORT_COLS) return '';
      row[columnIndex] = readCellValue(cellXml, attrs, sharedStrings);
      return '';
    });

    const trimmedRow = trimTrailingEmptyCells(row.map((value) => normalizeString(value)));
    if (trimmedRow.some((cell) => normalizeString(cell))) {
      rows.push(trimmedRow);
    }
    return rows.length >= MAX_IMPORT_ROWS ? sheetXml : '';
  });
  return rows.slice(0, MAX_IMPORT_ROWS);
}

const CANONICAL_IMPORT_COLUMNS = Object.freeze([
  {
    label: 'Bedrijfsnaam',
    keys: ['bedrijf', 'bedrijfsnaam', 'company', 'companyname', 'organisatie', 'naambedrijf'],
  },
  {
    label: 'Adres',
    keys: ['adres', 'address', 'stad', 'plaats', 'locatie'],
  },
  {
    label: 'E-mail',
    keys: ['email', 'e-mail', 'e mail', 'mail', 'mailadres'],
  },
  {
    label: 'Telefoonnummer',
    keys: ['telefoonnummer', 'telefoon', 'tel', 'phone', 'phonenumber'],
  },
  {
    label: 'Website',
    keys: ['website', 'domein', 'domain', 'url', 'site'],
  },
  {
    label: 'Contactpersoon',
    keys: ['contact', 'contactpersoon', 'naam'],
  },
  {
    label: 'Branche',
    keys: ['branche', 'branch'],
  },
  {
    label: 'Status',
    keys: ['status', 'fase'],
  },
  {
    label: 'Toegewezen aan',
    keys: ['toegewezenaan', 'verantwoordelijke', 'owner'],
  },
  {
    label: 'Service',
    keys: ['service', 'dienst'],
  },
  {
    label: 'Laatste actie',
    keys: ['laatsteactie', 'updatedat', 'datum'],
  },
]);

function buildHeaderIndex(row) {
  const indexByKey = new Map();
  (row || []).forEach((cell, index) => {
    const key = normalizeImportKey(cell);
    if (key && !indexByKey.has(key)) {
      indexByKey.set(key, index);
    }
  });
  return indexByKey;
}

function findColumnIndex(indexByKey, keys) {
  for (const key of keys) {
    const normalized = normalizeImportKey(key);
    if (indexByKey.has(normalized)) return indexByKey.get(normalized);
  }
  return -1;
}

function findHeaderRowIndex(rows) {
  return (rows || []).slice(0, 12).findIndex((row) => {
    const headerIndex = buildHeaderIndex(row);
    const companyIndex = findColumnIndex(headerIndex, CANONICAL_IMPORT_COLUMNS[0].keys);
    const contactIndexCount = CANONICAL_IMPORT_COLUMNS.slice(1, 5).filter(
      (column) => findColumnIndex(headerIndex, column.keys) !== -1
    ).length;
    return companyIndex !== -1 && contactIndexCount >= 1;
  });
}

function normalizeRowsToCanonicalImport(rows) {
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) return [];

  const headerIndex = buildHeaderIndex(rows[headerRowIndex]);
  const columnIndexes = CANONICAL_IMPORT_COLUMNS.map((column) =>
    findColumnIndex(headerIndex, column.keys)
  );

  return rows.slice(headerRowIndex + 1).map((row) =>
    columnIndexes.map((columnIndex) => (columnIndex === -1 ? '' : normalizeString(row[columnIndex])))
  ).filter((row) => row.some((cell) => normalizeString(cell)));
}

function combineWorksheetRows(worksheets) {
  const rows = [CANONICAL_IMPORT_COLUMNS.map((column) => column.label)];
  for (const worksheet of worksheets) {
    if (shouldSkipWorksheetName(worksheet.name)) continue;
    rows.push(...normalizeRowsToCanonicalImport(worksheet.rows));
    if (rows.length >= MAX_IMPORT_ROWS) break;
  }
  return rows.slice(0, MAX_IMPORT_ROWS);
}

function parseXlsxRows(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(getZipText(entries, 'xl/sharedStrings.xml'));
  const worksheets = listWorkbookWorksheets(entries)
    .filter((worksheet) => !shouldSkipWorksheetName(worksheet.name))
    .map((worksheet) => ({
      ...worksheet,
      rows: parseWorksheetRows(getZipText(entries, worksheet.path), sharedStrings),
    }))
    .filter((worksheet) => worksheet.rows.length);

  if (!worksheets.length) {
    throw new Error('Geen importeerbare datatab gevonden. De tab DATABASE wordt overgeslagen.');
  }

  const rows = combineWorksheetRows(worksheets);
  if (rows.length < 2) {
    throw new Error('Geen bruikbare bedrijfsrijen gevonden buiten de tab DATABASE.');
  }
  return rows;
}

function parseSpreadsheetUpload(payload = {}) {
  const fileName = normalizeString(payload.fileName);
  const extension = getExtension(fileName);
  const buffer = decodeUploadBuffer(payload.dataBase64);

  return parseSpreadsheetBuffer(buffer, {
    fileName,
    extension,
  });
}

function parseSpreadsheetBuffer(buffer, options = {}) {
  const extension = normalizeString(options.extension) || getExtension(options.fileName);
  if (extension === '.xlsx') {
    return {
      ok: true,
      fileType: 'xlsx',
      rows: parseXlsxRows(buffer),
    };
  }

  if (extension === '.csv' || extension === '.txt' || extension === '.tsv') {
    const preferred = extension === '.tsv' ? '\t' : '';
    return {
      ok: true,
      fileType: extension.slice(1) || 'csv',
      rows: parseDelimitedRows(buffer.toString('utf8'), preferred),
    };
  }

  throw new Error('Gebruik een .xlsx, .csv of .tsv bestand.');
}

function normalizeGoogleSheetsExportUrl(sourceUrl) {
  const input = normalizeString(sourceUrl);
  if (!input) {
    throw new Error('Geen Google Sheets-link ontvangen.');
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch (_error) {
    throw new Error('Gebruik een geldige Google Sheets-link.');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com') {
    throw new Error('Alleen Google Sheets-links van docs.google.com worden ondersteund.');
  }

  const sheetIdMatch = parsed.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (!sheetIdMatch) {
    throw new Error('Deze Google Sheets-link wordt niet herkend.');
  }

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetIdMatch[1])}/export?format=xlsx`;
}

async function fetchSpreadsheetRowsFromSourceUrl(sourceUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Spreadsheet synchroniseren is niet beschikbaar op deze server.');
  }

  const exportUrl = normalizeGoogleSheetsExportUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, deps.timeoutMs || 12000));

  try {
    const response = await fetchImpl(exportUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*',
      },
    });

    if (!response || !response.ok) {
      throw new Error('Google Sheet ophalen mislukt. Controleer of delen via link aan staat.');
    }

    const contentLength = Number(response.headers && response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      throw new Error('De Google Sheet is te groot om automatisch te synchroniseren.');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error('De Google Sheet export is leeg.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('De Google Sheet is te groot om automatisch te synchroniseren.');
    }

    const contentType =
      response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-type')
        : '';
    return {
      ...parseSpreadsheetBuffer(buffer, {
        fileName: 'google-sheet.xlsx',
        extension: inferExtensionFromContentType(contentType) || '.xlsx',
      }),
      sourceUrl: exportUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getGooglePlacesApiKey(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.googlePlacesApiKey ||
      env.GOOGLE_MAPS_SERVER_API_KEY ||
      env.GOOGLE_PLACES_API_KEY ||
      env.GOOGLE_MAPS_API_KEY
  );
}

function normalizeRealBusinessQuery(value) {
  return truncateText(value || DEFAULT_REAL_BUSINESS_QUERY, 140) || DEFAULT_REAL_BUSINESS_QUERY;
}

function getLocationPhraseFromQuery(query) {
  const normalized = normalizeRealBusinessQuery(query);
  const match = normalized.match(/\b(in|rond|bij|near)\s+(.+)$/i);
  if (!match) return normalized;
  return `${match[1]} ${match[2]}`.trim();
}

function buildGooglePlacesSearchQueries(query, count) {
  const baseQuery = normalizeRealBusinessQuery(query);
  const locationPhrase = getLocationPhraseFromQuery(baseQuery);
  const queries = [baseQuery];

  if (count > 60 || /\b(bedrijven|ondernemingen|mkb)\b/i.test(baseQuery)) {
    REAL_BUSINESS_CATEGORY_PREFIXES.forEach((prefix) => {
      queries.push(`${prefix} ${locationPhrase}`);
    });
  }

  return Array.from(new Set(queries.map(normalizeString).filter(Boolean))).slice(0, 12);
}

async function readJsonResponse(response) {
  if (response && typeof response.json === 'function') return response.json();
  if (response && typeof response.text === 'function') {
    const text = await response.text();
    try {
      return JSON.parse(text || '{}');
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function normalizeWebsiteDomain(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return normalizeString(parsed.hostname)
      .toLowerCase()
      .replace(/^www\./, '');
  } catch (_error) {
    return '';
  }
}

function isBlockedWebsiteHost(hostname) {
  const host = normalizeString(hostname).toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '[::1]') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,2})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function normalizeWebsiteUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (isBlockedWebsiteHost(parsed.hostname)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function getGooglePlaceName(place) {
  return normalizeString(
    place &&
      (place.displayName && typeof place.displayName === 'object'
        ? place.displayName.text
        : place.displayName)
  );
}

function getGooglePlaceKeys(place) {
  const keys = [];
  const id = normalizeString(place && place.id);
  const name = getGooglePlaceName(place).toLowerCase();
  const address = normalizeString(place && place.formattedAddress).toLowerCase();
  const domain = normalizeWebsiteDomain(place && place.websiteUri);

  if (id) keys.push(`place:${id}`);
  if (domain) keys.push(`domain:${domain}`);
  if (name && address) keys.push(`name-address:${name}|${address}`);
  return keys;
}

function shouldUseGooglePlace(place) {
  if (!place || typeof place !== 'object') return false;
  const status = normalizeString(place.businessStatus);
  return Boolean(getGooglePlaceName(place)) && (!status || status === 'OPERATIONAL');
}

async function fetchGooglePlacesPage({ query, count, pageToken }, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const apiKey = getGooglePlacesApiKey(deps);
  if (typeof fetchImpl !== 'function') {
    throw createServiceError('Bedrijven ophalen is niet beschikbaar op deze server.', 'FETCH_UNAVAILABLE', 503);
  }
  if (!apiKey) {
    throw createServiceError(
      'Google Places API-key ontbreekt. Zet GOOGLE_MAPS_SERVER_API_KEY of GOOGLE_MAPS_API_KEY in de serveromgeving.',
      'GOOGLE_PLACES_NOT_CONFIGURED',
      503
    );
  }

  const body = {
    textQuery: normalizeRealBusinessQuery(query),
    pageSize: Math.min(20, Math.max(1, count)),
    languageCode: 'nl',
    regionCode: 'NL',
    includePureServiceAreaBusinesses: true,
  };
  if (pageToken) body.pageToken = pageToken;

  const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  const data = await readJsonResponse(response);

  if (!response || !response.ok) {
    const googleMessage =
      normalizeString(data && data.error && data.error.message) ||
      'Google Places kon geen bedrijven ophalen.';
    throw createServiceError(googleMessage, 'GOOGLE_PLACES_FAILED', response && response.status ? response.status : 400);
  }

  return {
    places: Array.isArray(data && data.places) ? data.places : [],
    nextPageToken: normalizeString(data && data.nextPageToken),
  };
}

async function fetchGooglePlacesBusinesses(input = {}, deps = {}) {
  const requestedCount = parsePositiveInt(input.count, MAX_REAL_BUSINESS_ROWS, 1, MAX_REAL_BUSINESS_ROWS);
  const query = normalizeRealBusinessQuery(input.query);
  const queries = buildGooglePlacesSearchQueries(query, requestedCount);
  const places = [];
  const seenKeys = new Set();

  for (const searchQuery of queries) {
    let pageToken = '';
    for (let pageIndex = 0; pageIndex < 3 && places.length < requestedCount; pageIndex += 1) {
      const page = await fetchGooglePlacesPage(
        {
          query: searchQuery,
          count: requestedCount - places.length,
          pageToken,
        },
        deps
      );

      page.places.filter(shouldUseGooglePlace).forEach((place) => {
        const keys = getGooglePlaceKeys(place);
        if (!keys.length || keys.some((key) => seenKeys.has(key))) return;
        keys.forEach((key) => seenKeys.add(key));
        places.push(place);
      });

      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    if (places.length >= requestedCount) break;
  }

  return places.slice(0, requestedCount);
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#64;|&#x40;|%40/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&');
}

function extractEmailCandidatesFromHtml(html) {
  const decoded = decodeHtmlEntities(html);
  const candidates = new Set();
  decoded.replace(/mailto:([^"'\s?<>]+)/gi, (_match, value) => {
    candidates.add(decodeURIComponent(value).toLowerCase());
    return '';
  });
  decoded.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (value) => {
    candidates.add(value.toLowerCase());
    return '';
  });
  return Array.from(candidates).filter((email) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) return false;
    if (/^(noreply|no-reply|donotreply|example)@/i.test(email)) return false;
    return true;
  });
}

function pickBestBusinessEmail(emails, websiteUrl) {
  const websiteDomain = normalizeWebsiteDomain(websiteUrl);
  const sameDomain = emails.find((email) => normalizeWebsiteDomain(email.split('@')[1]) === websiteDomain);
  return sameDomain || emails[0] || '';
}

async function discoverBusinessEmailFromWebsite(websiteUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
  if (!normalizedUrl || typeof fetchImpl !== 'function') return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, deps.timeoutMs || 4500));
  try {
    const response = await fetchImpl(normalizedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.7,*/*;q=0.2',
        'user-agent': 'SoftoraDatabaseImporter/1.0',
      },
    });
    if (!response || !response.ok || typeof response.text !== 'function') return '';
    const contentType =
      response.headers && typeof response.headers.get === 'function'
        ? normalizeString(response.headers.get('content-type')).toLowerCase()
        : '';
    const contentLength =
      response.headers && typeof response.headers.get === 'function'
        ? Number(response.headers.get('content-length') || 0)
        : 0;
    if (contentType && !/(html|text)/.test(contentType)) return '';
    if (Number.isFinite(contentLength) && contentLength > 700000) return '';
    const text = await response.text();
    return pickBestBusinessEmail(extractEmailCandidatesFromHtml(text.slice(0, 350000)), normalizedUrl);
  } catch (_error) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function inferBranchFromGoogleTypes(types = []) {
  const normalized = new Set((Array.isArray(types) ? types : []).map((type) => normalizeString(type).toLowerCase()));
  if (['restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway'].some((type) => normalized.has(type))) return 'Horeca & Restaurants';
  if (['store', 'clothing_store', 'shoe_store', 'jewelry_store', 'furniture_store'].some((type) => normalized.has(type))) return 'Retail & Winkels';
  if (['real_estate_agency', 'accounting', 'lawyer', 'insurance_agency'].some((type) => normalized.has(type))) return 'Zakelijke Dienstverlening';
  if (['general_contractor', 'plumber', 'electrician', 'roofing_contractor'].some((type) => normalized.has(type))) return 'Bouw & Vastgoed';
  if (['doctor', 'dentist', 'physiotherapist', 'health'].some((type) => normalized.has(type))) return 'Gezondheidszorg';
  return 'Overig';
}

async function mapGooglePlacesToImportRows(places, deps = {}) {
  const shouldEnrichEmails = deps.enrichEmails !== false;
  const rows = [CANONICAL_IMPORT_COLUMNS.map((column) => column.label)];
  const today = new Date().toISOString().slice(0, 10);

  for (const place of places) {
    const websiteUrl = normalizeWebsiteUrl(place && place.websiteUri);
    const websiteDomain = normalizeWebsiteDomain(websiteUrl);
    const email = shouldEnrichEmails ? await discoverBusinessEmailFromWebsite(websiteUrl, deps) : '';
    rows.push([
      getGooglePlaceName(place),
      normalizeString(place && place.formattedAddress) || 'Onbekend',
      email || '—',
      normalizeString(place && (place.nationalPhoneNumber || place.internationalPhoneNumber)) || '—',
      websiteDomain || websiteUrl || '',
      '',
      inferBranchFromGoogleTypes(place && place.types),
      'benaderbaar',
      'Serve',
      'website',
      today,
    ]);
  }

  return rows;
}

async function fetchRealBusinessRows(input = {}, deps = {}) {
  const count = parsePositiveInt(input.count, MAX_REAL_BUSINESS_ROWS, 1, MAX_REAL_BUSINESS_ROWS);
  const query = normalizeRealBusinessQuery(input.query);
  const places = await fetchGooglePlacesBusinesses({ query, count }, deps);
  const rows = await mapGooglePlacesToImportRows(places, {
    ...deps,
    enrichEmails: input.enrichEmails !== false,
  });

  return {
    ok: true,
    fileType: 'google-places',
    source: 'google-places',
    query,
    requested: count,
    found: Math.max(0, rows.length - 1),
    emailFound: rows.slice(1).filter((row) => normalizeString(row[2]) && normalizeString(row[2]) !== '—').length,
    rows,
  };
}

function createPremiumDatabaseImportCoordinator(deps = {}) {
  const { fetchImpl = global.fetch, env = process.env } = deps;

  function sendImportResponse(req, res) {
    try {
      const result = parseSpreadsheetUpload(req.body || {});
      if (!Array.isArray(result.rows) || result.rows.length < 2) {
        return res.status(400).json({
          ok: false,
          error: 'Het bestand bevat geen bruikbare rijen.',
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: normalizeString(error && error.message) || 'Uploaden mislukt.',
      });
    }
  }

  async function sendSyncResponse(req, res) {
    try {
      const result = await fetchSpreadsheetRowsFromSourceUrl(req.body && req.body.sourceUrl, {
        fetchImpl,
      });
      if (!Array.isArray(result.rows) || result.rows.length < 2) {
        return res.status(400).json({
          ok: false,
          error: 'De Google Sheet bevat geen bruikbare datarijen buiten de tab DATABASE.',
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: normalizeString(error && error.message) || 'Synchroniseren mislukt.',
      });
    }
  }

  async function sendRealBusinessesResponse(req, res) {
    try {
      const result = await fetchRealBusinessRows(req.body || {}, {
        fetchImpl,
        env,
      });
      if (!Array.isArray(result.rows) || result.rows.length < 2) {
        return res.status(422).json({
          ok: false,
          code: 'NO_REAL_BUSINESSES_FOUND',
          error: 'Geen echte bedrijven gevonden voor deze zoekopdracht.',
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'REAL_BUSINESS_IMPORT_FAILED';
      return res.status(error && error.statusCode ? error.statusCode : 400).json({
        ok: false,
        code,
        error: truncateText(normalizeString(error && error.message) || 'Bedrijven ophalen mislukt.', 500),
      });
    }
  }

  return {
    sendSyncResponse,
    sendImportResponse,
    sendRealBusinessesResponse,
  };
}

module.exports = {
  buildGooglePlacesSearchQueries,
  createPremiumDatabaseImportCoordinator,
  detectDelimitedSeparator,
  fetchRealBusinessRows,
  fetchSpreadsheetRowsFromSourceUrl,
  listWorkbookWorksheets,
  normalizeGoogleSheetsExportUrl,
  parseDelimitedRows,
  parseSpreadsheetUpload,
  parseXlsxRows,
  shouldSkipWorksheetName,
};
