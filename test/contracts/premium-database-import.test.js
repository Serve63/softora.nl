const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  detectDelimitedSeparator,
  parseDelimitedRows,
  parseSpreadsheetUpload,
} = require('../../server/services/premium-database-import');

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(files).forEach(([fileName, content]) => {
    const nameBuffer = Buffer.from(fileName);
    const dataBuffer = Buffer.from(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 34);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createWorkbookBuffer() {
  const sharedStrings = [
    'Bedrijfsnaam',
    'Adres',
    'E-mail',
    'Telefoonnummer',
    'Website',
    'Augustijn Auto Expertise',
    'Kerkdreef 2, 4851 RB Ulvenhout',
    'admin@jghaugustijn.nl',
    '06 22 55 66 63',
    'auto-expertise.nl',
  ];

  return createStoredZip({
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DATABASE" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      `<sst>${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2" t="s"><v>9</v></c></row>' +
      '</sheetData></worksheet>',
  });
}

test('premium database import parses Dutch spreadsheet-style CSV headers', () => {
  const raw = [
    'Bedrijfsnaam;Adres;E-mail;Telefoonnummer;Website',
    'Augustijn Auto Expertise;Kerkdreef 2, 4851 RB Ulvenhout;admin@jghaugustijn.nl;06 22 55 66 63;auto-expertise.nl',
  ].join('\n');

  assert.equal(detectDelimitedSeparator(raw), ';');
  assert.deepEqual(parseDelimitedRows(raw), [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    [
      'Augustijn Auto Expertise',
      'Kerkdreef 2, 4851 RB Ulvenhout',
      'admin@jghaugustijn.nl',
      '06 22 55 66 63',
      'auto-expertise.nl',
    ],
  ]);
});

test('premium database import extracts rows from the first xlsx worksheet', () => {
  const workbook = createWorkbookBuffer();
  const result = parseSpreadsheetUpload({
    fileName: 'database.xlsx',
    dataBase64: workbook.toString('base64'),
  });

  assert.equal(result.fileType, 'xlsx');
  assert.deepEqual(result.rows, [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    [
      'Augustijn Auto Expertise',
      'Kerkdreef 2, 4851 RB Ulvenhout',
      'admin@jghaugustijn.nl',
      '06 22 55 66 63',
      'auto-expertise.nl',
    ],
  ]);
});

test('premium database import route is registered behind the premium api surface', () => {
  const featureRoutesPath = path.join(__dirname, '../../server/services/feature-routes-runtime.js');
  const routePath = path.join(__dirname, '../../server/routes/premium-database-import.js');
  const featureRoutesSource = fs.readFileSync(featureRoutesPath, 'utf8');
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.match(featureRoutesSource, /registerPremiumDatabaseImportRoutes\(app/);
  assert.match(featureRoutesSource, /createPremiumDatabaseImportCoordinator\(\)/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/import-spreadsheet'/);
});
