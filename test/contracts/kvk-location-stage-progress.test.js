const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getProgress, completionFlags, percentage, render } = require('../../assets/kvk-database-location-progress');
const flags = { kvkComplete: true };
const location = (total, researched, reviewed) => ({ stage_progress: { total, researched, reviewed } });

test('location progress measures completed companies inside the current stage', () => {
  assert.deepEqual(getProgress(location(200, 84, 10), flags), {
    stage: 'Onderzoek', completed: 84, total: 200, percent: 42, updatedAt: '',
  });
  assert.equal(getProgress(location(200, 200, 84), flags).stage, 'Controle');
  assert.equal(getProgress(location(200, 200, 84), flags).percent, 42);
  assert.equal(getProgress(location(200, 200, 200), flags).stage, 'Afgerond');
  assert.equal(getProgress(location(200, 200, 200), flags).percent, 100);
});

test('missing, empty and contradictory counts never invent a percentage', () => {
  for (const value of [{}, location(0, 0, 0), location(100, 50, 60), location(100, 101, 0), location(100, null, 0)]) {
    assert.equal(getProgress(value, { ...flags, researchComplete: true }).percent, null);
  }
  assert.equal(getProgress(location(100, 100, 100), { ...flags, kvkLimited: true }).percent, null);
  assert.equal(getProgress(location(100, 100, 100), {}).stage, 'KVK');
  assert.equal(percentage(999, 1000), 99);
});

test('location label exposes the stage, percentage, counts and snapshot time safely', () => {
  const source = render({ ...location(1399, 1399, 1385), stage_progress: { total: 1399, researched: 1399, reviewed: 1385, updated_at: '2026-09-09T19:00:00Z' } }, flags);
  assert.match(source, />Controle: 99%<\/span>/);
  assert.match(source, /1\.385 van 1\.399 bedrijven/);
  assert.match(source, /Bijgewerkt:/);
  assert.match(render({}, flags), /Onderzoek: —/);
});

test('the scraper loads stage progress before rendering planning rows', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-kvk-database.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../../assets/kvk-database.js'), 'utf8');
  assert.ok(page.indexOf('/assets/kvk-database-location-progress.js') < page.indexOf('/assets/kvk-database.js'));
  assert.match(script, /SoftoraKvkLocationProgress\.render\(e,/);
});

test('stage checkmarks follow the same measured company counts as the percentage', () => {
  const current = completionFlags(location(200, 200, 84), flags);
  assert.equal(current.researchComplete, true);
  assert.equal(current.reviewComplete, false);
  assert.equal(completionFlags(location(200, 200, 200), flags).reviewComplete, true);
  assert.equal(completionFlags(location(200, 84, 10), { ...flags, researchComplete: true }).researchComplete, false);
});
