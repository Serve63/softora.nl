const path = require('path');
const zlib = require('zlib');
const { buildOpenAiContextHeaders } = require('./openai-request-context');

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
const DEFAULT_OPENAI_DATABASE_SEARCH_SERVICE_TIER = 'flex';
const DEFAULT_OPENAI_DATABASE_SEARCH_PROMPT_VERSION = 'v1';
const DEFAULT_OPENAI_DATABASE_SEARCH_COST_MULTIPLIER = 2.2;
const DEFAULT_OPENAI_DATABASE_SEARCH_MAX_ATTEMPTS = 3;
const OPENAI_DATABASE_SEARCH_PROMPT_CACHE_RETENTION = '24h';
const OPENAI_DATABASE_SEARCH_PROMPT_CACHE_PREFIX = 'softora-premium-database-deep-search';
const DEFAULT_OPENAI_DATABASE_SEARCH_PRICING_KEY = 'gpt-5.4';
const OPENAI_DATABASE_SEARCH_PRICING = {
  'gpt-5': {
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 0.125,
    flex: {
      inputUsdPerMillion: 0.625,
      outputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.0625,
    },
  },
  'gpt-5.1': {
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 0.125,
    flex: {
      inputUsdPerMillion: 0.625,
      outputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.0625,
    },
  },
  'gpt-5.4': {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cachedInputUsdPerMillion: 0.25,
    flex: {
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 7.5,
      cachedInputUsdPerMillion: 0.13,
    },
  },
  'gpt-5.4-mini': {
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    cachedInputUsdPerMillion: 0.075,
    flex: {
      inputUsdPerMillion: 0.375,
      outputUsdPerMillion: 2.25,
      cachedInputUsdPerMillion: 0.0375,
    },
  },
  'gpt-5.4-nano': {
    inputUsdPerMillion: 0.2,
    outputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.02,
    flex: {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.625,
      cachedInputUsdPerMillion: 0.01,
    },
  },
  'gpt-5.4-pro': {
    inputUsdPerMillion: 30,
    outputUsdPerMillion: 180,
    cachedInputUsdPerMillion: null,
  },
  'gpt-5.5-pro': {
    inputUsdPerMillion: 30,
    outputUsdPerMillion: 180,
    cachedInputUsdPerMillion: null,
  },
  'gpt-5.5': {
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    cachedInputUsdPerMillion: 0.5,
  },
};
const OPENAI_WEB_SEARCH_USD_PER_CALL = 0.01;
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function shouldRetryOpenAiDeepSearchResponse(response, data) {
  const status = Number(response && response.status) || 0;
  if (![408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return false;
  const message = normalizeString(data && data.error && data.error.message).toLowerCase();
  const type = normalizeString(data && data.error && data.error.type).toLowerCase();
  const code = normalizeString(data && data.error && data.error.code).toLowerCase();
  return status !== 400 && !code.includes('invalid') && !type.includes('invalid') && !message.includes('invalid');
}

function getResponseHeader(response, name) {
  if (!response || !response.headers) return '';
  if (typeof response.headers.get === 'function') return normalizeString(response.headers.get(name));
  const direct = response.headers[name] || response.headers[name.toLowerCase()];
  return normalizeString(direct);
}

function getOpenAiRetryDelayMs(response, data, attempt) {
  const retryAfter = Number(getResponseHeader(response, 'retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(30000, retryAfter * 1000);
  const message = normalizeString(data && data.error && data.error.message);
  const secondsMatch = message.match(/try again in\s+([0-9.]+)s/i);
  const seconds = secondsMatch ? Number(secondsMatch[1]) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30000, seconds * 1000);
  return Math.min(30000, 1500 * Math.pow(2, Math.max(0, Number(attempt) - 1)));
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
    deps.openAiModel || env.OPENAI_DATABASE_SEARCH_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_DATABASE_SEARCH_MODEL
  );
}

function getOpenAiDatabaseSearchReasoningEffort(model, deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = normalizeString(deps.openAiReasoningEffort || env.OPENAI_DATABASE_SEARCH_REASONING_EFFORT);
  if (['none', 'low', 'medium', 'high', 'xhigh'].includes(explicit)) return explicit;
  return DEFAULT_OPENAI_DATABASE_SEARCH_REASONING_EFFORT;
}

function getOpenAiDatabaseSearchServiceTier(deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = normalizeString(deps.openAiServiceTier || env.OPENAI_DATABASE_SEARCH_SERVICE_TIER).toLowerCase();
  if (['flex', 'standard', 'default', 'auto'].includes(explicit)) return explicit;
  return DEFAULT_OPENAI_DATABASE_SEARCH_SERVICE_TIER;
}

function getOpenAiDatabaseSearchPromptVersion(deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = normalizeString(deps.openAiPromptVersion || env.OPENAI_DATABASE_SEARCH_PROMPT_VERSION).toLowerCase();
  return explicit === 'v2' ? 'v2' : DEFAULT_OPENAI_DATABASE_SEARCH_PROMPT_VERSION;
}

function getOpenAiDatabaseSearchCostMultiplier(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number(deps.openAiCostMultiplier || env.OPENAI_DATABASE_SEARCH_COST_MULTIPLIER);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_OPENAI_DATABASE_SEARCH_COST_MULTIPLIER;
}

function getOpenAiDatabaseSearchMaxAttempts(deps = {}) {
  const env = deps.env || process.env || {};
  const parsed = Number.parseInt(String(deps.openAiMaxAttempts || env.OPENAI_DATABASE_SEARCH_MAX_ATTEMPTS || ''), 10);
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(6, parsed));
  return DEFAULT_OPENAI_DATABASE_SEARCH_MAX_ATTEMPTS;
}

function getOpenAiDatabaseSearchPricing(model) {
  const normalized = normalizeString(model).toLowerCase();
  if (OPENAI_DATABASE_SEARCH_PRICING[normalized]) return OPENAI_DATABASE_SEARCH_PRICING[normalized];
  if (/^gpt-5\.5-pro\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.5-pro'];
  if (/^gpt-5\.5\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.5'];
  if (/^gpt-5\.4-mini\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.4-mini'];
  if (/^gpt-5\.4-nano\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.4-nano'];
  if (/^gpt-5\.4-pro\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.4-pro'];
  if (/^gpt-5\.4\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.4'];
  if (/^gpt-5\.1\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5.1'];
  if (/^gpt-5\b/.test(normalized)) return OPENAI_DATABASE_SEARCH_PRICING['gpt-5'];
  return OPENAI_DATABASE_SEARCH_PRICING[DEFAULT_OPENAI_DATABASE_SEARCH_PRICING_KEY];
}

function resolveOpenAiDatabaseSearchPricing(model, serviceTier) {
  const pricing = getOpenAiDatabaseSearchPricing(model);
  const requestedServiceTier = normalizeString(serviceTier).toLowerCase();
  if (requestedServiceTier === 'flex' && pricing.flex) {
    return {
      serviceTier: 'flex',
      pricing: pricing.flex,
      standardPricing: pricing,
    };
  }
  return {
    serviceTier: 'standard',
    pricing,
    standardPricing: pricing,
  };
}

function extractOpenAiUsage(data) {
  const usage = data && data.usage && typeof data.usage === 'object' ? data.usage : {};
  const inputTokens = Math.max(0, Number(usage.input_tokens || usage.prompt_tokens || 0) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens || usage.completion_tokens || 0) || 0);
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details
    : {};
  const outputDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details
    : {};
  const cachedInputTokens = Math.max(0, Number(inputDetails.cached_tokens || 0) || 0);
  const reasoningTokens = Math.max(0, Number(outputDetails.reasoning_tokens || 0) || 0);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.min(inputTokens, cachedInputTokens),
    reasoningTokens: Math.min(outputTokens, reasoningTokens),
  };
}

function countOpenAiWebSearchCalls(data) {
  const output = Array.isArray(data && data.output) ? data.output : [];
  return output.filter((item) => normalizeString(item && item.type) === 'web_search_call').length;
}

function estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls, serviceTier, costMultiplier }) {
  const resolvedPricing = resolveOpenAiDatabaseSearchPricing(model, serviceTier);
  const pricing = resolvedPricing.pricing;
  const safeUsage = usage || {};
  const inputTokens = Math.max(0, Number(safeUsage.inputTokens || 0) || 0);
  const outputTokens = Math.max(0, Number(safeUsage.outputTokens || 0) || 0);
  const reasoningTokens = Math.min(outputTokens, Math.max(0, Number(safeUsage.reasoningTokens || 0) || 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(safeUsage.cachedInputTokens || 0) || 0));
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const cachedRate = Number.isFinite(pricing.cachedInputUsdPerMillion)
    ? pricing.cachedInputUsdPerMillion
    : pricing.inputUsdPerMillion;
  const inputUsd = (billableInputTokens / 1000000) * pricing.inputUsdPerMillion;
  const cachedInputUsd = (cachedInputTokens / 1000000) * cachedRate;
  const outputUsd = (outputTokens / 1000000) * pricing.outputUsdPerMillion;
  const webSearchUsd = Math.max(0, Number(webSearchCalls || 0) || 0) * OPENAI_WEB_SEARCH_USD_PER_CALL;
  const rawTotalUsd = inputUsd + cachedInputUsd + outputUsd + webSearchUsd;
  const billingCalibrationMultiplier = getOpenAiDatabaseSearchCostMultiplier({ openAiCostMultiplier: costMultiplier });
  const totalUsd = rawTotalUsd * billingCalibrationMultiplier;

  return {
    currency: 'USD',
    model: normalizeString(model),
    estimatedUsd: Number(totalUsd.toFixed(6)),
    rawEstimatedUsd: Number(rawTotalUsd.toFixed(6)),
    inputUsd: Number(((inputUsd + cachedInputUsd) * billingCalibrationMultiplier).toFixed(6)),
    outputUsd: Number((outputUsd * billingCalibrationMultiplier).toFixed(6)),
    webSearchUsd: Number((webSearchUsd * billingCalibrationMultiplier).toFixed(6)),
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    webSearchCalls: Math.max(0, Number(webSearchCalls || 0) || 0),
    serviceTier: resolvedPricing.serviceTier,
    billingCalibrationMultiplier,
    pricing: {
      inputUsdPerMillion: pricing.inputUsdPerMillion,
      outputUsdPerMillion: pricing.outputUsdPerMillion,
      cachedInputUsdPerMillion: cachedRate,
      webSearchUsdPerCall: OPENAI_WEB_SEARCH_USD_PER_CALL,
      serviceTier: resolvedPricing.serviceTier,
    },
    note: 'Schatting op basis van OpenAI tokengebruik, web-search calls en Softora-kalibratie op recente dashboardkosten.',
  };
}

function getDeepSearchEstimateRangeMultiplier(requested) {
  const count = Math.max(0, Number(requested) || 0);
  if (count >= 500) return 2;
  if (count >= 250) return 1.6;
  if (count >= 100) return 1.35;
  return 1.25;
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
  const requestedServiceTier = getOpenAiDatabaseSearchServiceTier({ ...deps, env });
  const serviceTier = resolveOpenAiDatabaseSearchPricing(model, requestedServiceTier).serviceTier;
  const promptVersion = getOpenAiDatabaseSearchPromptVersion({ ...deps, env });
  const costMultiplier = getOpenAiDatabaseSearchCostMultiplier({ ...deps, env });
  const batchSize = MAX_DEEP_SEARCH_ROWS;
  const estimatedBatches = Math.max(1, Math.ceil(requested / batchSize));
  const usage = {
    inputTokens: estimatedBatches * ESTIMATED_DEEP_SEARCH_INPUT_TOKENS_PER_BATCH,
    outputTokens: requested * ESTIMATED_DEEP_SEARCH_OUTPUT_TOKENS_PER_COMPANY,
    reasoningTokens: requested * ESTIMATED_DEEP_SEARCH_OUTPUT_TOKENS_PER_COMPANY,
    cachedInputTokens: 0,
  };
  const webSearchCalls = estimatedBatches * ESTIMATED_DEEP_SEARCH_WEB_SEARCH_CALLS_PER_BATCH;
  const cost = estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls, serviceTier, costMultiplier });
  const rangeMultiplier = getDeepSearchEstimateRangeMultiplier(requested);
  const upperEstimatedUsd = Number((cost.estimatedUsd * rangeMultiplier).toFixed(6));

  return {
    ok: true,
    source: 'openai-web-search-estimate',
    requested,
    maxRequested: MAX_DEEP_SEARCH_ESTIMATE_ROWS,
    batchSize,
    estimatedBatches,
    model,
    reasoningEffort,
    serviceTier,
    promptVersion,
    estimateOnly: true,
    cost: {
      ...cost,
      upperEstimatedUsd,
      rangeMultiplier,
      note:
        'Voorcalculatie op basis van het actieve deep-search model; er is geen OpenAI-call uitgevoerd. Grote runs kunnen hoger uitvallen als veel locaties leeg of dubbel blijken.',
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

function deepSearchBusinessMatchesTarget(business, targetParts) {
  const place = normalizeString(targetParts && targetParts.place);
  if (!place) return true;
  return buildDeepSearchPlaceAliases(place).some((alias) =>
    normalizedTextIncludesPhrase(business && business.adres, alias)
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
  if (companyKey && addressKey) {
    addDeepSearchExcludeKey(keys, `company-address:${companyKey}|${addressKey}`);
  }
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
  if (parts.length >= 2) {
    addDeepSearchExcludeCompanyAddress(keys, parts[0], parts[parts.length - 1]);
  }
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

function buildDeepSearchPromptV1({ target, count, excludeItems, batchNumber }) {
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

function buildDeepSearchPromptV2({ target, count, excludeItems, batchNumber }) {
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
    'Werk zuinig: elke zoekactie moet gericht zijn op nieuwe complete bedrijven, niet op eindeloos breed rondkijken.',
    'Zoekroute: begin met combinaties van plaats + branche/bedrijf/contact, gebruik lokale bedrijvengidsen alleen als ontdekbron, open daarna bij voorkeur de officiele bedrijfswebsite of contactpagina voor bewijs.',
    'Verifieer per bedrijf naam, fysiek adres, e-mail, telefoonnummer en website. Als een veld ontbreekt, lever het bedrijf niet aan.',
    'Neem alleen actieve bedrijven of bedrijven die duidelijk operationeel lijken mee.',
    'Neem geen verenigingen, scholen, overheidsinstanties of stichtingen mee, tenzij ze commercieel interessant zijn.',
    'Vermijd dubbele bedrijven, handelsnamen met dezelfde website en eerder gevonden resultaten.',
    'Wanneer je vooral uitgesloten/dubbele resultaten terugvindt en geen nieuwe complete bedrijven, stop dan voor deze plaats en zet placeComplete op true.',
    'Wanneer je bedrijven aanlevert, zet placeComplete altijd op false.',
    'Gebruik geen placeholders zoals onbekend, niet gevonden, n.v.t. of lege waarden.',
    'Geef compacte JSON terug volgens het schema; maximaal twee bron-URLs per bedrijf is genoeg.',
  ].join('\n');

  const userPrompt = [
    `Vind maximaal ${count} nieuwe actieve bedrijven in: ${target}.`,
    `Dit is batch ${Math.max(1, Number(batchNumber) || 1)} voor deze plek.`,
    '',
    'Locatieregel:',
    `- ${strictLocationRule}`,
    '- Het adres moet de gevraagde plaats tonen. Een bedrijf in een andere plaats binnen dezelfde gemeente of provincie mag niet mee.',
    '',
    'Velden per bedrijf:',
    'Bedrijfsnaam | Adres | E-mail | Telefoonnummer | Website',
    '',
    'Stopregels:',
    '- Als je nieuwe complete bedrijven vindt, lever die aan en zet placeComplete op false.',
    '- Als je nul nieuwe complete bedrijven vindt na gerichte live search, zet placeComplete op true en leg kort uit waarom in completionReason.',
    '- Als alle zichtbare kandidaten dubbel, uitgesloten, onvolledig of buiten de plaats zijn, zet placeComplete op true.',
    '',
    'Eerder gevonden of al bestaande resultaten die je moet vermijden:',
    exclusionText,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function buildDeepSearchPrompt({ target, count, excludeItems, batchNumber, promptVersion }) {
  if (promptVersion === 'v2') {
    return buildDeepSearchPromptV2({ target, count, excludeItems, batchNumber });
  }
  return buildDeepSearchPromptV1({ target, count, excludeItems, batchNumber });
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

function dedupeDeepSearchBusinesses(businesses, targetParts = {}, excludeItems = []) {
  return filterDeepSearchBusinesses(businesses, targetParts, excludeItems).businesses;
}

function filterDeepSearchBusinesses(businesses, targetParts = {}, excludeItems = []) {
  const seen = new Set();
  const excluded = buildDeepSearchExcludeKeySet(excludeItems);
  const result = [];
  const stats = {
    raw: 0,
    incomplete: 0,
    wrongLocation: 0,
    duplicate: 0,
  };
  (businesses || []).forEach((business) => {
    stats.raw += 1;
    const normalized = normalizeDeepSearchBusiness(business);
    if (!normalized) {
      stats.incomplete += 1;
      return;
    }
    if (!deepSearchBusinessMatchesTarget(normalized, targetParts)) {
      stats.wrongLocation += 1;
      return;
    }
    const keys = getDeepSearchBusinessKeys(normalized);
    if (keys.some((key) => excluded.has(key))) {
      stats.duplicate += 1;
      return;
    }
    if (keys.some((key) => seen.has(key))) {
      stats.duplicate += 1;
      return;
    }
    keys.forEach((key) => seen.add(key));
    result.push(normalized);
  });
  return {
    businesses: result,
    rejected: Math.max(0, stats.raw - result.length),
    rejectedIncomplete: stats.incomplete,
    rejectedWrongLocation: stats.wrongLocation,
    rejectedDuplicates: stats.duplicate,
    rawCount: stats.raw,
  };
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
  const requestedServiceTier = getOpenAiDatabaseSearchServiceTier({ ...deps, env });
  const serviceTier = resolveOpenAiDatabaseSearchPricing(model, requestedServiceTier).serviceTier;
  const promptVersion = getOpenAiDatabaseSearchPromptVersion({ ...deps, env });
  const costMultiplier = getOpenAiDatabaseSearchCostMultiplier({ ...deps, env });
  const maxAttempts = getOpenAiDatabaseSearchMaxAttempts({ ...deps, env });
  const openAiApiBaseUrl = getOpenAiApiBaseUrl({ ...deps, env });
  const { systemPrompt, userPrompt } = buildDeepSearchPrompt({
    target,
    count,
    excludeItems,
    batchNumber,
    promptVersion,
  });

  const requestBody = {
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
    prompt_cache_key: `${OPENAI_DATABASE_SEARCH_PROMPT_CACHE_PREFIX}-${promptVersion}`,
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
  };
  if (serviceTier === 'flex') requestBody.service_tier = 'flex';
  if (/^gpt-5\.4\b/i.test(model)) requestBody.prompt_cache_retention = OPENAI_DATABASE_SEARCH_PROMPT_CACHE_RETENTION;

  let response;
  let data;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), Math.max(10000, deps.openAiTimeoutMs || 240000))
      : null;
    try {
      response = await fetchImpl(`${openAiApiBaseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...buildOpenAiContextHeaders({ ...deps, env, openAiApiBaseUrl }),
        },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify(requestBody),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    data = await readJsonResponse(response);
    if (response && response.ok) break;
    if (attempt >= maxAttempts || !shouldRetryOpenAiDeepSearchResponse(response, data)) break;
    await wait(getOpenAiRetryDelayMs(response, data, attempt));
  }
  if (!response || !response.ok) {
    const message =
      normalizeString(data && data.error && data.error.message) || 'OpenAI kon geen bedrijven ophalen.';
    throw createServiceError(message, 'OPENAI_DEEP_SEARCH_FAILED', response && response.status ? response.status : 400);
  }

  const text = extractOpenAiResponsesText(data);
  const parsed = parseJsonObjectFromText(text);
  const rawBusinesses = Array.isArray(parsed && parsed.businesses) ? parsed.businesses : [];
  const targetParts = parseDeepSearchTargetParts(target);
  const filtered = filterDeepSearchBusinesses(rawBusinesses, targetParts, excludeItems);
  const businesses = filtered.businesses.slice(0, count);
  const rows = mapDeepSearchBusinessesToRows(businesses);
  const usage = extractOpenAiUsage(data);
  const webSearchCalls = countOpenAiWebSearchCalls(data);
  const cost = estimateOpenAiDatabaseSearchCost({ model, usage, webSearchCalls, serviceTier, costMultiplier });
  const duplicateOnlyBatch = filtered.rawCount > 0 && filtered.rejectedDuplicates === filtered.rawCount;
  const placeComplete = businesses.length > 0 ? false : Boolean((parsed && parsed.placeComplete) || duplicateOnlyBatch);
  const completionReason = truncateText(
    (parsed && (parsed.completionReason || parsed.notes)) ||
      (duplicateOnlyBatch ? 'Alle gevonden kandidaten waren al bekend of uitgesloten.' : '') ||
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
    serviceTier,
    promptVersion,
    requested: count,
    found: businesses.length,
    rejected: filtered.rejected,
    rejectedDuplicates: filtered.rejectedDuplicates,
    rejectedWrongLocation: filtered.rejectedWrongLocation,
    rejectedIncomplete: filtered.rejectedIncomplete,
    placeComplete,
    completionReason,
    cost,
    usage,
    webSearchCalls,
    businesses,
    sources: collectDeepSearchSources(data, businesses),
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
