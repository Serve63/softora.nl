const path = require('path');
const zlib = require('zlib');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const MAX_IMPORT_COLS = 50;

function normalizeString(value) {
  return String(value || '').trim();
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

function createPremiumDatabaseImportCoordinator() {
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

  return {
    sendImportResponse,
  };
}

module.exports = {
  createPremiumDatabaseImportCoordinator,
  detectDelimitedSeparator,
  listWorkbookWorksheets,
  parseDelimitedRows,
  parseSpreadsheetUpload,
  parseXlsxRows,
  shouldSkipWorksheetName,
};
