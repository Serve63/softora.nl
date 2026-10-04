const test = require('node:test');
const assert = require('node:assert/strict');
const { rolesFor, render } = require('../../assets/kvk-database-planning-workers');

const oirschot = { woonplaatscode: 'a', woonplaats: 'Oirschot', provincie: 'Noord-Brabant' };
const helvoirt = { woonplaatscode: 'b', woonplaats: 'Helvoirt', provincie: 'Noord-Brabant' };
const biezenmortel = { woonplaatscode: 'c', woonplaats: 'Biezenmortel', provincie: 'Noord-Brabant' };
const snapshot = {
  latestTreated: [
    { found_by_role_label: 'Robot Controleur', woonplaats: 'Helvoirt', provincie: 'Noord-Brabant' },
    { found_by_role_label: 'Robot', woonplaats: 'Oirschot', provincie: 'Noord-Brabant' },
  ],
  controlLocation: { place: 'Helvoirt', provincie: 'Noord-Brabant', percent: 10 },
};

test('each robot is marked where it works now, from the snapshot', () => {
  assert.deepEqual(rolesFor(oirschot, [], {}, snapshot), ['robot']);
  assert.deepEqual(rolesFor(helvoirt, [], {}, snapshot), ['controller-robot']);
  assert.deepEqual(rolesFor(biezenmortel, [], {}, snapshot), []);
  assert.deepEqual(rolesFor({ ...oirschot, provincie: 'Limburg' }, [], {}, snapshot), []);
  assert.match(render(['robot', 'controller-robot']), /Robot Searcher.*Robot Controleur/);
});

test('the old AI Searcher and Controleur markers are gone', () => {
  assert.deepEqual(rolesFor(biezenmortel, [biezenmortel], { contact_active_location_code: 'c' }, {}), []);
  assert.doesNotMatch(render(['robot', 'controller-robot']), />Searcher<|>Controleur</);
});
