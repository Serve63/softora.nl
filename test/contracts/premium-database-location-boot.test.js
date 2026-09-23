const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise only scripts actually present at first paint, without opening deep search.
test('initial database boot has nationwide locations before distance sorting', () => {
  const root = path.resolve(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'premium-database.html'), 'utf8');
  const scripts = Array.from(page.matchAll(/<script\b[^>]*src="(assets\/premium-database-(?:target-coords|distance)\.js)(?:\?[^"]*)?"[^>]*>/g));
  assert.deepEqual(scripts.map(match => match[1]), [
    'assets/premium-database-target-coords.js',
    'assets/premium-database-distance.js',
  ]);
  const browser = { atob };
  for (const match of scripts) {
    assert.doesNotMatch(match[0], /\b(?:async|defer)\b/, 'Both location scripts must be ready before inline database boot');
    vm.runInNewContext(fs.readFileSync(path.join(root, match[1]), 'utf8'), browser);
  }
  const distance = browser.SoftoraPremiumDatabaseDistance;
  const rows = [
    { id: 'far', stad: 'Kwelderweg 1, 9979 XN Eemshaven' },
    { id: 'middle', stad: 'Zandbank, Vrouwenpolder, Zeeland' },
    { id: 'near', stad: 'Haaren, Noord-Brabant' },
  ];
  for (const row of rows) assert.ok(Number.isFinite(distance.getDistanceKm(row)), row.stad);
  assert.deepEqual(Array.from(distance.sortCustomersByDistance(rows), row => row.id), ['near', 'middle', 'far']);
});

test('indexed location lookup keeps complete place matches and disambiguation', () => {
  const coords = require('../../assets/premium-database-target-coords.js');
  const expected = coords.getTargetCoords({ province: 'Zeeland', municipality: 'Veere', place: 'Vrouwenpolder' });
  assert.ok(expected);
  const matched = coords.resolveTextCoords('Zandbank, Vrouwenpolder, Zeeland', {
    province: 'Zeeland', municipality: 'Veere',
  });
  assert.equal(matched.lat, expected.lat);
  assert.equal(matched.lng, expected.lng);
  assert.equal(coords.resolveTextCoords('Vrouwenpolderlaan zonder woonplaats', {}), null);
});
