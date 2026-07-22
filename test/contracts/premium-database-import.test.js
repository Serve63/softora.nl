const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPremiumDatabaseImportCoordinator,
  detectDelimitedSeparator,
  estimateDeepSearchBusinessRunCost,
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

function createMockResponse() {
  return {
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

test('premium database delete lead route removes one customer through data ops without reposting the full list', async () => {
  const calls = [];
  const coordinator = createPremiumDatabaseImportCoordinator({
    mailReadySnapshotService: {
      async removeCustomers(customerIds) {
        calls.push({ type: 'snapshot-prune', customerIds });
        return true;
      },
      invalidate() {
        calls.push({ type: 'snapshot-invalidate' });
      },
    },
    dataOpsStore: {
      deleteCustomers: async (customerIds, meta) => {
        calls.push({ type: 'customers', customerIds, meta });
        return { ok: true };
      },
      deleteDesignPhotos: async (customerIds, meta) => {
        calls.push({ type: 'photos', customerIds, meta });
        return { ok: true };
      },
    },
  });
  const response = createMockResponse();

  await coordinator.sendDeleteLeadResponse({ body: { customerId: 'customer-413', confirm: true } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, customerId: 'customer-413', deleted: true });
  assert.deepEqual(calls, [
    {
      type: 'customers',
      customerIds: ['customer-413'],
      meta: { source: 'premium-database-delete-lead', actor: 'Premium database' },
    },
    {
      type: 'photos',
      customerIds: ['customer-413'],
      meta: { source: 'premium-database-delete-lead', actor: 'Premium database' },
    },
    { type: 'snapshot-prune', customerIds: ['customer-413'] },
  ]);
});

test('premium database delete lead route requires explicit confirmation', async () => {
  const calls = [];
  const coordinator = createPremiumDatabaseImportCoordinator({
    dataOpsStore: {
      deleteCustomers: async (customerIds, meta) => {
        calls.push({ customerIds, meta });
        return { ok: true };
      },
    },
  });
  const response = createMockResponse();

  await coordinator.sendDeleteLeadResponse({ body: { customerId: 'customer-413' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'CUSTOMER_DELETE_CONFIRM_REQUIRED');
  assert.deepEqual(calls, []);
});

test('premium database remove webdesign assets route deletes both assets and moves the lead to available', async () => {
  const calls = [];
  const coordinator = createPremiumDatabaseImportCoordinator({
    mailReadySnapshotService: {
      async markCustomersAvailableAfterAssetRemoval(customerIds) {
        calls.push({ type: 'snapshot-available', customerIds });
        return true;
      },
      invalidate() {
        calls.push({ type: 'snapshot-invalidate' });
      },
    },
    dataOpsStore: {
      deleteDesignPhotos: async (customerIds, meta) => {
        calls.push({ type: 'photos', customerIds, meta });
        return { ok: true };
      },
    },
  });
  const response = createMockResponse();

  await coordinator.sendRemoveWebdesignAssetsResponse(
    { body: { customerId: 'customer-413', confirm: true } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    customerId: 'customer-413',
    assetsRemoved: true,
    snapshotUpdated: true,
  });
  assert.deepEqual(calls, [
    {
      type: 'photos',
      customerIds: ['customer-413'],
      meta: {
        source: 'premium-database-remove-webdesign-assets',
        actor: 'Premium database',
      },
    },
    { type: 'snapshot-available', customerIds: ['customer-413'] },
  ]);
});

test('premium database remove webdesign assets route requires explicit confirmation', async () => {
  const calls = [];
  const coordinator = createPremiumDatabaseImportCoordinator({
    dataOpsStore: {
      deleteDesignPhotos: async () => {
        calls.push('delete');
        return { ok: true };
      },
    },
  });
  const response = createMockResponse();

  await coordinator.sendRemoveWebdesignAssetsResponse(
    { body: { customerId: 'customer-413' } },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'WEBDESIGN_ASSET_DELETE_CONFIRM_REQUIRED');
  assert.deepEqual(calls, []);
});

test('premium database delete lead route fails closed without a customer id or data ops delete storage', async () => {
  const coordinator = createPremiumDatabaseImportCoordinator();
  const missingIdResponse = createMockResponse();
  const missingStoreResponse = createMockResponse();

  await coordinator.sendDeleteLeadResponse({ body: {} }, missingIdResponse);
  await coordinator.sendDeleteLeadResponse({ body: { customerId: 'customer-1', confirm: true } }, missingStoreResponse);

  assert.equal(missingIdResponse.statusCode, 400);
  assert.equal(missingIdResponse.body.ok, false);
  assert.equal(missingIdResponse.body.code, 'CUSTOMER_ID_REQUIRED');
  assert.equal(missingStoreResponse.statusCode, 503);
  assert.equal(missingStoreResponse.body.ok, false);
  assert.equal(missingStoreResponse.body.code, 'CUSTOMER_DELETE_STORAGE_UNAVAILABLE');
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
      env: {
        OPENAI_API_KEY: 'openai-key',
        OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.5',
        OPENAI_MODEL: 'gpt-5.5',
        OPENAI_ORGANIZATION_ID: 'org_softora',
        OPENAI_PROJECT_ID: 'proj_softora',
      },
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer openai-key');
        assert.equal(options.headers['OpenAI-Organization'], 'org_softora');
        assert.equal(options.headers['OpenAI-Project'], 'proj_softora');
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'gpt-5.5');
        assert.equal(payload.reasoning.effort, 'medium');
        assert.equal(payload.service_tier, 'flex');
        assert.equal(payload.prompt_cache_key, 'softora-premium-database-deep-search-v1');
        assert.equal(payload.prompt_cache_retention, '24h');
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
        assert.doesNotMatch(payload.input[1].content, /Zoekstrategie v2/);
        assert.match(payload.input[0].content, /Harde regioregel/);
        assert.match(payload.input[1].content, /Het adres moet de gevraagde plaats tonen/);
        assert.match(payload.input[1].content, /Als je bedrijven teruggeeft, zet placeComplete op false/);
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
                    bedrijfsnaam: 'Bakkerij Verkeerde Plaats',
                    adres: 'Grote Markt 1, 4811 XP Breda',
                    email: 'info@verkeerdeplaats.nl',
                    telefoonnummer: '076 123 4567',
                    website: 'https://verkeerdeplaats.nl',
                    bronnen: ['https://verkeerdeplaats.nl/contact'],
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
  assert.equal(result.rejected, 2);
  assert.equal(result.model, 'gpt-5.5');
  assert.equal(result.reasoningEffort, 'medium');
  assert.equal(result.serviceTier, 'flex');
  assert.equal(result.promptVersion, 'v1');
  assert.equal(result.placeComplete, false);
  assert.equal(result.cost.currency, 'USD');
  assert.equal(result.cost.inputTokens, 1000);
  assert.equal(result.cost.outputTokens, 500);
  assert.equal(result.cost.webSearchCalls, 1);
  assert.equal(result.cost.serviceTier, 'flex');
  assert.equal(result.cost.estimatedUsd, 0.01955);
  assert.deepEqual(result.rows[1].slice(0, 5), [
    'Bakkerij Zon',
    'Dorpsstraat 1, 4286 AA Almkerk',
    'info@bakkerijzon.nl',
    '0183 123 456',
    'bakkerijzon.nl',
  ]);
  assert.equal(result.sources[0].url, 'https://bakkerijzon.nl/contact');
});

test('premium database deep search keeps OpenAI endpoint and timeout server-owned', async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timeoutDelays = [];
  const calls = [];
  global.setTimeout = (_callback, delay) => {
    timeoutDelays.push(delay);
    return { __testTimeout: true };
  };
  global.clearTimeout = () => {};

  try {
    const result = await fetchDeepSearchBusinessRows(
      {
        target: 'Nederland | Noord-Brabant | Altena | Almkerk',
        count: 1,
      },
      {
        env: {
          OPENAI_API_KEY: 'openai-key',
          OPENAI_API_BASE_URL: 'https://example.invalid/v1',
          OPENAI_DATABASE_SEARCH_TIMEOUT_MS: '1',
        },
        openAiApiBaseUrl: 'https://169.254.169.254/v1',
        openAiTimeoutMs: 1,
        fetchImpl: async (url) => {
          calls.push(String(url));
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
              };
            },
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['https://api.openai.com/v1/responses']);
    assert.deepEqual(timeoutDelays, [720000]);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('premium database deep search prompt v2 stays behind an explicit flag', async () => {
  let capturedPayload = null;
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
      count: 25,
    },
    {
      env: {
        OPENAI_API_KEY: 'openai-key',
        OPENAI_DATABASE_SEARCH_PROMPT_VERSION: 'v2',
      },
      fetchImpl: async (_url, options = {}) => {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Oisterwijk',
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

  assert.equal(result.promptVersion, 'v2');
  assert.equal(capturedPayload.prompt_cache_key, 'softora-premium-database-deep-search-v2');
  assert.match(capturedPayload.input[1].content, /Zoekstrategie v2/);
});

test('premium database deep search retries temporary OpenAI rate limits', async () => {
  const calls = [];
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
      count: 25,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      openAiRateLimitRetryDelayMs: 0,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (calls.length === 1) {
          return {
            ok: false,
            status: 429,
            headers: {
              get(name) {
                return name.toLowerCase() === 'retry-after' ? '0.001' : '';
              },
            },
            async json() {
              return {
                error: {
                  code: 'rate_limit_exceeded',
                  message: 'Rate limit reached. Please try again in 0.001s.',
                },
              };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Oisterwijk',
                businesses: [
                  {
                    bedrijfsnaam: 'Oisterwijk Zeker BV',
                    adres: 'Dorpsstraat 10, 5061 HJ Oisterwijk',
                    email: 'info@oisterwijkzeker.nl',
                    telefoonnummer: '013 123 4567',
                    website: 'https://oisterwijkzeker.nl',
                    bronnen: ['https://oisterwijkzeker.nl/contact'],
                  },
                ],
                placeComplete: false,
                completionReason: '',
                notes: '',
              }),
              output: [],
              usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            };
          },
        };
      },
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.found, 1);
  assert.equal(result.businesses[0].bedrijfsnaam, 'Oisterwijk Zeker BV');
});

test('premium database deep search hides raw OpenAI rate limit text after retries', async () => {
  await assert.rejects(
    fetchDeepSearchBusinessRows(
      {
        target: 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
        count: 25,
      },
      {
        env: { OPENAI_API_KEY: 'openai-key' },
        openAiRateLimitRetries: 0,
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          async json() {
            return {
              error: {
                code: 'rate_limit_exceeded',
                message: 'Rate limit reached for gpt-5.4 in organization org-example.',
              },
            };
          },
        }),
      }
    ),
    (error) => {
      assert.equal(error.code, 'OPENAI_DEEP_SEARCH_RATE_LIMIT');
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /OpenAI-snelheidslimiet geraakt/);
      assert.doesNotMatch(error.message, /org-example/);
      return true;
    }
  );
});

test('premium database deep search reports OpenAI aborts as a clean timeout', async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let timeoutDelay = 0;
  global.setTimeout = (callback, delay) => {
    timeoutDelay = delay;
    return originalSetTimeout(callback, 0);
  };
  global.clearTimeout = (timeout) => originalClearTimeout(timeout);

  try {
    await assert.rejects(
      fetchDeepSearchBusinessRows(
        {
          target: 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
          count: 25,
        },
        {
          env: { OPENAI_API_KEY: 'openai-key' },
          openAiTimeoutMs: 5,
          fetchImpl: async (_url, options = {}) =>
            new Promise((_resolve, reject) => {
              assert.ok(options.signal, 'OpenAI request should receive an abort signal');
              if (options.signal.aborted) {
                reject(new Error('This operation was aborted'));
                return;
              }
              options.signal.addEventListener(
                'abort',
                () => reject(new Error('This operation was aborted')),
                { once: true }
              );
            }),
        }
      ),
      (error) => {
        assert.equal(error.code, 'OPENAI_DEEP_SEARCH_TIMEOUT');
        assert.equal(error.statusCode, 504);
        assert.match(error.message, /AI zoeken duurde te lang/);
        return true;
      }
    );
    assert.equal(timeoutDelay, 720000);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('premium database deep search hard-filters businesses already in the exclude list', async () => {
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Breda | Bavel',
      count: 100,
      exclude: [
        'domain:growingbyknowing.nl',
        'email:info@linszorgt.nl',
        'Tuin Idee | contact@tuin-idee.com | www.tuin-idee.com | Bavel',
      ],
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              target: 'Bavel',
              businesses: [
                {
                  bedrijfsnaam: 'Growing By Knowing',
                  adres: 'Dorpsstraat 1, 4854 AA Bavel',
                  email: 'hello@growingbyknowing.nl',
                  telefoonnummer: '06 111 111 11',
                  website: 'https://www.growingbyknowing.nl',
                  bronnen: ['https://www.growingbyknowing.nl/contact'],
                },
                {
                  bedrijfsnaam: 'Lins Zorgt',
                  adres: 'Kerkstraat 2, 4854 BB Bavel',
                  email: 'info@linszorgt.nl',
                  telefoonnummer: '06 222 222 22',
                  website: 'https://linszorgt.nl',
                  bronnen: ['https://linszorgt.nl/contact'],
                },
                {
                  bedrijfsnaam: 'Tuin Idee',
                  adres: 'Brigidastraat 3, 4854 CT Bavel',
                  email: 'contact@tuin-idee.com',
                  telefoonnummer: '06 333 333 33',
                  website: 'https://tuin-idee.com',
                  bronnen: ['https://tuin-idee.com/contact'],
                },
                {
                  bedrijfsnaam: 'Bavel Nieuw BV',
                  adres: 'Bavelseparklaan 4, 4854 HR Bavel',
                  email: 'info@bavelnieuw.nl',
                  telefoonnummer: '076 444 44 44',
                  website: 'https://bavelnieuw.nl',
                  bronnen: ['https://bavelnieuw.nl/contact'],
                },
              ],
              placeComplete: false,
              completionReason: '',
              notes: '',
            }),
            output: [],
            usage: {
              input_tokens: 100,
              output_tokens: 80,
            },
          };
        },
      }),
    }
  );

  assert.equal(result.found, 1);
  assert.equal(result.rejected, 3);
  assert.deepEqual(result.businesses.map((business) => business.website), ['bavelnieuw.nl']);
});

test('premium database deep search keeps a compact prompt but hard-filters the full exclude list', async () => {
  const exclude = Array.from({ length: 650 }, (_item, index) => `domain:bestaand-${index}.nl`);
  let promptText = '';
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Breda | Bavel',
      count: 100,
      exclude,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async (_url, options = {}) => {
        const payload = JSON.parse(options.body);
        promptText = payload.input[1].content;
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Bavel',
                businesses: [
                  {
                    bedrijfsnaam: 'Bestaand 649',
                    adres: 'Kerkstraat 649, 4854 BB Bavel',
                    email: 'info@bestaand-649.nl',
                    telefoonnummer: '06 649 649 64',
                    website: 'https://bestaand-649.nl',
                    bronnen: ['https://bestaand-649.nl/contact'],
                  },
                  {
                    bedrijfsnaam: 'Nieuw Zeker BV',
                    adres: 'Dorpsstraat 5, 4854 AA Bavel',
                    email: 'info@nieuwzeker.nl',
                    telefoonnummer: '076 555 55 55',
                    website: 'https://nieuwzeker.nl',
                    bronnen: ['https://nieuwzeker.nl/contact'],
                  },
                ],
                placeComplete: false,
                completionReason: '',
                notes: '',
              }),
              output: [],
              usage: {
                input_tokens: 100,
                output_tokens: 80,
              },
            };
          },
        };
      },
    }
  );

  assert.match(promptText, /domain:bestaand-0\.nl/);
  assert.doesNotMatch(promptText, /domain:bestaand-649\.nl/);
  assert.equal(result.found, 1);
  assert.deepEqual(result.businesses.map((business) => business.website), ['nieuwzeker.nl']);
});

test('premium database deep search rejects service-area addresses and source mismatches', async () => {
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Etten-Leur | Etten-Leur',
      count: 100,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              target: 'Etten-Leur',
              businesses: [
                {
                  bedrijfsnaam: 'Servicegebied BV',
                  adres: 'Werkgebied Etten-Leur, kantoor Rotterdam',
                  email: 'info@servicegebied.nl',
                  telefoonnummer: '010 111 1111',
                  website: 'https://servicegebied.nl',
                  bronnen: ['https://servicegebied.nl/contact'],
                },
                {
                  bedrijfsnaam: 'Bron Mismatch BV',
                  adres: 'Markt 1, 4871 AA Etten-Leur',
                  email: 'info@bronmismatch.nl',
                  telefoonnummer: '076 222 2222',
                  website: 'https://bronmismatch.nl',
                  bronnen: ['https://bedrijvenplatform.example/contact'],
                },
                {
                  bedrijfsnaam: 'Etten Zeker BV',
                  adres: 'Markt 2, 4871 BB Etten-Leur',
                  email: 'info@ettenzeker.nl',
                  telefoonnummer: '076 333 3333',
                  website: 'https://ettenzeker.nl',
                  bronnen: ['https://ettenzeker.nl/contact'],
                },
              ],
              placeComplete: false,
              completionReason: '',
              notes: '',
            }),
            output: [],
            usage: {
              input_tokens: 100,
              output_tokens: 80,
            },
          };
        },
      }),
    }
  );

  assert.equal(result.found, 1);
  assert.equal(result.rejected, 2);
  assert.deepEqual(result.businesses.map((business) => business.website), ['ettenzeker.nl']);
});

test('premium database deep search keeps productive batches open for follow-up', async () => {
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Altena | Almkerk',
      count: 100,
      batchNumber: 1,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async (_url, options = {}) => {
        const payload = JSON.parse(options.body);
        assert.match(payload.input[0].content, /Zet placeComplete altijd op false wanneer je in deze response/);
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                target: 'Almkerk',
                businesses: [
                  {
                    bedrijfsnaam: 'Installatiebedrijf Altena',
                    adres: 'Voorstraat 10, 4286 AL Almkerk',
                    email: 'info@installatie-altena.nl',
                    telefoonnummer: '0183 555 555',
                    website: 'https://installatie-altena.nl',
                    bronnen: ['https://installatie-altena.nl/contact'],
                  },
                ],
                placeComplete: true,
                completionReason: 'Model dacht dat dit alles was.',
                notes: '',
              }),
              output: [],
              usage: {
                input_tokens: 100,
                output_tokens: 80,
              },
            };
          },
        };
      },
    }
  );

  assert.equal(result.found, 1);
  assert.equal(result.placeComplete, false);
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

test('premium database deep search defaults to gpt-5.4 with medium reasoning', async () => {
  const result = await fetchDeepSearchBusinessRows(
    {
      target: 'Nederland | Noord-Brabant | Altena | Almkerk',
      count: 1,
    },
    {
      env: { OPENAI_API_KEY: 'openai-key' },
      fetchImpl: async (_url, options = {}) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'gpt-5.4');
        assert.equal(payload.reasoning.effort, 'medium');
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

  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.reasoningEffort, 'medium');
  assert.equal(result.placeComplete, true);
  assert.equal(result.completionReason, 'Geen extra complete bedrijven gevonden.');
  assert.equal(result.serviceTier, 'flex');
  assert.equal(result.cost.estimatedUsd, 0.000275);
});

test('premium database deep search estimate uses active model pricing without calling OpenAI', () => {
  const cases = [
    {
      count: 25,
      expectedUsd: 0.42325,
      expectedBatches: 1,
      expectedInputTokens: 13200,
      expectedOutputTokens: 77000,
      expectedWebSearchCalls: 3,
    },
    {
      count: 250,
      expectedUsd: 3.94475,
      expectedBatches: 3,
      expectedInputTokens: 39600,
      expectedOutputTokens: 770000,
      expectedWebSearchCalls: 7,
    },
    {
      count: 500,
      expectedUsd: 7.85125,
      expectedBatches: 5,
      expectedInputTokens: 66000,
      expectedOutputTokens: 1540000,
      expectedWebSearchCalls: 11,
    },
  ];

  cases.forEach(({
    count,
    expectedUsd,
    expectedBatches,
    expectedInputTokens,
    expectedOutputTokens,
    expectedWebSearchCalls,
  }) => {
    const result = estimateDeepSearchBusinessRunCost(
      { count },
      {
        env: {
          OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.1',
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.estimateOnly, true);
    assert.equal(result.requested, count);
    assert.equal(result.batchSize, 100);
    assert.equal(result.estimatedBatches, expectedBatches);
    assert.equal(result.estimateMultiplier, 2.2);
    assert.equal(result.model, 'gpt-5.1');
    assert.equal(result.serviceTier, 'flex');
    assert.equal(result.cost.estimateMultiplier, 2.2);
    assert.equal(result.cost.upperEstimatedUsd, Number((expectedUsd * 2).toFixed(6)));
    assert.equal(result.cost.inputTokens, expectedInputTokens);
    assert.equal(result.cost.outputTokens, expectedOutputTokens);
    assert.equal(result.cost.webSearchCalls, expectedWebSearchCalls);
    assert.equal(result.cost.estimatedUsd, expectedUsd);
    assert.equal(result.cost.pricing.outputUsdPerMillion, 5);
  });
});

test('premium database deep search estimate defaults to gpt-5.4 medium reasoning', () => {
  const result = estimateDeepSearchBusinessRunCost(
    { count: 250 },
    {
      env: {},
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.reasoningEffort, 'medium');
  assert.equal(result.serviceTier, 'flex');
  assert.equal(result.estimateMultiplier, 2.2);
  assert.equal(result.cost.estimatedUsd, 5.8945);
  assert.equal(result.cost.upperEstimatedUsd, 11.789);
  assert.equal(result.cost.pricing.outputUsdPerMillion, 7.5);
});

test('premium database deep search ignores the generic OPENAI_MODEL fallback', () => {
  const result = estimateDeepSearchBusinessRunCost(
    { count: 25 },
    {
      env: {
        OPENAI_MODEL: 'gpt-5.1',
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.reasoningEffort, 'medium');
  assert.equal(result.serviceTier, 'flex');
  assert.equal(result.cost.estimatedUsd, 0.624);
  assert.equal(result.cost.upperEstimatedUsd, 1.248);
  assert.equal(result.cost.pricing.outputUsdPerMillion, 7.5);
});

test('premium database deep search estimate multiplier can be calibrated safely', () => {
  const result = estimateDeepSearchBusinessRunCost(
    { count: 25 },
    {
      env: {
        OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.4',
        OPENAI_DATABASE_SEARCH_ESTIMATE_MULTIPLIER: '1',
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.estimateMultiplier, 1);
  assert.equal(result.serviceTier, 'flex');
  assert.equal(result.cost.estimatedUsd, 0.28);
});

test('premium database deep search estimate route returns model-aware costs', () => {
  const coordinator = createPremiumDatabaseImportCoordinator({
    env: {
      OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.1',
    },
  });
  const response = {
    statusCode: 200,
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

  coordinator.sendDeepSearchEstimateResponse(
    { query: { count: '250' } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.requested, 250);
  assert.equal(response.body.model, 'gpt-5.1');
  assert.equal(response.body.serviceTier, 'flex');
  assert.equal(response.body.estimateMultiplier, 2.2);
  assert.equal(response.body.cost.estimatedUsd, 3.94475);
  assert.equal(response.body.cost.upperEstimatedUsd, 7.8895);
  assert.equal(response.body.cost.pricing.outputUsdPerMillion, 5);
});

test('premium database deep search estimate route returns model-aware costs without calling OpenAI', () => {
  const estimate = estimateDeepSearchBusinessRunCost(
    { count: 25 },
    { env: { OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.5', OPENAI_DATABASE_SEARCH_REASONING_EFFORT: 'high' } }
  );

  assert.equal(estimate.ok, true);
  assert.equal(estimate.source, 'openai-web-search-estimate');
  assert.equal(estimate.requested, 25);
  assert.equal(estimate.model, 'gpt-5.5');
  assert.equal(estimate.reasoningEffort, 'high');
  assert.equal(estimate.cost.currency, 'USD');
  assert.equal(estimate.estimateMultiplier, 2.2);
  assert.equal(estimate.cost.inputTokens, 13200);
  assert.equal(estimate.cost.outputTokens, 77000);
  assert.equal(estimate.cost.webSearchCalls, 3);
});

test('premium database deep search estimate route is wired through the coordinator', () => {
  const coordinator = createPremiumDatabaseImportCoordinator({
    env: { OPENAI_DATABASE_SEARCH_MODEL: 'gpt-5.5' },
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

  coordinator.sendDeepSearchEstimateResponse({ query: { count: '25' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.requested, 25);
  assert.equal(response.body.model, 'gpt-5.5');
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
  assert.match(featureRoutesSource, /createPremiumDatabaseImportCoordinator\(\{[\s\S]*getUiStateValues: deps\.getUiStateValues/);
  assert.match(featureRoutesSource, /setUiStateValues: deps\.setUiStateValues/);
  assert.match(featureRoutesSource, /dataOpsStore: deps\.dataOpsStore/);
  assert.match(featureRoutesSource, /createPremiumDatabaseMailReadySnapshotService\(\{[\s\S]*dataOpsStore: deps\.dataOpsStore/);
  assert.match(featureRoutesSource, /getUiStateValues: deps\.getUiStateValues/);
  assert.match(featureRoutesSource, /mailReadySnapshotService: premiumDatabaseMailReadySnapshotService/);
  assert.match(featureRoutesSource, /premiumDatabaseWebdesignJobsCoordinator\.setMailReadySnapshotService\(premiumDatabaseMailReadySnapshotService\)/);
  assert.match(featureRoutesSource, /requirePremiumApiAccess: premiumRouteRuntime\?\.requirePremiumApiAccess/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/import-spreadsheet'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/sync-spreadsheet'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/add-real-businesses'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/delete-lead'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/remove-webdesign-assets', requirePremiumApiAccess/);
  assert.match(routeSource, /app\.get\('\/api\/premium-database\/mail-ready-snapshot'/);
  assert.match(routeSource, /app\.get\('\/api\/premium-database\/deep-search-estimate'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/deep-search-businesses'/);
});

test('premium database Render config pins deep search to gpt-5.4 medium reasoning on flex', () => {
  const renderSource = fs.readFileSync(path.join(__dirname, '../../render.yaml'), 'utf8');

  assert.match(renderSource, /key: OPENAI_DATABASE_SEARCH_MODEL\s+value: gpt-5\.4/);
  assert.match(renderSource, /key: OPENAI_DATABASE_SEARCH_REASONING_EFFORT\s+value: medium/);
  assert.match(renderSource, /key: OPENAI_DATABASE_SEARCH_SERVICE_TIER\s+value: flex/);
  assert.match(renderSource, /key: OPENAI_DATABASE_SEARCH_PROMPT_VERSION\s+value: v1/);
  assert.match(renderSource, /key: OPENAI_DATABASE_SEARCH_ESTIMATE_MULTIPLIER\s+value: "2\.2"/);
});
