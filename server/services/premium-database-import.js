const path = require('path');
const zlib = require('zlib');
const { buildOpenAiContextHeaders } = require('./openai-request-context');
const {
  OPENAI_PRICING_SOURCE_URL,
  getOpenAiTextModelRates,
  getOpenAiWebSearchUsdPerCall,
} = require('./openai-pricing');
const {
  recordSoftoraApiCostEvent,
} = require('./softora-api-cost-ledger');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const MAX_IMPORT_COLS = 50;
const MAX_REAL_BUSINESS_ROWS = 100;
const MAX_DEEP_SEARCH_ROWS = 100;
const DEFAULT_DEEP_SEARCH_ESTIMATE_ROWS = 25;
const MAX_DEEP_SEARCH_ESTIMATE_ROWS = 500;
const MAX_DEEP_SEARCH_EXCLUDE_ITEMS = 5000;
const MAX_DEEP_SEARCH_PROMPT_EXCLUDE_ITEMS = 500;
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
const DEFAULT_OPENAI_DATABASE_SEARCH_MODEL = 'gpt-5.4';
const DEFAULT_OPENAI_DATABASE_SEARCH_REASONING_EFFORT = 'high';
const DEFAULT_OPENAI_DATABASE_SEARCH_TIMEOUT_MS = 720000;
const MAX_OPENAI_DATABASE_SEARCH_TIMEOUT_MS = 760000;
const DEFAULT_OPENAI_DATABASE_SEARCH_RATE_LIMIT_RETRIES = 2;
const DEFAULT_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS = 8000;
const MAX_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS = 30000;
const ESTIMATED_DEEP_SEARCH_INPUT_TOKENS_PER_BATCH = 6000;
const ESTIMATED_DEEP_SEARCH_OUTPUT_TOKENS_PER_COMPANY = 1400;
const ESTIMATED_DEEP_SEARCH_WEB_SEARCH_CALLS_PER_BATCH = 1;
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

function getOpenAiApiKey(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(deps.openAiApiKey || env.OPENAI_API_KEY);
}

function getOpenAiApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(deps.openAiApiBaseUrl || env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  );
}

function getOpenAiDatabaseSearchModel(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    env.OPENAI_DATABASE_SEARCH_MODEL || deps.openAiDatabaseSearchModel || DEFAULT_OPENAI_DATABASE_SEARCH_MODEL
  );
}

function getOpenAiDatabaseSearchReasoningEffort(model, deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = normalizeString(deps.openAiReasoningEffort || env.OPENAI_DATABASE_SEARCH_REASONING_EFFORT);
  if (['none', 'low', 'medium', 'high', 'xhigh'].includes(explicit)) return explicit;
  return DEFAULT_OPENAI_DATABASE_SEARCH_REASONING_EFFORT;
}

function getOpenAiDatabaseSearchTimeoutMs(deps = {}) {
  const env = deps.env || process.env || {};
  const explicitDepsTimeout = Number(deps.openAiTimeoutMs);
  if (Number.isFinite(explicitDepsTimeout) && explicitDepsTimeout > 0) {
    return Math.min(explicitDepsTimeout, MAX_OPENAI_DATABASE_SEARCH_TIMEOUT_MS);
  }
  const explicitEnvTimeout = Number(env.OPENAI_DATABASE_SEARCH_TIMEOUT_MS);
  if (Number.isFinite(explicitEnvTimeout) && explicitEnvTimeout > 0) {
    return Math.max(30000, Math.min(explicitEnvTimeout, MAX_OPENAI_DATABASE_SEARCH_TIMEOUT_MS));
  }
  return DEFAULT_OPENAI_DATABASE_SEARCH_TIMEOUT_MS;
}

function isAbortError(error) {
  const text = [
    error && error.name,
    error && error.code,
    error && error.message,
  ]
    .map(normalizeString)
    .join(' ')
    .toLowerCase();
  return /\babort|aborted|aborterror/.test(text);
}

function createOpenAiDeepSearchTimeoutError() {
  return createServiceError(
    'AI zoeken duurde te lang en is veilig gestopt. Probeer opnieuw of kies tijdelijk minder bedrijven.',
    'OPENAI_DEEP_SEARCH_TIMEOUT',
    504
  );
}

function getOpenAiDatabaseSearchRateLimitRetries(deps = {}) {
  const env = deps.env || process.env || {};
  const explicitDepsRetries = Number(deps.openAiRateLimitRetries);
  if (Number.isFinite(explicitDepsRetries) && explicitDepsRetries >= 0) {
    return Math.min(4, Math.floor(explicitDepsRetries));
  }
  const explicitEnvRetries = Number(env.OPENAI_DATABASE_SEARCH_RATE_LIMIT_RETRIES);
  if (Number.isFinite(explicitEnvRetries) && explicitEnvRetries >= 0) {
    return Math.min(4, Math.floor(explicitEnvRetries));
  }
  return DEFAULT_OPENAI_DATABASE_SEARCH_RATE_LIMIT_RETRIES;
}

function getHeaderValue(headers, name) {
  return headers && typeof headers.get === 'function' ? normalizeString(headers.get(name)) : '';
}

function clampOpenAiRateLimitWaitMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS;
  return Math.max(250, Math.min(Math.ceil(parsed), MAX_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS));
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  const raw = normalizeString(value);
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : 0;
}

function getOpenAiRateLimitRetryDelayMs(response, data, deps = {}) {
  const explicitDelay = Number(deps.openAiRateLimitRetryDelayMs);
  if (Number.isFinite(explicitDelay) && explicitDelay >= 0) {
    return Math.min(Math.ceil(explicitDelay), MAX_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS);
  }

  const retryAfterMsHeader = Number(getHeaderValue(response && response.headers, 'retry-after-ms'));
  if (Number.isFinite(retryAfterMsHeader) && retryAfterMsHeader > 0) {
    return clampOpenAiRateLimitWaitMs(retryAfterMsHeader);
  }

  const retryAfterHeaderMs = parseRetryAfterMs(getHeaderValue(response && response.headers, 'retry-after'));
  if (retryAfterHeaderMs > 0) return clampOpenAiRateLimitWaitMs(retryAfterHeaderMs);

  const message = normalizeString(data && data.error && data.error.message);
  const messageDelay = message.match(/try again in\s+([0-9.]+)\s*s/i);
  if (messageDelay) return clampOpenAiRateLimitWaitMs(Number(messageDelay[1]) * 1000);

  return DEFAULT_OPENAI_DATABASE_SEARCH_RATE_LIMIT_WAIT_MS;
}

function isOpenAiRateLimitResponse(response, data) {
  if (response && Number(response.status) === 429) return true;
  const code = normalizeString(data && data.error && data.error.code).toLowerCase();
  return code === 'rate_limit_exceeded';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createOpenAiDeepSearchRateLimitError() {
  return createServiceError(
    'OpenAI-snelheidslimiet geraakt. We hebben automatisch opnieuw geprobeerd; probeer over enkele seconden nogmaals.',
    'OPENAI_DEEP_SEARCH_RATE_LIMIT',
    429
  );
}

function getOpenAiDatabaseSearchPricing(model) {
  const rates = getOpenAiTextModelRates(model || DEFAULT_OPENAI_DATABASE_SEARCH_MODEL);
  return {
    inputUsdPerMillion: rates.input,
    outputUsdPerMillion: rates.output,
    cachedInputUsdPerMillion: rates.cachedInput,
  };
}

function extractOpenAiUsage(data) {
  const usage = data && data.usage && typeof data.usage === 'object' ? data.usage : {};
  const inputTokens = Math.max(0, Number(usage.input_tokens || usage.prompt_tokens || 0) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens || usage.completion_tokens || 0) || 0);
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details
    : {};
  const cachedInputTokens = Math.max(0, Number(inputDetails.cached_tokens || 0) || 0);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.min(inputTokens, cachedInputTokens),
  };
}

function countOpenAiWebSearchCalls(data) {
  const output = Array.isArray(data && data.output) ? data.output : [];
  return output.filter((item) => normalizeString(item && item.type) === 'web_search_call').length;
}

function estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls }) {
  const pricing = getOpenAiDatabaseSearchPricing(model);
  const safeUsage = usage || {};
  const inputTokens = Math.max(0, Number(safeUsage.inputTokens || 0) || 0);
  const outputTokens = Math.max(0, Number(safeUsage.outputTokens || 0) || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(safeUsage.cachedInputTokens || 0) || 0));
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const cachedRate = Number.isFinite(pricing.cachedInputUsdPerMillion)
    ? pricing.cachedInputUsdPerMillion
    : pricing.inputUsdPerMillion;
  const inputUsd = (billableInputTokens / 1000000) * pricing.inputUsdPerMillion;
  const cachedInputUsd = (cachedInputTokens / 1000000) * cachedRate;
  const outputUsd = (outputTokens / 1000000) * pricing.outputUsdPerMillion;
  const webSearchUsdPerCall = getOpenAiWebSearchUsdPerCall();
  const webSearchUsd = Math.max(0, Number(webSearchCalls || 0) || 0) * webSearchUsdPerCall;
  const totalUsd = inputUsd + cachedInputUsd + outputUsd + webSearchUsd;

  return {
    currency: 'USD',
    estimatedUsd: Number(totalUsd.toFixed(6)),
    inputUsd: Number((inputUsd + cachedInputUsd).toFixed(6)),
    outputUsd: Number(outputUsd.toFixed(6)),
    webSearchUsd: Number(webSearchUsd.toFixed(6)),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    webSearchCalls: Math.max(0, Number(webSearchCalls || 0) || 0),
    pricing: {
      inputUsdPerMillion: pricing.inputUsdPerMillion,
      outputUsdPerMillion: pricing.outputUsdPerMillion,
      webSearchUsdPerCall,
      source: OPENAI_PRICING_SOURCE_URL,
    },
    note: 'Schatting op basis van OpenAI tokengebruik en web-search calls; exclusief eventuele regionale toeslagen.',
  };
}

function estimateDeepSearchBusinessRunCost(input = {}, deps = {}) {
  const env = deps.env || process.env || {};
  const requested = parsePositiveInt(
    input.count,
    DEFAULT_DEEP_SEARCH_ESTIMATE_ROWS,
    1,
    MAX_DEEP_SEARCH_ESTIMATE_ROWS
  );
  const model = getOpenAiDatabaseSearchModel({ ...deps, env });
  const reasoningEffort = getOpenAiDatabaseSearchReasoningEffort(model, { ...deps, env });
  const batchSize = MAX_DEEP_SEARCH_ROWS;
  const estimatedBatches = Math.max(1, Math.ceil(requested / batchSize));
  const usage = {
    inputTokens: estimatedBatches * ESTIMATED_DEEP_SEARCH_INPUT_TOKENS_PER_BATCH,
    outputTokens: requested * ESTIMATED_DEEP_SEARCH_OUTPUT_TOKENS_PER_COMPANY,
    cachedInputTokens: 0,
  };
  const webSearchCalls = estimatedBatches * ESTIMATED_DEEP_SEARCH_WEB_SEARCH_CALLS_PER_BATCH;
  const cost = estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls });

  return {
    ok: true,
    source: 'openai-web-search-estimate',
    requested,
    maxRequested: MAX_DEEP_SEARCH_ESTIMATE_ROWS,
    batchSize,
    estimatedBatches,
    model,
    reasoningEffort,
    estimateOnly: true,
    cost: {
      ...cost,
      note: 'Voorcalculatie op basis van het actieve deep-search model; er is geen OpenAI-call uitgevoerd.',
    },
  };
}

function normalizeDeepSearchTarget(value) {
  return truncateText(value, 240);
}

function parseDeepSearchTargetParts(value) {
  const parts = normalizeString(value)
    .split('|')
    .map((part) => normalizeString(part))
    .filter(Boolean);
  return {
    country: parts[0] || '',
    province: parts.length >= 4 ? parts[1] : '',
    municipality: parts.length >= 4 ? parts[2] : parts.length >= 3 ? parts[1] : '',
    place: parts.length ? parts[parts.length - 1] : '',
  };
}

function normalizeDeepSearchLocationText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addDeepSearchPlaceAlias(aliases, value) {
  const normalized = normalizeDeepSearchLocationText(value);
  if (normalized && normalized.length >= 2) aliases.add(normalized);
}

function buildDeepSearchPlaceAliases(place) {
  const aliases = new Set();
  const normalized = normalizeDeepSearchLocationText(place);
  addDeepSearchPlaceAlias(aliases, normalized);
  addDeepSearchPlaceAlias(aliases, normalized.replace(/\s+gem\s+.+$/, ''));

  if (normalized.startsWith('st ')) {
    addDeepSearchPlaceAlias(aliases, `sint ${normalized.slice(3)}`);
  }
  if (normalized.startsWith('sint ')) {
    addDeepSearchPlaceAlias(aliases, `st ${normalized.slice(5)}`);
  }
  if (normalized === 's hertogenbosch') addDeepSearchPlaceAlias(aliases, 'den bosch');
  if (normalized === 's gravenhage') addDeepSearchPlaceAlias(aliases, 'den haag');

  const compoundBeersMatch = normalized.match(/^(?:oost\s+west\s+en\s+)(.+)$/);
  if (compoundBeersMatch) addDeepSearchPlaceAlias(aliases, compoundBeersMatch[1]);

  return Array.from(aliases);
}

function normalizedTextIncludesPhrase(text, phrase) {
  const normalizedText = ` ${normalizeDeepSearchLocationText(text)} `;
  const normalizedPhrase = normalizeDeepSearchLocationText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedText.includes(` ${normalizedPhrase} `);
}

function splitDeepSearchAddressSegments(address) {
  return normalizeString(address)
    .split(/[,;\n|]+/)
    .map((part) => normalizeString(part))
    .filter(Boolean);
}

function hasDutchPostcode(value) {
  return /\b[1-9][0-9]{3}\s?[a-z]{2}\b/i.test(normalizeString(value));
}

function hasStreetNumberSignal(value) {
  const raw = normalizeString(value);
  return /[a-z]/i.test(raw) && /\b\d{1,5}\s?[a-z]?\b/i.test(raw);
}

function isServiceAreaText(value) {
  const normalized = normalizeDeepSearchLocationText(value);
  return /\b(?:werkgebied|servicegebied|actief|werkzaam|bedient|regio|omgeving|bezorgt|levering)\b/.test(
    normalized
  );
}

function addressHasPhysicalPlaceAlias(address, alias) {
  const segments = splitDeepSearchAddressSegments(address);
  if (!segments.length) return false;
  return segments.some((segment, index) => {
    if (!normalizedTextIncludesPhrase(segment, alias)) return false;
    const previous = segments[index - 1] || '';
    const next = segments[index + 1] || '';
    const localContext = [previous, segment, next].filter(Boolean).join(', ');
    const hasPhysicalSignal =
      hasDutchPostcode(segment) ||
      hasDutchPostcode(localContext) ||
      hasStreetNumberSignal(segment) ||
      (hasStreetNumberSignal(previous) && !isServiceAreaText(segment));
    return hasPhysicalSignal && !isServiceAreaText(segment);
  });
}

function deepSearchBusinessMatchesTarget(business, targetParts) {
  const place = normalizeString(targetParts && targetParts.place);
  if (!place) return true;
  return buildDeepSearchPlaceAliases(place).some((alias) =>
    addressHasPhysicalPlaceAlias(business && business.adres, alias)
  );
}

function normalizeDeepSearchExcludeItems(items, maxItems = MAX_DEEP_SEARCH_EXCLUDE_ITEMS) {
  const values = Array.isArray(items) ? items : [];
  const seen = new Set();
  const result = [];
  const limit = Math.max(1, Math.min(10000, Number(maxItems) || MAX_DEEP_SEARCH_EXCLUDE_ITEMS));
  values.forEach((item) => {
    const normalized = truncateText(item, 160);
    const key = normalizeImportKey(normalized);
    if (!normalized || !key || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function collectDeepSearchExcludeItems(input = {}) {
  const rawItems = [];
  function add(value) {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    const normalized = normalizeString(value);
    if (normalized) rawItems.push(normalized);
  }

  add(input.exclude);
  add(input.excludeItems);
  add(input.excludeKeys);
  add(input.seen);
  return normalizeDeepSearchExcludeItems(rawItems, MAX_DEEP_SEARCH_EXCLUDE_ITEMS);
}

function addDeepSearchExcludeKey(keys, key) {
  const normalized = normalizeString(key);
  if (normalized) keys.add(normalized);
}

function addDeepSearchExcludeEmail(keys, value) {
  const email = normalizeDeepSearchEmail(value);
  if (email) addDeepSearchExcludeKey(keys, `email:${email}`);
}

function addDeepSearchExcludeDomain(keys, value) {
  const domain = normalizeWebsiteDomain(value);
  if (domain) addDeepSearchExcludeKey(keys, `domain:${domain}`);
}

function addDeepSearchExcludeCompanyAddress(keys, company, address) {
  const companyKey = normalizeImportKey(company);
  const addressKey = normalizeImportKey(address);
  if (companyKey && addressKey) addDeepSearchExcludeKey(keys, `company-address:${companyKey}|${addressKey}`);
}

function addDeepSearchExcludeItemKeys(keys, item) {
  const raw = normalizeString(item);
  if (!raw) return;

  const prefixed = raw.match(/^(email|domain|company-address)\s*:\s*(.+)$/i);
  if (prefixed) {
    const type = prefixed[1].toLowerCase();
    const value = normalizeString(prefixed[2]);
    if (type === 'email') addDeepSearchExcludeEmail(keys, value);
    if (type === 'domain') addDeepSearchExcludeDomain(keys, value);
    if (type === 'company-address') {
      const parts = value.split('|').map((part) => normalizeString(part)).filter(Boolean);
      if (parts.length >= 2) addDeepSearchExcludeCompanyAddress(keys, parts[0], parts.slice(1).join(' '));
    }
    return;
  }

  const emailMatches = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  emailMatches.forEach((email) => addDeepSearchExcludeEmail(keys, email));

  raw
    .split(/[\s|,;<>()[\]{}"']+/)
    .map((part) => normalizeString(part))
    .filter((part) => part && part.includes('.') && !part.includes('@'))
    .forEach((part) => addDeepSearchExcludeDomain(keys, part));

  const parts = raw.split('|').map((part) => normalizeString(part)).filter(Boolean);
  if (parts.length >= 2) addDeepSearchExcludeCompanyAddress(keys, parts[0], parts[parts.length - 1]);
}

function buildDeepSearchExcludeKeySet(items) {
  const keys = new Set();
  normalizeDeepSearchExcludeItems(items).forEach((item) => {
    addDeepSearchExcludeItemKeys(keys, item);
  });
  return keys;
}

function buildDeepSearchJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      target: { type: 'string' },
      businesses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bedrijfsnaam: { type: 'string' },
            adres: { type: 'string' },
            email: { type: 'string' },
            telefoonnummer: { type: 'string' },
            website: { type: 'string' },
            bronnen: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['bedrijfsnaam', 'adres', 'email', 'telefoonnummer', 'website', 'bronnen'],
        },
      },
      placeComplete: { type: 'boolean' },
      completionReason: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['target', 'businesses', 'placeComplete', 'completionReason', 'notes'],
  };
}

function buildDeepSearchPrompt({ target, count, excludeItems, batchNumber }) {
  const exclusions = normalizeDeepSearchExcludeItems(excludeItems, MAX_DEEP_SEARCH_PROMPT_EXCLUDE_ITEMS);
  const targetParts = parseDeepSearchTargetParts(target);
  const exclusionText = exclusions.length
    ? exclusions.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : 'Geen eerdere resultaten meegegeven.';
  const strictLocationRule = targetParts.place
    ? `Harde regioregel: lever alleen bedrijven met een fysiek adres in plaats "${targetParts.place}", gemeente "${targetParts.municipality}", provincie "${targetParts.province}", ${targetParts.country || 'Nederland'}. Bedrijven uit omliggende plaatsen, alleen servicegebieden of alleen dezelfde gemeente tellen niet mee.`
    : 'Harde regioregel: lever alleen bedrijven met een fysiek adres binnen het opgegeven zoekgebied.';

  const systemPrompt = [
    'Je bent een nauwkeurige Nederlandse B2B-researchassistent voor Softora.',
    'Gebruik live web search en lever alleen bedrijven aan waarvan bedrijfsnaam, adres, e-mail, telefoonnummer en website online verifieerbaar zijn.',
    strictLocationRule,
    'Neem alleen actieve bedrijven of bedrijven die duidelijk operationeel lijken mee.',
    'Neem geen verenigingen, scholen, overheidsinstanties of stichtingen mee, tenzij ze commercieel interessant zijn.',
    'Vermijd dubbele bedrijven en verzin nooit ontbrekende gegevens.',
    'Werk in vervolgbatches: dit is niet één chatsessie maar een doorlopende zoekrun met eerder gevonden resultaten als uitsluitlijst.',
    'Zet placeComplete altijd op false wanneer je in deze response één of meer bedrijven aanlevert. Softora vraagt daarna automatisch om de volgende lading.',
    'Zet placeComplete alleen op true wanneer je in deze response nul nieuwe complete bedrijven aanlevert én na live web search geen extra nieuwe complete en verifieerbare bedrijven voor deze plaats meer kunt vinden.',
    'Gebruik geen placeholders zoals onbekend, niet gevonden, n.v.t. of lege waarden.',
    'Geef uitsluitend JSON terug volgens het schema.',
  ].join('\n');

  const userPrompt = [
    `Vind maximaal ${count} nieuwe actieve bedrijven in: ${target}.`,
    `Dit is batch ${Math.max(1, Number(batchNumber) || 1)} voor deze plek. Zoek verder dan de meest voor de hand liggende resultaten.`,
    '',
    'Lever exact deze velden per bedrijf:',
    'Bedrijfsnaam | Adres | E-mail | Telefoonnummer | Website',
    '',
    'Belangrijke regels:',
    `- ${strictLocationRule}`,
    '- Het adres moet de gevraagde plaats tonen. Een bedrijf in een andere plaats binnen dezelfde gemeente of provincie mag niet mee.',
    '- Als een van deze velden ontbreekt, lever het bedrijf niet aan.',
    '- Gebruik bij voorkeur de officiele bedrijfswebsite als bron voor e-mail en telefoon.',
    '- Website mag een domein of volledige URL zijn, maar moet echt bij het bedrijf horen.',
    '- Minimaal één bron per bedrijf moet op hetzelfde domein staan als de opgegeven website.',
    '- Vermijd dubbele bedrijven, handelsnamen met dezelfde website en eerder gevonden resultaten.',
    '- Gebruik bronnen als URL-lijst per bedrijf, zodat de controle zichtbaar blijft.',
    '- Als je bedrijven teruggeeft, zet placeComplete op false, ook als je denkt dat dit misschien de laatste lading is.',
    '- Alleen als je nul nieuwe complete bedrijven kunt vinden na breder doorzoeken, zet je placeComplete op true en leg je kort uit waarom in completionReason.',
    '- Als je nog niet zeker bent dat de plaats leeg is, of als je slechts de eerste zichtbare lading hebt, zet placeComplete op false.',
    '',
    'Eerder gevonden of al bestaande resultaten die je moet vermijden:',
    exclusionText,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function extractOpenAiResponsesText(data) {
  if (typeof data?.output_text === 'string') return normalizeString(data.output_text);
  const parts = [];

  function visit(value) {
    if (!value) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;
    if (value.type === 'output_text' && typeof value.text === 'string') {
      parts.push(value.text);
      return;
    }
    if (typeof value.output_text === 'string') parts.push(value.output_text);
    if (typeof value.text === 'string' && (value.type === 'text' || value.type === 'message')) {
      parts.push(value.text);
    }
    if (Array.isArray(value.content)) visit(value.content);
    if (Array.isArray(value.output)) visit(value.output);
  }

  visit(data && data.output);
  if (!parts.length) {
    const chatContent = data?.choices?.[0]?.message?.content;
    if (typeof chatContent === 'string') parts.push(chatContent);
  }
  return normalizeString(parts.join('\n'));
}

function parseJsonObjectFromText(text) {
  const raw = normalizeString(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (__error) {
      return null;
    }
  }
}

function isPlaceholderValue(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return true;
  return /^(?:-|—|n\/a|na|nvt|n\.v\.t\.|null|geen|geen info|onbekend|unknown|niet gevonden|not found)$/i.test(
    normalized
  );
}

function normalizeDeepSearchEmail(value) {
  const raw = normalizeString(value).toLowerCase();
  if (isPlaceholderValue(raw)) return '';
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function normalizeDeepSearchPhone(value) {
  const raw = normalizeString(value);
  if (isPlaceholderValue(raw)) return '';
  const digits = raw.replace(/\D+/g, '');
  return digits.length >= 7 ? raw : '';
}

function normalizeDeepSearchSources(value) {
  const rawSources = Array.isArray(value) ? value : [];
  const sources = [];
  const seen = new Set();
  rawSources.forEach((source) => {
    const normalized = normalizeWebsiteUrl(source);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    sources.push(normalized);
  });
  return sources.slice(0, 8);
}

function normalizeDeepSearchBusiness(record) {
  if (!record || typeof record !== 'object') return null;
  const bedrijfsnaam = truncateText(record.bedrijfsnaam || record.bedrijf || record.company || '', 180);
  const adres = truncateText(record.adres || record.address || '', 220);
  const email = normalizeDeepSearchEmail(record.email || record['e-mail'] || record.mail);
  const telefoonnummer = normalizeDeepSearchPhone(record.telefoonnummer || record.telefoon || record.phone);
  const websiteUrl = normalizeWebsiteUrl(record.website || record.url || record.site);
  const website = normalizeWebsiteDomain(websiteUrl);
  const bronnen = normalizeDeepSearchSources(record.bronnen || record.sources || record.sourceUrls);

  if (
    isPlaceholderValue(bedrijfsnaam) ||
    isPlaceholderValue(adres) ||
    !email ||
    !telefoonnummer ||
    !website
  ) {
    return null;
  }

  return {
    bedrijfsnaam,
    adres,
    email,
    telefoonnummer,
    website,
    bronnen,
  };
}

function getDeepSearchBusinessKeys(business) {
  const keys = [
    `email:${business.email.toLowerCase()}`,
    `domain:${business.website.toLowerCase()}`,
    `company-address:${normalizeImportKey(business.bedrijfsnaam)}|${normalizeImportKey(business.adres)}`,
  ];
  return keys.filter((key) => !key.endsWith(':') && !key.endsWith('|'));
}

function deepSearchBusinessHasOfficialWebsiteSource(business) {
  const websiteDomain = normalizeWebsiteDomain(business && business.website);
  if (!websiteDomain) return false;
  return (business && Array.isArray(business.bronnen) ? business.bronnen : []).some((source) => {
    const sourceDomain = normalizeWebsiteDomain(source);
    return sourceDomain === websiteDomain || sourceDomain.endsWith(`.${websiteDomain}`);
  });
}

function dedupeDeepSearchBusinesses(businesses, targetParts = {}, excludeItems = []) {
  const seen = new Set();
  const excluded = buildDeepSearchExcludeKeySet(excludeItems);
  const result = [];
  (businesses || []).forEach((business) => {
    const normalized = normalizeDeepSearchBusiness(business);
    if (!normalized) return;
    if (!deepSearchBusinessMatchesTarget(normalized, targetParts)) return;
    if (!deepSearchBusinessHasOfficialWebsiteSource(normalized)) return;
    const keys = getDeepSearchBusinessKeys(normalized);
    if (keys.some((key) => excluded.has(key))) return;
    if (keys.some((key) => seen.has(key))) return;
    keys.forEach((key) => seen.add(key));
    result.push(normalized);
  });
  return result;
}

function mapDeepSearchBusinessesToRows(businesses) {
  const rows = [CANONICAL_IMPORT_COLUMNS.map((column) => column.label)];
  const today = new Date().toISOString().slice(0, 10);
  businesses.forEach((business) => {
    rows.push([
      business.bedrijfsnaam,
      business.adres,
      business.email,
      business.telefoonnummer,
      business.website,
      '',
      'Overig',
      'benaderbaar',
      'Serve',
      'website',
      today,
    ]);
  });
  return rows;
}

function collectDeepSearchSources(data, businesses) {
  const sources = new Map();
  function add(url, title = '') {
    const normalizedUrl = normalizeWebsiteUrl(url);
    if (!normalizedUrl || sources.has(normalizedUrl)) return;
    sources.set(normalizedUrl, {
      url: normalizedUrl,
      title: truncateText(title || normalizedUrl, 160),
    });
  }
  businesses.forEach((business) => {
    (business.bronnen || []).forEach((url) => add(url));
  });

  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.url === 'string') add(value.url, value.title || value.name || '');
    if (value.url_citation && typeof value.url_citation === 'object') {
      add(value.url_citation.url, value.url_citation.title || '');
    }
    Object.keys(value).forEach((key) => {
      if (key === 'text') return;
      visit(value[key]);
    });
  }
  visit(data && data.output);
  return Array.from(sources.values()).slice(0, 80);
}

async function fetchDeepSearchBusinessRows(input = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const env = deps.env || process.env || {};
  const apiKey = getOpenAiApiKey({ ...deps, env });
  const target = normalizeDeepSearchTarget(input.target || input.location || input.query);
  const count = parsePositiveInt(input.count, MAX_DEEP_SEARCH_ROWS, 1, MAX_DEEP_SEARCH_ROWS);
  const batchNumber = parsePositiveInt(input.batchNumber, 1, 1, 999);
  const excludeItems = collectDeepSearchExcludeItems(input);

  if (typeof fetchImpl !== 'function') {
    throw createServiceError('AI zoeken is niet beschikbaar op deze server.', 'FETCH_UNAVAILABLE', 503);
  }
  if (!apiKey) {
    throw createServiceError('OPENAI_API_KEY ontbreekt in de serveromgeving.', 'OPENAI_NOT_CONFIGURED', 503);
  }
  if (!target) {
    throw createServiceError('Geen zoekgebied ontvangen.', 'DEEP_SEARCH_TARGET_REQUIRED', 400);
  }

  const model = getOpenAiDatabaseSearchModel({ ...deps, env });
  const reasoningEffort = getOpenAiDatabaseSearchReasoningEffort(model, { ...deps, env });
  const openAiApiBaseUrl = getOpenAiApiBaseUrl({ ...deps, env });
  const { systemPrompt, userPrompt } = buildDeepSearchPrompt({
    target,
    count,
    excludeItems,
    batchNumber,
  });

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), getOpenAiDatabaseSearchTimeoutMs({ ...deps, env }))
    : null;
  const requestUrl = `${openAiApiBaseUrl}/responses`;
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...buildOpenAiContextHeaders({ ...deps, env, openAiApiBaseUrl }),
  };
  const requestBody = JSON.stringify({
    model,
    reasoning: { effort: reasoningEffort },
    tools: [
      {
        type: 'web_search',
        external_web_access: true,
        user_location: {
          type: 'approximate',
          country: 'NL',
        },
      },
    ],
    tool_choice: 'auto',
    include: ['web_search_call.action.sources'],
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'softora_business_search_batch',
        strict: true,
        schema: buildDeepSearchJsonSchema(),
      },
    },
  });
  const maxRateLimitRetries = getOpenAiDatabaseSearchRateLimitRetries({ ...deps, env });
  let response;
  let data = {};
  try {
    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
      response = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        signal: controller ? controller.signal : undefined,
        body: requestBody,
      });
      data = await readJsonResponse(response);
      if (!isOpenAiRateLimitResponse(response, data) || attempt >= maxRateLimitRetries) break;
      await wait(getOpenAiRateLimitRetryDelayMs(response, data, { ...deps, env }));
    }
  } catch (error) {
    if (isAbortError(error) || (controller && controller.signal && controller.signal.aborted)) {
      throw createOpenAiDeepSearchTimeoutError();
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response || !response.ok) {
    if (isOpenAiRateLimitResponse(response, data)) {
      throw createOpenAiDeepSearchRateLimitError();
    }
    const message =
      normalizeString(data && data.error && data.error.message) || 'OpenAI kon geen bedrijven ophalen.';
    throw createServiceError(message, 'OPENAI_DEEP_SEARCH_FAILED', response && response.status ? response.status : 400);
  }

  const text = extractOpenAiResponsesText(data);
  const parsed = parseJsonObjectFromText(text);
  const rawBusinesses = Array.isArray(parsed && parsed.businesses) ? parsed.businesses : [];
  const targetParts = parseDeepSearchTargetParts(target);
  const businesses = dedupeDeepSearchBusinesses(rawBusinesses, targetParts, excludeItems).slice(0, count);
  const rows = mapDeepSearchBusinessesToRows(businesses);
  const usage = extractOpenAiUsage(data);
  const webSearchCalls = countOpenAiWebSearchCalls(data);
  const cost = estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls });
  await recordSoftoraApiCostEvent(
    {
      ...deps,
      env,
    },
    {
      source: 'premium-database-deep-search',
      label: `Database deep search: ${target}`,
      model,
      amountUsd: cost.estimatedUsd,
      estimated: true,
      meta: {
        target,
        requested: count,
        batchNumber,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        cachedInputTokens: cost.cachedInputTokens,
        webSearchCalls: cost.webSearchCalls,
      },
    }
  ).catch(() => null);
  const placeComplete = businesses.length > 0 ? false : Boolean(parsed && parsed.placeComplete);
  const completionReason = truncateText(
    (parsed && (parsed.completionReason || parsed.notes)) ||
      (placeComplete ? 'Geen extra complete en verifieerbare bedrijven gevonden.' : ''),
    300
  );

  return {
    ok: true,
    fileType: 'openai-web-search',
    source: 'openai-web-search',
    target,
    model,
    reasoningEffort,
    requested: count,
    found: businesses.length,
    rejected: Math.max(0, rawBusinesses.length - businesses.length),
    placeComplete,
    completionReason,
    cost,
    businesses,
    sources: collectDeepSearchSources(data, businesses),
    rows,
  };
}

function createPremiumDatabaseImportCoordinator(deps = {}) {
  const {
    fetchImpl = global.fetch,
    env = process.env,
    getUiStateValues,
    setUiStateValues,
  } = deps;

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

  function sendDeepSearchEstimateResponse(req, res) {
    try {
      const query = req && req.query && typeof req.query === 'object' ? req.query : {};
      const result = estimateDeepSearchBusinessRunCost(
        {
          count: query.count,
        },
        {
          env,
        }
      );
      return res.status(200).json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'DEEP_SEARCH_ESTIMATE_FAILED';
      return res.status(error && error.statusCode ? error.statusCode : 400).json({
        ok: false,
        code,
        error: truncateText(normalizeString(error && error.message) || 'Kosteninschatting mislukt.', 500),
      });
    }
  }

  async function sendDeepSearchBusinessesResponse(req, res) {
    try {
      const result = await fetchDeepSearchBusinessRows(req.body || {}, {
        fetchImpl,
        env,
        getUiStateValues,
        setUiStateValues,
      });
      if ((!Array.isArray(result.rows) || result.rows.length < 2) && !result.placeComplete) {
        return res.status(422).json({
          ok: false,
          code: 'NO_DEEP_SEARCH_BUSINESSES_FOUND',
          error: 'Geen complete bedrijven gevonden voor deze plek.',
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'DEEP_SEARCH_IMPORT_FAILED';
      return res.status(error && error.statusCode ? error.statusCode : 400).json({
        ok: false,
        code,
        error: truncateText(normalizeString(error && error.message) || 'AI zoeklijst ophalen mislukt.', 500),
      });
    }
  }

  return {
    sendSyncResponse,
    sendImportResponse,
    sendRealBusinessesResponse,
    sendDeepSearchEstimateResponse,
    sendDeepSearchBusinessesResponse,
  };
}

module.exports = {
  buildGooglePlacesSearchQueries,
  createPremiumDatabaseImportCoordinator,
  detectDelimitedSeparator,
  estimateDeepSearchBusinessRunCost,
  fetchDeepSearchBusinessRows,
  fetchRealBusinessRows,
  fetchSpreadsheetRowsFromSourceUrl,
  estimateOpenAiDatabaseSearchCost,
  listWorkbookWorksheets,
  normalizeGoogleSheetsExportUrl,
  parseDelimitedRows,
  parseSpreadsheetUpload,
  parseXlsxRows,
  shouldSkipWorksheetName,
};
