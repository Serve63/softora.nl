const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

function loadCampaignRadiusHelpers() {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-campaign-radius.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraCampaignRadius;
}

test('premium campaign radius calculates deterministic Oisterwijk distances', () => {
  const helpers = loadCampaignRadiusHelpers();

  assert.equal(helpers.isWithinRadius({ adres: 'Dorpsstraat 1, Oisterwijk' }, 10), true);
  assert.equal(helpers.isWithinRadius({ adres: 'Markt 1, Breda' }, 20), false);
  assert.equal(helpers.isWithinRadius({ adres: 'Markt 1, Breda' }, 40), true);
});

test('premium campaign radius does not match place names inside street words', () => {
  const helpers = loadCampaignRadiusHelpers();

  assert.equal(Number.isFinite(helpers.getDistanceKm({ adres: 'Bredaseweg 1' })), false);
  assert.equal(Number.isFinite(helpers.getDistanceKm({ adres: 'Besterdplein 1' })), false);
  assert.equal(helpers.isWithinRadius({ adres: 'Bredaseweg 1, Tilburg' }, 20), true);
});

test('premium campaign radius ignores row radius metadata as a distance', () => {
  const helpers = loadCampaignRadiusHelpers();

  assert.equal(helpers.isWithinRadius({ adres: 'Markt 1, Breda', radiusKm: 0 }, 20), false);
  assert.equal(helpers.isWithinRadius({ adres: 'Markt 1, Breda', distanceKm: 5 }, 20), true);
});
