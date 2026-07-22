const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_EMBEDDED_JSON_BYTES,
  findOversizedEmbeddedJson,
  isBlockedArtifactPath,
  listPublicDataExposureViolations,
  looksLikeEmbeddedBusinessDataset,
} = require('../../scripts/check-public-data-exposure');

test('public data guard blocks common export paths and database files', () => {
  [
    'backups/runtime.json',
    'exports/customers.json',
    'output/result.txt',
    'outputs/run/result.json',
    'reports/private-audit.txt',
    'research/companies.json',
    'customers.csv',
    'data/companies.xlsx',
    'runtime.sqlite',
  ].forEach((filePath) => assert.equal(isBlockedArtifactPath(filePath), true, filePath));

  assert.equal(isBlockedArtifactPath('docs/research-method.md'), false);
  assert.equal(isBlockedArtifactPath('assets/config.json'), false);
});

test('public data guard blocks large application-json payloads in html', () => {
  const payload = 'x'.repeat(MAX_EMBEDDED_JSON_BYTES + 1);
  const html = `<script id="snapshot" type="application/json">${payload}</script>`;
  const violations = findOversizedEmbeddedJson('dashboard.html', html);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /ingebedde JSON/);
  assert.deepEqual(findOversizedEmbeddedJson('dashboard.html', '<script type="application/json">{}</script>'), []);
});

test('public data guard recognizes embedded business datasets', () => {
  const dataset = JSON.stringify({
    bedrijfsnaam: 'Voorbeeld B.V.',
    kvk_nummer: '00000000',
    telefoonnummer: '0000000000',
    contact_research_note: 'Testfixture zonder echte contactdata.',
  });

  assert.equal(looksLikeEmbeddedBusinessDataset(dataset), true);
  assert.equal(looksLikeEmbeddedBusinessDataset('{"bedrijfsnaam":"Voorbeeld B.V."}'), false);
});

test('tracked repository contains no public data exposure violations', () => {
  assert.deepEqual(listPublicDataExposureViolations(), []);
});
