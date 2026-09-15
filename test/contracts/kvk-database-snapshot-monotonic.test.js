const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '../..');
const bundlePath = path.join(repoRoot, 'assets/kvk-database.js');

function readBundle() {
  return fs.readFileSync(bundlePath, 'utf8');
}

test('kvk database snapshot rendering never moves backwards in time', () => {
  const source = readBundle();
  assert.match(source, /activeSnapshotTime=snapshotTime\(embeddedSnapshot\)/);
  assert.match(source, /function snapshotTime\(e\)\{/);
  assert.match(
    source,
    /if\(s>0&&activeSnapshotTime>0&&s<activeSnapshotTime\)return!1;if\(s>0\)activeSnapshotTime=s;activeSnapshot=e/
  );
});

test('kvk snapshotTime prefers synced/updated/generated timestamps in order', () => {
  const source = readBundle();
  const match = source.match(/function snapshotTime\(e\)\{[^{}]*\}/);
  assert.ok(match, 'snapshotTime helper aanwezig');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${match[0]};this.__snapshotTime = snapshotTime;`, sandbox);
  const snapshotTime = sandbox.__snapshotTime;
  assert.equal(snapshotTime(null), 0);
  assert.equal(snapshotTime({}), 0);
  assert.equal(snapshotTime({ generatedAt: 'niet-een-datum' }), 0);
  const generated = Date.parse('2026-09-15T14:38:00+02:00');
  assert.equal(snapshotTime({ generatedAt: '2026-09-15T14:38:00+02:00' }), generated);
  assert.equal(
    snapshotTime({ generatedAt: '2026-09-15T14:33:00+02:00', updatedAt: '2026-09-15T14:38:00+02:00' }),
    generated
  );
  assert.equal(
    snapshotTime({
      generatedAt: '2026-09-15T14:33:00+02:00',
      updatedAt: '2026-09-15T14:36:00+02:00',
      syncedAt: '2026-09-15T14:38:00+02:00',
    }),
    generated
  );
});

test('kvk setActiveSnapshot weigert oudere momentopnamen na een nieuwere', () => {
  const source = readBundle();
  const setterIndex = source.indexOf('function setActiveSnapshot(e){');
  assert.ok(setterIndex >= 0, 'setActiveSnapshot aanwezig');
  const guardIndex = source.indexOf('s<activeSnapshotTime)return!1', setterIndex);
  const assignIndex = source.indexOf('activeSnapshot=e', setterIndex);
  assert.ok(guardIndex >= 0 && assignIndex >= 0 && guardIndex < assignIndex,
    'tijdwacht staat voor de toewijzing');
});
