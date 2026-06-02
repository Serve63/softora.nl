const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildImportCsv,
  buildProgressPayload,
  harvestLocation,
  inspectOfficialWebsite,
  loadPlanningTargets,
  normalizeDomain,
  runHarvest,
  shouldCompleteLocation,
  splitRecordsForImport,
  validateCandidate,
  writeOutputs,
} = require('../../tools/lib/premium-database-harvest-core');
const { parseSpreadsheetUpload } = require('../../server/services/premium-database-import');

function response(body, url, status = 200) {
  return {
    ok: status >= 200 && status < 400,
    status,
    url,
    headers: {
      get(name) {
        return name === 'content-type' ? 'text/html; charset=utf-8' : '';
      },
    },
    async text() {
      return body;
    },
  };
}

function validBusinessHtml({
  name = 'Acme Helvoirt BV',
  email = 'info@acme-helvoirt.nl',
  phone = '073 123 45 67',
  address = 'Dorpsstraat 10, 5268 AB Helvoirt',
  contactPath = '/contact',
} = {}) {
  return `<!doctype html>
  <html lang="nl">
    <head><title>${name} - lokale specialist</title></head>
    <body>
      <h1>${name}</h1>
      <p>Wij zijn een lokaal MKB-bedrijf met diensten voor klanten in de regio.</p>
      <p>Deze tekst is bewust lang genoeg om niet als placeholder te tellen. Wij bestaan al jaren,
      helpen bedrijven en particulieren, en tonen echte contactinformatie op onze website.</p>
      <a href="${contactPath}">Contact</a>
      <section>
        <p>${address}</p>
        <p><a href="mailto:${email}">${email}</a></p>
        <p><a href="tel:${phone}">${phone}</a></p>
      </section>
    </body>
  </html>`;
}

function createFetchByUrl(pages) {
  return async (url) => {
    const normalized = String(url).replace(/\/+$/, '/');
    if (!Object.prototype.hasOwnProperty.call(pages, normalized)) {
      return response('Niet gevonden', normalized, 404);
    }
    return response(pages[normalized], normalized);
  };
}

test('premium database harvest follows the live planning order', async () => {
  const labels = await loadPlanningTargets();

  assert.equal(labels[0], 'Nederland | Noord-Brabant | Vught | Helvoirt');
  assert.equal(labels[1], 'Nederland | Noord-Brabant | Boxtel | Boxtel');
  assert.equal(labels[2], 'Nederland | Noord-Brabant | Boxtel | Esch');
  assert.equal(labels.some((label) => label.includes(' | Oisterwijk | ')), false);
  assert.equal(labels.some((label) => label.includes(' | Tilburg | ')), false);
});

test('premium database harvest accepts only complete records from reachable official websites', async () => {
  const targetLabel = 'Nederland | Noord-Brabant | Vught | Helvoirt';
  const result = await inspectOfficialWebsite('https://acme-helvoirt.nl', {
    label: targetLabel,
    place: 'Helvoirt',
  }, {
    fetchImpl: createFetchByUrl({
      'https://acme-helvoirt.nl/': validBusinessHtml(),
      'https://acme-helvoirt.nl/contact/': validBusinessHtml(),
    }),
  });

  assert.equal(result.raw.accepted, true);
  assert.equal(result.candidate.companyName, 'Acme Helvoirt BV');
  assert.equal(result.candidate.email, 'info@acme-helvoirt.nl');
  assert.equal(result.candidate.phone, '073 123 45 67');
  assert.equal(result.candidate.address, 'Dorpsstraat 10, 5268 AB Helvoirt');
  assert.equal(normalizeDomain(result.candidate.website), 'acme-helvoirt.nl');
});

test('premium database harvest rejects incomplete, wrong-place, parked and blacklisted candidates', () => {
  const target = { label: 'Nederland | Noord-Brabant | Vught | Helvoirt', place: 'Helvoirt' };
  const baseCandidate = {
    companyName: 'Acme Helvoirt BV',
    website: 'https://acme-helvoirt.nl',
    websiteReachable: true,
    email: 'info@acme-helvoirt.nl',
    phone: '073 123 45 67',
    address: 'Dorpsstraat 10, 5268 AB Helvoirt',
  };

  assert.deepEqual(validateCandidate(baseCandidate, target), []);
  assert.match(validateCandidate({ ...baseCandidate, email: '' }, target).join(', '), /e-mail ontbreekt/);
  assert.match(validateCandidate({ ...baseCandidate, phone: '' }, target).join(', '), /telefoon ontbreekt/);
  assert.match(validateCandidate({ ...baseCandidate, websiteReachable: false }, target).join(', '), /website niet bereikbaar/);
  assert.match(validateCandidate({ ...baseCandidate, address: 'Markt 1, 5211 JV Den Bosch' }, target).join(', '), /exacte plaats/);
  assert.match(validateCandidate({ ...baseCandidate, phone: '025-10-07' }, target).join(', '), /telefoon ontbreekt/);
  assert.match(validateCandidate({ ...baseCandidate, phone: '06 12 6.47-6.47-1.06' }, target).join(', '), /telefoon ontbreekt/);
  assert.deepEqual(validateCandidate({ ...baseCandidate, phone: '+31 (0)13-52 87 149' }, target), []);
  assert.match(validateCandidate({ ...baseCandidate, address: '5081 CA Helvoirt' }, target).join(', '), /volledig straatadres/);
  assert.match(validateCandidate({ ...baseCandidate, website: 'https://www.bouwinfosys.nl' }, target).join(', '), /blacklist/);
  assert.match(validateCandidate({ ...baseCandidate, companyName: 'Hulp en advies voor ondernemers', website: 'https://www.hilvarenbeek.nl/hulp-en-advies-voor-ondernemers' }, target).join(', '), /blacklist/);
});

test('premium database harvest dedupes by domain, email, phone and company address', async () => {
  const targetLabel = 'Nederland | Noord-Brabant | Vught | Helvoirt';
  const duplicateHtml = validBusinessHtml({
    name: 'Dubbel Helvoirt BV',
    email: 'info@dubbel.nl',
    phone: '073 777 77 77',
    address: 'Kerkstraat 4, 5268 AA Helvoirt',
  });
  const result = await harvestLocation(targetLabel, {
    searchProvider: 'none',
    seedUrlsByTarget: {
      [targetLabel]: [
        'https://dubbel-helvoirt.nl',
        'https://tweede-dubbel.nl',
      ],
    },
    fetchImpl: createFetchByUrl({
      'https://dubbel-helvoirt.nl/': duplicateHtml,
      'https://tweede-dubbel.nl/': duplicateHtml,
    }),
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.raw.some((entry) => (entry.reasons || []).includes('duplicaat')), true);
});

test('premium database harvest emits live progress while a location is still running', async () => {
  const targetLabel = 'Nederland | Noord-Brabant | Vught | Helvoirt';
  const snapshots = [];
  const result = await harvestLocation(targetLabel, {
    searchProvider: 'none',
    seedUrlsByTarget: {
      [targetLabel]: ['https://live-helvoirt.nl'],
    },
    fetchImpl: createFetchByUrl({
      'https://live-helvoirt.nl/': validBusinessHtml({
        name: 'Live Helvoirt BV',
        email: 'info@live-helvoirt.nl',
        phone: '073 222 33 44',
        address: 'Torenstraat 8, 5268 AT Helvoirt',
      }),
    }),
    onProgress(partial) {
      snapshots.push({
        acceptedCount: partial.progress.acceptedCount,
        rejectedCount: partial.progress.rejectedCount,
        candidatesSeen: partial.progress.candidatesSeen,
        status: partial.progress.status,
        completed: partial.progress.completed,
        records: partial.accepted.length,
        raw: partial.raw.length,
      });
    },
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(snapshots.length > 2, true);
  assert.equal(snapshots.some((snapshot) => snapshot.status === 'bezig'), true);
  assert.equal(snapshots.some((snapshot) => snapshot.acceptedCount === 1 && snapshot.records === 1), true);
  assert.equal(snapshots.at(-1).completed, true);
});

test('premium database harvest completion waits for source mix and two empty expansion rounds', () => {
  assert.equal(shouldCompleteLocation({ sourceFamilies: new Set(['general-search', 'directory']), emptyRounds: 2 }), false);
  assert.equal(shouldCompleteLocation({ sourceFamilies: new Set(['general-search', 'directory', 'association']), emptyRounds: 1 }), false);
  assert.equal(shouldCompleteLocation({ sourceFamilies: new Set(['general-search', 'directory', 'association']), emptyRounds: 2 }), true);
});

test('premium database harvest writes import CSV accepted by existing premium import parser', () => {
  const csv = buildImportCsv([
    {
      companyName: 'Acme Helvoirt BV',
      address: 'Dorpsstraat 10, 5268 AB Helvoirt',
      email: 'info@acme-helvoirt.nl',
      phone: '073 123 45 67',
      website: 'https://acme-helvoirt.nl/',
    },
  ], '2026-06-02');
  const parsed = parseSpreadsheetUpload({
    fileName: 'softora-bedrijven-importklaar.csv',
    dataBase64: Buffer.from(csv, 'utf8').toString('base64'),
  });

  assert.equal(parsed.fileType, 'csv');
  assert.deepEqual(parsed.rows[0], [
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
  ]);
  assert.equal(parsed.rows[1][0], 'Acme Helvoirt BV');
  assert.equal(parsed.rows[1][7], 'benaderbaar');
});

test('premium database harvest splits import batches below backend limit', () => {
  const records = Array.from({ length: 2001 }, (_item, index) => ({ companyName: `Bedrijf ${index}` }));
  const chunks = splitRecordsForImport(records, 1999);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 1999);
  assert.equal(chunks[1].length, 2);
});

test('premium database harvest writes live html, raw jsonl and csv outputs', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-harvest-'));
  const siteProgressPath = path.join(outputDir, 'site-progress.json');
  const result = await writeOutputs(outputDir, {
    records: [
      {
        companyName: 'Acme Helvoirt BV',
        address: 'Dorpsstraat 10, 5268 AB Helvoirt',
        email: 'info@acme-helvoirt.nl',
        phone: '073 123 45 67',
        website: 'https://acme-helvoirt.nl/',
        sourceFamily: 'official-site',
      },
    ],
    raw: [{ accepted: false, target: 'Helvoirt', reasons: ['e-mail ontbreekt'], url: 'https://voorbeeld.nl' }],
    progress: [{
      target: 'Nederland | Noord-Brabant | Vught | Helvoirt',
      status: 'afgerond',
      completed: true,
      acceptedCount: 1,
      rejectedCount: 1,
      candidatesSeen: 2,
      completionReason: 'Meerdere bronsoorten doorzocht en twee lege uitbreidingsrondes gehaald.',
    }],
    updatedAt: '2026-06-02T12:00:00.000Z',
  }, {
    siteProgressPath,
  });

  assert.equal(fs.existsSync(result.csvPath), true);
  assert.equal(fs.existsSync(result.rawJsonlPath), true);
  assert.equal(fs.existsSync(result.liveHtmlPath), true);
  assert.equal(fs.existsSync(result.progressJsonPath), true);
  assert.equal(fs.existsSync(result.siteProgressPath), true);
  const liveHtml = fs.readFileSync(result.liveHtmlPath, 'utf8');
  assert.match(liveHtml, /meta http-equiv="refresh"/);
  assert.match(liveHtml, /Laatst bijgewerkt: <span id="liveUpdatedTime">12:00<\/span>/);
  assert.match(liveHtml, /window\.setInterval\(updateLiveTime, 1000\)/);
  assert.doesNotMatch(liveHtml, /Laatst bijgewerkt: 2026-06-02T12:00:00\.000Z/);
  assert.doesNotMatch(liveHtml, /Importklaar:/);
  assert.match(liveHtml, /Importklare bedrijven/);
  assert.match(liveHtml, /Complete bedrijven/);
  assert.doesNotMatch(liveHtml, /Bronfamilie/);
  assert.doesNotMatch(liveHtml, /Nieuw laatste batch/);
  assert.doesNotMatch(liveHtml, /Afgekeurd/);
  assert.doesNotMatch(liveHtml, /Kandidaten/);
  assert.doesNotMatch(liveHtml, /Laatste afkeuringen/);
  const progress = JSON.parse(fs.readFileSync(result.progressJsonPath, 'utf8'));
  const siteProgress = JSON.parse(fs.readFileSync(result.siteProgressPath, 'utf8'));
  assert.deepEqual(progress.completedTargetLabels, ['Nederland | Noord-Brabant | Vught | Helvoirt']);
  assert.deepEqual(siteProgress.completedTargetLabels, progress.completedTargetLabels);
});

test('premium database harvest progress payload exposes completed targets for the site modal', () => {
  const progress = buildProgressPayload({
    records: [{ companyName: 'Acme Helvoirt BV' }],
    raw: [{ accepted: true }, { accepted: false }],
    progress: [
      {
        target: 'Nederland | Noord-Brabant | Vught | Helvoirt',
        status: 'afgerond',
        completed: true,
        acceptedCount: 62,
        rejectedCount: 12,
        candidatesSeen: 74,
      },
      {
        target: 'Nederland | Noord-Brabant | Boxtel | Boxtel',
        status: 'bezig',
        completed: false,
        acceptedCount: 5,
      },
    ],
    updatedAt: '2026-06-02T12:00:00.000Z',
  });

  assert.equal(progress.importReadyCount, 1);
  assert.equal(progress.rawCandidateCount, 2);
  assert.deepEqual(progress.completedTargetLabels, ['Nederland | Noord-Brabant | Vught | Helvoirt']);
  assert.equal(progress.targetProgress[0].completed, true);
  assert.equal(progress.targetProgress[1].completed, false);
});

test('premium database harvest can run without paid data sources or Google Places', async () => {
  const targetLabel = 'Nederland | Noord-Brabant | Vught | Helvoirt';
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-harvest-run-'));
  const result = await runHarvest({
    targets: [targetLabel],
    maxLocations: 1,
    searchProvider: 'none',
    seedUrlsByTarget: {
      [targetLabel]: ['https://acme-helvoirt.nl'],
    },
    outputDir,
    fetchImpl: createFetchByUrl({
      'https://acme-helvoirt.nl/': validBusinessHtml(),
    }),
  });
  const scriptSource = fs.readFileSync(path.join(process.cwd(), 'tools/run-premium-database-harvest.js'), 'utf8')
    + fs.readFileSync(path.join(process.cwd(), 'tools/lib/premium-database-harvest-core.js'), 'utf8');

  assert.equal(result.records.length, 1);
  assert.equal(scriptSource.includes('places.googleapis.com'), false);
  assert.equal(scriptSource.includes('GOOGLE_PLACES'), false);
});
