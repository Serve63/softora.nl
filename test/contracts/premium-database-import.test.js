const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPremiumDatabaseImportCoordinator,
  detectDelimitedSeparator,
  fetchDeepSearchBusinessRows,
  fetchRealBusinessRows,
  fetchSpreadsheetRowsFromSourceUrl,
  normalizeGoogleSheetsExportUrl,
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

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSharedStringIndex(values) {
  const uniqueValues = [];
  const indexByValue = new Map();
  values.forEach((value) => {
    if (indexByValue.has(value)) return;
    indexByValue.set(value, uniqueValues.length);
    uniqueValues.push(value);
  });
  return { uniqueValues, indexByValue };
}

function buildWorksheetXml(rows, indexByValue) {
  const columns = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return (
    '<worksheet><sheetData>' +
    rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">` +
          row
            .map(
              (value, columnIndex) =>
                `<c r="${columns[columnIndex]}${rowIndex + 1}" t="s"><v>${indexByValue.get(value)}</v></c>`
            )
            .join('') +
          '</row>'
      )
      .join('') +
    '</sheetData></worksheet>'
  );
}

function createWorkbookBuffer(sheets = null) {
  const workbookSheets =
    sheets ||
    [
      {
        name: 'DATABASE',
        rows: [
          ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
          ['Niet importeren B.V.', 'Overzicht 1', 'skip@example.nl', '000', 'skip.nl'],
        ],
      },
      {
        name: 'Nederland Noord-Brabant Alphen-Chaam Ulvenhout',
        rows: [
          ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
          [
            'Augustijn Auto Expertise',
            'Kerkdreef 2, 4851 RB Ulvenhout',
            'admin@jghaugustijn.nl',
            '06 22 55 66 63',
            'auto-expertise.nl',
          ],
        ],
      },
      {
        name: 'Nieuwe toekomstige tab',
        rows: [
          ['Website', 'Telefoonnummer', 'E-mail', 'Adres', 'Bedrijfsnaam'],
          [
            'fysiotherapielombarts.nl',
            '06 28887546',
            'info@fysiotherapielombarts.nl',
            'Bosrand 8, 4851 BA Ulvenhout',
            'Fysiotherapie Lombarts',
          ],
        ],
      },
    ];

  const allValues = workbookSheets.flatMap((sheet) => sheet.rows.flat());
  const { uniqueValues, indexByValue } = buildSharedStringIndex(allValues);
  const rels = workbookSheets
    .map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join('');
  const sheetTags = workbookSheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join('');

  const files = {
    'xl/workbook.xml':
      `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${rels}</Relationships>`,
    'xl/sharedStrings.xml':
      `<sst>${uniqueValues.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`,
  };

  workbookSheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = buildWorksheetXml(sheet.rows, indexByValue);
  });

  return createStoredZip(files);
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

test('premium database import skips DATABASE tab and combines future data tabs', () => {
  const workbook = createWorkbookBuffer();
  const result = parseSpreadsheetUpload({
    fileName: 'database.xlsx',
    dataBase64: workbook.toString('base64'),
  });

  assert.equal(result.fileType, 'xlsx');
  assert.deepEqual(result.rows, [
    [
      'Bedrijfsnaam',
      'Adres',
      'E-mail',
      'Telefoonnummer',
      'Website',
      'Contactpersoon',
      'Branche',
      'Status',
      'Toegewezen aan',
      'Service',
      'Laatste actie',
    ],
    [
      'Augustijn Auto Expertise',
      'Kerkdreef 2, 4851 RB Ulvenhout',
      'admin@jghaugustijn.nl',
      '06 22 55 66 63',
      'auto-expertise.nl',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
    [
      'Fysiotherapie Lombarts',
      'Bosrand 8, 4851 BA Ulvenhout',
      'info@fysiotherapielombarts.nl',
      '06 28887546',
      'fysiotherapielombarts.nl',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
  ]);
});

test('premium database import rejects workbooks with only the DATABASE overview tab', () => {
  const workbook = createWorkbookBuffer([
    {
      name: 'DATABASE',
      rows: [
        ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
        ['Niet importeren B.V.', 'Overzicht 1', 'skip@example.nl', '000', 'skip.nl'],
      ],
    },
  ]);

  assert.throws(
    () =>
      parseSpreadsheetUpload({
        fileName: 'database.xlsx',
        dataBase64: workbook.toString('base64'),
      }),
    /Geen importeerbare datatab gevonden/
  );
});

test('premium database import sync normalizes Google Sheets links and fetches xlsx rows', async () => {
  const workbook = createWorkbookBuffer();
  const expectedUrl = 'https://docs.google.com/spreadsheets/d/sheet-123/export?format=xlsx';
  const result = await fetchSpreadsheetRowsFromSourceUrl(
    'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0',
    {
      fetchImpl: async (url) => {
        assert.equal(url, expectedUrl);
        return {
          ok: true,
          headers: {
            get(name) {
              if (name === 'content-type') {
                return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
              }
              if (name === 'content-length') return String(workbook.length);
              return '';
            },
          },
          async arrayBuffer() {
            return workbook;
          },
        };
      },
    }
  );

  assert.equal(normalizeGoogleSheetsExportUrl('https://docs.google.com/spreadsheets/d/sheet-123/edit'), expectedUrl);
  assert.equal(result.fileType, 'xlsx');
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[1][0], 'Augustijn Auto Expertise');
  assert.throws(
    () => normalizeGoogleSheetsExportUrl('https://example.com/spreadsheets/d/sheet-123/edit'),
    /Alleen Google Sheets-links/
  );
});

test('premium database import sync route returns fetched spreadsheet rows', async () => {
  const workbook = createWorkbookBuffer();
  const coordinator = createPremiumDatabaseImportCoordinator({
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          return name === 'content-type'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : '';
        },
      },
      async arrayBuffer() {
        return workbook;
      },
    }),
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await coordinator.sendSyncResponse(
    { body: { sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit' } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.rows[1][0], 'Augustijn Auto Expertise');
});

test('premium database real businesses maps Google Places rows and discovers public email', async () => {
  const calls = [];
  const result = await fetchRealBusinessRows(
    { query: 'bakkerij Breda', count: 2, enrichEmails: true },
    {
      env: { GOOGLE_MAPS_SERVER_API_KEY: 'maps-key' },
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).includes('places.googleapis.com')) {
          assert.equal(options.headers['X-Goog-Api-Key'], 'maps-key');
          assert.match(options.headers['X-Goog-FieldMask'], /places\.nationalPhoneNumber/);
          assert.equal(JSON.parse(options.body).textQuery, 'bakkerij Breda');
          return {
            ok: true,
            async json() {
              return {
                places: [
                  {
                    id: 'place-1',
                    displayName: { text: 'Bakkerij Zon' },
                    formattedAddress: 'Dorpsstraat 1, 4811 AA Breda',
                    nationalPhoneNumber: '076 123 45 67',
                    websiteUri: 'https://bakkerijzon.nl',
                    businessStatus: 'OPERATIONAL',
                    types: ['bakery', 'store'],
                  },
                  {
                    id: 'place-2',
                    displayName: { text: 'Studio Nova' },
                    formattedAddress: 'Markt 2, 4811 XR Breda',
                    nationalPhoneNumber: '076 765 43 21',
                    websiteUri: 'https://studionova.nl',
                    businessStatus: 'OPERATIONAL',
                    types: ['store'],
                  },
                ],
              };
            },
          };
        }
        if (String(url) === 'https://bakkerijzon.nl/') {
          return {
            ok: true,
            headers: { get: () => 'text/html' },
            async text() {
              return '<a href="mailto:info@bakkerijzon.nl">Mail</a>';
            },
          };
        }
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          async text() {
            return '<html><body>Geen e-mail</body></html>';
          },
        };
      },
    }
  );

  assert.equal(result.fileType, 'google-places');
  assert.equal(result.found, 2);
  assert.equal(result.emailFound, 1);
  assert.deepEqual(result.rows[0].slice(0, 5), [
    'Bedrijfsnaam',
    'Adres',
    'E-mail',
    'Telefoonnummer',
    'Website',
  ]);
  assert.deepEqual(result.rows[1].slice(0, 5), [
    'Bakkerij Zon',
    'Dorpsstraat 1, 4811 AA Breda',
    'info@bakkerijzon.nl',
    '076 123 45 67',
    'bakkerijzon.nl',
  ]);
  assert.deepEqual(result.rows[2].slice(0, 5), [
    'Studio Nova',
    'Markt 2, 4811 XR Breda',
    '—',
    '076 765 43 21',
    'studionova.nl',
  ]);
  assert.equal(calls.filter((call) => call.url.includes('places.googleapis.com')).length, 1);
});

test('premium database real businesses route reports missing Google Places key', async () => {
  const coordinator = createPremiumDatabaseImportCoordinator({
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not run without key');
    },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await coordinator.sendRealBusinessesResponse(
    { body: { query: 'bedrijven in Breda', count: 100 } },
    response
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'GOOGLE_PLACES_NOT_CONFIGURED');
});

test('premium database deep search uses OpenAI web search and returns complete rows only', async () => {
  const calls = [];
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Altena | Almkerk',
      count: 100,
      batchNumber: 2,
      exclude: ['Bakkerij Oud | oud@voorbeeld.nl | oud.nl'],
    },
    {
      env: { OPENAI_API_KEY: 'openai-key', OPENAI_MODEL: 'gpt-5.5' },
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer openai-key');
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'gpt-5.5');
        assert.equal(payload.reasoning.effort, 'low');
        assert.equal(payload.tools[0].type, 'web_search');
        assert.equal(payload.tools[0].external_web_access, true);
        assert.deepEqual(payload.include, ['web_search_call.action.sources']);
        assert.equal(payload.text.format.type, 'json_schema');
        assert.deepEqual(payload.text.format.schema.required, [
          'target',
          'businesses',
          'placeComplete',
          'completionReason',
          'notes',
        ]);
        assert.match(payload.input[1].content, /Almkerk/);
        assert.match(payload.input[1].content, /Bakkerij Oud/);
        assert.match(payload.input[1].content, /placeComplete/);
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Almkerk',
                businesses: [
                  {
                    bedrijfsnaam: 'Bakkerij Zon',
                    adres: 'Dorpsstraat 1, 4286 AA Almkerk',
                    email: 'info@bakkerijzon.nl',
                    telefoonnummer: '0183 123 456',
                    website: 'https://bakkerijzon.nl',
                    bronnen: ['https://bakkerijzon.nl/contact'],
                  },
                  {
                    bedrijfsnaam: 'Onvolledig Bedrijf',
                    adres: 'Kerkstraat 2, Almkerk',
                    email: 'niet gevonden',
                    telefoonnummer: '0183 000 000',
                    website: 'https://onvolledig.nl',
                    bronnen: ['https://onvolledig.nl'],
                  },
                ],
                placeComplete: false,
                completionReason: '',
                notes: '',
              }),
              output: [
                {
                  type: 'web_search_call',
                  action: {
                    sources: [{ url: 'https://bakkerijzon.nl/contact', title: 'Contact' }],
                  },
                },
              ],
              usage: {
                input_tokens: 1000,
                input_tokens_details: { cached_tokens: 200 },
                output_tokens: 500,
              },
            };
          },
        };
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(result.fileType, 'openai-web-search');
  assert.equal(result.found, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.model, 'gpt-5.5');
  assert.equal(result.reasoningEffort, 'low');
  assert.equal(result.placeComplete, false);
  assert.equal(result.cost.currency, 'USD');
  assert.equal(result.cost.inputTokens, 1000);
  assert.equal(result.cost.outputTokens, 500);
  assert.equal(result.cost.webSearchCalls, 1);
  assert.equal(result.cost.estimatedUsd, 0.0291);
  assert.deepEqual(result.rows[1].slice(0, 5), [
    'Bakkerij Zon',
    'Dorpsstraat 1, 4286 AA Almkerk',
    'info@bakkerijzon.nl',
    '0183 123 456',
    'bakkerijzon.nl',
  ]);
  assert.equal(result.sources[0].url, 'https://bakkerijzon.nl/contact');
});

test('premium database deep search route reports missing OpenAI key', async () => {
  const coordinator = createPremiumDatabaseImportCoordinator({
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not run without key');
    },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await coordinator.sendDeepSearchBusinessesResponse(
    { body: { target: 'Nederland | Noord-Brabant | Altena | Almkerk', count: 100 } },
    response
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'OPENAI_NOT_CONFIGURED');
});

test('premium database deep search defaults to gpt-5.5-pro with high reasoning', async () => {
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Altena | Almkerk',
      count: 1,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async (_url, options = {}) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'gpt-5.5-pro');
        assert.equal(payload.reasoning.effort, 'high');
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Almkerk',
                businesses: [],
                placeComplete: true,
                completionReason: 'Geen extra complete bedrijven gevonden.',
                notes: '',
              }),
              output: [],
              usage: {
                input_tokens: 100,
                output_tokens: 20,
              },
            };
          },
        };
      },
    }
  );

  assert.equal(result.model, 'gpt-5.5-pro');
  assert.equal(result.reasoningEffort, 'high');
  assert.equal(result.placeComplete, true);
  assert.equal(result.completionReason, 'Geen extra complete bedrijven gevonden.');
  assert.equal(result.cost.estimatedUsd, 0.0066);
});

test('premium database deep search route accepts an automatically completed empty place', async () => {
  const coordinator = createPremiumDatabaseImportCoordinator({
    env: { OPENAI_API_KEY: 'openai-key' },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            target: 'Almkerk',
            businesses: [],
            placeComplete: true,
            completionReason: 'Geen extra complete en verifieerbare bedrijven gevonden.',
            notes: '',
          }),
          output: [],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
          },
        };
      },
    }),
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await coordinator.sendDeepSearchBusinessesResponse(
    { body: { target: 'Nederland | Noord-Brabant | Altena | Almkerk', count: 100 } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.placeComplete, true);
  assert.equal(response.body.rows.length, 1);
});

test('premium database import route is registered behind the premium api surface', () => {
  const featureRoutesPath = path.join(__dirname, '../../server/services/feature-routes-runtime.js');
  const routePath = path.join(__dirname, '../../server/routes/premium-database-import.js');
  const featureRoutesSource = fs.readFileSync(featureRoutesPath, 'utf8');
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.match(featureRoutesSource, /registerPremiumDatabaseImportRoutes\(app/);
  assert.match(featureRoutesSource, /createPremiumDatabaseImportCoordinator\(\)/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/import-spreadsheet'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/sync-spreadsheet'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/add-real-businesses'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/deep-search-businesses'/);
});
