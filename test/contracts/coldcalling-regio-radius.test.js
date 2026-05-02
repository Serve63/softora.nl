const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

function loadRegioRadiusHelpers() {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/coldcalling-regio-radius.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraColdcallingRegioRadius;
}

test('coldcalling regio radius helper counts leads with the extracted place map', () => {
  const helpers = loadRegioRadiusHelpers();
  const tilburgCoords = helpers.coordsForPlaceHint('Gemeente Tilburg');

  assert.equal(helpers.normalizeDutchPlaceKey('5211 AA \u2019s-Hertogenbosch'), 's-hertogenbosch');
  assert.equal(tilburgCoords.lat, 51.5555);
  assert.equal(tilburgCoords.lng, 5.0913);
  assert.equal(
    helpers.countDialableLeadsWithinCampaignRegioRadius(
      [
        { region: 'Oisterwijk' },
        { region: 'Breda' },
        { region: 'Maastricht' },
        { region: 'Onbekend' },
      ],
      10
    ),
    1
  );
  assert.equal(
    helpers.countDialableLeadsWithinCampaignRegioRadius(
      [
        { region: 'Oisterwijk' },
        { region: 'Breda' },
      ],
      Infinity
    ),
    2
  );
  assert.ok(Math.abs(helpers.minAirDistanceKmFromOisterwijkForLead({ region: 'Almkerk' }) - 26.6) < 0.1);
  assert.equal(
    helpers.resolveAutomaticCampaignRegioKm(
      [
        { region: 'Oisterwijk' },
        { region: 'Roosendaal' },
      ],
      { maxKm: 250 }
    ),
    60
  );
});

test('coldcalling regio radius uses the visible kilometer value without hidden margin', () => {
  const helpers = loadRegioRadiusHelpers();

  assert.equal(
    helpers.countDialableLeadsWithinCampaignRegioRadius([{ region: 'Roosendaal' }], 50),
    0
  );
  assert.equal(
    helpers.countDialableLeadsWithinCampaignRegioRadius([{ region: 'Roosendaal' }], 60),
    1
  );
});

test('coldcalling dashboard delegates regio radius data to the extracted helper asset', () => {
  const dashboardSource = fs.readFileSync(path.join(repoRoot, 'assets/coldcalling-dashboard.js'), 'utf8');

  assert.match(dashboardSource, /window\.SoftoraColdcallingRegioRadius/);
  assert.match(dashboardSource, /countDialableLeadsWithinCampaignRegioRadius,\s*resolveAutomaticCampaignRegioKm,/);
  assert.doesNotMatch(dashboardSource, /REGIO_PLACE_COORD_ENTRIES/);
  assert.doesNotMatch(dashboardSource, /function haversineKm\(/);
});

test('coldcalling pages load regio radius helpers before the dashboard bootstrap', () => {
  [
    'ai-lead-generator.html',
    'ai-coldmailing.html',
    'premium-ai-lead-generator.html',
  ].forEach((relativePath) => {
    const pageSource = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(
      pageSource,
      /<script src="assets\/coldcalling-conversation-summary\.js\?v=20260427a" defer><\/script>\s*<script src="assets\/coldcalling-regio-radius\.js\?v=20260502a" defer><\/script>\s*<script src="assets\/coldcalling-manual-lead-prompt\.js\?v=20260427a" defer><\/script>\s*(?:<script src="assets\/coldcalling-campaign-recipient-preview\.js\?v=20260502a" defer><\/script>\s*)?<script src="assets\/coldcalling-dashboard\.js\?v=(?:20260427e|20260502a)" defer><\/script>/,
      relativePath
    );
  });
});
