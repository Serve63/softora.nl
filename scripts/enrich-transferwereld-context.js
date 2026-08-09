#!/usr/bin/env node

const vm = require('node:vm');
const { chromium } = require('playwright');
const {
  loadTransferwereldDataset,
  writeTransferwereldDataset,
} = require('./transferwereld-data-io');

const OPTA_URL = 'https://dataviz.theanalyst.com/opta-power-rankings/index.js';
const TRANSFERMARKT = 'https://www.transfermarkt.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36';

function loadDataset() {
  return loadTransferwereldDataset();
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|ac|sc|afc|club|de|do|da|futebol|football|fk|calcio)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  rows[0] = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const common = [...aTokens].filter((token) => bTokens.has(token)).length;
  const token = common / new Set([...aTokens, ...bTokens]).size;
  const containment = a.includes(b) || b.includes(a) ? 0.93 : 0;
  return Math.max(containment, edit * .72 + token * .28);
}

function parseMoney(value) {
  const normalized = String(value || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '');
  if (!normalized.includes('€')) return 0;
  const match = normalized.match(/€?([0-9]+(?:\.[0-9]+)?)(bn|mio\.?|mill\.?|mln\.?|mila|mil|dzd\.?|tsd\.?|thsd\.?|th\.?|m|k)?€?/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (match[2] === 'bn') return Math.round(amount * 1_000_000_000);
  if (['m', 'mio', 'mio.', 'mill', 'mill.', 'mln', 'mln.'].includes(match[2])) return Math.round(amount * 1_000_000);
  if (['k', 'mil', 'mila', 'dzd', 'dzd.', 'tsd', 'tsd.', 'thsd', 'thsd.', 'th', 'th.'].includes(match[2])) return Math.round(amount * 1_000);
  return Math.round(amount);
}

function parseDate(value) {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : 0;
}

function extractOptaTeams(source) {
  const marker = 'f6=JSON.parse(`';
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf('`),v6=', start);
  if (start < marker.length || end < start) throw new Error('Opta ranking payload not found');
  return vm.runInNewContext(`JSON.parse(\`${source.slice(start, end)}\`)`).filter((team) => Number(team.currentGlobalRank) > 0);
}

async function withConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => next()));
  return output;
}

async function navigate(page, route) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.goto(`${TRANSFERMARKT}${route}`, { waitUntil: 'domcontentloaded', timeout: 35_000 });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() || 'unknown'}`);
      const title = await page.title();
      if (/error|verify/i.test(title)) throw new Error(`Unexpected page title: ${title}`);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800 * (attempt + 1));
    }
  }
  throw lastError;
}

async function readInjuries(page, club) {
  await navigate(page, `/${club.transfermarkt.slug}/sperrenundverletzungen/verein/${club.transfermarkt.id}/plus/1`);
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.box')];
    const box = boxes.find((candidate) => /suspensions and injuries/i.test(candidate.querySelector('h2')?.textContent || ''));
    const table = box?.querySelector('table:not(.inline-table)');
    if (!table) return [];
    let section = '';
    const injuries = [];
    for (const row of table.querySelectorAll('tbody > tr')) {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length === 1) {
        section = cells[0].textContent.trim();
        continue;
      }
      if (/risk of suspension/i.test(section)) continue;
      const playerLink = row.querySelector('a[href*="/profil/spieler/"]');
      if (!playerLink || cells.length < 5) continue;
      injuries.push({
        player: (playerLink.getAttribute('title') || playerLink.textContent).trim(),
        reason: cells[2]?.textContent.trim() || section || 'Unavailable',
        since: cells[3]?.textContent.trim() || '',
        expectedReturn: cells[4]?.textContent.trim() || '',
        marketValue: cells.at(-1)?.textContent.trim() || '',
      });
    }
    return injuries;
  });
}

async function readCoach(page, club) {
  await navigate(page, `/${club.transfermarkt.slug}/mitarbeiter/verein/${club.transfermarkt.id}`);
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.box')];
    const box = boxes.find((candidate) => /coaching staff/i.test(candidate.querySelector('h2')?.textContent || ''));
    const table = box?.querySelector('table:not(.inline-table)');
    if (!table) return null;
    const rows = [...table.querySelectorAll('tbody > tr')];
    const row = rows.find((candidate) => {
      const cells = candidate.querySelectorAll(':scope > td');
      return cells.length >= 5 && /manager|head coach|coach/i.test(cells[0].textContent || '');
    });
    if (!row) return null;
    const cells = [...row.querySelectorAll(':scope > td')];
    const link = row.querySelector('a[href*="/profil/trainer/"], a[href*="/profil/spieler/"]');
    const firstCell = cells[0].textContent.replace(/\s+/g, ' ').trim();
    return {
      name: (link?.getAttribute('title') || link?.textContent || firstCell).trim(),
      role: firstCell.replace((link?.getAttribute('title') || link?.textContent || '').trim(), '').trim() || 'Manager',
      appointed: cells[3]?.textContent.trim() || '',
    };
  });
}

async function readSchedule(page, club) {
  await navigate(page, `/${club.transfermarkt.slug}/spielplan/verein/${club.transfermarkt.id}/saison_id/${club.transfermarkt.seasonId}`);
  return page.evaluate(() => {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const tableLink = [...document.querySelectorAll('a[href*="/tabelle/wettbewerb/"]')]
      .find((link) => /saison_id\/\d+/.test(link.getAttribute('href') || ''));
    const tableRoute = tableLink?.getAttribute('href') || '';
    const competitionMatch = tableRoute.match(/\/tabelle\/wettbewerb\/([^/]+)/);
    const tables = [...document.querySelectorAll('table')];
    const fixtures = [];
    let leagueTable = [];
    let leagueName = '';
    for (const table of tables) {
      const heading = compact(table.closest('.box')?.querySelector('h2')?.textContent);
      if (/^table section/i.test(heading)) {
        leagueName = heading.replace(/^table section\s+/i, '').replace(/\s+\d{2}\/\d{2}$/, '');
        leagueTable = [...table.querySelectorAll('tbody > tr')].map((row) => {
          const cells = [...row.querySelectorAll(':scope > td')];
          const clubLink = row.querySelector('a[href*="/verein/"][title]');
          const teamId = Number(clubLink?.getAttribute('href')?.match(/\/verein\/(\d+)/)?.[1]);
          const name = compact(clubLink?.getAttribute('title') || clubLink?.textContent);
          if (!name || !teamId || cells.length < 5) return null;
          return {
            position: Number(compact(cells[0].textContent)) || null,
            name,
            transfermarktId: teamId,
            played: Number(compact(cells.at(-3)?.textContent)) || 0,
            goalDifference: Number(compact(cells.at(-2)?.textContent)) || 0,
            points: Number(compact(cells.at(-1)?.textContent)) || 0,
          };
        }).filter(Boolean);
        continue;
      }
      if (!heading || /info|last games|club friendly/i.test(heading)) continue;
      for (const row of table.querySelectorAll('tbody > tr')) {
        const cells = [...row.querySelectorAll(':scope > td')];
        const opponentLink = row.querySelector('a[href*="/verein/"][title]');
        const opponent = compact(opponentLink?.getAttribute('title') || opponentLink?.textContent);
        const date = cells.map((cell) => compact(cell.textContent)).find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text));
        const venue = cells.map((cell) => compact(cell.textContent)).find((text) => /^[HA]$/.test(text));
        const result = compact(cells.at(-1)?.textContent);
        if (!opponent || !date || !venue || !result) continue;
        fixtures.push({ competition: heading, date, venue, opponent, result });
      }
    }
    return { competitionCode: competitionMatch?.[1] || '', tableRoute, leagueName, leagueTable, fixtures };
  });
}

async function readFullLeagueTable(page, tableRoute) {
  await navigate(page, tableRoute);
  return page.evaluate(() => {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const tables = [...document.querySelectorAll('table')];
    const table = tables.find((candidate) => {
      const headings = [...candidate.querySelectorAll('thead th')].map((cell) => compact(cell.textContent).toLowerCase());
      return headings.some((heading) => heading === 'club') && headings.some((heading) => /pts|points/.test(heading));
    });
    if (!table) return [];
    return [...table.querySelectorAll('tbody > tr')].map((row) => {
      const cells = [...row.querySelectorAll(':scope > td')];
      const clubLink = row.querySelector('a[href*="/verein/"][title]');
      const teamId = Number(clubLink?.getAttribute('href')?.match(/\/verein\/(\d+)/)?.[1]);
      const name = compact(clubLink?.getAttribute('title') || clubLink?.textContent);
      if (!name || !teamId || cells.length < 5) return null;
      return {
        position: Number(compact(cells[0].textContent)) || null,
        name,
        transfermarktId: teamId,
        played: Number(compact(cells.at(-7)?.textContent)) || 0,
        goalDifference: Number(compact(cells.at(-2)?.textContent)) || 0,
        points: Number(compact(cells.at(-1)?.textContent)) || 0,
      };
    }).filter(Boolean);
  });
}

function resultPoints(fixture) {
  const match = fixture.result.match(/(\d+)\s*:\s*(\d+)/);
  if (!match) return null;
  const homeGoals = Number(match[1]);
  const awayGoals = Number(match[2]);
  const own = fixture.venue === 'H' ? homeGoals : awayGoals;
  const opponent = fixture.venue === 'H' ? awayGoals : homeGoals;
  return own > opponent ? 3 : (own === opponent ? 1 : 0);
}

function matchOptaTeam(name, candidates) {
  const aliases = {
    copenhagen: 'København',
    'aarhus gf': 'AGF',
  };
  const query = aliases[normalize(name)] || name;
  return candidates
    .map((team) => ({
      team,
      score: Math.max(...[team.contestantName, team.contestantClubName, team.contestantShortName].filter(Boolean).map((variant) => similarity(query, variant))),
    }))
    .sort((left, right) => right.score - left.score)[0];
}

function buildForecastLeagues(dataset, contexts, optaTeams, fullLeagueTables) {
  const clubByTransfermarktId = new Map(dataset.clubs.map((club) => [club.transfermarkt.id, club]));
  const groups = new Map();
  for (const entry of contexts) {
    const code = entry.schedule?.competitionCode;
    if (!code || entry.schedule.leagueTable.length < 7) continue;
    const current = groups.get(code);
    if (!current || entry.schedule.leagueTable.length > current.schedule.leagueTable.length) groups.set(code, entry);
  }
  let estimatedRatings = 0;
  const leagues = [];
  for (const [code, entry] of groups) {
    const representative = entry.club;
    const countryCandidates = optaTeams.filter((team) => team.country === representative.country);
    const leagueTable = fullLeagueTables.get(code) || entry.schedule.leagueTable;
    const matched = leagueTable.map((row) => {
      const topClub = clubByTransfermarktId.get(row.transfermarktId);
      const countryBest = topClub ? null : matchOptaTeam(row.name, countryCandidates);
      const globalBest = !topClub && countryBest?.score < .56 ? matchOptaTeam(row.name, optaTeams) : null;
      const best = globalBest?.score > (countryBest?.score || 0) ? globalBest : countryBest;
      const source = topClub || (best?.score >= .56 ? best.team : null);
      if (!source) estimatedRatings += 1;
      const fallbackRating = Math.max(60, representative.rating - Math.max(0, (row.position || 10) - 1) * .32);
      return {
        name: topClub?.name || source?.contestantName || row.name,
        shortName: topClub?.shortName || source?.contestantShortName || row.name,
        code: topClub?.code || source?.contestantCode || '',
        rating: Number(Number(topClub?.rating || source?.currentRating || fallbackRating).toFixed(2)),
        seasonAverageRating: Number(Number(source?.seasonAverageRating || topClub?.rating || fallbackRating).toFixed(2)),
        lastWeekRating: Number(Number(source?.lastWeekRating || topClub?.rating || fallbackRating).toFixed(2)),
        globalRank: Number(topClub?.rank || source?.currentGlobalRank || 0),
        optaId: topClub?.optaId || source?.contestantId || '',
        transfermarktId: row.transfermarktId,
        standingPosition: row.position,
        played: row.played,
        points: row.points,
        goalDifference: row.goalDifference,
        ...(source ? {} : { ratingEstimated: true }),
      };
    });
    leagues.push({
      id: `tm-${code}`,
      code,
      name: entry.schedule.leagueName || representative.league,
      country: representative.country,
      teams: matched,
    });
  }
  return { leagues: leagues.sort((left, right) => left.name.localeCompare(right.name) || left.country.localeCompare(right.country)), estimatedRatings };
}

async function main() {
  if (!process.env.TRANSFER_BROWSER_EXECUTABLE) throw new Error('TRANSFER_BROWSER_EXECUTABLE is required');
  const missingOnly = process.env.TRANSFER_CONTEXT_MISSING_ONLY === '1';
  const forceRefresh = process.env.TRANSFER_CONTEXT_FORCE_REFRESH === '1';
  const contextConcurrency = Math.max(1, Math.min(12, Number(process.env.TRANSFER_CONTEXT_CONCURRENCY) || 4));
  const dataset = loadDataset();
  const scopedClubIds = new Set((dataset.scopeLeagues || []).flatMap((league) => (
    (league.teams || []).map((team) => Number(team.transfermarktId)).filter(Number.isFinite)
  )));
  const contextClubs = scopedClubIds.size
    ? dataset.clubs.filter((club) => scopedClubIds.has(Number(club.transfermarkt?.id)))
    : dataset.clubs;
  const optaSource = await (await fetch(OPTA_URL, { headers: { 'user-agent': USER_AGENT } })).text();
  const optaTeams = extractOptaTeams(optaSource);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TRANSFER_BROWSER_EXECUTABLE });
  let completed = 0;
  let contexts;
  const fullLeagueTables = new Map();
  try {
    contexts = await withConcurrency(contextClubs, contextConcurrency, async (club) => {
      const warnings = [];
      const previousWarnings = String(club.contextWarning || '');
      let injuries = club.context && !previousWarnings.includes('injuries') ? (club.context.injuries || []) : [];
      let coach = club.context && !previousWarnings.includes('coach') ? (club.context.coach || null) : null;
      let schedule = { competitionCode: '', tableRoute: '', leagueName: '', leagueTable: [], fixtures: [] };
      if (missingOnly && !forceRefresh && club.context && !previousWarnings) {
        completed += 1;
        process.stdout.write(`\rContext ${completed}/${contextClubs.length}`);
        return { club, injuries, coach, schedule, warnings, reusedContext: true };
      }
      const page = await browser.newPage({ locale: 'en-GB', userAgent: USER_AGENT });
      if (forceRefresh || !club.context || previousWarnings.includes('injuries')) {
        try { injuries = await readInjuries(page, club); } catch { warnings.push('injuries'); }
      }
      if (forceRefresh || !club.context || previousWarnings.includes('coach')) {
        try { coach = await readCoach(page, club); } catch { warnings.push('coach'); }
      }
      try { schedule = await readSchedule(page, club); } catch { warnings.push('schedule'); }
      await page.close();
      completed += 1;
      process.stdout.write(`\rContext ${completed}/${contextClubs.length}`);
      return { club, injuries, coach, schedule, warnings };
    });
    if (!missingOnly) {
      const leagueEntries = [...new Map(contexts
        .filter((entry) => entry.schedule.competitionCode && entry.schedule.tableRoute)
        .map((entry) => [entry.schedule.competitionCode, entry])).values()];
      await withConcurrency(leagueEntries, 4, async (entry) => {
        const page = await browser.newPage({ locale: 'en-GB', userAgent: USER_AGENT });
        try {
          const table = await readFullLeagueTable(page, entry.schedule.tableRoute);
          if (table.length >= 7) fullLeagueTables.set(entry.schedule.competitionCode, table);
        } catch {
          // The compact seven-club table from the team page remains a safe fallback.
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('\n');

  const allOptaCandidates = optaTeams;
  const optaRatingFor = (name, country) => {
    const candidates = allOptaCandidates.filter((team) => team.country === country);
    const best = matchOptaTeam(name, candidates);
    return best?.score >= .56 ? Number(best.team.currentRating) : null;
  };
  const contextByClub = new Map(contexts.map((entry) => [entry.club.name, entry]));
  dataset.clubs = dataset.clubs.map((club) => {
    const entry = contextByClub.get(club.name);
    if (!entry) return club;
    const { contextWarning: _previousContextWarning, ...baseClub } = club;
    if (entry.reusedContext) return baseClub;
    if (entry.warnings.includes('schedule') && baseClub.context) {
      return { ...baseClub, contextWarning: entry.warnings.join(', ') };
    }
    const now = Date.now();
    const fixtures = entry.schedule.fixtures
      .map((fixture) => ({ ...fixture, timestamp: parseDate(fixture.date) }))
      .filter((fixture) => fixture.timestamp)
      .sort((left, right) => left.timestamp - right.timestamp);
    const recent = fixtures.filter((fixture) => fixture.timestamp <= now && resultPoints(fixture) !== null).slice(-5);
    const next = fixtures.filter((fixture) => fixture.timestamp > now && fixture.result.includes('-:-')).slice(0, 5);
    const opponentRatings = next.map((fixture) => optaRatingFor(fixture.opponent, club.country)).filter(Number.isFinite);
    const fixtureDifficulty = opponentRatings.length
      ? opponentRatings.reduce((total, value) => total + value, 0) / opponentRatings.length - club.rating
      : 0;
    const injuryValue = entry.injuries.reduce((total, injury) => total + parseMoney(injury.marketValue), 0);
    const coachAppointedAt = parseDate(entry.coach?.appointed);
    return {
      ...baseClub,
      context: {
        injuries: entry.injuries.map((injury) => ({ ...injury, marketValueNumber: parseMoney(injury.marketValue) })),
        injuryValue,
        coach: entry.coach,
        coachTenureDays: coachAppointedAt ? Math.max(0, Math.round((now - coachAppointedAt) / 86_400_000)) : null,
        recentFormPoints: recent.reduce((total, fixture) => total + resultPoints(fixture), 0),
        recentMatches: recent.length,
        nextFixtures: next.map(({ competition, date, venue, opponent }) => ({ competition, date, venue, opponent })),
        fixtureDifficulty: Number(fixtureDifficulty.toFixed(2)),
      },
      ...(entry.warnings.length ? { contextWarning: entry.warnings.join(', ') } : {}),
    };
  });

  const forecast = missingOnly
    ? { leagues: dataset.leagues, estimatedRatings: dataset.meta.contextCoverage?.estimatedRatings || 0 }
    : buildForecastLeagues(dataset, contexts, optaTeams, fullLeagueTables);
  dataset.leagues = forecast.leagues;
  dataset.meta.contextFetchedAt = new Date().toISOString();
  dataset.meta.contextSource = TRANSFERMARKT;
  dataset.meta.contextWarnings = contexts.filter((entry) => entry.warnings.length).length;
  dataset.meta.contextCoverage = {
    injuries: contexts.filter((entry) => !entry.warnings.includes('injuries')).length,
    coaches: contexts.filter((entry) => !entry.warnings.includes('coach') && entry.coach).length,
    schedules: contexts.filter((entry) => !entry.warnings.includes('schedule')).length,
    leagues: dataset.leagues.length,
    estimatedRatings: forecast.estimatedRatings,
    fullLeagueTables: missingOnly ? (dataset.meta.contextCoverage?.fullLeagueTables || dataset.leagues.length) : fullLeagueTables.size,
  };
  const sizes = writeTransferwereldDataset(dataset);
  console.log(`Wrote split transfer data (${sizes.baseBytes} + ${sizes.scopeBytes} bytes)`);
  console.log(JSON.stringify(dataset.meta.contextCoverage));
  if (dataset.meta.contextWarnings) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
