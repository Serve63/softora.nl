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
  vm.runInContext(read('assets/transferwereld-scope-data.js'), context);
  const { buildScopedDataset } = require('../../assets/transferwereld-scope.js');
  return buildScopedDataset(context.window.TRANSFERWERELD_DATA, context.window.TRANSFERWERELD_SCOPE_DATA);
}

test('transferwereld exposes the five active analysis tabs and defaults to fee sorting', () => {
  const html = read('transfers.html');
  const tabNames = [
    'Alle transfers',
    'Meeste uitgegeven',
    'Meeste verdiend',
    'Geruchten',
    'Versterkt / verzwakt',
  ];
  tabNames.forEach((name) => assert.match(html, new RegExp(name.replace('/', '\\/'))));
  assert.doesNotMatch(html, /tab-depth|tab-forecast|panel-depth|panel-forecast|Competitieprognoses/);
  assert.match(html, /Alle transfers uit de top 10 competities/);
  assert.doesNotMatch(html, /101 (?:geselecteerde )?(?:top)?clubs/);
  assert.doesNotMatch(html, /id="transfer-filters"|id="transfer-summary"|id="transfer-sort"/);
  assert.match(html, /transferwereld-data\.js\?v=20260810a/);
  assert.match(html, /transferwereld-scope-data\.js\?v=20260810a/);
  assert.match(html, /transferwereld-scope\.js\?v=20260809b/);
  assert.match(html, /transferwereld-deals\.js\?v=20260810a/);
  assert.doesNotMatch(html, /id="transfer-direction"/);
  const script = read('assets/transferwereld.js');
  assert.match(script, /\[\.\.\.deals\]\.sort\(\(left, right\) => right\.feeValue - left\.feeValue \|\| left\.rank - right\.rank\)/);
  assert.match(script, /secondaryKey === 'income' \? 'verdiend' : 'uitgegeven'/);
});

test('mirrored incoming and outgoing records render as one club-to-club deal', () => {
  const { buildUniqueDeals } = require('../../assets/transferwereld-deals.js');
  const clubs = [
    {
      name: 'Aston Villa', fullName: 'Aston Villa FC', rank: 7, transfermarkt: { id: 405 },
      arrivals: [],
      departures: [{ player: 'Morgan Rogers', position: 'Attacking Midfield', age: 23, counterpart: 'Chelsea FC', fee: '€138.00m', feeValue: 138_000_000 }],
    },
    {
      name: 'Chelsea', fullName: 'Chelsea FC', rank: 19, transfermarkt: { id: 631 },
      arrivals: [{ player: 'Morgan Rogers', position: 'Trequartista', age: 23, counterpart: 'Aston Villa', fee: '138,00 mln €', feeValue: 138_000_000 }],
      departures: [],
    },
  ];
  const deals = buildUniqueDeals(clubs);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].sourceName, 'Aston Villa');
  assert.equal(deals[0].destinationName, 'Chelsea');
  assert.equal(deals[0].feeValue, 138_000_000);
  assert.equal(deals[0].records, 2);
  const script = read('assets/transferwereld.js');
  assert.match(script, /buildUniqueDeals\(clubs\)/);
  assert.match(script, /routeClub\(deal\.sourceName[\s\S]*routeClub\(deal\.destinationName/);
  assert.doesNotMatch(script, /transfer\.direction === 'in' \? 'In' : 'Uit'/);
});

test('loan returns and permanent transfers on the same route remain separate deals', () => {
  const { buildUniqueDeals } = require('../../assets/transferwereld-deals.js');
  const clubs = [{
    name: 'Example FC', transfermarkt: { id: 1 }, departures: [],
    arrivals: [
      { player: 'Zelfde Speler', counterpart: 'Other FC', fee: 'End of loan', feeValue: 0 },
      { player: 'Zelfde Speler', counterpart: 'Other FC', fee: '€2.00m', feeValue: 2_000_000 },
    ],
  }];
  const deals = buildUniqueDeals(clubs);
  assert.equal(deals.length, 2);
  assert.deepEqual(deals.map((deal) => deal.kind).sort(), ['return', 'transfer']);
});

test('transfermarkt club ids resolve translated and out-of-scope counterpart crests', () => {
  const { buildUniqueDeals } = require('../../assets/transferwereld-deals.js');
  const clubs = [
    {
      name: 'Aston Villa', badge: '/villa.png', transfermarkt: { id: 405 }, departures: [],
      arrivals: [{ player: 'Johan Manzambi', counterpart: 'SC Fribourg', counterpartId: 60, fee: '€60m', feeValue: 60_000_000 }],
    },
    { name: 'Freiburg', badge: '/freiburg.png', transfermarkt: { id: 60 }, arrivals: [], departures: [] },
    {
      name: 'Tottenham Hotspur', badge: '/tottenham.png', transfermarkt: { id: 148 }, departures: [],
      arrivals: [{ player: 'Mateus Fernandes', counterpart: 'West Ham United', counterpartId: 379, fee: '€99m', feeValue: 99_000_000 }],
    },
  ];
  const deals = buildUniqueDeals(clubs);
  const freiburgDeal = deals.find((deal) => deal.player === 'Johan Manzambi');
  const westHamDeal = deals.find((deal) => deal.player === 'Mateus Fernandes');
  assert.equal(freiburgDeal.sourceClub.name, 'Freiburg');
  assert.equal(freiburgDeal.sourceClub.badge, '/freiburg.png');
  assert.equal(westHamDeal.sourceClub.name, 'West Ham United');
  assert.equal(westHamDeal.sourceClub.transfermarkt.id, 379);
  assert.equal(westHamDeal.sourceClub.badge, 'https://tmssl.akamaized.net//images/wappen/head/379.png?lm=1');
});

test('every crest render has a visible initials fallback if the image is unavailable', () => {
  const script = read('assets/transferwereld.js');
  const css = read('assets/transferwereld.css');
  assert.match(script, /function crestMarkup/);
  assert.match(script, /onerror="this\.remove\(\)"/);
  assert.doesNotMatch(script, /route-crest-placeholder/);
  assert.match(css, /\.crest-fallback, \.route-crest-fallback/);
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

test('transferwereld dataset contains every club from exactly the UEFA top ten leagues', () => {
  const data = loadDataset();
  assert.equal(data.clubs.length, 184);
  assert.equal(new Set(data.clubs.map((club) => club.name)).size, data.clubs.length, 'club names must be unique across views');
  assert.deepEqual(Array.from(data.scopeLeagues, (league) => league.name), [
    'Premier League', 'Serie A', 'LaLiga', 'Bundesliga', 'Ligue 1', 'Liga Portugal', 'Jupiler Pro League', 'Eredivisie', 'Süper Lig', 'Chance Liga',
  ]);
  assert.deepEqual(Array.from(data.scopeLeagues, (league) => league.uefaRank), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(Array.from(data.scopeLeagues, (league) => league.teams.length), [20, 20, 20, 18, 18, 18, 18, 18, 18, 16]);
  assert.equal(data.meta.scopeClubCount, 184);
  assert.match(data.meta.scope.source, /UEFA men's association club rankings/);
  const expectedIds = new Set(data.scopeLeagues.flatMap((league) => league.teams.map((team) => Number(team.transfermarktId))));
  const clubIds = new Set(data.clubs.map((club) => Number(club.transfermarkt?.id)));
  assert.deepEqual(clubIds, expectedIds, 'every active club must come from exactly one top-ten league');
  assert.equal(data.clubs.some((club) => club.league === 'Keuken Kampioen Divisie'), false);
  const reserveMapping = data.clubs.find((club) => /\b(u[- ]?(17|18|19|20|21|23)|reserves?|academy|youth)\b/i.test(club.transfermarkt.matchedName));
  assert.equal(reserveMapping, undefined, `reserve team mapping found for ${reserveMapping?.name || 'unknown club'}`);
});

test('transferwereld generated data is complete enough for the requested analysis', () => {
  const data = loadDataset();
  const transferCount = data.clubs.reduce((total, club) => total + club.arrivals.length + club.departures.length, 0);
  const squadCount = data.clubs.reduce((total, club) => total + club.squad.length, 0);
  const clubsWithTransfers = data.clubs.filter((club) => club.arrivals.length + club.departures.length > 0).length;
  const clubsWithFullSquads = data.clubs.filter((club) => club.squad.length >= 16).length;
  assert.ok(transferCount >= 2_800, `expected at least 2,800 transfer movements, found ${transferCount}`);
  assert.ok(squadCount >= 5_200, `expected at least 5,200 squad players, found ${squadCount}`);
  assert.equal(clubsWithTransfers, data.clubs.length, `transfer coverage incomplete: ${clubsWithTransfers}/${data.clubs.length} clubs`);
  assert.equal(clubsWithFullSquads, data.clubs.length, `squad coverage incomplete: ${clubsWithFullSquads}/${data.clubs.length} clubs`);
  assert.equal(data.meta.warnings, 0);
  assert.equal(data.meta.warnings, data.clubs.filter((club) => club.dataWarning).length);
  assert.equal(data.clubs.filter((club) => !club.badge).length, 0, 'every active club must have a crest URL');
  const repeatedMovements = data.clubs.flatMap((club) => ['arrivals', 'departures'].flatMap((field) => {
    const keys = club[field].map((transfer) => [transfer.player, transfer.counterpart, transfer.feeValue].join('|').toLowerCase());
    return keys.filter((key, index) => keys.indexOf(key) !== index).map((key) => `${club.name}:${field}:${key}`);
  }));
  assert.deepEqual(repeatedMovements, [], `duplicate transfer movements found: ${repeatedMovements.join(', ')}`);
});

test('deep club context remains complete for the active analyses', () => {
  const data = loadDataset();
  assert.deepEqual({ ...data.meta.contextCoverage }, {
    injuries: data.clubs.length,
    coaches: data.clubs.length,
    schedules: data.clubs.length,
    leagues: data.leagues.length,
    estimatedRatings: 0,
    fullLeagueTables: data.leagues.length,
  });
  assert.equal(data.meta.contextWarnings, 0);
  const contextClubs = data.clubs.filter((club) => club.context);
  assert.equal(contextClubs.length, data.clubs.length);
  assert.ok(contextClubs.every((club) => club.context?.coach?.name), 'a context club is missing its manager');
  assert.ok(contextClubs.every((club) => Array.isArray(club.context?.injuries)), 'a context club is missing injury context');
  assert.ok(contextClubs.every((club) => Array.isArray(club.context?.nextFixtures)), 'a context club is missing fixture context');
});

test('transferwereld frontend applies the UEFA top ten scope to every analysis view', () => {
  const html = read('transfers.html');
  const script = read('assets/transferwereld.js');
  assert.match(html, /top 10 competities/i);
  assert.doesNotMatch(html, /top 100|KKD|Keuken Kampioen/i);
  assert.match(script, /buildScopedDataset/);
  assert.match(script, /scopeLeagues/);
  assert.match(script, /const clubs = dataset\.clubs/);
  assert.match(script, /clubs\.flatMap\(\(club\)/);
  assert.match(script, /scopeLeagues\.length/);
});

test('rumours render as compact comparable rows instead of oversized cards', () => {
  const html = read('transfers.html');
  const script = read('assets/transferwereld.js');
  const css = read('assets/transferwereld.css');
  assert.match(html, /id="rumour-list" class="rumour-list"/);
  assert.match(script, /class="rumour-row"/);
  assert.match(css, /\.rumour-row \{[^}]*display: grid/);
  assert.match(css, /\.rumour-list-head > span:nth-child\(n \+ 4\) \{ text-align: right; \}/);
  assert.doesNotMatch(script, /rumour-card/);
  assert.doesNotMatch(css, /\.rumour-card/);
});

test('localized transfer fees are normalized without turning thousands into millions', () => {
  const { parseFeeValue } = require('../../scripts/build-transferwereld-data.js');
  const data = loadDataset();
  const transfers = data.clubs.flatMap((club) => [...club.arrivals, ...club.departures]);
  const suspicious = transfers.find((transfer) => /(?:mil|mila)\s*€/i.test(transfer.fee) && transfer.feeValue >= 1_000_000);
  assert.equal(suspicious, undefined, `localized thousands parsed as millions for ${suspicious?.player || 'unknown player'}`);
  assert.equal(parseFeeValue('25 dzd. €'), 25_000);
  assert.equal(parseFeeValue('300 Tsd. €'), 300_000);
  assert.equal(parseFeeValue('1,5 Mio. €'), 1_500_000);
});

test('transferwereld refresh scripts can force current source data without blanking failed clubs', () => {
  const buildScript = read('scripts/build-transferwereld-data.js');
  const scopeScript = read('scripts/expand-transferwereld-scope.js');
  const contextScript = read('scripts/enrich-transferwereld-context.js');
  assert.match(buildScript, /TRANSFER_FORCE_REFRESH/);
  assert.match(buildScript, /TRANSFER_REFRESH_WARNINGS_ONLY/);
  assert.match(buildScript, /TRANSFER_REFRESH_COMPONENTS/);
  assert.match(buildScript, /arrivals = existing\?\.arrivals \|\| \[\]/);
  assert.match(buildScript, /squad = existing\?\.squad \|\| \[\]/);
  assert.match(buildScript, /rumours = existing\?\.rumours \|\| \[\]/);
  assert.match(contextScript, /TRANSFER_CONTEXT_FORCE_REFRESH/);
  assert.match(contextScript, /const now = Date\.now\(\)/);
  assert.match(scopeScript, /uefarankings\/\?year=2026/);
});
