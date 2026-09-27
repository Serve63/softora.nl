const test = require('node:test');
const assert = require('node:assert/strict');
const { rolesFor, render } = require('../../assets/kvk-database-planning-workers');
const locations = [
  { woonplaatscode: 'a', stage_progress: { researched: 10, reviewed: 10 } },
  { woonplaatscode: 'b', stage_progress: { researched: 10, reviewed: 3 } },
  { woonplaatscode: 'c', woonplaats: 'Plaats', provincie: 'Brabant', stage_progress: { researched: 2, reviewed: 1 } },
];
const scraper = { contact_active_location_code: 'c' };
const workers = { searcher: { enabled: true }, controller: { enabled: true }, robot: { active: true } };
test('marks each role at its planning location, including shared locations', () => {
  assert.deepEqual(rolesFor(locations[0], locations, scraper, workers), []);
  assert.deepEqual(rolesFor(locations[1], locations, scraper, workers), ['controller']);
  assert.deepEqual(rolesFor(locations[2], locations, scraper, workers, { woonplaatscode: 'c' }), ['searcher', 'robot']);
  assert.match(render(['searcher', 'controller', 'robot']), /Searcher.*Controleur.*Robot/);
});
test('explicit control route overrides the next unfinished stage', () => {
  const state = { ...scraper, contact_parallel_routes: [{ queue_kind: 'global_review', active_location_code: 'c' }] };
  assert.deepEqual(rolesFor(locations[1], locations, state, workers), []);
  assert.deepEqual(rolesFor(locations[2], locations, state, workers), ['searcher', 'controller']);
});
test('unknown and inactive robot locations are never guessed', () => {
  assert.deepEqual(rolesFor(locations[2], locations, scraper, {}), []);
  assert.deepEqual(rolesFor(locations[2], locations, scraper, workers, { plaats: 'Plaats', provincie: 'Anders' }), ['searcher']);
  assert.deepEqual(rolesFor(locations[2], locations, scraper, workers, { plaats: 'Plaats', provincie: 'Brabant' }), ['searcher', 'robot']);
});
