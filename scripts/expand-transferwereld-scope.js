#!/usr/bin/env node

const {
  addClubData,
  extractClubCandidates,
  fetchTransfermarkt,
  loadExistingClubs,
} = require('./build-transferwereld-data');
const {
  loadTransferwereldDataset,
  writeTransferwereldDataset,
} = require('./transferwereld-data-io');

const TRANSFERMARKT_ORIGIN = 'https://www.transfermarkt.com';
const TOP_COMPETITIONS = [
  { id: 'tm-GB1', code: 'GB1', name: 'Premier League', country: 'England', slug: 'premier-league', uefaRank: 1 },
  { id: 'tm-IT1', code: 'IT1', name: 'Serie A', country: 'Italy', slug: 'serie-a', uefaRank: 2 },
  { id: 'tm-ES1', code: 'ES1', name: 'LaLiga', country: 'Spain', slug: 'laliga', uefaRank: 3 },
  { id: 'tm-L1', code: 'L1', name: 'Bundesliga', country: 'Germany', slug: 'bundesliga', uefaRank: 4 },
  { id: 'tm-FR1', code: 'FR1', name: 'Ligue 1', country: 'France', slug: 'ligue-1', uefaRank: 5 },
  { id: 'tm-NL1', code: 'NL1', name: 'Eredivisie', country: 'Netherlands', slug: 'eredivisie', uefaRank: 6 },
  { id: 'tm-PO1', code: 'PO1', name: 'Liga Portugal', country: 'Portugal', slug: 'primeira-liga', uefaRank: 7 },
  { id: 'tm-BE1', code: 'BE1', name: 'Jupiler Pro League', country: 'Belgium', slug: 'jupiler-pro-league', uefaRank: 8 },
  { id: 'tm-TR1', code: 'TR1', name: 'Süper Lig', country: 'Türkiye', slug: 'super-lig', uefaRank: 9 },
  { id: 'tm-TS1', code: 'TS1', name: 'Chance Liga', country: 'Czechia', slug: 'chance-liga', uefaRank: 10 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDataset() {
  return loadTransferwereldDataset();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|afc|ac|as|ss|sc|fk|bv|rc|cd|sd|sv|tsg|gnk|krc|csd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function badgeFor(team) {
  if (team.optaId) {
    return `https://omo.akamai.opta.net/image.php?secure=true&h=omo.akamai.opta.net&sport=football&entity=team&description=badges&dimensions=150&id=${team.optaId}`;
  }
  return `https://tmssl.akamaized.net/images/wappen/150x150/${team.transfermarktId}.png`;
}

function rankFor(team, fallback = 10000) {
  const value = Number(team.globalRank || team.rank);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function identifyBaseTop100Ids(clubs) {
  const top100Ids = new Set();
  const seenRanks = new Set();
  clubs.forEach((club) => {
    const id = Number(club.transfermarkt?.id);
    const rank = Number(club.rank);
    if (!Number.isFinite(id) || !Number.isFinite(rank) || rank < 1 || rank > 100 || seenRanks.has(rank)) return;
    seenRanks.add(rank);
    top100Ids.add(id);
  });
  return top100Ids;
}

function normalizeDatasetIdentity(dataset) {
  const top100Ids = identifyBaseTop100Ids(dataset.clubs || []);
  const scopeTeamsById = new Map((dataset.scopeLeagues || []).flatMap((league) => (
    (league.teams || []).map((team) => [Number(team.transfermarktId), team])
  )));
  return {
    ...dataset,
    clubs: (dataset.clubs || []).map((club) => {
      const id = Number(club.transfermarkt?.id);
      const isTop100 = top100Ids.has(id);
      const scopeTeam = scopeTeamsById.get(id);
      const currentRank = Number(club.rank);
      const rank = !isTop100 && currentRank >= 1 && currentRank <= 100 ? 10000 : club.rank;
      const canonicalName = scopeTeam?.name;
      return {
        ...club,
        ...(canonicalName && !isTop100 ? {
          name: canonicalName,
          fullName: canonicalName,
          shortName: scopeTeam.shortName || canonicalName,
          transfermarkt: {
            ...club.transfermarkt,
            matchedName: canonicalName,
          },
        } : {}),
        rank,
        isTop100,
      };
    }),
  };
}

function teamRowFromCandidate(candidate, index) {
  return {
    name: candidate.name,
    shortName: candidate.name,
    code: '',
    rating: Math.max(60, 77 - index * .4),
    seasonAverageRating: Math.max(60, 77 - index * .4),
    lastWeekRating: Math.max(60, 77 - index * .4),
    globalRank: 10000 + index,
    transfermarktId: candidate.id,
    standingPosition: index + 1,
    played: 0,
    points: 0,
    goalDifference: 0,
    ratingEstimated: true,
  };
}

function leagueRows(definition, dataset, candidates) {
  const existingLeague = dataset.leagues.find((league) => league.id === definition.id);
  const sourceRows = existingLeague?.teams || [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidateByName = new Map(candidates.map((candidate) => [normalize(candidate.name), candidate]));
  const seen = new Set();
  const rows = sourceRows.map((row, index) => {
    const candidate = candidateById.get(Number(row.transfermarktId)) || candidateByName.get(normalize(row.name));
    if (!candidate || seen.has(candidate.id)) return null;
    seen.add(candidate.id);
    return {
      ...row,
      name: candidate.name,
      shortName: candidate.name,
      transfermarktId: candidate.id,
    };
  }).filter(Boolean);
  candidates.forEach((candidate) => {
    if (seen.has(candidate.id)) return;
    seen.add(candidate.id);
    rows.push(teamRowFromCandidate(candidate, rows.length));
  });
  return rows;
}

function buildTeam(definition, row, candidate, existingById, existingByName) {
  const existing = existingById.get(Number(row.transfermarktId)) || existingByName.get(normalize(row.name));
  const rank = existing?.rank || rankFor(row);
  const isTop100 = existing?.isTop100 ?? (!existing?.isWildcard && rank >= 1 && rank <= 100);
  const name = existing?.name || row.name || candidate.name;
  return {
    ...(existing || {}),
    rank,
    name,
    fullName: existing?.fullName || row.name || candidate.name,
    shortName: existing?.shortName || row.shortName || candidate.name,
    code: existing?.code || row.code || '',
    rating: Number(existing?.rating || row.rating || 0),
    country: existing?.country || definition.country,
    confederation: existing?.confederation || 'Europe',
    leagueId: definition.id,
    league: definition.name,
    optaId: existing?.optaId || row.optaId || '',
    badge: existing?.badge || badgeFor({ ...row, transfermarktId: candidate.id }),
    transfermarkt: {
      ...(existing?.transfermarkt || {}),
      id: Number(candidate.id),
      slug: candidate.slug,
      seasonId: 2026,
      sourceUrl: `${TRANSFERMARKT_ORIGIN}/${candidate.slug}/transfers/verein/${candidate.id}/saison_id/2026`,
      matchedName: existing?.transfermarkt?.matchedName || candidate.name,
    },
    isTop100,
    isExpandedCompetition: true,
    competitionScope: 'uefa-top-10',
    uefaAssociationRank: definition.uefaRank,
  };
}

async function readCandidates(definition) {
  const html = await fetchTransfermarkt(`/${definition.slug}/startseite/wettbewerb/${definition.code}`);
  const candidates = extractClubCandidates(html);
  if (candidates.length < 7) throw new Error(`${definition.name}: only ${candidates.length} clubs found`);
  return candidates;
}

async function main() {
  const dataset = loadDataset();
  const existingClubs = loadExistingClubs();
  const existingById = new Map(existingClubs);
  const existingByName = new Map([...existingClubs.values()].map((club) => [normalize(club.name), club]));
  const targetRows = [];
  const scopeLeagues = [];

  for (const definition of TOP_COMPETITIONS) {
    process.stdout.write(`Reading ${definition.name}... `);
    const candidates = await readCandidates(definition);
    const rows = leagueRows(definition, dataset, candidates);
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    scopeLeagues.push({
      id: definition.id,
      code: definition.code,
      name: definition.name,
      country: definition.country,
      kind: 'uefa-top-10',
      uefaRank: definition.uefaRank,
      teams: rows,
    });
    rows.forEach((row) => {
      const candidate = candidateById.get(Number(row.transfermarktId));
      if (!candidate) return;
      targetRows.push(buildTeam(definition, row, candidate, existingById, existingByName));
    });
    console.log(`${rows.length} clubs`);
    await sleep(250);
  }

  const uniqueTargetRows = [...new Map(targetRows.map((team) => [team.transfermarkt.id, team])).values()];
  console.log(`Enriching ${uniqueTargetRows.length} unique competition clubs...`);
  const expandedTargetClubs = await addClubData(uniqueTargetRows, existingClubs);
  const expandedById = new Map(expandedTargetClubs.map((club) => [club.transfermarkt.id, club]));
  const baseClubCount = Number(dataset.meta?.baseClubCount) || Math.min(101, dataset.clubs.length);
  const baseClubs = dataset.clubs.slice(0, baseClubCount);
  const baseIds = new Set(baseClubs.map((club) => Number(club.transfermarkt?.id)));
  const updatedBaseClubs = baseClubs.map((club) => expandedById.get(Number(club.transfermarkt?.id)) || club);
  const scopedExtraClubs = expandedTargetClubs.filter((club) => !baseIds.has(Number(club.transfermarkt?.id)));
  dataset.clubs = [...updatedBaseClubs, ...scopedExtraClubs];
  dataset.scopeLeagues = scopeLeagues;
  Object.assign(dataset, normalizeDatasetIdentity(dataset));
  dataset.meta = {
    ...dataset.meta,
    title: 'Transferwereld — top 10 competities',
    scope: {
      source: 'UEFA men\'s association club rankings (five-year coefficient)',
      sourceUrl: 'https://www.uefa.com/uefachampionsleague/news/02a0-1f8b9164ba92-1dd42564c706-1000--uefa-rankings-2025-which-teams-and-nations-are-on-top/',
      competitions: TOP_COMPETITIONS.map((definition) => definition.name),
    },
    scopeClubCount: uniqueTargetRows.length,
    scopeFetchedAt: new Date().toISOString(),
    warnings: expandedTargetClubs.filter((club) => club.dataWarning).length,
  };
  const sizes = writeTransferwereldDataset(dataset);
  console.log(`Wrote split transfer data (${sizes.baseBytes} + ${sizes.scopeBytes} bytes)`);
  console.log(JSON.stringify({ clubs: dataset.clubs.length, scopeClubs: uniqueTargetRows.length, warnings: dataset.meta.warnings }));
  if (dataset.meta.warnings) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { TOP_COMPETITIONS, identifyBaseTop100Ids, normalize, normalizeDatasetIdentity };
