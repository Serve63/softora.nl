const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadDataset() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read('assets/transferwereld-data.js'), context);
  return context.window.TRANSFERWERELD_DATA;
}

test('transferwereld exposes all requested analysis tabs and defaults to fee sorting', () => {
  const html = read('transfers.html');
  const tabNames = [
    'Alle transfers',
    'Meeste uitgegeven',
    'Meeste verdiend',
    'Geruchten',
    'Versterkt / verzwakt',
    'Selectiediepte',
    'Competitieprognoses',
  ];
  tabNames.forEach((name) => assert.match(html, new RegExp(name.replace('/', '\\/'))));
  assert.match(html, /Alle transfers van de top 100 clubs/);
  assert.doesNotMatch(html, /101 (?:geselecteerde )?(?:top)?clubs/);
  assert.match(html, /<select id="transfer-sort"><option value="fee">Hoogste transfersom<\/option>/);
  const script = read('assets/transferwereld.js');
  assert.match(script, /if \(sort === 'fee'\) return right\.feeValue - left\.feeValue/);
  assert.match(script, /secondaryKey === 'income' \? 'verdiend' : 'uitgegeven'/);
});

test('transferwereld shows a desktop-only notice below the desktop breakpoint', () => {
  const html = read('transfers.html');
  const css = read('assets/transferwereld.css');
  assert.match(html, /class="mobile-desktop-gate"/);
  assert.match(html, /Enkel beschikbaar<br>op desktop/);
  assert.match(css, /\.mobile-desktop-gate \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /body > main,[\s\S]*body > footer,[\s\S]*body > dialog \{ display: none !important; \}/);
});

test('transferwereld dataset covers the Opta top 100 plus the requested competition scope', () => {
  const data = loadDataset();
  assert.ok(data.clubs.length >= 180, `expected top 100 plus competition clubs, found ${data.clubs.length}`);
  assert.deepEqual(Array.from(data.clubs.slice(0, 100), (club) => club.rank), Array.from({ length: 100 }, (_, index) => index + 1));
  const ajax = data.clubs.find((club) => club.transfermarkt?.id === 610);
  assert.equal(ajax?.rank, 133);
  assert.equal(ajax?.isWildcard, true);
  assert.deepEqual(Array.from(data.scopeLeagues, (league) => league.name), [
    'Premier League', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Eredivisie', 'Liga Portugal', 'Keuken Kampioen Divisie',
  ]);
  assert.deepEqual(Array.from(data.scopeLeagues, (league) => league.teams.length), [20, 20, 20, 18, 18, 18, 18, 20]);
  assert.equal(data.meta.scopeClubCount, 152);
  const reserveMapping = data.clubs.slice(0, 101).find((club) => /\b(u[- ]?(17|18|19|20|21|23)|reserves?|academy|youth)\b/i.test(club.transfermarkt.matchedName));
  assert.equal(reserveMapping, undefined, `reserve team mapping found for ${reserveMapping?.name || 'unknown club'}`);
});

test('transferwereld generated data is complete enough for the requested analysis', () => {
  const data = loadDataset();
  const transferCount = data.clubs.reduce((total, club) => total + club.arrivals.length + club.departures.length, 0);
  const squadCount = data.clubs.reduce((total, club) => total + club.squad.length, 0);
  const clubsWithTransfers = data.clubs.filter((club) => club.arrivals.length + club.departures.length > 0).length;
  const clubsWithFullSquads = data.clubs.filter((club) => club.squad.length >= 16).length;
  assert.ok(transferCount >= 3_000, `expected at least 3,000 transfer movements, found ${transferCount}`);
  assert.ok(squadCount >= 5_000, `expected at least 5,000 squad players, found ${squadCount}`);
  assert.equal(clubsWithTransfers, data.clubs.length, `transfer coverage incomplete: ${clubsWithTransfers}/${data.clubs.length} clubs`);
  assert.equal(clubsWithFullSquads, data.clubs.length, `squad coverage incomplete: ${clubsWithFullSquads}/${data.clubs.length} clubs`);
  assert.equal(data.meta.warnings, 0);
  assert.equal(data.meta.warnings, data.clubs.filter((club) => club.dataWarning).length);
});

test('deep forecast context covers every club and every competition table', () => {
  const data = loadDataset();
  assert.deepEqual({ ...data.meta.contextCoverage }, {
    injuries: 101,
    coaches: 101,
    schedules: 101,
    leagues: data.leagues.length,
    estimatedRatings: 0,
    fullLeagueTables: data.leagues.length,
  });
  assert.equal(data.meta.contextWarnings, 0);
  const contextClubs = data.clubs.filter((club) => club.context);
  assert.equal(contextClubs.length, 102);
  assert.ok(contextClubs.every((club) => club.context?.coach?.name), 'a context club is missing its manager');
  assert.ok(contextClubs.every((club) => Array.isArray(club.context?.injuries)), 'a context club is missing injury context');
  assert.ok(contextClubs.every((club) => Array.isArray(club.context?.nextFixtures)), 'a context club is missing fixture context');
  const script = read('assets/transferwereld.js');
  ['standingModifier', 'injuryModifier', 'formModifier', 'fixtureModifier', 'coachModifier'].forEach((factor) => assert.match(script, new RegExp(factor)));
});

test('transferwereld frontend applies the expanded competition scope to every analysis view', () => {
  const html = read('transfers.html');
  const script = read('assets/transferwereld.js');
  assert.match(html, /id="transfer-competition"/);
  assert.match(html, /top 7 competities \+ KKD/i);
  assert.match(script, /scopeLeagues/);
  assert.match(script, /transfer\.club\.league !== competition/);
  assert.match(script, /scopeLeagues\.map\(\(league\)/);
});

test('localized transfer fees are normalized without turning thousands into millions', () => {
  const data = loadDataset();
  const transfers = data.clubs.flatMap((club) => [...club.arrivals, ...club.departures]);
  const suspicious = transfers.find((transfer) => /(?:mil|mila)\s*€/i.test(transfer.fee) && transfer.feeValue >= 1_000_000);
  assert.equal(suspicious, undefined, `localized thousands parsed as millions for ${suspicious?.player || 'unknown player'}`);
});
